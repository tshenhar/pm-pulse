import { getDb } from "@/lib/db";
import { classifyWithLLM } from "@/lib/classification/llm-classifier";

const BATCH_SIZE = 10;

export async function classifyPendingWithLLM(): Promise<void> {
  const db = getDb();
  const pending = db
    .prepare("SELECT id, prompt_text FROM prompts WHERE pending_llm_classification = 1 LIMIT ?")
    .all(BATCH_SIZE) as { id: number; prompt_text: string | null }[];

  if (pending.length === 0) return;

  const update = db.prepare(`
    UPDATE prompts SET
      primary_category = ?,
      primary_subcategory = ?,
      primary_confidence = ?,
      classification_method = 'llm',
      classification_reasoning = ?,
      pending_llm_classification = 0,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  const clearFlag = db.prepare(
    "UPDATE prompts SET pending_llm_classification = 0 WHERE id = ?"
  );

  await Promise.allSettled(
    pending.map(async (row) => {
      if (!row.prompt_text) { clearFlag.run(row.id); return; }
      try {
        const result = await classifyWithLLM(row.prompt_text);
        update.run(
          result.primary_category,
          result.primary_subcategory,
          result.primary_confidence,
          result.reasoning ?? null,
          row.id
        );
      } catch (e) {
        console.error(`LLM classify failed for prompt ${row.id}:`, e);
        clearFlag.run(row.id);
      }
    })
  );
}
