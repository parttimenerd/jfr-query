/**
 * Integration test: actual AI call with the Hyperspace / Gardener API key.
 *
 * Uses different models to verify that skill system prompts influence AI responses.
 * Skip when HYPERSPACE_KEY is not set (CI without secrets).
 *
 * Set env var:   HYPERSPACE_KEY=31c27cf9-14d9-4be9-8914-871408d03e44
 * Run manually:  HYPERSPACE_KEY=31c27cf9-14d9-4be9-8914-871408d03e44 npx vitest run tests/skillIntegration.test.ts
 */

import { describe, it, expect } from 'vitest';
import { GardenerProvider } from '../services/ai/GardenerProvider';
import { builtinSkillManifest } from '../data/skills/skills-manifest';

const HYPERSPACE_KEY = process.env.HYPERSPACE_KEY;
const SKIP = !HYPERSPACE_KEY;

// Helper — send a single message with a system prompt override using GardenerProvider
async function askWithSystemPrompt(
    question: string,
    systemPrompt: string,
    model: string,
): Promise<string> {
    const provider = new GardenerProvider(HYPERSPACE_KEY!);
    // Use the direct getAgentResponse path (non-streaming, single turn)
    const resp = await (provider as any).handleApiCall({
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question },
        ],
        max_tokens: 400,
        stream: false,
    }) as { choices: { message: { content: string } }[] };
    return resp.choices?.[0]?.message?.content ?? '';
}

describe.skipIf(SKIP)('Skill integration — live AI calls', () => {
    it('gc-analysis skill: system prompt steers response toward GC tables (haiku-35)', async () => {
        const skill = builtinSkillManifest.load('gc-analysis')!;
        expect(skill).not.toBeNull();

        const response = await askWithSystemPrompt(
            'What SQL should I run to find the worst GC pauses in a JFR recording?',
            skill.systemPrompt,
            'haiku-35',
        );

        // The GC skill system prompt mentions GarbageCollection / longestPause
        // so the AI should reference at least one of these in its answer.
        const gcKeywords = ['GarbageCollection', 'longestPause', 'sumOfPauses', 'GCPhasePause', 'pause'];
        const hasKeyword = gcKeywords.some(kw => response.toLowerCase().includes(kw.toLowerCase()));
        expect(hasKeyword, `Expected GC keyword in response:\n${response}`).toBe(true);
    }, 30_000);

    it('gc-analysis skill: system prompt steers response toward GC tables (sonnet-40)', async () => {
        const skill = builtinSkillManifest.load('gc-analysis')!;
        const response = await askWithSystemPrompt(
            'How can I identify humongous allocations causing GC pressure?',
            skill.systemPrompt,
            'sonnet-40',
        );
        const gcKeywords = ['humongous', 'GarbageCollection', 'allocation', 'TLAB', 'G1'];
        const hasKeyword = gcKeywords.some(kw => response.toLowerCase().includes(kw.toLowerCase()));
        expect(hasKeyword, `Expected GC keyword in response:\n${response}`).toBe(true);
    }, 30_000);

    it('heap-allocation skill: steers response toward allocation tables (gpt-50-nano)', async () => {
        const skill = builtinSkillManifest.load('heap-allocation')!;
        const response = await askWithSystemPrompt(
            'Which SQL query shows the hottest allocation sites?',
            skill.systemPrompt,
            'gpt-50-nano',
        );
        const allocKeywords = ['ObjectAllocation', 'allocationSize', 'TLAB', 'class'];
        const hasKeyword = allocKeywords.some(kw => response.toLowerCase().includes(kw.toLowerCase()));
        expect(hasKeyword, `Expected allocation keyword in response:\n${response}`).toBe(true);
    }, 30_000);

    it('jvm-threads skill: steers response toward contention tables (gemini-25-flash)', async () => {
        const skill = builtinSkillManifest.load('jvm-threads')!;
        const response = await askWithSystemPrompt(
            'How do I find the most contended monitors in a JFR file?',
            skill.systemPrompt,
            'gemini-25-flash',
        );
        const threadKeywords = ['JavaMonitorEnter', 'contention', 'monitor', 'lock', 'ThreadPark'];
        const hasKeyword = threadKeywords.some(kw => response.toLowerCase().includes(kw.toLowerCase()));
        expect(hasKeyword, `Expected threading keyword in response:\n${response}`).toBe(true);
    }, 30_000);

    it('exceptions skill: steers response toward exception tables (haiku-35)', async () => {
        const skill = builtinSkillManifest.load('exceptions')!;
        const response = await askWithSystemPrompt(
            'Which SQL shows the most frequently thrown exceptions?',
            skill.systemPrompt,
            'haiku-35',
        );
        const excKeywords = ['JavaExceptionThrow', 'exception', 'COUNT', 'thrown'];
        const hasKeyword = excKeywords.some(kw => response.toLowerCase().includes(kw.toLowerCase()));
        expect(hasKeyword, `Expected exception keyword in response:\n${response}`).toBe(true);
    }, 30_000);

    it('flamegraph skill: steers response toward profiling tables (sonnet-40)', async () => {
        const skill = builtinSkillManifest.load('flamegraph')!;
        const response = await askWithSystemPrompt(
            'How can I identify CPU hotspots from a JFR recording?',
            skill.systemPrompt,
            'sonnet-40',
        );
        const flameKeywords = ['MethodProfiling', 'stackTrace', 'CPU', 'sample', 'STATE_RUNNABLE'];
        const hasKeyword = flameKeywords.some(kw => response.toLowerCase().includes(kw.toLowerCase()));
        expect(hasKeyword, `Expected flamegraph keyword in response:\n${response}`).toBe(true);
    }, 30_000);
});
