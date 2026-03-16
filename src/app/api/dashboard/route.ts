import { NextResponse } from "next/server";
import { initDb, loadSettings, getDb } from "@/lib/db";
import { processEvents } from "@/lib/ingestion/processor";
import { processWindowEvents } from "@/lib/ingestion/window-ingestor";
import { processBrowserEvents } from "@/lib/ingestion/browser-ingestor";
import { syncCalendarIfDue } from "@/lib/ingestion/calendar-ingestor";
import { classifyPendingWithLLM } from "@/lib/ingestion/llm-processor";
import { captureMultiSourceTrainingItems } from "@/lib/ingestion/training-collector";
import { aggregateDaily } from "@/lib/attribution/aggregator";
import { buildIntervals, deduplicateIntervals } from "@/lib/attribution/source-merger";
import { todayStr, shiftDate, getDayBounds, currentWorkday } from "@/lib/date-utils";
import { DEFAULT_SESSION_GAP_MINUTES } from "@/lib/constants";
import type {
  PromptRow,
  CalendarEventRow,
  WindowEventRow,
  BrowserEventRow,
  DashboardData,
  ActivitySummary,
} from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Module-level mutex: prevents duplicate ingestion when requests overlap
let ingestInFlight = false;

export async function GET(request: Request): Promise<NextResponse<DashboardData | { error: string }>> {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || currentWorkday();

    if (!DATE_RE.test(date) || isNaN(Date.parse(date))) {
      return NextResponse.json(
        { error: "Invalid date format. Use YYYY-MM-DD." } as { error: string },
        { status: 400 }
      );
    }

    await initDb();
    const db = getDb();
    const settings = loadSettings();

    const windowTrackingEnabled = settings.window_tracking_enabled;
    const browserTrackingEnabled = settings.browser_tracking_enabled;
    const autoRefresh = settings.dashboard_auto_refresh;

    // Process pending events — skip if already running (e.g. two tabs open simultaneously)
    if (!ingestInFlight) {
      ingestInFlight = true;
      try {
        if (windowTrackingEnabled) {
          processWindowEvents({ skipBrowserApps: browserTrackingEnabled });
        }
        processEvents();
        if (browserTrackingEnabled) {
          await processBrowserEvents();
        }
        syncCalendarIfDue();
        classifyPendingWithLLM().catch((e) => console.error("LLM classify error:", e));
        captureMultiSourceTrainingItems().catch((e) => console.error("Multi-source training capture error:", e));
      } finally {
        ingestInFlight = false;
      }
    }

    // Work day runs 8am ET → 8am ET next day (handles late-night work correctly)
    const { start: startOfDay, end: endOfDay } = getDayBounds(date);
    const now = new Date().toISOString();
    const isToday = date === currentWorkday();
    // For today, don't show calendar events that haven't started yet
    const calendarEndBound = isToday ? (now < endOfDay ? now : endOfDay) : endOfDay;

    // Query all three sources
    const prompts = db
      .prepare("SELECT * FROM prompts WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC")
      .all(startOfDay, endOfDay) as PromptRow[];

    const blockKeyword = settings.calendar_block_keyword.toLowerCase().trim();

    const allCalendarEvents = db
      .prepare("SELECT * FROM calendar_events WHERE start_time BETWEEN ? AND ? ORDER BY start_time ASC")
      .all(startOfDay, calendarEndBound) as CalendarEventRow[];
    const calendarEvents = blockKeyword
      ? allCalendarEvents.filter((e) => !e.summary.toLowerCase().includes(blockKeyword))
      : allCalendarEvents;

    // Always query stored events regardless of current tracking settings.
    // The settings only gate whether *new* events are ingested, not whether
    // existing data is displayed.
    const windowEvents = db
      .prepare("SELECT * FROM window_events WHERE start_time BETWEEN ? AND ? ORDER BY start_time ASC")
      .all(startOfDay, endOfDay) as WindowEventRow[];

    const browserEvents = db
      .prepare("SELECT * FROM browser_events WHERE start_time BETWEEN ? AND ? AND domain NOT IN ('localhost', '127.0.0.1', '[::1]') ORDER BY start_time ASC")
      .all(startOfDay, endOfDay) as BrowserEventRow[];

    // Load category metadata
    const categories = db
      .prepare("SELECT slug, name, color FROM categories")
      .all() as { slug: string; name: string; color: string }[];
    const categoryMeta = new Map(categories.map((c) => [c.slug, c]));

    // Aggregate prompts (existing logic for sessions/projects)
    // Session gap is an internal constant for display grouping only
    const daily = aggregateDaily(prompts, categoryMeta, DEFAULT_SESSION_GAP_MINUTES);

    // Deduplicate overlapping intervals across all 4 sources
    const rawIntervals = buildIntervals(prompts, calendarEvents, windowEvents, browserEvents);
    const dedupedIntervals = deduplicateIntervals(rawIntervals);

    // Rebuild category totals from deduped effective minutes
    const catMap = new Map(
      daily.category_breakdown.map((c) => [
        c.category,
        { ...c, minutes: 0, subcategories: c.subcategories.map((s) => ({ ...s, minutes: 0 })) },
      ])
    );

    for (const interval of dedupedIntervals) {
      const mins = interval.effective_minutes;
      if (mins <= 0) continue;
      const existing = catMap.get(interval.primary_category);
      if (existing) {
        existing.minutes += mins;
        const sub = existing.subcategories.find((s) => s.subcategory === interval.primary_subcategory);
        if (sub) sub.minutes += mins;
        else existing.subcategories.push({ subcategory: interval.primary_subcategory, name: interval.primary_subcategory, minutes: mins });
      } else {
        const meta = categoryMeta.get(interval.primary_category) || { name: interval.primary_category, color: "#888" };
        catMap.set(interval.primary_category, {
          category: interval.primary_category, name: meta.name, color: meta.color,
          minutes: mins, percentage: 0,
          subcategories: [{ subcategory: interval.primary_subcategory, name: interval.primary_subcategory, minutes: mins }],
        });
      }
    }

    const totalMinutes = Array.from(catMap.values()).reduce((s, c) => s + c.minutes, 0);

    // Recalculate percentages
    const mergedCategories = Array.from(catMap.values())
      .map((c) => ({ ...c, percentage: totalMinutes > 0 ? (c.minutes / totalMinutes) * 100 : 0 }))
      .sort((a, b) => b.minutes - a.minutes);

    // Compute tracked vs. expected work hours (Phase 8b)
    const expectedMinutes = 8 * 60; // hardcoded; Phase 8e will make this configurable
    const trackedPct = totalMinutes > 0 ? Math.round((totalMinutes / expectedMinutes) * 100) : 0;

    // Compute source-level minute totals from deduped intervals
    const claudeMinutes   = dedupedIntervals.filter((i) => i.source === "prompt").reduce((s, i) => s + i.effective_minutes, 0);
    const calendarMinutes = dedupedIntervals.filter((i) => i.source === "calendar").reduce((s, i) => s + i.effective_minutes, 0);
    const windowMinutes   = dedupedIntervals.filter((i) => i.source === "window").reduce((s, i) => s + i.effective_minutes, 0);
    const browserMinutes  = dedupedIntervals.filter((i) => i.source === "browser").reduce((s, i) => s + i.effective_minutes, 0);
    const focusMinutes    = Math.round(claudeMinutes + windowMinutes + browserMinutes);

    // Fetch yesterday's totals
    const yesterdayDate = shiftDate(date, -1);
    const { start: yesterdayStart, end: yesterdayEnd } = getDayBounds(yesterdayDate);
    const yesterdayPrompts = db
      .prepare("SELECT * FROM prompts WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC")
      .all(yesterdayStart, yesterdayEnd) as PromptRow[];
    const yesterdayCalendarEvents = db
      .prepare("SELECT start_time, end_time, duration_minutes, primary_category, primary_subcategory FROM calendar_events WHERE start_time BETWEEN ? AND ?")
      .all(yesterdayStart, yesterdayEnd) as Pick<CalendarEventRow, "start_time" | "end_time" | "duration_minutes" | "primary_category" | "primary_subcategory">[];
    const yesterdayWindowEvents = db
      .prepare("SELECT start_time, duration_minutes, primary_category, primary_subcategory FROM window_events WHERE start_time BETWEEN ? AND ?")
      .all(yesterdayStart, yesterdayEnd) as Pick<WindowEventRow, "start_time" | "duration_minutes" | "primary_category" | "primary_subcategory">[];
    const yesterdayBrowserEvents = db
      .prepare("SELECT start_time, duration_minutes, primary_category, primary_subcategory FROM browser_events WHERE start_time BETWEEN ? AND ?")
      .all(yesterdayStart, yesterdayEnd) as Pick<BrowserEventRow, "start_time" | "duration_minutes" | "primary_category" | "primary_subcategory">[];
    const yesterdayDaily = aggregateDaily(yesterdayPrompts, categoryMeta, DEFAULT_SESSION_GAP_MINUTES);
    const yesterdayDeduped = deduplicateIntervals(
      buildIntervals(yesterdayPrompts, yesterdayCalendarEvents, yesterdayWindowEvents, yesterdayBrowserEvents)
    );
    const yesterdayTotalMinutes = yesterdayDeduped.reduce((s, i) => s + i.effective_minutes, 0);
    const yesterdayFocusMinutes = Math.round(
      yesterdayDeduped.filter((i) => i.source !== "calendar").reduce((s, i) => s + i.effective_minutes, 0)
    );

    // Build unified ActivitySummary list
    const activities: ActivitySummary[] = [
      ...prompts.map((p): ActivitySummary => ({
        id: p.id,
        source: "prompt",
        timestamp: p.timestamp,
        title: p.prompt_preview || "(redacted)",
        primary_category: p.primary_category,
        primary_subcategory: p.primary_subcategory,
        primary_confidence: p.primary_confidence,
        attributed_minutes: p.attributed_minutes,
        project_name: p.project_name,
        classification_method: p.classification_method,
        classification_reasoning: p.classification_reasoning,
        attribution_method: p.attribution_method,
        time_confidence: p.time_confidence,
        gap_to_next_seconds: p.gap_to_next_seconds,
        response_duration_seconds: p.response_duration_seconds,
      })),
      ...calendarEvents.map((e): ActivitySummary => ({
        id: e.id,
        source: "calendar",
        timestamp: e.start_time,
        title: e.summary,
        primary_category: e.primary_category,
        primary_subcategory: e.primary_subcategory,
        primary_confidence: e.primary_confidence,
        attributed_minutes: e.duration_minutes,
        attendee_count: e.attendee_count,
        location: e.location,
        end_time: e.end_time,
        classification_reasoning: e.classification_reasoning,
      })),
      ...windowEvents.map((e): ActivitySummary => ({
        id: e.id,
        source: "window",
        timestamp: e.start_time,
        title: e.app_name,
        primary_category: e.primary_category,
        primary_subcategory: e.primary_subcategory,
        primary_confidence: e.primary_confidence,
        attributed_minutes: e.duration_minutes,
        classification_reasoning: e.classification_reasoning,
      })),
      ...browserEvents.map((e): ActivitySummary => ({
        id: e.id,
        source: "browser",
        timestamp: e.start_time,
        title: e.page_title || e.domain,
        primary_category: e.primary_category,
        primary_subcategory: e.primary_subcategory,
        primary_confidence: e.primary_confidence,
        attributed_minutes: e.duration_minutes,
        classification_reasoning: e.classification_reasoning,
      })),
    ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return NextResponse.json({
      date,
      total_hours: Math.round((totalMinutes / 60) * 100) / 100,
      total_sessions: daily.total_sessions,
      total_prompts: prompts.length,
      total_events: prompts.length + calendarEvents.length + windowEvents.length + browserEvents.length,
      meeting_count: calendarEvents.length,
      focus_minutes: focusMinutes,
      tracked_pct: trackedPct,
      expected_minutes: expectedMinutes,
      source_breakdown: {
        claude_minutes: Math.round(claudeMinutes),
        calendar_minutes: Math.round(calendarMinutes),
        window_minutes: Math.round(windowMinutes),
        browser_minutes: Math.round(browserMinutes),
      },
      top_category: mergedCategories[0]?.category ?? null,
      category_breakdown: mergedCategories,
      project_breakdown: daily.project_breakdown,
      activities,
      yesterday: {
        total_hours: Math.round((yesterdayTotalMinutes / 60) * 100) / 100,
        total_sessions: yesterdayDaily.total_sessions,
        total_prompts: yesterdayDaily.total_prompts,
        meeting_count: yesterdayCalendarEvents.length,
        focus_minutes: yesterdayFocusMinutes,
      },
      auto_refresh: autoRefresh,
    });
  } catch (err) {
    console.error("Dashboard API error:", err);
    return NextResponse.json(
      { error: "Internal server error" } as { error: string },
      { status: 500 }
    );
  }
}
