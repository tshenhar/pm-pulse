import { NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";
import { DEFAULT_SETTINGS } from "@/lib/types";

/**
 * POST /api/training/batch/[id]/cancel
 * Cancels a collecting or reviewing batch and restores the previous classification mode.
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
      .prepare("SELECT id, status FROM training_batches WHERE id = ?")
      .get(batchId) as { id: number; status: string } | undefined;
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    if (!["collecting", "reviewing"].includes(batch.status)) {
      return NextResponse.json({ error: "Only active batches can be cancelled" }, { status: 409 });
    }

    // Restore mode
    const prevModeRow = db
      .prepare("SELECT value FROM settings WHERE key = 'classification_mode_before_training'")
      .get() as { value: string } | undefined;
    const prevMode = prevModeRow ? prevModeRow.value : JSON.stringify(DEFAULT_SETTINGS.classification_mode);
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('classification_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(prevMode);
    db.prepare("DELETE FROM settings WHERE key = 'classification_mode_before_training'").run();

    db.prepare(
      "UPDATE training_batches SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?"
    ).run(batchId);

    return NextResponse.json({
      success: true,
      classification_mode_restored: JSON.parse(prevMode),
    });
  } catch (err) {
    console.error("Training cancel error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
