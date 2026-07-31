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
