import ical from "node-ical";
import { getDb } from "@/lib/db";
import { DEFAULT_SETTINGS } from "@/lib/types";

let lastSyncAt = 0;

function validateIcsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid ICS URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("ICS URL must use https:// or http://");
  }
  const hostname = url.hostname.toLowerCase();
  const blocked =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal");
  if (blocked) {
    throw new Error("ICS URL must not point to private/internal addresses");
  }
  return url;
}

interface MeetingClassification {
  category: string;
  subcategory: string;
  confidence: number;
  reasoning: string;
}

function classifyMeeting(
  summary: string,
  attendeeCount: number,
  durationMinutes: number
): MeetingClassification {
  const lower = summary.toLowerCase();

  if (attendeeCount === 1) {
    return { category: "communication", subcategory: "meetings", confidence: 0.9, reasoning: "1:1 meeting" };
  }
  if (/standup|sync|check.?in|daily/.test(lower)) {
    return { category: "communication", subcategory: "meetings", confidence: 0.85, reasoning: "standup/sync meeting" };
  }
  if (/review|planning|roadmap|strategy/.test(lower)) {
    return { category: "strategy", subcategory: "roadmap", confidence: 0.8, reasoning: "planning/strategy meeting" };
  }
  if (/interview|hiring|debrief/.test(lower)) {
    return { category: "productivity", subcategory: "admin", confidence: 0.85, reasoning: "hiring/interview meeting" };
  }
  if (/all.?hands|company|town.?hall/.test(lower)) {
    return { category: "communication", subcategory: "stakeholder", confidence: 0.9, reasoning: "all-hands/company meeting" };
  }
  if (durationMinutes >= 90 && attendeeCount >= 5) {
    return { category: "communication", subcategory: "stakeholder", confidence: 0.75, reasoning: "large long meeting" };
  }
  return { category: "communication", subcategory: "meetings", confidence: 0.5, reasoning: "generic meeting" };
}

export async function syncCalendar(
  icsUrl: string
): Promise<{ inserted: number; updated: number; skipped: number }> {
  const db = getDb();

  validateIcsUrl(icsUrl);
  const events = await ical.async.fromURL(icsUrl);

  const upsert = db.prepare(`
    INSERT INTO calendar_events (uid, summary, start_time, end_time, duration_minutes, attendee_count, location,
      primary_category, primary_subcategory, primary_confidence, classification_reasoning)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET
      summary = excluded.summary,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      duration_minutes = excluded.duration_minutes,
      attendee_count = excluded.attendee_count,
      location = excluded.location,
      updated_at = datetime('now')
  `);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  // Use a separate query to check existence for accurate insert vs update counting
  const exists = db.prepare("SELECT id FROM calendar_events WHERE uid = ?");

  const runAll = db.transaction(() => {
    for (const event of Object.values(events)) {
      if (!event || event.type !== "VEVENT") { skipped++; continue; }
      if (!event.start || !event.end) { skipped++; continue; }

      const start = new Date(event.start as Date);
      const end = new Date(event.end as Date);
      const durationMinutes = (end.getTime() - start.getTime()) / 60000;
      if (durationMinutes <= 0) { skipped++; continue; }

      const attendeeCount = Array.isArray(event.attendee)
        ? event.attendee.length
        : event.attendee
        ? 1
        : 0;

      const summaryStr = typeof event.summary === "string" ? event.summary : String(event.summary ?? "");
      const classification = classifyMeeting(summaryStr, attendeeCount, durationMinutes);

      const location = typeof event.location === "string" ? event.location : null;

      const isNew = !exists.get(event.uid);
      upsert.run(
        event.uid,
        summaryStr || "(no title)",
        start.toISOString(),
        end.toISOString(),
        durationMinutes,
        attendeeCount,
        location,
        classification.category,
        classification.subcategory,
        classification.confidence,
        classification.reasoning
      );
      if (isNew) inserted++; else updated++;
    }
  });

  runAll();
  return { inserted, updated, skipped };
}

export function syncCalendarIfDue(): void {
  const now = Date.now();
  const db = getDb();
  const intervalRow = db.prepare("SELECT value FROM settings WHERE key = 'calendar_sync_interval_minutes'").get() as { value: string } | undefined;
  const intervalMinutes = intervalRow ? (JSON.parse(intervalRow.value) as number) : DEFAULT_SETTINGS.calendar_sync_interval_minutes;
  if (now - lastSyncAt < intervalMinutes * 60 * 1000) return;

  try {
    const urlRow = db.prepare("SELECT value FROM settings WHERE key = 'calendar_ics_url'").get() as { value: string } | undefined;
    if (!urlRow) return;
    const icsUrl = JSON.parse(urlRow.value) as string;
    if (!icsUrl) return;

    lastSyncAt = now;
    // Fire-and-forget — don't block dashboard request
    syncCalendar(icsUrl).catch((e) => console.error("Calendar sync error:", e));
  } catch {
    // non-fatal
  }
}
