import { readdirSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { WINDOW_EVENTS_DIR } from "@/lib/constants";
import { getDb } from "@/lib/db";

interface WindowSession {
  id: string;
  type: "window_session";
  app_name: string;
  window_title?: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
}

interface WindowClassification {
  category: string;
  subcategory: string;
  confidence: number;
  reasoning: string;
}

// File extension → PM category mapping for code editors
const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|cs|cpp|c|h|swift|kt|vue|svelte|php)$/i;
const CONFIG_EXTENSIONS = /\.(json|yaml|yml|toml|env|sh|bash|zsh|dockerfile|lock|prisma|graphql)$/i;
const DOC_EXTENSIONS = /\.(md|mdx|txt|rst|doc|docx)$/i;
const DATA_EXTENSIONS = /\.(sql|csv|psql)$/i;
const MEETING_TITLE_RE = /meeting|notes|standup|stand.?up|1:1|one.on.one|sync|recap|retro|retrospective/i;

function extractFilename(windowTitle: string): string | null {
  // VS Code title formats:
  //   "utils.ts — pm-pulse"       (em dash)
  //   "● utils.ts — pm-pulse"     (unsaved marker)
  //   "utils.ts - Visual Studio Code"  (some versions)
  const cleaned = windowTitle.replace(/^[●•]\s*/, "");
  const beforeSeparator = cleaned.split(/\s[—–-]\s/)[0].trim();
  // Must look like a filename (has a dot but not a path or sentence)
  if (/^[^/\\]+\.[a-zA-Z0-9]+$/.test(beforeSeparator)) return beforeSeparator;
  return null;
}

function classifyByFileExtension(filename: string, rawTitle: string): WindowClassification | null {
  if (CODE_EXTENSIONS.test(filename)) {
    return { category: "development", subcategory: "coding", confidence: 0.88, reasoning: `code file: ${filename}` };
  }
  if (DATA_EXTENSIONS.test(filename)) {
    return { category: "analytics", subcategory: "data", confidence: 0.85, reasoning: `data file: ${filename}` };
  }
  if (CONFIG_EXTENSIONS.test(filename)) {
    return { category: "development", subcategory: "tooling", confidence: 0.8, reasoning: `config file: ${filename}` };
  }
  if (DOC_EXTENSIONS.test(filename)) {
    if (MEETING_TITLE_RE.test(rawTitle)) {
      return { category: "communication", subcategory: "meetings", confidence: 0.78, reasoning: `meeting notes: ${filename}` };
    }
    return { category: "writing", subcategory: "process", confidence: 0.78, reasoning: `doc file: ${filename}` };
  }
  return null;
}

function classifyWindow(appName: string, windowTitle?: string): WindowClassification {
  const app = appName.toLowerCase();
  const title = (windowTitle || "").toLowerCase();

  if (app === "idle time") {
    return { category: "idle", subcategory: "away", confidence: 1.0, reasoning: "idle time — no keyboard/mouse activity" };
  }

  if (/microsoft word|pages/.test(app)) {
    return { category: "writing", subcategory: "general", confidence: 0.7, reasoning: `word processor: ${appName}` };
  }
  if (/microsoft powerpoint|keynote/.test(app)) {
    return { category: "communication", subcategory: "presentation", confidence: 0.75, reasoning: `presentation tool: ${appName}` };
  }
  if (/microsoft excel|numbers/.test(app)) {
    return { category: "analytics", subcategory: "data", confidence: 0.7, reasoning: `spreadsheet: ${appName}` };
  }
  if (/slack|microsoft teams|^teams$|msteams/.test(app)) {
    return { category: "communication", subcategory: "meetings", confidence: 0.6, reasoning: `messaging: ${appName}` };
  }
  if (/zoom\.us|^zoom$/.test(app)) {
    return { category: "communication", subcategory: "meetings", confidence: 0.75, reasoning: `video meeting: ${appName}` };
  }
  if (/figma|miro|lucidchart/.test(app)) {
    return { category: "requirements", subcategory: "ux", confidence: 0.8, reasoning: `design tool: ${appName}` };
  }
  if (/jira|linear|asana|notion/.test(app)) {
    return { category: "requirements", subcategory: "epic", confidence: 0.75, reasoning: `PM tool: ${appName}` };
  }
  if (/terminal|iterm|warp|ghostty/.test(app)) {
    return { category: "development", subcategory: "coding", confidence: 0.75, reasoning: `terminal: ${appName}` };
  }
  // Code editors — enrich with window title if available
  if (/visual studio code|cursor|xcode|electron/.test(app)) {
    if (windowTitle) {
      const filename = extractFilename(windowTitle);
      if (filename) {
        const enriched = classifyByFileExtension(filename, windowTitle);
        if (enriched) return enriched;
      }
    }
    return { category: "development", subcategory: "coding", confidence: 0.7, reasoning: `editor: ${appName}` };
  }
  if (/outlook|apple mail/.test(app)) {
    return { category: "communication", subcategory: "stakeholder", confidence: 0.6, reasoning: `email: ${appName}` };
  }
  if (/chrome|safari|firefox|arc|edge/.test(app)) {
    // Title heuristics
    if (/teams\.microsoft\.com|zoom\.us|meet\.google\.com|webex/.test(title)) {
      return { category: "communication", subcategory: "meetings", confidence: 0.7, reasoning: `browser meeting` };
    }
    if (/jira|linear|notion|confluence/.test(title)) {
      return { category: "requirements", subcategory: "epic", confidence: 0.5, reasoning: `browser PM tool` };
    }
    if (/figma|miro/.test(title)) {
      return { category: "requirements", subcategory: "ux", confidence: 0.5, reasoning: `browser design tool` };
    }
    if (/github|gitlab|stackoverflow/.test(title)) {
      return { category: "development", subcategory: "coding", confidence: 0.45, reasoning: `browser dev site` };
    }
    return { category: "productivity", subcategory: "admin", confidence: 0.4, reasoning: `browser: ${appName}` };
  }

  return { category: "productivity", subcategory: "admin", confidence: 0.3, reasoning: `unknown app: ${appName}` };
}

const BROWSER_APPS = /^(Google Chrome|Safari|Arc|Microsoft Edge)$/;

function loadAppNameRules(db: ReturnType<typeof getDb>): Map<string, { action: 'classify' | 'exclude'; category?: string; subcategory?: string }> {
  const rows = db
    .prepare("SELECT pattern, action, primary_category, primary_subcategory FROM user_rules WHERE rule_type = 'app_name'")
    .all() as { pattern: string; action: string; primary_category: string | null; primary_subcategory: string | null }[];
  return new Map(rows.map((r) => [r.pattern, {
    action: r.action as 'classify' | 'exclude',
    category: r.primary_category ?? undefined,
    subcategory: r.primary_subcategory ?? undefined,
  }]));
}

export function processWindowEvents(opts?: { skipBrowserApps?: boolean }): { processed: number; errors: number } {
  let processed = 0;
  let errors = 0;
  const skipBrowserApps = opts?.skipBrowserApps ?? false;

  const eventsDir = process.env.__TEST_WINDOW_EVENTS_DIR ?? WINDOW_EVENTS_DIR;

  let files: string[];
  try {
    files = readdirSync(eventsDir).filter((f) => f.endsWith(".json"));
  } catch {
    return { processed: 0, errors: 0 }; // dir doesn't exist yet
  }

  if (files.length === 0) return { processed: 0, errors: 0 };

  const db = getDb();
  const appNameRules = loadAppNameRules(db);

  const upsert = db.prepare(`
    INSERT INTO window_events (external_id, app_name, window_title, start_time, duration_minutes,
      primary_category, primary_subcategory, primary_confidence, classification_reasoning)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(external_id) DO NOTHING
  `);

  const upsertIdle = db.prepare(`
    INSERT INTO idle_spans (external_id, start_time, end_time, duration_minutes, source)
    VALUES (?, ?, ?, ?, 'window')
    ON CONFLICT(external_id) DO NOTHING
  `);

  const MIN_DURATION_SECONDS = 30;
  const processedFiles: string[] = [];

  const runAll = db.transaction(() => {
    for (const file of files) {
      try {
        const filePath = join(eventsDir, file);
        const raw = readFileSync(filePath, "utf-8");
        const session = JSON.parse(raw) as WindowSession;

        if (session.duration_seconds < MIN_DURATION_SECONDS) {
          processedFiles.push(filePath); // too short — still remove the file
          continue;
        }

        // When browser tracking is on, skip browser apps (they get higher-fidelity per-URL tracking)
        if (skipBrowserApps && BROWSER_APPS.test(session.app_name)) {
          processedFiles.push(filePath); // consume the file but don't insert
          continue;
        }

        const durationMinutes = session.duration_seconds / 60;
        const userRule = appNameRules.get(session.app_name);

        if (userRule?.action === 'exclude') {
          processedFiles.push(filePath); // consume file, skip insert
          continue;
        }

        const classification = userRule?.action === 'classify' && userRule.category && userRule.subcategory
          ? { category: userRule.category, subcategory: userRule.subcategory, confidence: 1.0, reasoning: `user rule: ${session.app_name}` }
          : classifyWindow(session.app_name, session.window_title);

        if (classification.category === "idle") {
          upsertIdle.run(session.id, session.start_time, session.end_time, durationMinutes);
          processedFiles.push(filePath);
          continue;
        }

        upsert.run(
          session.id,
          session.app_name,
          session.window_title ?? null,
          session.start_time,
          durationMinutes,
          classification.category,
          classification.subcategory,
          classification.confidence,
          classification.reasoning
        );
        processedFiles.push(filePath);
        processed++;
      } catch {
        errors++;
      }
    }
  });

  runAll();

  // Clean up processed files after successful DB commit
  for (const filePath of processedFiles) {
    try { unlinkSync(filePath); } catch { /* non-fatal */ }
  }

  return { processed, errors };
}
