import { execSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";

const API_KEY_HELPER = "/Users/tomershenhar/.claude/fico/fico-api-key-helper";
const BASE_URL = "https://llm.ai.fico.com";
const MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const TOKEN_TTL_MS = 600_000; // 10 min — matches CLAUDE_CODE_API_KEY_HELPER_TTL_MS

let cachedToken: { value: string; expiresAt: number } | null = null;

function getApiKey(): string {
  const now = Date.now();
  if (cachedToken && now < cachedToken.expiresAt) return cachedToken.value;
  const value = execSync(API_KEY_HELPER, { timeout: 5000 }).toString().trim();
  cachedToken = { value, expiresAt: now + TOKEN_TTL_MS };
  return value;
}


const BASE_SYSTEM_PROMPT = `You are a PM work classifier. Given a prompt text, classify it into exactly one category and subcategory from the taxonomy below.

Categories:
- strategy: roadmap, okr, research, vision
- requirements: prd, epic, technical, ux
- communication: stakeholder, meetings, presentation, alignment
- writing: prfaq, process, general
- analytics: data, reporting, experimentation
- development: coding, architecture, tooling, bugs
- productivity: learning, admin, meta

Respond with JSON only, no explanation outside the JSON:
{"category":"...","subcategory":"...","confidence":0.0-1.0,"reasoning":"one sentence"}`;

import type { ClassificationResult } from "../types";

/** Load up to 20 active few-shot examples from the DB (if available) */
function loadFewShotExamples(): { prompt_text: string; correct_category: string; correct_subcategory: string }[] {
  try {
    // Lazy import to avoid circular dependency at module load time
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getDb } = require("../db") as { getDb: () => import("better-sqlite3").Database };
    return getDb()
      .prepare(
        `SELECT prompt_text, correct_category, correct_subcategory
         FROM training_examples WHERE active = 1
         ORDER BY id DESC LIMIT 20`
      )
      .all() as { prompt_text: string; correct_category: string; correct_subcategory: string }[];
  } catch {
    return [];
  }
}

function buildSystemPrompt(): string {
  const examples = loadFewShotExamples();
  if (examples.length === 0) return BASE_SYSTEM_PROMPT;

  const exampleBlock = examples
    .map(
      (e) =>
        `Prompt: "${e.prompt_text.slice(0, 200)}"\n→ {"category":"${e.correct_category}","subcategory":"${e.correct_subcategory}"}`
    )
    .join("\n\n");

  return `${BASE_SYSTEM_PROMPT}\n\nHere are examples of correct classifications:\n\n${exampleBlock}`;
}

export async function classifyWithLLM(promptText: string): Promise<ClassificationResult> {
  const client = new Anthropic({
    apiKey: getApiKey(),
    baseURL: BASE_URL,
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 150,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: promptText.slice(0, 1500) }],
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected LLM response type");

  const raw = content.text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(raw);

  return {
    primary_category: parsed.category,
    primary_subcategory: parsed.subcategory,
    primary_confidence: Math.min(1, Math.max(0, Number(parsed.confidence))),
    method: "llm",
    reasoning: parsed.reasoning ?? "LLM classification",
  };
}
