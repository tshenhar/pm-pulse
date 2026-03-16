import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { randomUUID, createHash } from "crypto";
import { EVENTS_DIR } from "@/lib/db";

describe("E2E smoke test", () => {
  const promptText = "Help me prioritize these features for Q3 using RICE scoring";
  const promptHash = createHash("sha256").update(promptText).digest("hex");
  const eventId = `test-${randomUUID()}`;
  const stopEventId = `test-stop-${randomUUID()}`;
  const sessionId = `test-session-${randomUUID()}`;
  const promptTimestamp = new Date().toISOString();

  afterAll(async () => {
    // Clean up test data from DB and test events directory
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    db.prepare("DELETE FROM prompts WHERE prompt_hash = ?").run(promptHash);
    try { rmSync(join(EVENTS_DIR, `${eventId}.json`), { force: true }); } catch {}
    try { rmSync(join(EVENTS_DIR, `${stopEventId}.json`), { force: true }); } catch {}
  });

  it("processes a prompt event through the full pipeline", async () => {
    // 1. Ensure events directory exists
    mkdirSync(EVENTS_DIR, { recursive: true });

    // 2. Write a mock prompt event
    const event = {
      id: eventId,
      type: "prompt",
      timestamp: promptTimestamp,
      session_id: sessionId,
      prompt: promptText,
      prompt_hash: promptHash,
      cwd: "/Users/test/Projects/pm-pulse",
    };

    writeFileSync(join(EVENTS_DIR, `${eventId}.json`), JSON.stringify(event));

    // 3. Initialize DB and process events
    const { initDb } = await import("@/lib/db");
    await initDb();

    const { processEvents } = await import("@/lib/ingestion/processor");
    const result = processEvents();

    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);

    // 3b. Write a stop event to trigger direct attribution
    const stopEvent = {
      id: stopEventId,
      type: "stop",
      timestamp: new Date(new Date(promptTimestamp).getTime() + 5000).toISOString(),
      session_id: sessionId,
      cwd: event.cwd,
    };
    writeFileSync(join(EVENTS_DIR, `${stopEventId}.json`), JSON.stringify(stopEvent));
    processEvents(); // process stop event → updates prompt with direct method

    // 4. Verify prompt was inserted
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM prompts WHERE prompt_hash = ?")
      .get(promptHash) as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row!.prompt_text).toBe(promptText);

    // 5. Verify classification
    expect(row!.primary_category).toBe("strategy");
    expect(row!.primary_subcategory).toBeTruthy();
    expect(row!.primary_confidence).toBeGreaterThan(0);
    expect(row!.classification_method).toBe("rules");

    // 6. Verify time attribution (direct method via stop event)
    expect(row!.attributed_minutes).toBeGreaterThan(0);
    expect(row!.attribution_method).toBe("direct");
    expect(row!.time_confidence).toBeTruthy();

    // 7. Verify project name derived
    expect(row!.project_name).toBe("pm-pulse");
  });
});
