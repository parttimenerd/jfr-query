import { describe, it, expect } from 'vitest';
import { normalizeChannelTitle, isAutoChannelLabel } from '../components/chat/channelTitle';

describe('normalizeChannelTitle', () => {
    it('returns null for empty / nullish input', () => {
        expect(normalizeChannelTitle('')).toBeNull();
        expect(normalizeChannelTitle(null)).toBeNull();
        expect(normalizeChannelTitle(undefined)).toBeNull();
    });

    it('trims surrounding whitespace', () => {
        expect(normalizeChannelTitle('   GC pauses   ')).toBe('GC pauses');
    });

    it('strips surrounding straight quotes', () => {
        expect(normalizeChannelTitle('"GC pauses"')).toBe('GC pauses');
        expect(normalizeChannelTitle("'GC pauses'")).toBe('GC pauses');
        expect(normalizeChannelTitle('`GC pauses`')).toBe('GC pauses');
    });

    it('strips surrounding curly quotes', () => {
        expect(normalizeChannelTitle('“GC pauses”')).toBe('GC pauses');
        expect(normalizeChannelTitle('‘GC pauses’')).toBe('GC pauses');
    });

    it('strips trailing punctuation', () => {
        expect(normalizeChannelTitle('GC pauses.')).toBe('GC pauses');
        expect(normalizeChannelTitle('Title!?')).toBe('Title');
    });

    it('takes only the first non-empty line if multi-line', () => {
        expect(normalizeChannelTitle('Title\nSome other text\nmore')).toBe('Title');
        expect(normalizeChannelTitle('\n\nReal title\nnoise')).toBe('Real title');
    });

    it('caps the title at 40 characters', () => {
        const long = 'a'.repeat(100);
        const out = normalizeChannelTitle(long)!;
        expect(out.length).toBeLessThanOrEqual(40);
    });

    it('returns null if only quotes/whitespace remain', () => {
        expect(normalizeChannelTitle('""')).toBeNull();
        expect(normalizeChannelTitle('   .  ')).toBeNull();
    });
});

describe('isAutoChannelLabel', () => {
    it('matches "Main"', () => {
        expect(isAutoChannelLabel('Main')).toBe(true);
    });

    it('matches "Channel N"', () => {
        expect(isAutoChannelLabel('Channel 2')).toBe(true);
        expect(isAutoChannelLabel('Channel 99')).toBe(true);
    });

    it('does NOT match manually renamed labels', () => {
        expect(isAutoChannelLabel('GC pauses')).toBe(false);
        expect(isAutoChannelLabel('main')).toBe(false); // case-sensitive
        expect(isAutoChannelLabel('Channel')).toBe(false); // no number
        expect(isAutoChannelLabel('My Channel 1')).toBe(false);
    });

    it('returns false for empty', () => {
        expect(isAutoChannelLabel('')).toBe(false);
    });

    it('tolerates surrounding whitespace', () => {
        expect(isAutoChannelLabel('  Main  ')).toBe(true);
    });
});
