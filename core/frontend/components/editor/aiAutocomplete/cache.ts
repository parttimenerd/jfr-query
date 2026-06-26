/**
 * Tiny LRU cache for AI ghost-text suggestions.
 *
 * Keyed by a stable string (mode|contextHash|model). Capped at MAX entries —
 * the oldest entry is evicted on overflow.
 */

export class LRUCache<V = string> {
  private order: string[] = [];
  private store = new Map<string, V>();
  constructor(readonly max = 30) {}

  get(key: string): V | undefined {
    const v = this.store.get(key);
    if (v !== undefined) {
      // touch — promote to most-recently-used
      const idx = this.order.indexOf(key);
      if (idx >= 0) this.order.splice(idx, 1);
      this.order.push(key);
    }
    return v;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  set(key: string, value: V): void {
    if (this.store.has(key)) {
      const idx = this.order.indexOf(key);
      if (idx >= 0) this.order.splice(idx, 1);
    }
    this.store.set(key, value);
    this.order.push(key);
    while (this.order.length > this.max) {
      const dead = this.order.shift();
      if (dead !== undefined) this.store.delete(dead);
    }
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.order = [];
    this.store.clear();
  }
}

/**
 * Fast non-cryptographic 32-bit hash (FNV-1a). Good enough as a cache key
 * fingerprint — no security requirements.
 */
export function fnv1aHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

/**
 * In-flight request dedup registry. Multiple keystrokes can hash to the same
 * cache key (cursor in same logical position, no new context). When a request
 * for key K is already streaming, subsequent callers attach to the same promise
 * instead of issuing a duplicate API call.
 *
 * `start(key, factory)` returns the existing in-flight promise if any, else
 * runs `factory()` and tracks it until resolution/rejection. The factory's
 * eventual value is delivered to all waiters in arrival order.
 */
export class InflightRegistry<V = string> {
  private inflight = new Map<string, Promise<V>>();

  has(key: string): boolean {
    return this.inflight.has(key);
  }

  /**
   * Either returns the already-in-flight promise for `key`, or invokes
   * `factory()` and registers its promise. Cleans up on settle.
   */
  start(key: string, factory: () => Promise<V>): Promise<V> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = factory().finally(() => {
      // Only clear if this is still the registered promise (avoid clobbering
      // a newer entry that replaced ours).
      if (this.inflight.get(key) === p) this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }

  clear(): void {
    this.inflight.clear();
  }
}

/**
 * Prefix-aware cache reuse: if the user has typed past the original cursor
 * position by characters that exactly match the cached suggestion's leading
 * chars, return the tail of the suggestion (what the user hasn't typed yet).
 *
 * Returns the trimmed suggestion when reusable, or null otherwise.
 *
 * Example: cached at cursor=10 was "y: \"cpu\")". User types `y` (cursor=11).
 * The new prefix ends in `y`, which matches the cache's first char — return
 * `: "cpu")` so ghost text continues seamlessly.
 */
export function reuseCachedPrefix(
  cachedSuggestion: string,
  userTypedSinceCache: string,
): string | null {
  if (!cachedSuggestion) return null;
  if (userTypedSinceCache.length === 0) return cachedSuggestion;
  if (userTypedSinceCache.length >= cachedSuggestion.length) return null;
  if (cachedSuggestion.startsWith(userTypedSinceCache)) {
    return cachedSuggestion.slice(userTypedSinceCache.length);
  }
  return null;
}
