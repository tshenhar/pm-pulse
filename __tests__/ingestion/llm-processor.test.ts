import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";

// Mock the LLM classifier before importing the processor
vi.mock("@/lib/classification/llm-classifier", () => ({
  classifyWithLLM: vi.fn(),
}));

describe("LLM Processor", () => {
  let db: ReturnType<Awaited<ReturnType<typeof import("@/lib/db")>>["getDb"]>;
  const testHashes: string[] = [];

  beforeAll(async () => {
    const { initDb, getDb } = await import("@/lib/db");
    await initDb();
    db = getDb();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear any pending LLM flags left by other test suites sharing the test DB
    db.prepare("UPDATE prompts SET pending_llm_classification = 0 WHERE pending_llm_classification = 1").run();
  });

  afterEach(() => {
    for (const hash of testHashes) {
      db.prepare("DELETE FROM prompts WHERE prompt_hash = ?").run(hash);
    }
    testHashes.length = 0;
  });

  function insertPendingPrompt(overrides: Record<string, unknown> = {}) {
    const hash = `llm-test-${randomUUID()}`;
    testHashes.push(hash);
    db.prepare(`
      INSERT INTO prompts (
        external_id, session_id, timestamp, prompt_text, prompt_preview, prompt_hash,
        cwd, project_name,
        primary_category, primary_subcategory, primary_confidence,
        classification_method, pending_llm_classification,
        attributed_minutes, attribution_method, time_confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      `session-${randomUUID()}`,
      new Date().toISOString(),
      "prompt_text" in overrides ? overrides.prompt_text : "Test prompt for LLM classification",
      "Test prompt...",
      hash,
      "/tmp/test",
      "test-project",
      "productivity",
      "admin",
      0.3,
      "rules",
      1, // pending_llm_classification = true
      0,
      "pending",
      "pending",
    );
    const row = db.prepare("SELECT id FROM prompts WHERE prompt_hash = ?").get(hash) as { id: number };
    return { hash, id: row.id };
  }

  it("limits batch to 10 prompts", async () => {
    const { classifyWithLLM } = await import("@/lib/classification/llm-classifier");
    const mockClassify = vi.mocked(classifyWithLLM);
    mockClassify.mockResolvedValue({
      primary_category: "development",
      primary_subcategory: "coding",
      primary_confidence: 0.9,
      method: "llm",
      reasoning: "test",
    });

    // Insert 12 pending prompts
    for (let i = 0; i < 12; i++) {
      insertPendingPrompt();
    }

    const { classifyPendingWithLLM } = await import("@/lib/ingestion/llm-processor");
    await classifyPendingWithLLM();

    // Should only process 10 (BATCH_SIZE)
    expect(mockClassify).toHaveBeenCalledTimes(10);
  });

  it("updates classification and clears pending flag on success", async () => {
    const { classifyWithLLM } = await import("@/lib/classification/llm-classifier");
    const mockClassify = vi.mocked(classifyWithLLM);
    mockClassify.mockResolvedValue({
      primary_category: "strategy",
      primary_subcategory: "roadmap",
      primary_confidence: 0.85,
      method: "llm",
      reasoning: "LLM classified as strategy",
    });

    const { hash } = insertPendingPrompt();

    const { classifyPendingWithLLM } = await import("@/lib/ingestion/llm-processor");
    await classifyPendingWithLLM();

    const row = db.prepare("SELECT * FROM prompts WHERE prompt_hash = ?").get(hash) as Record<string, unknown>;
    expect(row.primary_category).toBe("strategy");
    expect(row.primary_subcategory).toBe("roadmap");
    expect(row.classification_method).toBe("llm");
    expect(row.pending_llm_classification).toBe(0);
  });

  it("clears pending flag on API failure", async () => {
    const { classifyWithLLM } = await import("@/lib/classification/llm-classifier");
    const mockClassify = vi.mocked(classifyWithLLM);
    mockClassify.mockRejectedValue(new Error("API timeout"));

    const { hash } = insertPendingPrompt();

    const { classifyPendingWithLLM } = await import("@/lib/ingestion/llm-processor");
    await classifyPendingWithLLM();

    const row = db.prepare("SELECT * FROM prompts WHERE prompt_hash = ?").get(hash) as Record<string, unknown>;
    // Flag should be cleared even on failure (to avoid infinite retry)
    expect(row.pending_llm_classification).toBe(0);
    // Original classification preserved
    expect(row.primary_category).toBe("productivity");
  });

  it("handles mixed success/failure via Promise.allSettled", async () => {
    const { classifyWithLLM } = await import("@/lib/classification/llm-classifier");
    const mockClassify = vi.mocked(classifyWithLLM);

    let callCount = 0;
    mockClassify.mockImplementation(async () => {
      callCount++;
      if (callCount % 2 === 0) throw new Error("fail");
      return {
        primary_category: "analytics",
        primary_subcategory: "data",
        primary_confidence: 0.8,
        method: "llm" as const,
        reasoning: "test",
      };
    });

    const hashes: string[] = [];
    for (let i = 0; i < 4; i++) {
      hashes.push(insertPendingPrompt().hash);
    }

    const { classifyPendingWithLLM } = await import("@/lib/ingestion/llm-processor");
    // Should not throw — uses allSettled
    await classifyPendingWithLLM();

    // All should have pending flag cleared
    for (const hash of hashes) {
      const row = db.prepare("SELECT pending_llm_classification FROM prompts WHERE prompt_hash = ?").get(hash) as Record<string, unknown>;
      expect(row.pending_llm_classification).toBe(0);
    }
  });

  it("returns early when no pending prompts", async () => {
    const { classifyWithLLM } = await import("@/lib/classification/llm-classifier");
    const mockClassify = vi.mocked(classifyWithLLM);

    const { classifyPendingWithLLM } = await import("@/lib/ingestion/llm-processor");
    await classifyPendingWithLLM();

    expect(mockClassify).not.toHaveBeenCalled();
  });

  it("handles null prompt_text by clearing flag without calling LLM", async () => {
    const { classifyWithLLM } = await import("@/lib/classification/llm-classifier");
    const mockClassify = vi.mocked(classifyWithLLM);

    const { hash } = insertPendingPrompt({ prompt_text: null });

    const { classifyPendingWithLLM } = await import("@/lib/ingestion/llm-processor");
    await classifyPendingWithLLM();

    // LLM should not be called for null prompt_text
    expect(mockClassify).not.toHaveBeenCalled();

    const row = db.prepare("SELECT pending_llm_classification FROM prompts WHERE prompt_hash = ?").get(hash) as Record<string, unknown>;
    expect(row.pending_llm_classification).toBe(0);
  });
});
