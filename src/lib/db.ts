import Database from "better-sqlite3";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, readFileSync } from "fs";
import { DEFAULT_SETTINGS, type AppSettings } from "./types";

const DATA_DIR = join(homedir(), ".pm-pulse");
const isTest = process.env.NODE_ENV === "test";
const DB_PATH = isTest
  ? join(DATA_DIR, "pm-pulse-test.db")
  : join(DATA_DIR, "pm-pulse.db");
export const EVENTS_DIR = isTest
  ? join(DATA_DIR, "events-test")
  : join(DATA_DIR, "events");

let _db: Database.Database | null = null;
let _seeded = false;

export function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure data and events directories exist on first DB access
  mkdirSync(EVENTS_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  // Run schema creation (IF NOT EXISTS — safe to re-run)
  const schemaPath = join(process.cwd(), "src", "lib", "db", "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  _db.exec(schema);

  // Migrations: add columns that may not exist in older DBs
  try { _db.exec("ALTER TABLE prompts ADD COLUMN response_timestamp TEXT"); } catch {}
  try { _db.exec("ALTER TABLE prompts ADD COLUMN response_duration_seconds REAL"); } catch {}
  try { _db.exec("ALTER TABLE training_items ADD COLUMN event_time TEXT"); } catch {}

  // Migration: add action column to user_rules (idempotent)
  try {
    _db.exec(`ALTER TABLE user_rules ADD COLUMN action TEXT NOT NULL DEFAULT 'classify' CHECK(action IN ('classify', 'exclude'))`);
  } catch {}

  // Migration: rebuild user_rules to make primary_category/subcategory nullable (for exclude rules)
  const colInfo = _db.prepare(`PRAGMA table_info(user_rules)`).all() as { name: string; notnull: number }[];
  const catCol = colInfo.find((c) => c.name === "primary_category");
  if (catCol && catCol.notnull === 1) {
    _db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE user_rules_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_type TEXT NOT NULL CHECK(rule_type IN ('domain', 'app_name')),
        pattern TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT 'classify' CHECK(action IN ('classify', 'exclude')),
        primary_category TEXT,
        primary_subcategory TEXT,
        hit_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(rule_type, pattern),
        CHECK(action = 'exclude' OR (primary_category IS NOT NULL AND primary_subcategory IS NOT NULL))
      );
      INSERT INTO user_rules_new SELECT id, rule_type, pattern, COALESCE(action, 'classify'),
        primary_category, primary_subcategory, hit_count, created_at, updated_at FROM user_rules;
      DROP TABLE user_rules;
      ALTER TABLE user_rules_new RENAME TO user_rules;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  // Migration: rebuild training_items to add source/source_id columns and change UNIQUE constraint
  const tiColInfo = _db.prepare(`PRAGMA table_info(training_items)`).all() as { name: string }[];
  if (tiColInfo.length > 0 && !tiColInfo.some((c) => c.name === "source")) {
    _db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE training_items_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES training_batches(id),
        source TEXT NOT NULL DEFAULT 'prompt' CHECK(source IN ('prompt', 'window', 'browser', 'calendar')),
        source_id INTEGER NOT NULL,
        prompt_id INTEGER REFERENCES prompts(id),
        llm_category TEXT NOT NULL,
        llm_subcategory TEXT NOT NULL,
        llm_confidence REAL NOT NULL,
        llm_reasoning TEXT,
        human_category TEXT,
        human_subcategory TEXT,
        human_approved INTEGER DEFAULT 0,
        reviewed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(batch_id, source, source_id)
      );
      INSERT INTO training_items_new
        SELECT id, batch_id, 'prompt', prompt_id, prompt_id,
               llm_category, llm_subcategory, llm_confidence, llm_reasoning,
               human_category, human_subcategory, human_approved, reviewed_at, created_at
        FROM training_items WHERE prompt_id IS NOT NULL;
      DROP TABLE training_items;
      ALTER TABLE training_items_new RENAME TO training_items;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  // Migrations: initiative_slug columns
  try { _db.exec("ALTER TABLE prompts ADD COLUMN initiative_slug TEXT"); } catch {}
  try { _db.exec("ALTER TABLE window_events ADD COLUMN initiative_slug TEXT"); } catch {}
  try { _db.exec("ALTER TABLE browser_events ADD COLUMN initiative_slug TEXT"); } catch {}

  // Create initiatives and daily_scores tables (idempotent)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS initiatives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      keywords TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#6366f1',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS daily_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE NOT NULL,
      score REAL NOT NULL,
      strategic_score REAL NOT NULL,
      focus_score REAL NOT NULL,
      reactive_score REAL NOT NULL,
      computed_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Phase 9: training loop tables (CREATE IF NOT EXISTS — schema handles it above,
  // but listed here for clarity on migration order)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS training_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'collecting' CHECK(status IN ('collecting', 'reviewing', 'applied', 'cancelled')),
      target_count INTEGER NOT NULL DEFAULT 100,
      classification_mode TEXT NOT NULL DEFAULT 'llm',
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      accuracy_before REAL,
      accuracy_after REAL
    );
    CREATE TABLE IF NOT EXISTS training_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES training_batches(id),
      prompt_id INTEGER NOT NULL REFERENCES prompts(id),
      llm_category TEXT NOT NULL,
      llm_subcategory TEXT NOT NULL,
      llm_confidence REAL NOT NULL,
      llm_reasoning TEXT,
      human_category TEXT,
      human_subcategory TEXT,
      human_approved INTEGER DEFAULT 0,
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(batch_id, prompt_id)
    );
    CREATE TABLE IF NOT EXISTS training_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_text TEXT NOT NULL,
      correct_category TEXT NOT NULL,
      correct_subcategory TEXT NOT NULL,
      source_batch_id INTEGER REFERENCES training_batches(id),
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed on first init
  if (!_seeded) {
    // Dynamic import avoided — seed is called explicitly after getDb
    _seeded = true;
  }

  return _db;
}

/**
 * Initialize database: create tables and seed data.
 * Call once at app startup (e.g., in API route or server init).
 */
export async function initDb(): Promise<Database.Database> {
  const db = getDb();
  // Dynamic import to avoid circular dependency (seed imports getDb)
  const { seedDatabase } = await import("./db/seed");
  seedDatabase();
  return db;
}

export const DATA_DIR_PATH = DATA_DIR;

/**
 * Load all settings from the DB, merging with DEFAULT_SETTINGS for any missing keys.
 * Returns a fully-typed AppSettings object — no unsafe casts needed at call sites.
 */
export function loadSettings(): AppSettings {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM settings")
    .all() as { key: string; value: string }[];
  const overrides = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  return { ...DEFAULT_SETTINGS, ...overrides } as AppSettings;
}
