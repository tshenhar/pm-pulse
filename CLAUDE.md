# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

We're building the app described in @SPEC.MD. Read that file for general architectural decisions or to double-check the exact database structure, tech stack or application architecture.

Keep your replies extremely concise and focus on conveying the key information. No unnecessary fluff, no long code snippets.

## Build & Dev Commands

```bash
npm run dev      # Next.js dev server at http://localhost:3000
npm run build    # Production build
npm run start    # Production server
npm run lint     # ESLint
```

## Project Overview

PM Pulse is a local-first productivity tracker for PMs. It captures work activity from 4 sources - Claude Code prompts, browser tabs, macOS app usage, and calendar events - classifies each into a PM work taxonomy, attributes time using raw observational heuristics, and displays a breakdown through a web dashboard.

**Key principles:** Privacy-first (all data at `~/.pm-pulse/`), observe don't guess (raw time attribution, no artificial caps), explainable classifications with reasoning/confidence, non-intrusive async hooks and daemons, modular and independently testable components.

## Tech Stack

- **Framework:** Next.js 16 (App Router, React 19)
- **UI:** shadcn/ui (base-nova style) + Tailwind CSS 4 (OKLch color variables)
- **Charts:** Recharts
- **Database:** SQLite via better-sqlite3 (server-side only)
- **Language:** TypeScript 5 (strict mode, path alias `@/*` → `./src/*`)

## Architecture

### Data Flow

1. **Collection**: Hooks (`hooks/on-prompt.mjs` etc.) + daemons (`browser-tracker.mjs`, `window-watcher.mjs`) + ICS sync write JSON files to `~/.pm-pulse/` subdirectories
2. **Ingestion**: On each dashboard request, pending files are classified, time-attributed, and inserted into SQLite
3. **Storage** in SQLite (`~/.pm-pulse/pm-pulse.db`) across 7 tables: `prompts`, `categories`, `subcategories`, `settings`, `calendar_events`, `window_events`, `browser_events`
4. **Dashboard** renders from SQLite queries via API routes

### Key Directories

- `hooks/` - Hook scripts (`on-prompt.mjs`, `on-stop.mjs`, `on-session-start.mjs`, `on-session-end.mjs`) + daemons (`browser-tracker.mjs`, `window-watcher.mjs`)
- `src/lib/db.ts` - SQLite connection and initialization
- `src/lib/db/schema.sql` - DDL for all 7 tables with indexes
- `src/lib/db/seed.ts` - Seeds 7 PM categories with ~20 subcategories
- `src/lib/types.ts` - All TypeScript interfaces (PromptRow, ClassificationResult, AttributionResult, AppSettings, etc.)
- `src/lib/constants.ts` - Paths, defaults, thresholds
- `src/lib/ingestion/` - Processors for all 4 data sources
- `src/lib/attribution/` - Time engine + session detector
- `src/lib/classification/` - Rules engine + classifier
- `reference docs/` - Full spec (`SPEC.md`) and architecture review (`CTO-REVIEW.md`)

### Classification System

Three modes: `rules` (pattern-based), `hybrid` (rules + LLM fallback), `llm` (full LLM). Low confidence threshold is 0.4. Classifications include primary/secondary category, confidence scores, method, and reasoning.

### Time Attribution

**Primary (direct):** The `Stop` hook captures when Claude finishes responding. Duration = `response_timestamp - prompt_timestamp`. Stored in `response_duration_seconds` on the prompt row. **Fallback (gap-based):** When no stop event arrives (interrupted sessions, older data), the gap to next prompt is used. Last prompt in session is `pending` (0 min) until resolved by next event. Methods: `measured`, `session_bounded`, `cross_source`, `pending`, `direct`. Quality labels: `explained`, `unexplained`, `direct`, `pending`. No user-configurable time settings.

### PM Work Taxonomy (7 Categories)

Strategy & Planning, Requirements & Specifications, Communication & Alignment, Writing & Documentation, Analytics & Experimentation, Development & Technical, Personal Productivity - each with 3-4 subcategories.

## Configuration

- `next.config.ts` - Declares `better-sqlite3` as `serverExternalPackages`
- `components.json` - shadcn/ui config (base-nova style, RSC enabled, `@/` import alias)
- Theme uses OKLch color space with CSS custom properties in `globals.css`
