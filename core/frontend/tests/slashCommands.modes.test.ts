import { describe, it, expect } from 'vitest';
import { parseSlashCommand, STATIC_COMMANDS, commandCompletions } from '../utils/slashCommands';

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
