-- Core tables (4 tables)

CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT UNIQUE NOT NULL,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  prompt_text TEXT,
  prompt_preview TEXT,
  prompt_hash TEXT,
  cwd TEXT NOT NULL,
  project_name TEXT,

  -- Classification
  primary_category TEXT NOT NULL,
  primary_subcategory TEXT NOT NULL,
  primary_confidence REAL NOT NULL,
  secondary_category TEXT,
  secondary_subcategory TEXT,
  secondary_confidence REAL,
  classification_method TEXT NOT NULL,
  classification_reasoning TEXT,
  pending_llm_classification INTEGER DEFAULT 0,

  -- Time attribution
  attributed_minutes REAL NOT NULL,
  attribution_method TEXT NOT NULL,
  time_confidence TEXT NOT NULL,
  gap_to_next_seconds INTEGER,
  response_timestamp TEXT,
  response_duration_seconds REAL,

  -- Override tracking
  previous_category TEXT,
  previous_subcategory TEXT,
  override_reason TEXT,
  override_at TEXT,

  -- Privacy
  redacted INTEGER DEFAULT 0,

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prompts_session ON prompts(session_id);
CREATE INDEX IF NOT EXISTS idx_prompts_timestamp ON prompts(timestamp);
CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(primary_category);
CREATE INDEX IF NOT EXISTS idx_prompts_hash ON prompts(prompt_hash);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS subcategories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  sort_order INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1,
  example_prompts TEXT NOT NULL,
  UNIQUE(category_id, slug)
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  summary TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_minutes REAL NOT NULL,
  attendee_count INTEGER DEFAULT 0,
  location TEXT,
  primary_category TEXT NOT NULL,
  primary_subcategory TEXT NOT NULL,
  primary_confidence REAL NOT NULL,
  classification_reasoning TEXT,
  previous_category TEXT,
  override_reason TEXT,
  override_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cal_start ON calendar_events(start_time);

CREATE TABLE IF NOT EXISTS window_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT UNIQUE NOT NULL,
  app_name TEXT NOT NULL,
  window_title TEXT,
  start_time TEXT NOT NULL,
  duration_minutes REAL NOT NULL,
  primary_category TEXT NOT NULL,
  primary_subcategory TEXT NOT NULL,
  primary_confidence REAL NOT NULL,
  classification_reasoning TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_win_start ON window_events(start_time);

CREATE TABLE IF NOT EXISTS browser_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT UNIQUE NOT NULL,
  browser TEXT NOT NULL,
  domain TEXT NOT NULL,
  url TEXT NOT NULL,
  page_title TEXT,
  start_time TEXT NOT NULL,
  duration_minutes REAL NOT NULL,
  primary_category TEXT NOT NULL,
  primary_subcategory TEXT NOT NULL,
  primary_confidence REAL NOT NULL,
  classification_reasoning TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_browser_events_start_time ON browser_events(start_time);

CREATE TABLE IF NOT EXISTS user_rules (
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
CREATE INDEX IF NOT EXISTS idx_user_rules_type_pattern ON user_rules(rule_type, pattern);

CREATE TABLE IF NOT EXISTS idle_spans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT UNIQUE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_minutes REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'window',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_idle_spans_start ON idle_spans(start_time);
CREATE INDEX IF NOT EXISTS idx_idle_spans_end ON idle_spans(end_time);

-- Training loop tables (Phase 9)

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
  source TEXT NOT NULL DEFAULT 'prompt' CHECK(source IN ('prompt', 'window', 'browser', 'calendar')),
  source_id INTEGER NOT NULL,
  prompt_id INTEGER REFERENCES prompts(id),
  llm_category TEXT NOT NULL,
  llm_subcategory TEXT NOT NULL,
  llm_confidence REAL NOT NULL,
  llm_reasoning TEXT,
  event_time TEXT,
  human_category TEXT,
  human_subcategory TEXT,
  human_approved INTEGER DEFAULT 0,
  reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(batch_id, source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_training_items_batch ON training_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_training_items_prompt ON training_items(prompt_id);

CREATE TABLE IF NOT EXISTS training_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_text TEXT NOT NULL,
  correct_category TEXT NOT NULL,
  correct_subcategory TEXT NOT NULL,
  source_batch_id INTEGER REFERENCES training_batches(id),
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_training_examples_active ON training_examples(active);

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
