import { describe, it, expect } from 'vitest';
import {
    mentionCandidates,
    detectMentionPrefix,
    filterMentions,
    applyMention,
} from '../components/chat/mentionCompletions';
import type { NotebookCellData } from '../types';

const cell = (over: Partial<NotebookCellData>): NotebookCellData => ({
    id: 'id-' + Math.random().toString(36).slice(2, 7),
    title: '',
    content: '',
    ...over,
});

describe('mentionCandidates', () => {
    it('returns [] for empty / nullish cells', () => {
        expect(mentionCandidates([])).toEqual([]);
        expect(mentionCandidates(null)).toEqual([]);
        expect(mentionCandidates(undefined)).toEqual([]);
    });

    it('prefers explicit `name` over title/heading', () => {
        const out = mentionCandidates([
            cell({ id: 'a', name: 'pauses', title: 'GC Pauses Over Time' }),
        ]);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ token: 'pauses', cellId: 'a' });
    });

    it('falls back to a slugified title', () => {
        const out = mentionCandidates([
            cell({ id: 'a', title: 'GC Pauses Over Time' }),
        ]);
        expect(out[0].token).toBe('gc-pauses-over-time');
    });

    it('falls back to first heading when no title', () => {
        const out = mentionCandidates([
            cell({ id: 'a', title: '', content: '## Heap allocation by class\nsome body' }),
        ]);
        expect(out[0].token).toBe('heap-allocation-by-class');
    });

    it('falls back to cell-N when nothing usable', () => {
        const out = mentionCandidates([
            cell({ id: 'a', title: '', content: 'no heading here' }),
            cell({ id: 'b', title: '', content: '' }),
        ]);
        expect(out[0].token).toBe('cell-1');
        expect(out[1].token).toBe('cell-2');
    });

    it('disambiguates duplicate tokens', () => {
        const out = mentionCandidates([
            cell({ id: 'a', name: 'pauses' }),
            cell({ id: 'b', name: 'pauses' }),
            cell({ id: 'c', name: 'pauses' }),
        ]);
        expect(out.map(o => o.token)).toEqual(['pauses', 'pauses-2', 'pauses-3']);
    });
});

describe('detectMentionPrefix', () => {
    it('returns null when there is no @ before the cursor', () => {
        expect(detectMentionPrefix('hello world', 5)).toBeNull();
        expect(detectMentionPrefix('', 0)).toBeNull();
    });

    it('detects an @ at the start of input', () => {
        expect(detectMentionPrefix('@gc', 3)).toEqual({ start: 0, query: 'gc' });
    });

    it('detects an @ right after whitespace', () => {
        expect(detectMentionPrefix('hey @pa', 7)).toEqual({ start: 4, query: 'pa' });
    });

    it('does NOT match when @ follows a word (e.g. email)', () => {
        expect(detectMentionPrefix('email@host', 10)).toBeNull();
    });

    it('returns empty query when cursor is just after the @', () => {
        expect(detectMentionPrefix('hi @', 4)).toEqual({ start: 3, query: '' });
    });

    it('supports hyphens inside the token', () => {
        expect(detectMentionPrefix('see @gc-pauses', 14)).toEqual({ start: 4, query: 'gc-pauses' });
    });

    it('returns null when cursor is in the middle of a non-mention word', () => {
        expect(detectMentionPrefix('hello world', 8)).toBeNull();
    });

    it('returns null when cursor is at position 0', () => {
        expect(detectMentionPrefix('@gc', 0)).toBeNull();
    });
});

describe('filterMentions', () => {
    const cands = [
        { token: 'pauses', label: 'GC Pauses', cellId: 'a' },
        { token: 'heap', label: 'Heap usage', cellId: 'b' },
        { token: 'pauses-2', label: 'Pauses copy', cellId: 'c' },
    ];

    it('returns all candidates for empty query', () => {
        expect(filterMentions(cands, '')).toEqual(cands);
        expect(filterMentions(cands, '   ')).toEqual(cands);
    });

    it('prefix-matches on token (case-insensitive)', () => {
        expect(filterMentions(cands, 'pa').map(c => c.token)).toEqual(['pauses', 'pauses-2']);
        expect(filterMentions(cands, 'PA').map(c => c.token)).toEqual(['pauses', 'pauses-2']);
    });

    it('prefix-matches on label too', () => {
        expect(filterMentions(cands, 'heap').map(c => c.token)).toEqual(['heap']);
        expect(filterMentions(cands, 'gc').map(c => c.token)).toEqual(['pauses']);
    });

    it('returns [] when no match', () => {
        expect(filterMentions(cands, 'zzz')).toEqual([]);
    });
});

describe('applyMention', () => {
    it('inserts @token + space, replacing the partial', () => {
        const out = applyMention('hi @pa', 3, 6, 'pauses');
        expect(out.value).toBe('hi @pauses ');
        expect(out.cursor).toBe('hi @pauses '.length);
    });

    it('keeps trailing text intact', () => {
        const out = applyMention('hi @pa more', 3, 6, 'pauses');
        expect(out.value).toBe('hi @pauses  more');
    });

    it('works at start of input', () => {
        const out = applyMention('@g', 0, 2, 'gc');
        expect(out.value).toBe('@gc ');
        expect(out.cursor).toBe(4);
    });
});
