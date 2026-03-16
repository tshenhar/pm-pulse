import { readdirSync, readFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { EVENTS_DIR } from "../db";
import type { HookEvent } from "../types";

const FAILED_DIR = join(EVENTS_DIR, "failed");

export function readPendingEvents(): HookEvent[] {
  let files: string[];
  try {
    files = readdirSync(EVENTS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  if (files.length === 0) return [];

  const events: HookEvent[] = [];

  for (const file of files) {
    const filePath = join(EVENTS_DIR, file);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);

      // Validate required fields
      if (!parsed.id || !parsed.type || !parsed.timestamp || !parsed.session_id) {
        moveToFailed(filePath, file);
        continue;
      }

      events.push(parsed as HookEvent);
    } catch {
      moveToFailed(filePath, file);
    }
  }

  // Sort by timestamp ascending
  events.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  return events;
}

function moveToFailed(filePath: string, fileName: string): void {
  try {
    mkdirSync(FAILED_DIR, { recursive: true });
    renameSync(filePath, join(FAILED_DIR, fileName));
  } catch {
    // Best effort
  }
}
