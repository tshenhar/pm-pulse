#!/usr/bin/env node
/**
 * window-watcher.mjs — macOS window activity tracker
 * Polls active app every 30s, writes session JSON files to ~/.pm-pulse/window-events/
 * Run via: npm run watch-windows
 */

import { execSync, execFileSync } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

const DATA_DIR = join(homedir(), ".pm-pulse");
const WINDOW_EVENTS_DIR = join(DATA_DIR, "window-events");
const WATCHER_CONFIG_PATH = join(DATA_DIR, "watcher-config.json");
const POLL_INTERVAL_MS = 10_000;
const FLUSH_INTERVAL_MS = 60_000; // Write partial session every 1 min even if app hasn't changed

// Defaults — overridden by watcher-config.json if present
let IDLE_THRESHOLD_SECONDS = 120;
let MIN_SESSION_SECONDS = 30;
let RETENTION_DAYS = 7;

try {
  const cfg = JSON.parse(readFileSync(WATCHER_CONFIG_PATH, "utf8"));
  if (typeof cfg.idle_threshold_seconds === "number") IDLE_THRESHOLD_SECONDS = cfg.idle_threshold_seconds;
  if (typeof cfg.min_session_seconds === "number") MIN_SESSION_SECONDS = cfg.min_session_seconds;
  if (typeof cfg.window_event_retention_days === "number") RETENTION_DAYS = cfg.window_event_retention_days;
  console.log(`[window-watcher] Config loaded: idle=${IDLE_THRESHOLD_SECONDS}s, min_session=${MIN_SESSION_SECONDS}s, retention=${RETENTION_DAYS}d`);
} catch {
  // Config file absent — use defaults
}

mkdirSync(WINDOW_EVENTS_DIR, { recursive: true });

// Map bundle identifiers to friendly display names
const BUNDLE_ID_MAP = {
  "com.microsoft.VSCode": "Visual Studio Code",
  "com.todesktop.230313mzl4w4u92": "Cursor",
  "com.anthropic.claudecode": "Claude Code",
  "com.github.atom": "Atom",
  "com.jetbrains.intellij": "IntelliJ IDEA",
  "com.tinyspeck.slackmacgap": "Slack",
  "com.microsoft.teams2": "Microsoft Teams",
  "com.microsoft.Outlook": "Microsoft Outlook",
  "com.microsoft.Powerpoint": "Microsoft PowerPoint",
  "com.microsoft.Excel": "Microsoft Excel",
  "com.microsoft.Word": "Microsoft Word",
  "com.google.Chrome": "Google Chrome",
  "org.mozilla.firefox": "Firefox",
  "com.apple.Safari": "Safari",
  "com.figma.Desktop": "Figma",
  "notion.id": "Notion",
  "com.linear.app": "Linear",
};

function cleanOldFiles() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;
  try {
    for (const file of readdirSync(WINDOW_EVENTS_DIR).filter((f) => f.endsWith(".json"))) {
      const fp = join(WINDOW_EVENTS_DIR, file);
      try { if (statSync(fp).mtimeMs < cutoff) { unlinkSync(fp); deleted++; } } catch {}
    }
  } catch {}
  if (deleted > 0) console.log(`[window-watcher] Cleaned ${deleted} old file(s)`);
}

function resolveAppName(rawName, bundleId) {
  if (bundleId && BUNDLE_ID_MAP[bundleId]) return BUNDLE_ID_MAP[bundleId];
  // Partial bundle ID matching for unknown Electron apps
  if (bundleId) {
    if (/vscode|visualstudio/i.test(bundleId)) return "Visual Studio Code";
    if (/cursor/i.test(bundleId)) return "Cursor";
    if (/anthropic/i.test(bundleId)) return "Claude Code";
  }
  return rawName;
}

/** Get the frontmost app using lsappinfo — no System Events or Automation permissions needed. */
function getActiveApp() {
  try {
    const frontASN = execSync("lsappinfo front", {
      timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    if (!frontASN || frontASN === "(null)") return null;

    const info = execSync(`lsappinfo info -only name -only bundleid ${frontASN}`, {
      timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();

    const nameMatch = info.match(/"(?:LSDisplayName|name)"\s*=\s*"(.+?)"/);
    const bundleMatch = info.match(/"(?:CFBundleIdentifier|bundleid)"\s*=\s*"(.+?)"/);
    const rawName = nameMatch ? nameMatch[1] : null;
    if (!rawName) return null;

    const bundleId = bundleMatch ? bundleMatch[1] : "";

    // Skip tracking during screen lock / login authentication — avoids interfering with loginwindow
    if (rawName === "loginwindow" || bundleId === "com.apple.loginwindow") return null;

    // Try to get window title. Office apps expose documents via their own object model,
    // not via the generic 'name of front window' which returns -1728 for them.
    let title = "";
    try {
      let script;
      if (bundleId === "com.microsoft.Powerpoint") {
        script = 'tell application "Microsoft PowerPoint" to name of active presentation';
      } else if (bundleId === "com.microsoft.Word") {
        script = 'tell application "Microsoft Word" to name of active document';
      } else if (bundleId === "com.microsoft.Excel") {
        script = 'tell application "Microsoft Excel" to name of active workbook';
      } else {
        script = `tell application "${rawName}" to return name of front window`;
      }
      title = execFileSync("/usr/bin/osascript", ["-e", script],
        { timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      // Window title not available — OK, classification uses app name primarily
    }

    return { app: resolveAppName(rawName, bundleId), title };
  } catch {
    return null;
  }
}

function getIdleSeconds() {
  try {
    const ns = execSync(
      `ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print $NF; exit}'`,
      { timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }
    ).toString().trim();
    return parseFloat(ns) / 1_000_000_000;
  } catch {
    return 0; // assume active on error
  }
}

function writeSession(appName, windowTitle, startTime, endTime) {
  const durationSeconds = (endTime - startTime) / 1000;
  if (durationSeconds < MIN_SESSION_SECONDS) return;

  const session = {
    id: randomUUID(),
    type: "window_session",
    app_name: appName,
    window_title: windowTitle || undefined,
    start_time: new Date(startTime).toISOString(),
    end_time: new Date(endTime).toISOString(),
    duration_seconds: Math.round(durationSeconds),
  };

  const filename = `${session.id}.json`;
  writeFileSync(join(WINDOW_EVENTS_DIR, filename), JSON.stringify(session, null, 2));
  console.log(`[window-watcher] Saved: ${appName} (${Math.round(durationSeconds)}s)`);
}

const BROWSER_APPS_RE = /^(Google Chrome|Safari|Arc|Microsoft Edge|Firefox)$/i;

let current = null; // { app, title, startTime }
let isIdle = false;
let idleStart = null;
let idleWhileBrowser = false; // was a browser frontmost when idle started?

function tick() {
  const active = getActiveApp();
  if (!active) return;

  const now = Date.now();
  const idleSeconds = getIdleSeconds();
  const wasIdle = isIdle;
  isIdle = idleSeconds >= IDLE_THRESHOLD_SECONDS;

  // Transitioning into idle — flush active session up to idle start, begin idle session
  if (!wasIdle && isIdle && current) {
    const idleStartTime = now - idleSeconds * 1000;
    writeSession(current.app, current.title, current.startTime, idleStartTime);
    idleWhileBrowser = BROWSER_APPS_RE.test(current.app);
    current = null;
    idleStart = idleStartTime;
    console.log(`[window-watcher] Idle detected (${Math.round(idleSeconds)}s)${idleWhileBrowser ? " — browser was active, skipping Idle Time session" : ""}`);
    return;
  }

  // Still idle — keep waiting
  if (isIdle) return;

  // Transitioning out of idle — write idle session (unless browser was active), start fresh session
  if (wasIdle && idleStart) {
    const idleDuration = Math.round((now - idleStart) / 1000);
    console.log(`[window-watcher] Activity resumed after ${idleDuration}s idle`);
    if (!idleWhileBrowser) {
      writeSession("Idle Time", null, idleStart, now);
    }
    idleWhileBrowser = false;
    idleStart = null;
    current = { app: active.app, title: active.title, startTime: now };
    return;
  }

  if (!current) {
    current = { app: active.app, title: active.title, startTime: now };
    return;
  }

  if (active.app !== current.app) {
    // App changed — flush the previous session
    writeSession(current.app, current.title, current.startTime, now);
    current = { app: active.app, title: active.title, startTime: now };
  } else if (now - current.startTime >= FLUSH_INTERVAL_MS) {
    // Same app for 1 min — write partial session so dashboard stays current
    writeSession(current.app, current.title, current.startTime, now);
    current.startTime = now;
  }
}

function flush() {
  if (current) {
    writeSession(current.app, current.title, current.startTime, Date.now());
    current = null;
  }
}

// Graceful shutdown
process.on("SIGINT", () => { flush(); process.exit(0); });
process.on("SIGTERM", () => { flush(); process.exit(0); });

console.log("[window-watcher] Started. Polling every 10s. Press Ctrl+C to stop.");
console.log(`[window-watcher] Writing events to: ${WINDOW_EVENTS_DIR}`);

// Sweep stale files on startup
cleanOldFiles();

// Initial tick
tick();
setInterval(tick, POLL_INTERVAL_MS);
