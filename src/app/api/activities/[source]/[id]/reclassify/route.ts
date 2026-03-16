import { NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";

interface ReclassifyBody {
  category: string;
  subcategory: string;
  reason?: string;
}

type Source = "prompt" | "browser" | "window";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ source: string; id: string }> }
): Promise<NextResponse> {
  try {
    const { source, id } = await params;
    const activityId = parseInt(id, 10);

    if (!["prompt", "browser", "window"].includes(source)) {
      return NextResponse.json({ error: "Invalid source" }, { status: 400 });
    }
    if (isNaN(activityId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body: ReclassifyBody = await request.json();
    if (!body.category || !body.subcategory) {
      return NextResponse.json({ error: "category and subcategory are required" }, { status: 400 });
    }

    const reason = body.reason ? body.reason.slice(0, 500) : null;

    await initDb();
    const db = getDb();

    // Validate category + subcategory
    const catExists = db
      .prepare("SELECT id FROM categories WHERE slug = ?")
      .get(body.category) as { id: number } | undefined;
    if (!catExists) {
      return NextResponse.json({ error: `Unknown category: ${body.category}` }, { status: 400 });
    }
    const subExists = db
      .prepare("SELECT id FROM subcategories WHERE slug = ? AND category_id = ?")
      .get(body.subcategory, catExists.id) as { id: number } | undefined;
    if (!subExists) {
      return NextResponse.json({ error: `Unknown subcategory: ${body.subcategory}` }, { status: 400 });
    }

    let rulePattern: string | null = null;
    const ruleType = source === "browser" ? "domain" : source === "window" ? "app_name" : null;

    if (source === "prompt") {
      const row = db.prepare("SELECT id FROM prompts WHERE id = ?").get(activityId) as { id: number } | undefined;
      if (!row) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

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
      ).run(body.category, body.subcategory, reason, activityId);

    } else if (source === "browser") {
      const row = db
        .prepare("SELECT id, domain FROM browser_events WHERE id = ?")
        .get(activityId) as { id: number; domain: string } | undefined;
      if (!row) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

      rulePattern = row.domain;
      db.prepare(
        `UPDATE browser_events SET
          primary_category = ?,
          primary_subcategory = ?,
          primary_confidence = 1.0,
          classification_reasoning = ?
        WHERE id = ?`
      ).run(body.category, body.subcategory, `user rule: ${rulePattern}`, activityId);

    } else if (source === "window") {
      const row = db
        .prepare("SELECT id, app_name FROM window_events WHERE id = ?")
        .get(activityId) as { id: number; app_name: string } | undefined;
      if (!row) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

      rulePattern = row.app_name;
      db.prepare(
        `UPDATE window_events SET
          primary_category = ?,
          primary_subcategory = ?,
          primary_confidence = 1.0,
          classification_reasoning = ?
        WHERE id = ?`
      ).run(body.category, body.subcategory, `user rule: ${rulePattern}`, activityId);
    }

    // Save user rule for browser/window so future events are classified correctly
    if (ruleType && rulePattern) {
      db.prepare(
        `INSERT INTO user_rules (rule_type, pattern, primary_category, primary_subcategory, hit_count, updated_at)
         VALUES (?, ?, ?, ?, 0, datetime('now'))
         ON CONFLICT(rule_type, pattern) DO UPDATE SET
           primary_category = excluded.primary_category,
           primary_subcategory = excluded.primary_subcategory,
           updated_at = datetime('now')`
      ).run(ruleType, rulePattern, body.category, body.subcategory);
    }

    return NextResponse.json({ success: true, id: activityId, rule_saved: !!rulePattern });
  } catch (err) {
    console.error("Reclassify API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
