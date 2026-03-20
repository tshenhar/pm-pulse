import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { todayStr, shiftDate } from "@/lib/date-utils";
import { computeProductivityScore, persistScore, loadScores } from "@/lib/scoring";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const endDate = searchParams.get("end_date") || todayStr();
    const days = Math.min(parseInt(searchParams.get("days") || "7", 10), 90);

    if (!DATE_RE.test(endDate) || isNaN(Date.parse(endDate))) {
      return NextResponse.json({ error: "Invalid end_date format" }, { status: 400 });
    }

    await initDb();

    const startDate = shiftDate(endDate, -(days - 1));
    const scores = loadScores(startDate, endDate);

    return NextResponse.json({ scores, start_date: startDate, end_date: endDate });
  } catch (err) {
    console.error("Scores API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as { date?: string };
    const date = body.date || todayStr();
    if (!DATE_RE.test(date) || isNaN(Date.parse(date))) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    await initDb();
    const breakdown = computeProductivityScore(date);
    if (breakdown) persistScore(date, breakdown);
    return NextResponse.json({ score: breakdown });
  } catch (err) {
    console.error("Scores POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
