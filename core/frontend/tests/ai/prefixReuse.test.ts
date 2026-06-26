import { describe, it, expect } from 'vitest';
import { reuseCachedPrefix } from '../../components/editor/aiAutocomplete/cache';

describe('reuseCachedPrefix', () => {
  it('empty user-typed returns the full cached suggestion', () => {
    expect(reuseCachedPrefix('y: "cpu")', '')).toBe('y: "cpu")');
  });

  it('1-char extend that matches: returns the tail', () => {
    expect(reuseCachedPrefix('y: "cpu")', 'y')).toBe(': "cpu")');
  });

  it('multi-char extend (full prefix match): returns the tail', () => {
    expect(reuseCachedPrefix('y: "cpu")', 'y: "')).toBe('cpu")');
  });

  it('divergence at char 1 drops to null', () => {
    expect(reuseCachedPrefix('y: "cpu")', 'z')).toBeNull();
  });

  it('divergence mid-string drops to null', () => {
    expect(reuseCachedPrefix('y: "cpu")', 'y: "mem')).toBeNull();
  });

  it('user typed exactly equal to suggestion returns null (already past end)', () => {
    // userTypedSinceCache.length >= cachedSuggestion.length triggers the
    // length-equality guard — there is nothing left to suggest.
    expect(reuseCachedPrefix('abc', 'abc')).toBeNull();
  });

  it('user typed longer than suggestion returns null', () => {
    expect(reuseCachedPrefix('abc', 'abcdef')).toBeNull();
  });

  it('empty cached suggestion always returns null', () => {
    expect(reuseCachedPrefix('', '')).toBeNull();
    expect(reuseCachedPrefix('', 'a')).toBeNull();
  });

  it('case-sensitive: uppercase vs lowercase diverges', () => {
    expect(reuseCachedPrefix('CPU = 5', 'cpu')).toBeNull();
    expect(reuseCachedPrefix('CPU = 5', 'CPU')).toBe(' = 5');
  });

  it('multi-byte (UTF-16) characters: emoji prefix match', () => {
    const cached = '🚀 launch!';
    expect(reuseCachedPrefix(cached, '🚀')).toBe(' launch!');
  });

  it('whitespace-only prefix is treated literally', () => {
    expect(reuseCachedPrefix('  indent', ' ')).toBe(' indent');
    expect(reuseCachedPrefix(' single', '  ')).toBeNull();
  });

  it('returns the literal slice — no trimming or normalization', () => {
    expect(reuseCachedPrefix('hello world', 'h')).toBe('ello world');
    expect(reuseCachedPrefix('hello world', 'hello ')).toBe('world');
  });

  it('two-char-prefix-then-divergence drops', () => {
    expect(reuseCachedPrefix('color: red', 'col@')).toBeNull();
  });

  it('user typed includes a quote — boundary case for ghost text mid-string', () => {
    expect(reuseCachedPrefix('"cpu"', '"')).toBe('cpu"');
    expect(reuseCachedPrefix('"cpu"', '"c')).toBe('pu"');
  });

  it('single-char cached suggestion: empty typed returns it; one-char typed returns null', () => {
    expect(reuseCachedPrefix('X', '')).toBe('X');
    expect(reuseCachedPrefix('X', 'X')).toBeNull();
    expect(reuseCachedPrefix('X', 'Y')).toBeNull();
  });
});
