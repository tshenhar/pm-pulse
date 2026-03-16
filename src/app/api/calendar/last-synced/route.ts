import { NextResponse } from "next/server";
import { initDb, getDb } from "@/lib/db";

export async function GET(): Promise<NextResponse> {
  try {
    await initDb();
    const db = getDb();
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'calendar_last_synced_at'")
      .get() as { value: string } | undefined;
    if (!row) return NextResponse.json({ synced_at: null });
    return NextResponse.json({ synced_at: JSON.parse(row.value) });
  } catch {
    return NextResponse.json({ synced_at: null });
  }
}
