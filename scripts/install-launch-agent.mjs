#!/usr/bin/env node
/**
 * Installs macOS LaunchAgents for both pm-pulse daemons:
 *   - window-watcher.mjs
 *   - browser-tracker.mjs
 *
 * No admin rights required — installs to ~/Library/LaunchAgents/
 *
 * Usage:
 *   npm run install-agent             # install + load both
 *   npm run install-agent -- --uninstall  # remove both
 */

import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { join, resolve } from "path";
import { homedir } from "os";

function resolveNode() {
  try { return execSync("which node", { encoding: "utf-8" }).trim(); } catch {}
  for (const p of ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]) {
    if (existsSync(p)) return p;
  }
  throw new Error("Cannot locate node binary. Is Node.js installed?");
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function makePlist(label, nodeBin, script, logDir) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodeBin)}</string>
    <string>${escapeXml(script)}</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${escapeXml(logDir)}/${escapeXml(label.replace("com.pm-pulse.", ""))}.log</string>

  <key>StandardErrorPath</key>
  <string>${escapeXml(logDir)}/${escapeXml(label.replace("com.pm-pulse.", ""))}-error.log</string>

  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
`;
}

const HOME = homedir();
const AGENTS_DIR = join(HOME, "Library", "LaunchAgents");
const PROJECT_DIR = resolve(process.cwd());
const LOG_DIR = join(HOME, ".pm-pulse");

const AGENTS = [
  {
    label: "com.pm-pulse.window-watcher",
    script: join(PROJECT_DIR, "hooks", "window-watcher.mjs"),
    plist: join(AGENTS_DIR, "com.pm-pulse.window-watcher.plist"),
  },
  {
    label: "com.pm-pulse.browser-tracker",
    script: join(PROJECT_DIR, "hooks", "browser-tracker.mjs"),
    plist: join(AGENTS_DIR, "com.pm-pulse.browser-tracker.plist"),
  },
];

const uninstall = process.argv.includes("--uninstall");

if (uninstall) {
  for (const agent of AGENTS) {
    if (existsSync(agent.plist)) {
      try { execSync(`launchctl unload "${agent.plist}"`, { stdio: "ignore" }); } catch {}
      unlinkSync(agent.plist);
      console.log(`Uninstalled: ${agent.label}`);
    } else {
      console.log(`Not installed: ${agent.label}`);
    }
  }
  process.exit(0);
}

mkdirSync(AGENTS_DIR, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });

const NODE_BIN = resolveNode();
console.log(`Using node: ${NODE_BIN}\n`);

for (const agent of AGENTS) {
  const plist = makePlist(agent.label, NODE_BIN, agent.script, LOG_DIR);
  writeFileSync(agent.plist, plist);
  console.log(`Written: ${agent.plist}`);

  try { execSync(`launchctl unload "${agent.plist}"`, { stdio: "ignore" }); } catch {}
  execSync(`launchctl load "${agent.plist}"`);
  console.log(`Loaded:  ${agent.label}`);
}

console.log("\nBoth daemons are now running and will:");
console.log("  • Start automatically on every login");
console.log("  • Restart automatically if they crash");
console.log(`  • Log to ${LOG_DIR}/<daemon-name>.log`);
console.log("\nTo uninstall: npm run install-agent -- --uninstall");
