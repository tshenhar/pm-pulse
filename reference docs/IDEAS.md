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

### ★★★ Tier 1 — All shipped

Phases 8c (Focus Session Detection), 8d (Inter-Prompt Gap Inference), 9a (Day Timeline), 9b (Context Switch Score/Focus Score), 10a (Weekly Digest), and Daily Pulse are all implemented.

---

### ★★ Tier 2 — High Value, Right Timing Matters

**1. Initiative / Project Dimension (SPEC §13.1)**
*Score: Usability ●● · Delight ●● · Uniqueness ●●● · Habit ●●*

The strategic moat. Rize can never do this — it has no idea what you're prompting. "I spent 2h on Strategy, of which 1.5h was on the Feature X launch" is the insight PMs actually need for weekly check-ins and roadmap conversations. High effort but durable differentiation. Worth building once the core tracking is stable enough that the initiative classification would be reliable.

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

## Window Enrichment - Accessibility APIs (future)
- Current AppleScript approach for Outlook (main window 1) only returns inbox/folder name - not valuable enough
- Teams has no AppleScript window support at all (new Electron-based Teams)
- Real enrichment requires macOS Accessibility APIs (AXUIElement) - would expose meeting titles, email subjects, channel names
- Deferred until we decide to require Accessibility permissions from users

---

## PM Insights Engine

The shift from "what happened" to "what it means" - turning PM Pulse from an observation tool into a coaching tool.

### Research Foundation

Key findings informing the design:

- **Gloria Mark** - Average attention span is 47 seconds on a screen before switching. After an interruption, it takes ~23 minutes to fully return to a task. Implication: context switches are far more expensive than they feel.
- **Gonzalez & Mark (Working Spheres)** - People don't work on "tasks" linearly; they juggle multiple "working spheres" (projects/themes) simultaneously, switching between them throughout the day. Implication: category-level tracking is the right unit of analysis, not individual tasks.
- **Sophie Leroy (Attention Residue)** - When you switch from Task A to Task B, part of your attention remains on Task A. The residue is worse when Task A was incomplete or low in cognitive closure. Implication: not all switches are equal - mid-flow interruptions cost more.
- **Zaman et al. (Transition Quality)** - Task transitions can be synergistic (related tasks that share context) or antagonistic (unrelated tasks requiring full context reload). Implication: a 7x7 category affinity matrix can score transition cost, not just count transitions.
- **Das Swain et al. (Focus Time)** - Protected focus blocks (2+ hours uninterrupted) measurably improve output quality and reduce stress. Implication: longest unbroken block is a key health metric.
- **Daniel Pink / Wieth & Zacks (Chronotype)** - Analytical work is best done during peak alertness (typically morning for most people); creative/divergent work during non-peak hours. Implication: temporal rhythm detection can flag when you're working against your natural patterns.
- **Shreyas Doshi (LNO Framework)** - PM work divides into Leverage (10x impact), Neutral (expected), and Overhead (necessary but low-value). Tracking the ratio reveals whether you're spending time where it matters most.
- **Lenny Rachitsky (PM Time Benchmarks)** - Published benchmarks for how top PMs allocate time across strategy, execution, communication. Useful as optional reference points (not prescriptive targets).

### Feature Concepts

#### D. Temporal Rhythm Detector

**Jobs served:** Pattern recognition, behavior change (work with your energy, not against it)

Identifies personal work patterns by time-of-day. "Your Strategy work peaks 9-11am." Flags when working against your rhythm.

**Data:** 14-30 days of timestamped activities from all 4 sources.

**New computation:**
- Hourly category heatmap: 24 x 7 matrix (hours x categories), minutes per cell
- Peak detection per category (which hours contain the most of each category)
- Rhythm match scoring: today's distribution vs 14-day baseline
- 90-min ultradian block detection (natural work/rest cycles)

**Example outputs:**
- "Strategy peaks 9-11am (62% of all strategy work). Today you did it at 3pm - historically your lowest-focus period."
- "Natural rhythm: mornings for Strategy/Requirements, afternoons for Communication/Writing."

**UI:** Section on Weekly Digest page. Hourly heatmap visual (hour x category grid, color intensity = minutes).

**Transforms:** Hourly Heatmap idea (Tier 3, line 112) from "beautiful but low-habit" to actionable coaching by adding rhythm matching.

#### E. PM Role Balance Monitor

**Jobs served:** Pattern recognition, communication ("am I the PM I want to be?")

Tracks category distribution over time against user-configured targets.

**Data:** Multi-week category breakdowns from all sources.

**New computation:**
- Target allocation model: user sets % targets per category (stored in `settings` table)
- Variance tracking: actual % vs target %, weekly
- LNO classification: tag categories as Leverage/Neutral/Overhead, compute ratio
- Consecutive-week drift detection ("Strategy below target 3 weeks running")

**Example outputs:**
- "Strategy at 18% this month vs your 30% target. Below target 3 consecutive weeks."
- "Leverage ratio (Strategy + Requirements + Analytics) hit 41% - first time above 35%."

**UI:** Radar/spider chart on trends page. "PM Role Targets" card in Settings.

#### F. Anomaly & Threshold Alerts

**Jobs served:** Awareness (catch unusual days), behavior change (configurable guardrails)

Detects statistically unusual days using z-scores against 14-day rolling baseline. Plus user-configurable threshold alerts.

**Data:** 14-day rolling window of daily aggregates from existing tables.

**New computation:**
- Rolling statistics: mean + stddev for ~10 metrics over trailing 14 days
- Z-score: flag |z| > 1.5 as anomaly
- Configurable thresholds: "meetings > 50% of day", "focus < 1h", "strategy < 10%"

**Example outputs:**
- "4.2h in meetings today - 2x your 14-day average. Last time: March 12."
- "Focus time below 2h/day minimum for 3rd consecutive day."

**UI:** Dismissable banners on dashboard, or highlighted items in Daily Pulse. Threshold config in Settings.

### What's Computable Now vs What's Not

**Would need new data collection (not in scope):**
- Slack/notification interruption counting
- Meeting quality/outcomes
- Collaboration patterns (who you work with)
- Task completion tracking
- Cross-person benchmarking (local-first = no population data)
- Energy/mood correlation (no subjective input mechanism)

### Progressive Disclosure Model

| When | What unlocks | Why |
|------|-------------|-----|
| **Day 1** | Daily Pulse with 1-2 descriptive sentences, no comparisons | Build trust in accuracy. User should think "yeah, that's right" |
| **Week 1** (5 days) | Daily Pulse adds deltas. Context Switch Score appears with 5-day sparkline | Enough baseline for meaningful comparison |
| **Week 2** (14 days) | Weekly Digest unlocks. Anomaly detection activates (14-day baseline). Temporal Rhythm insights appear | Statistical baselines become reliable |
| **Month 1** | PM Role Targets available in Settings. Threshold alerts configurable | User understands patterns enough to set meaningful goals |
| **Quarter 1** | Multi-week trend insights. LNO ratio tracking. Quarterly "Wrapped" summary | Enough runway for meaningful long-term patterns |

### Differentiation (Honest Assessment)

**Only PM Pulse can do:**
1. PM-specific category insights ("42% Strategy this week" vs generic "4h in Google Docs")
2. Multi-source transition analysis at PM category level (Claude + browser + window + calendar as unified classified timeline)
3. Private PM coaching without employer visibility (Viva = org tool, RescueTime Teams = admin-visible)
4. Claude prompt context as data source (invisible to every other tracker)
5. Transition quality scoring using PM category affinity (genuine research gap - no published tool does this)

**Cannot do (competitors' strengths):**
- No mobile tracking, no team analytics, no calendar optimization, macOS-only, no population benchmarks

### Next Build Sequence

1. **Temporal Rhythm Detector** - hourly patterns + rhythm matching
2. **PM Role Balance Monitor** - target tracking + LNO ratio
3. **Anomaly & Threshold Alerts** - z-score detection + configurable thresholds

