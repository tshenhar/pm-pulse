#!/usr/bin/env node
/**
 * browser-tracker.mjs — macOS browser tab tracker
 *
 * Polls Chromium history DBs every 5s and captures ALL new visits since last check.
 * Uses cursor-based reads (visit ID watermark) — never misses a tab switch.
 * Only records visits while the browser is the frontmost app (via lsappinfo).
 *
 * No AppleScript or Automation permissions required.
 * Run via: npm run watch-browser
 */

import { execSync } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, statSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

const DATA_DIR = join(homedir(), ".pm-pulse");
const BROWSER_EVENTS_DIR = join(DATA_DIR, "browser-events");
const WATCHER_CONFIG_PATH = join(DATA_DIR, "watcher-config.json");
const CURSOR_FILE = join(DATA_DIR, "browser-tracker-cursor.json");
const LOCK_FILE = join(DATA_DIR, "browser-tracker.pid");

const POLL_INTERVAL_MS = 5_000;
const MIN_DWELL_SECONDS = 3;
const MAX_DWELL_SECONDS = 600; // Cap at 10 min (like prompt attribution)
const PERIODIC_FLUSH_MS = 2 * 60 * 1000; // Flush pending visits every 2 min (captures video watching)
const SLEEP_DETECT_MULTIPLIER = 4; // > 4× poll interval = machine was suspended

let RETENTION_DAYS = 7;
try {
  const cfg = JSON.parse(readFileSync(WATCHER_CONFIG_PATH, "utf8"));
  if (typeof cfg.browser_event_retention_days === "number") RETENTION_DAYS = cfg.browser_event_retention_days;
} catch { /* use defaults */ }

mkdirSync(BROWSER_EVENTS_DIR, { recursive: true });

// --- PID lock ---
function acquireLock() {
  try {
    const existing = readFileSync(LOCK_FILE, "utf8").trim();
    const pid = parseInt(existing, 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0);
        console.error(`[browser-tracker] Already running (PID ${pid}). Exiting.`);
        process.exit(1);
      } catch { /* stale lock — proceed */ }
    }
  } catch { /* no lock file — proceed */ }
  writeFileSync(LOCK_FILE, String(process.pid));
}

function releaseLock() {
  try { unlinkSync(LOCK_FILE); } catch {}
}

// Chromium browsers: bundle ID → name + history path
const CHROMIUM_BROWSERS = {
  "com.google.Chrome": {
    name: "Google Chrome",
    historyPath: join(homedir(), "Library/Application Support/Google/Chrome/Default/History"),
  },
  "com.microsoft.edgemac": {
    name: "Microsoft Edge",
    historyPath: join(homedir(), "Library/Application Support/Microsoft Edge/Default/History"),
  },
  "company.thebrowser.Browser": {
    name: "Arc",
    historyPath: join(homedir(), "Library/Application Support/Arc/User Data/Default/History"),
  },
};

// Chrome timestamps: microseconds since 1601-01-01
const CHROME_EPOCH_OFFSET_US = 11644473600000000;

function chromeTimeToUnixMs(chromeTime) {
  return (Number(chromeTime) - CHROME_EPOCH_OFFSET_US) / 1000;
}

function unixMsToChromeTime(unixMs) {
  return Math.round(unixMs * 1000 + CHROME_EPOCH_OFFSET_US);
}

// --- Cursor persistence ---
// Per-browser visit ID watermark so we never re-process visits
let cursors = {}; // { bundleId: lastVisitId }

function loadCursors() {
  try {
    cursors = JSON.parse(readFileSync(CURSOR_FILE, "utf8"));
  } catch { /* fresh start */ }
}

function saveCursors() {
  writeFileSync(CURSOR_FILE, JSON.stringify(cursors, null, 2));
}

// --- lsappinfo ---
function getFrontmostBundleId() {
  try {
    const frontASN = execSync("lsappinfo front", {
      timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    if (!frontASN || frontASN === "(null)") return null;

    const info = execSync(`lsappinfo info -only bundleid ${frontASN}`, {
      timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();

    const m = info.match(/"(?:CFBundleIdentifier|bundleid)"\s*=\s*"(.+?)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// --- SQLite history reads ---
function getNewVisits(dbPath, afterVisitId) {
  if (!existsSync(dbPath)) return [];

  try {
    const safeId = Math.floor(Number(afterVisitId)) || 0;
    const query = `SELECT v.id, u.url, u.title, v.visit_time FROM visits v JOIN urls u ON v.url = u.id WHERE v.id > ${safeId} ORDER BY v.id ASC LIMIT 200;`;
    const raw = execSync(
      `sqlite3 -json "file:${dbPath}?mode=ro&immutable=1" "${query}"`,
      { timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }
    ).toString().trim();

    if (!raw) return [];
    const rows = JSON.parse(raw);
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      title: r.title || r.url,
      visitTime: r.visit_time,
    })).filter((v) => v.url && Number.isFinite(v.visitTime));
  } catch {
    return [];
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const SKIP_URL_RE = /^(chrome(-extension)?:\/\/|chrome:|about:|data:|blob:|file:\/\/|https?:\/\/localhost|https?:\/\/127\.|https?:\/\/\[::1\])/i;

function writeVisitEvent(browser, uuid, url, title, startTimeMs, endTimeMs) {
  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs)) return;
  if (SKIP_URL_RE.test(url)) return; // skip internal/local URLs
  let durationSeconds = Math.round((endTimeMs - startTimeMs) / 1000);
  if (durationSeconds < MIN_DWELL_SECONDS) return;
  if (durationSeconds > MAX_DWELL_SECONDS) durationSeconds = MAX_DWELL_SECONDS;

  const domain = extractDomain(url);
  const event = {
    id: uuid,
    type: "browser_event",
    browser,
    url,
    domain,
    title,
    start_time: new Date(startTimeMs).toISOString(),
    end_time: new Date(Math.min(endTimeMs, startTimeMs + durationSeconds * 1000)).toISOString(),
    duration_seconds: durationSeconds,
  };

  writeFileSync(join(BROWSER_EVENTS_DIR, `${event.id}.json`), JSON.stringify(event, null, 2));
  console.log(`[browser-tracker] ${domain} (${durationSeconds}s) — ${title.substring(0, 60)}`);
}

function cleanOldFiles() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;
  try {
    for (const file of readdirSync(BROWSER_EVENTS_DIR).filter((f) => f.endsWith(".json"))) {
      const fp = join(BROWSER_EVENTS_DIR, file);
      try { if (statSync(fp).mtimeMs < cutoff) { unlinkSync(fp); deleted++; } } catch {}
    }
  } catch {}
  if (deleted > 0) console.log(`[browser-tracker] Cleaned ${deleted} old file(s)`);
}

// --- Main loop ---
// Track whether browser was frontmost during last poll (for time attribution)
let browserWasFront = false;
let frontSince = 0; // timestamp when browser became frontmost

// Hold-back: last in-progress visit per browser — don't emit until we know its true end time
let pendingLastVisits = {}; // bundleId → { uuid, browser, url, title, startMs }

let lastTickTime = Date.now();

function tick() {
  const now = Date.now();
  const elapsed = now - lastTickTime;
  lastTickTime = now;

  // Sleep/wake detection: if elapsed > 4× poll interval, the process was suspended
  if (elapsed > POLL_INTERVAL_MS * SLEEP_DETECT_MULTIPLIER) {
    const count = Object.keys(pendingLastVisits).length;
    if (count > 0) {
      const sleepEndTime = now - elapsed; // approximate pre-sleep timestamp
      for (const [, pending] of Object.entries(pendingLastVisits)) {
        writeVisitEvent(pending.browser, pending.uuid, pending.url, pending.title, pending.startMs, sleepEndTime);
      }
      pendingLastVisits = {};
      console.log(`[browser-tracker] Machine sleep detected (${Math.round(elapsed / 1000)}s gap). Cleared ${count} pending visit(s).`);
    }
  }

  const frontBundleId = getFrontmostBundleId();
  const isBrowserFront = frontBundleId && frontBundleId in CHROMIUM_BROWSERS;

  // Process new visits for ALL running Chromium browsers
  for (const [bundleId, browser] of Object.entries(CHROMIUM_BROWSERS)) {
    const lastId = cursors[bundleId] || 0;
    const visits = getNewVisits(browser.historyPath, lastId);
    if (visits.length === 0) continue;

    // Finalize the previous pending visit: its true end time is the start of the first new visit
    if (pendingLastVisits[bundleId]) {
      const pending = pendingLastVisits[bundleId];
      const trueEndMs = chromeTimeToUnixMs(visits[0].visitTime);
      writeVisitEvent(pending.browser, pending.uuid, pending.url, pending.title, pending.startMs, trueEndMs);
      delete pendingLastVisits[bundleId];
    }

    // Emit all visits except the last (which is still in progress)
    for (let i = 0; i < visits.length - 1; i++) {
      const v = visits[i];
      const startMs = chromeTimeToUnixMs(v.visitTime);
      const endMs = chromeTimeToUnixMs(visits[i + 1].visitTime);
      writeVisitEvent(browser.name, randomUUID(), v.url, v.title, startMs, endMs);
    }

    // Store the last visit as pending — we don't know its end time yet
    const last = visits[visits.length - 1];
    pendingLastVisits[bundleId] = {
      uuid: randomUUID(),
      browser: browser.name,
      url: last.url,
      title: last.title,
      startMs: chromeTimeToUnixMs(last.visitTime),
    };

    // Advance cursor
    cursors[bundleId] = visits[visits.length - 1].id;
  }

  // Periodically flush long-pending visits (e.g. watching a video without navigating)
  for (const [bundleId, pending] of Object.entries(pendingLastVisits)) {
    if (now - pending.startMs >= PERIODIC_FLUSH_MS) {
      writeVisitEvent(pending.browser, pending.uuid, pending.url, pending.title, pending.startMs, now);
      pendingLastVisits[bundleId] = {
        uuid: randomUUID(),
        browser: pending.browser,
        url: pending.url,
        title: pending.title,
        startMs: now,
      };
    }
  }

  saveCursors();
  browserWasFront = isBrowserFront;
}

function flush() {
  // Emit all pending visits with endMs = now (graceful shutdown)
  const now = Date.now();
  for (const [, pending] of Object.entries(pendingLastVisits)) {
    writeVisitEvent(pending.browser, pending.uuid, pending.url, pending.title, pending.startMs, now);
  }
  pendingLastVisits = {};
  saveCursors();
}

process.on("SIGINT", () => { flush(); releaseLock(); process.exit(0); });
process.on("SIGTERM", () => { flush(); releaseLock(); process.exit(0); });

// --- Startup ---
acquireLock();
loadCursors();

// On first run, seed cursor to visits from the last 2 hours (captures recent activity)
const TWO_HOURS_CHROME = unixMsToChromeTime(Date.now() - 2 * 60 * 60 * 1000);
for (const [bundleId, browser] of Object.entries(CHROMIUM_BROWSERS)) {
  if (cursors[bundleId]) continue; // already have a cursor
  if (!existsSync(browser.historyPath)) continue;
  try {
    const raw = execSync(
      `sqlite3 "file:${browser.historyPath}?mode=ro&immutable=1" "SELECT MIN(id) - 1 FROM visits WHERE visit_time >= ${TWO_HOURS_CHROME};"`,
      { timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }
    ).toString().trim();
    const seedId = raw && raw !== "null" ? Number(raw) : 0;
    cursors[bundleId] = Math.max(0, seedId);
    console.log(`[browser-tracker] ${browser.name}: seeded cursor at visit #${cursors[bundleId]} (last 2h)`);
  } catch {}
}
saveCursors();

cleanOldFiles();
console.log("[browser-tracker] Started. Polling every 5s.");
console.log(`[browser-tracker] Events dir: ${BROWSER_EVENTS_DIR}`);
console.log(`[browser-tracker] Method: cursor-based SQLite history reads (no AppleScript)`);
console.log(`[browser-tracker] Retention: ${RETENTION_DAYS} days`);

tick();
setInterval(tick, POLL_INTERVAL_MS);
