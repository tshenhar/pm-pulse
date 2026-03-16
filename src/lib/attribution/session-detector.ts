export interface TimestampedPrompt {
  timestamp: string;
  session_id: string;
}

/**
 * Detect work sessions by scanning prompts for time gaps.
 * Returns array of sessions, each session is an array of prompts.
 * Prompts are sorted by timestamp within and across sessions.
 */
export function detectSessions<T extends TimestampedPrompt>(
  prompts: T[],
  sessionGapMinutes: number = 30
): T[][] {
  if (prompts.length === 0) return [];

  const sorted = [...prompts].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const gapThresholdMs = sessionGapMinutes * 60 * 1000;
  const sessions: T[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const gap =
      new Date(sorted[i].timestamp).getTime() -
      new Date(sorted[i - 1].timestamp).getTime();

    if (gap > gapThresholdMs) {
      sessions.push([sorted[i]]);
    } else {
      sessions[sessions.length - 1].push(sorted[i]);
    }
  }

  return sessions;
}
