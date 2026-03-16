// The "work day" starts at 8am Eastern Time and runs for 24 hours.
// So working until 2am still counts as part of the previous calendar day.
const DAY_START_HOUR = 8;
const DAY_START_TZ = "America/New_York";

// Cache the formatter — Intl.DateTimeFormat construction is relatively expensive
const etFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: DAY_START_TZ,
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hour12: false,
});

const etDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DAY_START_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Shift a YYYY-MM-DD date string by `days` using UTC arithmetic (timezone-safe).
 */
export function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().split("T")[0];
}

/**
 * Return today's calendar date as a YYYY-MM-DD string (UTC).
 * Prefer `currentWorkday()` for user-facing "today" logic.
 */
export function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Convert a local date + startHour in DAY_START_TZ to a UTC epoch (ms).
 * Uses noon-UTC as the DST-safe reference to compute the timezone offset.
 * (Noon avoids the 2am DST transition window on spring-forward/fall-back days.)
 */
function localHourToUtcMs(dateStr: string, hour: number): number {
  const noonUtc = new Date(`${dateStr}T12:00:00.000Z`);
  const parts = etFormatter.formatToParts(noonUtc);

  const get = (type: string) => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };

  const tzH = get("hour");
  const tzM = get("minute");
  const tzS = get("second");

  // At noon UTC the ET clock shows tzH:tzM:tzS.
  // offsetMs = how many ms to add to a local time to get its UTC equivalent.
  const utcOffsetMs = 12 * 3_600_000 - (tzH * 3_600_000 + tzM * 60_000 + tzS * 1_000);

  const [y, mo, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, mo - 1, d, hour, 0, 0) + utcOffsetMs;
}

/**
 * Return the UTC ISO start/end bounds for a "work day" on `dateStr`.
 * A work day runs from DAY_START_HOUR in ET to DAY_START_HOUR+24h in ET.
 */
export function getDayBounds(dateStr: string): { start: string; end: string } {
  const startMs = localHourToUtcMs(dateStr, DAY_START_HOUR);
  const endMs = startMs + 24 * 60 * 60 * 1_000 - 1;
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  };
}

/**
 * Return the current "work day" date string.
 * Before 8am ET, this is yesterday (we're still in the previous work day's window).
 */
export function currentWorkday(): string {
  const formatted = etDateFormatter.format(new Date()); // "YYYY-MM-DD, HH:mm"
  const [datePart, timePart] = formatted.split(", ");
  const currentHour = Number(timePart.split(":")[0]);
  return currentHour < DAY_START_HOUR ? shiftDate(datePart, -1) : datePart;
}
