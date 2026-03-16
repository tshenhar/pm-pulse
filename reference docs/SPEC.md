# PM Pulse — Technical Specification

## 1. Executive Summary

**PM Pulse** is a local-first productivity tracker for Product Managers. It captures work activity from four sources — Claude Code prompts, browser tabs, macOS app usage, and calendar events — classifies each into a PM work taxonomy, attributes time using raw observational heuristics, and displays the breakdown through a web dashboard.

All data stays on the user's machine at `~/.pm-pulse/`. No cloud services, no telemetry, no data leaves the device unless the user explicitly opts into LLM-assisted classification.

**Key principles:**
- **Privacy-first**: All data at `~/.pm-pulse/`, SQLite on disk, no network calls by default
- **Observe, don't guess**: Report raw measurements; no artificial floors, caps, or fabricated durations
- **Explainable**: Every classification includes reasoning, confidence score, and method
- **Non-intrusive**: Hooks add <50ms overhead; daemons poll passively via system APIs
- **Modular**: Classification, attribution, ingestion, and storage are independently testable

---

## 2. Product Definition

### Problem Statement

PMs have no visibility into how their time distributes across activities. Calendar-based tracking misses deep work. Manual time logging is unsustainable. PM Pulse passively observes what you're actually doing — Claude prompts, browser research, app context switching, meetings — and turns those signals into an honest time breakdown.

### Goals

- Automatically capture activity from Claude Code, browser, macOS apps, and calendar
- Classify each activity into a 7-category PM work taxonomy
- Attribute time using raw observational data — no artificial caps or floors
- Display daily dashboards with category, project, and source breakdowns
- Persist historical data for weekly/monthly trend analysis
- Make classification transparent, auditable, and correctable

### Non-Goals

- Team-level or multi-user features
- Cloud sync or remote access
- Integration with external time tracking tools (Toggl, Clockify)
- Mobile interface
- Predictive analytics or AI-generated recommendations

### Key Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Local SQLite over cloud DB | Simpler, private, but no cross-device sync |
| Polling over SSE/WebSocket | Simpler architecture, 30s latency acceptable for a reflection tool |
| Per-event JSON files over append log | Easier daemon development, slight disk overhead |
| Rule-based classification first | Fast and local; LLM mode available for higher accuracy |
| Raw time attribution (no caps) | Honest but may produce large gaps; mitigated by cross-source corroboration |

---

## 3. Architecture

### System Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                     Data Collection Layer                     │
├─────────────────┬──────────────┬──────────────┬──────────────┤
│  Claude Hooks   │  Browser     │  Window      │  Calendar    │
│  (on-prompt,    │  Tracker     │  Watcher     │  ICS Sync    │
│   on-session-*) │  (daemon)    │  (daemon)    │  (periodic)  │
├─────────────────┴──────────────┴──────────────┴──────────────┤
│                   ~/.pm-pulse/{events,browser-events,         │
│                    window-events}/ (JSON files per event)     │
├──────────────────────────────────────────────────────────────┤
│                     Ingestion Layer                           │
│  processor.ts │ browser-ingestor.ts │ window-ingestor.ts │   │
│               │                     │ calendar-ingestor.ts   │
├──────────────────────────────────────────────────────────────┤
│           Classification (rules.ts / classifier.ts)          │
│           Time Attribution (time-engine.ts)                   │
├──────────────────────────────────────────────────────────────┤
│                SQLite (~/.pm-pulse/pm-pulse.db)              │
│  prompts │ categories │ subcategories │ settings │           │
│  calendar_events │ window_events │ browser_events            │
├──────────────────────────────────────────────────────────────┤
│                     API Layer (Next.js)                       │
│  /api/dashboard │ /api/trends │ /api/settings │ /api/ingest  │
│  /api/categories │ /api/calendar/sync │ /api/export          │
│  /api/prompts/[id]/reclassify                                │
├──────────────────────────────────────────────────────────────┤
│                     Dashboard UI                             │
│  page.tsx (daily) │ trends/page.tsx │ settings/page.tsx      │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Collection**: Hooks and daemons write JSON files to `~/.pm-pulse/` subdirectories
2. **Ingestion**: On each dashboard request, pending files are read, classified, time-attributed, and inserted into SQLite. Files are deleted after successful processing.
3. **Query**: API routes query SQLite with day-bounded timestamps (`getDayBounds()`)
4. **Display**: React client components fetch from API routes, render with Recharts

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, React 19) |
| UI | shadcn/ui (base-nova style) + Tailwind CSS 4 (OKLch) |
| Charts | Recharts |
| Database | SQLite via better-sqlite3 (server-side only) |
| Language | TypeScript 5 (strict, path alias `@/*` → `./src/*`) |
| Daemons | Node.js scripts (ESM), no dependencies beyond Node stdlib |

---

## 4. Data Sources

### 4.1 Claude Code Prompts

**Collection**: Three Claude Code hooks in `hooks/`:
- `on-prompt.mjs` — captures prompt text, session ID, cwd, permission mode
- `on-session-start.mjs` — logs session start with model info
- `on-session-end.mjs` — logs session end timestamp

Each hook writes a JSON file to `~/.pm-pulse/events/` with a UUID filename.

**Event format** (prompt):
```json
{
  "id": "uuid",
  "type": "prompt",
  "timestamp": "ISO-8601",
  "session_id": "string",
  "prompt": "full prompt text",
  "prompt_hash": "sha256 truncated",
  "cwd": "/absolute/path",
  "permission_mode": "auto"
}
```

**Processing** (`src/lib/ingestion/processor.ts`):
1. Read all pending `.json` files from events directory
2. Deduplicate by `prompt_hash`
3. Classify using rules engine (or LLM if configured)
4. Attribute time: raw gap to next prompt in same session
5. Retroactive fix-up: when a new prompt arrives, update the previous prompt's gap and attribution
6. Insert into `prompts` table, delete source file

**Setup**: `npm run setup` registers hooks in `~/.claude/settings.json`.

### 4.2 Browser Activity

**Collection**: `hooks/browser-tracker.mjs` — macOS daemon.

- Polls Chromium history databases every 5 seconds via `sqlite3` CLI (read-only, immutable mode)
- Supports Chrome, Edge, Arc (Chromium-based)
- Uses cursor-based reads (visit ID watermark) — never misses or re-processes visits
- Holds back the last visit per browser until its true end time is known
- Periodically flushes long-running visits (>2 min) for video watching / sustained reading
- Filters internal URLs (chrome://, localhost, 127.0.0.1)
- Writes per-visit JSON to `~/.pm-pulse/browser-events/`
- Startup cleanup: deletes files older than retention period (configurable, default 7 days)
- Graceful shutdown: flushes pending visits on SIGINT/SIGTERM

**No permissions required** — reads SQLite history files directly, no AppleScript or Automation.

**Processing** (`src/lib/ingestion/browser-ingestor.ts`):
1. Read all pending JSON files
2. Group consecutive same-domain visits (gap < 11 min) into sessions
3. Classify by domain + URL path (domain-based rules)
4. Insert into `browser_events` table with upsert, delete source files

**Start**: `npm run watch-browser`

### 4.3 Window/App Activity

**Collection**: `hooks/window-watcher.mjs` — macOS daemon.

- Polls frontmost app every 10 seconds via `lsappinfo` (no Automation permissions)
- Attempts window title capture via direct AppleScript to the app (optional, best-effort)
- Detects idle time via IOKit `HIDIdleTime` (configurable threshold, default 2 min)
- Flushes partial sessions every 60 seconds for dashboard freshness
- Maps bundle IDs to friendly names (VS Code, Cursor, Slack, etc.)
- Writes per-session JSON to `~/.pm-pulse/window-events/`

**Processing** (`src/lib/ingestion/window-ingestor.ts`):
1. Read all pending JSON files
2. Filter: minimum 60s duration, skip idle events
3. When browser tracking is enabled, skip browser apps (they get higher-fidelity per-URL tracking)
4. Classify by app name + window title (code editor files get extension-based enrichment)
5. Insert into `window_events` table, delete source files

**Start**: `npm run watch-windows`

### 4.4 Calendar Events

**Collection**: Periodic ICS sync.

- User pastes Outlook/Google Calendar ICS URL in settings
- `syncCalendarIfDue()` fires on dashboard requests at configurable intervals (default 30 min)
- Manual sync via `POST /api/calendar/sync`
- SSRF protection: blocks private/internal hostnames
- Uses `node-ical` library to parse ICS feed

**Processing** (`src/lib/ingestion/calendar-ingestor.ts`):
1. Fetch and parse ICS URL
2. Filter VEVENT entries with valid start/end times
3. Classify by summary text + attendee count + duration
4. Upsert into `calendar_events` table (updates on re-sync)

Events containing a configurable block keyword (default "BLOCK") are filtered from the dashboard (treated as focus blocks, not meetings).

---

## 5. Database Schema

Seven tables in SQLite at `~/.pm-pulse/pm-pulse.db`:

### prompts
Core table for Claude Code prompt events.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| external_id | TEXT UNIQUE | UUID from hook |
| session_id | TEXT | Claude session |
| timestamp | TEXT | ISO-8601 |
| prompt_text | TEXT | Full text (nullable for privacy) |
| prompt_preview | TEXT | First 200 chars |
| prompt_hash | TEXT | SHA-256 truncated, for dedup |
| cwd | TEXT | Working directory |
| project_name | TEXT | Derived from cwd |
| primary_category | TEXT | Classification |
| primary_subcategory | TEXT | Classification |
| primary_confidence | REAL | 0-1 |
| secondary_category | TEXT | Optional second match |
| secondary_subcategory | TEXT | |
| secondary_confidence | REAL | |
| classification_method | TEXT | "rules" or "llm" |
| classification_reasoning | TEXT | Human-readable explanation |
| pending_llm_classification | INTEGER | 0/1 flag |
| attributed_minutes | REAL | Time attributed |
| attribution_method | TEXT | How time was determined |
| time_confidence | TEXT | Attribution quality label |
| gap_to_next_seconds | INTEGER | Raw gap to next prompt |
| response_timestamp | TEXT | When Claude finished responding (from Stop hook) |
| response_duration_seconds | REAL | Measured response duration; method = `direct` |
| previous_category | TEXT | Before reclassification |
| previous_subcategory | TEXT | |
| override_reason | TEXT | Why reclassified |
| override_at | TEXT | When reclassified |
| redacted | INTEGER | Privacy flag |
| created_at | TEXT | |
| updated_at | TEXT | |

Indexes: session_id, timestamp, primary_category, prompt_hash.

### categories
PM work taxonomy (7 categories). Seeded on first run.

| Column | Type |
|--------|------|
| id | INTEGER PK |
| slug | TEXT UNIQUE |
| name | TEXT |
| description | TEXT |
| color | TEXT (hex) |
| sort_order | INTEGER |
| is_active | INTEGER |

### subcategories
~20 subcategories across 7 categories. Seeded on first run.

| Column | Type |
|--------|------|
| id | INTEGER PK |
| slug | TEXT |
| name | TEXT |
| description | TEXT |
| category_id | INTEGER FK |
| sort_order | INTEGER |
| is_active | INTEGER |
| example_prompts | TEXT (JSON array) |

### settings
Key-value store for app configuration.

| Column | Type |
|--------|------|
| id | INTEGER PK |
| key | TEXT UNIQUE |
| value | TEXT (JSON-encoded) |

### calendar_events

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| uid | TEXT UNIQUE | ICS event UID |
| summary | TEXT | Event title |
| start_time | TEXT | ISO-8601 |
| end_time | TEXT | ISO-8601 |
| duration_minutes | REAL | Computed |
| attendee_count | INTEGER | |
| location | TEXT | |
| primary_category | TEXT | |
| primary_subcategory | TEXT | |
| primary_confidence | REAL | |
| classification_reasoning | TEXT | |
| previous_category | TEXT | Override tracking |
| override_reason | TEXT | |
| override_at | TEXT | |
| created_at, updated_at | TEXT | |

Index: start_time.

### window_events

| Column | Type |
|--------|------|
| id | INTEGER PK |
| external_id | TEXT UNIQUE |
| app_name | TEXT |
| window_title | TEXT |
| start_time | TEXT |
| duration_minutes | REAL |
| primary_category | TEXT |
| primary_subcategory | TEXT |
| primary_confidence | REAL |
| classification_reasoning | TEXT |
| created_at | TEXT |

Index: start_time.

### browser_events

| Column | Type |
|--------|------|
| id | INTEGER PK |
| external_id | TEXT UNIQUE |
| browser | TEXT |
| domain | TEXT |
| url | TEXT |
| page_title | TEXT |
| start_time | TEXT |
| duration_minutes | REAL |
| primary_category | TEXT |
| primary_subcategory | TEXT |
| primary_confidence | REAL |
| classification_reasoning | TEXT |
| created_at | TEXT |

Index: start_time.

### user_rules

User-defined classification and exclusion rules (created via Tracking Exclusions UI or reclassification).

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| rule_type | TEXT | `'domain'` or `'app_name'` |
| pattern | TEXT | Exact match string |
| action | TEXT | `'classify'` or `'exclude'` |
| primary_category | TEXT | Target category (when action=classify) |
| primary_subcategory | TEXT | Target subcategory |
| hit_count | INTEGER | How many events matched this rule |
| created_at, updated_at | TEXT | |

Unique constraint: (rule_type, pattern).

### training_batches

Batches of LLM-classified events for human review (Phase 11 training loop).

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| status | TEXT | `collecting`, `reviewing`, `applied`, `cancelled` |
| target_count | INTEGER | Target sample size |
| classification_mode | TEXT | LLM mode used |
| created_at, completed_at | TEXT | |
| accuracy_before, accuracy_after | REAL | Accuracy delta from applying batch |

### training_items

Individual events within a training batch, with LLM + human labels.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| batch_id | INTEGER FK | References training_batches |
| source | TEXT | `prompt`, `window`, `browser`, `calendar` |
| source_id | INTEGER | Row ID in source table |
| prompt_id | INTEGER FK | References prompts (nullable) |
| llm_category, llm_subcategory | TEXT | LLM prediction |
| llm_confidence | REAL | |
| llm_reasoning | TEXT | |
| human_category, human_subcategory | TEXT | Human override (nullable) |
| human_approved | INTEGER | 0/1 |
| reviewed_at | TEXT | |

### training_examples

Curated correct-answer examples used to improve future LLM classification prompts.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| prompt_text | TEXT | Source text for the example |
| correct_category, correct_subcategory | TEXT | Ground truth labels |
| source_batch_id | INTEGER FK | Which batch produced this example |
| active | INTEGER | Whether included in LLM prompts |

---

## 6. Classification System

### PM Work Taxonomy (7 Categories)

| # | Category | Slug | Subcategories |
|---|----------|------|---------------|
| 1 | Strategy & Planning | `strategy` | roadmap, okr, research, vision |
| 2 | Requirements & Specifications | `requirements` | prd, epic, technical, ux |
| 3 | Communication & Alignment | `communication` | stakeholder, meetings, presentation, alignment |
| 4 | Writing & Documentation | `writing` | prfaq, process, general |
| 5 | Analytics & Experimentation | `analytics` | data, reporting, experimentation |
| 6 | Development & Technical | `development` | coding, architecture, tooling, bugs |
| 7 | Personal Productivity | `productivity` | learning, admin, meta |

### Classification Modes

| Mode | Description |
|------|-------------|
| `rules` | Pattern-based regex matching against prompt text. Fast, local, no API calls. Default. |
| `hybrid` | Rules first; prompts with confidence < 0.4 are queued for LLM classification. |
| `llm` | All prompts classified by LLM (Claude Haiku or Ollama). Explicit opt-in. |

### How Classification Works

**For Claude prompts** (`src/lib/classification/rules.ts`):
- ~25 regex patterns, each mapped to a category/subcategory with base confidence
- First matching pattern wins; confidence boosted by cwd context or prompt length
- Low confidence threshold: 0.4 — below this, the prompt is flagged for LLM fallback (if hybrid/llm mode)

**For browser events** (`src/lib/ingestion/browser-ingestor.ts`):
- Domain + URL path rules (e.g., `figma.com` → requirements/ux, `github.com/*/pull/*` → development/coding)
- ~15 domain patterns covering meetings, code hosting, docs, analytics, email, messaging

**For window events** (`src/lib/ingestion/window-ingestor.ts`):
- App name matching (Slack → communication, Figma → requirements/ux, VS Code → development)
- Code editor enrichment: extracts filename from window title, classifies by file extension
- Idle detection: classified as `idle/away` (filtered from dashboard)

**For calendar events** (`src/lib/ingestion/calendar-ingestor.ts`):
- Summary text + attendee count + duration heuristics
- 1:1 → communication/meetings, standup/sync → communication/meetings, review/planning → strategy/roadmap

### Reclassification

Users can override any prompt's classification via the detail sidebar:
- `POST /api/prompts/[id]/reclassify` with `{ category, subcategory, reason }`
- Original classification saved in `previous_category`/`previous_subcategory`
- Override timestamp and reason stored for audit trail

---

## 7. Time Attribution

### Design Philosophy

Prompts are **point-in-time events**, not time containers. The system observes gaps between events and reports them honestly. It does not impose artificial boundaries.

The user works in parallel: multiple Claude sessions, browser research between prompts, Slack in the background, meetings overlapping. The system reports what it sees — if 3 sessions overlap, total attributed time exceeds wall-clock time, and that's correct.

### Attribution Model

#### Claude Prompts: Raw Gap Attribution

1. **Non-last prompts**: `attributed_minutes = gap_to_next_prompt_in_same_session / 60`
   - No minimum floor, no maximum ceiling
   - A 30-second rapid prompt gets 0.5 minutes (not inflated to 2)
   - A 90-minute deep work gap gets 90 minutes (not capped to 60)

2. **Last prompt in session**: Marked as `pending` with 0 minutes until resolved by:
   - Next prompt arriving in the same session (retroactive fix-up)
   - `session_end` event firing (session-bounded)
   - Next event from any source in the same project (cross-source resolution)

3. **Parallel sessions**: Each session's prompts attributed independently. Overlapping sessions produce cumulative time — intentionally.

#### Browser / Window / Calendar: Direct Duration

These sources have measured durations from their daemons or ICS data. No attribution heuristics needed — the duration is directly observed.

### Attribution Method Labels

| Method | Meaning |
|--------|---------|
| `measured` | Gap to next prompt in same session (raw, uncapped) |
| `session_bounded` | Bounded by session_end event |
| `cross_source` | End determined by next event from any source in same project |
| `pending` | No forward signal yet, duration = 0 |
| `direct` | Browser/window/calendar with measured duration |

### Attribution Quality Labels

Replaces the old `HIGH`/`MEDIUM`/`LOW` confidence model:

| Quality | Meaning |
|---------|---------|
| `explained` | Gap ≤ 15 minutes (fast iteration, unlikely a long pause) |
| `unexplained` | Gap > 15 minutes (extended period, purpose unclear) |
| `direct` | Measured by source daemon (browser/window/calendar) |
| `pending` | Awaiting forward signal |

Classification confidence (0-1 score) remains separate — it answers *what* you were doing, not *how long*.

### Work Day Model

A "work day" runs from 8:00 AM Eastern Time to 8:00 AM ET the next day. Working until 2 AM counts as part of the previous work day. Implemented in `src/lib/date-utils.ts` with DST-safe timezone arithmetic.

### No User-Configurable Time Settings

The following settings have been removed from the UI — the system is opinionated about attribution:
- ~~min_prompt_minutes~~ (was 2)
- ~~max_prompt_minutes~~ (was 60)
- ~~default_last_prompt_minutes~~ (was 5)
- ~~session_gap_minutes~~ (was 30, retained as internal display-only constant)

---

## 8. API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/dashboard` | GET | Daily data: activities, category/project/source breakdowns, yesterday deltas. Params: `?date=YYYY-MM-DD` |
| `/api/trends` | GET | Weekly/monthly aggregation. Params: `?period=week\|month&end_date=YYYY-MM-DD` |
| `/api/categories` | GET | Full taxonomy with subcategories. Cached (max-age=3600). |
| `/api/settings` | GET | Current settings |
| `/api/settings` | PUT | Update settings (validated, transactional) |
| `/api/calendar/sync` | POST | Trigger ICS sync |
| `/api/calendar/sync` | GET | Check sync status |
| `/api/calendar/last-synced` | GET | Last sync timestamp |
| `/api/ingest` | POST | Manual ingestion trigger |
| `/api/prompts/[id]/reclassify` | POST | Override classification. Body: `{ category, subcategory, reason }` |
| `/api/export` | GET | Export data. Params: `?format=csv\|json` |
| `/api/onboarding` | GET/POST | First-run state, demo data loading |
| `/api/browser-tracker` | GET/POST | Daemon status and start/stop |
| `/api/window-tracker` | GET/POST | Daemon status and start/stop |
| `/api/activities/[source]/[id]/reclassify` | POST | Reclassify any source type (Phase 8f). Body: `{ category, subcategory, reason }` |
| `/api/exclusions` | GET | List all exclusion rules |
| `/api/exclusions` | POST | Add exclusion rule. Body: `{ rule_type, pattern }` |
| `/api/exclusions` | DELETE | Remove rule. Params: `?type=app_name\|domain&pattern=...` |
| `/api/training/start` | POST | Start a new training batch |
| `/api/training/batch/[id]` | GET | Get batch status and items |
| `/api/training/batch/[id]` | PATCH | Update batch status |
| `/api/training/batch/[id]/apply` | POST | Apply reviewed batch to user_rules |
| `/api/training/batch/[id]/cancel` | POST | Cancel batch |
| `/api/training/items/[id]` | GET | Get training item detail |
| `/api/training/items/[id]` | PATCH | Update human label for item |

### Dashboard Response Shape (`DashboardData`)

```typescript
{
  date: string;
  total_hours: number;
  total_sessions: number;
  total_prompts: number;
  total_events: number;
  meeting_count: number;
  focus_minutes: number;
  tracked_pct: number;       // % of expected_minutes tracked
  expected_minutes: number;  // target work hours in minutes (default 480 = 8h)
  source_breakdown: {
    claude_minutes: number;
    calendar_minutes: number;
    window_minutes: number;
    browser_minutes: number;
  };
  top_category: string | null;
  category_breakdown: CategoryBreakdown[];
  project_breakdown: ProjectBreakdown[];
  activities: ActivitySummary[];
  yesterday?: YesterdayTotals;
  auto_refresh: boolean;
}
```

---

## 9. Dashboard UI

### Daily Dashboard (`/`)

- **Header**: PM Pulse logo, date navigation (← →, keyboard shortcuts), Trends/Settings/Export icons, refresh button, live indicator
- **Day greeting**: "Wednesday — Here's your PM work breakdown for today"
- **Summary cards** (4): Total Time, Meetings, Focus Time, Top Category — each with vs-yesterday delta badges
- **Charts row** (2 cards):
  - Category donut (Recharts PieChart) with legend
  - Source breakdown bar ("How I Worked" — Claude, Meetings, Apps, Browser)
- **Activity table**: Sortable, paginated (10/50/100). Columns: Time, Source, Activity, Category, Confidence, Duration. Source badges color-coded.
- **Detail sidebar** (320px, right): Click any activity row. Shows full prompt/title, classification details (category, subcategory, method, confidence, reasoning), time attribution details (duration, method, quality). Reclassify UI for prompts.
- **Keyboard shortcuts**: ← → navigate dates, T for today, Esc close sidebar
- **Skeleton loading**: Cards, charts, and table rows show animated placeholders
- **Onboarding**: First-run card with "Load Demo Data" and "Dismiss" actions

### Trends (`/trends`)

- Period toggle: Week / Month
- Summary cards: Total Time, Total Prompts, Avg per Active Day
- Daily Hours area chart
- Time by Category horizontal bar chart

### Settings (`/settings`)

Cards for:
- **Privacy**: Full text / Preview only / Redacted
- **Classification**: Rules only / Hybrid / Full LLM
- **Activity Tracking**: Idle timeout, min session, calendar sync interval
- **Calendar Integration**: ICS URL input, block keyword, Sync Now button with status
- **Window Tracking**: Enable/disable toggle with daemon status indicator
- **Browser Tracking**: Enable/disable toggle with daemon status, retention days
- **Tracking Exclusions**: Apps and domains to exclude from tracking. Add/remove by name with quick-add chips for common apps (VS Code, Cursor, Terminal) and domains (localhost, claude.ai).
- **Dashboard**: Auto-refresh toggle
- **Data Export**: CSV and JSON export buttons

---

## 10. Configuration

### AppSettings (persisted in `settings` table)

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| privacy_mode | "full" \| "preview" \| "redacted" | "full" | How much prompt text to store |
| classification_mode | "rules" \| "hybrid" \| "llm" | "rules" | Classification strategy |
| calendar_ics_url | string | "" | Outlook/Google Calendar ICS URL |
| calendar_block_keyword | string | "BLOCK" | Events with this keyword are hidden |
| calendar_sync_interval_minutes | number | 30 | Auto-sync frequency |
| window_tracking_enabled | boolean | false | Enable window daemon |
| idle_threshold_minutes | number | 2 | Idle detection threshold |
| min_session_seconds | number | 30 | Minimum app session to record |
| browser_tracking_enabled | boolean | false | Enable browser daemon |
| browser_event_retention_days | number | 7 | Auto-cleanup threshold |
| dashboard_auto_refresh | boolean | false | 30s polling |

### Internal Constants (`src/lib/constants.ts`)

| Constant | Value | Notes |
|----------|-------|-------|
| DATA_DIR | `~/.pm-pulse` | All app data |
| EVENTS_DIR | `~/.pm-pulse/events` | Claude hook events |
| WINDOW_EVENTS_DIR | `~/.pm-pulse/window-events` | Window daemon events |
| BROWSER_EVENTS_DIR | `~/.pm-pulse/browser-events` | Browser daemon events |
| DB_PATH | `~/.pm-pulse/pm-pulse.db` | SQLite database |
| DEFAULT_SESSION_GAP_MINUTES | 30 | Display grouping only |
| DASHBOARD_POLL_INTERVAL_MS | 30,000 | Auto-refresh interval |
| LOW_CONFIDENCE_THRESHOLD | 0.4 | Below this → flag for LLM |
| PROMPT_PREVIEW_LENGTH | 200 | Chars stored in preview mode |

### Build Configuration

- `next.config.ts`: `serverExternalPackages: ["better-sqlite3", "node-ical"]`
- `components.json`: shadcn/ui base-nova style, RSC enabled, `@/` alias
- `globals.css`: OKLch color space theme with warm background tint
- Build env: `NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1` (Google Fonts TLS workaround)

---

## 11. Future Enhancements — Phased Roadmap

### Phase 8: "See the Invisible" — Deep Thinking + Accuracy

The highest-value phase. Attacks the #1 blind spot (untracked deep thinking time) with minimal new data collection.

**8a: Raw Time Attribution** ✅ DONE
- Removed all caps, floors, and session gaps from prompt time attribution
- New attribution method labels: `measured`, `session_bounded`, `cross_source`, `pending`, `direct`
- New attribution quality labels: `explained` (≤15 min gap), `unexplained` (>15 min), `direct`, `pending`
- Removed time attribution settings from UI (min/max/gap/default)

**8b: Response-Time Attribution** ✅ DONE
- `on-stop.mjs` hook captures when Claude finishes responding
- `direct` attribution method: measures actual response time (response_timestamp - prompt_timestamp)
- `response_timestamp` and `response_duration_seconds` columns added to prompts table
- Sidebar shows Xm Ys format for direct-method prompts

**8b′: Untracked Time Surface** ✅ DONE
- Computes tracked vs. expected work hours (hardcoded 8h; Phase 8e will make configurable)
- Dashboard Total Time card shows "of ~8h tracked (N%)" subtitle
- `tracked_pct` and `expected_minutes` added to DashboardData response

**8c: Focus Session Detection** (M)
- Detect sustained single-app usage (15+ min) from window_events
- Tiers: Deep Focus (30+ min), Light Focus (15-30 min), Fragmented (<15 min)
- Dashboard surface: "45 min deep focus in Google Docs"
- Computed on-the-fly from existing data — no new table or daemon

**8d: Inter-Prompt Gap Inference** (M)
- When prompt gap > 10 min, query window_events + browser_events in that time window
- Generate explanation: "Between prompts: 20 min Docs, 15 min Figma, 5 min Slack"
- Display in detail sidebar — transforms opaque gaps into explained time blocks

**8e: Configurable Day Start Hour** (S)
- Move `DAY_START_HOUR = 8` from hardcoded constant into settings
- Dropdown on settings page: 5am-12pm, default 8am ET

**8f: Reclassify All Sources** ✅ DONE
- Reclassification extended to browser, window, and calendar events via sidebar
- Generic `/api/activities/[source]/[id]/reclassify` route
- Browser/window reclassifications also save a `user_rules` entry ("saves a rule" badge in UI)

### Phase 9: "Flow vs. Fragment" — Context Switching

**9a: Time Blocks Visualization** (S)
- Horizontal timeline bar (day start → now), color-coded by category
- Gray gaps = untracked time
- Click block → scroll to activity in table
- Recharts or custom SVG — data already exists in `activities` array

**9b: Context Switch Score** (M)
- Count category transitions per hour across all sorted activities
- Weight by switch distance (7x7 category distance matrix)
- Daily "Focus Score" on dashboard, weekly trend on trends page

### Phase 10: "So What?" — Synthesis

**10a: Weekly Digest** (M)
- `GET /api/digest?week=YYYY-Www` + `/digest` page
- This week vs last: category deltas, longest focus session, busiest meeting day, switch score
- Template-based text generation (no LLM dependency)

### Phase 11: "Smarter Classification" — LLM

**11a: Hybrid Classification** (L) — partially implemented
- Rules + LLM fallback for prompts with confidence < 0.4
- Claude Haiku or Ollama — explicit opt-in, local option available
- Types and DB columns already exist (`pending_llm_classification`, `classification_method`)
- Batch processing via `Promise.allSettled` for resilience
- Training loop tables (`training_batches`, `training_items`, `training_examples`) and API routes (`/api/training/*`) implemented; UI (`/training` page) partially built

### Phase 12: "Precision" — Edge Cases

**12a: Parallel Work Indicator** (S)
- With raw attribution, parallel time is intentionally NOT discounted
- Surface a "Parallel work detected" badge when total attributed time exceeds wall-clock time
- Helps user understand why daily total may exceed ~8h

---

## 13. Competitive Backlog — Rize-Inspired Features

Sourced from a March 2026 competitive analysis of [rize.io](https://rize.io). These are features Rize does well that PM Pulse should consider building. All implementations must preserve the privacy-first constraint (local data, no cloud calls).

### Priority 1 — High Impact

---

#### 13.1 Initiative / Project Dimension

**Problem**
Today, PM Pulse classifies every activity into a PM taxonomy category (Strategy, Requirements, etc.) but has no concept of *which initiative or product area* the work belongs to. A PM working on a launch and a platform migration simultaneously cannot answer "how much of my Strategy time was on Feature X vs. Feature Y?"

**User Story**
As a PM with multiple active initiatives, I want to tag my work against a named project or initiative so that I can see time distribution across both the *type* of work (taxonomy) and the *subject* of work (initiative).

**Success Metrics**
- User can define 3–5 named initiatives in settings
- Each prompt/activity in the dashboard shows an initiative tag alongside category
- "Time by Initiative" breakdown available on dashboard and trends page
- Classification engine auto-assigns initiative based on cwd, window title, and prompt content (with manual override)

**High-Level Requirements**
1. **Settings**: New "Initiatives" card on settings page. CRUD for initiative names + optional keywords/patterns (e.g., `["feature-x", "fx-launch"]`).
2. **DB**: Add `initiative` column to `prompts`, `window_events`, `browser_events` tables. New `initiatives` table: `id, name, slug, keywords (JSON), color, is_active`.
3. **Classification**: After category classification, run initiative matcher. Match against: (a) cwd path segments, (b) prompt text keyword search, (c) window title. Store in `initiative` column. Default: `null` / "Unassigned".
4. **API**: `DashboardData` gains `initiative_breakdown: InitiativeBreakdown[]`. Trends endpoint updated similarly.
5. **Dashboard**: Second grouping dimension in activity table. New "By Initiative" toggle on category donut. Initiative badge in detail sidebar.
6. **Override**: Reclassify sidebar allows changing initiative independently of category.

**Effort**: L — new data model, new classification pass, multiple UI surfaces.

---

#### 13.2 Daily Digest Hook

**Problem**
PM Pulse is pull-only: insights stay in the dashboard until you open it. Rize delivers a daily summary to your inbox. PMs often end the day without reviewing their work — the digest creates a lightweight reflection ritual without requiring any conscious navigation.

**User Story**
As a PM ending my work session, I want to automatically receive a concise summary of what I worked on today, so that I can reflect and plan without opening the dashboard.

**Success Metrics**
- Digest fires automatically at session end (or configurable time) on days where ≥ 30 min was tracked
- Delivered via macOS notification + optional printed terminal output
- Summary includes: total time, top 3 categories with minutes, top initiative (if configured), focus block count, prompt count
- Zero-config default: works out of the box after `npm run setup`

**High-Level Requirements**
1. **Digest generator**: New module `src/lib/digest.ts` — queries SQLite for current workday stats and returns a structured `DigestPayload` object.
2. **`on-session-end` hook** (`hooks/on-session-end.mjs`): After session ends, calls digest generator via a small helper script. Fires `osascript` for macOS notification. Also prints formatted summary to terminal.
3. **Optional: cron mode**: `hooks/daily-digest.mjs` — standalone script that can be scheduled via `launchd` or `cron` for a 6pm ET daily summary regardless of session end.
4. **Content format**:
   ```
   PM Pulse — Wednesday, Mar 15
   Total: 4h 32m tracked
   ● Strategy & Planning    2h 10m  (48%)
   ● Communication          1h 05m  (24%)
   ● Requirements             57m   (21%)
   Focus blocks: 3 (longest: 45m)
   Prompts: 27  |  Meetings: 2
   ```
5. **Settings**: Toggle in settings page: "Daily digest on session end" (default on). Optional: quiet hours.
6. **New API route**: `GET /api/digest?date=YYYY-MM-DD` — returns `DigestPayload`. Used by hook script and future digest page.

**Effort**: S–M — digest logic is simple queries; delivery is macOS-native. No new daemons.

---

#### 13.3 Productivity Score

**Problem**
PM Pulse shows you *what* you did but gives no feedback on *how well you worked*. Rize's daily productivity score gamifies consistency and creates a habit loop. A PM-specific score would be more meaningful than Rize's generic one — it can weight strategic vs. reactive work, deep focus duration, and goal alignment.

**User Story**
As a PM trying to improve my work habits, I want a daily score that tells me whether I focused on the right things, so I can build a consistent practice of strategic work over reactive work.

**Success Metrics**
- Score visible in dashboard header and trend sparkline (30-day history)
- Score correlates with user-perceived "good day" vs. "reactive day" (validate via 2-week dogfood)
- Trend page shows score over time with category breakdown to explain score movement

**Scoring Model (v1 — rule-based, no LLM)**

Score = 0–100, computed daily from three factors:

| Factor | Weight | Calculation |
|--------|--------|-------------|
| **Strategic depth** | 40% | % of tracked time in Strategy + Requirements (target: ≥ 40%) |
| **Focus quality** | 35% | Longest continuous same-category block / target (30 min = 100%) |
| **Reactive ratio** | 25% | Inverse of % time in Communication + Meetings (target: ≤ 30%) |

Score of 0 if `total_tracked_minutes < 60` (insufficient data).

**High-Level Requirements**
1. **Score engine**: New function `computeDailyScore(date)` in `src/lib/scoring.ts`. Pure function over SQLite data. Returns `{ score: number, breakdown: ScoreBreakdown }`.
2. **DB**: New `daily_scores` table: `id, date TEXT UNIQUE, score REAL, strategic_score REAL, focus_score REAL, reactive_score REAL, computed_at TEXT`. Recomputed on each dashboard load for current day; frozen for past days.
3. **Dashboard**: Score shown in header area as a large number with label ("Focus Day", "Reactive Day", "Mixed") and color coding. Small 7-day sparkline below.
4. **Trends**: New chart panel on trends page — score over time as a line chart, overlay with a "strategic depth" area.
5. **API**: `DashboardData` gains `productivity_score: number | null` and `score_breakdown: ScoreBreakdown`. New `GET /api/scores?start=&end=` for trends.
6. **Calibration**: Score weights and thresholds configurable in settings (advanced section) — default weights are opinionated but overridable.

**Effort**: M — scoring math is straightforward; new DB table + API field + 2 UI surfaces.

---

### Priority 2 — Medium Impact

These features are directionally correct but should follow the Priority 1 work:

- **13.4 Hourly Heatmap**: GitHub-style grid (hour × day-of-week) color-coded by dominant PM category. Shows whether strategic work clusters in the morning. Uses existing `activities` data. New chart component on Trends page.

- **13.5 Focus Session Detector** (extends Phase 8c): Consecutive Claude Code prompts within 20 min with no calendar overlap = focus block. Surface block count + longest block in dashboard summary card. Show a streak: "3 deep work sessions today — your best this week."

- **13.6 Work Pattern Insights**: Auto-generated weekly insight bullets on the Trends page. Rule-based: "You spent 40% of this week on Communication — highest in a month. Your deep work ratio dropped to 1.2h/day." Optional Claude API for narrative quality (explicit opt-in).

---

### Priority 3 — Nice to Have

- **13.7 Break Reminder Daemon**: macOS notification if window-watcher detects 90+ consecutive minutes of Claude Code / IDE work with no calendar break. Inspired by Rize's break prompts, keyed to actual work intensity.

- **13.8 Weekly Work Report CLI**: `npm run report` generates a structured markdown (+ optional PDF) of the week: hours by category, top initiatives, deep work ratio, key prompts by topic. Shareable weekly status artifact.

- **13.9 Linear / Jira Enrichment**: Daily fetch of open ticket titles from Linear/Jira API. Fuzzy-match prompt text against ticket titles; auto-tag with ticket ID. "Work by ticket" view in dashboard. All data stays local — API key stored in settings.

---

## 12. Known Limitations

1. **Claude prompts only proxy for work** — they capture what you asked Claude, not everything you did. Browser/window/calendar tracking fills major gaps but can't capture reading a whiteboard or thinking in the shower.

2. **Rule-based classification is pattern-dependent** — novel prompts may get low confidence or wrong categories. Reclassification UI mitigates this; LLM mode (Phase 11) will improve coverage.

3. **macOS only** for window and browser tracking — daemons use `lsappinfo`, `ioreg`, and Chromium SQLite history. Linux/Windows would need platform-specific implementations.

4. **Single-user by design** — no authentication, no access control. The app is a personal tool running on localhost.

5. **Browser tracking limited to Chromium** — Safari history requires Full Disk Access permission and uses a different schema. Arc and Brave use Chromium history format and work out of the box.

6. **Calendar sync is pull-only** — requires a publicly accessible ICS URL. No OAuth, no push notifications.

7. **Day boundary is hardcoded** — 8am ET. Configurable day start is planned (Phase 8e).
