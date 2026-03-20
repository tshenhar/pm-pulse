#!/usr/bin/env node
/**
 * PM Pulse Weekly Work Report CLI
 * Usage: npm run report [-- --weeks=1] [-- --format=markdown|text]
 *
 * Generates a structured weekly summary of your PM work.
 */

import { execSync } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const DB_PATH = join(homedir(), ".pm-pulse", "pm-pulse.db");

function querySqlite(sql) {
  if (!existsSync(DB_PATH)) {
    console.error("Error: PM Pulse database not found at", DB_PATH);
    process.exit(1);
  }
  try {
    const result = execSync(
      `sqlite3 -json -readonly "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`,
      { timeout: 10000, encoding: "utf8" }
    ).trim();
    if (!result) return [];
    return JSON.parse(result);
  } catch (e) {
    console.error("Query error:", e.message);
    return [];
  }
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function formatMinutes(minutes) {
  const m = Math.round(minutes);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

// Parse CLI args
const args = process.argv.slice(2);
const weeksArg = args.find(a => a.startsWith("--weeks="));
const weeks = weeksArg ? parseInt(weeksArg.split("=")[1], 10) : 1;
const formatArg = args.find(a => a.startsWith("--format="));
const format = formatArg ? formatArg.split("=")[1] : "markdown";
const outputArg = args.find(a => a.startsWith("--output="));
const outputFile = outputArg ? outputArg.split("=")[1] : null;

// Date range: last N weeks
const today = new Date().toISOString().split("T")[0];
const startDate = shiftDate(today, -(weeks * 7 - 1));
const startISO = `${startDate}T00:00:00`;
const endISO = `${today}T23:59:59`;

// Fetch data
const prompts = querySqlite(
  `SELECT timestamp, attributed_minutes, primary_category, primary_subcategory, project_name FROM prompts WHERE timestamp BETWEEN '${startISO}' AND '${endISO}' AND attributed_minutes > 0`
);

const calEvents = querySqlite(
  `SELECT start_time, duration_minutes, primary_category, summary FROM calendar_events WHERE start_time BETWEEN '${startISO}' AND '${endISO}'`
);

const windowEvents = querySqlite(
  `SELECT start_time, duration_minutes, primary_category, app_name FROM window_events WHERE start_time BETWEEN '${startISO}' AND '${endISO}'`
);

const browserEvents = querySqlite(
  `SELECT start_time, duration_minutes, primary_category FROM browser_events WHERE start_time BETWEEN '${startISO}' AND '${endISO}'`
);

const categories = querySqlite(`SELECT slug, name, color FROM categories`);
const catNames = Object.fromEntries(categories.map(c => [c.slug, c.name]));

// Aggregate
const catMinutes = {};
for (const p of prompts) {
  catMinutes[p.primary_category] = (catMinutes[p.primary_category] || 0) + p.attributed_minutes;
}
for (const e of calEvents) {
  catMinutes[e.primary_category] = (catMinutes[e.primary_category] || 0) + e.duration_minutes;
}
for (const e of windowEvents) {
  catMinutes[e.primary_category] = (catMinutes[e.primary_category] || 0) + e.duration_minutes;
}
for (const e of browserEvents) {
  catMinutes[e.primary_category] = (catMinutes[e.primary_category] || 0) + e.duration_minutes;
}

const totalMinutes = Object.values(catMinutes).reduce((s, m) => s + m, 0);
const sortedCats = Object.entries(catMinutes).sort((a, b) => b[1] - a[1]);

// Project breakdown
const projectMinutes = {};
for (const p of prompts) {
  const proj = p.project_name || "Other";
  projectMinutes[proj] = (projectMinutes[proj] || 0) + p.attributed_minutes;
}
const sortedProjects = Object.entries(projectMinutes).sort((a, b) => b[1] - a[1]).slice(0, 5);

// Daily breakdown
const dailyMinutes = {};
for (let i = 0; i < weeks * 7; i++) {
  const d = shiftDate(startDate, i);
  dailyMinutes[d] = 0;
}
const allEvents = [
  ...prompts.map(p => ({ date: p.timestamp.split("T")[0], minutes: p.attributed_minutes })),
  ...calEvents.map(e => ({ date: e.start_time.split("T")[0], minutes: e.duration_minutes })),
  ...windowEvents.map(e => ({ date: e.start_time.split("T")[0], minutes: e.duration_minutes })),
  ...browserEvents.map(e => ({ date: e.start_time.split("T")[0], minutes: e.duration_minutes })),
];
for (const e of allEvents) {
  if (dailyMinutes.hasOwnProperty(e.date)) {
    dailyMinutes[e.date] += e.minutes;
  }
}
const activeDays = Object.values(dailyMinutes).filter(m => m >= 30).length;
const avgMinutes = activeDays > 0 ? totalMinutes / activeDays : 0;

// Format date range
const startFormatted = new Date(startDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const endFormatted = new Date(today + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Generate report
const lines = [];

if (format === "markdown") {
  lines.push(`# PM Pulse Weekly Report`);
  lines.push(`**${startFormatted} - ${endFormatted}**`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total tracked | ${formatMinutes(totalMinutes)} |`);
  lines.push(`| Active days | ${activeDays} / ${weeks * 7} |`);
  lines.push(`| Avg per active day | ${formatMinutes(avgMinutes)} |`);
  lines.push(`| Claude prompts | ${prompts.length} |`);
  lines.push(`| Meetings | ${calEvents.length} |`);
  lines.push(``);
  lines.push(`## Time by Category`);
  lines.push(``);
  for (const [slug, mins] of sortedCats) {
    const pct = totalMinutes > 0 ? Math.round((mins / totalMinutes) * 100) : 0;
    const name = catNames[slug] || slug;
    const bar = "█".repeat(Math.round(pct / 5));
    lines.push(`**${name}** — ${formatMinutes(mins)} (${pct}%)`);
    lines.push(`\`${bar.padEnd(20)}\``);
    lines.push(``);
  }
  if (sortedProjects.length > 0) {
    lines.push(`## Top Projects`);
    lines.push(``);
    for (const [proj, mins] of sortedProjects) {
      lines.push(`- **${proj}**: ${formatMinutes(mins)}`);
    }
    lines.push(``);
  }
  lines.push(`## Daily Breakdown`);
  lines.push(``);
  lines.push(`| Date | Hours |`);
  lines.push(`|------|-------|`);
  for (const [date, mins] of Object.entries(dailyMinutes)) {
    const d = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const hours = Math.round((mins / 60) * 10) / 10;
    const bar = hours > 0 ? "▓".repeat(Math.round(hours)) : "-";
    lines.push(`| ${d} | ${hours}h ${bar} |`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by PM Pulse on ${new Date().toLocaleDateString("en-US", { dateStyle: "full" })}*`);
} else {
  lines.push(`PM PULSE WEEKLY REPORT — ${startFormatted} - ${endFormatted}`);
  lines.push(`${"=".repeat(60)}`);
  lines.push(``);
  lines.push(`SUMMARY`);
  lines.push(`  Total tracked:      ${formatMinutes(totalMinutes)}`);
  lines.push(`  Active days:        ${activeDays} / ${weeks * 7}`);
  lines.push(`  Avg per active day: ${formatMinutes(avgMinutes)}`);
  lines.push(`  Claude prompts:     ${prompts.length}`);
  lines.push(`  Meetings:           ${calEvents.length}`);
  lines.push(``);
  lines.push(`TIME BY CATEGORY`);
  for (const [slug, mins] of sortedCats) {
    const pct = totalMinutes > 0 ? Math.round((mins / totalMinutes) * 100) : 0;
    const name = (catNames[slug] || slug).padEnd(32);
    lines.push(`  ${name} ${formatMinutes(mins).padStart(8)}  (${String(pct).padStart(2)}%)`);
  }
  lines.push(``);
}

const report = lines.join("\n");

if (outputFile) {
  writeFileSync(outputFile, report, "utf8");
  console.log(`Report written to ${outputFile}`);
} else {
  console.log(report);
}
