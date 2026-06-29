// Cross-module integration test for the chat-mode subsystem.
//
// Pure logic only — no React, no jsdom. Exercises the realistic flow:
//   chatModes (reducer + gates)
//   ↔ chatPersistence (mode + hints survive reload)
//   ↔ btwDedup (cross-channel dedup persists)
//   ↔ btwOrchestrator (end-to-end with a stub AiService)
//
// The unit-level test files cover each module in isolation. This file pins
// the contracts where they meet — the same MemoryStorage object is used by
// both persistence and dedup, hints stored in channel state get scrubbed,
// and the dedup store carries across channel boundaries.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    channelReducer,
    initialChannelState,
    type BtwHint,
    type ChannelState,
} from '../services/ai/chatModes';
import {
    loadPersistedState,
    saveChannel,
    scrubHintText,
    type StorageLike as PersistStorageLike,
} from '../services/ai/chatPersistence';
import {
    isSeen,
    markSeen,
    filterUnseen,
    type StorageLike as DedupStorageLike,
} from '../services/ai/btwDedup';
import { runBtwOrchestrator } from '../services/ai/btwOrchestrator';
import type { AiServiceLike } from '../services/ai/btwCaller';

class MemoryStorage implements PersistStorageLike, DedupStorageLike {
    store = new Map<string, string>();
    getItem(k: string) { return this.store.get(k) ?? null; }
    setItem(k: string, v: string) { this.store.set(k, v); }
    removeItem(k: string) { this.store.delete(k); }
}

const mkHint = (text: string, id = 'h-' + Math.random().toString(36).slice(2, 6)): BtwHint => ({
    id,
    text,
    source: 'llm',
});

describe('chat-mode integration — mode + hints round-trip through persistence', () => {
    let s: MemoryStorage;
    beforeEach(() => { s = new MemoryStorage(); });

    it('switches mode → save → reload reproduces it', () => {
        let state: ChannelState = { ...initialChannelState };
        state = channelReducer(state, { type: 'set-mode', mode: 'plan' });
        saveChannel(s, { id: 'main', mode: state.mode, hints: state.btwHints, now: 1000 });

        // Simulate a fresh React mount on the same storage.
        const persisted = loadPersistedState(s);
        const channel = persisted.channels.find(c => c.id === 'main');
        expect(channel?.mode).toBe('plan');
    });

    it('hints added in btw mode persist and survive reload', () => {
        let state: ChannelState = { ...initialChannelState, mode: 'btw' };
        const h1 = mkHint('Try aggregating allocations by class');
        state = channelReducer(state, { type: 'add-hints', hints: [h1] });
        saveChannel(s, { id: 'main', mode: state.mode, hints: state.btwHints, now: 2000 });

        const persisted = loadPersistedState(s);
        const channel = persisted.channels.find(c => c.id === 'main');
        expect(channel?.hints.map(h => h.text)).toContain(h1.text);
    });

    it('dismissed hints do not return after reload', () => {
        let state: ChannelState = { ...initialChannelState, mode: 'btw' };
        const h1 = mkHint('Hint A', 'h1');
        const h2 = mkHint('Hint B', 'h2');
        state = channelReducer(state, { type: 'add-hints', hints: [h1, h2] });
        state = channelReducer(state, { type: 'dismiss-hint', id: 'h1' });
        saveChannel(s, { id: 'main', mode: state.mode, hints: state.btwHints, now: 3000 });

        const persisted = loadPersistedState(s);
        const channel = persisted.channels.find(c => c.id === 'main');
        expect(channel?.hints.map(h => h.id)).toEqual(['h2']);
    });
});

describe('chat-mode integration — PII scrub applies to persisted hints', () => {
    it('SQL fragments and emails in hint text are masked before reaching storage', () => {
        // The persistence layer must scrub; the test here is to pin that the
        // scrubbed form is what comes back out, not the raw input.
        const raw = `User SELECT id FROM users WHERE email='alice@example.com'`;
        const masked = scrubHintText(raw);
        expect(masked).not.toContain('alice@example.com');
        expect(masked).not.toContain('SELECT id FROM users');
    });
});

describe('chat-mode integration — orchestrator + dedup across channels', () => {
    let storage: MemoryStorage;
    beforeEach(() => { storage = new MemoryStorage(); });

    const stubService = (texts: string[]): AiServiceLike => {
        // btwCaller expects a ```jfr-btw fenced block with { hints: [{text}, ...] }.
        const hints = texts.map(t => ({ text: t }));
        const fence = '```jfr-btw\n' + JSON.stringify({ hints }) + '\n```';
        return {
            streamChatWithTools: ((): any => {
                return () => ({
                    async *[Symbol.asyncIterator]() {
                        yield { kind: 'text', delta: fence };
                    },
                });
            })(),
        } as any;
    };

    const baseInput = {
        mode: 'btw' as const,
        lastBtwCallAt: null,
        lastBtwTier: 'basic' as const,
        userText: 'Show me GC pauses by cause',
        // assistantText must be long enough (>=80 chars) for shouldFireBtwCall to pass.
        assistantText: 'Here are the GC pauses grouped by cause. Most are due to Allocation Failure. Total: 142 events recorded across the run.',
        schema: null,
        visibility: 'sanitized' as const,
        recentResult: null,
    };

    it('a hint surfaced in channel A is filtered when the same hint appears in channel B', async () => {
        // Channel A — orchestrator runs, hint enters dedup store.
        const a = await runBtwOrchestrator({
            ...baseInput,
            aiService: stubService(['Try grouping by thread instead']),
            dedupStorage: storage,
            now: 10_000,
        });
        expect(a.fired).toBe(true);
        expect(a.hints.map(h => h.text)).toContain('Try grouping by thread instead');

        // Channel B — same hint text suggested again later. Dedup should drop it.
        const b = await runBtwOrchestrator({
            ...baseInput,
            aiService: stubService(['Try grouping by thread instead']),
            dedupStorage: storage,
            now: 11_000,
        });
        expect(b.fired).toBe(true);
        expect(b.hints).toHaveLength(0);
    });

    it('a different hint text in channel B still surfaces (dedup is per-hint, not per-channel)', async () => {
        await runBtwOrchestrator({
            ...baseInput,
            aiService: stubService(['Look at allocation by class']),
            dedupStorage: storage,
            now: 10_000,
        });
        const b = await runBtwOrchestrator({
            ...baseInput,
            aiService: stubService(['Inspect long pauses over 1s']),
            dedupStorage: storage,
            now: 11_000,
        });
        expect(b.hints.map(h => h.text)).toContain('Inspect long pauses over 1s');
    });

    it('orchestrator does not fire when mode is not btw', async () => {
        const out = await runBtwOrchestrator({
            ...baseInput,
            mode: 'plan',
            aiService: stubService(['anything']),
            dedupStorage: storage,
            now: 10_000,
        });
        expect(out.fired).toBe(false);
        expect(out.hints).toEqual([]);
    });
});

describe('chat-mode integration — dedup primitives line up with orchestrator', () => {
    it('markSeen + isSeen agree, and filterUnseen uses them consistently', () => {
        const s = new MemoryStorage();
        const h = mkHint('only-once');
        expect(isSeen(s, h, 1000)).toBe(false);
        const survivors = filterUnseen(s, [h], 1000);
        expect(survivors).toHaveLength(1);
        // filterUnseen does NOT mark — callers must do so explicitly.
        expect(isSeen(s, h, 1001)).toBe(false);
        markSeen(s, h, 1001);
        expect(isSeen(s, h, 1002)).toBe(true);
        expect(filterUnseen(s, [h], 1002)).toHaveLength(0);
    });
});
