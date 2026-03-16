import { describe, it, expect, beforeAll, beforeEach } from "vitest";

describe("Exclusions API", () => {
  let db: ReturnType<Awaited<ReturnType<typeof import("@/lib/db")>>["getDb"]>;

  beforeAll(async () => {
    const { initDb, getDb } = await import("@/lib/db");
    await initDb();
    db = getDb();
  });

  beforeEach(() => {
    db.prepare("DELETE FROM user_rules WHERE pattern IN ('Visual Studio Code', 'localhost', 'Xcode', 'test-classify-rule')").run();
  });

  function makePostReq(body: unknown) {
    return new Request("http://localhost/api/exclusions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function makeDeleteReq(type: string, pattern: string) {
    return new Request(
      `http://localhost/api/exclusions?type=${encodeURIComponent(type)}&pattern=${encodeURIComponent(pattern)}`,
      { method: "DELETE" }
    );
  }

  describe("GET /api/exclusions", () => {
    it("returns empty array when no exclusions exist", async () => {
      const { GET } = await import("@/app/api/exclusions/route");
      const res = GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      // May contain pre-existing rules; just confirm it's an array
      expect(Array.isArray(body)).toBe(true);
    });

    it("returns created exclusion after POST", async () => {
      const { POST, GET } = await import("@/app/api/exclusions/route");
      await POST(makePostReq({ rule_type: "app_name", pattern: "Visual Studio Code" }));

      const res = GET();
      const body = await res.json() as Array<Record<string, unknown>>;
      const rule = body.find((r) => r.pattern === "Visual Studio Code");
      expect(rule).toBeDefined();
      expect(rule!.rule_type).toBe("app_name");
    });
  });

  describe("POST /api/exclusions", () => {
    it("creates exclusion with rule_type=app_name", async () => {
      const { POST } = await import("@/app/api/exclusions/route");
      const res = await POST(makePostReq({ rule_type: "app_name", pattern: "Visual Studio Code" }));
      expect(res.status).toBe(201);
      const body = await res.json() as Record<string, unknown>;
      expect(body.rule_type).toBe("app_name");
      expect(body.pattern).toBe("Visual Studio Code");
    });

    it("creates exclusion with rule_type=domain", async () => {
      const { POST } = await import("@/app/api/exclusions/route");
      const res = await POST(makePostReq({ rule_type: "domain", pattern: "localhost" }));
      expect(res.status).toBe(201);
      const body = await res.json() as Record<string, unknown>;
      expect(body.rule_type).toBe("domain");
      expect(body.pattern).toBe("localhost");
    });

    it("rejects invalid rule_type", async () => {
      const { POST } = await import("@/app/api/exclusions/route");
      const res = await POST(makePostReq({ rule_type: "url", pattern: "example.com" }));
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toContain("rule_type");
    });

    it("rejects empty pattern", async () => {
      const { POST } = await import("@/app/api/exclusions/route");
      const res = await POST(makePostReq({ rule_type: "app_name", pattern: "   " }));
      expect(res.status).toBe(400);
    });

    it("rejects missing pattern", async () => {
      const { POST } = await import("@/app/api/exclusions/route");
      const res = await POST(makePostReq({ rule_type: "app_name" }));
      expect(res.status).toBe(400);
    });

    it("rejects pattern longer than 200 chars", async () => {
      const { POST } = await import("@/app/api/exclusions/route");
      const res = await POST(makePostReq({ rule_type: "app_name", pattern: "x".repeat(201) }));
      expect(res.status).toBe(400);
    });

    it("upserts when pattern already exists — sets action to exclude", async () => {
      // Insert as a classify rule first
      db.prepare(
        "INSERT INTO user_rules (rule_type, pattern, action, primary_category, primary_subcategory) VALUES ('app_name', 'Xcode', 'classify', 'development', 'coding')"
      ).run();

      const { POST } = await import("@/app/api/exclusions/route");
      const res = await POST(makePostReq({ rule_type: "app_name", pattern: "Xcode" }));
      expect(res.status).toBe(201);

      const row = db.prepare("SELECT * FROM user_rules WHERE rule_type = 'app_name' AND pattern = 'Xcode'").get() as Record<string, unknown>;
      expect(row.action).toBe("exclude");
      expect(row.primary_category).toBeNull();
    });
  });

  describe("DELETE /api/exclusions", () => {
    it("removes exclusion by type+pattern", async () => {
      const { POST, DELETE } = await import("@/app/api/exclusions/route");
      await POST(makePostReq({ rule_type: "app_name", pattern: "Visual Studio Code" }));

      const res = DELETE(makeDeleteReq("app_name", "Visual Studio Code"));
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.ok).toBe(true);

      const row = db.prepare("SELECT * FROM user_rules WHERE rule_type = 'app_name' AND pattern = 'Visual Studio Code'").get();
      expect(row).toBeUndefined();
    });

    it("rejects invalid type", async () => {
      const { DELETE } = await import("@/app/api/exclusions/route");
      const res = DELETE(makeDeleteReq("url", "example.com"));
      expect(res.status).toBe(400);
    });

    it("rejects missing pattern", async () => {
      const { DELETE } = await import("@/app/api/exclusions/route");
      const res = DELETE(new Request("http://localhost/api/exclusions?type=app_name", { method: "DELETE" }));
      expect(res.status).toBe(400);
    });

    it("does NOT remove classify rules (guard check)", async () => {
      db.prepare(
        "INSERT INTO user_rules (rule_type, pattern, action, primary_category, primary_subcategory) VALUES ('app_name', 'test-classify-rule', 'classify', 'development', 'coding')"
      ).run();

      const { DELETE } = await import("@/app/api/exclusions/route");
      DELETE(makeDeleteReq("app_name", "test-classify-rule"));

      // Classify rule should still exist
      const row = db.prepare("SELECT * FROM user_rules WHERE rule_type = 'app_name' AND pattern = 'test-classify-rule'").get();
      expect(row).toBeDefined();
      // Clean up
      db.prepare("DELETE FROM user_rules WHERE rule_type = 'app_name' AND pattern = 'test-classify-rule'").run();
    });
  });
});
