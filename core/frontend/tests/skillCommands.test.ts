import { describe, it, expect } from 'vitest';
import { parseSlashCommand, commandCompletions, buildAllCommands, STATIC_COMMANDS } from '../utils/slashCommands';

const SKILLS = ['gc-analysis', 'heap-allocation', 'jvm-threads', 'exceptions', 'flamegraph'];

describe('parseSlashCommand — static commands (unchanged)', () => {
    it('parses /clear', () => {
        expect(parseSlashCommand('/clear')).toEqual({ kind: 'clear' });
    });
    it('parses /compact', () => {
        expect(parseSlashCommand('/compact')).toEqual({ kind: 'compact' });
    });
    it('parses /model with no arg', () => {
        expect(parseSlashCommand('/model')).toEqual({ kind: 'model', query: '' });
    });
    it('parses /model with arg', () => {
        expect(parseSlashCommand('/model claude-3-5-sonnet')).toEqual({ kind: 'model', query: 'claude-3-5-sonnet' });
    });
    it('parses /help', () => {
        const result = parseSlashCommand('/help');
        expect(result?.kind).toBe('help');
        if (result?.kind === 'help') expect(result.text).toContain('/clear');
    });
    it('returns null for non-slash input', () => {
        expect(parseSlashCommand('hello')).toBeNull();
    });
});

describe('parseSlashCommand — /skills command', () => {
    it('returns skills-list for /skills', () => {
        expect(parseSlashCommand('/skills')).toEqual({ kind: 'skills-list' });
    });
    it('returns skills-list regardless of available skill names', () => {
        expect(parseSlashCommand('/skills', SKILLS)).toEqual({ kind: 'skills-list' });
    });
});

describe('parseSlashCommand — skill activation', () => {
    it('returns skill-activate for /gc-analysis when in availableSkillNames', () => {
        expect(parseSlashCommand('/gc-analysis', SKILLS)).toEqual({ kind: 'skill-activate', skillName: 'gc-analysis' });
    });
    it('returns unknown for /gc-analysis when NOT in availableSkillNames', () => {
        expect(parseSlashCommand('/gc-analysis', [])).toEqual({ kind: 'unknown', input: '/gc-analysis' });
        expect(parseSlashCommand('/gc-analysis')).toEqual({ kind: 'unknown', input: '/gc-analysis' });
    });
    it('returns skill-deactivate for /gc-analysis off', () => {
        expect(parseSlashCommand('/gc-analysis off', SKILLS)).toEqual({ kind: 'skill-deactivate', skillName: 'gc-analysis' });
    });
    it('returns skill-sub for /gc-analysis overview', () => {
        expect(parseSlashCommand('/gc-analysis overview', SKILLS)).toEqual({
            kind: 'skill-sub', skillName: 'gc-analysis', subCommand: 'overview', args: '',
        });
    });
    it('returns skill-sub for /gc-analysis pauses --top 10', () => {
        expect(parseSlashCommand('/gc-analysis pauses --top 10', SKILLS)).toEqual({
            kind: 'skill-sub', skillName: 'gc-analysis', subCommand: 'pauses', args: '--top 10',
        });
    });
    it('handles all skill names', () => {
        for (const skill of SKILLS) {
            const result = parseSlashCommand(`/${skill}`, SKILLS);
            expect(result?.kind).toBe('skill-activate');
            if (result?.kind === 'skill-activate') expect(result.skillName).toBe(skill);
        }
    });
    it('/clear is never treated as skill-activate even if listed', () => {
        const result = parseSlashCommand('/clear', [...SKILLS, 'clear']);
        expect(result?.kind).toBe('clear');
    });
    it('/help text includes /skills', () => {
        const result = parseSlashCommand('/help');
        if (result?.kind === 'help') {
            expect(result.text).toContain('/skills');
        }
    });
});

describe('commandCompletions — includes skill names', () => {
    it('returns skill completions for /gc prefix', () => {
        const suggestions = commandCompletions('/gc', SKILLS);
        expect(suggestions).toContain('/gc-analysis');
    });
    it('returns all completions for / prefix', () => {
        const suggestions = commandCompletions('/', SKILLS);
        expect(suggestions.length).toBeGreaterThanOrEqual(STATIC_COMMANDS.length + SKILLS.length);
    });
    it('does not include skill names for non-matching prefix', () => {
        const suggestions = commandCompletions('/clear', SKILLS);
        expect(suggestions).toContain('/clear');
        expect(suggestions).not.toContain('/gc-analysis');
    });
    it('returns empty array for non-slash input', () => {
        expect(commandCompletions('hello', SKILLS)).toEqual([]);
    });
    it('includes both static and skill names for /c prefix', () => {
        const suggestions = commandCompletions('/c', SKILLS);
        expect(suggestions).toContain('/clear');
        expect(suggestions).toContain('/compact');
    });
});

describe('buildAllCommands', () => {
    it('includes static commands', () => {
        const all = buildAllCommands(SKILLS);
        for (const cmd of STATIC_COMMANDS) {
            expect(all).toContain(cmd);
        }
    });
    it('includes skill names prefixed with /', () => {
        const all = buildAllCommands(SKILLS);
        for (const skill of SKILLS) {
            expect(all).toContain(`/${skill}`);
        }
    });
    it('returns only static commands when no skills', () => {
        const all = buildAllCommands([]);
        expect(all).toEqual([...STATIC_COMMANDS]);
    });
});
