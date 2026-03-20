import { getDb } from "./db";
import { getDayBounds } from "./date-utils";
import type { ScoreBreakdown } from "./types";

/**
 * Compute a daily productivity score (0-100) from existing DB data.
 *
 * Score components:
 * - Strategic depth (40%): % time in strategy + requirements (target >= 40%)
 * - Focus quality (35%): longest continuous same-category block / 30 min (capped at 100%)
 * - Reactive ratio (25%): inverse of % time in communication + meetings (target <= 30%)
 *
 * Returns null if fewer than 60 tracked minutes.
 */
export function computeProductivityScore(date: string): ScoreBreakdown | null {
  const db = getDb();
  const { start, end } = getDayBounds(date);

  // Query all sources
  const prompts = db
    .prepare("SELECT primary_category, attributed_minutes, timestamp FROM prompts WHERE timestamp BETWEEN ? AND ?")
    .all(start, end) as { primary_category: string; attributed_minutes: number; timestamp: string }[];

  const windowEvents = db
    .prepare("SELECT primary_category, duration_minutes, start_time FROM window_events WHERE start_time BETWEEN ? AND ?")
    .all(start, end) as { primary_category: string; duration_minutes: number; start_time: string }[];

  const calendarEvents = db
    .prepare("SELECT primary_category, duration_minutes FROM calendar_events WHERE start_time BETWEEN ? AND ?")
    .all(start, end) as { primary_category: string; duration_minutes: number }[];

  const browserEvents = db
    .prepare("SELECT primary_category, duration_minutes FROM browser_events WHERE start_time BETWEEN ? AND ?")
    .all(start, end) as { primary_category: string; duration_minutes: number }[];

  // Build category minute totals
  const catMinutes = new Map<string, number>();
  for (const p of prompts) {
    catMinutes.set(p.primary_category, (catMinutes.get(p.primary_category) || 0) + p.attributed_minutes);
  }
  for (const e of windowEvents) {
    catMinutes.set(e.primary_category, (catMinutes.get(e.primary_category) || 0) + e.duration_minutes);
  }
  for (const e of calendarEvents) {
    catMinutes.set(e.primary_category, (catMinutes.get(e.primary_category) || 0) + e.duration_minutes);
  }
  for (const e of browserEvents) {
    catMinutes.set(e.primary_category, (catMinutes.get(e.primary_category) || 0) + e.duration_minutes);
  }

  const totalMinutes = Array.from(catMinutes.values()).reduce((s, m) => s + m, 0);
  if (totalMinutes < 60) return null;

  // Strategic depth: strategy + requirements
  const strategicMinutes = (catMinutes.get("strategy") || 0) + (catMinutes.get("requirements") || 0);
  const strategicPct = (strategicMinutes / totalMinutes) * 100;
  const strategicScore = Math.min(100, (strategicPct / 40) * 100); // 40% = perfect

  // Focus quality: longest continuous same-category block from window events
  const allEvents = [
    ...windowEvents.map(e => ({ category: e.primary_category, start: new Date(e.start_time).getTime(), minutes: e.duration_minutes })),
    ...prompts.map(p => ({ category: p.primary_category, start: new Date(p.timestamp).getTime(), minutes: p.attributed_minutes })),
  ].sort((a, b) => a.start - b.start);

  let longestBlockMinutes = 0;
  if (allEvents.length > 0) {
    let curCat = allEvents[0].category;
    let curMins = allEvents[0].minutes;
    for (let i = 1; i < allEvents.length; i++) {
      const e = allEvents[i];
      const prevEnd = allEvents[i - 1].start + allEvents[i - 1].minutes * 60000;
      const gapMins = (e.start - prevEnd) / 60000;
      if (e.category === curCat && gapMins <= 10) {
        curMins += e.minutes;
      } else {
        longestBlockMinutes = Math.max(longestBlockMinutes, curMins);
        curCat = e.category;
        curMins = e.minutes;
      }
    }
    longestBlockMinutes = Math.max(longestBlockMinutes, curMins);
  }
  const focusScore = Math.min(100, (longestBlockMinutes / 30) * 100); // 30 min = perfect

  // Reactive ratio: communication + meetings (calendar)
  const reactiveMeetingMinutes = catMinutes.get("communication") || 0;
  const meetingMinutes = calendarEvents.reduce((s, e) => s + e.duration_minutes, 0);
  const reactiveMinutes = reactiveMeetingMinutes + meetingMinutes;
  const reactivePct = (reactiveMinutes / totalMinutes) * 100;
  const reactiveScore = Math.min(100, Math.max(0, ((30 - reactivePct) / 30) * 100)); // 0% = perfect, 30%+ = 0

  // Weighted score
  const score = Math.round(
    strategicScore * 0.4 + focusScore * 0.35 + reactiveScore * 0.25
  );

  // Label
  let label: ScoreBreakdown["label"];
  if (score >= 70) label = "Focus Day";
  else if (score <= 35) label = "Reactive Day";
  else label = "Mixed";

  return {
    score,
    strategic_pct: Math.round(strategicPct),
    focus_minutes: Math.round(longestBlockMinutes),
    reactive_pct: Math.round(reactivePct),
    label,
  };
}

/**
 * Persist a computed score to daily_scores table (upsert).
 */
export function persistScore(date: string, breakdown: ScoreBreakdown): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO daily_scores (date, score, strategic_score, focus_score, reactive_score)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      score = excluded.score,
      strategic_score = excluded.strategic_score,
      focus_score = excluded.focus_score,
      reactive_score = excluded.reactive_score,
      computed_at = datetime('now')
  `).run(date, breakdown.score, breakdown.strategic_pct, breakdown.focus_minutes, breakdown.reactive_pct);
}

/**
 * Load persisted scores for a date range.
 */
export function loadScores(startDate: string, endDate: string): { date: string; score: number }[] {
  const db = getDb();
  return db
    .prepare("SELECT date, score FROM daily_scores WHERE date BETWEEN ? AND ? ORDER BY date ASC")
    .all(startDate, endDate) as { date: string; score: number }[];
}
