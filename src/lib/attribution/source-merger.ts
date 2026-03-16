import type {
  EventSource,
  PromptRow,
  CalendarEventRow,
  WindowEventRow,
  BrowserEventRow,
} from "@/lib/types";

export interface TimeInterval {
  start_ms: number;
  end_ms: number;
  priority: number; // 1=calendar, 2=browser, 3=window, 4=prompt
  source: EventSource;
  primary_category: string;
  primary_subcategory: string;
  attributed_minutes: number; // raw, never mutated
}

export interface DeduplicatedInterval extends TimeInterval {
  effective_minutes: number;
}

const PRIORITY: Record<EventSource, number> = {
  calendar: 1,
  browser: 2,
  window: 3,
  prompt: 4,
};

export function deduplicateIntervals(
  intervals: TimeInterval[]
): DeduplicatedInterval[] {
  return intervals.map((interval) => {
    // Zero-duration (pending prompt) — skip
    if (interval.end_ms <= interval.start_ms) {
      return { ...interval, effective_minutes: 0 };
    }

    const higherOverlapping = intervals.filter(
      (other) =>
        other.priority < interval.priority &&
        other.start_ms < interval.end_ms &&
        other.end_ms > interval.start_ms
    );

    if (higherOverlapping.length === 0) {
      return { ...interval, effective_minutes: interval.attributed_minutes };
    }

    // Clamp to this interval's bounds, sort, then union-merge
    const clamped = higherOverlapping
      .map((h) => ({
        start: Math.max(h.start_ms, interval.start_ms),
        end: Math.min(h.end_ms, interval.end_ms),
      }))
      .sort((a, b) => a.start - b.start);

    let overlapMs = 0;
    let cursor = interval.start_ms;
    for (const span of clamped) {
      if (span.start > cursor) cursor = span.start;
      if (span.end > cursor) {
        overlapMs += span.end - cursor;
        cursor = span.end;
      }
    }

    const effectiveMs = Math.max(
      0,
      interval.end_ms - interval.start_ms - overlapMs
    );
    return {
      ...interval,
      effective_minutes: Math.round((effectiveMs / 60_000) * 100) / 100,
    };
  });
}

export function buildIntervals(
  prompts: PromptRow[],
  calendarEvents: Pick<
    CalendarEventRow,
    | "start_time"
    | "end_time"
    | "duration_minutes"
    | "primary_category"
    | "primary_subcategory"
  >[],
  windowEvents: Pick<
    WindowEventRow,
    "start_time" | "duration_minutes" | "primary_category" | "primary_subcategory"
  >[],
  browserEvents: Pick<
    BrowserEventRow,
    "start_time" | "duration_minutes" | "primary_category" | "primary_subcategory"
  >[]
): TimeInterval[] {
  const ms = (s: string) => new Date(s).getTime();
  return [
    ...calendarEvents.map((e): TimeInterval => ({
      start_ms: ms(e.start_time),
      end_ms: ms(e.end_time),
      priority: PRIORITY.calendar,
      source: "calendar",
      primary_category: e.primary_category,
      primary_subcategory: e.primary_subcategory,
      attributed_minutes: e.duration_minutes,
    })),
    ...browserEvents.map((e): TimeInterval => {
      const s = ms(e.start_time);
      return {
        start_ms: s,
        end_ms: s + e.duration_minutes * 60_000,
        priority: PRIORITY.browser,
        source: "browser",
        primary_category: e.primary_category,
        primary_subcategory: e.primary_subcategory,
        attributed_minutes: e.duration_minutes,
      };
    }),
    ...windowEvents.map((e): TimeInterval => {
      const s = ms(e.start_time);
      return {
        start_ms: s,
        end_ms: s + e.duration_minutes * 60_000,
        priority: PRIORITY.window,
        source: "window",
        primary_category: e.primary_category,
        primary_subcategory: e.primary_subcategory,
        attributed_minutes: e.duration_minutes,
      };
    }),
    ...prompts.map((p): TimeInterval => {
      const s = ms(p.timestamp);
      return {
        start_ms: s,
        end_ms: s + p.attributed_minutes * 60_000,
        priority: PRIORITY.prompt,
        source: "prompt",
        primary_category: p.primary_category,
        primary_subcategory: p.primary_subcategory,
        attributed_minutes: p.attributed_minutes,
      };
    }),
  ];
}
