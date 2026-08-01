import { describe, it, expect } from 'vitest';
import {
    isSeen,
    markSeen,
    filterUnseen,
    clearDedup,
    __internals,
} from '../../../services/ai/btwDedup';
import type { BtwHint } from '../../../services/ai/chatModes';

const { STORAGE_KEY, TTL_MS, MAX_ENTRIES } = __internals;

function makeStorage(initial: Record<string, string> = {}): Record<string, string> & {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
    removeItem(k: string): void;
} {
    const store: Record<string, string> = { ...initial };
    return {
        ...store,
        getItem: (k) => store[k] ?? null,
        setItem: (k, v) => { store[k] = v; },
        removeItem: (k) => { delete store[k]; },
    };
}

function hint(text: string): BtwHint {
    return { id: 'h1', source: 'analyzer', text };
}

const NOW = 1_000_000;

describe('isSeen', () => {
    it('returns false when storage is empty', () => {
        const storage = makeStorage();
        expect(isSeen(storage, hint('hello'), NOW)).toBe(false);
    });

    it('returns true after markSeen', () => {
        const storage = makeStorage();
        markSeen(storage, hint('hello'), NOW);
        expect(isSeen(storage, hint('hello'), NOW)).toBe(true);
    });

    it('returns false after TTL expires', () => {
        const storage = makeStorage();
        markSeen(storage, hint('hello'), NOW);
        expect(isSeen(storage, hint('hello'), NOW + TTL_MS + 1)).toBe(false);
    });

    it('is case-insensitive', () => {
        const storage = makeStorage();
        markSeen(storage, hint('HELLO WORLD'), NOW);
        expect(isSeen(storage, hint('hello world'), NOW)).toBe(true);
    });

    it('normalizes whitespace when matching', () => {
        const storage = makeStorage();
        markSeen(storage, hint('  hello   world  '), NOW);
        expect(isSeen(storage, hint('hello world'), NOW)).toBe(true);
    });

    it('returns false for a different hint text', () => {
        const storage = makeStorage();
        markSeen(storage, hint('hello'), NOW);
        expect(isSeen(storage, hint('goodbye'), NOW)).toBe(false);
    });
});

describe('markSeen', () => {
    it('evicts expired entries', () => {
        const storage = makeStorage();
        markSeen(storage, hint('old'), NOW);
        // Mark a new hint at a time past the TTL
        markSeen(storage, hint('fresh'), NOW + TTL_MS + 1);
        // 'old' should now be evicted
        expect(isSeen(storage, hint('old'), NOW + TTL_MS + 1)).toBe(false);
        expect(isSeen(storage, hint('fresh'), NOW + TTL_MS + 1)).toBe(true);
    });

    it('updates timestamp when re-marking a seen hint', () => {
        const storage = makeStorage();
        markSeen(storage, hint('hello'), NOW);
        // Re-mark at a later time
        markSeen(storage, hint('hello'), NOW + TTL_MS - 1);
        // Should still be seen well after the original TTL
        expect(isSeen(storage, hint('hello'), NOW + TTL_MS + 100)).toBe(true);
    });

    it('caps entries at MAX_ENTRIES', () => {
        const storage = makeStorage();
        for (let i = 0; i < MAX_ENTRIES + 10; i++) {
            markSeen(storage, hint(`hint-${i}`), NOW + i);
        }
        const raw = storage.getItem(STORAGE_KEY)!;
        const entries = JSON.parse(raw);
        expect(entries.length).toBeLessThanOrEqual(MAX_ENTRIES);
    });
});

describe('filterUnseen', () => {
    it('returns all hints when none are seen', () => {
        const storage = makeStorage();
        const hints = [hint('a'), hint('b')];
        expect(filterUnseen(storage, hints, NOW)).toHaveLength(2);
    });

    it('filters out a seen hint', () => {
        const storage = makeStorage();
        markSeen(storage, hint('a'), NOW);
        const result = filterUnseen(storage, [hint('a'), hint('b')], NOW);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('b');
    });

    it('returns empty array when all hints are seen', () => {
        const storage = makeStorage();
        markSeen(storage, hint('a'), NOW);
        markSeen(storage, hint('b'), NOW);
        expect(filterUnseen(storage, [hint('a'), hint('b')], NOW)).toHaveLength(0);
    });
});

describe('clearDedup', () => {
    it('removes stored entries', () => {
        const storage = makeStorage();
        markSeen(storage, hint('hello'), NOW);
        clearDedup(storage);
        expect(isSeen(storage, hint('hello'), NOW)).toBe(false);
    });
});

describe('corrupt storage', () => {
    it('returns false for isSeen when storage contains garbage', () => {
        const storage = makeStorage({ [STORAGE_KEY]: 'not-json' });
        expect(isSeen(storage, hint('hello'), NOW)).toBe(false);
    });

    it('returns false for isSeen when storage contains non-array JSON', () => {
        const storage = makeStorage({ [STORAGE_KEY]: '{"fp":"x","at":1}' });
        expect(isSeen(storage, hint('hello'), NOW)).toBe(false);
    });
});
