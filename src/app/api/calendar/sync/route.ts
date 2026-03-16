import { NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";
import { syncCalendar } from "@/lib/ingestion/calendar-ingestor";

async function getIcsUrl(): Promise<string | null> {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'calendar_ics_url'").get() as { value: string } | undefined;
  if (!row) return null;
  const url = JSON.parse(row.value) as string;
  return url || null;
}

export async function POST(): Promise<NextResponse> {
  try {
    await initDb();
    const icsUrl = await getIcsUrl();
    if (!icsUrl) {
      return NextResponse.json({ error: "No ICS URL configured" }, { status: 400 });
    }
    const result = await syncCalendar(icsUrl);
    // Persist last_synced_at so the settings page can display it
    const db = getDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('calendar_last_synced_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(new Date().toISOString()));
    return NextResponse.json({ ...result, synced_at: new Date().toISOString() });
  } catch (err) {
    console.error("Calendar sync error:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    await initDb();
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'calendar_last_synced_at'").get() as { value: string } | undefined;
    const lastSynced = row ? JSON.parse(row.value) : null;
    const hasUrl = !!(await getIcsUrl());
    return NextResponse.json({ configured: hasUrl, last_synced_at: lastSynced });
  } catch (err) {
    console.error("Calendar sync status error:", err);
    return NextResponse.json({ error: "Failed to get sync status" }, { status: 500 });
  }
}
