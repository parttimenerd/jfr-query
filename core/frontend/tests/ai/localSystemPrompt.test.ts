import { describe, it, expect } from 'vitest';
import { buildLocalSystemPrompt } from '../../services/ai/chatModes';

const schema = [
    { name: 'GarbageCollection', columns: [{ name: 'startTime' }, { name: 'duration' }, { name: 'gcId' }] },
    { name: 'ExecutionSample', columns: [{ name: 'stackTrace' }, { name: 'samples' }] },
];

const variables = { threshold: 20, maxRows: 100 };

describe('buildLocalSystemPrompt', () => {
    it('includes all table names from schema', () => {
        const prompt = buildLocalSystemPrompt(schema, variables);
        expect(prompt).toContain('GarbageCollection');
        expect(prompt).toContain('ExecutionSample');
    });

    it('includes column names', () => {
        const prompt = buildLocalSystemPrompt(schema, variables);
        expect(prompt).toContain('startTime');
        expect(prompt).toContain('stackTrace');
    });

    it('includes variable names', () => {
        const prompt = buildLocalSystemPrompt(schema, variables);
        expect(prompt).toContain('threshold');
        expect(prompt).toContain('maxRows');
    });

    it('includes :::cell fence syntax example', () => {
        const prompt = buildLocalSystemPrompt(schema, variables);
        expect(prompt).toContain(':::cell');
        expect(prompt).toContain(':::');
    });

    it('includes at least 2 few-shot Q&A examples', () => {
        const prompt = buildLocalSystemPrompt(schema, variables);
        const qCount = (prompt.match(/^Q:/gm) ?? []).length;
        expect(qCount).toBeGreaterThanOrEqual(2);
    });

    it('works with empty schema and variables', () => {
        const prompt = buildLocalSystemPrompt([], {});
        expect(prompt).toBeTruthy();
        expect(prompt).toContain(':::cell');
    });

    it('includes instruction to suggest next steps', () => {
        const prompt = buildLocalSystemPrompt(schema, variables);
        expect(prompt.toLowerCase()).toMatch(/suggest|next|follow/);
    });
});

describe('custom system prompt — ADDITIONAL INSTRUCTIONS injection pattern', () => {
    it('manual injection pattern: customPrompt is appended with header when truthy', () => {
        const baseInstruction = 'You are a DuckDB assistant.';
        const customPrompt = 'Talk like a pirate.';

        const finalCustomPrompt = customPrompt;
        let systemInstruction = baseInstruction;
        if (finalCustomPrompt) {
            systemInstruction += `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${finalCustomPrompt}`;
        }

        expect(systemInstruction).toContain('ADDITIONAL INSTRUCTIONS FROM USER');
        expect(systemInstruction).toContain('Talk like a pirate.');
        expect(systemInstruction).toContain('You are a DuckDB assistant.');
    });

    it('manual injection pattern: empty customPrompt is not appended', () => {
        const baseInstruction = 'You are a DuckDB assistant.';
        const finalCustomPrompt = '';
        let systemInstruction = baseInstruction;
        if (finalCustomPrompt) {
            systemInstruction += `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${finalCustomPrompt}`;
        }

        expect(systemInstruction).toBe(baseInstruction);
        expect(systemInstruction).not.toContain('ADDITIONAL INSTRUCTIONS');
    });

    it('manual injection pattern: override wins over global', () => {
        const globalPrompt = 'Talk like a pirate.';
        const overridePrompt = 'Be extremely concise.';
        const baseInstruction = 'You are a DuckDB assistant.';

        const finalCustomPrompt = overridePrompt ?? globalPrompt;
        let systemInstruction = baseInstruction;
        if (finalCustomPrompt) {
            systemInstruction += `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${finalCustomPrompt}`;
        }

        expect(systemInstruction).toContain('Be extremely concise.');
        expect(systemInstruction).not.toContain('Talk like a pirate.');
    });
});
