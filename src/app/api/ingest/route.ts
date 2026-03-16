import { NextResponse } from "next/server";
import { initDb, loadSettings } from "@/lib/db";
import { processEvents } from "@/lib/ingestion/processor";
import { processWindowEvents } from "@/lib/ingestion/window-ingestor";
import { processBrowserEvents } from "@/lib/ingestion/browser-ingestor";
import { syncCalendarIfDue } from "@/lib/ingestion/calendar-ingestor";
import { captureMultiSourceTrainingItems } from "@/lib/ingestion/training-collector";

/**
 * POST /api/ingest — explicitly trigger event ingestion from all sources.
 * Useful for CLI tools, cron jobs, or testing without opening the dashboard.
 */
export async function POST(): Promise<NextResponse> {
  try {
    await initDb();
    const settings = loadSettings();

    const windowTrackingEnabled = settings.window_tracking_enabled;
    const browserTrackingEnabled = settings.browser_tracking_enabled;

    const promptResult = processEvents();

    let windowResult = { processed: 0, errors: 0 };
    if (windowTrackingEnabled) {
      windowResult = processWindowEvents({ skipBrowserApps: browserTrackingEnabled });
    }

    let browserResult = { processed: 0, errors: 0 };
    if (browserTrackingEnabled) {
      browserResult = await processBrowserEvents();
    }

    syncCalendarIfDue();
    captureMultiSourceTrainingItems().catch((e) =>
      console.error("Multi-source training capture error:", e)
    );

    return NextResponse.json({
      prompts: promptResult,
      window: windowResult,
      browser: browserResult,
    });
  } catch (err) {
    console.error("Ingest API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
