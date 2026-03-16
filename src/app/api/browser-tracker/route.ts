import { spawn } from "child_process";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { NextResponse } from "next/server";

const PID_FILE = join(homedir(), ".pm-pulse", "browser-tracker.pid");
const LOG_FILE = join(homedir(), ".pm-pulse", "browser-tracker.log");
const HOOK_PATH = resolve(process.cwd(), "hooks/browser-tracker.mjs");

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}

function readPid(): number | null {
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/** GET /api/browser-tracker — returns { running: boolean, pid?: number } */
export async function GET(): Promise<NextResponse> {
  const pid = readPid();
  if (pid && isRunning(pid)) {
    return NextResponse.json({ running: true, pid });
  }
  // Stale PID file
  if (pid) { try { unlinkSync(PID_FILE); } catch { /* ignore */ } }
  return NextResponse.json({ running: false });
}

/** POST /api/browser-tracker — body: { action: "start" | "stop" } */
export async function POST(request: Request): Promise<NextResponse> {
  const { action } = await request.json();

  if (action === "start") {
    // If already running, return early
    const existingPid = readPid();
    if (existingPid && isRunning(existingPid)) {
      return NextResponse.json({ ok: true, running: true, pid: existingPid });
    }

    const { openSync } = await import("fs");
    const logFd = openSync(LOG_FILE, "w");
    const child = spawn(process.execPath, [HOOK_PATH], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();

    if (!child.pid) {
      return NextResponse.json({ ok: false, error: "Failed to start daemon" }, { status: 500 });
    }

    // Wait briefly to check if daemon survived startup self-test
    const pid = child.pid;
    await new Promise((r) => setTimeout(r, 600));

    if (!isRunning(pid)) {
      let logOutput = "";
      try { logOutput = readFileSync(LOG_FILE, "utf-8").trim(); } catch { /* ignore */ }
      return NextResponse.json({
        ok: false,
        error: `Daemon exited immediately. Log: ${logOutput.slice(0, 300) || "(empty)"}`,
      }, { status: 500 });
    }

    writeFileSync(PID_FILE, String(pid));
    return NextResponse.json({ ok: true, running: true, pid });
  }

  if (action === "stop") {
    const pid = readPid();
    if (!pid) return NextResponse.json({ ok: true, running: false });

    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already dead
    }
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
    return NextResponse.json({ ok: true, running: false });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
