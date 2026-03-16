import { NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";

const MAX_REASON_LENGTH = 500;

interface ReclassifyBody {
  category: string;
  subcategory: string;
  reason?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const promptId = parseInt(id, 10);
    if (isNaN(promptId)) {
      return NextResponse.json({ error: "Invalid prompt ID" }, { status: 400 });
    }

    const body: ReclassifyBody = await request.json();
    if (!body.category || !body.subcategory) {
      return NextResponse.json(
        { error: "category and subcategory are required" },
        { status: 400 }
      );
    }

    // Cap reason length
    const reason = body.reason ? body.reason.slice(0, MAX_REASON_LENGTH) : null;

    await initDb();
    const db = getDb();

    // Validate category exists in DB
    const catExists = db
      .prepare("SELECT id FROM categories WHERE slug = ?")
      .get(body.category) as { id: number } | undefined;
    if (!catExists) {
      return NextResponse.json(
        { error: `Unknown category: ${body.category}` },
        { status: 400 }
      );
    }

    // Validate subcategory exists and belongs to this category
    const subExists = db
      .prepare("SELECT id FROM subcategories WHERE slug = ? AND category_id = ?")
      .get(body.subcategory, catExists.id) as { id: number } | undefined;
    if (!subExists) {
      return NextResponse.json(
        { error: `Unknown subcategory: ${body.subcategory} for category ${body.category}` },
        { status: 400 }
      );
    }

    // Fetch current prompt
    const prompt = db
      .prepare("SELECT id, primary_category, primary_subcategory FROM prompts WHERE id = ?")
      .get(promptId) as { id: number; primary_category: string; primary_subcategory: string } | undefined;

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    // Update with override
    db.prepare(
      `UPDATE prompts SET
        previous_category = primary_category,
        previous_subcategory = primary_subcategory,
        primary_category = ?,
        primary_subcategory = ?,
        override_reason = ?,
        override_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(body.category, body.subcategory, reason, promptId);

    return NextResponse.json({ success: true, id: promptId });
  } catch (err) {
    console.error("Reclassify API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
