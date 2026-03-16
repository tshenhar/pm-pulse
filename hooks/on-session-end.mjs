import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

const dataDir = join(homedir(), ".pm-pulse");
const eventsDir = join(dataDir, "events");

try {
  mkdirSync(eventsDir, { recursive: true });

  const input = JSON.parse(readFileSync("/dev/stdin", "utf-8"));

  // Validate required fields
  if (!input.session_id || typeof input.session_id !== "string") {
    throw new Error("Missing or invalid 'session_id' field");
  }
  if (!input.cwd || typeof input.cwd !== "string") {
    throw new Error("Missing or invalid 'cwd' field");
  }

  const event = {
    id: randomUUID(),
    type: "session_end",
    timestamp: new Date().toISOString(),
    session_id: input.session_id,
    cwd: input.cwd,
  };

  writeFileSync(join(eventsDir, `${event.id}.json`), JSON.stringify(event));
  process.exit(0);
} catch (err) {
  try {
    appendFileSync(
      join(dataDir, "hook-errors.log"),
      `${new Date().toISOString()} on-session-end: ${err.message}\n`
    );
  } catch {}
  process.exit(0);
}
