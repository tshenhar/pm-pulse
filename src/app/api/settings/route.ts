import { writeFileSync } from "fs";
import { NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";
import { WATCHER_CONFIG_PATH } from "@/lib/constants";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/types";

const VALID_PRIVACY_MODES = new Set(["full", "preview", "redacted"]);
const VALID_CLASSIFICATION_MODES = new Set(["rules", "hybrid", "llm"]);

export async function GET(): Promise<NextResponse<AppSettings>> {
  try {
    await initDb();
    const db = getDb();

    const rows = db.prepare("SELECT key, value FROM settings").all() as {
      key: string;
      value: string;
    }[];

    const settings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (row.key in settings) {
        (settings as Record<string, unknown>)[row.key] = JSON.parse(row.value);
      }
    }

    return NextResponse.json(settings);
  } catch (err) {
    console.error("Settings GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" } as unknown as AppSettings,
      { status: 500 }
    );
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    await initDb();
    const db = getDb();
    const body = await request.json();

    // Validate enum fields
    if (body.privacy_mode !== undefined && !VALID_PRIVACY_MODES.has(body.privacy_mode)) {
      return NextResponse.json(
        { error: "Invalid privacy_mode. Use 'full', 'preview', or 'redacted'." },
        { status: 400 }
      );
    }
    if (body.classification_mode !== undefined && !VALID_CLASSIFICATION_MODES.has(body.classification_mode)) {
      return NextResponse.json(
        { error: "Invalid classification_mode. Use 'rules', 'hybrid', or 'llm'." },
        { status: 400 }
      );
    }

    const validKeys = Object.keys(DEFAULT_SETTINGS);
    const upsert = db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );

    const updates: string[] = [];

    const applyAll = db.transaction(() => {
      for (const [key, value] of Object.entries(body)) {
        if (!validKeys.includes(key)) continue;

        // Validate numeric values — no-op block kept for future additions
        // Validate string fields
        if (key === "calendar_ics_url") {
          if (typeof value !== "string") continue;
          if (value !== "" && !value.startsWith("https://")) continue; // SSRF guard
        }
        if (key === "calendar_block_keyword") {
          if (typeof value !== "string" || value.length > 50) continue;
        }
        // Validate boolean fields
        if (key === "window_tracking_enabled" && typeof value !== "boolean") continue;
        if (key === "browser_tracking_enabled" && typeof value !== "boolean") continue;
        if (key === "dashboard_auto_refresh" && typeof value !== "boolean") continue;
        if (key === "idle_threshold_minutes" && (typeof value !== "number" || value < 1 || value > 30)) continue;
        if (key === "min_session_seconds" && (typeof value !== "number" || value < 10 || value > 120)) continue;
        if (key === "calendar_sync_interval_minutes" && (typeof value !== "number" || value < 5 || value > 240)) continue;
        if (key === "browser_event_retention_days" && (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 90)) continue;
        if (key === "dashboard_card_order") {
          if (!Array.isArray(value)) continue;
          const validIds = new Set(["category", "source", "activity"]);
          if (value.length !== 3 || (value as unknown[]).some((id) => typeof id !== "string" || !validIds.has(id)) || new Set(value).size !== 3) continue;
        }
        if (key === "dashboard_card_spans") {
          if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
          const entries = Object.entries(value as Record<string, unknown>);
          const validIds = new Set(["category", "source", "activity"]);
          if (entries.some(([k, v]) => !validIds.has(k) || typeof v !== "number" || !Number.isInteger(v as number) || (v as number) < 1 || (v as number) > 3)) continue;
        }
        if (key === "dashboard_labels") {
          if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
          const entries = Object.entries(value as Record<string, unknown>);
          if (entries.length > 50) continue;
          if (entries.some(([, v]) => typeof v !== "string" || (v as string).length > 200)) continue;
        }
        if (key === "dashboard_col_count") {
          if (typeof value !== "number" || ![2, 3].includes(value)) continue;
        }
        if (key === "settings_card_order") {
          if (!Array.isArray(value)) continue;
          const validIds = new Set(["privacy", "classification", "activity-tracking", "calendar", "window", "browser", "dashboard-settings", "exclusions", "export"]);
          if ((value as unknown[]).some((id) => typeof id !== "string" || !validIds.has(id))) continue;
          if (new Set(value).size !== (value as unknown[]).length) continue; // no duplicates
        }
        if (key === "settings_col_count") {
          if (typeof value !== "number" || ![1, 2, 3].includes(value)) continue;
        }

        upsert.run(key, JSON.stringify(value));
        updates.push(key);
      }
    });

    applyAll();

    // Write watcher config if relevant keys were updated
    const watcherKeys = ["idle_threshold_minutes", "min_session_seconds", "browser_event_retention_days"];
    if (updates.some((k) => watcherKeys.includes(k))) {
      try {
        const rows = db.prepare(
          "SELECT key, value FROM settings WHERE key IN ('idle_threshold_minutes', 'min_session_seconds', 'browser_event_retention_days')"
        ).all() as { key: string; value: string }[];
        const cfg: Record<string, number> = {};
        for (const r of rows) cfg[r.key] = JSON.parse(r.value);
        writeFileSync(
          WATCHER_CONFIG_PATH,
          JSON.stringify({
            idle_threshold_seconds: (cfg.idle_threshold_minutes ?? DEFAULT_SETTINGS.idle_threshold_minutes) * 60,
            min_session_seconds: cfg.min_session_seconds ?? DEFAULT_SETTINGS.min_session_seconds,
            browser_event_retention_days: cfg.browser_event_retention_days ?? DEFAULT_SETTINGS.browser_event_retention_days,
          }, null, 2)
        );
      } catch {
        // non-fatal — watcher will use its own defaults
      }
    }

    return NextResponse.json({ success: true, updated: updates });
  } catch (err) {
    console.error("Settings PUT error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
