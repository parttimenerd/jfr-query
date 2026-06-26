// W14 — Composite validation rules: x-axis compat for `+` overlay.

import { describe, it, expect } from 'vitest';
import { parseComposite, validateComposite } from '../utils/plotParser';

describe('validateComposite', () => {
    it('reports no issues for a non-composite plot', () => {
        const p = parseComposite('LINE_CHART(x: "ts", y: ["cpu"])');
        expect(validateComposite(p)).toEqual([]);
    });

    it('reports no issues for compatible `+` overlay', () => {
        const p = parseComposite('RANGE(x: "ts", low: "p25", high: "p75") + LINE_CHART(x: "ts", y: ["median"])');
        expect(validateComposite(p)).toEqual([]);
    });

    it('errors when overlay mixes categorical + continuous x', () => {
        const p = parseComposite('BAR_CHART(x: "host", y: ["count"]) + LINE_CHART(x: "host", y: ["lat"])');
        const issues = validateComposite(p);
        expect(issues.length).toBeGreaterThan(0);
        const err = issues.find(i => i.severity === 'error');
        expect(err).toBeDefined();
        expect(err!.message).toMatch(/categorical/i);
    });

    it('warns when overlay children use different x column names', () => {
        const p = parseComposite('LINE_CHART(x: "ts", y: ["a"]) + LINE_CHART(x: "timestamp", y: ["b"])');
        const issues = validateComposite(p);
        const warn = issues.find(i => i.severity === 'warn');
        expect(warn).toBeDefined();
        expect(warn!.message).toMatch(/differ/);
    });

    it('passes ROW/COL through without x-axis constraints', () => {
        const p = parseComposite('ROW(BAR_CHART(x: "host", y: ["count"]), LINE_CHART(x: "ts", y: ["cpu"]))');
        expect(validateComposite(p)).toEqual([]);
    });

    it('recurses into nested composites', () => {
        const p = parseComposite('ROW(LINE_CHART(x: "ts", y: ["a"]), BAR_CHART(x: "host", y: ["c"]) + LINE_CHART(x: "host", y: ["d"]))');
        const issues = validateComposite(p);
        const err = issues.find(i => i.severity === 'error');
        expect(err).toBeDefined();
    });
});
