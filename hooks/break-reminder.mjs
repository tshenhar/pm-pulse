#!/usr/bin/env node
/**
 * PM Pulse Break Reminder Daemon
 * Polls every 5 minutes, detects 90+ consecutive minutes of work without a calendar break.
 * Fires a macOS notification and waits 30 minutes before alerting again.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const DB_PATH = join(homedir(), ".pm-pulse", "pm-pulse.db");
const WORK_THRESHOLD_MINUTES = 90;
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_MS = 30 * 60 * 1000; // 30 min between notifications

let lastNotificationTime = 0;

function querySqlite(sql) {
  if (!existsSync(DB_PATH)) return null;
  try {
    const result = execSync(
      `sqlite3 -readonly "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`,
      { timeout: 5000, encoding: "utf8" }
    ).trim();
    return result;
  } catch {
    return null;
  }
}

function notify(title, message) {
  try {
    execSync(
      `osascript -e 'display notification "${message.replace(/'/g, "\\'")}" with title "${title.replace(/'/g, "\\'")}"'`,
      { timeout: 3000 }
    );
  } catch {
    // Notification failed silently
  }
}

function checkForBreak() {
  const now = Date.now();
  if (now - lastNotificationTime < COOLDOWN_MS) return;

  const windowMins = 120; // Look back 2 hours
  const lookback = new Date(now - windowMins * 60 * 1000).toISOString();

  // Check if there's any calendar event (break/meeting) in the last windowMins
  const calResult = querySqlite(
    `SELECT COUNT(*) FROM calendar_events WHERE start_time >= '${lookback}' AND end_time <= '${new Date(now).toISOString()}'`
  );
  const calCount = calResult ? parseInt(calResult, 10) : 0;

  if (calCount > 0) return; // Had a meeting = took a break

  // Check continuous work: any window or prompt activity in last 90+ minutes?
  const workStart = new Date(now - WORK_THRESHOLD_MINUTES * 60 * 1000).toISOString();
  const promptResult = querySqlite(
    `SELECT COUNT(*) FROM prompts WHERE timestamp >= '${workStart}'`
  );
  const windowResult = querySqlite(
    `SELECT COUNT(*) FROM window_events WHERE start_time >= '${workStart}'`
  );

  const promptCount = promptResult ? parseInt(promptResult, 10) : 0;
  const windowCount = windowResult ? parseInt(windowResult, 10) : 0;

  if (promptCount + windowCount >= 3) {
    // Sustained work detected, no break
    notify(
      "PM Pulse - Time for a Break",
      `You've been working for ${WORK_THRESHOLD_MINUTES}+ minutes. Consider a short break.`
    );
    lastNotificationTime = now;
    console.log(`[break-reminder] Notification sent at ${new Date().toISOString()}`);
  }
}

// Graceful shutdown
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

console.log(`[break-reminder] Started. Checking every ${POLL_INTERVAL_MS / 60000} minutes.`);
checkForBreak(); // Check immediately on start
setInterval(checkForBreak, POLL_INTERVAL_MS);
