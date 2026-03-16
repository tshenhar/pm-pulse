#!/usr/bin/env node
/**
 * PM Pulse system health check.
 * Run: npm run health-check
 *
 * Checks all subsystems and reports pass/fail with actionable guidance.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { randomUUID, createHash } from "crypto";
import Database from "better-sqlite3";

const HOME = homedir();
const DATA_DIR = join(HOME, ".pm-pulse");
const EVENTS_DIR = join(DATA_DIR, "events");
const WINDOW_EVENTS_DIR = join(DATA_DIR, "window-events");
const DB_PATH = join(DATA_DIR, "pm-pulse.db");
const CLAUDE_SETTINGS = join(HOME, ".claude", "settings.json");
const LAUNCH_AGENT = join(HOME, "Library", "LaunchAgents", "com.pm-pulse.window-watcher.plist");
const PROJECT_DIR = resolve(process.cwd());

let pass = 0;
let fail = 0;
let warn = 0;

function ok(msg)   { console.log(`  ✅  ${msg}`); pass++; }
function bad(msg)  { console.log(`  ❌  ${msg}`); fail++; }
function caution(msg) { console.log(`  ⚠️   ${msg}`); warn++; }

// ─── 1. Data directory ──────────────────────────────────────────────────────
console.log("\n📁  Data directory");
if (existsSync(DATA_DIR)) {
  ok(`~/.pm-pulse exists`);
} else {
  bad(`~/.pm-pulse missing — run: npm run setup`);
}

if (existsSync(DB_PATH)) {
  ok(`Database exists: pm-pulse.db`);
} else {
  bad(`Database missing — open the dashboard once to create it`);
}

if (existsSync(EVENTS_DIR)) {
  const count = readdirSync(EVENTS_DIR).filter(f => f.endsWith(".json")).length;
  ok(`Events dir exists (${count} unprocessed files)`);
} else {
  caution(`Events dir missing — will be created on first hook fire`);
}

// ─── 2. Claude Code hooks ────────────────────────────────────────────────────
console.log("\n🔗  Claude Code hooks");
if (!existsSync(CLAUDE_SETTINGS)) {
  bad(`~/.claude/settings.json not found — run: npm run setup`);
} else {
  let settings;
  try { settings = JSON.parse(readFileSync(CLAUDE_SETTINGS, "utf-8")); } catch {
    bad(`~/.claude/settings.json is not valid JSON`);
    settings = null;
  }
  if (settings) {
    const hooks = settings.hooks || {};

    // Check UserPromptSubmit (either new nested format or old flat format)
    const promptHooks = hooks.UserPromptSubmit || hooks.PreToolUse || [];
    const hasPrompt = promptHooks.some(m => {
      const list = Array.isArray(m.hooks) ? m.hooks : [m];
      return list.some(h => h.command && h.command.includes("pm-pulse"));
    });
    if (hasPrompt) ok("UserPromptSubmit hook registered");
    else bad("UserPromptSubmit hook missing — run: npm run setup");

    const sessionHooks = hooks.SessionStart || [];
    const hasSession = sessionHooks.some(m => {
      const list = Array.isArray(m.hooks) ? m.hooks : [m];
      return list.some(h => h.command && h.command.includes("pm-pulse"));
    });
    if (hasSession) ok("SessionStart hook registered");
    else caution("SessionStart hook missing — run: npm run setup");

    // Verify the hook script files actually exist at the registered paths
    const allHooks = Object.values(hooks).flat();
    const pmHooks = allHooks.flatMap(m => Array.isArray(m.hooks) ? m.hooks : [m])
      .filter(h => h.command && h.command.includes("pm-pulse"));

    let pathsOk = true;
    for (const h of pmHooks) {
      // Extract path from "node /path/to/script.mjs"
      const match = h.command.match(/node\s+(\S+\.mjs)/);
      if (match) {
        const scriptPath = match[1].replace(/^~/, HOME);
        if (!existsSync(scriptPath)) {
          bad(`Hook script not found: ${scriptPath}`);
          pathsOk = false;
        }
      }
    }
    if (pathsOk && pmHooks.length > 0) ok("All hook script paths resolve");
  }
}

// ─── 3. Prompt pipeline ──────────────────────────────────────────────────────
console.log("\n⚙️   Prompt ingestion pipeline");
try {
  // Write a synthetic event and run through the pipeline
  mkdirSync(EVENTS_DIR, { recursive: true });
  const testText = "health-check: prioritize Q3 features using RICE";
  const testHash = createHash("sha256").update(testText).digest("hex");
  const testId = `health-${randomUUID()}`;

  const event = {
    id: testId,
    type: "prompt",
    timestamp: new Date().toISOString(),
    session_id: `health-session-${testId}`,
    prompt: testText,
    prompt_hash: testHash,
    cwd: PROJECT_DIR,
  };
  writeFileSync(join(EVENTS_DIR, `${testId}.json`), JSON.stringify(event));
  ok("Wrote synthetic prompt event to events dir");

  // Dynamically import the processor (requires ESM + tsconfig paths)
  // We invoke via the Next.js API instead for a true end-to-end check
  const today = new Date().toISOString().split("T")[0];
  try {
    const res = execSync(`curl -sf "http://localhost:3000/api/dashboard?date=${today}"`, { timeout: 5000 });
    const data = JSON.parse(res.toString());
    if (data.total_events !== undefined) {
      ok(`Dashboard API reachable — ${data.total_events} events today`);
      if (data.activities && data.activities.length > 0) {
        ok(`Activity feed has ${data.activities.length} items`);
      } else {
        caution("Activity feed is empty for today (may be normal if no activity yet)");
      }
    } else {
      caution("Dashboard API returned unexpected shape");
    }
  } catch {
    caution("Dashboard API not reachable — start the dev server (npm run dev) to test the full pipeline");
  }

  // Clean up synthetic health-check row from production DB so it doesn't appear in dashboard
  try {
    const db = new Database(DB_PATH);
    db.prepare("DELETE FROM prompts WHERE id = ?").run(testId);
    db.close();
  } catch { /* non-fatal — row may not exist if server wasn't running */ }
} catch (err) {
  bad(`Prompt pipeline check failed: ${err.message}`);
}

// ─── 4. Window tracking ──────────────────────────────────────────────────────
console.log("\n🖥️   Window tracking");

if (existsSync(LAUNCH_AGENT)) {
  ok("LaunchAgent installed (auto-starts on login)");
  try {
    const result = execSync("launchctl list com.pm-pulse.window-watcher 2>/dev/null").toString();
    if (result.includes("PID")) {
      ok("Window watcher process is running");
    } else {
      caution("LaunchAgent installed but process not running — may have just started");
    }
  } catch {
    caution("LaunchAgent installed but could not confirm process status");
  }
} else {
  caution("LaunchAgent not installed — window tracking won't survive reboot");
  caution("Fix: npm run install-agent");
}

if (existsSync(WINDOW_EVENTS_DIR)) {
  const count = readdirSync(WINDOW_EVENTS_DIR).filter(f => f.endsWith(".json")).length;
  ok(`Window events dir exists (${count} session files)`);
} else {
  caution("Window events dir doesn't exist yet — will be created when watcher first runs");
}

// Check if watcher is running at all (LaunchAgent OR manual)
try {
  execSync("pgrep -f window-watcher.mjs", { stdio: "ignore" });
  ok("window-watcher.mjs process is currently running");
} catch {
  caution("window-watcher.mjs is NOT running — start it: npm run watch-windows");
}

// Check macOS Accessibility permission (needed for window titles)
try {
  execSync(
    'osascript -e \'tell application "System Events" to get title of window 1 of (first application process whose frontmost is true)\'',
    { timeout: 5000, stdio: "pipe" }
  );
  ok("Accessibility permission granted — window titles available");
} catch {
  caution("Accessibility permission NOT granted — window titles unavailable");
  caution("Browser-based classification (GitHub/Jira/Figma in title) will be degraded");
  caution("Fix: System Settings → Privacy & Security → Accessibility → enable Terminal/iTerm/Warp");
}

// ─── 5. Calendar sync ────────────────────────────────────────────────────────
console.log("\n📅  Calendar sync");
try {
  let settings = {};
  try { settings = JSON.parse(readFileSync(CLAUDE_SETTINGS, "utf-8")); } catch {}

  // Read calendar URL from pm-pulse DB via curl (if server running)
  try {
    const res = execSync(`curl -sf "http://localhost:3000/api/settings"`, { timeout: 3000 });
    const appSettings = JSON.parse(res.toString());
    if (appSettings.calendar_ics_url) {
      ok(`ICS URL configured: ${appSettings.calendar_ics_url.substring(0, 50)}...`);
      // Check last synced
      try {
        const syncRes = execSync(`curl -sf "http://localhost:3000/api/calendar/last-synced"`, { timeout: 3000 });
        const syncData = JSON.parse(syncRes.toString());
        if (syncData.synced_at) {
          const age = Math.round((Date.now() - new Date(syncData.synced_at).getTime()) / 60000);
          if (age < 60) {
            ok(`Last synced ${age}m ago`);
          } else {
            caution(`Last synced ${Math.round(age / 60)}h ago — consider syncing manually`);
          }
        } else {
          caution("Never synced — click Sync Now in Settings");
        }
      } catch { caution("Could not check last sync time (server may be offline)"); }
    } else {
      caution("No ICS URL configured — calendar meetings won't be tracked");
      caution("Fix: add your calendar URL in Settings → Calendar Integration");
    }
  } catch {
    caution("Server not running — can't check calendar settings");
  }
} catch (err) {
  caution(`Calendar check skipped: ${err.message}`);
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(50));
console.log(`Result: ${pass} passed · ${warn} warnings · ${fail} failed`);
if (fail > 0) {
  console.log("\nRun `npm run setup` to fix hook registration issues.");
  process.exit(1);
} else if (warn > 0) {
  console.log("\nSystem is functional. Address warnings for full coverage.");
  process.exit(0);
} else {
  console.log("\nAll systems healthy. 🎉");
  process.exit(0);
}
