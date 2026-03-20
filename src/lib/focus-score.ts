import type { ActivitySummary, FocusScoreResult } from "@/lib/types";

// Affinity cost between category pairs: 0=synergistic, 1=neutral, 2=antagonistic
const AFFINITY: Record<string, Record<string, number>> = {
  "strategy-planning": {
    "requirements-specs": 0,
    "writing-documentation": 0,
    "communication-alignment": 1,
    "analytics-experimentation": 1,
    "development-technical": 1,
    "personal-productivity": 2,
  },
  "requirements-specs": {
    "strategy-planning": 0,
    "writing-documentation": 0,
    "communication-alignment": 1,
    "analytics-experimentation": 1,
    "development-technical": 1,
    "personal-productivity": 1,
  },
  "communication-alignment": {
    "strategy-planning": 1,
    "requirements-specs": 1,
    "writing-documentation": 1,
    "analytics-experimentation": 2,
    "development-technical": 2,
    "personal-productivity": 1,
  },
  "writing-documentation": {
    "strategy-planning": 0,
    "requirements-specs": 0,
    "communication-alignment": 1,
    "analytics-experimentation": 1,
    "development-technical": 1,
    "personal-productivity": 1,
  },
  "analytics-experimentation": {
    "strategy-planning": 1,
    "requirements-specs": 1,
    "communication-alignment": 2,
    "writing-documentation": 1,
    "development-technical": 0,
    "personal-productivity": 2,
  },
  "development-technical": {
    "strategy-planning": 1,
    "requirements-specs": 1,
    "communication-alignment": 2,
    "writing-documentation": 1,
    "analytics-experimentation": 0,
    "personal-productivity": 2,
  },
  "personal-productivity": {
    "strategy-planning": 2,
    "requirements-specs": 1,
    "communication-alignment": 1,
    "writing-documentation": 1,
    "analytics-experimentation": 2,
    "development-technical": 2,
  },
};

function getAffinityCost(a: string, b: string): number {
  return AFFINITY[a]?.[b] ?? AFFINITY[b]?.[a] ?? 1;
}

export function computeFocusScore(
  activities: ActivitySummary[],
  dayHours: number
): FocusScoreResult {
  if (activities.length === 0 || dayHours <= 0) {
    return { score: 0, transitions: 0, costly_transitions: [], longest_block_minutes: 0, longest_block_category: null };
  }

  // Sort by timestamp, skip zero-duration entries
  const sorted = [...activities]
    .filter(a => a.attributed_minutes > 0)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (sorted.length === 0) {
    return { score: 0, transitions: 0, costly_transitions: [], longest_block_minutes: 0, longest_block_category: null };
  }

  // Walk activities, counting transitions and costs
  let transitions = 0;
  let totalCost = 0;
  const costly_transitions: FocusScoreResult["costly_transitions"] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.primary_category !== cur.primary_category) {
      transitions++;
      const cost = getAffinityCost(prev.primary_category, cur.primary_category);
      totalCost += cost;
      if (cost === 2) {
        costly_transitions.push({
          from: prev.primary_category,
          to: cur.primary_category,
          time: cur.timestamp,
        });
      }
    }
  }

  // Find longest unbroken same-category block
  let longestBlock = 0;
  let longestCat: string | null = null;
  let curBlock = sorted[0].attributed_minutes;
  let curCat = sorted[0].primary_category;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].primary_category === curCat) {
      curBlock += sorted[i].attributed_minutes;
    } else {
      if (curBlock > longestBlock) {
        longestBlock = curBlock;
        longestCat = curCat;
      }
      curBlock = sorted[i].attributed_minutes;
      curCat = sorted[i].primary_category;
    }
  }
  if (curBlock > longestBlock) {
    longestBlock = curBlock;
    longestCat = curCat;
  }

  // Score components (all inverted — more transitions / cost = lower score)
  const dayMinutes = dayHours * 60;
  const maxTransitions = Math.max(sorted.length - 1, 1);
  const transitions_ratio = transitions / maxTransitions; // 0=no switches, 1=max switches
  const maxCost = transitions * 2 || 1;
  const cost_ratio = totalCost / maxCost; // 0=all synergistic, 1=all antagonistic
  const block_ratio = 1 - Math.min(longestBlock / Math.max(dayMinutes, 1), 1); // 0=one long block, 1=many tiny blocks

  const raw = transitions_ratio * 0.4 + cost_ratio * 0.3 + block_ratio * 0.3;
  const score = Math.max(0, Math.min(100, Math.round((1 - raw) * 100)));

  return {
    score,
    transitions,
    costly_transitions: costly_transitions.slice(0, 5),
    longest_block_minutes: Math.round(longestBlock),
    longest_block_category: longestCat,
  };
}
