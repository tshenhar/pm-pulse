import { NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";

/** PATCH /api/training/items/[id] — approve or correct a training item */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    await initDb();
    const db = getDb();
    const { id } = await params;
    const itemId = parseInt(id, 10);
    if (isNaN(itemId)) {
      return NextResponse.json({ error: "Invalid item id" }, { status: 400 });
    }

    const item = db
      .prepare("SELECT id, batch_id FROM training_items WHERE id = ?")
      .get(itemId) as { id: number; batch_id: number } | undefined;
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    const body = await request.json() as {
      action: "approve" | "correct" | "skip";
      human_category?: string;
      human_subcategory?: string;
    };

    if (!["approve", "correct", "skip"].includes(body.action)) {
      return NextResponse.json({ error: "action must be approve | correct | skip" }, { status: 400 });
    }

    if (body.action === "correct") {
      if (!body.human_category || !body.human_subcategory) {
        return NextResponse.json(
          { error: "human_category and human_subcategory required for correct action" },
          { status: 400 }
        );
      }
      db.prepare(
        `UPDATE training_items
         SET human_category = ?, human_subcategory = ?, human_approved = 0,
             reviewed_at = datetime('now')
         WHERE id = ?`
      ).run(body.human_category, body.human_subcategory, itemId);
    } else if (body.action === "approve") {
      db.prepare(
        `UPDATE training_items
         SET human_approved = 1, reviewed_at = datetime('now')
         WHERE id = ?`
      ).run(itemId);
    }
    // skip: no DB change needed

    return NextResponse.json({ success: true, action: body.action });
  } catch (err) {
    console.error("Training item PATCH error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
