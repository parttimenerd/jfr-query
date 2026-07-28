// Helpers for `@cell-name` autocomplete in the chat input. Mirrors the
// slash-command autocomplete in utils/slashCommands.ts: a pure helper that
// the textarea handler calls on each keystroke to decide whether a popup
// should appear and which entries to show.

import type { NotebookCellData } from '../../types';

export interface MentionCandidate {
    /** Token the user inserts (without the leading `@`). */
    token: string;
    /** Human-readable label shown in the popup; usually the cell title. */
    label: string;
    /** The underlying cell id, for callers that want to navigate. */
    cellId: string;
}

const MAX_TOKEN = 40;

function slugify(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_TOKEN);
}

/**
 * Build mention candidates from notebook cells. Prefers an explicit `name`
 * (set via the `<!-- @cell name=... -->` directive), else a slugified title,
 * else the first markdown heading, else `cell-<N>`. Duplicate tokens are
 * disambiguated by appending `-2`, `-3`, ...
 */
export function mentionCandidates(cells: NotebookCellData[] | undefined | null): MentionCandidate[] {
    if (!cells || cells.length === 0) return [];
    const seen = new Map<string, number>();
    const assigned = new Set<string>();
    const out: MentionCandidate[] = [];
    cells.forEach((c, idx) => {
        const heading = c.content.match(/^##?\s+(.+)/m)?.[1]?.trim();
        const labelSource = c.title?.trim() || heading || `cell-${idx + 1}`;
        const rawToken = c.name?.trim() || slugify(labelSource) || `cell-${idx + 1}`;
        const baseToken = rawToken || `cell-${idx + 1}`;
        const count = seen.get(baseToken) ?? 0;
        let token = count === 0 ? baseToken : `${baseToken}-${count + 1}`;
        // Guard against suffix collision with another cell's explicit name.
        let n = count + 1;
        while (assigned.has(token)) { n++; token = `${baseToken}-${n}`; }
        seen.set(baseToken, n);
        assigned.add(token);
        out.push({ token, label: labelSource, cellId: c.id });
    });
    return out;
}

/**
 * Detect whether the cursor is currently on an `@word` token. Returns the
 * start index of the `@` plus the query characters typed after it, or null
 * if the cursor is not inside a mention. A mention only starts at the very
 * beginning of input or right after whitespace — `email@host` should NOT
 * trigger.
 */
export function detectMentionPrefix(input: string, cursor: number): { start: number; query: string } | null {
    if (cursor < 1 || cursor > input.length) return null;
    // Walk backwards from the cursor over token characters (word chars + `-`).
    let i = cursor;
    while (i > 0 && /[\w-]/.test(input[i - 1])) i--;
    // Need an `@` immediately before the run.
    if (i === 0 || input[i - 1] !== '@') return null;
    const atIndex = i - 1;
    // The character before the `@` must be a word boundary (start-of-input
    // or whitespace) — prevents `email@host` from triggering.
    if (atIndex > 0 && !/\s/.test(input[atIndex - 1])) return null;
    const query = input.slice(i, cursor);
    return { start: atIndex, query };
}

/** Case-insensitive prefix match on token or label. */
export function filterMentions(candidates: MentionCandidate[], query: string): MentionCandidate[] {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(c =>
        c.token.toLowerCase().startsWith(q) || c.label.toLowerCase().startsWith(q)
    );
}

/**
 * Replace the partial `@query` (starting at `mentionStart`) with the chosen
 * `@token` and a trailing space. Returns the new input and the cursor
 * position after the inserted token.
 */
export function applyMention(input: string, mentionStart: number, cursor: number, token: string): { value: string; cursor: number } {
    const before = input.slice(0, mentionStart);
    const after = input.slice(cursor);
    const inserted = `@${token} `;
    return { value: before + inserted + after, cursor: before.length + inserted.length };
}
