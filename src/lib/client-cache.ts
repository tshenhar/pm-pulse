const store = new Map<string, { data: unknown; expires: number }>();

export function getCached<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCached(key: string, data: unknown, ttlMs: number): void {
  store.set(key, { data, expires: Date.now() + ttlMs });
}

export function invalidateCache(key: string): void {
  store.delete(key);
}
