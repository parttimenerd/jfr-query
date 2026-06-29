// Cross-channel "by the way" hint dedup. A hint shown in one channel
// shouldn't immediately re-appear in another channel; we track a rolling
// fingerprint window in sessionStorage so the LRU of seen hints survives a
// channel switch but not a fresh tab.
//
// Pure: ALL I/O routes through a Storage-like interface so tests can inject
// an in-memory mock.

import type { BtwHint } from './chatModes';

const STORAGE_KEY = 'jfr-query:btw-dedup:v1';
const MAX_ENTRIES = 50;
const TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

interface DedupEntry {
    fp: string;       // fingerprint
    at: number;       // timestamp
}

function fingerprint(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
}

function readEntries(storage: StorageLike): DedupEntry[] {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(e => e && typeof e.fp === 'string' && typeof e.at === 'number');
    } catch {
        return [];
    }
}

function writeEntries(storage: StorageLike, entries: DedupEntry[]): void {
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
        // Storage quota errors are non-fatal; dedup just becomes a no-op.
    }
}

/** Return true if the hint matches a recently seen fingerprint. */
export function isSeen(storage: StorageLike, hint: BtwHint, now: number): boolean {
    const target = fingerprint(hint.text);
    const entries = readEntries(storage);
    return entries.some(e => e.fp === target && (now - e.at) < TTL_MS);
}

/** Record a hint as seen. Evicts expired and oldest entries to stay under
 * MAX_ENTRIES. */
export function markSeen(storage: StorageLike, hint: BtwHint, now: number): void {
    const target = fingerprint(hint.text);
    const entries = readEntries(storage).filter(e => (now - e.at) < TTL_MS);
    // Remove existing entry with the same fingerprint (we'll re-push with new time).
    const filtered = entries.filter(e => e.fp !== target);
    filtered.push({ fp: target, at: now });
    // Keep newest MAX_ENTRIES.
    filtered.sort((a, b) => b.at - a.at);
    writeEntries(storage, filtered.slice(0, MAX_ENTRIES));
}

/** Filter out hints whose fingerprint is already in the seen set. Does NOT
 * mark them — call markSeen yourself once the hint actually renders. */
export function filterUnseen(storage: StorageLike, hints: BtwHint[], now: number): BtwHint[] {
    return hints.filter(h => !isSeen(storage, h, now));
}

export function clearDedup(storage: StorageLike): void {
    storage.removeItem(STORAGE_KEY);
}

export const __internals = {
    STORAGE_KEY,
    MAX_ENTRIES,
    TTL_MS,
    fingerprint,
};
