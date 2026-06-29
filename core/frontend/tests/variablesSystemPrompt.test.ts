import { describe, it, expect } from 'vitest';
import { variablesSystemPromptLine } from '../components/chat/variablesSystemPrompt';

describe('variablesSystemPromptLine', () => {
    it('returns empty string when variables is undefined', () => {
        expect(variablesSystemPromptLine(undefined)).toBe('');
    });

    it('returns empty string when variables is an empty map', () => {
        expect(variablesSystemPromptLine({})).toBe('');
    });

    it('lists variable names with $ prefix', () => {
        const out = variablesSystemPromptLine({ threshold: '100', session_start: '2024-01-01' });
        expect(out).toContain('$threshold');
        expect(out).toContain('$session_start');
    });

    it('lists names in sorted order so output is deterministic', () => {
        const out = variablesSystemPromptLine({ zulu: 'z', alpha: 'a', mike: 'm' });
        expect(out.indexOf('$alpha')).toBeLessThan(out.indexOf('$mike'));
        expect(out.indexOf('$mike')).toBeLessThan(out.indexOf('$zulu'));
    });

    it('mentions all three variable tools so the AI knows the API', () => {
        const out = variablesSystemPromptLine({ x: '1' });
        expect(out).toContain('listVariables');
        expect(out).toContain('setVariable');
        expect(out).toContain('deleteVariable');
    });
});
