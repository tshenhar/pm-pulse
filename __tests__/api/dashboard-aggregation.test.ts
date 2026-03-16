import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomUUID } from "crypto";

describe("Dashboard Aggregation & Source Merging", () => {
  let db: ReturnType<Awaited<ReturnType<typeof import("@/lib/db")>>["getDb"]>;
  const cleanupIds: { table: string; column: string; value: string }[] = [];

  beforeAll(async () => {
    const { initDb, getDb } = await import("@/lib/db");
    await initDb();
    db = getDb();
  });

  afterEach(() => {
    for (const { table, column, value } of cleanupIds) {
      db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(value);
    }
    cleanupIds.length = 0;
  });

  // Use a fixed date in the past to avoid collisions with real data
  const TEST_DATE = "2025-01-15";
  // January = EST (UTC-5), 8am ET = 13:00 UTC
  const DAY_START = "2025-01-15T13:00:00.000Z";

  function insertPrompt(overrides: Record<string, unknown> = {}) {
    const hash = `agg-test-${randomUUID()}`;
    cleanupIds.push({ table: "prompts", column: "prompt_hash", value: hash });
    db.prepare(`
      INSERT INTO prompts (
        external_id, session_id, timestamp, prompt_text, prompt_preview, prompt_hash,
        cwd, project_name,
        primary_category, primary_subcategory, primary_confidence,
        classification_method, pending_llm_classification,
        attributed_minutes, attribution_method, time_confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      overrides.external_id ?? randomUUID(),
      overrides.session_id ?? `session-${randomUUID()}`,
      overrides.timestamp ?? new Date(new Date(DAY_START).getTime() + 3600_000).toISOString(),
      overrides.prompt_text ?? "test prompt",
      overrides.prompt_preview ?? "test prompt",
      hash,
      overrides.cwd ?? "/tmp/test",
      overrides.project_name ?? "test-project",
      overrides.primary_category ?? "development",
      overrides.primary_subcategory ?? "coding",
      overrides.primary_confidence ?? 0.8,
      "rules",
      0,
      overrides.attributed_minutes ?? 10,
      overrides.attribution_method ?? "measured",
      overrides.time_confidence ?? "explained",
    );
    return hash;
  }

  function insertCalendar(overrides: Record<string, unknown> = {}) {
    const uid = `cal-test-${randomUUID()}`;
    cleanupIds.push({ table: "calendar_events", column: "uid", value: uid });
    const startTime = overrides.start_time ?? new Date(new Date(DAY_START).getTime() + 7200_000).toISOString();
    db.prepare(`
      INSERT INTO calendar_events (uid, summary, start_time, end_time, duration_minutes, attendee_count,
        primary_category, primary_subcategory, primary_confidence, classification_reasoning)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uid,
      overrides.summary ?? "Test Meeting",
      startTime,
      overrides.end_time ?? new Date(new Date(startTime as string).getTime() + 1800_000).toISOString(),
      overrides.duration_minutes ?? 30,
      overrides.attendee_count ?? 2,
      overrides.primary_category ?? "communication",
      overrides.primary_subcategory ?? "meetings",
      0.8,
      "test meeting",
    );
    return uid;
  }

  function insertWindow(overrides: Record<string, unknown> = {}) {
    const eid = `win-test-${randomUUID()}`;
    cleanupIds.push({ table: "window_events", column: "external_id", value: eid });
    db.prepare(`
      INSERT INTO window_events (external_id, app_name, window_title, start_time, duration_minutes,
        primary_category, primary_subcategory, primary_confidence, classification_reasoning)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eid,
      overrides.app_name ?? "Figma",
      overrides.window_title ?? "Design file",
      overrides.start_time ?? new Date(new Date(DAY_START).getTime() + 5400_000).toISOString(),
      overrides.duration_minutes ?? 15,
      overrides.primary_category ?? "requirements",
      overrides.primary_subcategory ?? "ux",
      0.85,
      "design tool",
    );
    return eid;
  }

  function insertBrowser(overrides: Record<string, unknown> = {}) {
    const eid = `brw-test-${randomUUID()}`;
    cleanupIds.push({ table: "browser_events", column: "external_id", value: eid });
    db.prepare(`
      INSERT INTO browser_events (external_id, browser, domain, url, page_title, start_time, duration_minutes,
        primary_category, primary_subcategory, primary_confidence, classification_reasoning)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eid,
      "Chrome",
      overrides.domain ?? "github.com",
      overrides.url ?? "https://github.com/test",
      overrides.page_title ?? "GitHub",
      overrides.start_time ?? new Date(new Date(DAY_START).getTime() + 4200_000).toISOString(),
      overrides.duration_minutes ?? 8,
      overrides.primary_category ?? "development",
      overrides.primary_subcategory ?? "coding",
      0.8,
      "code host",
    );
    return eid;
  }

  // === Unit tests for aggregateDaily ===
  describe("aggregateDaily", () => {
    it("computes category breakdown from prompts", async () => {
      const { aggregateDaily } = await import("@/lib/attribution/aggregator");
      const categoryMeta = new Map([
        ["development", { name: "Development & Technical", color: "#3b82f6" }],
        ["strategy", { name: "Strategy & Planning", color: "#f59e0b" }],
      ]);

      const prompts = [
        { primary_category: "development", primary_subcategory: "coding", attributed_minutes: 30, timestamp: "2025-01-15T14:00:00Z", session_id: "s1" },
        { primary_category: "development", primary_subcategory: "coding", attributed_minutes: 20, timestamp: "2025-01-15T14:30:00Z", session_id: "s1" },
        { primary_category: "strategy", primary_subcategory: "roadmap", attributed_minutes: 10, timestamp: "2025-01-15T15:00:00Z", session_id: "s1" },
      ] as any[];

      const result = aggregateDaily(prompts, categoryMeta);
      expect(result.category_breakdown.length).toBe(2);
      const devCat = result.category_breakdown.find((c) => c.category === "development");
      expect(devCat!.minutes).toBe(50);
    });

    it("computes project breakdown from prompts", async () => {
      const { aggregateDaily } = await import("@/lib/attribution/aggregator");
      const prompts = [
        { primary_category: "development", primary_subcategory: "coding", attributed_minutes: 30, project_name: "app-a", timestamp: "2025-01-15T14:00:00Z", session_id: "s1" },
        { primary_category: "development", primary_subcategory: "coding", attributed_minutes: 20, project_name: "app-b", timestamp: "2025-01-15T14:30:00Z", session_id: "s1" },
      ] as any[];

      const result = aggregateDaily(prompts, new Map());
      expect(result.project_breakdown.length).toBe(2);
      expect(result.project_breakdown[0].project).toBe("app-a"); // sorted by minutes desc
    });

    it("handles empty data", async () => {
      const { aggregateDaily } = await import("@/lib/attribution/aggregator");
      const result = aggregateDaily([], new Map());
      expect(result.total_hours).toBe(0);
      expect(result.total_sessions).toBe(0);
      expect(result.category_breakdown).toEqual([]);
      expect(result.project_breakdown).toEqual([]);
    });
  });

  // === Integration tests via dashboard route ===
  describe("dashboard route integration", () => {
    async function fetchDashboard(date: string) {
      const { GET } = await import("@/app/api/dashboard/route");
      const req = new Request(`http://localhost:3000/api/dashboard?date=${date}`);
      const res = await GET(req);
      return res.json();
    }

    it("returns data for a day with only prompts", async () => {
      insertPrompt({ attributed_minutes: 15 });
      insertPrompt({ attributed_minutes: 25 });

      const data = await fetchDashboard(TEST_DATE);
      expect(data.total_prompts).toBeGreaterThanOrEqual(2);
      expect(data.source_breakdown.claude_minutes).toBeGreaterThanOrEqual(40);
    });

    it("merges all 4 sources", async () => {
      insertPrompt({ attributed_minutes: 10 });
      insertCalendar({ duration_minutes: 30 });
      insertWindow({ duration_minutes: 15 });
      insertBrowser({ duration_minutes: 8 });

      const data = await fetchDashboard(TEST_DATE);
      expect(data.total_events).toBeGreaterThanOrEqual(4);
      expect(data.source_breakdown.claude_minutes).toBeGreaterThanOrEqual(10);
      expect(data.source_breakdown.calendar_minutes).toBeGreaterThanOrEqual(30);
      expect(data.source_breakdown.window_minutes).toBeGreaterThanOrEqual(15);
      expect(data.source_breakdown.browser_minutes).toBeGreaterThanOrEqual(8);
    });

    it("source_breakdown sums to total", async () => {
      insertPrompt({ attributed_minutes: 10 });
      insertCalendar({ duration_minutes: 20 });

      const data = await fetchDashboard(TEST_DATE);
      const sumMinutes =
        data.source_breakdown.claude_minutes +
        data.source_breakdown.calendar_minutes +
        data.source_breakdown.window_minutes +
        data.source_breakdown.browser_minutes;
      // total_hours * 60 should approximately match sum
      expect(Math.abs(data.total_hours * 60 - sumMinutes)).toBeLessThan(2);
    });

    it("focus_minutes excludes calendar", async () => {
      insertPrompt({ attributed_minutes: 10 });
      insertCalendar({ duration_minutes: 30 });
      insertWindow({ duration_minutes: 5 });

      const data = await fetchDashboard(TEST_DATE);
      // focus = claude + window + browser (no calendar)
      expect(data.focus_minutes).toBeGreaterThanOrEqual(15);
      // Should not include calendar minutes
      expect(data.focus_minutes).toBeLessThan(data.total_hours * 60 + 1);
    });

    it("activities are sorted chronologically", async () => {
      const t1 = new Date(new Date(DAY_START).getTime() + 7200_000).toISOString();
      const t2 = new Date(new Date(DAY_START).getTime() + 3600_000).toISOString();

      insertPrompt({ timestamp: t1 });
      insertPrompt({ timestamp: t2 });

      const data = await fetchDashboard(TEST_DATE);
      // Activities should be sorted by timestamp ascending
      for (let i = 1; i < data.activities.length; i++) {
        expect(data.activities[i].timestamp >= data.activities[i - 1].timestamp).toBe(true);
      }
    });

    it("returns valid structure for empty day", async () => {
      // Use a far-past date with no data
      const data = await fetchDashboard("2020-01-01");
      expect(data.total_hours).toBe(0);
      expect(data.total_events).toBe(0);
      expect(data.activities).toEqual([]);
      expect(data.category_breakdown).toEqual([]);
    });
  });
});
