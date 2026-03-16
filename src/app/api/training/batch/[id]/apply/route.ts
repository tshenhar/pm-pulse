import { NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";
import type { TrainingItem } from "@/lib/types";

interface ItemWithText extends TrainingItem {
  display_text: string | null;
  prompt_text: string | null;
  prompt_preview: string | null;
}

/**
 * POST /api/training/batch/[id]/apply
 *
 * 1. Saves corrected items as few-shot training_examples for the LLM
 * 2. Snapshots post-apply accuracy
 * 3. Restores classification_mode to what it was before training
 * 4. Marks batch as 'applied'
 */
export async function POST(
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
      .get(batchId) as { id: number; status: string } | undefined;
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    if (batch.status !== "reviewing") {
      return NextResponse.json({ error: "Batch must be in 'reviewing' status to apply" }, { status: 409 });
    }

    // Load all reviewed items (approved or corrected) with display text from each source
    const items = db
      .prepare(
        `SELECT ti.*,
           CASE ti.source
             WHEN 'prompt'   THEN COALESCE(p.prompt_text, p.prompt_preview)
             WHEN 'window'   THEN CASE WHEN we.window_title IS NOT NULL
                                    THEN (we.app_name || ': ' || we.window_title)
                                    ELSE we.app_name END
             WHEN 'browser'  THEN CASE WHEN be.page_title IS NOT NULL
                                    THEN (be.page_title || ' (' || be.domain || ')')
                                    ELSE be.domain END
             WHEN 'calendar' THEN ce.summary
           END as display_text,
           p.prompt_text, p.prompt_preview
         FROM training_items ti
         LEFT JOIN prompts p ON ti.source = 'prompt' AND p.id = ti.source_id
         LEFT JOIN window_events we ON ti.source = 'window' AND we.id = ti.source_id
         LEFT JOIN browser_events be ON ti.source = 'browser' AND be.id = ti.source_id
         LEFT JOIN calendar_events ce ON ti.source = 'calendar' AND ce.id = ti.source_id
         WHERE ti.batch_id = ? AND (ti.human_approved = 1 OR ti.human_category IS NOT NULL)`
      )
      .all(batchId) as ItemWithText[];

    // 1. Insert few-shot examples for corrected items only
    const corrections = items.filter((i) => i.human_category !== null);
    const insertExample = db.prepare(
      `INSERT INTO training_examples (prompt_text, correct_category, correct_subcategory, source_batch_id)
       VALUES (?, ?, ?, ?)`
    );
    const insertAll = db.transaction(() => {
      for (const item of corrections) {
        const text = (item.display_text ?? item.prompt_text ?? item.prompt_preview ?? "").slice(0, 1500);
        if (!text) continue;
        insertExample.run(text, item.human_category, item.human_subcategory, batchId);
      }
    });
    insertAll();

    // 2. Apply corrections to the appropriate source table
    const updatePrompt = db.prepare(
      `UPDATE prompts SET primary_category = ?, primary_subcategory = ?,
         classification_method = 'llm', override_reason = 'training_batch_correction',
         override_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    );
    const updateWindow = db.prepare(
      `UPDATE window_events SET primary_category = ?, primary_subcategory = ? WHERE id = ?`
    );
    const updateBrowser = db.prepare(
      `UPDATE browser_events SET primary_category = ?, primary_subcategory = ? WHERE id = ?`
    );
    const updateCalendar = db.prepare(
      `UPDATE calendar_events SET primary_category = ?, primary_subcategory = ?,
         override_reason = 'training_batch_correction', override_at = datetime('now'),
         updated_at = datetime('now')
       WHERE id = ?`
    );
    const applyCorrections = db.transaction(() => {
      for (const item of corrections) {
        const cat = item.human_category!;
        const sub = item.human_subcategory!;
        if (item.source === "prompt") updatePrompt.run(cat, sub, item.source_id);
        else if (item.source === "window") updateWindow.run(cat, sub, item.source_id);
        else if (item.source === "browser") updateBrowser.run(cat, sub, item.source_id);
        else if (item.source === "calendar") updateCalendar.run(cat, sub, item.source_id);
      }
    });
    applyCorrections();

    // 3. Snapshot accuracy_after
    const { total } = db
      .prepare("SELECT COUNT(*) as total FROM prompts")
      .get() as { total: number };
    const { overridden } = db
      .prepare("SELECT COUNT(*) as overridden FROM prompts WHERE override_at IS NOT NULL AND override_reason != 'training_batch_correction'")
      .get() as { overridden: number };
    const accuracy_after = total > 0 ? Math.round((1 - overridden / total) * 1000) / 1000 : null;

    // 4. Restore previous classification mode
    const prevModeRow = db
      .prepare("SELECT value FROM settings WHERE key = 'classification_mode_before_training'")
      .get() as { value: string } | undefined;
    const prevMode = prevModeRow ? prevModeRow.value : '"rules"';
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('classification_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(prevMode);
    db.prepare("DELETE FROM settings WHERE key = 'classification_mode_before_training'").run();

    // 5. Mark batch applied
    db.prepare(
      "UPDATE training_batches SET status = 'applied', completed_at = datetime('now'), accuracy_after = ? WHERE id = ?"
    ).run(accuracy_after, batchId);

    return NextResponse.json({
      success: true,
      corrections_applied: corrections.length,
      examples_added: corrections.length,
      accuracy_after,
      classification_mode_restored: JSON.parse(prevMode),
    });
  } catch (err) {
    console.error("Training apply error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
