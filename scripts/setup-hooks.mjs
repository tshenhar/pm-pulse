#!/usr/bin/env node
/**
 * Registers PM Pulse hooks in ~/.claude/settings.json.
 * Run once: npm run setup
 *
 * Uses the current Claude Code hooks format:
 *   hooks[EventType] = [{ hooks: [{ type, command }] }]
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

const CLAUDE_DIR = join(homedir(), ".claude");
const SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");
const PROJECT_DIR = resolve(process.cwd());

const HOOKS = [
  { event: "UserPromptSubmit", script: "hooks/on-prompt.mjs",       label: "PM Pulse prompt capture" },
  { event: "SessionStart",     script: "hooks/on-session-start.mjs", label: "PM Pulse session start" },
  { event: "SessionEnd",       script: "hooks/on-session-end.mjs",   label: "PM Pulse session end" },
  { event: "Stop",             script: "hooks/on-stop.mjs",          label: "PM Pulse response capture" },
];

try {
  mkdirSync(CLAUDE_DIR, { recursive: true });

  let settings = {};
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  if (!settings.hooks) settings.hooks = {};

  let added = 0;

  for (const { event, script, label } of HOOKS) {
    const command = `node ${join(PROJECT_DIR, script)}`;

    if (!settings.hooks[event]) {
      settings.hooks[event] = [];
    }

    // The current Claude Code format wraps each matcher in { hooks: [...] }
    const alreadyRegistered = settings.hooks[event].some((matcher) => {
      const hookList = Array.isArray(matcher.hooks) ? matcher.hooks : [matcher];
      return hookList.some((h) => h.command && h.command.includes("pm-pulse"));
    });

    if (!alreadyRegistered) {
      settings.hooks[event].push({ hooks: [{ type: "command", command }] });
      console.log(`  + ${event} → ${script}  (${label})`);
      added++;
    } else {
      console.log(`  ~ ${event} already registered, skipping`);
    }
  }

  // Atomic write: write to temp file then rename to prevent partial writes
  const tmpPath = join(CLAUDE_DIR, `.settings-${randomUUID()}.tmp`);
  writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + "\n");
  renameSync(tmpPath, SETTINGS_PATH);

  if (added > 0) {
    console.log(`\nRegistered ${added} hook(s) in ${SETTINGS_PATH}`);
    console.log("Restart Claude Code for hooks to take effect.");
  } else {
    console.log("\nAll hooks already registered. No restart needed.");
  }
} catch (err) {
  console.error("Failed to set up hooks:", err.message);
  process.exit(1);
}
