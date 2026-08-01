import { describe, it, expect } from 'vitest';
import {
    parseSlashCommand,
    commandCompletions,
    buildAllCommands,
    STATIC_COMMANDS,
} from '../utils/slashCommands';

// ─── parseSlashCommand ────────────────────────────────────────────────────────

describe('parseSlashCommand — non-command input', () => {
    it('returns null for plain text', () => {
        expect(parseSlashCommand('hello world')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseSlashCommand('')).toBeNull();
    });

    it('returns null for whitespace-only', () => {
        expect(parseSlashCommand('   ')).toBeNull();
    });
});

describe('parseSlashCommand — static commands', () => {
    it('parses /clear', () => {
        expect(parseSlashCommand('/clear')).toEqual({ kind: 'clear' });
    });

    it('parses /compact', () => {
        expect(parseSlashCommand('/compact')).toEqual({ kind: 'compact' });
    });

    it('parses /help with expected text', () => {
        const result = parseSlashCommand('/help');
        expect(result?.kind).toBe('help');
        expect((result as any).text).toContain('/clear');
        expect((result as any).text).toContain('/model');
    });

    it('parses /model with no arg', () => {
        expect(parseSlashCommand('/model')).toEqual({ kind: 'model', query: '' });
    });

    it('parses /model with arg', () => {
        expect(parseSlashCommand('/model gpt-4o')).toEqual({ kind: 'model', query: 'gpt-4o' });
    });

    it('parses /provider with arg', () => {
        expect(parseSlashCommand('/provider openai')).toEqual({ kind: 'provider', query: 'openai' });
    });

    it('parses /skills', () => {
        expect(parseSlashCommand('/skills')).toEqual({ kind: 'skills-list' });
    });
});

describe('parseSlashCommand — mode commands', () => {
    it.each(['normal', 'plan', 'btw', 'verbose'] as const)('parses /%s', (mode) => {
        expect(parseSlashCommand(`/${mode}`)).toEqual({ kind: 'mode', mode });
    });

    it('is case-insensitive', () => {
        expect(parseSlashCommand('/NORMAL')).toEqual({ kind: 'mode', mode: 'normal' });
        expect(parseSlashCommand('/Plan')).toEqual({ kind: 'mode', mode: 'plan' });
    });
});

describe('parseSlashCommand — unknown commands', () => {
    it('returns unknown for an unrecognized command with no skill list', () => {
        const result = parseSlashCommand('/xyz');
        expect(result?.kind).toBe('unknown');
        expect((result as any).input).toBe('/xyz');
    });

    it('returns unknown when skill list is provided but does not include the command', () => {
        const result = parseSlashCommand('/xyz', ['gc-analysis', 'heap']);
        expect(result?.kind).toBe('unknown');
    });
});

describe('parseSlashCommand — skill commands', () => {
    const skills = ['gc-analysis', 'heap-profile'];

    it('activates skill with no arg', () => {
        expect(parseSlashCommand('/gc-analysis', skills)).toEqual({
            kind: 'skill-activate',
            skillName: 'gc-analysis',
        });
    });

    it('deactivates skill with "off" arg', () => {
        expect(parseSlashCommand('/gc-analysis off', skills)).toEqual({
            kind: 'skill-deactivate',
            skillName: 'gc-analysis',
        });
    });

    it('dispatches sub-command with no extra args', () => {
        expect(parseSlashCommand('/gc-analysis pauses', skills)).toEqual({
            kind: 'skill-sub',
            skillName: 'gc-analysis',
            subCommand: 'pauses',
            args: '',
        });
    });

    it('dispatches sub-command with extra args', () => {
        expect(parseSlashCommand('/gc-analysis show last 10', skills)).toEqual({
            kind: 'skill-sub',
            skillName: 'gc-analysis',
            subCommand: 'show',
            args: 'last 10',
        });
    });

    it('handles hyphenated skill names', () => {
        expect(parseSlashCommand('/heap-profile', skills)).toEqual({
            kind: 'skill-activate',
            skillName: 'heap-profile',
        });
    });
});

describe('parseSlashCommand — whitespace handling', () => {
    it('trims leading/trailing whitespace before parsing', () => {
        expect(parseSlashCommand('  /clear  ')).toEqual({ kind: 'clear' });
    });

    it('treats /model with only spaces as empty query', () => {
        expect(parseSlashCommand('/model    ')).toEqual({ kind: 'model', query: '' });
    });
});

// ─── commandCompletions ───────────────────────────────────────────────────────

describe('commandCompletions', () => {
    it('returns all commands starting with "/" alone', () => {
        const results = commandCompletions('/', []);
        expect(results.length).toBeGreaterThan(0);
        for (const r of results) expect(r).toMatch(/^\//);
    });

    it('filters to matching prefix', () => {
        const results = commandCompletions('/cl', []);
        expect(results).toContain('/clear');
        expect(results).not.toContain('/help');
        expect(results).not.toContain('/model');
    });

    it('returns empty array for non-slash input', () => {
        expect(commandCompletions('clear', [])).toEqual([]);
    });

    it('includes skill names in completions', () => {
        const results = commandCompletions('/gc', ['gc-analysis', 'gc-roots']);
        expect(results).toContain('/gc-analysis');
        expect(results).toContain('/gc-roots');
    });

    it('is case-insensitive for prefix matching', () => {
        const results = commandCompletions('/CL', []);
        expect(results).toContain('/clear');
    });
});

// ─── buildAllCommands ─────────────────────────────────────────────────────────

describe('buildAllCommands', () => {
    it('includes all static commands', () => {
        const all = buildAllCommands([]);
        for (const cmd of STATIC_COMMANDS) expect(all).toContain(cmd);
    });

    it('prepends / to each skill name', () => {
        const all = buildAllCommands(['gc-analysis', 'heap']);
        expect(all).toContain('/gc-analysis');
        expect(all).toContain('/heap');
    });
});
