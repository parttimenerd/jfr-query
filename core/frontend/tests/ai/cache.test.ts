import { describe, it, expect } from 'vitest';
import { LRUCache, fnv1aHash } from '../../components/editor/aiAutocomplete/cache';

describe('LRUCache', () => {
  it('hit/miss semantics', () => {
    const c = new LRUCache<string>(3);
    expect(c.get('a')).toBeUndefined();
    c.set('a', '1');
    expect(c.get('a')).toBe('1');
    expect(c.has('a')).toBe(true);
  });

  it('evicts oldest at max', () => {
    const c = new LRUCache<string>(3);
    c.set('a', '1');
    c.set('b', '2');
    c.set('c', '3');
    c.set('d', '4'); // evict 'a'
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe('2');
    expect(c.get('c')).toBe('3');
    expect(c.get('d')).toBe('4');
    expect(c.size).toBe(3);
  });

  it('promotes on get (LRU recency)', () => {
    const c = new LRUCache<string>(3);
    c.set('a', '1');
    c.set('b', '2');
    c.set('c', '3');
    c.get('a'); // promote 'a'
    c.set('d', '4'); // should evict 'b', not 'a'
    expect(c.get('a')).toBe('1');
    expect(c.get('b')).toBeUndefined();
  });

  it('size cap at 30', () => {
    const c = new LRUCache<string>(30);
    for (let i = 0; i < 60; i++) c.set('k' + i, String(i));
    expect(c.size).toBe(30);
    expect(c.get('k0')).toBeUndefined();
    expect(c.get('k59')).toBe('59');
  });

  it('re-setting an existing key updates the value and refreshes recency', () => {
    const c = new LRUCache<string>(2);
    c.set('a', '1');
    c.set('b', '2');
    c.set('a', '3'); // bump 'a' to MRU
    c.set('c', '4'); // should evict 'b'
    expect(c.get('a')).toBe('3');
    expect(c.get('b')).toBeUndefined();
  });
});

describe('fnv1aHash', () => {
  it('is deterministic', () => {
    expect(fnv1aHash('hello')).toBe(fnv1aHash('hello'));
  });
  it('differs for different inputs', () => {
    expect(fnv1aHash('hello')).not.toBe(fnv1aHash('world'));
  });
  it('handles empty string', () => {
    expect(typeof fnv1aHash('')).toBe('string');
  });
});
