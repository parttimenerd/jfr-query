import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isInSqlComment,
  currentWordLengthBack,
  shouldFire,
  debounceMsFor,
  Debouncer,
  SQL_DEBOUNCE_MS,
  MD_DEBOUNCE_MS,
} from '../../components/editor/aiAutocomplete/triggers';

describe('currentWordLengthBack', () => {
  it('counts trailing word chars', () => {
    expect(currentWordLengthBack('SELECT abc')).toBe(3);
    expect(currentWordLengthBack('SELECT ')).toBe(0);
    expect(currentWordLengthBack('')).toBe(0);
    expect(currentWordLengthBack('count_dist')).toBe(10);
  });
  it('stops at non-word chars', () => {
    expect(currentWordLengthBack('SELECT *')).toBe(0);
    expect(currentWordLengthBack('SELECT foo.bar')).toBe(3);
  });
});

describe('isInSqlComment', () => {
  it('detects line comment', () => {
    expect(isInSqlComment('-- this is a comment')).toBe(true);
    expect(isInSqlComment('SELECT 1\n-- next ')).toBe(true);
  });
  it('does not flag -- inside a string literal', () => {
    expect(isInSqlComment("SELECT '--not a comment' ")).toBe(false);
  });
  it('detects open block comment', () => {
    expect(isInSqlComment('SELECT /* block ')).toBe(true);
  });
  it('returns false after block close', () => {
    expect(isInSqlComment('SELECT /* x */ 1')).toBe(false);
  });
  it('returns false for plain SQL', () => {
    expect(isInSqlComment('SELECT * FROM ActiveRecording r')).toBe(false);
  });
});

describe('shouldFire', () => {
  it('fires on >=3 chars in SQL', () => {
    expect(shouldFire({ mode: 'sql', upToCursor: 'SELECT abc', escapeSuppressed: false })).toBe(true);
  });
  it('does not fire on <3 chars in SQL', () => {
    expect(shouldFire({ mode: 'sql', upToCursor: 'SELECT ab', escapeSuppressed: false })).toBe(false);
  });
  it('fires inside a -- comment regardless of word length', () => {
    expect(shouldFire({ mode: 'sql', upToCursor: '-- hi', escapeSuppressed: false })).toBe(true);
    expect(shouldFire({ mode: 'sql', upToCursor: '-- ', escapeSuppressed: false })).toBe(true);
  });
  it('markdown requires 5 chars', () => {
    expect(shouldFire({ mode: 'markdown', upToCursor: '## hello world', escapeSuppressed: false })).toBe(true);
    expect(shouldFire({ mode: 'markdown', upToCursor: '## hi', escapeSuppressed: false })).toBe(false);
    expect(shouldFire({ mode: 'markdown', upToCursor: '## abcd', escapeSuppressed: false })).toBe(false);
    expect(shouldFire({ mode: 'markdown', upToCursor: '## abcde', escapeSuppressed: false })).toBe(true);
  });
  it('escape suppression blocks firing', () => {
    expect(shouldFire({ mode: 'sql', upToCursor: 'SELECT abc', escapeSuppressed: true })).toBe(false);
    expect(shouldFire({ mode: 'sql', upToCursor: '-- hi', escapeSuppressed: true })).toBe(false);
  });
});

describe('debounceMsFor', () => {
  it('sql=200ms, markdown=400ms', () => {
    expect(debounceMsFor('sql')).toBe(SQL_DEBOUNCE_MS);
    expect(debounceMsFor('plot')).toBe(SQL_DEBOUNCE_MS);
    expect(debounceMsFor('markdown')).toBe(MD_DEBOUNCE_MS);
  });
});

describe('Debouncer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires after >=200ms idle in SQL mode', () => {
    const d = new Debouncer();
    const fn = vi.fn();
    d.schedule(fn, 200);
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not fire if cancelled', () => {
    const d = new Debouncer();
    const fn = vi.fn();
    d.schedule(fn, 200);
    vi.advanceTimersByTime(100);
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });

  it('rescheduling resets the timer (idle behavior)', () => {
    const d = new Debouncer();
    const fn = vi.fn();
    d.schedule(fn, 200);
    vi.advanceTimersByTime(100);
    d.schedule(fn, 200); // reset
    vi.advanceTimersByTime(150);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('markdown 400ms threshold', () => {
    const d = new Debouncer();
    const fn = vi.fn();
    d.schedule(fn, MD_DEBOUNCE_MS);
    vi.advanceTimersByTime(399);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
