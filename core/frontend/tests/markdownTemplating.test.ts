import { describe, it, expect } from 'vitest';
import { findExprRegions, findIfRegions } from '../components/editor/markdownTemplating';

describe('findExprRegions', () => {
    it('returns empty for plain prose', () => {
        expect(findExprRegions('no expressions here')).toEqual([]);
    });

    it('finds a single closed expression', () => {
        const r = findExprRegions('total ${SELECT count(*) FROM t} rows');
        expect(r).toHaveLength(1);
        expect(r[0].closed).toBe(true);
        expect(r[0].exprStart).toBe(6);
        expect(r[0].sqlStart).toBe(8);
    });

    it('marks unclosed expression', () => {
        const r = findExprRegions('oops ${SELECT 1');
        expect(r).toHaveLength(1);
        expect(r[0].closed).toBe(false);
    });

    it('skips expressions inside a code span', () => {
        const r = findExprRegions('see `${SELECT 1}` in prose');
        expect(r).toHaveLength(0);
    });

    it('finds multiple expressions', () => {
        const r = findExprRegions('${SELECT 1} and ${SELECT 2}');
        expect(r).toHaveLength(2);
    });
});

describe('findIfRegions', () => {
    it('finds a closed {if …} block', () => {
        const md = '```{if SELECT 1}\nbody\n```';
        const r = findIfRegions(md);
        expect(r).toHaveLength(1);
        expect(r[0].closed).toBe(true);
    });

    it('marks unclosed {if} as not closed', () => {
        const md = '```{if SELECT 1}\nbody\nno close';
        const r = findIfRegions(md);
        expect(r).toHaveLength(1);
        expect(r[0].closed).toBe(false);
    });

    it('marks malformed header (no `}`) as not closed', () => {
        const md = '```{if SELECT 1\nbody';
        const r = findIfRegions(md);
        expect(r).toHaveLength(1);
        expect(r[0].closed).toBe(false);
    });
});
