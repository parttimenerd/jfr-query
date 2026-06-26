// Per-position hole hint coverage. One test per `PlotHoleHint` variant —
// asserts the parser emits a `hole` node carrying the expected discriminated
// hint shape at a cursor position that should trigger it.

import { describe, it, expect } from 'vitest';
import { parse } from '../../components/editor/plot/parser';
import { walk, type PlotNode } from '../../components/editor/plot/ast';

function holesIn(src: string, cursorPos: number): PlotNode[] {
    const out: PlotNode[] = [];
    walk(parse(src, { cursorPos }), n => { if (n.kind === 'hole') out.push(n); });
    return out;
}

function firstHintOfKind(holes: PlotNode[], kind: string): any | null {
    for (const h of holes) {
        const hint = h.annotations.hint;
        if (hint && hint.kind === kind) return hint;
    }
    return null;
}

describe('PlotHoleHint coverage (P1)', () => {
    it('topLevel — empty script at cursor', () => {
        const src = '';
        const holes = holesIn(src, 0);
        const h = firstHintOfKind(holes, 'topLevel');
        expect(h).not.toBeNull();
        expect(h.suggest).toBeDefined();
    });

    it('topLevel — inside empty composite body', () => {
        const src = 'row ';
        const holes = holesIn(src, src.length);
        // Either a topLevel hint from the missing brace path, or some hole.
        const h = firstHintOfKind(holes, 'topLevel');
        expect(h).not.toBeNull();
    });

    it('clauseKey — `LINE_CHART(x: "ts", <cursor>)`', () => {
        const before = 'LINE_CHART(x: "ts", ';
        const src = `${before})`;
        const holes = holesIn(src, before.length);
        const h = firstHintOfKind(holes, 'clauseKey');
        expect(h).not.toBeNull();
        expect(h.shape).toBe('line');
        expect(h.usedKeys).toContain('x');
    });

    it('clauseValue — `line { x: ts, y: <cursor>`', () => {
        const before = 'line { x: ts, y: ';
        const holes = holesIn(before, before.length);
        const h = firstHintOfKind(holes, 'clauseValue');
        expect(h).not.toBeNull();
        expect(h.shape).toBe('line');
        expect(h.clauseKey).toBe('y');
    });

    it('clauseValue — uppercase form `LINE_CHART(x: <cursor>)`', () => {
        const before = 'LINE_CHART(x: ';
        const src = `${before})`;
        const holes = holesIn(src, before.length);
        const h = firstHintOfKind(holes, 'clauseValue');
        expect(h).not.toBeNull();
        expect(h.clauseKey).toBe('x');
    });

    it('tailKey — `line { x: ts } | <cursor>`', () => {
        const before = 'line { x: ts } | ';
        const holes = holesIn(before, before.length);
        const h = firstHintOfKind(holes, 'tailKey');
        expect(h).not.toBeNull();
        expect(h.allowedTails.length).toBeGreaterThan(0);
    });

    it('tailValue — `LINE_CHART(x: ts) TITLE <cursor>`', () => {
        const before = 'LINE_CHART(x: ts) TITLE ';
        const holes = holesIn(before, before.length);
        const h = firstHintOfKind(holes, 'tailValue');
        expect(h).not.toBeNull();
        expect(h.tail).toBe('TITLE');
        expect(h.valueType).toBe('string');
    });

    it('tailValue — `... ZOOM <cursor>` valueType: number', () => {
        const before = 'LINE_CHART(x: ts) ZOOM ';
        const holes = holesIn(before, before.length);
        const h = firstHintOfKind(holes, 'tailValue');
        expect(h).not.toBeNull();
        expect(h.tail).toBe('ZOOM');
        expect(h.valueType).toBe('number');
    });

    it('tailValue — `... WIDTH <cursor>` valueType: dimension', () => {
        const before = 'LINE_CHART(x: ts) WIDTH ';
        const holes = holesIn(before, before.length);
        const h = firstHintOfKind(holes, 'tailValue');
        expect(h).not.toBeNull();
        expect(h.valueType).toBe('dimension');
    });

    it('tailValue — `... LINK_X <cursor>` valueType: linkArgs', () => {
        const before = 'LINE_CHART(x: ts) LINK_X ';
        const holes = holesIn(before, before.length);
        const h = firstHintOfKind(holes, 'tailValue');
        expect(h).not.toBeNull();
        expect(h.valueType).toBe('linkArgs');
    });

    it('onArg — `LINE_CHART(x: ts) ON <cursor>`', () => {
        const before = 'LINE_CHART(x: ts) ON ';
        const holes = holesIn(before, before.length);
        const h = firstHintOfKind(holes, 'onArg');
        expect(h).not.toBeNull();
        expect(h.expects).toContain('queryRef');
    });

    it('queryRefTarget — `... ON #<cursor>`', () => {
        const before = 'LINE_CHART(x: ts) ON #';
        const holes = holesIn(before, before.length);
        const h = firstHintOfKind(holes, 'queryRefTarget');
        expect(h).not.toBeNull();
    });

    it('queryRefTarget — lowercase `... | on: #<cursor>`', () => {
        const before = 'line { x: ts } | on: #';
        const holes = holesIn(before, before.length);
        const h = firstHintOfKind(holes, 'queryRefTarget');
        expect(h).not.toBeNull();
    });

    it('letName — `LET <cursor>`', () => {
        const before = 'LET ';
        const holes = holesIn(before, before.length);
        const h = firstHintOfKind(holes, 'letName');
        expect(h).not.toBeNull();
    });

    it('letValue — `LET @x = <cursor>`', () => {
        const before = 'LET @x = ';
        const holes = holesIn(before, before.length);
        const h = firstHintOfKind(holes, 'letValue');
        expect(h).not.toBeNull();
    });
});
