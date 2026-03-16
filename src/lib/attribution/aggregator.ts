import type { PromptRow, CategoryBreakdown, ProjectBreakdown } from "../types";
import { detectSessions } from "./session-detector";

export interface SessionSummary {
  startTime: string;
  endTime: string;
  duration_minutes: number;
  prompt_count: number;
  category_breakdown: { category: string; minutes: number; percentage: number }[];
}

export interface DailySummary {
  total_hours: number;
  total_sessions: number;
  total_prompts: number;
  top_category: string | null;
  category_breakdown: CategoryBreakdown[];
  project_breakdown: ProjectBreakdown[];
}

export function aggregateSessions(
  prompts: PromptRow[],
  sessionGapMinutes: number = 30
): SessionSummary[] {
  const sessions = detectSessions(prompts, sessionGapMinutes);

  return sessions.map((session) => {
    const totalMinutes = session.reduce((sum, p) => sum + p.attributed_minutes, 0);

    const byCategory = new Map<string, number>();
    for (const p of session) {
      byCategory.set(
        p.primary_category,
        (byCategory.get(p.primary_category) || 0) + p.attributed_minutes
      );
    }

    const category_breakdown = Array.from(byCategory.entries()).map(
      ([category, minutes]) => ({
        category,
        minutes,
        percentage: totalMinutes > 0 ? (minutes / totalMinutes) * 100 : 0,
      })
    );

    return {
      startTime: session[0].timestamp,
      endTime: session[session.length - 1].timestamp,
      duration_minutes: totalMinutes,
      prompt_count: session.length,
      category_breakdown,
    };
  });
}

export function aggregateDaily(
  prompts: PromptRow[],
  categoryMeta: Map<string, { name: string; color: string }>,
  sessionGapMinutes: number = 30
): DailySummary {
  const sessions = detectSessions(prompts, sessionGapMinutes);
  const totalMinutes = prompts.reduce((sum, p) => sum + p.attributed_minutes, 0);

  // Category breakdown
  const byCategory = new Map<string, { minutes: number; subcats: Map<string, number> }>();
  for (const p of prompts) {
    const existing = byCategory.get(p.primary_category) || {
      minutes: 0,
      subcats: new Map(),
    };
    existing.minutes += p.attributed_minutes;
    existing.subcats.set(
      p.primary_subcategory,
      (existing.subcats.get(p.primary_subcategory) || 0) + p.attributed_minutes
    );
    byCategory.set(p.primary_category, existing);
  }

  const category_breakdown: CategoryBreakdown[] = Array.from(
    byCategory.entries()
  )
    .map(([slug, data]) => {
      const meta = categoryMeta.get(slug) || { name: slug, color: "#888" };
      return {
        category: slug,
        name: meta.name,
        color: meta.color,
        minutes: Math.round(data.minutes * 100) / 100,
        percentage: totalMinutes > 0 ? (data.minutes / totalMinutes) * 100 : 0,
        subcategories: Array.from(data.subcats.entries()).map(([sub, min]) => ({
          subcategory: sub,
          name: sub,
          minutes: Math.round(min * 100) / 100,
        })),
      };
    })
    .sort((a, b) => b.minutes - a.minutes);

  // Project breakdown
  const byProject = new Map<string, { minutes: number; count: number }>();
  for (const p of prompts) {
    const proj = p.project_name || "unknown";
    const existing = byProject.get(proj) || { minutes: 0, count: 0 };
    existing.minutes += p.attributed_minutes;
    existing.count += 1;
    byProject.set(proj, existing);
  }

  const project_breakdown: ProjectBreakdown[] = Array.from(
    byProject.entries()
  )
    .map(([project, data]) => ({
      project,
      minutes: Math.round(data.minutes * 100) / 100,
      prompt_count: data.count,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  // Top category
  const topCategory =
    category_breakdown.length > 0 ? category_breakdown[0].category : null;

  return {
    total_hours: Math.round((totalMinutes / 60) * 100) / 100,
    total_sessions: sessions.length,
    total_prompts: prompts.length,
    top_category: topCategory,
    category_breakdown,
    project_breakdown,
  };
}
