# PM Pulse — Ideas Parking Lot

Captured from UI mockups and competitive analysis. No specs here — just ideas worth remembering.

---

## Value Assessment — Ranked by Impact

Evaluated across four dimensions:
- **Usability** — makes the product easier to understand or act on
- **Delight** — creates a "wow" or "aha" moment
- **Uniqueness** — only PM Pulse can do this (moat)
- **Habit** — gives users a reason to return daily/weekly

---

### ★★★ Tier 1 — Build These

**1. Inter-Prompt Gap Inference (Phase 8d)**
*Score: Usability ●●● · Delight ●●● · Uniqueness ●●● · Habit ●●*

The single most trust-building feature in the product. Right now, every Claude prompt gap is a black hole — you see "42 min" and have no idea if that's real work or a coffee break. Gap inference opens that black box: "Between prompts: 20m Google Docs · 15m Figma · 10m Slack." This solves the #1 anxiety of any tracking tool — *"why does this number look wrong?"* — and it uses data PM Pulse already has. No other tool can do this because no other tool sees both your Claude prompts AND your app/browser activity simultaneously. Low effort, maximum trust payoff.

**2. Day Timeline / Time Blocks (Phase 9a)**
*Score: Usability ●●● · Delight ●●● · Uniqueness ●● · Habit ●●*

Humans think spatially about time. The current activity table is a list of disconnected rows — it gives you no mental model of your day. A horizontal color-coded timeline from 8am → now is the most natural way to answer "where did my day go?" The gray gaps (untracked) are especially powerful — they make the invisible visible without any explanation needed. This is a fundamental usability upgrade that makes every other feature easier to understand. Data is already fully available.

**3. Context Switch Score (Phase 9b)**
*Score: Usability ●● · Delight ●●● · Uniqueness ●●● · Habit ●●●*

The only feature that doesn't just tell you *what* you did but gives you *feedback* on *how* you worked. That's a qualitative leap — it shifts PM Pulse from observation tool to coaching tool. "You switched 5 times between 10–11am — consider batching Slack reviews to the afternoon" is the kind of actionable, PM-specific insight that no calendar or time tracker produces. High habit-formation value because the score creates a game: "can I beat yesterday's 67?" Pairs well with the weekly digest for a "did I improve this week?" ritual.

---

### ★★ Tier 2 — High Value, Right Timing Matters

**4. Weekly Digest Page (Phase 10a)**
*Score: Usability ●● · Delight ●●● · Uniqueness ●● · Habit ●●●*

The feature most likely to create a weekly ritual. PMs already do weekly reviews — this becomes their artifact. The auto-generated narrative paragraph ("requirements-heavy week, highest in 4 weeks") is the kind of sentence that makes you feel like the product actually *understands* you, not just counts you. Habit potential is very high. Build after the daily data quality is solid, because weak data makes the narrative feel wrong.

**5. Initiative / Project Dimension (SPEC §13.1)**
*Score: Usability ●● · Delight ●● · Uniqueness ●●● · Habit ●●*

The strategic moat. Rize can never do this — it has no idea what you're prompting. "I spent 2h on Strategy, of which 1.5h was on the Feature X launch" is the insight PMs actually need for weekly check-ins and roadmap conversations. High effort but durable differentiation. Worth building once the core tracking is stable enough that the initiative classification would be reliable.

**6. Focus Session Detection (Phase 8c)**
*Score: Usability ●● · Delight ●● · Uniqueness ●● · Habit ●●*

Good, but partially superseded by the Context Switch Score — both answer "did I focus today?" The unique value here is the *named session*: "1h 20m deep focus in Google Docs — PRD writing." That specificity is more trustworthy than a score. Build as a companion to the Context Switch Score, not a replacement.

---

### ★ Tier 3 — Valid, Lower Urgency

**7. Daily Digest Hook** — Push beats pull, but the weekly digest is more meaningful for PMs. Build weekly first.

**8. Productivity Score (SPEC §13.3)** — Risk: a single number feels arbitrary and gameable. The Context Switch Score is more specific and harder to dismiss. Consider folding the score concept into that feature instead of a standalone metric.

**9. Parallel Work Indicator (Phase 12a)** — Solves a real confusion (why is my total > 8h?) but it's a support/explanation feature, not a value-creation feature. Low urgency.

**10. Hourly Heatmap** — Beautiful, but answers "when do I work best?" which is a question users ask once, not daily. Low habit value.

**11. Break Reminder, Report CLI, Linear/Jira enrichment** — All nice-to-have. Linear/Jira is the most interesting if PM Pulse grows beyond personal use.

---

---

## UI / Navigation Redesigns

Four navigation layout options were mocked up. None shipped yet. Pick one when the app grows beyond 3 pages.

- **Option A: Tab Bar + Right Detail Panel** — top tab bar (Today / Trends / Training / Settings), detail slides in from right. Clean, familiar.
- **Option B: Left Nav Sidebar** — icon sidebar that expands on hover. Unlocks wider main content area; the activity table can show a Project column.
- **Option C: Slim Top + Bottom Status Bar** — minimal top bar, secondary nav (Trends / Training) lives in a bottom strip. Most content-forward layout.
- **Option D: Two-Panel Adaptive** — summary panel on left, detail panel on right adapts between "today overview" and "activity detail" states.

---

## Feature Mockups (Phases 8–12)

### Phase 8b — Untracked Time Surface
Show a coverage bar in the dashboard header: Claude Xh · Meetings Xh · Browser Xh · Apps Xh · **Untracked ~Xh**. Gives an honest "X% of ~8h tracked" signal. Data already exists in `DashboardData` (`tracked_pct`, `expected_minutes`).

### Phase 8c — Focus Session Detection
Detect sustained single-app windows (15+ min) from `window_events`. Surface as a new summary card: **Deep Focus 1h 45m — 1 deep + 2 light sessions**. Tiers: Deep (30+ min), Light (15–30 min), Fragmented (<15 min). Show sessions list with app, time, category, duration. No new data needed — computed from existing `window_events`.

### Phase 8d — Inter-Prompt Gap Inference
When a Claude prompt gap > 10 min, query `window_events` + `browser_events` in that window and show a mini timeline inside the detail sidebar: "Between prompts: 20m Google Docs · 15m Figma · 10m Slack." Transforms opaque gaps into explained time. No new data — it's already in the DB.

### Phase 9a — Day Timeline (Time Blocks)
Horizontal timeline bar from 8am → now, color-coded by category. One row per source (Claude / Meetings / Apps / Browser). Gray gaps = untracked. Click a block to jump to that activity in the table. Recharts or custom SVG. Callout for largest gap: "12:40–1:30pm (50 min untracked) — possible lunch." Data fully available.

### Phase 9b — Context Switch Score / Focus Score
Replace the "Top Category" summary card with a **Focus Score (0–100)** gauge. Derived from: number of category transitions/hr, average switch distance (7×7 category distance matrix), longest unbroken same-category block. Show weekly sparkline on trends page. Surface costliest transitions: "10:02am Requirements → Communication (High ⚡)". Actionable tip: "Most switching 10–11am — consider batching Slack reviews to the afternoon."

### Phase 10a — Weekly Digest Page
Dedicated `/digest` page (not just a hook notification). Shows: summary stats (Total Time, Meetings, Focus Sessions, Avg Focus Score) vs. last week. Narrative paragraph auto-generated from templates: "This was a requirements-heavy week — 9.2h on Requirements, your highest in 4 weeks." Category comparison table (this week vs last). Day heatmap (hours per day). Highlights row: Longest Focus Session · Busiest Meeting Day · Best Focus Score · Most Active Claude Day.

### Phase 12a — Parallel Work Indicator
When total attributed time > wall-clock hours (multiple Claude sessions overlapping), show a banner: "⚡ Parallel Work Detected — 9.1h attributed across 3 sessions (wall-clock: 6.8h)." Include a session overlap diagram showing which sessions ran simultaneously. Dismiss with "Got it." Prevents user confusion about totals exceeding 8h.

---

## Competitive Ideas (from Rize analysis)

See `§13` in `SPEC.md` for full details on the top 3 (Initiative Dimension, Daily Digest Hook, Productivity Score).

Lower-priority ideas captured here:
- **Hourly heatmap** — GitHub-style grid (hour × day-of-week), color = dominant PM category. "When do you do your best strategic work?"
- **Break reminder daemon** — macOS notification after 90+ min of continuous Claude/IDE work with no calendar break.
- **Weekly Work Report CLI** — `npm run report` → structured markdown/PDF of the week for sharing or personal reflection.
- **Linear / Jira enrichment** — fuzzy-match prompt text against open ticket titles, auto-tag with ticket ID, "work by ticket" view. API key in settings, data stays local.
- **Work pattern insights** — rule-based weekly bullets: "You spent 40% on Communication — highest in a month. Deep work ratio dropped to 1.2h/day." Optional Claude API for narrative quality.
