import type { ClassificationResult } from "../types";
import { RULES, type ClassificationRule } from "./rules";

interface RuleMatch {
  rule: ClassificationRule;
  confidence: number;
}

const SLASH_COMMAND_MAP: Record<string, { category: string; subcategory: string }> = {
  "/commit": { category: "development", subcategory: "coding" },
  "/daily-init": { category: "productivity", subcategory: "admin" },
  "/today": { category: "productivity", subcategory: "admin" },
  "/notes-wizard": { category: "productivity", subcategory: "admin" },
};

const SHORT_PROMPT_THRESHOLD = 15; // words
const SECONDARY_GAP_THRESHOLD = 0.1;
const SECONDARY_MIN_CONFIDENCE = 0.5;
const CWD_BOOST = 0.05;

export function classify(promptText: string, cwd?: string): ClassificationResult {
  const trimmed = promptText.trim();

  // 1. Slash command detection
  const slashMatch = detectSlashCommand(trimmed);
  if (slashMatch) {
    return {
      primary_category: slashMatch.category,
      primary_subcategory: slashMatch.subcategory,
      primary_confidence: 0.95,
      method: "rules",
      reasoning: `Slash command detected: ${trimmed.split(/\s/)[0]}`,
    };
  }

  // 2. Score all matching rules
  const matches: RuleMatch[] = [];
  for (const rule of RULES) {
    if (rule.pattern.test(trimmed)) {
      let confidence = rule.baseConfidence;

      // Apply cwd boost
      if (cwd && rule.boost?.cwdPattern && rule.boost.cwdPattern.test(cwd)) {
        confidence = Math.min(confidence + CWD_BOOST, 1.0);
      }

      // Apply length boost
      if (rule.boost?.lengthMin && trimmed.length >= rule.boost.lengthMin) {
        confidence = Math.min(confidence + 0.05, 1.0);
      }

      matches.push({ rule, confidence });
    }
  }

  // 3. No matches → check if short/ambiguous
  if (matches.length === 0) {
    return shortPromptFallback(trimmed);
  }

  // 4. Sort by confidence descending
  matches.sort((a, b) => b.confidence - a.confidence);

  const best = matches[0];
  const result: ClassificationResult = {
    primary_category: best.rule.category,
    primary_subcategory: best.rule.subcategory,
    primary_confidence: best.confidence,
    method: "rules",
    reasoning: `Matched pattern: ${best.rule.pattern.source}`,
    matchedPatterns: matches.map((m) => m.rule.pattern.source),
  };

  // 5. Check for secondary label
  const secondBest = matches.find(
    (m) =>
      m.rule.category !== best.rule.category &&
      m.confidence >= SECONDARY_MIN_CONFIDENCE
  );

  if (
    secondBest &&
    best.confidence - secondBest.confidence <= SECONDARY_GAP_THRESHOLD
  ) {
    result.secondary_category = secondBest.rule.category;
    result.secondary_subcategory = secondBest.rule.subcategory;
    result.secondary_confidence = secondBest.confidence;
  }

  return result;
}

function detectSlashCommand(
  text: string
): { category: string; subcategory: string } | null {
  const firstToken = text.split(/\s/)[0].toLowerCase();
  return SLASH_COMMAND_MAP[firstToken] ?? null;
}

function shortPromptFallback(text: string): ClassificationResult {
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  if (wordCount < SHORT_PROMPT_THRESHOLD) {
    return {
      primary_category: "productivity",
      primary_subcategory: "admin",
      primary_confidence: 0.3,
      method: "rules",
      reasoning: `Short/ambiguous prompt (${wordCount} words), no pattern match`,
    };
  }

  // Longer prompt with no match
  return {
    primary_category: "productivity",
    primary_subcategory: "admin",
    primary_confidence: 0.4,
    method: "rules",
    reasoning: "No pattern matched",
  };
}
