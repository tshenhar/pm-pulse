import { readdirSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { BROWSER_EVENTS_DIR } from "@/lib/constants";
import { getDb } from "@/lib/db";
import { classifyWithLLM } from "@/lib/classification/llm-classifier";

const LLM_FALLBACK_THRESHOLD = 0.5;

interface BrowserVisit {
  id: string;
  type: "browser_event";
  browser: string;
  url: string;
  domain: string;
  title: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
}

interface BrowserClassification {
  category: string;
  subcategory: string;
  confidence: number;
  reasoning: string;
}

function classifyByDomain(domain: string, url: string): BrowserClassification {
  // Parse pathname for URL-path-based rules
  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch { /* ignore */ }

  // Video meetings (highest confidence)
  if (/^(meet\.google\.com|teams\.microsoft\.com|zoom\.us|webex\.com|whereby\.com)$/.test(domain)) {
    return { category: "communication", subcategory: "meetings", confidence: 0.9, reasoning: `video meeting: ${domain}` };
  }

  // Project / issue trackers
  if (/^(linear\.app|atlassian\.net)$/.test(domain) || domain.includes("atlassian.net") || domain.startsWith("jira.")) {
    return { category: "requirements", subcategory: "epic", confidence: 0.85, reasoning: `issue tracker: ${domain}` };
  }

  // Product management tools
  if (/\.aha\.io$/.test(domain)) {
    return { category: "strategy", subcategory: "roadmap", confidence: 0.85, reasoning: `roadmap tool: ${domain}` };
  }

  // Design tools
  if (/^(figma\.com|miro\.com)$/.test(domain)) {
    return { category: "requirements", subcategory: "ux", confidence: 0.85, reasoning: `design tool: ${domain}` };
  }

  // Code hosting
  if (/^(github\.com|gitlab\.com)$/.test(domain)) {
    if (/\/pull\/|\/merge_requests\//.test(pathname)) {
      return { category: "development", subcategory: "coding", confidence: 0.85, reasoning: `PR review: ${domain}` };
    }
    return { category: "development", subcategory: "coding", confidence: 0.8, reasoning: `code host: ${domain}` };
  }

  // Docs / wiki
  if (/^(docs\.google\.com)$/.test(domain)) {
    if (/\/presentation\//.test(pathname)) {
      return { category: "communication", subcategory: "presentation", confidence: 0.8, reasoning: "Google Slides" };
    }
    if (/\/spreadsheets\//.test(pathname)) {
      return { category: "analytics", subcategory: "data", confidence: 0.8, reasoning: "Google Sheets" };
    }
    return { category: "writing", subcategory: "general", confidence: 0.8, reasoning: "Google Docs" };
  }
  if (/confluence/.test(domain) || /^wiki\./.test(domain)) {
    return { category: "writing", subcategory: "process", confidence: 0.8, reasoning: `wiki: ${domain}` };
  }
  if (/^notion\.so$/.test(domain)) {
    return { category: "writing", subcategory: "process", confidence: 0.8, reasoning: `Notion: ${domain}` };
  }

  // Analytics / BI
  if (/^(metabase\.|looker\.|analytics\.google\.com|mixpanel\.com|amplitude\.com|datastudio\.google\.com|tableau\.)/.test(domain)) {
    return { category: "analytics", subcategory: "reporting", confidence: 0.85, reasoning: `analytics: ${domain}` };
  }

  // Email
  if (/^(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com)$/.test(domain)) {
    return { category: "communication", subcategory: "stakeholder", confidence: 0.75, reasoning: `email: ${domain}` };
  }

  // Slack
  if (/^app\.slack\.com$/.test(domain)) {
    return { category: "communication", subcategory: "alignment", confidence: 0.7, reasoning: "Slack" };
  }

  // Fallback
  return { category: "productivity", subcategory: "admin", confidence: 0.4, reasoning: `browser: ${domain}` };
}

/**
 * Groups consecutive visits to the same domain (gap < 11 min) into one session.
 * Returns aggregated sessions ready for DB insertion.
 */
function groupVisits(visits: BrowserVisit[]): {
  id: string;
  browser: string;
  domain: string;
  url: string;
  title: string | null;
  startTime: string;
  durationMinutes: number;
}[] {
  if (visits.length === 0) return [];

  const GAP_MS = 11 * 60 * 1000;
  const sorted = [...visits].sort((a, b) => a.start_time.localeCompare(b.start_time));

  const sessions: ReturnType<typeof groupVisits> = [];
  let group: BrowserVisit[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = group[group.length - 1];
    const curr = sorted[i];
    const prevEnd = new Date(prev.end_time).getTime();
    const currStart = new Date(curr.start_time).getTime();

    if (curr.domain === prev.domain && currStart - prevEnd < GAP_MS) {
      group.push(curr);
    } else {
      sessions.push(collapseGroup(group));
      group = [curr];
    }
  }
  sessions.push(collapseGroup(group));
  return sessions;
}

function collapseGroup(group: BrowserVisit[]) {
  const totalSeconds = group.reduce((s, v) => s + v.duration_seconds, 0);
  return {
    id: group[0].id, // use first visit's ID as external_id
    browser: group[0].browser,
    domain: group[0].domain,
    url: group[0].url,
    title: group[0].title || null,
    startTime: group[0].start_time,
    durationMinutes: totalSeconds / 60,
  };
}

function loadDomainRules(db: ReturnType<typeof getDb>): Map<string, { action: 'classify' | 'exclude'; category?: string; subcategory?: string }> {
  const rows = db
    .prepare("SELECT pattern, action, primary_category, primary_subcategory FROM user_rules WHERE rule_type = 'domain'")
    .all() as { pattern: string; action: string; primary_category: string | null; primary_subcategory: string | null }[];
  return new Map(rows.map((r) => [r.pattern, {
    action: r.action as 'classify' | 'exclude',
    category: r.primary_category ?? undefined,
    subcategory: r.primary_subcategory ?? undefined,
  }]));
}

export async function processBrowserEvents(): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  const eventsDir = process.env.__TEST_BROWSER_EVENTS_DIR ?? BROWSER_EVENTS_DIR;

  let files: string[];
  try {
    files = readdirSync(eventsDir).filter((f) => f.endsWith(".json"));
  } catch {
    return { processed: 0, errors: 0 };
  }

  if (files.length === 0) return { processed: 0, errors: 0 };

  const db = getDb();
  const domainRules = loadDomainRules(db);

  const visits: BrowserVisit[] = [];
  const filePaths: string[] = [];

  for (const file of files) {
    const filePath = join(eventsDir, file);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as BrowserVisit;
      if (domainRules.get(parsed.domain)?.action === 'exclude') {
        filePaths.push(filePath); // mark for cleanup, skip this visit
        continue;
      }
      visits.push(parsed);
      filePaths.push(filePath);
    } catch {
      errors++;
    }
  }

  const sessions = groupVisits(visits);

  // Step 1: run rules classification for all sessions
  const classified = sessions.map((session) => {
    const userRule = domainRules.get(session.domain);
    const cls: BrowserClassification = userRule?.action === 'classify' && userRule.category && userRule.subcategory
      ? { category: userRule.category, subcategory: userRule.subcategory, confidence: 1.0, reasoning: `user rule: ${session.domain}` }
      : classifyByDomain(session.domain, session.url);
    return { session, cls };
  });

  // Step 2: LLM fallback for low-confidence sessions that have a page title
  const needsLLM = classified.filter(
    ({ cls, session }) => cls.confidence < LLM_FALLBACK_THRESHOLD && !!session.title
  );

  if (needsLLM.length > 0) {
    const llmResults = await Promise.allSettled(
      needsLLM.map(({ session }) =>
        classifyWithLLM(`${session.title} (${session.domain})`)
      )
    );

    llmResults.forEach((result, i) => {
      if (result.status === "fulfilled") {
        const llm = result.value;
        needsLLM[i].cls = {
          category: llm.primary_category,
          subcategory: llm.primary_subcategory,
          confidence: llm.primary_confidence,
          reasoning: `llm: ${llm.reasoning ?? needsLLM[i].session.domain}`,
        };
      }
      // on rejection: keep the rules fallback — non-fatal
    });
  }

  // Step 3: insert into DB
  const upsert = db.prepare(`
    INSERT INTO browser_events (external_id, browser, domain, url, page_title, start_time, duration_minutes,
      primary_category, primary_subcategory, primary_confidence, classification_reasoning)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(external_id) DO UPDATE SET duration_minutes = excluded.duration_minutes
  `);

  const runAll = db.transaction(() => {
    for (const { session, cls } of classified) {
      try {
        upsert.run(
          session.id,
          session.browser,
          session.domain,
          session.url,
          session.title,
          session.startTime,
          session.durationMinutes,
          cls.category,
          cls.subcategory,
          cls.confidence,
          cls.reasoning
        );
        processed++;
      } catch {
        errors++;
      }
    }
  });

  runAll();

  // Clean up processed files
  for (const filePath of filePaths) {
    try { unlinkSync(filePath); } catch { /* non-fatal */ }
  }

  return { processed, errors };
}
