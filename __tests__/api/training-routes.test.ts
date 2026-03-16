import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createHash, randomUUID } from "crypto";

describe("Training API Routes", () => {
  let db: ReturnType<Awaited<ReturnType<typeof import("@/lib/db")>>["getDb"]>;

  beforeAll(async () => {
    const { initDb, getDb } = await import("@/lib/db");
    await initDb();
    db = getDb();
  });

  beforeEach(() => {
    // FK-safe delete order: children before parents
    db.prepare("DELETE FROM training_items").run();
    db.prepare("DELETE FROM training_examples").run();
    db.prepare("DELETE FROM training_batches").run();
    db.prepare("DELETE FROM settings WHERE key = 'classification_mode_before_training'").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('classification_mode', '\"rules\"') ON CONFLICT(key) DO UPDATE SET value = '\"rules\"'").run();
  });

  function insertTestPrompt(category = "strategy", subcategory = "roadmap"): number {
    const prompt = `test prompt ${randomUUID()}`;
    const hash = createHash("sha256").update(prompt).digest("hex");
    const r = db.prepare(
      `INSERT INTO prompts (external_id, session_id, timestamp, prompt_text, prompt_preview, prompt_hash,
        cwd, project_name, primary_category, primary_subcategory, primary_confidence,
        classification_method, attributed_minutes, attribution_method, time_confidence)
       VALUES (?, ?, datetime('now'), ?, ?, ?, '/', 'test', ?, ?, 0.9, 'rules', 5, 'measured', 'HIGH')`
    ).run(randomUUID(), randomUUID(), prompt, prompt.slice(0, 50), hash, category, subcategory);
    return r.lastInsertRowid as number;
  }

  function createBatch(status: string, target_count = 5): number {
    const r = db.prepare(
      "INSERT INTO training_batches (status, target_count, classification_mode) VALUES (?, ?, 'llm')"
    ).run(status, target_count);
    return r.lastInsertRowid as number;
  }

  function addItem(
    batchId: number,
    source: string,
    sourceId: number,
    opts: { human_category?: string; human_subcategory?: string; human_approved?: number } = {}
  ): number {
    const r = db.prepare(
      `INSERT INTO training_items (batch_id, source, source_id, prompt_id, llm_category, llm_subcategory, llm_confidence,
         human_category, human_subcategory, human_approved)
       VALUES (?, ?, ?, ?, 'development', 'coding', 0.9, ?, ?, ?)`
    ).run(
      batchId,
      source,
      sourceId,
      source === "prompt" ? sourceId : null,
      opts.human_category ?? null,
      opts.human_subcategory ?? null,
      opts.human_approved ?? 0
    );
    return r.lastInsertRowid as number;
  }

  // ===== POST /api/training/start =====
  describe("POST /api/training/start", () => {
    it("creates a batch with status collecting and correct target_count", async () => {
      const { POST } = await import("@/app/api/training/start/route");
      const req = new Request("http://localhost/api/training/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_count: 50 }),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const body = await res.json() as { batch: Record<string, unknown> };
      expect(body.batch.status).toBe("collecting");
      expect(body.batch.target_count).toBe(50);
    });

    it("returns 409 if a batch is already collecting", async () => {
      createBatch("collecting");

      const { POST } = await import("@/app/api/training/start/route");
      const req = new Request("http://localhost/api/training/start", {
        method: "POST",
        body: "{}",
      });
      const res = await POST(req);
      expect(res.status).toBe(409);
    });

    it("returns 409 if a batch is already reviewing", async () => {
      createBatch("reviewing");

      const { POST } = await import("@/app/api/training/start/route");
      const req = new Request("http://localhost/api/training/start", {
        method: "POST",
        body: "{}",
      });
      const res = await POST(req);
      expect(res.status).toBe(409);
    });

    it("switches classification_mode to llm", async () => {
      const { POST } = await import("@/app/api/training/start/route");
      const req = new Request("http://localhost/api/training/start", {
        method: "POST",
        body: "{}",
      });
      await POST(req);

      const row = db.prepare("SELECT value FROM settings WHERE key = 'classification_mode'").get() as { value: string };
      expect(JSON.parse(row.value)).toBe("llm");
    });

    it("uses default target_count of 100 when not provided", async () => {
      const { POST } = await import("@/app/api/training/start/route");
      const req = new Request("http://localhost/api/training/start", {
        method: "POST",
        body: "{}",
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
      const body = await res.json() as { batch: Record<string, unknown> };
      expect(body.batch.target_count).toBe(100);
    });
  });

  // ===== GET /api/training/batch/[id] =====
  describe("GET /api/training/batch/[id]", () => {
    it("returns batch with collected_count", async () => {
      const batchId = createBatch("collecting", 10);
      const promptId = insertTestPrompt();
      addItem(batchId, "prompt", promptId);

      const { GET } = await import("@/app/api/training/batch/[id]/route");
      const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: String(batchId) }) });
      expect(res.status).toBe(200);
      const body = await res.json() as { batch: Record<string, unknown>; items: unknown[] };
      expect(body.batch.id).toBe(batchId);
      expect(body.batch.collected_count).toBe(1);
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBe(1);
    });

    it("returns 404 for non-existent batch id", async () => {
      const { GET } = await import("@/app/api/training/batch/[id]/route");
      const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "999999" }) });
      expect(res.status).toBe(404);
    });

    it("returns 400 for non-numeric batch id", async () => {
      const { GET } = await import("@/app/api/training/batch/[id]/route");
      const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "abc" }) });
      expect(res.status).toBe(400);
    });

    it("items include source and source_id fields", async () => {
      const batchId = createBatch("reviewing", 5);
      const promptId = insertTestPrompt();
      addItem(batchId, "prompt", promptId);

      const { GET } = await import("@/app/api/training/batch/[id]/route");
      const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: String(batchId) }) });
      const body = await res.json() as { items: Array<Record<string, unknown>> };
      const item = body.items[0];
      expect(item.source).toBe("prompt");
      expect(item.source_id).toBe(promptId);
    });
  });

  // ===== POST /api/training/batch/[id]/apply =====
  describe("POST /api/training/batch/[id]/apply", () => {
    it("returns 409 if batch is not in reviewing status", async () => {
      const batchId = createBatch("collecting");

      const { POST } = await import("@/app/api/training/batch/[id]/apply/route");
      const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: String(batchId) }) });
      expect(res.status).toBe(409);
    });

    it("returns 404 for non-existent batch", async () => {
      const { POST } = await import("@/app/api/training/batch/[id]/apply/route");
      const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: "999999" }) });
      expect(res.status).toBe(404);
    });

    it("applies corrections to prompts table for source=prompt items", async () => {
      const batchId = createBatch("reviewing", 5);
      const promptId = insertTestPrompt("strategy", "roadmap");
      addItem(batchId, "prompt", promptId, { human_category: "development", human_subcategory: "coding" });

      const { POST } = await import("@/app/api/training/batch/[id]/apply/route");
      const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: String(batchId) }) });
      expect(res.status).toBe(200);

      const row = db.prepare("SELECT primary_category, primary_subcategory FROM prompts WHERE id = ?").get(promptId) as Record<string, unknown>;
      expect(row.primary_category).toBe("development");
      expect(row.primary_subcategory).toBe("coding");
    });

    it("inserts training_examples only for corrected items (not approved)", async () => {
      const batchId = createBatch("reviewing", 5);
      const approvedId = insertTestPrompt("strategy", "roadmap");
      const correctedId = insertTestPrompt("strategy", "okr");
      addItem(batchId, "prompt", approvedId, { human_approved: 1 });
      addItem(batchId, "prompt", correctedId, { human_category: "writing", human_subcategory: "general" });

      const { POST } = await import("@/app/api/training/batch/[id]/apply/route");
      await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: String(batchId) }) });

      const examples = db.prepare("SELECT * FROM training_examples WHERE source_batch_id = ?").all(batchId);
      expect(examples.length).toBe(1);
    });

    it("restores previous classification_mode after apply", async () => {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('classification_mode_before_training', '\"hybrid\"') ON CONFLICT(key) DO UPDATE SET value = '\"hybrid\"'"
      ).run();

      const batchId = createBatch("reviewing", 5);

      const { POST } = await import("@/app/api/training/batch/[id]/apply/route");
      const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: String(batchId) }) });
      expect(res.status).toBe(200);

      const body = await res.json() as Record<string, unknown>;
      expect(body.classification_mode_restored).toBe("hybrid");
    });

    it("marks batch as applied", async () => {
      const batchId = createBatch("reviewing", 5);

      const { POST } = await import("@/app/api/training/batch/[id]/apply/route");
      await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: String(batchId) }) });

      const batch = db.prepare("SELECT status FROM training_batches WHERE id = ?").get(batchId) as { status: string };
      expect(batch.status).toBe("applied");
    });
  });

  // ===== POST /api/training/batch/[id]/cancel =====
  describe("POST /api/training/batch/[id]/cancel", () => {
    it("sets status to cancelled", async () => {
      const batchId = createBatch("collecting");

      const { POST } = await import("@/app/api/training/batch/[id]/cancel/route");
      const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: String(batchId) }) });
      expect(res.status).toBe(200);

      const batch = db.prepare("SELECT status FROM training_batches WHERE id = ?").get(batchId) as { status: string };
      expect(batch.status).toBe("cancelled");
    });

    it("cancels a reviewing batch", async () => {
      const batchId = createBatch("reviewing");

      const { POST } = await import("@/app/api/training/batch/[id]/cancel/route");
      const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: String(batchId) }) });
      expect(res.status).toBe(200);

      const batch = db.prepare("SELECT status FROM training_batches WHERE id = ?").get(batchId) as { status: string };
      expect(batch.status).toBe("cancelled");
    });

    it("returns 409 for already applied batch", async () => {
      // createBatch inserts with whatever status we pass, but the check in cancel route
      // only allows 'collecting' or 'reviewing'. Create directly via DB.
      const r = db.prepare(
        "INSERT INTO training_batches (status, target_count, classification_mode) VALUES ('applied', 5, 'llm')"
      ).run();
      const batchId = r.lastInsertRowid as number;

      const { POST } = await import("@/app/api/training/batch/[id]/cancel/route");
      const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: String(batchId) }) });
      expect(res.status).toBe(409);
    });

    it("returns 404 for non-existent batch", async () => {
      const { POST } = await import("@/app/api/training/batch/[id]/cancel/route");
      const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: "999999" }) });
      expect(res.status).toBe(404);
    });

    it("restores previous classification_mode on cancel", async () => {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('classification_mode_before_training', '\"rules\"') ON CONFLICT(key) DO UPDATE SET value = '\"rules\"'"
      ).run();
      db.prepare("INSERT INTO settings (key, value) VALUES ('classification_mode', '\"llm\"') ON CONFLICT(key) DO UPDATE SET value = '\"llm\"'").run();

      const batchId = createBatch("collecting");

      const { POST } = await import("@/app/api/training/batch/[id]/cancel/route");
      const res = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: String(batchId) }) });
      expect(res.status).toBe(200);

      const body = await res.json() as Record<string, unknown>;
      expect(body.classification_mode_restored).toBe("rules");
    });
  });
});
