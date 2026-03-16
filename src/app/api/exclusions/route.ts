import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export function GET() {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, rule_type, pattern, created_at FROM user_rules WHERE action = 'exclude' ORDER BY created_at DESC")
    .all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { rule_type, pattern } = body as { rule_type?: string; pattern?: string };

  if (!rule_type || !["app_name", "domain"].includes(rule_type)) {
    return NextResponse.json({ error: "rule_type must be 'app_name' or 'domain'" }, { status: 400 });
  }
  if (!pattern || typeof pattern !== "string" || pattern.trim().length === 0 || pattern.length > 200) {
    return NextResponse.json({ error: "pattern must be a non-empty string ≤ 200 chars" }, { status: 400 });
  }

  const trimmed = pattern.trim();
  const db = getDb();

  db.prepare(`
    INSERT INTO user_rules (rule_type, pattern, action, primary_category, primary_subcategory)
    VALUES (?, ?, 'exclude', NULL, NULL)
    ON CONFLICT(rule_type, pattern) DO UPDATE SET
      action = 'exclude',
      primary_category = NULL,
      primary_subcategory = NULL,
      updated_at = datetime('now')
  `).run(rule_type, trimmed);

  const row = db
    .prepare("SELECT id, rule_type, pattern, created_at FROM user_rules WHERE rule_type = ? AND pattern = ?")
    .get(rule_type, trimmed);

  return NextResponse.json(row, { status: 201 });
}

export function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rule_type = searchParams.get("type");
  const pattern = searchParams.get("pattern");

  if (!rule_type || !["app_name", "domain"].includes(rule_type)) {
    return NextResponse.json({ error: "type must be 'app_name' or 'domain'" }, { status: 400 });
  }
  if (!pattern) {
    return NextResponse.json({ error: "pattern is required" }, { status: 400 });
  }

  const db = getDb();
  // Guard: only delete exclude rules, not classify rules
  db.prepare("DELETE FROM user_rules WHERE action = 'exclude' AND rule_type = ? AND pattern = ?").run(rule_type, pattern);

  return NextResponse.json({ ok: true });
}
