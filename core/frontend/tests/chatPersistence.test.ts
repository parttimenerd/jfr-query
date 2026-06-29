import { describe, it, expect, beforeEach } from 'vitest';
import {
    loadPersistedState,
    saveChannel,
    clearPersistedState,
    scrubHintText,
    __internals,
    type StorageLike,
} from '../services/ai/chatPersistence';
import type { BtwHint } from '../services/ai/chatModes';

class MemoryStorage implements StorageLike {
    store = new Map<string, string>();
    getItem(k: string) { return this.store.get(k) ?? null; }
    setItem(k: string, v: string) { this.store.set(k, v); }
    removeItem(k: string) { this.store.delete(k); }
}

const mkHint = (text: string, id = 'h'): BtwHint => ({ id, text, source: 'llm' });

describe('scrubHintText', () => {
    it('masks SQL fragments', () => {
        const out = scrubHintText('Run SELECT * FROM users WHERE id = 1 to confirm.');
        expect(out).toContain('<sql-snippet>');
        expect(out).not.toContain('SELECT *');
    });

    it('masks emails', () => {
        expect(scrubHintText('contact alice@example.com')).toContain('<email>');
    });

    it('masks long numeric runs (id-like)', () => {
        expect(scrubHintText('user 1234567 was active')).toContain('<num>');
    });

    it('leaves short numbers and ordinary words alone', () => {
        const out = scrubHintText('Show 12 rows for 3 categories');
        expect(out).toBe('Show 12 rows for 3 categories');
    });
});

describe('loadPersistedState', () => {
    let s: MemoryStorage;
    beforeEach(() => { s = new MemoryStorage(); });

    it('returns empty state when storage is empty', () => {
        expect(loadPersistedState(s)).toEqual({ version: 1, channels: [] });
    });

    it('returns empty state when JSON is malformed', () => {
        s.setItem(__internals.STORAGE_KEY, '{ broken');
        expect(loadPersistedState(s).channels).toEqual([]);
    });

    it('returns empty state when version mismatches', () => {
        s.setItem(__internals.STORAGE_KEY, JSON.stringify({ version: 99, channels: [] }));
        expect(loadPersistedState(s).channels).toEqual([]);
    });

    it('rejects channels with invalid mode', () => {
        s.setItem(__internals.STORAGE_KEY, JSON.stringify({
            version: 1,
            channels: [{ id: 'a', mode: 'bogus', hints: [], updatedAt: 0 }],
        }));
        expect(loadPersistedState(s).channels).toEqual([]);
    });
});

describe('saveChannel', () => {
    let s: MemoryStorage;
    beforeEach(() => { s = new MemoryStorage(); });

    it('round-trips a single channel', () => {
        saveChannel(s, { id: 'c1', mode: 'plan', hints: [mkHint('hello')], now: 100 });
        const loaded = loadPersistedState(s);
        expect(loaded.channels).toHaveLength(1);
        expect(loaded.channels[0].id).toBe('c1');
        expect(loaded.channels[0].mode).toBe('plan');
        expect(loaded.channels[0].hints[0].text).toBe('hello');
    });

    it('upserts an existing channel (same id replaces)', () => {
        saveChannel(s, { id: 'c1', mode: 'plan', hints: [mkHint('a')], now: 100 });
        saveChannel(s, { id: 'c1', mode: 'btw', hints: [mkHint('b')], now: 200 });
        const loaded = loadPersistedState(s);
        expect(loaded.channels).toHaveLength(1);
        expect(loaded.channels[0].mode).toBe('btw');
        expect(loaded.channels[0].hints[0].text).toBe('b');
    });

    it('scrubs hint text on save', () => {
        saveChannel(s, {
            id: 'c1', mode: 'btw', now: 1,
            hints: [mkHint('Run SELECT * FROM users WHERE id=1')],
        });
        const loaded = loadPersistedState(s);
        expect(loaded.channels[0].hints[0].text).toContain('<sql-snippet>');
    });

    it('caps hints per channel', () => {
        const many = Array.from({ length: 20 }, (_, i) => mkHint(`hint ${i}`, `h${i}`));
        saveChannel(s, { id: 'c1', mode: 'normal', hints: many, now: 1 });
        const loaded = loadPersistedState(s);
        expect(loaded.channels[0].hints.length).toBeLessThanOrEqual(__internals.MAX_HINTS_PER_CHANNEL);
    });

    it('drops oldest channels when over MAX_CHANNELS', () => {
        for (let i = 0; i < __internals.MAX_CHANNELS + 5; i++) {
            saveChannel(s, { id: `c${i}`, mode: 'normal', hints: [], now: i });
        }
        const loaded = loadPersistedState(s);
        expect(loaded.channels.length).toBe(__internals.MAX_CHANNELS);
        // Channels are sorted desc by updatedAt — oldest must be gone.
        const ids = loaded.channels.map(c => c.id);
        expect(ids).not.toContain('c0');
    });

    it('drops oldest channels when byte budget is exceeded', () => {
        // Fill with channels each having long-ish text to push past MAX_TOTAL_BYTES.
        const filler = 'x'.repeat(2000);
        for (let i = 0; i < 50; i++) {
            saveChannel(s, {
                id: `c${i}`,
                mode: 'normal',
                hints: [mkHint(filler, `h${i}`)],
                now: i,
            });
        }
        const raw = s.getItem(__internals.STORAGE_KEY) ?? '';
        expect(raw.length).toBeLessThanOrEqual(__internals.MAX_TOTAL_BYTES);
    });
});

describe('clearPersistedState', () => {
    it('removes the storage key', () => {
        const s = new MemoryStorage();
        saveChannel(s, { id: 'c1', mode: 'plan', hints: [], now: 1 });
        clearPersistedState(s);
        expect(loadPersistedState(s).channels).toEqual([]);
    });
});
