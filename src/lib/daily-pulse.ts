import type { DashboardData, FocusScoreResult } from "@/lib/types";

function fmt(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function generateDailyPulse(
  data: DashboardData,
  focusScore: FocusScoreResult,
  hasBaseline: boolean
): string[] {
  const totalMinutes = data.total_hours * 60;
  const activities = data.activities ?? [];

  if (activities.length === 0 || totalMinutes === 0) {
    return ["No activity tracked yet today."];
  }

  const sentences: string[] = [];

  // Pick at most 2-3 of the most interesting insights

  // 1. Deep focus day
  if (focusScore.score > 70 && focusScore.longest_block_minutes >= 30) {
    const cat = focusScore.longest_block_category ?? "focused";
    sentences.push(
      `Deep work day — ${fmt(focusScore.longest_block_minutes)} of ${cat} with a focus score of ${focusScore.score}/100.`
    );
  }

  // 2. Fragmented day
  if (sentences.length === 0 && focusScore.score < 40 && focusScore.transitions > 6) {
    sentences.push(
      `Fragmented day: ${focusScore.transitions} context switches — consider protecting longer focus blocks.`
    );
  }

  // 3. Meeting-heavy day
  const meetingMinutes = data.source_breakdown.calendar_minutes;
  if (meetingMinutes > 120 && totalMinutes > 0) {
    const pct = Math.round((meetingMinutes / totalMinutes) * 100);
    if (pct > 50) {
      sentences.push(`Meeting-heavy day: ${fmt(meetingMinutes)} in meetings (${pct}% of tracked time).`);
    }
  }

  // 4. Top category dominance
  const topCat = data.category_breakdown[0];
  if (sentences.length < 2 && topCat && topCat.percentage > 55) {
    sentences.push(
      `${topCat.name}-heavy day: ${Math.round(topCat.percentage)}% of tracked time.`
    );
  }

  // 5. Good focus score
  if (sentences.length < 2 && focusScore.score >= 80) {
    sentences.push(
      `Strong focus: only ${focusScore.transitions} context switch${focusScore.transitions === 1 ? "" : "es"}, longest block ${fmt(focusScore.longest_block_minutes)}.`
    );
  }

  // 6. Vs yesterday (only with baseline)
  if (hasBaseline && sentences.length < 3 && data.yesterday) {
    const delta = data.total_hours - data.yesterday.total_hours;
    if (Math.abs(delta) > 0.5) {
      const direction = delta > 0 ? "more" : "less";
      sentences.push(
        `${fmt(Math.abs(delta * 60))} ${direction} than yesterday (${fmt(data.yesterday.total_hours * 60)} tracked).`
      );
    }
  }

  // 7. Light day fallback
  if (sentences.length === 0) {
    if (totalMinutes < 120) {
      sentences.push(`Light tracked day — ${fmt(totalMinutes)} captured so far.`);
    } else {
      sentences.push(`${fmt(totalMinutes)} tracked today across ${activities.length} activities.`);
    }
  }

  return sentences.slice(0, 3);
}
