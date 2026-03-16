import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const mockClassifyWithLLM = vi.fn().mockResolvedValue({
  primary_category: "development",
  primary_subcategory: "coding",
  primary_confidence: 0.9,
  reasoning: "mock reasoning",
});

vi.mock("@/lib/classification/llm-classifier", () => ({
  classifyWithLLM: mockClassifyWithLLM,
}));

describe("captureMultiSourceTrainingItems", () => {
  let db: ReturnType<Awaited<ReturnType<typeof import("@/lib/db")>>["getDb"]>;

  beforeAll(async () => {
    const { initDb, getDb } = await import("@/lib/db");
    await initDb();
    db = getDb();
  });

  beforeEach(() => {
    mockClassifyWithLLM.mockClear();
    // Clean state before each test — order matters for FK constraints
    db.prepare("DELETE FROM training_items").run();
    db.prepare("DELETE FROM training_examples").run();
    db.prepare("DELETE FROM training_batches").run();
    db.prepare("DELETE FROM window_events WHERE external_id LIKE 'test-tc-win-%'").run();
    db.prepare("DELETE FROM browser_events WHERE external_id LIKE 'test-tc-%'").run();
    db.prepare("DELETE FROM calendar_events WHERE summary LIKE 'Test Meeting%'").run();
  });

  function insertBatch(status: string, target_count: number): number {
    const r = db.prepare(
      "INSERT INTO training_batches (status, target_count, classification_mode) VALUES (?, ?, 'llm')"
    ).run(status, target_count);
    return r.lastInsertRowid as number;
  }

  function insertWindowEvent(appName: string, windowTitle: string | null = null): number {
    const extId = `test-tc-win-${Math.random().toString(36).slice(2)}`;
    const r = db.prepare(
      "INSERT INTO window_events (external_id, app_name, window_title, start_time, duration_minutes, primary_category, primary_subcategory, primary_confidence) VALUES (?, ?, ?, datetime('now'), 1.0, 'productivity', 'admin', 0.7)"
    ).run(extId, appName, windowTitle);
    return r.lastInsertRowid as number;
  }

  function insertBrowserEvent(domain: string, pageTitle: string | null = null): number {
    const id = `test-tc-${Math.random().toString(36).slice(2)}`;
    const r = db.prepare(
      "INSERT INTO browser_events (external_id, browser, domain, url, page_title, start_time, duration_minutes, primary_category, primary_subcategory, primary_confidence) VALUES (?, 'Chrome', ?, ?, ?, datetime('now'), 1.0, 'development', 'coding', 0.8)"
    ).run(id, domain, `https://${domain}`, pageTitle);
    return r.lastInsertRowid as number;
  }

  function insertCalendarEvent(summary: string): number {
    const r = db.prepare(
      "INSERT INTO calendar_events (uid, summary, start_time, end_time, duration_minutes, primary_category, primary_subcategory, primary_confidence) VALUES (?, ?, datetime('now'), datetime('now', '+1 hour'), 60, 'communication', 'meetings', 0.9)"
    ).run(`uid-${Math.random()}`, summary);
    return r.lastInsertRowid as number;
  }

  it("returns early when no collecting batch exists", async () => {
    insertBatch("reviewing", 10);

    const { captureMultiSourceTrainingItems } = await import("@/lib/ingestion/training-collector");
    await captureMultiSourceTrainingItems();

    expect(mockClassifyWithLLM).not.toHaveBeenCalled();
  });

  it("returns early when batch is already full", async () => {
    const batchId = insertBatch("collecting", 2);
    const win1 = insertWindowEvent("Test-Window1");
    const win2 = insertWindowEvent("Test-Window2");
    db.prepare(
      "INSERT INTO training_items (batch_id, source, source_id, llm_category, llm_subcategory, llm_confidence) VALUES (?, 'window', ?, 'development', 'coding', 0.9)"
    ).run(batchId, win1);
    db.prepare(
      "INSERT INTO training_items (batch_id, source, source_id, llm_category, llm_subcategory, llm_confidence) VALUES (?, 'window', ?, 'development', 'coding', 0.9)"
    ).run(batchId, win2);

    const { captureMultiSourceTrainingItems } = await import("@/lib/ingestion/training-collector");
    await captureMultiSourceTrainingItems();

    expect(mockClassifyWithLLM).not.toHaveBeenCalled();
  });

  it("captures window events with correct display_text format", async () => {
    const batchId = insertBatch("collecting", 5);
    const winId = insertWindowEvent("Test-VSCode", "my-project — README.md");

    const { captureMultiSourceTrainingItems } = await import("@/lib/ingestion/training-collector");
    await captureMultiSourceTrainingItems();

    expect(mockClassifyWithLLM).toHaveBeenCalledWith("Test-VSCode: my-project — README.md");

    const item = db.prepare(
      "SELECT * FROM training_items WHERE batch_id = ? AND source = 'window' AND source_id = ?"
    ).get(batchId, winId) as Record<string, unknown> | undefined;
    expect(item).toBeDefined();
    expect(item!.llm_category).toBe("development");
  });

  it("captures window events with app_name only when no title", async () => {
    const batchId = insertBatch("collecting", 5);
    insertWindowEvent("Test-Finder");

    const { captureMultiSourceTrainingItems } = await import("@/lib/ingestion/training-collector");
    await captureMultiSourceTrainingItems();

    expect(mockClassifyWithLLM).toHaveBeenCalledWith("Test-Finder");

    const items = db.prepare("SELECT * FROM training_items WHERE batch_id = ?").all(batchId);
    expect(items.length).toBe(1);
  });

  it("captures browser events with Title (domain) display_text", async () => {
    const batchId = insertBatch("collecting", 5);
    const browserId = insertBrowserEvent("github.com", "My Repo");

    const { captureMultiSourceTrainingItems } = await import("@/lib/ingestion/training-collector");
    await captureMultiSourceTrainingItems();

    expect(mockClassifyWithLLM).toHaveBeenCalledWith("My Repo (github.com)");

    const item = db.prepare(
      "SELECT * FROM training_items WHERE batch_id = ? AND source = 'browser' AND source_id = ?"
    ).get(batchId, browserId) as Record<string, unknown> | undefined;
    expect(item).toBeDefined();
  });

  it("captures browser events with domain only when no title", async () => {
    insertBatch("collecting", 5);
    insertBrowserEvent("example.com", null);

    const { captureMultiSourceTrainingItems } = await import("@/lib/ingestion/training-collector");
    await captureMultiSourceTrainingItems();

    expect(mockClassifyWithLLM).toHaveBeenCalledWith("example.com");
  });

  it("captures calendar events with summary as display_text", async () => {
    const batchId = insertBatch("collecting", 5);
    const calId = insertCalendarEvent("Test Meeting: Q3 Planning");

    const { captureMultiSourceTrainingItems } = await import("@/lib/ingestion/training-collector");
    await captureMultiSourceTrainingItems();

    expect(mockClassifyWithLLM).toHaveBeenCalledWith("Test Meeting: Q3 Planning");

    const item = db.prepare(
      "SELECT * FROM training_items WHERE batch_id = ? AND source = 'calendar' AND source_id = ?"
    ).get(batchId, calId) as Record<string, unknown> | undefined;
    expect(item).toBeDefined();
  });

  it("skips events already captured in the batch (INSERT OR IGNORE)", async () => {
    const batchId = insertBatch("collecting", 10);
    const winId = insertWindowEvent("Test-AlreadyCaptured");

    db.prepare(
      "INSERT INTO training_items (batch_id, source, source_id, llm_category, llm_subcategory, llm_confidence) VALUES (?, 'window', ?, 'productivity', 'admin', 0.7)"
    ).run(batchId, winId);

    const { captureMultiSourceTrainingItems } = await import("@/lib/ingestion/training-collector");
    await captureMultiSourceTrainingItems();

    // LLM should not have been called since the only event is already captured
    expect(mockClassifyWithLLM).not.toHaveBeenCalled();

    const rows = db.prepare(
      "SELECT * FROM training_items WHERE batch_id = ? AND source = 'window' AND source_id = ?"
    ).all(batchId, winId);
    expect(rows.length).toBe(1);
  });

  it("advances batch to reviewing when target_count reached", async () => {
    const batchId = insertBatch("collecting", 1);
    insertWindowEvent("Test-TriggerReview");

    const { captureMultiSourceTrainingItems } = await import("@/lib/ingestion/training-collector");
    await captureMultiSourceTrainingItems();

    const batch = db.prepare("SELECT status FROM training_batches WHERE id = ?").get(batchId) as { status: string };
    expect(batch.status).toBe("reviewing");
  });

  it("gracefully handles classifyWithLLM rejection", async () => {
    mockClassifyWithLLM.mockRejectedValueOnce(new Error("LLM unavailable"));

    const batchId = insertBatch("collecting", 5);
    insertWindowEvent("Test-LLMFail");

    const { captureMultiSourceTrainingItems } = await import("@/lib/ingestion/training-collector");
    await expect(captureMultiSourceTrainingItems()).resolves.toBeUndefined();

    const items = db.prepare("SELECT * FROM training_items WHERE batch_id = ?").all(batchId);
    expect(items.length).toBe(0);
  });

  it("returns when no uncaptured events exist", async () => {
    insertBatch("collecting", 10);

    const { captureMultiSourceTrainingItems } = await import("@/lib/ingestion/training-collector");
    await captureMultiSourceTrainingItems();

    expect(mockClassifyWithLLM).not.toHaveBeenCalled();
  });
});
