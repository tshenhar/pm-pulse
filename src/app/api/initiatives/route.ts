import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { invalidateInitiativeCache } from "@/lib/initiative-matcher";
import type { Initiative } from "@/lib/types";

export async function GET(): Promise<NextResponse> {
  try {
    const db = getDb();
    const rows = db
      .prepare("SELECT id, name, slug, keywords, color, is_active, created_at, updated_at FROM initiatives ORDER BY name ASC")
      .all() as (Omit<Initiative, "keywords"> & { keywords: string })[];
    const initiatives = rows.map((r) => ({ ...r, keywords: JSON.parse(r.keywords) as string[] }));
    return NextResponse.json({ initiatives });
  } catch (err) {
    console.error("Initiatives GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as { name?: string; keywords?: string[]; color?: string };
    const { name, keywords = [], color = "#6366f1" } = body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const db = getDb();
    const result = db
      .prepare("INSERT INTO initiatives (name, slug, keywords, color) VALUES (?, ?, ?, ?)")
      .run(name.trim(), slug, JSON.stringify(keywords), color);
    invalidateInitiativeCache();
    const row = db.prepare("SELECT id, name, slug, keywords, color, is_active, created_at, updated_at FROM initiatives WHERE id = ?").get(result.lastInsertRowid) as (Omit<Initiative, "keywords"> & { keywords: string }) | undefined;
    if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    return NextResponse.json({ initiative: { ...row, keywords: JSON.parse(row.keywords) as string[] } }, { status: 201 });
  } catch (err) {
    console.error("Initiatives POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
