import { NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";
import { getDayBounds, shiftDate } from "@/lib/date-utils";
import {
  buildIntervals,
  deduplicateIntervals,
} from "@/lib/attribution/source-merger";
import type {
  PromptRow,
  CalendarEventRow,
  WindowEventRow,
  BrowserEventRow,
  DigestData,
} from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function computeWeekBounds(endDate: string): { start: string; end: string } {
  const d = new Date(endDate + "T12:00:00");
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return {
    start: mon.toISOString().slice(0, 10),
    end: sun.toISOString().slice(0, 10),
  };
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let cur = start;
  while (cur <= end) {
    dates.push(cur);
    cur = shiftDate(cur, 1);
  }
  return dates;
}

async function computeWeekStats(
  db: ReturnType<typeof getDb>,
  startDate: string,
  endDate: string
) {
  const { start: windowStart } = getDayBounds(startDate);
  const { end: windowEnd } = getDayBounds(endDate);

  const prompts = db
    .prepare("SELECT * FROM prompts WHERE timestamp BETWEEN ? AND ?")
    .all(windowStart, windowEnd) as PromptRow[];
  const calendarEvents = db
    .prepare(
      "SELECT * FROM calendar_events WHERE start_time BETWEEN ? AND ?"
    )
    .all(windowStart, windowEnd) as CalendarEventRow[];
  const windowEvents = db
    .prepare(
      "SELECT * FROM window_events WHERE start_time BETWEEN ? AND ?"
    )
    .all(windowStart, windowEnd) as WindowEventRow[];
  const browserEvents = db
    .prepare(
      "SELECT * FROM browser_events WHERE start_time BETWEEN ? AND ? AND domain NOT IN ('localhost', '127.0.0.1', '[::1]')"
    )
    .all(windowStart, windowEnd) as BrowserEventRow[];

  const intervals = deduplicateIntervals(
    buildIntervals(prompts, calendarEvents, windowEvents, browserEvents)
  );
  const totalMinutes = intervals.reduce(
    (s, i) => s + i.effective_minutes,
    0
  );
  const meetingMinutes = intervals
    .filter((i) => i.source === "calendar")
    .reduce((s, i) => s + i.effective_minutes, 0);
  const focusMinutes = intervals
    .filter((i) => i.source !== "calendar")
    .reduce((s, i) => s + i.effective_minutes, 0);

  return {
    total_hours: Math.round((totalMinutes / 60) * 100) / 100,
    meeting_hours: Math.round((meetingMinutes / 60) * 100) / 100,
    focus_hours: Math.round((focusMinutes / 60) * 100) / 100,
    total_events:
      prompts.length +
      calendarEvents.length +
      windowEvents.length +
      browserEvents.length,
    intervals,
    prompts,
    calendarEvents,
    windowEvents,
  };
}

export async function GET(
  request: Request
): Promise<NextResponse<DigestData | { error: string }>> {
  try {
    const { searchParams } = new URL(request.url);
    let endDate =
      searchParams.get("end_date") || new Date().toISOString().slice(0, 10);
    if (!DATE_RE.test(endDate))
      endDate = new Date().toISOString().slice(0, 10);

    await initDb();
    const db = getDb();

    const thisWeek = computeWeekBounds(endDate);
    const lastWeekEnd = shiftDate(thisWeek.start, -1);
    const lastWeek = computeWeekBounds(lastWeekEnd);

    const categories = db
      .prepare("SELECT slug, name, color FROM categories")
      .all() as { slug: string; name: string; color: string }[];
    const categoryMeta = new Map(categories.map((c) => [c.slug, c]));

    const [thisStats, lastStats] = await Promise.all([
      computeWeekStats(db, thisWeek.start, thisWeek.end),
      computeWeekStats(db, lastWeek.start, lastWeek.end),
    ]);

    // Daily hours for this week
    const daily_hours = await Promise.all(
      dateRange(thisWeek.start, thisWeek.end).map(async (date) => {
        const { start, end } = getDayBounds(date);
        const ps = db
          .prepare("SELECT * FROM prompts WHERE timestamp BETWEEN ? AND ?")
          .all(start, end) as PromptRow[];
        const ces = db
          .prepare(
            "SELECT * FROM calendar_events WHERE start_time BETWEEN ? AND ?"
          )
          .all(start, end) as CalendarEventRow[];
        const wes = db
          .prepare(
            "SELECT * FROM window_events WHERE start_time BETWEEN ? AND ?"
          )
          .all(start, end) as WindowEventRow[];
        const bes = db
          .prepare(
            "SELECT * FROM browser_events WHERE start_time BETWEEN ? AND ? AND domain NOT IN ('localhost','127.0.0.1','[::1]')"
          )
          .all(start, end) as BrowserEventRow[];
        const dayIntervals = deduplicateIntervals(
          buildIntervals(ps, ces, wes, bes)
        );
        const mins = dayIntervals.reduce((s, i) => s + i.effective_minutes, 0);
        return { date, hours: Math.round((mins / 60) * 100) / 100 };
      })
    );

    // Category breakdown (this week vs last week)
    function getCatMinutes(
      intervals: ReturnType<typeof deduplicateIntervals>
    ) {
      const m = new Map<string, number>();
      for (const i of intervals) {
        m.set(
          i.primary_category,
          (m.get(i.primary_category) ?? 0) + i.effective_minutes
        );
      }
      return m;
    }
    const thisCats = getCatMinutes(thisStats.intervals);
    const lastCats = getCatMinutes(lastStats.intervals);
    const allCatSlugs = new Set([...thisCats.keys(), ...lastCats.keys()]);
    const category_breakdown = Array.from(allCatSlugs)
      .map((slug) => {
        const meta = categoryMeta.get(slug) ?? { name: slug, color: "#888" };
        const tw = thisCats.get(slug) ?? 0;
        const lw = lastCats.get(slug) ?? 0;
        return {
          category: slug,
          name: meta.name,
          color: meta.color,
          this_week_minutes: Math.round(tw),
          last_week_minutes: Math.round(lw),
          delta_minutes: Math.round(tw - lw),
        };
      })
      .sort((a, b) => b.this_week_minutes - a.this_week_minutes);

    // Superlatives
    let longest_focus: DigestData["superlatives"]["longest_focus"] = null;
    if (thisStats.windowEvents.length > 0) {
      const sorted = [...thisStats.windowEvents].sort(
        (a, b) => b.duration_minutes - a.duration_minutes
      );
      const top = sorted[0];
      if (top && top.duration_minutes >= 15) {
        longest_focus = {
          date: top.start_time.slice(0, 10),
          minutes: Math.round(top.duration_minutes),
          app: top.app_name,
        };
      }
    }

    // Busiest meeting day
    const meetingsByDay = new Map<string, number>();
    for (const e of thisStats.calendarEvents) {
      const d = e.start_time.slice(0, 10);
      meetingsByDay.set(d, (meetingsByDay.get(d) ?? 0) + 1);
    }
    let busiest_meeting_day: DigestData["superlatives"]["busiest_meeting_day"] =
      null;
    for (const [date, count] of meetingsByDay) {
      if (!busiest_meeting_day || count > busiest_meeting_day.meetings) {
        busiest_meeting_day = { date, meetings: count };
      }
    }

    // Narrative
    const narrative: string[] = [];
    const delta = thisStats.total_hours - lastStats.total_hours;
    if (thisStats.total_hours === 0) {
      narrative.push("No activity tracked this week yet.");
    } else {
      const topCat = category_breakdown[0];
      if (topCat) {
        const pct =
          thisStats.total_hours > 0
            ? Math.round(
                (topCat.this_week_minutes / (thisStats.total_hours * 60)) * 100
              )
            : 0;
        narrative.push(
          `${topCat.name}-heavy week: ${pct}% of your ${Math.round(thisStats.total_hours)}h tracked.`
        );
      }
      if (lastStats.total_hours > 0) {
        const sign = delta >= 0 ? "+" : "";
        narrative.push(
          `${sign}${Math.abs(Math.round(delta * 10) / 10)}h vs last week (${Math.round(lastStats.total_hours)}h).`
        );
      }
    }

    return NextResponse.json({
      this_week: {
        start: thisWeek.start,
        end: thisWeek.end,
        total_hours: thisStats.total_hours,
        meeting_hours: thisStats.meeting_hours,
        focus_hours: thisStats.focus_hours,
        total_events: thisStats.total_events,
      },
      last_week: {
        start: lastWeek.start,
        end: lastWeek.end,
        total_hours: lastStats.total_hours,
        meeting_hours: lastStats.meeting_hours,
        focus_hours: lastStats.focus_hours,
        total_events: lastStats.total_events,
      },
      daily_hours,
      narrative,
      superlatives: {
        longest_focus,
        busiest_meeting_day,
        best_focus_score_day: null,
      },
      category_breakdown,
    });
  } catch (err) {
    console.error("Digest API error:", err);
    return NextResponse.json(
      { error: "Internal server error" } as { error: string },
      { status: 500 }
    );
  }
}
