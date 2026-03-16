import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID, createHash } from "crypto";
import { EVENTS_DIR } from "@/lib/db";

describe("Processor — Retroactive Fix-Up Edge Cases", () => {
  let db: ReturnType<Awaited<ReturnType<typeof import("@/lib/db")>>["getDb"]>;
  const testHashes: string[] = [];

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
    testHashes.length = 0;
  });

  afterAll(() => {
    for (const hash of testHashes) {
      db.prepare("DELETE FROM prompts WHERE prompt_hash = ?").run(hash);
    }
  });

  function writeEvent(overrides: Record<string, unknown> = {}) {
    const prompt = (overrides.prompt as string) || `fixup-test-${randomUUID()}`;
    const hash = createHash("sha256").update(prompt).digest("hex");
    testHashes.push(hash);

    const event = {
      id: randomUUID(),
      type: "prompt",
      timestamp: new Date().toISOString(),
      session_id: `fixup-session-${randomUUID()}`,
      prompt,
      prompt_hash: hash,
      cwd: "/Users/test/Projects/test-project",
      ...overrides,
    };

    writeFileSync(join(EVENTS_DIR, `${event.id}.json`), JSON.stringify(event));
    return { event, hash };
  }

  function getRow(hash: string) {
    return db.prepare("SELECT * FROM prompts WHERE prompt_hash = ?").get(hash) as Record<string, unknown> | undefined;
  }

  it("3-prompt chain: each gets correct measured gap", async () => {
    const sessionId = `chain-${randomUUID()}`;
    const now = Date.now();
    const { processEvents } = await import("@/lib/ingestion/processor");

    // Prompt 1 at T+0
    const { hash: h1 } = writeEvent({ session_id: sessionId, timestamp: new Date(now).toISOString() });
    processEvents();

    // Prompt 2 at T+5min
    const { hash: h2 } = writeEvent({ session_id: sessionId, timestamp: new Date(now + 300_000).toISOString() });
    processEvents();

    // Prompt 3 at T+8min
    const { hash: h3 } = writeEvent({ session_id: sessionId, timestamp: new Date(now + 480_000).toISOString() });
    processEvents();

    const r1 = getRow(h1);
    const r2 = getRow(h2);
    const r3 = getRow(h3);

    // P1 → P2: 5 min gap (measured)
    expect(r1!.attribution_method).toBe("measured");
    expect(r1!.attributed_minutes).toBeCloseTo(5, 0);

    // P2 → P3: 3 min gap (measured)
    expect(r2!.attribution_method).toBe("measured");
    expect(r2!.attributed_minutes).toBeCloseTo(3, 0);

    // P3: last, still pending
    expect(r3!.attribution_method).toBe("pending");
    expect(r3!.attributed_minutes).toBe(0);
  });

  it("session boundary: 31-min gap → measured with unexplained quality", async () => {
    const sessionId = `boundary-${randomUUID()}`;
    const now = Date.now();
    const { processEvents } = await import("@/lib/ingestion/processor");

    const { hash: h1 } = writeEvent({ session_id: sessionId, timestamp: new Date(now).toISOString() });
    processEvents();

    // 31 min later — same session, but big gap
    const { hash: h2 } = writeEvent({ session_id: sessionId, timestamp: new Date(now + 31 * 60_000).toISOString() });
    processEvents();

    const r1 = getRow(h1);
    expect(r1!.attribution_method).toBe("measured");
    expect(r1!.attributed_minutes).toBeCloseTo(31, 0);
    // > 15 min → "unexplained"
    expect(r1!.time_confidence).toBe("unexplained");
  });

  it("cross-session: prompt in session B does NOT fix up session A", async () => {
    const sessionA = `session-A-${randomUUID()}`;
    const sessionB = `session-B-${randomUUID()}`;
    const now = Date.now();
    const { processEvents } = await import("@/lib/ingestion/processor");

    // Session A prompt
    const { hash: hA } = writeEvent({ session_id: sessionA, timestamp: new Date(now).toISOString() });
    processEvents();
    expect(getRow(hA)!.attribution_method).toBe("pending");

    // Session B prompt (different session)
    writeEvent({ session_id: sessionB, timestamp: new Date(now + 120_000).toISOString() });
    processEvents();

    // Session A prompt should still be pending — not fixed up by session B
    expect(getRow(hA)!.attribution_method).toBe("pending");
    expect(getRow(hA)!.attributed_minutes).toBe(0);
  });

  it("zero-gap: identical timestamps → 0 minutes measured", async () => {
    const sessionId = `zero-${randomUUID()}`;
    const ts = new Date().toISOString();
    const { processEvents } = await import("@/lib/ingestion/processor");

    const { hash: h1 } = writeEvent({ session_id: sessionId, timestamp: ts });
    processEvents();

    const { hash: h2 } = writeEvent({ session_id: sessionId, timestamp: ts });
    processEvents();

    const r1 = getRow(h1);
    expect(r1!.attribution_method).toBe("measured");
    expect(r1!.attributed_minutes).toBe(0);
    expect(r1!.gap_to_next_seconds).toBe(0);
  });

  it("rapid burst: 5 prompts within 60s, each gap correct", async () => {
    const sessionId = `burst-${randomUUID()}`;
    const now = Date.now();
    const { processEvents } = await import("@/lib/ingestion/processor");
    const hashes: string[] = [];

    for (let i = 0; i < 5; i++) {
      const { hash } = writeEvent({
        session_id: sessionId,
        timestamp: new Date(now + i * 12_000).toISOString(), // 12s apart
      });
      hashes.push(hash);
      processEvents();
    }

    // First 4 should be measured with ~12s = 0.2 min gaps
    for (let i = 0; i < 4; i++) {
      const row = getRow(hashes[i]);
      expect(row!.attribution_method).toBe("measured");
      expect(row!.gap_to_next_seconds).toBeCloseTo(12, 0);
    }

    // Last should be pending
    expect(getRow(hashes[4])!.attribution_method).toBe("pending");
  });

  it("sum accuracy: attributed_minutes across session ≈ wall clock", async () => {
    const sessionId = `sum-${randomUUID()}`;
    const now = Date.now();
    const { processEvents } = await import("@/lib/ingestion/processor");
    const hashes: string[] = [];
    const totalWallMs = 600_000; // 10 min total

    // 4 prompts spread across 10 minutes
    const offsets = [0, 120_000, 480_000, totalWallMs]; // 0, 2, 8, 10 min
    for (const offset of offsets) {
      const { hash } = writeEvent({
        session_id: sessionId,
        timestamp: new Date(now + offset).toISOString(),
      });
      hashes.push(hash);
      processEvents();
    }

    // Sum of measured minutes (excluding last pending)
    let totalMeasured = 0;
    for (let i = 0; i < hashes.length - 1; i++) {
      const row = getRow(hashes[i]);
      totalMeasured += row!.attributed_minutes as number;
    }

    // Should approximate 10 minutes of wall clock
    expect(totalMeasured).toBeCloseTo(totalWallMs / 60_000, 0);
  });

  it("interleaved sessions: fix-up stays within same session_id", async () => {
    const sessionX = `interleave-X-${randomUUID()}`;
    const sessionY = `interleave-Y-${randomUUID()}`;
    const now = Date.now();
    const { processEvents } = await import("@/lib/ingestion/processor");

    // X1 at T+0
    const { hash: hX1 } = writeEvent({ session_id: sessionX, timestamp: new Date(now).toISOString() });
    processEvents();

    // Y1 at T+1min (different session)
    const { hash: hY1 } = writeEvent({ session_id: sessionY, timestamp: new Date(now + 60_000).toISOString() });
    processEvents();

    // X2 at T+5min — should fix up X1 (5 min gap), not Y1
    const { hash: hX2 } = writeEvent({ session_id: sessionX, timestamp: new Date(now + 300_000).toISOString() });
    processEvents();

    // Y2 at T+3min — should fix up Y1 (2 min gap), not X1
    const { hash: hY2 } = writeEvent({ session_id: sessionY, timestamp: new Date(now + 180_000).toISOString() });
    processEvents();

    const rX1 = getRow(hX1);
    const rY1 = getRow(hY1);

    expect(rX1!.attribution_method).toBe("measured");
    expect(rX1!.attributed_minutes).toBeCloseTo(5, 0);

    expect(rY1!.attribution_method).toBe("measured");
    expect(rY1!.attributed_minutes).toBeCloseTo(2, 0);

    // Both X2 and Y2 are last in their session → pending
    expect(getRow(hX2)!.attribution_method).toBe("pending");
    expect(getRow(hY2)!.attribution_method).toBe("pending");
  });
});
