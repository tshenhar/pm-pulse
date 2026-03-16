import { describe, it, expect, beforeAll } from "vitest";

// These tests validate API route input validation logic.
// They test the validation functions by importing and calling the routes directly.

describe("API Input Validation", () => {
  beforeAll(async () => {
    const { initDb } = await import("@/lib/db");
    await initDb();
  });

  describe("Dashboard route", () => {
    it("rejects invalid date format", async () => {
      const { GET } = await import("@/app/api/dashboard/route");
      const req = new Request("http://localhost/api/dashboard?date=not-a-date");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid date");
    });

    it("rejects partial date format", async () => {
      const { GET } = await import("@/app/api/dashboard/route");
      const req = new Request("http://localhost/api/dashboard?date=2025-1-5");
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it("accepts valid date", async () => {
      const { GET } = await import("@/app/api/dashboard/route");
      const req = new Request("http://localhost/api/dashboard?date=2025-03-12");
      const res = await GET(req);
      expect(res.status).toBe(200);
    });

    it("accepts missing date (defaults to today)", async () => {
      const { GET } = await import("@/app/api/dashboard/route");
      const req = new Request("http://localhost/api/dashboard");
      const res = await GET(req);
      expect(res.status).toBe(200);
    });
  });

  describe("Trends route", () => {
    it("rejects invalid period", async () => {
      const { GET } = await import("@/app/api/trends/route");
      const req = new Request("http://localhost/api/trends?period=year");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid period");
    });

    it("rejects invalid end_date", async () => {
      const { GET } = await import("@/app/api/trends/route");
      const req = new Request("http://localhost/api/trends?end_date=abc");
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it("accepts valid params", async () => {
      const { GET } = await import("@/app/api/trends/route");
      const req = new Request("http://localhost/api/trends?period=week&end_date=2025-03-12");
      const res = await GET(req);
      expect(res.status).toBe(200);
    });

    it("accepts month period", async () => {
      const { GET } = await import("@/app/api/trends/route");
      const req = new Request("http://localhost/api/trends?period=month");
      const res = await GET(req);
      expect(res.status).toBe(200);
    });
  });

  describe("Settings route", () => {
    it("rejects invalid privacy_mode", async () => {
      const { PUT } = await import("@/app/api/settings/route");
      const req = new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privacy_mode: "invisible" }),
      });
      const res = await PUT(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid privacy_mode");
    });

    it("rejects invalid classification_mode", async () => {
      const { PUT } = await import("@/app/api/settings/route");
      const req = new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classification_mode: "magic" }),
      });
      const res = await PUT(req);
      expect(res.status).toBe(400);
    });

    it("accepts valid settings", async () => {
      const { PUT } = await import("@/app/api/settings/route");
      const req = new Request("http://localhost/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privacy_mode: "preview" }),
      });
      const res = await PUT(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it("GET returns settings", async () => {
      const { GET } = await import("@/app/api/settings/route");
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("privacy_mode");
      expect(body).toHaveProperty("classification_mode");
    });
  });

  describe("Export route", () => {
    it("rejects invalid format", async () => {
      const { GET } = await import("@/app/api/export/route");
      const req = new Request("http://localhost/api/export?format=xml");
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it("rejects invalid start_date", async () => {
      const { GET } = await import("@/app/api/export/route");
      const req = new Request("http://localhost/api/export?start_date=bad");
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it("returns CSV by default", async () => {
      const { GET } = await import("@/app/api/export/route");
      const req = new Request("http://localhost/api/export");
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/csv");
    });

    it("returns JSON when requested", async () => {
      const { GET } = await import("@/app/api/export/route");
      const req = new Request("http://localhost/api/export?format=json");
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/json");
    });
  });

  describe("Reclassify route", () => {
    it("rejects non-numeric prompt ID", async () => {
      const { POST } = await import("@/app/api/prompts/[id]/reclassify/route");
      const req = new Request("http://localhost/api/prompts/abc/reclassify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "strategy", subcategory: "roadmapping" }),
      });
      const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
      expect(res.status).toBe(400);
    });

    it("rejects missing category", async () => {
      const { POST } = await import("@/app/api/prompts/[id]/reclassify/route");
      const req = new Request("http://localhost/api/prompts/1/reclassify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subcategory: "roadmapping" }),
      });
      const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(400);
    });

    it("rejects nonexistent category", async () => {
      const { POST } = await import("@/app/api/prompts/[id]/reclassify/route");
      const req = new Request("http://localhost/api/prompts/1/reclassify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "nonexistent", subcategory: "foo" }),
      });
      const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Unknown category");
    });
  });
});
