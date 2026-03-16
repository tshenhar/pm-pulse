// === Event types (from hook scripts) ===

export interface PromptEvent {
  id: string;
  type: "prompt";
  timestamp: string;
  session_id: string;
  prompt: string;
  prompt_hash: string;
  cwd: string;
  permission_mode?: string;
}

export interface SessionStartEvent {
  id: string;
  type: "session_start";
  timestamp: string;
  session_id: string;
  source: string;
  model: string;
  cwd: string;
}

export interface SessionEndEvent {
  id: string;
  type: "session_end";
  timestamp: string;
  session_id: string;
  cwd: string;
}

export interface StopEvent {
  id: string;
  type: "stop";
  timestamp: string;
  session_id: string;
  cwd: string;
}

export type HookEvent = PromptEvent | SessionStartEvent | SessionEndEvent | StopEvent;

// === Database row types ===

export interface PromptRow {
  id: number;
  external_id: string;
  session_id: string;
  timestamp: string;
  prompt_text: string | null;
  prompt_preview: string | null;
  prompt_hash: string | null;
  cwd: string;
  project_name: string | null;

  primary_category: string;
  primary_subcategory: string;
  primary_confidence: number;
  secondary_category: string | null;
  secondary_subcategory: string | null;
  secondary_confidence: number | null;
  classification_method: "rules" | "llm";
  classification_reasoning: string | null;
  pending_llm_classification: number;

  attributed_minutes: number;
  attribution_method: string;
  time_confidence: string;
  gap_to_next_seconds: number | null;
  response_timestamp: string | null;
  response_duration_seconds: number | null;

  previous_category: string | null;
  previous_subcategory: string | null;
  override_reason: string | null;
  override_at: string | null;

  redacted: number;
  created_at: string;
  updated_at: string;
}

export interface CategoryRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  color: string;
  sort_order: number;
  is_active: number;
}

export interface SubcategoryRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  category_id: number;
  sort_order: number;
  is_active: number;
  example_prompts: string; // JSON array
}

export interface SettingRow {
  id: number;
  key: string;
  value: string; // JSON-encoded
}

// === Classification types ===

export interface ClassificationResult {
  primary_category: string;
  primary_subcategory: string;
  primary_confidence: number;
  secondary_category?: string;
  secondary_subcategory?: string;
  secondary_confidence?: number;
  method: "rules" | "llm";
  reasoning?: string;
  matchedPatterns?: string[];
}

// === Time attribution types ===

export type AttributionMethod =
  | "measured"
  | "idle_adjusted"
  | "session_bounded"
  | "cross_source"
  | "pending"
  | "direct";

export type AttributionQuality =
  | "explained"
  | "unexplained"
  | "direct"
  | "pending";

export interface AttributionResult {
  attributed_minutes: number;
  attribution_method: AttributionMethod;
  time_confidence: AttributionQuality;
  gap_to_next_seconds: number | null;
}

// === New data source types ===

export type EventSource = "prompt" | "calendar" | "window" | "browser";

export interface IdleSpanRow {
  id: number;
  external_id: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  source: string;
}

export interface CalendarEventRow {
  id: number;
  uid: string;
  summary: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  attendee_count: number;
  location: string | null;
  primary_category: string;
  primary_subcategory: string;
  primary_confidence: number;
  classification_reasoning: string | null;
  previous_category: string | null;
  override_reason: string | null;
  override_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WindowEventRow {
  id: number;
  external_id: string;
  app_name: string;
  window_title: string | null;
  start_time: string;
  duration_minutes: number;
  primary_category: string;
  primary_subcategory: string;
  primary_confidence: number;
  classification_reasoning: string | null;
  created_at: string;
}

export interface BrowserEventRow {
  id: number;
  external_id: string;
  browser: string;
  domain: string;
  url: string;
  page_title: string | null;
  start_time: string;
  duration_minutes: number;
  primary_category: string;
  primary_subcategory: string;
  primary_confidence: number;
  classification_reasoning: string | null;
  created_at: string;
}

export interface ActivitySummary {
  id: number;
  source: EventSource;
  timestamp: string;
  title: string;
  primary_category: string;
  primary_subcategory: string;
  primary_confidence: number;
  attributed_minutes: number;
  // prompt-specific
  project_name?: string | null;
  classification_method?: "rules" | "llm";
  attribution_method?: string;
  time_confidence?: string;
  gap_to_next_seconds?: number | null;
  response_duration_seconds?: number | null;
  // calendar-specific
  attendee_count?: number;
  location?: string | null;
  end_time?: string;
  // shared
  classification_reasoning?: string | null;
}

// === API response types ===

export interface PromptSummary {
  id: number;
  timestamp: string;
  prompt_preview: string | null;
  project_name: string | null;
  primary_category: string;
  primary_subcategory: string;
  primary_confidence: number;
  classification_method: "rules" | "llm";
  classification_reasoning: string | null;
  attributed_minutes: number;
  attribution_method: string;
  time_confidence: string;
  gap_to_next_seconds: number | null;
}

export interface YesterdayTotals {
  total_hours: number;
  total_sessions: number;
  total_prompts: number;
  meeting_count: number;
  focus_minutes: number;
}

export interface SourceBreakdown {
  claude_minutes: number;
  calendar_minutes: number;
  window_minutes: number;
  browser_minutes: number;
}

export interface DashboardData {
  date: string;
  total_hours: number;
  total_sessions: number;
  total_prompts: number;
  total_events: number;
  meeting_count: number;
  focus_minutes: number;
  tracked_pct: number;
  expected_minutes: number;
  source_breakdown: SourceBreakdown;
  top_category: string | null;
  category_breakdown: CategoryBreakdown[];
  project_breakdown: ProjectBreakdown[];
  activities: ActivitySummary[];
  yesterday?: YesterdayTotals;
  auto_refresh: boolean;
}

export interface CategoryBreakdown {
  category: string;
  name: string;
  color: string;
  minutes: number;
  percentage: number;
  subcategories: { subcategory: string; name: string; minutes: number }[];
}

export interface ProjectBreakdown {
  project: string;
  minutes: number;
  prompt_count: number;
}

// === Exclusion rules ===

export interface ExclusionRule {
  id: number;
  rule_type: 'app_name' | 'domain';
  pattern: string;
  created_at: string;
}

// === Training loop types ===

export type TrainingBatchStatus = "collecting" | "reviewing" | "applied" | "cancelled";

export interface TrainingBatch {
  id: number;
  status: TrainingBatchStatus;
  target_count: number;
  classification_mode: string;
  created_at: string;
  completed_at: string | null;
  accuracy_before: number | null;
  accuracy_after: number | null;
  // derived (not stored)
  collected_count?: number;
  reviewed_count?: number;
}

export interface TrainingItem {
  id: number;
  batch_id: number;
  source: EventSource;
  source_id: number;
  prompt_id: number | null;
  llm_category: string;
  llm_subcategory: string;
  llm_confidence: number;
  llm_reasoning: string | null;
  human_category: string | null;
  human_subcategory: string | null;
  human_approved: number;
  reviewed_at: string | null;
  created_at: string;
  event_time: string | null;
  // joined display fields (source-dependent)
  display_text?: string | null;
  timestamp?: string;
  project_name?: string | null;
  prompt_preview?: string | null;
  prompt_text?: string | null;
}

// === Settings ===

export type PrivacyMode = "full" | "preview" | "redacted";
export type ClassificationMode = "rules" | "hybrid" | "llm";

export interface AppSettings {
  privacy_mode: PrivacyMode;
  classification_mode: ClassificationMode;
  calendar_ics_url: string;
  calendar_block_keyword: string;
  window_tracking_enabled: boolean;
  idle_threshold_minutes: number;
  min_session_seconds: number;
  calendar_sync_interval_minutes: number;
  browser_tracking_enabled: boolean;
  browser_event_retention_days: number;
  dashboard_auto_refresh: boolean;
  dashboard_card_order: string[];
  dashboard_card_spans: Record<string, number>;
  dashboard_labels: Record<string, string>;
  dashboard_col_count: number;
  settings_card_order: string[];
  settings_col_count: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  privacy_mode: "full",
  classification_mode: "rules",
  calendar_ics_url: "",
  calendar_block_keyword: "BLOCK",
  window_tracking_enabled: false,
  idle_threshold_minutes: 2,
  min_session_seconds: 30,
  calendar_sync_interval_minutes: 30,
  browser_tracking_enabled: false,
  browser_event_retention_days: 7,
  dashboard_auto_refresh: false,
  dashboard_card_order: ["category", "source", "activity"],
  dashboard_card_spans: {},
  dashboard_labels: {},
  dashboard_col_count: 2,
  settings_card_order: ["privacy", "classification", "activity-tracking", "calendar", "window", "browser", "dashboard-settings", "exclusions", "export"],
  settings_col_count: 1,
};
