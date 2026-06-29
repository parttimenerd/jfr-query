import { describe, it, expect } from 'vitest';
import { runBtwOrchestrator } from '../services/ai/btwOrchestrator';
import type { StorageLike as DedupStorage } from '../services/ai/btwDedup';

class MemoryStorage implements DedupStorage {
    store = new Map<string, string>();
    getItem(k: string) { return this.store.get(k) ?? null; }
    setItem(k: string, v: string) { this.store.set(k, v); }
    removeItem(k: string) { this.store.delete(k); }
}

function mockServiceWithResponses(responses: string[]) {
    let i = 0;
    return {
        streamChatWithTools: (
            _messages: any, _schema: any, _tools: any, _deps: any, _opts: any,
        ): AsyncIterable<any> => {
            const text = responses[i++] ?? '';
            return {
                async *[Symbol.asyncIterator]() {
                    yield { kind: 'text' as const, delta: text };
                },
            };
        },
    };
}

const VALID_FENCE = '```jfr-btw\n{ "hints": [{ "text": "LLM hint A" }] }\n```';

const baseInput = {
    userText: 'show me top classes',
    assistantText: 'Here are the top classes from the GC log: the first row shows most weight by a wide margin compared to the rest.',
    schema: null,
    visibility: 'full' as const,
};

describe('runBtwOrchestrator gates', () => {
    it('skips when mode is not btw', async () => {
        const out = await runBtwOrchestrator({
            ...baseInput,
            mode: 'normal',
            lastBtwCallAt: null,
            lastBtwTier: 'basic',
            now: 5_000,
        });
        expect(out.fired).toBe(false);
        expect(out.hints).toEqual([]);
    });

    it('skips when assistant text is too short', async () => {
        const out = await runBtwOrchestrator({
            ...baseInput,
            assistantText: 'too short',
            mode: 'btw',
            lastBtwCallAt: null,
            lastBtwTier: 'basic',
            now: 5_000,
        });
        expect(out.fired).toBe(false);
    });

    it('skips within the debounce window', async () => {
        const out = await runBtwOrchestrator({
            ...baseInput,
            mode: 'btw',
            lastBtwCallAt: 1_000,
            lastBtwTier: 'basic',
            now: 2_000,
        });
        expect(out.fired).toBe(false);
    });

    it('skips when visibility is no-data', async () => {
        const out = await runBtwOrchestrator({
            ...baseInput,
            visibility: 'no-data',
            mode: 'btw',
            lastBtwCallAt: null,
            lastBtwTier: 'basic',
            now: 5_000,
        });
        expect(out.fired).toBe(false);
    });
});

describe('runBtwOrchestrator with analyzer + LLM', () => {
    it('produces analyzer hints even without aiService', async () => {
        const out = await runBtwOrchestrator({
            ...baseInput,
            recentResult: { columns: [{ name: 'x', type: 'INT' }], rows: [] },
            mode: 'btw',
            lastBtwCallAt: null,
            lastBtwTier: 'basic',
            now: 5_000,
        });
        expect(out.fired).toBe(true);
        expect(out.hints.length).toBeGreaterThan(0);
        expect(out.hints.some(h => h.source === 'analyzer')).toBe(true);
    });

    it('merges analyzer + LLM hints', async () => {
        const svc = mockServiceWithResponses([VALID_FENCE]);
        const out = await runBtwOrchestrator({
            ...baseInput,
            recentResult: { columns: [{ name: 'x', type: 'INT' }], rows: [] },
            aiService: svc as any,
            mode: 'btw',
            lastBtwCallAt: null,
            lastBtwTier: 'basic',
            now: 5_000,
        });
        expect(out.fired).toBe(true);
        expect(out.hints.some(h => h.source === 'analyzer')).toBe(true);
        expect(out.hints.some(h => h.source === 'llm')).toBe(true);
        expect(out.finalTier).toBe('basic');
    });

    it('escalates tier on LLM parse miss', async () => {
        const svc = mockServiceWithResponses(['no fence at all', VALID_FENCE]);
        const out = await runBtwOrchestrator({
            ...baseInput,
            aiService: svc as any,
            mode: 'btw',
            lastBtwCallAt: null,
            lastBtwTier: 'basic',
            now: 5_000,
        });
        expect(out.fired).toBe(true);
        expect(out.finalTier).toBe('advanced');
        expect(out.hints.some(h => h.text === 'LLM hint A')).toBe(true);
    });

    it('swallows LLM errors and still returns analyzer hints', async () => {
        const failingSvc = {
            streamChatWithTools: () => {
                throw new Error('boom');
            },
        };
        const out = await runBtwOrchestrator({
            ...baseInput,
            recentResult: { columns: [{ name: 'x', type: 'INT' }], rows: [] },
            aiService: failingSvc as any,
            mode: 'btw',
            lastBtwCallAt: null,
            lastBtwTier: 'basic',
            now: 5_000,
        });
        expect(out.fired).toBe(true);
        expect(out.hints.length).toBeGreaterThan(0); // analyzer survived
    });
});

describe('runBtwOrchestrator dedup', () => {
    it('filters out hints already in dedupStorage', async () => {
        const dedup = new MemoryStorage();
        // Seed dedup with the LLM hint text fingerprint.
        const svc = mockServiceWithResponses([VALID_FENCE, VALID_FENCE]);

        // First call: stores LLM hint into dedup.
        await runBtwOrchestrator({
            ...baseInput,
            aiService: svc as any,
            dedupStorage: dedup,
            mode: 'btw',
            lastBtwCallAt: null,
            lastBtwTier: 'basic',
            now: 5_000,
        });
        expect(dedup.store.size).toBeGreaterThan(0);

        // Second call (well past debounce): same hint should be filtered.
        const out2 = await runBtwOrchestrator({
            ...baseInput,
            aiService: svc as any,
            dedupStorage: dedup,
            mode: 'btw',
            lastBtwCallAt: 5_000,
            lastBtwTier: 'basic',
            now: 5_000 + 20_000,
        });
        expect(out2.fired).toBe(true);
        expect(out2.hints.every(h => h.text !== 'LLM hint A')).toBe(true);
    });
});
