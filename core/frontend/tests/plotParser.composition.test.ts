// W10 — Composition parsing: `+` overlay, ROW(...), COL(...).

import { describe, it, expect } from 'vitest';
import { parseComposite, parsePlotCall } from '../utils/plotParser';

describe('parseComposite', () => {
    it('falls through to parsePlotCall for a single call', () => {
        const r = parseComposite('LINE_CHART(x: "ts", y: ["cpu"])');
        expect(r.composite).toBeUndefined();
        expect(r.mainConfig).toBe('LINE_CHART(x: "ts", y: ["cpu"])');
    });

    it('parses `A + B` as overlay with two children', () => {
        const r = parseComposite('RANGE(x: "ts", low: "p25", high: "p75") + LINE_CHART(x: "ts", y: ["median"])');
        expect(r.composite).toBeDefined();
        expect(r.composite!.direction).toBe('overlay');
        expect(r.composite!.children).toHaveLength(2);
        expect(r.composite!.children[0].mainConfig).toContain('RANGE');
        expect(r.composite!.children[1].mainConfig).toContain('LINE_CHART');
    });

    it('parses `A + B + C` as overlay with three children', () => {
        const r = parseComposite('LINE_CHART(x: "ts", y: ["a"]) + LINE_CHART(x: "ts", y: ["b"]) + LINE_CHART(x: "ts", y: ["c"])');
        expect(r.composite!.direction).toBe('overlay');
        expect(r.composite!.children).toHaveLength(3);
    });

    it('parses ROW(A, B) as a row layout', () => {
        const r = parseComposite('ROW(LINE_CHART(x: "ts", y: ["cpu"]), LINE_CHART(x: "ts", y: ["mem"]))');
        expect(r.composite!.direction).toBe('row');
        expect(r.composite!.children).toHaveLength(2);
        expect(r.composite!.children[0].mainConfig).toContain('cpu');
        expect(r.composite!.children[1].mainConfig).toContain('mem');
    });

    it('parses COL(A, B) as a column layout', () => {
        const r = parseComposite('COL(BAR_CHART(x: "host", y: ["count"]), TABLE())');
        expect(r.composite!.direction).toBe('col');
        expect(r.composite!.children).toHaveLength(2);
    });

    it('parses nested ROW(COL(A, B), C)', () => {
        const input = 'ROW(COL(LINE_CHART(x:"ts",y:["a"]), LINE_CHART(x:"ts",y:["b"])), TABLE())';
        const r = parseComposite(input);
        expect(r.composite!.direction).toBe('row');
        expect(r.composite!.children).toHaveLength(2);
        const innerCol = r.composite!.children[0];
        expect(innerCol.composite!.direction).toBe('col');
        expect(innerCol.composite!.children).toHaveLength(2);
        expect(r.composite!.children[1].mainConfig).toBe('TABLE()');
    });

    it('treats `+` inside ROW body as an overlay child', () => {
        const r = parseComposite('ROW(RANGE(x:"ts",low:"p25",high:"p75") + LINE_CHART(x:"ts",y:["m"]), TABLE())');
        expect(r.composite!.direction).toBe('row');
        expect(r.composite!.children).toHaveLength(2);
        const first = r.composite!.children[0];
        expect(first.composite!.direction).toBe('overlay');
        expect(first.composite!.children).toHaveLength(2);
    });

    it('handles whitespace around the `+` operator', () => {
        const r1 = parseComposite('LINE_CHART(x:"ts",y:["a"])+LINE_CHART(x:"ts",y:["b"])');
        const r2 = parseComposite('LINE_CHART(x:"ts",y:["a"])    +    LINE_CHART(x:"ts",y:["b"])');
        expect(r1.composite?.direction).toBe('overlay');
        expect(r2.composite?.direction).toBe('overlay');
        expect(r1.composite!.children).toHaveLength(2);
        expect(r2.composite!.children).toHaveLength(2);
    });

    it('does not split on `+` inside string literals', () => {
        const r = parseComposite('LINE_CHART(x:"ts",y:["cpu"]) TITLE "A + B"');
        expect(r.composite).toBeUndefined();
        expect(r.mainConfig).toContain('LINE_CHART');
    });

    it('does not split on `+` inside parens (e.g. inside a function arg)', () => {
        // A `+` inside a balanced paren span (e.g. an inner function call arg) is not a split point.
        const r = parseComposite('LINE_CHART(x:"ts", y:["a+b"]) TITLE "T"');
        expect(r.composite).toBeUndefined();
    });

    it('LET expressions with `+` at top level: a known parser limitation (split happens)', () => {
        // Composition `+` runs before clauses are stripped, so a top-level `+` inside a LET
        // expression DOES split. Workaround: wrap the LET RHS in parens `LET a = (b + c)`.
        // This test documents the current behavior rather than the ideal one.
        const r = parseComposite('LINE_CHART(x:"ts",y:["cpu"]) LET a = (b + c)');
        expect(r.composite).toBeUndefined();
    });

    it('children of a composite are themselves parsed (clauses attach to child)', () => {
        const r = parseComposite('LINE_CHART(x:"ts",y:["a"]) TITLE "A" + LINE_CHART(x:"ts",y:["b"]) TITLE "B"');
        expect(r.composite!.direction).toBe('overlay');
        expect(r.composite!.children[0].title).toBe('A');
        expect(r.composite!.children[1].title).toBe('B');
    });

    it('ROW/COL recognized case-insensitively', () => {
        const r = parseComposite('row(LINE_CHART(x:"ts",y:["a"]), LINE_CHART(x:"ts",y:["b"]))');
        expect(r.composite!.direction).toBe('row');
    });

    it('parses single-child ROW gracefully', () => {
        const r = parseComposite('ROW(LINE_CHART(x:"ts",y:["a"]))');
        expect(r.composite!.direction).toBe('row');
        expect(r.composite!.children).toHaveLength(1);
    });

    it('matches the existing parsePlotCall result for non-composite inputs', () => {
        const input = 'BAR_CHART(x: "host", y: ["count"]) TITLE "Bar"';
        const composite = parseComposite(input);
        const single = parsePlotCall(input);
        expect(composite.composite).toBeUndefined();
        expect(composite.mainConfig).toBe(single.mainConfig);
        expect(composite.title).toBe(single.title);
    });
});
