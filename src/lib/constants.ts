import { join } from "path";
import { homedir } from "os";

export const DATA_DIR = join(homedir(), ".pm-pulse");
export const EVENTS_DIR = join(DATA_DIR, "events");
export const DB_PATH = join(DATA_DIR, "pm-pulse.db");
export const ERROR_LOG = join(DATA_DIR, "hook-errors.log");
export const WATCHER_CONFIG_PATH = join(DATA_DIR, "watcher-config.json");

// Session gap — used for display grouping only, not for time attribution
export const DEFAULT_SESSION_GAP_MINUTES = 30;

// Polling
export const DASHBOARD_POLL_INTERVAL_MS = 30_000;
export const CALENDAR_SYNC_INTERVAL_MS = 30 * 60 * 1000;

// Window events
export const WINDOW_EVENTS_DIR = join(DATA_DIR, "window-events");

// Browser events
export const BROWSER_EVENTS_DIR = join(DATA_DIR, "browser-events");

// Classification
export const LOW_CONFIDENCE_THRESHOLD = 0.4;
export const PROMPT_PREVIEW_LENGTH = 200;
