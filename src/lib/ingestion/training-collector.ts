import { getDb } from "@/lib/db";
import { classifyWithLLM } from "@/lib/classification/llm-classifier";

type NonPromptSource = "window" | "browser";

interface SourceCandidate {
  source: NonPromptSource;
  source_id: number;
  display_text: string;
  event_time: string;
}

/**
 * After window/browser/calendar ingestion, pick up recently-inserted events
 * that aren't yet in the active training batch and LLM-classify them.
 * Fire-and-forget — never throws.
 */
export async function captureMultiSourceTrainingItems(): Promise<void> {
  const db = getDb();

  const batch = db
    .prepare("SELECT id, target_count, created_at FROM training_batches WHERE status = 'collecting' LIMIT 1")
    .get() as { id: number; target_count: number; created_at: string } | undefined;
  if (!batch) return;

  const { n: collected } = db
    .prepare("SELECT COUNT(*) as n FROM training_items WHERE batch_id = ?")
    .get(batch.id) as { n: number };
  const remaining = batch.target_count - collected;
  if (remaining <= 0) return;

  const candidates: SourceCandidate[] = [];

  const batchStart = batch.created_at;

  // Window events
  const windowRows = db
    .prepare(
      `SELECT we.id, we.app_name, we.window_title, we.start_time FROM window_events we
       WHERE datetime(we.start_time) >= datetime(?) AND NOT EXISTS (
         SELECT 1 FROM training_items ti WHERE ti.batch_id = ? AND ti.source = 'window' AND ti.source_id = we.id
       )
       ORDER BY we.start_time ASC LIMIT ?`
    )
    .all(batchStart, batch.id, remaining) as { id: number; app_name: string; window_title: string | null; start_time: string }[];

  for (const ev of windowRows) {
    const text = ev.window_title ? `${ev.app_name}: ${ev.window_title}` : ev.app_name;
    candidates.push({ source: "window", source_id: ev.id, display_text: text, event_time: ev.start_time });
  }

  // Browser events
  const browserRows = db
    .prepare(
      `SELECT be.id, be.domain, be.page_title, be.start_time FROM browser_events be
       WHERE datetime(be.start_time) >= datetime(?) AND NOT EXISTS (
         SELECT 1 FROM training_items ti WHERE ti.batch_id = ? AND ti.source = 'browser' AND ti.source_id = be.id
       )
       ORDER BY be.start_time ASC LIMIT ?`
    )
    .all(batchStart, batch.id, remaining) as { id: number; domain: string; page_title: string | null; start_time: string }[];

  for (const ev of browserRows) {
    const text = ev.page_title ? `${ev.page_title} (${ev.domain})` : ev.domain;
    candidates.push({ source: "browser", source_id: ev.id, display_text: text, event_time: ev.start_time });
  }

  // Calendar events intentionally excluded from training batches —
  // they are synced future meetings, not observed user activity.

  if (candidates.length === 0) return;

  const toCapture = candidates.slice(0, remaining);

  const results = await Promise.allSettled(
    toCapture.map((c) => classifyWithLLM(c.display_text))
  );

  const insertItem = db.prepare(
    `INSERT OR IGNORE INTO training_items
       (batch_id, source, source_id, prompt_id, event_time, llm_category, llm_subcategory, llm_confidence, llm_reasoning)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`
  );

  const insertAll = db.transaction(() => {
    for (let i = 0; i < toCapture.length; i++) {
      const result = results[i];
      if (result.status !== "fulfilled") continue;
      const { source, source_id, event_time } = toCapture[i];
      const llm = result.value;
      insertItem.run(
        batch.id, source, source_id, event_time,
        llm.primary_category, llm.primary_subcategory, llm.primary_confidence, llm.reasoning ?? null
      );
    }
  });
  insertAll();

  // Advance to reviewing if now full
  const { n: newCount } = db
    .prepare("SELECT COUNT(*) as n FROM training_items WHERE batch_id = ?")
    .get(batch.id) as { n: number };
  if (newCount >= batch.target_count) {
    db.prepare(
      "UPDATE training_batches SET status = 'reviewing', completed_at = datetime('now') WHERE id = ?"
    ).run(batch.id);
  }
}
