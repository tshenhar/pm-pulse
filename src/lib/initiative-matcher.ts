import { getDb } from "./db";
import type { Initiative } from "./types";

let _cache: Initiative[] | null = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000; // 1 minute

function getInitiatives(): Initiative[] {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;
  const db = getDb();
  const rows = db
    .prepare("SELECT id, name, slug, keywords, color, is_active, created_at, updated_at FROM initiatives WHERE is_active = 1")
    .all() as (Omit<Initiative, "keywords"> & { keywords: string })[];
  _cache = rows.map((r) => ({ ...r, keywords: JSON.parse(r.keywords) as string[] }));
  _cacheTime = now;
  return _cache;
}

export function invalidateInitiativeCache(): void {
  _cache = null;
}

/**
 * Match an initiative from prompt text + working directory.
 * Returns slug of matched initiative, or null if no match.
 */
export function matchInitiative(text: string, cwd?: string | null): string | null {
  const initiatives = getInitiatives();
  if (initiatives.length === 0) return null;

  const lowerText = text.toLowerCase();
  const lowerCwd = (cwd || "").toLowerCase();

  for (const initiative of initiatives) {
    for (const keyword of initiative.keywords) {
      const lk = keyword.toLowerCase().trim();
      if (!lk) continue;
      if (lowerText.includes(lk) || lowerCwd.includes(lk)) {
        return initiative.slug;
      }
    }
  }
  return null;
}
