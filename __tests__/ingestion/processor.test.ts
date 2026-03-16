import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID, createHash } from "crypto";
import { EVENTS_DIR } from "@/lib/db";

describe("Processor", () => {
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
    // Clean up test data
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
    const prompt = overrides.prompt as string || `test prompt ${randomUUID()}`;
    const hash = createHash("sha256").update(prompt).digest("hex");
    testHashes.push(hash);

    const event = {
      id: randomUUID(),
      type: "prompt",
      timestamp: new Date().toISOString(),
      session_id: `test-session-${randomUUID()}`,
      prompt,
      prompt_hash: hash,
      cwd: "/Users/test/Projects/test-project",
      ...overrides,
    };

    writeFileSync(join(EVENTS_DIR, `${event.id}.json`), JSON.stringify(event));
    return { event, hash };
  }

  it("detects duplicate prompts by hash", async () => {
    const prompt = `duplicate-test-${randomUUID()}`;
    const hash = createHash("sha256").update(prompt).digest("hex");
    testHashes.push(hash);

    // Write two events with same prompt hash
    const id1 = randomUUID();
    const id2 = randomUUID();
    const base = {
      type: "prompt",
      timestamp: new Date().toISOString(),
      session_id: `test-session-${randomUUID()}`,
      prompt,
      prompt_hash: hash,
      cwd: "/Users/test/Projects/test-project",
    };

    writeFileSync(join(EVENTS_DIR, `${id1}.json`), JSON.stringify({ ...base, id: id1 }));
    writeFileSync(join(EVENTS_DIR, `${id2}.json`), JSON.stringify({ ...base, id: id2 }));

    const { processEvents } = await import("@/lib/ingestion/processor");
    processEvents();

    const rows = db.prepare("SELECT * FROM prompts WHERE prompt_hash = ?").all(hash);
    expect(rows.length).toBe(1);
  });

  it("performs retroactive fix-up on previous prompt in same session", async () => {
    const sessionId = `retro-test-${randomUUID()}`;
    const now = new Date();

    // First prompt
    const { hash: hash1 } = writeEvent({
      session_id: sessionId,
      timestamp: new Date(now.getTime() - 600_000).toISOString(), // 10 min ago
    });

    const { processEvents } = await import("@/lib/ingestion/processor");
    processEvents();

    // Verify first prompt is "pending" (last in session, no forward signal)
    const row1Before = db.prepare("SELECT * FROM prompts WHERE prompt_hash = ?").get(hash1) as Record<string, unknown>;
    expect(row1Before.attribution_method).toBe("pending");

    // Second prompt in same session
    const { hash: hash2 } = writeEvent({
      session_id: sessionId,
      timestamp: now.toISOString(),
    });
    processEvents();

    // First prompt should now have retroactive attribution (measured gap)
    const row1After = db.prepare("SELECT * FROM prompts WHERE prompt_hash = ?").get(hash1) as Record<string, unknown>;
    expect(row1After.gap_to_next_seconds).toBeGreaterThan(0);
    expect(row1After.attribution_method).toBe("measured");

    // Second prompt should be "pending" (now last)
    const row2 = db.prepare("SELECT * FROM prompts WHERE prompt_hash = ?").get(hash2) as Record<string, unknown>;
    expect(row2.attribution_method).toBe("pending");
  });

  it("processes events without errors for valid input", async () => {
    writeEvent();

    const { processEvents } = await import("@/lib/ingestion/processor");
    const result = processEvents();

    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);
  });

  it("derives project name from cwd", async () => {
    const { hash } = writeEvent({
      cwd: "/Users/test/Projects/my-app/packages/core",
    });

    const { processEvents } = await import("@/lib/ingestion/processor");
    processEvents();

    const row = db.prepare("SELECT project_name FROM prompts WHERE prompt_hash = ?").get(hash) as { project_name: string };
    expect(row.project_name).toBe("my-app");
  });

  it("handles concurrent events in different sessions", async () => {
    const now = new Date();
    const session1 = `concurrent-1-${randomUUID()}`;
    const session2 = `concurrent-2-${randomUUID()}`;

    writeEvent({ session_id: session1, timestamp: now.toISOString() });
    writeEvent({ session_id: session2, timestamp: now.toISOString() });

    const { processEvents } = await import("@/lib/ingestion/processor");
    const result = processEvents();

    expect(result.errors).toBe(0);
    expect(result.processed).toBeGreaterThanOrEqual(2);
  });
});
