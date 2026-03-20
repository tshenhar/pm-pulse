import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { invalidateInitiativeCache } from "@/lib/initiative-matcher";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json() as { name?: string; keywords?: string[]; color?: string; is_active?: number };
    const db = getDb();
    const existing = db.prepare("SELECT id FROM initiatives WHERE id = ?").get(id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (body.name !== undefined) db.prepare("UPDATE initiatives SET name = ?, updated_at = datetime('now') WHERE id = ?").run(body.name, id);
    if (body.keywords !== undefined) db.prepare("UPDATE initiatives SET keywords = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(body.keywords), id);
    if (body.color !== undefined) db.prepare("UPDATE initiatives SET color = ?, updated_at = datetime('now') WHERE id = ?").run(body.color, id);
    if (body.is_active !== undefined) db.prepare("UPDATE initiatives SET is_active = ?, updated_at = datetime('now') WHERE id = ?").run(body.is_active, id);
    invalidateInitiativeCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Initiatives PUT error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await params;
    const db = getDb();
    db.prepare("DELETE FROM initiatives WHERE id = ?").run(id);
    invalidateInitiativeCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Initiatives DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
