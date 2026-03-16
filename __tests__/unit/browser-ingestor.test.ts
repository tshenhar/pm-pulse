import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { homedir } from "os";

// Mock LLM to prevent real API calls and ensure deterministic fallback behavior
vi.mock("@/lib/classification/llm-classifier", () => ({
  classifyWithLLM: vi.fn().mockRejectedValue(new Error("LLM not available in tests")),
}));

const TEST_DIR = join(homedir(), ".pm-pulse", "browser-events-test");

// Set env before importing the module
process.env.__TEST_BROWSER_EVENTS_DIR = TEST_DIR;

describe("Browser Ingestor", () => {
  let db: ReturnType<Awaited<ReturnType<typeof import("@/lib/db")>>["getDb"]>;
  const testExternalIds: string[] = [];

  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const { initDb, getDb } = await import("@/lib/db");
    await initDb();
    db = getDb();
  });

  afterEach(() => {
    // Clean test browser events from DB
    for (const eid of testExternalIds) {
      db.prepare("DELETE FROM browser_events WHERE external_id = ?").run(eid);
    }
    testExternalIds.length = 0;
    // Clean test files
    try {
      for (const f of readdirSync(TEST_DIR)) {
        rmSync(join(TEST_DIR, f), { force: true });
      }
    } catch { /* */ }
  });

  afterAll(() => {
    for (const eid of testExternalIds) {
      db.prepare("DELETE FROM browser_events WHERE external_id = ?").run(eid);
    }
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  function makeVisit(overrides: Record<string, unknown> = {}) {
    const id = `test-browser-${randomUUID()}`;
    testExternalIds.push(id);
    const now = new Date();
    return {
      id,
      type: "browser_event",
      browser: "Google Chrome",
      url: "https://github.com/test/repo",
      domain: "github.com",
      title: "Test Page",
      start_time: now.toISOString(),
      end_time: new Date(now.getTime() + 60_000).toISOString(),
      duration_seconds: 60,
      ...overrides,
    };
  }

  function writeVisit(visit: Record<string, unknown>) {
    writeFileSync(join(TEST_DIR, `${visit.id}.json`), JSON.stringify(visit));
  }

  // === classifyByDomain tests ===
  describe("classifyByDomain", () => {
    const domainTests = [
      { domain: "github.com", url: "https://github.com/test", cat: "development", sub: "coding" },
      { domain: "github.com", url: "https://github.com/test/pull/1", cat: "development", sub: "coding" },
      { domain: "meet.google.com", url: "https://meet.google.com/abc", cat: "communication", sub: "meetings" },
      { domain: "docs.google.com", url: "https://docs.google.com/presentation/d/1", cat: "communication", sub: "presentation" },
      { domain: "docs.google.com", url: "https://docs.google.com/spreadsheets/d/1", cat: "analytics", sub: "data" },
      { domain: "docs.google.com", url: "https://docs.google.com/document/d/1", cat: "writing", sub: "general" },
      { domain: "linear.app", url: "https://linear.app/team/issue", cat: "requirements", sub: "epic" },
      { domain: "figma.com", url: "https://figma.com/design/abc", cat: "requirements", sub: "ux" },
      { domain: "app.slack.com", url: "https://app.slack.com/client", cat: "communication", sub: "alignment" },
      { domain: "mail.google.com", url: "https://mail.google.com/mail", cat: "communication", sub: "stakeholder" },
      { domain: "amplitude.com", url: "https://amplitude.com/analytics", cat: "analytics", sub: "reporting" },
      { domain: "notion.so", url: "https://notion.so/page", cat: "writing", sub: "process" },
      { domain: "unknown-site.xyz", url: "https://unknown-site.xyz", cat: "productivity", sub: "admin" },
    ];

    it.each(domainTests)(
      "classifies $domain correctly ($cat/$sub)",
      async ({ domain, url, cat, sub }) => {
        const visit = makeVisit({ domain, url });
        writeVisit(visit);

        const { processBrowserEvents } = await import("@/lib/ingestion/browser-ingestor");
        await processBrowserEvents();

        const row = db.prepare("SELECT * FROM browser_events WHERE external_id = ?").get(visit.id) as Record<string, unknown>;
        expect(row).toBeDefined();
        expect(row.primary_category).toBe(cat);
        expect(row.primary_subcategory).toBe(sub);
      }
    );
  });

  // === groupVisits tests ===
  describe("groupVisits", () => {
    it("groups 3 visits within 5 min to same domain → 1 DB row", async () => {
      const now = Date.now();
      const domain = "github.com";
      const visits = [];

      for (let i = 0; i < 3; i++) {
        const start = new Date(now + i * 120_000); // 2 min apart
        const visit = makeVisit({
          domain,
          url: `https://github.com/repo${i}`,
          start_time: start.toISOString(),
          end_time: new Date(start.getTime() + 60_000).toISOString(),
          duration_seconds: 60,
        });
        visits.push(visit);
        writeVisit(visit);
      }

      const { processBrowserEvents } = await import("@/lib/ingestion/browser-ingestor");
      processBrowserEvents();

      // Should be grouped into 1 row (using first visit's id)
      const row = db.prepare("SELECT * FROM browser_events WHERE external_id = ?").get(visits[0].id) as Record<string, unknown>;
      expect(row).toBeDefined();
      // The grouped duration should be sum of all 3 visits (3 × 60s = 180s = 3 min)
      expect(row.duration_minutes).toBeCloseTo(3, 0);
    });

    it("splits visits with 15-min gap → 2 DB rows", async () => {
      const now = Date.now();
      const domain = "figma.com";

      const v1 = makeVisit({
        domain,
        url: "https://figma.com/a",
        start_time: new Date(now).toISOString(),
        end_time: new Date(now + 60_000).toISOString(),
        duration_seconds: 60,
      });
      writeVisit(v1);

      // 15 min later — exceeds 11 min grouping threshold
      const v2 = makeVisit({
        domain,
        url: "https://figma.com/b",
        start_time: new Date(now + 15 * 60_000).toISOString(),
        end_time: new Date(now + 16 * 60_000).toISOString(),
        duration_seconds: 60,
      });
      writeVisit(v2);

      const { processBrowserEvents } = await import("@/lib/ingestion/browser-ingestor");
      processBrowserEvents();

      const r1 = db.prepare("SELECT * FROM browser_events WHERE external_id = ?").get(v1.id) as Record<string, unknown>;
      const r2 = db.prepare("SELECT * FROM browser_events WHERE external_id = ?").get(v2.id) as Record<string, unknown>;
      expect(r1).toBeDefined();
      expect(r2).toBeDefined();
    });

    it("breaks group on different domains", async () => {
      const now = Date.now();

      const v1 = makeVisit({
        domain: "github.com",
        url: "https://github.com/a",
        start_time: new Date(now).toISOString(),
        end_time: new Date(now + 60_000).toISOString(),
        duration_seconds: 60,
      });
      writeVisit(v1);

      const v2 = makeVisit({
        domain: "figma.com",
        url: "https://figma.com/b",
        start_time: new Date(now + 60_000).toISOString(),
        end_time: new Date(now + 120_000).toISOString(),
        duration_seconds: 60,
      });
      writeVisit(v2);

      const { processBrowserEvents } = await import("@/lib/ingestion/browser-ingestor");
      processBrowserEvents();

      const r1 = db.prepare("SELECT * FROM browser_events WHERE external_id = ?").get(v1.id) as Record<string, unknown>;
      const r2 = db.prepare("SELECT * FROM browser_events WHERE external_id = ?").get(v2.id) as Record<string, unknown>;
      expect(r1).toBeDefined();
      expect(r2).toBeDefined();
      expect(r1.domain).toBe("github.com");
      expect(r2.domain).toBe("figma.com");
    });
  });

  // === File handling tests ===
  describe("file handling", () => {
    it("deletes source files after processing", async () => {
      const visit = makeVisit();
      writeVisit(visit);
      const filePath = join(TEST_DIR, `${visit.id}.json`);
      expect(existsSync(filePath)).toBe(true);

      const { processBrowserEvents } = await import("@/lib/ingestion/browser-ingestor");
      await processBrowserEvents();

      expect(existsSync(filePath)).toBe(false);
    });

    it("returns {processed:0} for empty directory", async () => {
      const { processBrowserEvents } = await import("@/lib/ingestion/browser-ingestor");
      const result = await processBrowserEvents();
      expect(result.processed).toBe(0);
      expect(result.errors).toBe(0);
    });

    it("counts malformed JSON as error", async () => {
      writeFileSync(join(TEST_DIR, "bad.json"), "not json{{{");

      const { processBrowserEvents } = await import("@/lib/ingestion/browser-ingestor");
      const result = await processBrowserEvents();
      expect(result.errors).toBeGreaterThanOrEqual(1);
    });

    it("handles duplicate external_id via upsert", async () => {
      const visit = makeVisit({ duration_seconds: 60 });

      // Write and process first
      writeVisit(visit);
      const { processBrowserEvents } = await import("@/lib/ingestion/browser-ingestor");
      await processBrowserEvents();

      // Write again with updated duration
      const updated = { ...visit, duration_seconds: 120 };
      writeVisit(updated);
      await processBrowserEvents();

      const rows = db.prepare("SELECT * FROM browser_events WHERE external_id = ?").all(visit.id);
      expect(rows.length).toBe(1);
    });
  });
});
