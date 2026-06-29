import { describe, it, expect, beforeEach } from 'vitest';
import {
    isSeen, markSeen, filterUnseen, clearDedup, __internals, type StorageLike,
} from '../services/ai/btwDedup';
import type { BtwHint } from '../services/ai/chatModes';

class MemoryStorage implements StorageLike {
    store = new Map<string, string>();
    getItem(k: string) { return this.store.get(k) ?? null; }
    setItem(k: string, v: string) { this.store.set(k, v); }
    removeItem(k: string) { this.store.delete(k); }
}

const mkHint = (text: string): BtwHint => ({ id: 'x', text, source: 'llm' });

describe('btwDedup', () => {
    let s: MemoryStorage;
    beforeEach(() => { s = new MemoryStorage(); });

    it('unmarked hints are not seen', () => {
        expect(isSeen(s, mkHint('hello'), 1000)).toBe(false);
    });

    it('marked hints are seen on subsequent checks', () => {
        markSeen(s, mkHint('Hello world'), 1000);
        expect(isSeen(s, mkHint('hello world'), 1500)).toBe(true);
    });

    it('treats fingerprint as case-insensitive and whitespace-normalized', () => {
        markSeen(s, mkHint('Investigate  the   outlier'), 1000);
        expect(isSeen(s, mkHint('investigate the outlier'), 1500)).toBe(true);
    });

    it('expires after TTL_MS', () => {
        markSeen(s, mkHint('expires'), 1000);
        expect(isSeen(s, mkHint('expires'), 1000 + __internals.TTL_MS + 1)).toBe(false);
    });

    it('caps entries at MAX_ENTRIES', () => {
        for (let i = 0; i < __internals.MAX_ENTRIES + 20; i++) {
            markSeen(s, mkHint(`hint number ${i}`), 1000 + i);
        }
        const raw = s.getItem(__internals.STORAGE_KEY) ?? '[]';
        const parsed = JSON.parse(raw);
        expect(parsed.length).toBeLessThanOrEqual(__internals.MAX_ENTRIES);
    });

    it('keeps the newest entries when capping', () => {
        for (let i = 0; i < __internals.MAX_ENTRIES + 5; i++) {
            markSeen(s, mkHint(`hint ${i}`), 1000 + i);
        }
        const raw = s.getItem(__internals.STORAGE_KEY) ?? '[]';
        const parsed: any[] = JSON.parse(raw);
        const fps = new Set(parsed.map(e => e.fp));
        expect(fps.has(__internals.fingerprint('hint 0'))).toBe(false);
        expect(fps.has(__internals.fingerprint(`hint ${__internals.MAX_ENTRIES + 4}`))).toBe(true);
    });

    it('filterUnseen drops seen hints but keeps unseen ones', () => {
        markSeen(s, mkHint('one'), 1000);
        const out = filterUnseen(s, [mkHint('one'), mkHint('two')], 1500);
        expect(out).toHaveLength(1);
        expect(out[0].text).toBe('two');
    });

    it('clearDedup wipes all entries', () => {
        markSeen(s, mkHint('one'), 1000);
        clearDedup(s);
        expect(isSeen(s, mkHint('one'), 1500)).toBe(false);
    });

    it('handles malformed storage gracefully', () => {
        s.setItem(__internals.STORAGE_KEY, '{ broken');
        expect(isSeen(s, mkHint('x'), 1000)).toBe(false);
        expect(() => markSeen(s, mkHint('x'), 1000)).not.toThrow();
    });
});
