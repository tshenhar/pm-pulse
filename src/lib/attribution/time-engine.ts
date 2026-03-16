import type { AttributionResult, AttributionMethod, AttributionQuality } from "../types";

export interface PromptTimestamp {
  timestamp: string;
  session_id: string;
}

/**
 * Attribute time for a list of prompts within a single session.
 * Prompts must already be sorted by timestamp ascending.
 *
 * Uses raw gap attribution — no min/max caps, no artificial floors.
 * Last prompt gets `pending` with 0 minutes until resolved by a forward signal.
 */
export function attributeSession(
  prompts: PromptTimestamp[]
): AttributionResult[] {
  if (prompts.length === 0) return [];

  const results: AttributionResult[] = [];

  for (let i = 0; i < prompts.length; i++) {
    const isLast = i === prompts.length - 1;

    if (!isLast) {
      const gapSeconds =
        (new Date(prompts[i + 1].timestamp).getTime() -
          new Date(prompts[i].timestamp).getTime()) /
        1000;
      const rawMinutes = gapSeconds / 60;

      results.push({
        attributed_minutes: Math.round(rawMinutes * 100) / 100,
        attribution_method: "measured",
        time_confidence: rawMinutes <= 15 ? "explained" : "unexplained",
        gap_to_next_seconds: gapSeconds,
      });
    } else {
      // Last prompt: pending until resolved by forward signal
      results.push({
        attributed_minutes: 0,
        attribution_method: "pending",
        time_confidence: "pending",
        gap_to_next_seconds: null,
      });
    }
  }

  return results;
}

/**
 * Attribute time for a single prompt given its raw gap.
 * Used for retroactive fix-up when a new prompt arrives.
 */
export function attributeSingle(
  rawMinutes: number,
  isLast: boolean,
  gapSeconds: number | null
): AttributionResult {
  if (isLast) {
    return {
      attributed_minutes: 0,
      attribution_method: "pending",
      time_confidence: "pending",
      gap_to_next_seconds: null,
    };
  }

  return {
    attributed_minutes: Math.round(rawMinutes * 100) / 100,
    attribution_method: "measured" as AttributionMethod,
    time_confidence: (rawMinutes <= 15 ? "explained" : "unexplained") as AttributionQuality,
    gap_to_next_seconds: gapSeconds,
  };
}
