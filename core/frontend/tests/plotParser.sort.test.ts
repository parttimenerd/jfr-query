import { describe, it, expect } from 'vitest';
import { parsePlotCall } from '../utils/plotParser';

describe('parsePlotCall — SORT $colVar $dirVar clause', () => {
    it('parses SORT $sortCol $sortDir', () => {
        const p = parsePlotCall('TABLE() SORT $sortCol $sortDir');
        expect(p.sort).toEqual({ colVar: '$sortCol', dirVar: '$sortDir' });
        expect(p.mainConfig).toBe('TABLE()');
    });

    it('parses SORT with underscores in var names', () => {
        expect(parsePlotCall('TABLE() SORT $sort_col $sort_dir').sort)
            .toEqual({ colVar: '$sort_col', dirVar: '$sort_dir' });
    });

    it('is case-insensitive', () => {
        expect(parsePlotCall('TABLE() sort $a $b').sort)
            .toEqual({ colVar: '$a', dirVar: '$b' });
    });

    it('combines with TITLE', () => {
        const p = parsePlotCall('TABLE() TITLE "GC Pauses" SORT $sortCol $sortDir');
        expect(p.title).toBe('GC Pauses');
        expect(p.sort).toEqual({ colVar: '$sortCol', dirVar: '$sortDir' });
    });

    it('does not parse bare SORT without two $vars', () => {
        expect(parsePlotCall('TABLE() SORT $col').sort).toBeUndefined();
    });

    it('requires both vars to be dollar-prefixed', () => {
        expect(parsePlotCall('TABLE() SORT $col dir').sort).toBeUndefined();
    });
});

describe('parsePlotCall — LIMIT clause', () => {
    it('parses LIMIT 20', () => {
        expect(parsePlotCall('TABLE() LIMIT 20').limit).toBe(20);
    });

    it('parses LIMIT with SORT', () => {
        const p = parsePlotCall('TABLE() SORT $col $dir LIMIT 10');
        expect(p.sort).toEqual({ colVar: '$col', dirVar: '$dir' });
        expect(p.limit).toBe(10);
    });

    it('parses LIMIT on BAR_CHART', () => {
        expect(parsePlotCall('BAR_CHART(x:"cause", y:["cnt"]) LIMIT 5').limit).toBe(5);
    });

    it('does not accept non-integer LIMIT (decimal)', () => {
        expect(parsePlotCall('TABLE() LIMIT 3.5').limit).toBeUndefined();
    });
});

describe('parsePlotCall — BAR_CHART SORT ASC/DESC clause', () => {
    it('parses SORT DESC', () => {
        expect(parsePlotCall('BAR_CHART(x:"cause",y:["cnt"]) SORT DESC').barSort).toBe('desc');
    });

    it('parses SORT ASC', () => {
        expect(parsePlotCall('BAR_CHART(x:"cause",y:["cnt"]) SORT ASC').barSort).toBe('asc');
    });

    it('is case-insensitive for SORT ASC/DESC', () => {
        expect(parsePlotCall('BAR_CHART(x:"c",y:["v"]) sort asc').barSort).toBe('asc');
    });

    it('combines SORT DESC with LIMIT', () => {
        const p = parsePlotCall('BAR_CHART(x:"cause",y:["cnt"]) SORT DESC LIMIT 5');
        expect(p.barSort).toBe('desc');
        expect(p.limit).toBe(5);
    });

    it('SORT ASC/DESC does not set sort.colVar/dirVar', () => {
        const p = parsePlotCall('BAR_CHART(x:"c",y:["v"]) SORT DESC');
        expect(p.barSort).toBe('desc');
        expect(p.sort).toBeUndefined();
    });
});
