import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { currentWorkday } from "@/lib/date-utils";
import { computeAnomalyAlerts, computeHourlyHeatmap, computeTemporalRhythm } from "@/lib/insights";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || currentWorkday();
    const includeHeatmap = searchParams.get("heatmap") === "true";
    const includeRhythm = searchParams.get("rhythm") === "true";
    const days = parseInt(searchParams.get("days") || "28", 10);

    if (!DATE_RE.test(date) || isNaN(Date.parse(date))) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }

    await initDb();

    const anomaly_alerts = computeAnomalyAlerts(date);
    const hourly_heatmap = includeHeatmap ? computeHourlyHeatmap(Math.min(days, 90)) : undefined;
    const temporal_rhythm = includeRhythm ? computeTemporalRhythm(Math.min(days, 90)) : undefined;

    return NextResponse.json({ anomaly_alerts, hourly_heatmap, temporal_rhythm });
  } catch (err) {
    console.error("Insights API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
