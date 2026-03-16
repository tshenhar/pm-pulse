import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID, createHash } from "crypto";

const dataDir = join(homedir(), ".pm-pulse");
const eventsDir = join(dataDir, "events");
const MAX_PROMPT_BYTES = 10 * 1024; // 10KB

try {
  mkdirSync(eventsDir, { recursive: true });

  const input = JSON.parse(readFileSync("/dev/stdin", "utf-8"));

  // Validate required fields
  if (!input.prompt || typeof input.prompt !== "string") {
    throw new Error("Missing or invalid 'prompt' field");
  }
  if (!input.session_id || typeof input.session_id !== "string") {
    throw new Error("Missing or invalid 'session_id' field");
  }
  if (!input.cwd || typeof input.cwd !== "string") {
    throw new Error("Missing or invalid 'cwd' field");
  }

  const fullPrompt = input.prompt;
  const promptHash = createHash("sha256").update(fullPrompt).digest("hex");
  const wasTruncated = fullPrompt.length > MAX_PROMPT_BYTES;
  const truncatedPrompt = wasTruncated
    ? fullPrompt.slice(0, MAX_PROMPT_BYTES)
    : fullPrompt;

  if (wasTruncated) {
    appendFileSync(
      join(dataDir, "hook-errors.log"),
      `${new Date().toISOString()} on-prompt: truncated prompt from ${fullPrompt.length} to ${MAX_PROMPT_BYTES} bytes\n`
    );
  }

  const event = {
    id: randomUUID(),
    type: "prompt",
    timestamp: new Date().toISOString(),
    session_id: input.session_id,
    prompt: truncatedPrompt,
    prompt_hash: promptHash,
    cwd: input.cwd,
    permission_mode: input.permission_mode,
  };

  writeFileSync(join(eventsDir, `${event.id}.json`), JSON.stringify(event));
  process.exit(0);
} catch (err) {
  try {
    appendFileSync(
      join(dataDir, "hook-errors.log"),
      `${new Date().toISOString()} on-prompt: ${err.message}\n`
    );
  } catch {}
  process.exit(0);
}
