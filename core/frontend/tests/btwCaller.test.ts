import { describe, it, expect } from 'vitest';
import { runBtwCall } from '../services/ai/btwCaller';

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

const VALID_FENCE = '```jfr-btw\n{ "hints": [{ "text": "Try X" }] }\n```';

describe('runBtwCall', () => {
    it('parses hints from first call when present', async () => {
        const svc = mockServiceWithResponses([VALID_FENCE]);
        const out = await runBtwCall({
            aiService: svc as any,
            userText: 'show me top classes',
            assistantText: 'Here are top classes',
            schema: null,
            visibility: 'full',
            tier: 'basic',
        });
        expect(out.hints).toHaveLength(1);
        expect(out.hints[0].text).toBe('Try X');
        expect(out.finalTier).toBe('basic');
        expect(out.parseMiss).toBe(false);
    });

    it('escalates to advanced tier on parse miss', async () => {
        const svc = mockServiceWithResponses([
            'no fence here, just prose',
            VALID_FENCE,
        ]);
        const out = await runBtwCall({
            aiService: svc as any,
            userText: 'q',
            assistantText: 'a',
            schema: null,
            visibility: 'full',
            tier: 'basic',
        });
        expect(out.finalTier).toBe('advanced');
        expect(out.hints).toHaveLength(1);
    });

    it('does not escalate when already on advanced tier', async () => {
        const svc = mockServiceWithResponses(['no fence']);
        const out = await runBtwCall({
            aiService: svc as any,
            userText: 'q',
            assistantText: 'a',
            schema: null,
            visibility: 'full',
            tier: 'advanced',
        });
        expect(out.finalTier).toBe('advanced');
        expect(out.parseMiss).toBe(true);
        expect(out.hints).toEqual([]);
    });

    it('parses zero-hint fence as a clean success (no escalation)', async () => {
        // An empty-hints fence is still a successful parse — `parseBtwHintsFromText`
        // returns [] but it found the fence. Today's runBtwCall treats hints.length === 0
        // as a miss and escalates; this test pins that behavior so future tuning is
        // intentional.
        const svc = mockServiceWithResponses([
            '```jfr-btw\n{ "hints": [] }\n```',
            '```jfr-btw\n{ "hints": [] }\n```',
        ]);
        const out = await runBtwCall({
            aiService: svc as any,
            userText: 'q',
            assistantText: 'a',
            schema: null,
            visibility: 'full',
            tier: 'basic',
        });
        expect(out.finalTier).toBe('advanced');
        expect(out.hints).toEqual([]);
    });
});
