import { NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";
import type { TrainingBatch, TrainingItem } from "@/lib/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    await initDb();
    const db = getDb();
    const { id } = await params;
    const batchId = parseInt(id, 10);
    if (isNaN(batchId)) {
      return NextResponse.json({ error: "Invalid batch id" }, { status: 400 });
    }

    const batch = db
      .prepare("SELECT * FROM training_batches WHERE id = ?")
      .get(batchId) as TrainingBatch | undefined;
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // Counts
    const { collected } = db
      .prepare("SELECT COUNT(*) as collected FROM training_items WHERE batch_id = ?")
      .get(batchId) as { collected: number };
    const { reviewed } = db
      .prepare(
        "SELECT COUNT(*) as reviewed FROM training_items WHERE batch_id = ? AND (human_approved = 1 OR human_category IS NOT NULL)"
      )
      .get(batchId) as { reviewed: number };

    // Items joined with display fields from each source table
    const items = db
      .prepare(
        `SELECT ti.*,
           CASE ti.source
             WHEN 'prompt'   THEN COALESCE(p.prompt_preview, p.prompt_text)
             WHEN 'window'   THEN CASE WHEN we.window_title IS NOT NULL
                                    THEN (we.app_name || ': ' || we.window_title)
                                    ELSE we.app_name END
             WHEN 'browser'  THEN CASE WHEN be.page_title IS NOT NULL
                                    THEN (be.page_title || ' (' || be.domain || ')')
                                    ELSE be.domain END
             WHEN 'calendar' THEN ce.summary
           END as display_text,
           COALESCE(ti.event_time, p.timestamp, we.start_time, be.start_time, ce.start_time) as event_time,
           COALESCE(p.timestamp, we.start_time, be.start_time, ce.start_time) as timestamp,
           p.project_name,
           p.prompt_preview,
           p.prompt_text
         FROM training_items ti
         LEFT JOIN prompts p ON ti.source = 'prompt' AND p.id = ti.source_id
         LEFT JOIN window_events we ON ti.source = 'window' AND we.id = ti.source_id
         LEFT JOIN browser_events be ON ti.source = 'browser' AND be.id = ti.source_id
         LEFT JOIN calendar_events ce ON ti.source = 'calendar' AND ce.id = ti.source_id
         WHERE ti.batch_id = ?
         ORDER BY ti.llm_category, ti.id`
      )
      .all(batchId) as TrainingItem[];

    return NextResponse.json({
      batch: { ...batch, collected_count: collected, reviewed_count: reviewed },
      items,
    });
  } catch (err) {
    console.error("Training batch GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    await initDb();
    const db = getDb();
    const { id } = await params;
    const batchId = parseInt(id, 10);
    if (isNaN(batchId)) {
      return NextResponse.json({ error: "Invalid batch id" }, { status: 400 });
    }

    const batch = db
      .prepare("SELECT id, status FROM training_batches WHERE id = ?")
      .get(batchId) as { id: number; status: string } | undefined;
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }
    if (batch.status === "collecting" || batch.status === "reviewing") {
      return NextResponse.json(
        { error: "Cannot delete an active batch. Cancel it first." },
        { status: 409 }
      );
    }

    db.transaction(() => {
      db.prepare("DELETE FROM training_items WHERE batch_id = ?").run(batchId);
      db.prepare("DELETE FROM training_batches WHERE id = ?").run(batchId);
    })();

    return NextResponse.json({ deleted: batchId });
  } catch (err) {
    console.error("Training batch DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
