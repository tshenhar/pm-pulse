import { NextResponse } from "next/server";
import { initDb, getDb, loadSettings } from "@/lib/db";
import { DEFAULT_SETTINGS } from "@/lib/types";
import type { TrainingBatch } from "@/lib/types";
import { processEvents } from "@/lib/ingestion/processor";
import { processWindowEvents } from "@/lib/ingestion/window-ingestor";
import { processBrowserEvents } from "@/lib/ingestion/browser-ingestor";
import { captureMultiSourceTrainingItems } from "@/lib/ingestion/training-collector";

/** GET /api/training/start — return the current active or most-recent batch, and trigger capture if collecting */
export async function GET(): Promise<NextResponse> {
  try {
    await initDb();
    const db = getDb();

    // If a batch is collecting, ingest pending events and capture training items
    const activeBatch = db
      .prepare("SELECT id FROM training_batches WHERE status = 'collecting' LIMIT 1")
      .get();
    if (activeBatch) {
      const settings = loadSettings();
      processEvents();
      if (settings.window_tracking_enabled) {
        processWindowEvents({ skipBrowserApps: settings.browser_tracking_enabled });
      }
      if (settings.browser_tracking_enabled) {
        processBrowserEvents().catch((e) => console.error("Browser ingest error:", e));
      }
      captureMultiSourceTrainingItems().catch((e) => console.error("Training capture error:", e));
    }

    const batch = db
      .prepare(
        "SELECT * FROM training_batches WHERE status IN ('collecting', 'reviewing') ORDER BY id DESC LIMIT 1"
      )
      .get() as TrainingBatch | undefined;

    // Past batches (applied/cancelled) for history panel
    const history = db
      .prepare(
        `SELECT id, status, target_count, created_at, completed_at, accuracy_before, accuracy_after,
                (SELECT COUNT(*) FROM training_items WHERE batch_id = tb.id) as collected_count
         FROM training_batches tb
         WHERE status IN ('applied', 'cancelled')
         ORDER BY id DESC LIMIT 20`
      )
      .all() as (TrainingBatch & { collected_count: number })[];

    if (!batch) {
      return NextResponse.json({ batch: null, history });
    }

    const { collected } = db
      .prepare("SELECT COUNT(*) as collected FROM training_items WHERE batch_id = ?")
      .get(batch.id) as { collected: number };
    const { reviewed } = db
      .prepare(
        "SELECT COUNT(*) as reviewed FROM training_items WHERE batch_id = ? AND (human_approved = 1 OR human_category IS NOT NULL)"
      )
      .get(batch.id) as { reviewed: number };

    return NextResponse.json({ batch: { ...batch, collected_count: collected, reviewed_count: reviewed }, history });
  } catch (err) {
    console.error("Training GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await initDb();
    const db = getDb();

    // Reject if a batch is already in progress
    const active = db
      .prepare("SELECT id, status FROM training_batches WHERE status IN ('collecting', 'reviewing') LIMIT 1")
      .get() as { id: number; status: string } | undefined;

    if (active) {
      return NextResponse.json(
        { error: `A training batch is already ${active.status} (id=${active.id}). Finish or cancel it first.` },
        { status: 409 }
      );
    }

    // Parse optional body params
    let target_count = 100;
    try {
      const body = await request.json();
      if (typeof body.target_count === "number" && body.target_count > 0 && body.target_count <= 500) {
        target_count = body.target_count;
      }
    } catch {
      // no body — use defaults
    }

    // Snapshot current classification accuracy before switching modes
    const totalPrompts = (db
      .prepare("SELECT COUNT(*) as n FROM prompts")
      .get() as { n: number }).n;
    const overriddenPrompts = (db
      .prepare("SELECT COUNT(*) as n FROM prompts WHERE override_at IS NOT NULL")
      .get() as { n: number }).n;
    const accuracy_before = totalPrompts > 0
      ? Math.round((1 - overriddenPrompts / totalPrompts) * 1000) / 1000
      : null;

    // Create the batch
    const result = db
      .prepare(
        `INSERT INTO training_batches (status, target_count, classification_mode, accuracy_before)
         VALUES ('collecting', ?, 'llm', ?)`
      )
      .run(target_count, accuracy_before);

    const batchId = result.lastInsertRowid as number;

    // Switch classification_mode to 'llm'
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('classification_mode', '\"llm\"') ON CONFLICT(key) DO UPDATE SET value = '\"llm\"'"
    ).run();

    // Persist the previous mode so we can restore it when the batch is applied
    const prevMode = db
      .prepare("SELECT value FROM settings WHERE key = 'classification_mode_before_training'")
      .get();
    if (!prevMode) {
      // Store whatever mode was active before (default: rules)
      const currentModeRow = db
        .prepare("SELECT value FROM settings WHERE key = 'classification_mode'")
        .get() as { value: string } | undefined;
      const modeBeforeTraining = currentModeRow
        ? currentModeRow.value
        : JSON.stringify(DEFAULT_SETTINGS.classification_mode);
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('classification_mode_before_training', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run(modeBeforeTraining);
    }

    const batch = db
      .prepare("SELECT * FROM training_batches WHERE id = ?")
      .get(batchId) as TrainingBatch;

    return NextResponse.json({ batch }, { status: 201 });
  } catch (err) {
    console.error("Training start error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
