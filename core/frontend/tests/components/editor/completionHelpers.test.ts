import { describe, it, expect } from 'vitest';
import { wrap, truncate } from '../../../components/editor/sql/completion/helpers';

describe('wrap', () => {
    it('returns unquoted string for simple identifier', () => {
        expect(wrap('foo', false)).toBe('foo');
        expect(wrap('my_col', false)).toBe('my_col');
        expect(wrap('Col1', false)).toBe('Col1');
    });

    it('quotes string when it contains spaces', () => {
        expect(wrap('my col', false)).toBe('"my col"');
    });

    it('quotes string when it contains hyphens', () => {
        expect(wrap('my-col', false)).toBe('"my-col"');
    });

    it('quotes string when it starts with a digit', () => {
        expect(wrap('1col', false)).toBe('"1col"');
    });

    it('always quotes when force=true, even for simple identifiers', () => {
        expect(wrap('foo', true)).toBe('"foo"');
        expect(wrap('Col1', true)).toBe('"Col1"');
    });

    it('handles empty string', () => {
        expect(wrap('', false)).toBe('""');
        expect(wrap('', true)).toBe('""');
    });
});

describe('truncate', () => {
    it('returns string unchanged when under limit', () => {
        expect(truncate('hello', 10)).toBe('hello');
    });

    it('returns string unchanged when at exact limit', () => {
        expect(truncate('hello', 5)).toBe('hello');
    });

    it('truncates and appends ellipsis when over limit', () => {
        expect(truncate('hello world', 5)).toBe('hello…');
    });

    it('handles empty string', () => {
        expect(truncate('', 10)).toBe('');
    });

    it('handles limit of 0', () => {
        expect(truncate('hello', 0)).toBe('…');
    });
});
