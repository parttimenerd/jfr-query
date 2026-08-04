// Tests for the new plot parser + derive pipeline. Validates that the AST
// covers everything the old `parsePlotCall` accepts and that `derive()`
// produces byte-equivalent `ParsedPlotCall` output.

import { describe, it, expect } from 'vitest';
import { parse } from '../../components/editor/plot/parser';
import { derive } from '../../components/editor/plot/derive';
import { parseAndAnnotate } from '../../components/editor/plot';

function p(src: string) {
    const root = parse(src);
    return derive(root);
}

describe('plot parser — round trip uppercase', () => {
    it('basic line chart', () => {
        const r = p('LINE_CHART(x: "time", y: ["cpu"])');
        expect(r.mainConfig).toBe('LINE_CHART(x: "time", y: ["cpu"])');
        expect(r.title).toBeFalsy();
    });

    it('title clause', () => {
        const r = p('TABLE() TITLE "My Table"');
        expect(r.mainConfig).toBe('TABLE()');
        expect(r.title).toBe('My Table');
    });

    it('on clause single integer', () => {
        const r = p('BAR_CHART(x: "cat") ON 1');
        expect(r.mainConfig).toBe('BAR_CHART(x: "cat")');
        expect(r.on).toEqual(['1']);
    });

    it('width/height/link_x trailing chain', () => {
        const r = p('SCATTER_PLOT() WIDTH 50% HEIGHT 300px LINK_X($start, $end, master)');
        expect(r.linkX).toEqual(['$start', '$end']);
        expect(r.linkXMaster).toBe(true);
        expect(r.width).toBe('50%');
        expect(r.height).toBe('300px');
        expect(r.mainConfig).toBe('SCATTER_PLOT()');
    });

    it('link_x clamp mode', () => {
        const r = p('TABLE() LINK_X($start, $end, clamp)');
        expect(r.linkX).toEqual(['$start', '$end']);
        expect(r.linkXClamp).toBe(true);
        expect(r.linkXMaster).toBeFalsy();
    });

    it('zoom + comment stripping', () => {
        const r = p('LINE_CHART(x: ts, y: cpu) // comment\nZOOM 2.0');
        expect(r.zoom).toBe(2.0);
    });

    it('NAME tail', () => {
        const r = p('LINE_CHART(x: ts, y: cpu) NAME "gc"');
        expect(r.plotName).toBe('gc');
    });

    it('DISABLED bare tail', () => {
        const r = p('LINE_CHART(x: ts, y: cpu) DISABLED');
        expect(r.disabled).toBe(true);
    });

    it('LINK_Y / LINK_XY / LINK_SCROLL', () => {
        const a = p('LINE_CHART(x: ts) LINK_Y($yDomain)');
        expect(a.linkY).toBe('$yDomain');
        const b = p('LINE_CHART(x: ts) LINK_XY($combined)');
        expect(b.linkXY).toBe('$combined');
        const c = p('LINE_CHART(x: ts) LINK_SCROLL($flameGroup)');
        expect(c.linkScroll).toBe('flameGroup');
    });

    it('NAME + DISABLED + TITLE all together', () => {
        const r = p('LINE_CHART(x: ts, y: cpu) NAME "gc" TITLE "GC Chart" DISABLED');
        expect(r.plotName).toBe('gc');
        expect(r.title).toBe('GC Chart');
        expect(r.disabled).toBe(true);
    });
});

describe('plot parser — round trip lowercase DSL', () => {
    it('basic line chart with bare column refs', () => {
        const r = p('line { x: ts, y: cpu }');
        expect(r.mainConfig).toBe('LINE_CHART(x: "ts", y: "cpu")');
    });

    it('multi-y array', () => {
        const r = p('line { x: ts, y: [cpu, heap] }');
        expect(r.mainConfig).toBe('LINE_CHART(x: "ts", y: ["cpu", "heap"])');
    });

    it('quoted strings preserved', () => {
        const r = p('bar { x: "category", y: ["count"] }');
        expect(r.mainConfig).toBe('BAR_CHART(x: "category", y: ["count"])');
    });

    it('variable $-refs unquoted', () => {
        const r = p('line { x: $start, y: [$end] }');
        expect(r.mainConfig).toBe('LINE_CHART(x: $start, y: [$end])');
    });

    it('empty table', () => {
        const r = p('table { }');
        expect(r.mainConfig).toBe('TABLE()');
    });

    it('| name: gc → plotName', () => {
        const r = p('line { x: ts, y: [cpu] } | name: gc');
        expect(r.plotName).toBe('gc');
    });

    it('| on: #2 → on', () => {
        const r = p('line { x: ts } | on: #2');
        expect(r.on).toEqual(['2']);
    });

    it('| title: "x"', () => {
        const r = p('table { } | title: "My Table"');
        expect(r.title).toBe('My Table');
    });

    it('| zoom: 2.0', () => {
        const r = p('line { x: ts } | zoom: 2.0');
        expect(r.zoom).toBe(2.0);
    });

    it('| width / | height dimensions', () => {
        expect(p('line { x: ts } | width: 400px').width).toBe('400px');
        expect(p('line { x: ts } | height: 300px').height).toBe('300px');
    });

    it('| link-x: [$a, $b]', () => {
        const r = p('line { x: ts } | link-x: [$a, $b]');
        expect(r.linkX).toEqual(['$a', '$b']);
        expect(r.linkXMaster).toBeFalsy();
    });

    it('| link-x: [$a, $b, master]', () => {
        const r = p('line { x: ts } | link-x: [$a, $b, master]');
        expect(r.linkX).toEqual(['$a', '$b']);
        expect(r.linkXMaster).toBe(true);
    });

    it('row composite', () => {
        const r = p('row { line { x: ts, y: [cpu] }; bar { x: cat } }');
        expect(r.composite).toBeDefined();
        expect(r.composite!.direction).toBe('row');
        expect(r.composite!.children).toHaveLength(2);
        expect(r.composite!.children[0].mainConfig).toBe('LINE_CHART(x: "ts", y: ["cpu"])');
        expect(r.composite!.children[1].mainConfig).toBe('BAR_CHART(x: "cat")');
    });

    it('col composite', () => {
        const r = p('col { scatter { x: ts, y: lat }; table { } }');
        expect(r.composite!.direction).toBe('col');
        expect(r.composite!.children).toHaveLength(2);
    });
});

describe('plot parser — cursor positions emit hole nodes', () => {
    function holeAtCursor(src: string) {
        const pipePos = src.indexOf('|');
        const cleaned = src.replace('|', '');
        return { root: parse(cleaned, { cursorPos: pipePos }), pos: pipePos };
    }

    it('cursor after `x:` produces hole expecting value', () => {
        const { root } = holeAtCursor('line { x: |');
        // Find any hole node in the tree
        let foundHole = false;
        function walk(n: any) {
            if (n.kind === 'hole') {
                foundHole = true;
                // Should expect a value-class kind
                const exp = n.annotations.expectedKinds ?? [];
                expect(exp.length).toBeGreaterThan(0);
            }
            for (const c of n.children) walk(c);
        }
        walk(root);
        expect(foundHole).toBe(true);
    });

    it('cursor inside empty paren still has plotCall', () => {
        const { root } = holeAtCursor('LINE_CHART(|');
        const call = root.children.find((c: any) => c.kind === 'plotCall');
        expect(call).toBeDefined();
    });
});

describe('plot parser — comment stripping', () => {
    it('// line comment ignored mid-config', () => {
        const r = p('LINE_CHART(x: ts, y: cpu) // a comment\nTITLE "test"');
        expect(r.title).toBe('test');
    });

    it('# line comment ignored mid-config', () => {
        const r = p('LINE_CHART(x: ts) # comment\nZOOM 2');
        expect(r.zoom).toBe(2);
    });
});

describe('plot parser — annotators integration', () => {
    it('annotateConstants populates scope', () => {
        const { scope } = parseAndAnnotate({ src: 'LET @x = "time"\nLINE_CHART(x: @x)' });
        expect(scope.lookupConstant('x')).toBeDefined();
        expect(scope.lookupConstant('x')!.valueText).toBe('"time"');
    });

    it('annotateColumns resolves bare idents against schema', () => {
        const { root } = parseAndAnnotate({
            src: 'line { x: ts, y: cpu }',
            resultColumns: [{ name: 'ts', dataType: 'TIMESTAMP' }, { name: 'cpu', dataType: 'DOUBLE' }],
        });
        const calls = root.children.filter(c => c.kind === 'plotCall');
        const xClause = calls[0].children.find(c => c.key === 'x' && c.kind === 'clause');
        const tsResolved = xClause?.children.find(c => c.kind !== 'clauseRef');
        expect(tsResolved?.annotations.resolves).toMatchObject({ kind: 'column', name: 'ts' });
    });
});

// ─── New node kinds (P1) ──────────────────────────────────────────────────────

import { walk } from '../../components/editor/plot/ast';

function findHole(root: any) {
    let found: any | null = null;
    walk(root, (n: any) => {
        if (!found && n.kind === 'hole' && n.annotations?.hint) found = n;
    });
    return found;
}

describe('plot parser — new node kinds (P1)', () => {
    it('clause emits a `clauseRef` child for the key span', () => {
        const root = parse('line { x: ts }');
        const call = root.children.find(c => c.kind === 'plotCall')!;
        const xClause = call.children.find(c => c.kind === 'clause' && c.key === 'x')!;
        const cref = xClause.children.find(c => c.kind === 'clauseRef');
        expect(cref).toBeDefined();
        expect(cref!.text).toBe('x');
        expect(xClause.keyFrom).toBe(cref!.from);
        expect(xClause.keyTo).toBe(cref!.to);
        expect(xClause.colonFrom).toBeGreaterThanOrEqual(xClause.keyTo!);
        expect(xClause.valueFrom).toBeGreaterThan(xClause.colonFrom!);
    });

    it('uppercase tail emits a `tailRef` child for the keyword', () => {
        const root = parse('TABLE() TITLE "x"');
        const call = root.children.find(c => c.kind === 'plotCall')!;
        const tail = call.children.find(c => c.kind === 'tail')!;
        const tref = tail.children.find(c => c.kind === 'tailRef');
        expect(tref).toBeDefined();
        expect(tref!.text).toBe('TITLE');
        expect(tail.keyFrom).toBe(tref!.from);
        expect(tail.keyTo).toBe(tref!.to);
    });

    it('lowercase tail emits a `tailRef` child for the keyword', () => {
        const root = parse('line { x: ts } | name: gc');
        const call = root.children.find(c => c.kind === 'plotCall')!;
        const tail = call.children.find(c => c.kind === 'tail')!;
        const tref = tail.children.find(c => c.kind === 'tailRef');
        expect(tref).toBeDefined();
        expect(tref!.text).toBe('name');
    });

    it('hash refs become `queryRef` nodes', () => {
        const root = parse('LINE_CHART(x: ts) ON #2');
        const call = root.children.find(c => c.kind === 'plotCall')!;
        const tail = call.children.find(c => c.kind === 'tail')!;
        const list = tail.children.find(c => c.kind === 'list')!;
        const qref = list.children.find(c => c.kind === 'queryRef')!;
        expect(qref).toBeDefined();
        expect(qref.queryIndex).toBe(2);
    });

    it('lowercase `on: #2` also produces a queryRef', () => {
        const root = parse('line { x: ts } | on: #2');
        const call = root.children.find(c => c.kind === 'plotCall')!;
        const tail = call.children.find(c => c.kind === 'tail')!;
        const qref = tail.children.find(c => c.kind === 'queryRef')!;
        expect(qref).toBeDefined();
        expect(qref.queryIndex).toBe(2);
    });
});

describe('plot parser — rich hole hints (P1)', () => {
    function holeAt(src: string) {
        const pos = src.indexOf('|');
        const cleaned = src.replace('|', '');
        return findHole(parse(cleaned, { cursorPos: pos }));
    }

    it('`line { x: ts, y: |` emits a clauseValue hint', () => {
        const h = holeAt('line { x: ts, y: |');
        expect(h).not.toBeNull();
        expect(h.annotations.hint.kind).toBe('clauseValue');
        expect(h.annotations.hint.shape).toBe('line');
        expect(h.annotations.hint.clauseKey).toBe('y');
    });

    it('`LINE_CHART(x: "ts", |)` emits a clauseKey hint', () => {
        const h = holeAt('LINE_CHART(x: "ts", |)');
        expect(h).not.toBeNull();
        expect(h.annotations.hint.kind).toBe('clauseKey');
        expect(h.annotations.hint.usedKeys).toContain('x');
        expect(h.annotations.hint.shape).toBe('line');
    });

    it('`line { x: ts } | |` emits a tailKey hint', () => {
        // Cursor is after the pipe — at the position where a tail keyword goes.
        const src = 'line { x: ts } | ';
        const root = parse(src, { cursorPos: src.length });
        const call = root.children.find(c => c.kind === 'plotCall')!;
        const tail = call.children.find(c => c.kind === 'tail');
        // either the tail's hole-child or a trailing tailKey hole on the call
        const h = (tail?.children.find(c => c.kind === 'hole'))
            ?? call.children.find(c => c.kind === 'hole' && c.annotations.hint?.kind === 'tailKey');
        expect(h).toBeDefined();
        expect((h as any).annotations.hint.kind).toBe('tailKey');
    });

    it('`LINE_CHART(x:"ts") ON #|` emits a queryRefTarget hint', () => {
        const src = 'LINE_CHART(x:"ts") ON #';
        const root = parse(src, { cursorPos: src.length });
        // Find any hole with queryRefTarget hint.
        let h: any = null;
        walk(root, n => { if (!h && n.kind === 'hole' && (n as any).annotations.hint?.kind === 'queryRefTarget') h = n; });
        expect(h).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// setParents
// ---------------------------------------------------------------------------
import { setParents, makeNode } from '../../components/editor/plot/ast';

describe('setParents', () => {
    function buildTree() {
        const child1 = makeNode('ident', 4, 7, 'BAR');
        const child2 = makeNode('ident', 8, 11, 'baz');
        const root = makeNode('plotCall', 0, 12, 'BAR(baz)', { children: [child1, child2] });
        return { root, child1, child2 };
    }

    it('sets parent to undefined for root node', () => {
        const { root } = buildTree();
        setParents(root);
        expect(root.parent).toBeUndefined();
    });

    it('sets parent of direct children to root', () => {
        const { root, child1, child2 } = buildTree();
        setParents(root);
        expect(child1.parent).toBe(root);
        expect(child2.parent).toBe(root);
    });

    it('sets parents recursively for nested children', () => {
        const grandchild = makeNode('ident', 5, 6, 'x');
        const child = makeNode('plotCall', 4, 7, 'f(x)', { children: [grandchild] });
        const root = makeNode('plotCall', 0, 8, 'g(f(x))', { children: [child] });
        setParents(root);
        expect(grandchild.parent).toBe(child);
        expect(child.parent).toBe(root);
    });

    it('is idempotent — calling twice gives same result', () => {
        const { root, child1 } = buildTree();
        setParents(root);
        setParents(root);
        expect(child1.parent).toBe(root);
    });
});
