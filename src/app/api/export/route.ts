import { NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import type { PromptRow } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_FORMATS = new Set(["csv", "json"]);

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "csv";
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");

    if (!VALID_FORMATS.has(format)) {
      return NextResponse.json(
        { error: "Invalid format. Use 'csv' or 'json'." },
        { status: 400 }
      );
    }

    if (startDate && (!DATE_RE.test(startDate) || isNaN(Date.parse(startDate)))) {
      return NextResponse.json(
        { error: "Invalid start_date format. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }

    if (endDate && (!DATE_RE.test(endDate) || isNaN(Date.parse(endDate)))) {
      return NextResponse.json(
        { error: "Invalid end_date format. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }

    const db = await initDb();

    // Load privacy setting
    const privacySetting = db
      .prepare("SELECT value FROM settings WHERE key = 'privacy_mode'")
      .get() as { value: string } | undefined;
    const privacyMode = privacySetting ? JSON.parse(privacySetting.value) : "full";

    // Build query with optional date filters
    let query = "SELECT * FROM prompts";
    const params: string[] = [];

    if (startDate && endDate) {
      query += " WHERE timestamp BETWEEN ? AND ?";
      params.push(`${startDate}T00:00:00`, `${endDate}T23:59:59.999`);
    } else if (startDate) {
      query += " WHERE timestamp >= ?";
      params.push(`${startDate}T00:00:00`);
    } else if (endDate) {
      query += " WHERE timestamp <= ?";
      params.push(`${endDate}T23:59:59.999`);
    }

    query += " ORDER BY timestamp ASC";

    const prompts = db.prepare(query).all(...params) as PromptRow[];

    // Apply privacy filtering
    const exportRows = prompts.map((p) => {
      let promptText = p.prompt_preview;
      if (privacyMode === "redacted") {
        promptText = null;
      }

      return {
        timestamp: p.timestamp,
        prompt_text: promptText,
        project_name: p.project_name,
        primary_category: p.primary_category,
        primary_subcategory: p.primary_subcategory,
        primary_confidence: p.primary_confidence,
        classification_method: p.classification_method,
        attributed_minutes: p.attributed_minutes,
        attribution_method: p.attribution_method,
        time_confidence: p.time_confidence,
        session_id: p.session_id,
      };
    });

    if (format === "json") {
      return new NextResponse(JSON.stringify(exportRows, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="pm-pulse-export.json"`,
        },
      });
    }

    // CSV format
    const headers = [
      "timestamp",
      "prompt_text",
      "project_name",
      "primary_category",
      "primary_subcategory",
      "primary_confidence",
      "classification_method",
      "attributed_minutes",
      "attribution_method",
      "time_confidence",
      "session_id",
    ];

    const csvRows = [headers.join(",")];
    for (const row of exportRows) {
      const values = headers.map((h) => {
        const val = row[h as keyof typeof row];
        if (val === null || val === undefined) return "";
        const str = String(val);
        // Escape CSV values containing commas, quotes, or newlines
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      });
      csvRows.push(values.join(","));
    }

    return new NextResponse(csvRows.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="pm-pulse-export.csv"`,
      },
    });
  } catch (err) {
    console.error("Export API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
