import { describe, it, expect } from "vitest";
import { deduplicateIntervals, buildIntervals, type TimeInterval } from "../../src/lib/attribution/source-merger";
import type { PromptRow, CalendarEventRow, WindowEventRow, BrowserEventRow } from "../../src/lib/types";

const T = (iso: string) => new Date(iso).getTime();
const MIN = 60_000;

function makeInterval(
  source: TimeInterval["source"],
  start: string,
  end: string,
  attributed_minutes: number,
  primary_category = "dev",
  primary_subcategory = "coding"
): TimeInterval {
  const PRIORITY = { calendar: 1, browser: 2, window: 3, prompt: 4 } as const;
  return {
    start_ms: T(start),
    end_ms: T(end),
    priority: PRIORITY[source],
    source,
    primary_category,
    primary_subcategory,
    attributed_minutes,
  };
}

describe("deduplicateIntervals", () => {
  it("empty input → empty output", () => {
    expect(deduplicateIntervals([])).toEqual([]);
  });

  it("no overlap → effective_minutes === attributed_minutes", () => {
    const intervals = [
      makeInterval("window",   "2026-03-16T09:00:00Z", "2026-03-16T09:30:00Z", 30),
      makeInterval("calendar", "2026-03-16T10:00:00Z", "2026-03-16T11:00:00Z", 60),
    ];
    const result = deduplicateIntervals(intervals);
    expect(result[0].effective_minutes).toBe(30);
    expect(result[1].effective_minutes).toBe(60);
  });

  it("full overlap: lower-priority fully covered → effective = 0", () => {
    const intervals = [
      makeInterval("calendar", "2026-03-16T09:00:00Z", "2026-03-16T10:00:00Z", 60),
      makeInterval("window",   "2026-03-16T09:00:00Z", "2026-03-16T10:00:00Z", 60),
    ];
    const result = deduplicateIntervals(intervals);
    const cal    = result.find((i) => i.source === "calendar")!;
    const window = result.find((i) => i.source === "window")!;
    expect(cal.effective_minutes).toBe(60);    // calendar never reduced
    expect(window.effective_minutes).toBe(0);  // fully stolen by calendar
  });

  it("partial overlap: window 9:00–9:30, calendar 9:15–9:30 → window effective = 15 min", () => {
    const intervals = [
      makeInterval("calendar", "2026-03-16T09:15:00Z", "2026-03-16T09:30:00Z", 15),
      makeInterval("window",   "2026-03-16T09:00:00Z", "2026-03-16T09:30:00Z", 30),
    ];
    const result = deduplicateIntervals(intervals);
    const window = result.find((i) => i.source === "window")!;
    expect(window.effective_minutes).toBe(15);
  });

  it("calendar (priority 1) never reduced even when overlapping", () => {
    const intervals = [
      makeInterval("calendar", "2026-03-16T09:00:00Z", "2026-03-16T10:00:00Z", 60),
      makeInterval("browser",  "2026-03-16T09:00:00Z", "2026-03-16T10:00:00Z", 60),
    ];
    const result = deduplicateIntervals(intervals);
    const cal = result.find((i) => i.source === "calendar")!;
    expect(cal.effective_minutes).toBe(60);
  });

  it("same-priority intervals do NOT reduce each other", () => {
    // Two window events overlapping — neither should be penalized
    const intervals: TimeInterval[] = [
      { start_ms: T("2026-03-16T09:00:00Z"), end_ms: T("2026-03-16T09:30:00Z"), priority: 3, source: "window", primary_category: "dev", primary_subcategory: "coding", attributed_minutes: 30 },
      { start_ms: T("2026-03-16T09:15:00Z"), end_ms: T("2026-03-16T09:45:00Z"), priority: 3, source: "window", primary_category: "dev", primary_subcategory: "coding", attributed_minutes: 30 },
    ];
    const result = deduplicateIntervals(intervals);
    expect(result[0].effective_minutes).toBe(30);
    expect(result[1].effective_minutes).toBe(30);
  });

  it("multiple higher-priority sources — union prevents double-subtraction", () => {
    // Prompt spans 9:00–10:00 (60 min)
    // Browser covers 9:00–9:30 (priority 2)
    // Window covers 9:15–9:45 (priority 3) — union of browser+window still only 9:00–9:45 against prompt
    // But from prompt's perspective: browser (p2) covers 9:00–9:30, window (p3) covers 9:15–9:45.
    // Only browser is higher priority than prompt (p4). Window is also higher (p3 < p4).
    // Combined higher overlap union = 9:00–9:45 = 45 min → prompt effective = 60 - 45 = 15 min
    const intervals: TimeInterval[] = [
      { start_ms: T("2026-03-16T09:00:00Z"), end_ms: T("2026-03-16T09:30:00Z"), priority: 2, source: "browser", primary_category: "dev", primary_subcategory: "coding", attributed_minutes: 30 },
      { start_ms: T("2026-03-16T09:15:00Z"), end_ms: T("2026-03-16T09:45:00Z"), priority: 3, source: "window",  primary_category: "dev", primary_subcategory: "coding", attributed_minutes: 30 },
      { start_ms: T("2026-03-16T09:00:00Z"), end_ms: T("2026-03-16T10:00:00Z"), priority: 4, source: "prompt",  primary_category: "dev", primary_subcategory: "coding", attributed_minutes: 60 },
    ];
    const result = deduplicateIntervals(intervals);
    const prompt = result.find((i) => i.source === "prompt")!;
    // union of browser 9:00–9:30 and window 9:15–9:45 → 9:00–9:45 = 45 min overlap
    expect(prompt.effective_minutes).toBe(15);
  });

  it("zero-duration (pending prompt) → effective = 0", () => {
    const intervals: TimeInterval[] = [
      { start_ms: T("2026-03-16T09:00:00Z"), end_ms: T("2026-03-16T09:00:00Z"), priority: 4, source: "prompt", primary_category: "dev", primary_subcategory: "coding", attributed_minutes: 0 },
    ];
    const result = deduplicateIntervals(intervals);
    expect(result[0].effective_minutes).toBe(0);
  });

  it("higher-priority extends past interval boundary — overlap clamped correctly", () => {
    // Window 9:00–9:30, Calendar 9:20–10:00 (extends past window end)
    // Overlap = 9:20–9:30 = 10 min → window effective = 30 - 10 = 20 min
    const intervals = [
      makeInterval("calendar", "2026-03-16T09:20:00Z", "2026-03-16T10:00:00Z", 40),
      makeInterval("window",   "2026-03-16T09:00:00Z", "2026-03-16T09:30:00Z", 30),
    ];
    const result = deduplicateIntervals(intervals);
    const window = result.find((i) => i.source === "window")!;
    expect(window.effective_minutes).toBe(20);
  });
});

describe("buildIntervals", () => {
  it("returns empty array for all-empty inputs", () => {
    expect(buildIntervals([], [], [], [])).toEqual([]);
  });

  it("calendar uses end_time directly", () => {
    const calEvent = {
      start_time: "2026-03-16T09:00:00Z",
      end_time:   "2026-03-16T10:00:00Z",
      duration_minutes: 60,
      primary_category: "meetings",
      primary_subcategory: "standup",
    } satisfies Pick<CalendarEventRow, "start_time" | "end_time" | "duration_minutes" | "primary_category" | "primary_subcategory">;

    const result = buildIntervals([], [calEvent], [], []);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("calendar");
    expect(result[0].start_ms).toBe(T("2026-03-16T09:00:00Z"));
    expect(result[0].end_ms).toBe(T("2026-03-16T10:00:00Z"));
    expect(result[0].priority).toBe(1);
  });

  it("window event derives end_ms from start + duration", () => {
    const windowEvent = {
      start_time: "2026-03-16T09:00:00Z",
      duration_minutes: 30,
      primary_category: "dev",
      primary_subcategory: "coding",
    } satisfies Pick<WindowEventRow, "start_time" | "duration_minutes" | "primary_category" | "primary_subcategory">;

    const result = buildIntervals([], [], [windowEvent], []);
    expect(result[0].end_ms).toBe(T("2026-03-16T09:00:00Z") + 30 * MIN);
    expect(result[0].priority).toBe(3);
  });

  it("browser event derives end_ms from start + duration", () => {
    const browserEvent = {
      start_time: "2026-03-16T09:00:00Z",
      duration_minutes: 15,
      primary_category: "research",
      primary_subcategory: "web",
    } satisfies Pick<BrowserEventRow, "start_time" | "duration_minutes" | "primary_category" | "primary_subcategory">;

    const result = buildIntervals([], [], [], [browserEvent]);
    expect(result[0].end_ms).toBe(T("2026-03-16T09:00:00Z") + 15 * MIN);
    expect(result[0].priority).toBe(2);
  });

  it("prompt uses attributed_minutes for end_ms", () => {
    const prompt = {
      id: 1, external_id: "x", session_id: "s1", timestamp: "2026-03-16T09:00:00Z",
      prompt_text: null, prompt_preview: null, prompt_hash: null, cwd: "/",
      project_name: null, primary_category: "dev", primary_subcategory: "coding",
      primary_confidence: 0.9, secondary_category: null, secondary_subcategory: null,
      secondary_confidence: null, classification_method: "rules" as const,
      classification_reasoning: null, pending_llm_classification: 0,
      attributed_minutes: 25, attribution_method: "measured", time_confidence: "explained",
      gap_to_next_seconds: null, response_timestamp: null, response_duration_seconds: null,
      previous_category: null, previous_subcategory: null, override_reason: null,
      override_at: null, redacted: 0, created_at: "", updated_at: "",
    } satisfies PromptRow;

    const result = buildIntervals([prompt], [], [], []);
    expect(result[0].end_ms).toBe(T("2026-03-16T09:00:00Z") + 25 * MIN);
    expect(result[0].priority).toBe(4);
  });

  it("priority ordering: calendar=1, browser=2, window=3, prompt=4", () => {
    const cal = { start_time: "2026-03-16T09:00:00Z", end_time: "2026-03-16T09:30:00Z", duration_minutes: 30, primary_category: "m", primary_subcategory: "s" };
    const browser = { start_time: "2026-03-16T09:00:00Z", duration_minutes: 30, primary_category: "m", primary_subcategory: "s" };
    const window = { start_time: "2026-03-16T09:00:00Z", duration_minutes: 30, primary_category: "m", primary_subcategory: "s" };

    const result = buildIntervals([], [cal], [window], [browser]);
    const priorities = Object.fromEntries(result.map((i) => [i.source, i.priority]));
    expect(priorities.calendar).toBe(1);
    expect(priorities.browser).toBe(2);
    expect(priorities.window).toBe(3);
  });
});
