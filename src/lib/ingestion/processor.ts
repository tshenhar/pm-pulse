import { unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { EVENTS_DIR, getDb } from "../db";
import { PROMPT_PREVIEW_LENGTH, LOW_CONFIDENCE_THRESHOLD } from "../constants";
import type { PromptEvent, StopEvent } from "../types";
import { classify } from "../classification/classifier";
import { classifyWithLLM } from "../classification/llm-classifier";
import { attributeSingle } from "../attribution/time-engine";
import { readPendingEvents } from "./event-reader";

export function processEvents(): { processed: number; errors: number } {
  const events = readPendingEvents();
  if (events.length === 0) return { processed: 0, errors: 0 };

  const db = getDb();
  let processed = 0;
  let errors = 0;

  const classificationMode = loadClassificationMode(db);

  for (const event of events) {
    try {
      if (event.type === "prompt") {
        processPrompt(db, event, classificationMode);
      } else if (event.type === "stop") {
        processStop(db, event);
      }
      // session_start / session_end: logged for future use, delete file
      deleteEventFile(event.id);
      processed++;
    } catch {
      errors++;
      deleteEventFile(event.id); // Don't reprocess broken events
    }
  }

  return { processed, errors };
}

function subtractIdleOverlap(
  db: ReturnType<typeof getDb>,
  windowStart: string,
  windowEnd: string,
  rawMinutes: number
): { adjustedMinutes: number; idleMinutesSubtracted: number } {
  const spans = db.prepare(`
    SELECT start_time, end_time FROM idle_spans
    WHERE start_time < ? AND end_time > ?
  `).all(windowEnd, windowStart) as { start_time: string; end_time: string }[];

  if (spans.length === 0) return { adjustedMinutes: rawMinutes, idleMinutesSubtracted: 0 };

  const wsMs = new Date(windowStart).getTime();
  const weMs = new Date(windowEnd).getTime();
  let totalIdleMs = 0;
  for (const span of spans) {
    const overlapStart = Math.max(new Date(span.start_time).getTime(), wsMs);
    const overlapEnd = Math.min(new Date(span.end_time).getTime(), weMs);
    if (overlapEnd > overlapStart) totalIdleMs += overlapEnd - overlapStart;
  }

  const idleMinutes = totalIdleMs / 60_000;
  return { adjustedMinutes: Math.max(0, rawMinutes - idleMinutes), idleMinutesSubtracted: idleMinutes };
}

function processPrompt(
  db: ReturnType<typeof getDb>,
  event: PromptEvent,
  classificationMode: string
): void {
  // Check duplicate
  const existing = db
    .prepare("SELECT id FROM prompts WHERE prompt_hash = ?")
    .get(event.prompt_hash);
  if (existing) return;

  // Classify
  const classification = classify(event.prompt, event.cwd);

  // Get previous prompt in same session for retroactive fix-up
  const prevPrompt = db
    .prepare(
      "SELECT id, timestamp, gap_to_next_seconds, attribution_method FROM prompts WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1"
    )
    .get(event.session_id) as
    | { id: number; timestamp: string; gap_to_next_seconds: number | null; attribution_method: string }
    | undefined;

  // Compute time attribution — raw gap, no caps
  let attribution;
  let prevAttribution: ReturnType<typeof attributeSingle> | null = null;
  let gapSeconds: number | null = null;

  if (prevPrompt) {
    // Compute gap from previous prompt to this one
    gapSeconds =
      (new Date(event.timestamp).getTime() -
        new Date(prevPrompt.timestamp).getTime()) /
      1000;
    const rawMinutes = gapSeconds / 60;

    // This prompt: pending until next signal arrives
    attribution = attributeSingle(0, true, null);

    // Retroactive fix-up: previous prompt now has a measured gap
    // Skip if already resolved via direct (stop event already set duration)
    if (prevPrompt.attribution_method !== "direct") {
      const { adjustedMinutes, idleMinutesSubtracted } = subtractIdleOverlap(
        db, prevPrompt.timestamp, event.timestamp, rawMinutes
      );
      const base = attributeSingle(adjustedMinutes, false, gapSeconds);
      prevAttribution = idleMinutesSubtracted > 0
        ? { ...base, attribution_method: "idle_adjusted" as const }
        : base;
    }
  } else {
    // First prompt in session — pending until next signal
    attribution = attributeSingle(0, true, null);
  }

  // Determine whether to queue for LLM classification
  const pendingLlm =
    classificationMode === "llm" ||
    (classificationMode === "hybrid" && classification.primary_confidence < LOW_CONFIDENCE_THRESHOLD)
      ? 1 : 0;

  // Derive project name and preview
  const projectName = deriveProjectName(event.cwd);
  const promptPreview = event.prompt.slice(0, PROMPT_PREVIEW_LENGTH);

  // Wrap retroactive update + insert in a single transaction to prevent race conditions
  const insertPrompt = db.transaction(() => {
    // Retroactive fix-up: update previous prompt now that we know its forward gap
    if (prevPrompt && prevAttribution && gapSeconds !== null) {
      db.prepare(
        "UPDATE prompts SET gap_to_next_seconds = ?, attributed_minutes = ?, attribution_method = ?, time_confidence = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(
        gapSeconds,
        prevAttribution.attributed_minutes,
        prevAttribution.attribution_method,
        prevAttribution.time_confidence,
        prevPrompt.id
      );
    }

    // Insert new prompt
    db.prepare(
      `INSERT INTO prompts (
        external_id, session_id, timestamp, prompt_text, prompt_preview, prompt_hash,
        cwd, project_name,
        primary_category, primary_subcategory, primary_confidence,
        secondary_category, secondary_subcategory, secondary_confidence,
        classification_method, classification_reasoning, pending_llm_classification,
        attributed_minutes, attribution_method, time_confidence, gap_to_next_seconds
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.id,
      event.session_id,
      event.timestamp,
      event.prompt,
      promptPreview,
      event.prompt_hash,
      event.cwd,
      projectName,
      classification.primary_category,
      classification.primary_subcategory,
      classification.primary_confidence,
      classification.secondary_category ?? null,
      classification.secondary_subcategory ?? null,
      classification.secondary_confidence ?? null,
      classification.method,
      classification.reasoning ?? null,
      pendingLlm,
      attribution.attributed_minutes,
      attribution.attribution_method,
      attribution.time_confidence,
      attribution.gap_to_next_seconds
    );
  });

  insertPrompt();

  // If a training batch is collecting, fire LLM classification for this prompt
  captureTrainingItemIfActive(db, event.prompt).catch((e) =>
    console.error("Training capture error:", e)
  );
}

/**
 * Fire-and-forget: get LLM classification for the most recently inserted prompt
 * and record it in training_items if a batch is still collecting.
 */
async function captureTrainingItemIfActive(
  db: ReturnType<typeof getDb>,
  promptText: string
): Promise<void> {
  const batch = db
    .prepare(
      "SELECT id, target_count FROM training_batches WHERE status = 'collecting' LIMIT 1"
    )
    .get() as { id: number; target_count: number } | undefined;
  if (!batch) return;

  // Count items already captured for this batch
  const { n: collected } = db
    .prepare("SELECT COUNT(*) as n FROM training_items WHERE batch_id = ?")
    .get(batch.id) as { n: number };
  if (collected >= batch.target_count) return;

  // Get the prompt row we just inserted (most recent by created_at)
  const promptRow = db
    .prepare("SELECT id FROM prompts ORDER BY id DESC LIMIT 1")
    .get() as { id: number } | undefined;
  if (!promptRow) return;

  // Avoid duplicate entries
  const exists = db
    .prepare("SELECT id FROM training_items WHERE batch_id = ? AND source = 'prompt' AND source_id = ?")
    .get(batch.id, promptRow.id);
  if (exists) return;

  // Call LLM
  const llmResult = await classifyWithLLM(promptText);

  db.prepare(
    `INSERT OR IGNORE INTO training_items
       (batch_id, source, source_id, prompt_id, llm_category, llm_subcategory, llm_confidence, llm_reasoning)
     VALUES (?, 'prompt', ?, ?, ?, ?, ?, ?)`
  ).run(
    batch.id,
    promptRow.id,
    promptRow.id,
    llmResult.primary_category,
    llmResult.primary_subcategory,
    llmResult.primary_confidence,
    llmResult.reasoning ?? null
  );

  // Check if batch is now full → advance to reviewing
  const { n: newCount } = db
    .prepare("SELECT COUNT(*) as n FROM training_items WHERE batch_id = ?")
    .get(batch.id) as { n: number };
  if (newCount >= batch.target_count) {
    db.prepare(
      "UPDATE training_batches SET status = 'reviewing', completed_at = datetime('now') WHERE id = ?"
    ).run(batch.id);
    console.log(`Training batch ${batch.id} collection complete (${newCount} items). Status → reviewing.`);
  }
}

function processStop(
  db: ReturnType<typeof getDb>,
  event: StopEvent
): void {
  // Find the most recent pending prompt in the same session
  const pendingPrompt = db
    .prepare(
      "SELECT id, timestamp FROM prompts WHERE session_id = ? AND attribution_method = 'pending' ORDER BY timestamp DESC LIMIT 1"
    )
    .get(event.session_id) as
    | { id: number; timestamp: string }
    | undefined;

  if (!pendingPrompt) return;

  const durationSeconds =
    (new Date(event.timestamp).getTime() -
      new Date(pendingPrompt.timestamp).getTime()) /
    1000;

  // Guard against negative durations (clock skew)
  if (durationSeconds < 0) return;

  db.prepare(
    `UPDATE prompts SET
      response_timestamp = ?,
      response_duration_seconds = ?,
      attributed_minutes = ?,
      attribution_method = 'direct',
      time_confidence = 'direct',
      updated_at = datetime('now')
    WHERE id = ?`
  ).run(
    event.timestamp,
    durationSeconds,
    durationSeconds / 60,
    pendingPrompt.id
  );
}

function deriveProjectName(cwd: string): string {
  const home = homedir();
  // Strip home dir prefix variants and extract meaningful project name
  const cleaned = cwd
    .replace(new RegExp(`^${home}/Projects/`), "")
    .replace(new RegExp(`^${home}/`), "")
    .replace(/^~\/Projects\//, "")
    .replace(/^~\//, "")
    .replace(/^\/[^/]+\/[^/]+\/Projects\//, ""); // generic: /Users/anyone/Projects/

  // Take first path component as project name
  const firstSegment = cleaned.split("/")[0];
  return firstSegment || "unknown";
}

function loadClassificationMode(db: ReturnType<typeof getDb>): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'classification_mode'").get() as { value: string } | undefined;
  return row ? JSON.parse(row.value) : "rules";
}

function deleteEventFile(eventId: string): void {
  // Sanitize: reject path separators to prevent directory traversal
  if (/[/\\]/.test(eventId)) return;
  try {
    unlinkSync(join(EVENTS_DIR, `${eventId}.json`));
  } catch {
    // File may already be gone
  }
}
