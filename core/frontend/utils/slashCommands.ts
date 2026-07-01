/**
 * Slash command parser and registry shared by ChatPanel and InlineChat.
 *
 * Typing "/" at the start of the input activates command mode. Commands are
 * handled client-side before the message is sent to the AI.
 *
 * Skills are dynamic: pass `availableSkillNames` to enable `/skill-name` dispatch.
 * Skills can also reference templates via `/skill-name [sub-command]`.
 */

export type SlashCommandResult =
    | { kind: 'clear' }
    | { kind: 'compact' }
    | { kind: 'help'; text: string }
    | { kind: 'model'; query: string }
    | { kind: 'provider'; query: string }
    | { kind: 'mode'; mode: 'normal' | 'plan' | 'btw' }
    | { kind: 'skill-activate'; skillName: string }
    | { kind: 'skill-deactivate'; skillName: string }
    | { kind: 'skill-sub'; skillName: string; subCommand: string; args: string }
    | { kind: 'skills-list' }
    | { kind: 'unknown'; input: string };

/** Returns a parsed command or null if the input isn't a slash command. */
export function parseSlashCommand(input: string, availableSkillNames?: string[]): SlashCommandResult | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return null;

    const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
    const arg = rest.join(' ');
    const cmdLower = cmd.toLowerCase();

    switch (cmdLower) {
        case 'clear':
            return { kind: 'clear' };
        case 'compact':
            return { kind: 'compact' };
        case 'help':
            return {
                kind: 'help',
                text: [
                    '### Available commands',
                    '- `/clear` — erase all messages in this chat',
                    '- `/compact` — summarise and compress the conversation history',
                    '- `/model [name]` — show or switch the current model',
                    '- `/provider [name]` — show or switch the AI provider',
                    '- `/normal` — chat in normal mode (default)',
                    '- `/plan` — propose changes as a structured plan without modifying the notebook',
                    '- `/btw` — receive "by the way" suggestion cards after each reply',
                    '- `/skills` — list all available skills',
                    '- `/skill-name` — activate a skill (e.g. `/gc-analysis`)',
                    '- `/skill-name off` — deactivate a skill',
                    '- `/skill-name [sub-command]` — run a skill sub-command (e.g. `/gc-analysis pauses`)',
                    '- `/help` — show this message',
                    '',
                    '### Troubleshooting',
                    '- **Chart is blank?** Run the SQL query first. Check the column names match your results.',
                    '- **"Undefined variable" error?** Define the variable in the cell\'s Variables block or in Notebook Settings.',
                    '- **Plot config error?** Start with `TABLE()` to see your data, then build the config from there.',
                    '- **AI not responding?** Check your API key in ⚙ Settings. Use `/provider` to switch providers.',
                    '- **What plot types are available?** Ask me: "what plot types can I use?" or click the 📈 chart icon.',
                ].join('\n'),
            };
        case 'model':
            return { kind: 'model', query: arg };
        case 'provider':
            return { kind: 'provider', query: arg };
        case 'normal':
        case 'plan':
        case 'btw':
            return { kind: 'mode', mode: cmdLower as 'normal' | 'plan' | 'btw' };
        case 'skills':
            return { kind: 'skills-list' };
        default: {
            const skills = availableSkillNames ?? [];
            if (skills.includes(cmdLower)) {
                if (!arg) return { kind: 'skill-activate', skillName: cmdLower };
                if (arg.trim() === 'off') return { kind: 'skill-deactivate', skillName: cmdLower };
                const [subCmd, ...subRest] = arg.trim().split(/\s+/);
                return { kind: 'skill-sub', skillName: cmdLower, subCommand: subCmd, args: subRest.join(' ') };
            }
            return { kind: 'unknown', input: trimmed };
        }
    }
}

/** All static commands (no skill names — those are dynamic). */
export const STATIC_COMMANDS = ['/help', '/clear', '/compact', '/model', '/provider', '/normal', '/plan', '/btw', '/skills'] as const;

/** Build the complete command list including dynamic skill names. */
export function buildAllCommands(skillNames: string[]): string[] {
    return [...STATIC_COMMANDS, ...skillNames.map(n => `/${n}`)];
}

/** Autocomplete: returns the list of commands that start with the typed prefix. */
export const ALL_COMMANDS = STATIC_COMMANDS;

export function commandCompletions(input: string, availableSkillNames?: string[]): string[] {
    if (!input.startsWith('/')) return [];
    const all = buildAllCommands(availableSkillNames ?? []);
    const lower = input.toLowerCase();
    return all.filter(c => c.startsWith(lower));
}
