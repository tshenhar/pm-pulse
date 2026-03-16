import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID, createHash } from "crypto";
import { EVENTS_DIR } from "@/lib/db";

describe("Idle-aware prompt attribution", () => {
  let db: ReturnType<Awaited<ReturnType<typeof import("@/lib/db")>>["getDb"]>;
  const testHashes: string[] = [];
  const testIdleIds: string[] = [];

  beforeAll(async () => {
    mkdirSync(EVENTS_DIR, { recursive: true });
    const { initDb } = await import("@/lib/db");
    await initDb();
    const { getDb } = await import("@/lib/db");
    db = getDb();
  });

  afterEach(() => {
    for (const hash of testHashes) {
      db.prepare("DELETE FROM prompts WHERE prompt_hash = ?").run(hash);
    }
    for (const id of testIdleIds) {
      db.prepare("DELETE FROM idle_spans WHERE external_id = ?").run(id);
    }
    testHashes.length = 0;
    testIdleIds.length = 0;
  });

  function writePromptEvent(overrides: Record<string, unknown> = {}) {
    const prompt = (overrides.prompt as string) || `idle-test-${randomUUID()}`;
    const hash = createHash("sha256").update(prompt).digest("hex");
    testHashes.push(hash);
    const event = {
      id: randomUUID(),
      type: "prompt",
      timestamp: new Date().toISOString(),
      session_id: `idle-session-${randomUUID()}`,
      prompt,
      prompt_hash: hash,
      cwd: "/Users/test/Projects/test-project",
      ...overrides,
    };
    writeFileSync(join(EVENTS_DIR, `${event.id}.json`), JSON.stringify(event));
    return { event, hash };
  }

  function insertIdleSpan(startIso: string, endIso: string) {
    const id = randomUUID();
    testIdleIds.push(id);
    const durationMinutes = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000;
    db.prepare(`
      INSERT INTO idle_spans (external_id, start_time, end_time, duration_minutes, source)
      VALUES (?, ?, ?, ?, 'window')
    `).run(id, startIso, endIso, durationMinutes);
    return id;
  }

  function getRow(hash: string) {
    return db.prepare("SELECT * FROM prompts WHERE prompt_hash = ?").get(hash) as Record<string, unknown> | undefined;
  }

  it("idle span fully within gap → attributed_minutes reduced, method = idle_adjusted", async () => {
    const { processEvents } = await import("@/lib/ingestion/processor");
    const sessionId = `idle-full-${randomUUID()}`;
    const now = Date.now();

    // Prompt 1 at T+0
    const { hash: h1 } = writePromptEvent({ session_id: sessionId, timestamp: new Date(now).toISOString() });
    processEvents();

    // Insert idle span [09:00, 09:30] — 30 min idle inside the 45-min gap
    const idleStart = new Date(now + 0).toISOString();       // starts right at prompt 1
    const idleEnd = new Date(now + 30 * 60_000).toISOString(); // 30 min idle
    insertIdleSpan(idleStart, idleEnd);

    // Prompt 2 at T+45min — gap is 45 min raw
    const { hash: h2 } = writePromptEvent({ session_id: sessionId, timestamp: new Date(now + 45 * 60_000).toISOString() });
    processEvents();

    const r1 = getRow(h1);
    // 45 min raw - 30 min idle = 15 min attributed
    expect(r1!.attribution_method).toBe("idle_adjusted");
    expect(r1!.attributed_minutes as number).toBeCloseTo(15, 0);
    // gap_to_next_seconds should reflect the raw physical gap
    expect(r1!.gap_to_next_seconds as number).toBeCloseTo(45 * 60, 0);

    // Prompt 2 still pending
    expect(getRow(h2)!.attribution_method).toBe("pending");
  });

  it("idle span fully outside gap → 0 subtracted, method = measured", async () => {
    const { processEvents } = await import("@/lib/ingestion/processor");
    const sessionId = `idle-outside-${randomUUID()}`;
    const now = Date.now();

    const { hash: h1 } = writePromptEvent({ session_id: sessionId, timestamp: new Date(now).toISOString() });
    processEvents();

    // Idle span is 2 hours before prompt 1 — completely outside gap
    insertIdleSpan(
      new Date(now - 3 * 60 * 60_000).toISOString(),
      new Date(now - 2 * 60 * 60_000).toISOString()
    );

    const { hash: h2 } = writePromptEvent({ session_id: sessionId, timestamp: new Date(now + 10 * 60_000).toISOString() });
    processEvents();

    const r1 = getRow(h1);
    expect(r1!.attribution_method).toBe("measured");
    expect(r1!.attributed_minutes as number).toBeCloseTo(10, 0);
  });

  it("gap fully covered by idle → attributed_minutes = 0", async () => {
    const { processEvents } = await import("@/lib/ingestion/processor");
    const sessionId = `idle-full-cover-${randomUUID()}`;
    const now = Date.now();

    const { hash: h1 } = writePromptEvent({ session_id: sessionId, timestamp: new Date(now).toISOString() });
    processEvents();

    // Idle span covers the entire 20-min gap (with some margin)
    insertIdleSpan(
      new Date(now - 5 * 60_000).toISOString(),
      new Date(now + 25 * 60_000).toISOString()
    );

    const { hash: h2 } = writePromptEvent({ session_id: sessionId, timestamp: new Date(now + 20 * 60_000).toISOString() });
    processEvents();

    const r1 = getRow(h1);
    expect(r1!.attribution_method).toBe("idle_adjusted");
    expect(r1!.attributed_minutes as number).toBe(0);

    // Suppress h2 unused warning
    expect(getRow(h2)!.attribution_method).toBe("pending");
  });

  it("window-ingestor: idle session inserts row into idle_spans", async () => {
    const { processWindowEvents } = await import("@/lib/ingestion/window-ingestor");
    const idleId = randomUUID();
    testIdleIds.push(idleId);

    const start = new Date().toISOString();
    const end = new Date(Date.now() + 5 * 60_000).toISOString();
    const session = {
      id: idleId,
      type: "window_session",
      app_name: "Idle Time",
      start_time: start,
      end_time: end,
      duration_seconds: 300,
    };

    const tmpDir = process.env.__TEST_WINDOW_EVENTS_DIR ?? "/tmp/pm-pulse-test-window-events";
    mkdirSync(tmpDir, { recursive: true });
    const origEnv = process.env.__TEST_WINDOW_EVENTS_DIR;
    process.env.__TEST_WINDOW_EVENTS_DIR = tmpDir;

    const filePath = join(tmpDir, `${idleId}.json`);
    writeFileSync(filePath, JSON.stringify(session));

    processWindowEvents();

    process.env.__TEST_WINDOW_EVENTS_DIR = origEnv;

    // Should be in idle_spans, NOT in window_events
    const idleRow = db.prepare("SELECT * FROM idle_spans WHERE external_id = ?").get(idleId);
    expect(idleRow).toBeTruthy();
    expect((idleRow as Record<string, unknown>).duration_minutes as number).toBeCloseTo(5, 1);

    const windowRow = db.prepare("SELECT * FROM window_events WHERE external_id = ?").get(idleId);
    expect(windowRow).toBeUndefined();
  });
});
