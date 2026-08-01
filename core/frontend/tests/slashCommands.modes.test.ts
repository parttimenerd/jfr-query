import { describe, it, expect } from 'vitest';
import { parseSlashCommand, STATIC_COMMANDS, commandCompletions, buildAllCommands } from '../utils/slashCommands';

describe('parseSlashCommand — mode commands', () => {
    it('recognizes /normal', () => {
        expect(parseSlashCommand('/normal')).toEqual({ kind: 'mode', mode: 'normal' });
    });

    it('recognizes /plan', () => {
        expect(parseSlashCommand('/plan')).toEqual({ kind: 'mode', mode: 'plan' });
    });

    it('recognizes /btw', () => {
        expect(parseSlashCommand('/btw')).toEqual({ kind: 'mode', mode: 'btw' });
    });

    it('is case-insensitive', () => {
        expect(parseSlashCommand('/PLAN')).toEqual({ kind: 'mode', mode: 'plan' });
    });

    it('returns null for non-slash input', () => {
        expect(parseSlashCommand('plan')).toBeNull();
    });
});

describe('STATIC_COMMANDS includes mode commands', () => {
    it('exposes /normal /plan /btw in the static list', () => {
        expect(STATIC_COMMANDS).toContain('/normal');
        expect(STATIC_COMMANDS).toContain('/plan');
        expect(STATIC_COMMANDS).toContain('/btw');
    });
});

describe('commandCompletions includes mode commands', () => {
    it('suggests /plan when user types /pl', () => {
        const out = commandCompletions('/pl');
        expect(out).toContain('/plan');
    });

    it('suggests /btw when user types /b', () => {
        const out = commandCompletions('/b');
        expect(out).toContain('/btw');
    });

    it('suggests /normal when user types /n', () => {
        const out = commandCompletions('/n');
        expect(out).toContain('/normal');
    });
});

describe('/help text documents mode commands', () => {
    it('mentions /normal, /plan, and /btw so users can discover them', () => {
        const result = parseSlashCommand('/help');
        expect(result?.kind).toBe('help');
        if (result?.kind !== 'help') return;
        expect(result.text).toMatch(/\/normal/);
        expect(result.text).toMatch(/\/plan/);
        expect(result.text).toMatch(/\/btw/);
    });

    it('describes what plan mode and btw mode do', () => {
        const result = parseSlashCommand('/help');
        if (result?.kind !== 'help') throw new Error('expected help kind');
        // Each mode entry should explain its purpose, not just list the command name.
        expect(result.text.toLowerCase()).toMatch(/plan.+(propose|without modifying|structured)/);
        expect(result.text.toLowerCase()).toMatch(/btw.+(suggestion|by the way|hint)/);
    });
});

describe('mode commands ignore arguments', () => {
    it('/plan foo bar is still mode=plan (arguments are ignored)', () => {
        // The current implementation discards arg for mode commands. This pins
        // that contract so future refactors don't accidentally treat the rest
        // as a sub-command and bail to "unknown".
        expect(parseSlashCommand('/plan foo bar')).toEqual({ kind: 'mode', mode: 'plan' });
    });
});

describe('parseSlashCommand — utility commands', () => {
    it('recognizes /clear', () => {
        expect(parseSlashCommand('/clear')).toEqual({ kind: 'clear' });
    });

    it('recognizes /compact', () => {
        expect(parseSlashCommand('/compact')).toEqual({ kind: 'compact' });
    });

    it('recognizes /verbose', () => {
        expect(parseSlashCommand('/verbose')).toEqual({ kind: 'mode', mode: 'verbose' });
    });

    it('recognizes /skills', () => {
        expect(parseSlashCommand('/skills')).toEqual({ kind: 'skills-list' });
    });

    it('recognizes /model with no arg', () => {
        expect(parseSlashCommand('/model')).toEqual({ kind: 'model', query: '' });
    });

    it('recognizes /model with a name arg', () => {
        expect(parseSlashCommand('/model gpt-4o')).toEqual({ kind: 'model', query: 'gpt-4o' });
    });

    it('recognizes /provider with no arg', () => {
        expect(parseSlashCommand('/provider')).toEqual({ kind: 'provider', query: '' });
    });

    it('recognizes /provider with a name arg', () => {
        expect(parseSlashCommand('/provider openai')).toEqual({ kind: 'provider', query: 'openai' });
    });

    it('returns unknown for an unrecognized command with no skills', () => {
        expect(parseSlashCommand('/foobar')).toEqual({ kind: 'unknown', input: '/foobar' });
    });

    it('returns null for empty string', () => {
        expect(parseSlashCommand('')).toBeNull();
    });

    it('returns null for whitespace-only', () => {
        expect(parseSlashCommand('   ')).toBeNull();
    });
});

describe('parseSlashCommand — skill commands', () => {
    const skills = ['gc-analysis', 'memory-leaks'];

    it('activates a skill when name matches with no arg', () => {
        expect(parseSlashCommand('/gc-analysis', skills)).toEqual({
            kind: 'skill-activate',
            skillName: 'gc-analysis',
        });
    });

    it('deactivates a skill when "off" is the arg', () => {
        expect(parseSlashCommand('/gc-analysis off', skills)).toEqual({
            kind: 'skill-deactivate',
            skillName: 'gc-analysis',
        });
    });

    it('dispatches a sub-command with no trailing args', () => {
        expect(parseSlashCommand('/gc-analysis pauses', skills)).toEqual({
            kind: 'skill-sub',
            skillName: 'gc-analysis',
            subCommand: 'pauses',
            args: '',
        });
    });

    it('dispatches a sub-command with trailing args', () => {
        expect(parseSlashCommand('/gc-analysis report last 5', skills)).toEqual({
            kind: 'skill-sub',
            skillName: 'gc-analysis',
            subCommand: 'report',
            args: 'last 5',
        });
    });

    it('returns unknown when skill not in the provided list', () => {
        expect(parseSlashCommand('/gc-analysis', [])).toEqual({
            kind: 'unknown',
            input: '/gc-analysis',
        });
    });

    it('returns unknown when no skills list provided (default)', () => {
        expect(parseSlashCommand('/gc-analysis')).toEqual({
            kind: 'unknown',
            input: '/gc-analysis',
        });
    });
});

describe('buildAllCommands', () => {
    it('includes all static commands', () => {
        const all = buildAllCommands([]);
        for (const cmd of STATIC_COMMANDS) {
            expect(all).toContain(cmd);
        }
    });

    it('prepends / to skill names', () => {
        const all = buildAllCommands(['gc-analysis', 'memory-leaks']);
        expect(all).toContain('/gc-analysis');
        expect(all).toContain('/memory-leaks');
    });

    it('skill commands appear after static commands', () => {
        const all = buildAllCommands(['my-skill']);
        const staticCount = STATIC_COMMANDS.length;
        const skillIdx = all.indexOf('/my-skill');
        expect(skillIdx).toBeGreaterThanOrEqual(staticCount);
    });
});

describe('commandCompletions — prefix filtering', () => {
    it('returns all commands for "/"', () => {
        const all = commandCompletions('/');
        expect(all.length).toBeGreaterThanOrEqual(STATIC_COMMANDS.length);
    });

    it('filters by prefix case-insensitively', () => {
        const out = commandCompletions('/CL');
        expect(out).toContain('/clear');
    });

    it('returns empty array for non-slash input', () => {
        expect(commandCompletions('clear')).toEqual([]);
    });

    it('includes skill names in completions when provided', () => {
        const out = commandCompletions('/gc', ['gc-analysis']);
        expect(out).toContain('/gc-analysis');
    });

    it('does not include skill names not matching prefix', () => {
        const out = commandCompletions('/gc', ['memory-leaks']);
        expect(out).not.toContain('/memory-leaks');
    });
});
