import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { todayStr, shiftDate } from "@/lib/date-utils";
import type { PromptRow } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_PERIODS = new Set(["week", "month"]);

interface DailyTotal {
  date: string;
  hours: number;
  prompts: number;
}

interface CategoryTotal {
  category: string;
  name: string;
  color: string;
  minutes: number;
}

interface TrendsData {
  period: "week" | "month";
  start_date: string;
  end_date: string;
  daily_totals: DailyTotal[];
  category_totals: CategoryTotal[];
  daily_by_category: Record<string, number | string>[];
  total_hours: number;
  total_prompts: number;
  total_events: number;
  avg_hours_per_day: number;
  work_pattern_insights: string[];
}

export async function GET(request: Request): Promise<NextResponse<TrendsData | { error: string }>> {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "week";
    const endDate = searchParams.get("end_date") || todayStr();

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json(
        { error: "Invalid period. Use 'week' or 'month'." } as { error: string },
        { status: 400 }
      );
    }

    if (!DATE_RE.test(endDate) || isNaN(Date.parse(endDate))) {
      return NextResponse.json(
        { error: "Invalid end_date format. Use YYYY-MM-DD." } as { error: string },
        { status: 400 }
      );
    }

    const days = period === "week" ? 7 : 30;
    const startDate = shiftDate(endDate, -(days - 1));

    const db = await initDb();

    // Use BETWEEN with full timestamps for index efficiency
    const startOfRange = `${startDate}T00:00:00`;
    const endOfRange = `${endDate}T23:59:59.999`;
    const prompts = db
      .prepare(
        "SELECT * FROM prompts WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC"
      )
      .all(startOfRange, endOfRange) as PromptRow[];

    const calendarEvents = db
      .prepare("SELECT start_time, duration_minutes, primary_category FROM calendar_events WHERE start_time BETWEEN ? AND ?")
      .all(startOfRange, endOfRange) as { start_time: string; duration_minutes: number; primary_category: string }[];

    const windowEvents = db
      .prepare("SELECT start_time, duration_minutes, primary_category FROM window_events WHERE start_time BETWEEN ? AND ?")
      .all(startOfRange, endOfRange) as { start_time: string; duration_minutes: number; primary_category: string }[];

    const browserEvents = db
      .prepare("SELECT start_time, duration_minutes, primary_category FROM browser_events WHERE start_time BETWEEN ? AND ?")
      .all(startOfRange, endOfRange) as { start_time: string; duration_minutes: number; primary_category: string }[];

    const categories = db
      .prepare("SELECT slug, name, color FROM categories")
      .all() as { slug: string; name: string; color: string }[];
    const catMeta = new Map(categories.map((c) => [c.slug, c]));

    // Build daily totals
    const dailyMap = new Map<string, { minutes: number; prompts: number }>();
    const catTotalMap = new Map<string, number>();
    const dailyCatMap = new Map<string, Map<string, number>>();

    // Initialize all dates in range
    for (let i = 0; i < days; i++) {
      const d = shiftDate(startDate, i);
      dailyMap.set(d, { minutes: 0, prompts: 0 });
      dailyCatMap.set(d, new Map());
    }

    for (const p of prompts) {
      const d = p.timestamp.split("T")[0];
      const daily = dailyMap.get(d);
      if (daily) {
        daily.minutes += p.attributed_minutes;
        daily.prompts += 1;
      }

      catTotalMap.set(
        p.primary_category,
        (catTotalMap.get(p.primary_category) || 0) + p.attributed_minutes
      );

      const dayCat = dailyCatMap.get(d);
      if (dayCat) {
        dayCat.set(
          p.primary_category,
          (dayCat.get(p.primary_category) || 0) + p.attributed_minutes
        );
      }
    }

    // Add calendar, window, and browser events to daily and category totals
    const otherEvents = [
      ...calendarEvents.map((e) => ({ date: e.start_time.split("T")[0], minutes: e.duration_minutes, category: e.primary_category })),
      ...windowEvents.map((e) => ({ date: e.start_time.split("T")[0], minutes: e.duration_minutes, category: e.primary_category })),
      ...browserEvents.map((e) => ({ date: e.start_time.split("T")[0], minutes: e.duration_minutes, category: e.primary_category })),
    ];

    for (const e of otherEvents) {
      const daily = dailyMap.get(e.date);
      if (daily) {
        daily.minutes += e.minutes;
      }

      if (e.category) {
        catTotalMap.set(e.category, (catTotalMap.get(e.category) || 0) + e.minutes);

        const dayCat = dailyCatMap.get(e.date);
        if (dayCat) {
          dayCat.set(e.category, (dayCat.get(e.category) || 0) + e.minutes);
        }
      }
    }

    const daily_totals: DailyTotal[] = Array.from(dailyMap.entries()).map(
      ([date, data]) => ({
        date,
        hours: Math.round((data.minutes / 60) * 100) / 100,
        prompts: data.prompts,
      })
    );

    const category_totals: CategoryTotal[] = Array.from(catTotalMap.entries())
      .map(([slug, minutes]) => {
        const meta = catMeta.get(slug) || { name: slug, color: "#888" };
        return { category: slug, name: meta.name, color: meta.color, minutes: Math.round(minutes * 100) / 100 };
      })
      .sort((a, b) => b.minutes - a.minutes);

    const daily_by_category = Array.from(dailyCatMap.entries()).map(
      ([date, catMap]) => {
        const row: Record<string, number | string> = { date };
        for (const [slug, minutes] of catMap.entries()) {
          row[slug] = Math.round((minutes / 60) * 100) / 100;
        }
        return row;
      }
    );

    const totalMinutes = Array.from(dailyMap.values()).reduce((s, d) => s + d.minutes, 0);
    const activeDays = daily_totals.filter((d) => d.hours > 0).length;
    const total_events = prompts.length + calendarEvents.length + windowEvents.length + browserEvents.length;

    // Compute work pattern insights
    const totalCatMinutes = Array.from(catTotalMap.values()).reduce((s, m) => s + m, 0);
    const work_pattern_insights: string[] = [];

    if (totalCatMinutes > 0) {
      const commMinutes = catTotalMap.get("communication") || 0;
      const commPct = Math.round((commMinutes / totalCatMinutes) * 100);
      if (commPct > 40) {
        work_pattern_insights.push(`High communication week - ${commPct}% of tracked time in meetings and stakeholder work`);
      }

      const stratMinutes = catTotalMap.get("strategy") || 0;
      const reqMinutes = catTotalMap.get("requirements") || 0;
      const stratReqPct = Math.round(((stratMinutes + reqMinutes) / totalCatMinutes) * 100);
      if (stratMinutes + reqMinutes > 0 && stratReqPct > 50) {
        work_pattern_insights.push(`Strong strategic focus - ${stratReqPct}% in high-leverage work (strategy + requirements)`);
      } else if (stratReqPct < 15 && totalMinutes > 120) {
        work_pattern_insights.push(`Low strategic work this period - only ${stratReqPct}% in strategy and requirements`);
      }
    }

    const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
    if (totalHours > 40) {
      work_pattern_insights.push(`Productive period - ${totalHours}h tracked across ${activeDays} days`);
    }

    return NextResponse.json({
      period: period as "week" | "month",
      start_date: startDate,
      end_date: endDate,
      daily_totals,
      category_totals,
      daily_by_category,
      total_hours: totalHours,
      total_prompts: prompts.length,
      total_events,
      avg_hours_per_day:
        activeDays > 0
          ? Math.round((totalMinutes / 60 / activeDays) * 100) / 100
          : 0,
      work_pattern_insights,
    });
  } catch (err) {
    console.error("Trends API error:", err);
    return NextResponse.json(
      { error: "Internal server error" } as { error: string },
      { status: 500 }
    );
  }
}

