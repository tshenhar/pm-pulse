import { NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";
import { randomUUID, createHash } from "crypto";

export async function GET(): Promise<NextResponse> {
  try {
    await initDb();
    const db = getDb();

    const row = db.prepare("SELECT COUNT(*) as count FROM prompts").get() as { count: number };
    const dismissed = db
      .prepare("SELECT value FROM settings WHERE key = 'onboarding_dismissed'")
      .get() as { value: string } | undefined;

    return NextResponse.json({
      is_first_run: row.count === 0,
      onboarding_dismissed: dismissed ? JSON.parse(dismissed.value) : false,
    });
  } catch (err) {
    console.error("Onboarding GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await initDb();
    const db = getDb();
    const body = await request.json();

    if (body.action === "dismiss") {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('onboarding_dismissed', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'"
      ).run();
      return NextResponse.json({ success: true });
    }

    if (body.action === "load_demo") {
      const sessionId = `demo-${randomUUID()}`;
      const now = new Date();
      const baseTime = new Date(now);
      baseTime.setHours(9, 0, 0, 0);

      const demoPrompts = [
        { prompt: "Help me write the Q3 product roadmap with key milestones and dependencies", cat: "strategy", sub: "roadmap", confidence: 0.85, minutes: 12 },
        { prompt: "Draft the user stories for the new onboarding flow", cat: "requirements", sub: "epic", confidence: 0.9, minutes: 8 },
        { prompt: "Review the API spec for the payments integration", cat: "requirements", sub: "technical", confidence: 0.8, minutes: 15 },
        { prompt: "Write the weekly status update for the leadership team", cat: "communication", sub: "stakeholder", confidence: 0.92, minutes: 10 },
        { prompt: "Analyze the A/B test results for the checkout redesign", cat: "analytics", sub: "experimentation", confidence: 0.88, minutes: 7 },
        { prompt: "Help me debug this authentication middleware issue", cat: "development", sub: "coding", confidence: 0.75, minutes: 20 },
        { prompt: "Create a decision doc for choosing between Redis and Memcached", cat: "writing", sub: "process", confidence: 0.82, minutes: 11 },
        { prompt: "Prioritize the backlog items using RICE scoring", cat: "strategy", sub: "roadmap", confidence: 0.87, minutes: 9 },
        { prompt: "Draft the sprint retrospective notes", cat: "communication", sub: "meetings", confidence: 0.7, minutes: 6 },
        { prompt: "Set up the feature flag for the new pricing page", cat: "development", sub: "coding", confidence: 0.65, minutes: 14 },
        { prompt: "Write the PRD for the notification preferences feature", cat: "requirements", sub: "prd", confidence: 0.91, minutes: 18 },
        { prompt: "Prepare talking points for the customer advisory board meeting", cat: "communication", sub: "meetings", confidence: 0.78, minutes: 8 },
        { prompt: "Review the analytics dashboard for user engagement trends", cat: "analytics", sub: "reporting", confidence: 0.84, minutes: 5 },
        { prompt: "Document the incident response process", cat: "writing", sub: "process", confidence: 0.76, minutes: 13 },
        { prompt: "Organize my notes from today's design review session", cat: "productivity", sub: "admin", confidence: 0.68, minutes: 4 },
        { prompt: "Define success metrics for the new search feature launch", cat: "strategy", sub: "okr", confidence: 0.83, minutes: 7 },
        { prompt: "Write the technical architecture proposal for microservices migration", cat: "writing", sub: "general", confidence: 0.79, minutes: 22 },
        { prompt: "Help me create a competitive analysis comparing our product to Notion", cat: "analytics", sub: "reporting", confidence: 0.86, minutes: 11 },
        { prompt: "Draft the email to engineering about the upcoming API deprecation", cat: "communication", sub: "stakeholder", confidence: 0.88, minutes: 6 },
        { prompt: "Refactor the classification module to support multiple strategies", cat: "development", sub: "coding", confidence: 0.72, minutes: 16 },
      ];

      const insert = db.prepare(
        `INSERT INTO prompts (
          external_id, session_id, timestamp, prompt_text, prompt_preview, prompt_hash,
          cwd, project_name,
          primary_category, primary_subcategory, primary_confidence,
          classification_method, classification_reasoning,
          attributed_minutes, attribution_method, time_confidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rules', 'demo data', ?, 'estimated', 'MEDIUM')`
      );

      const insertAll = db.transaction(() => {
        for (let i = 0; i < demoPrompts.length; i++) {
          const d = demoPrompts[i];
          const ts = new Date(baseTime.getTime() + i * 20 * 60_000); // 20min intervals
          const hash = createHash("sha256").update(d.prompt + i).digest("hex");

          insert.run(
            `demo-${randomUUID()}`,
            sessionId,
            ts.toISOString(),
            d.prompt,
            d.prompt.slice(0, 200),
            hash,
            "/Users/demo/Projects/pm-pulse",
            "pm-pulse",
            d.cat,
            d.sub,
            d.confidence,
            d.minutes
          );
        }
      });

      insertAll();

      return NextResponse.json({ success: true, count: demoPrompts.length });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Onboarding POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
