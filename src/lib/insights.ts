import { getDb } from "./db";
import { getDayBounds, shiftDate } from "./date-utils";
import type { AnomalyAlert, HourlyHeatmapCell } from "./types";

/**
 * Compute anomaly alerts for a given date using a 14-day rolling baseline.
 * Returns alerts for metrics that are statistically unusual (|z| > 1.5).
 */
export function computeAnomalyAlerts(date: string): AnomalyAlert[] {
  const db = getDb();
  const alerts: AnomalyAlert[] = [];

  // Build 14-day baseline (excluding the target date)
  const baselineData: { totalMinutes: number; meetingMinutes: number; focusMinutes: number }[] = [];
  for (let i = 1; i <= 14; i++) {
    const d = shiftDate(date, -i);
    const { start, end } = getDayBounds(d);

    const promptMins = (db.prepare("SELECT COALESCE(SUM(attributed_minutes), 0) as m FROM prompts WHERE timestamp BETWEEN ? AND ?").get(start, end) as { m: number }).m;
    const windowMins = (db.prepare("SELECT COALESCE(SUM(duration_minutes), 0) as m FROM window_events WHERE start_time BETWEEN ? AND ?").get(start, end) as { m: number }).m;
    const browserMins = (db.prepare("SELECT COALESCE(SUM(duration_minutes), 0) as m FROM browser_events WHERE start_time BETWEEN ? AND ?").get(start, end) as { m: number }).m;
    const calMins = (db.prepare("SELECT COALESCE(SUM(duration_minutes), 0) as m FROM calendar_events WHERE start_time BETWEEN ? AND ?").get(start, end) as { m: number }).m;

    const total = promptMins + windowMins + browserMins + calMins;
    if (total < 30) continue; // Skip days with no data

    baselineData.push({
      totalMinutes: total,
      meetingMinutes: calMins,
      focusMinutes: promptMins + windowMins + browserMins,
    });
  }

  if (baselineData.length < 5) return []; // Need at least 5 days for meaningful baseline

  function stats(values: number[]): { mean: number; stddev: number } {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
    return { mean, stddev: Math.sqrt(variance) };
  }

  // Today's values
  const { start: todayStart, end: todayEnd } = getDayBounds(date);
  const todayPromptMins = (db.prepare("SELECT COALESCE(SUM(attributed_minutes), 0) as m FROM prompts WHERE timestamp BETWEEN ? AND ?").get(todayStart, todayEnd) as { m: number }).m;
  const todayWindowMins = (db.prepare("SELECT COALESCE(SUM(duration_minutes), 0) as m FROM window_events WHERE start_time BETWEEN ? AND ?").get(todayStart, todayEnd) as { m: number }).m;
  const todayBrowserMins = (db.prepare("SELECT COALESCE(SUM(duration_minutes), 0) as m FROM browser_events WHERE start_time BETWEEN ? AND ?").get(todayStart, todayEnd) as { m: number }).m;
  const todayCalMins = (db.prepare("SELECT COALESCE(SUM(duration_minutes), 0) as m FROM calendar_events WHERE start_time BETWEEN ? AND ?").get(todayStart, todayEnd) as { m: number }).m;
  const todayTotal = todayPromptMins + todayWindowMins + todayBrowserMins + todayCalMins;

  if (todayTotal < 30) return []; // Not enough data today

  // Check meeting minutes
  const meetingStats = stats(baselineData.map(d => d.meetingMinutes));
  if (meetingStats.stddev > 0) {
    const z = (todayCalMins - meetingStats.mean) / meetingStats.stddev;
    if (z > 1.5) {
      const hours = Math.round(todayCalMins / 6) / 10;
      const baseHours = Math.round(meetingStats.mean / 6) / 10;
      alerts.push({
        type: "high_meetings",
        message: `${hours}h in meetings today - ${Math.round(z * 10) / 10}x your 14-day average (${baseHours}h)`,
        severity: "warning",
        metric: "meeting_minutes",
        value: todayCalMins,
        baseline: meetingStats.mean,
        z_score: Math.round(z * 100) / 100,
      });
    }
  }

  // Check focus minutes
  const focusStats = stats(baselineData.map(d => d.focusMinutes));
  if (focusStats.stddev > 0) {
    const z = (todayPromptMins + todayWindowMins + todayBrowserMins - focusStats.mean) / focusStats.stddev;
    if (z < -1.5) {
      const hours = Math.round((todayPromptMins + todayWindowMins + todayBrowserMins) / 6) / 10;
      const baseHours = Math.round(focusStats.mean / 6) / 10;
      alerts.push({
        type: "low_focus",
        message: `${hours}h focus time today - below your ${baseHours}h average`,
        severity: "info",
        metric: "focus_minutes",
        value: todayPromptMins + todayWindowMins + todayBrowserMins,
        baseline: focusStats.mean,
        z_score: Math.round(z * 100) / 100,
      });
    }
  }

  return alerts;
}

/**
 * Compute hourly heatmap data for the last N days.
 * Returns one cell per (hour, day_of_week) combination that has data.
 */
export function computeHourlyHeatmap(days = 28): HourlyHeatmapCell[] {
  const db = getDb();
  const endDate = new Date().toISOString().split("T")[0];
  const startDate = shiftDate(endDate, -(days - 1));
  const startISO = `${startDate}T00:00:00`;
  const endISO = `${endDate}T23:59:59`;

  // Accumulate hour x dayOfWeek -> { minutes: number, catMinutes: Map<string, number> }
  const heatmap = new Map<string, { minutes: number; catMinutes: Map<string, number> }>();

  function addEvent(timestampStr: string, durationMinutes: number, category: string) {
    const dt = new Date(timestampStr);
    const hour = dt.getHours();
    const dow = (dt.getDay() + 6) % 7; // 0=Mon, 6=Sun
    const key = `${hour}_${dow}`;
    if (!heatmap.has(key)) heatmap.set(key, { minutes: 0, catMinutes: new Map() });
    const cell = heatmap.get(key)!;
    cell.minutes += durationMinutes;
    cell.catMinutes.set(category, (cell.catMinutes.get(category) || 0) + durationMinutes);
  }

  const prompts = db
    .prepare("SELECT timestamp, attributed_minutes, primary_category FROM prompts WHERE timestamp BETWEEN ? AND ?")
    .all(startISO, endISO) as { timestamp: string; attributed_minutes: number; primary_category: string }[];
  for (const p of prompts) addEvent(p.timestamp, p.attributed_minutes, p.primary_category);

  const windowEvents = db
    .prepare("SELECT start_time, duration_minutes, primary_category FROM window_events WHERE start_time BETWEEN ? AND ?")
    .all(startISO, endISO) as { start_time: string; duration_minutes: number; primary_category: string }[];
  for (const e of windowEvents) addEvent(e.start_time, e.duration_minutes, e.primary_category);

  const browserEvents = db
    .prepare("SELECT start_time, duration_minutes, primary_category FROM browser_events WHERE start_time BETWEEN ? AND ?")
    .all(startISO, endISO) as { start_time: string; duration_minutes: number; primary_category: string }[];
  for (const e of browserEvents) addEvent(e.start_time, e.duration_minutes, e.primary_category);

  const calendarEvents = db
    .prepare("SELECT start_time, duration_minutes, primary_category FROM calendar_events WHERE start_time BETWEEN ? AND ?")
    .all(startISO, endISO) as { start_time: string; duration_minutes: number; primary_category: string }[];
  for (const e of calendarEvents) addEvent(e.start_time, e.duration_minutes, e.primary_category);

  const result: HourlyHeatmapCell[] = [];
  for (const [key, cell] of heatmap.entries()) {
    const [hourStr, dowStr] = key.split("_");
    let dominantCat: string | null = null;
    let maxMins = 0;
    for (const [cat, mins] of cell.catMinutes.entries()) {
      if (mins > maxMins) { maxMins = mins; dominantCat = cat; }
    }
    result.push({
      hour: parseInt(hourStr),
      day_of_week: parseInt(dowStr),
      minutes: Math.round(cell.minutes),
      dominant_category: dominantCat,
    });
  }

  return result;
}

/**
 * Compute temporal rhythm insights: peak hours per category.
 */
export function computeTemporalRhythm(days = 14): { category: string; peak_hour_start: number; peak_hour_end: number; pct_in_peak: number }[] {
  const heatmap = computeHourlyHeatmap(days);
  if (heatmap.length === 0) return [];

  // Group by category x hour
  const catHourMinutes = new Map<string, Map<number, number>>();
  for (const cell of heatmap) {
    if (!cell.dominant_category) continue;
    const cat = cell.dominant_category;
    if (!catHourMinutes.has(cat)) catHourMinutes.set(cat, new Map());
    const hourMap = catHourMinutes.get(cat)!;
    hourMap.set(cell.hour, (hourMap.get(cell.hour) || 0) + cell.minutes);
  }

  const result = [];
  for (const [category, hourMap] of catHourMinutes.entries()) {
    const total = Array.from(hourMap.values()).reduce((s, m) => s + m, 0);
    if (total < 30) continue;

    // Find peak hour
    let peakHour = 9;
    let peakMins = 0;
    for (const [hour, mins] of hourMap.entries()) {
      if (mins > peakMins) { peakMins = mins; peakHour = hour; }
    }

    result.push({
      category,
      peak_hour_start: peakHour,
      peak_hour_end: peakHour + 2,
      pct_in_peak: Math.round((peakMins / total) * 100),
    });
  }

  return result.sort((a, b) => b.pct_in_peak - a.pct_in_peak);
}
