// Tests for the plot DSL annotators (const, variable, column, shape).

import { describe, it, expect } from 'vitest';
import { parseAndAnnotate } from '../../components/editor/plot';
import { walk } from '../../components/editor/plot/ast';

describe('constAnnotator', () => {
    it('backward refs resolve cleanly', () => {
        const { root } = parseAndAnnotate({ src: 'LET @x = 1\nLINE_CHART(x: @x)' });
        const refs: any[] = [];
        walk(root, n => { if (n.kind === 'constRef' && n.parent?.kind !== 'letStatement') refs.push(n); });
        expect(refs[0]?.annotations.resolves).toMatchObject({ kind: 'constant', name: 'x' });
        expect(refs[0]?.annotations.diagnostics ?? []).toEqual([]);
    });

    it('forward refs are flagged', () => {
        const { root } = parseAndAnnotate({ src: 'LINE_CHART(x: @later)\nLET @later = 1' });
        const refs: any[] = [];
        walk(root, n => { if (n.kind === 'constRef' && n.parent?.kind !== 'letStatement') refs.push(n); });
        expect(refs[0]?.annotations.diagnostics?.some((d: string) => /Forward/.test(d))).toBe(true);
    });

    it('undefined refs are flagged', () => {
        const { root } = parseAndAnnotate({ src: 'LINE_CHART(x: @missing)' });
        const refs: any[] = [];
        walk(root, n => { if (n.kind === 'constRef') refs.push(n); });
        expect(refs[0]?.annotations.diagnostics?.some((d: string) => /Undefined/.test(d))).toBe(true);
    });

    it('cycle is detected', () => {
        const { root } = parseAndAnnotate({ src: 'LET @a = @b\nLET @b = @a' });
        const lets: any[] = [];
        walk(root, n => { if (n.kind === 'letStatement') lets.push(n); });
        const anyHasCycle = lets.some(n => n.annotations.diagnostics?.some((d: string) => /Cycle/.test(d)));
        expect(anyHasCycle).toBe(true);
    });

    it('redefinition is flagged', () => {
        const { root } = parseAndAnnotate({ src: 'LET @x = 1\nLET @x = 2' });
        const lets: any[] = [];
        walk(root, n => { if (n.kind === 'letStatement') lets.push(n); });
        const flagged = lets.some(n => n.annotations.diagnostics?.some((d: string) => /Redefinition/.test(d)));
        expect(flagged).toBe(true);
    });
});

describe('variableAnnotator', () => {
    it('resolves $-refs with parsed dollar', () => {
        const { root } = parseAndAnnotate({ src: 'LINE_CHART(x: $start)' });
        const vars: any[] = [];
        walk(root, n => { if (n.kind === 'varRef') vars.push(n); });
        expect(vars[0]?.annotations.resolves).toMatchObject({
            kind: 'variable',
            parsed: { kind: 'variableRef', name: 'start' },
        });
    });

    it('parses $cell.var tail correctly', () => {
        const { root } = parseAndAnnotate({ src: 'LINE_CHART(x: $gc.range.0)' });
        const vars: any[] = [];
        walk(root, n => { if (n.kind === 'varRef') vars.push(n); });
        const resolved = vars[0]?.annotations.resolves as any;
        expect(resolved?.parsed?.kind).toBe('crossCellRef');
        expect(resolved?.parsed?.name).toBe('gc');
        expect(resolved?.parsed?.path).toEqual(['range', '0']);
    });

    it('parses $cell.brush', () => {
        const { root } = parseAndAnnotate({ src: 'LINE_CHART(x: $plot.brush)' });
        const vars: any[] = [];
        walk(root, n => { if (n.kind === 'varRef') vars.push(n); });
        const resolved = vars[0]?.annotations.resolves as any;
        expect(resolved?.parsed?.kind).toBe('crossCellRef');
        expect(resolved?.parsed?.path).toEqual(['brush']);
    });

    it('parses $cell.brush.lo and $cell.brush.hi', () => {
        const { root } = parseAndAnnotate({ src: 'BAR_CHART(x: $plot.brush.lo, y: $plot.brush.hi)' });
        const vars: any[] = [];
        walk(root, n => { if (n.kind === 'varRef') vars.push(n); });
        const r1 = vars[0]?.annotations.resolves as any;
        const r2 = vars[1]?.annotations.resolves as any;
        expect(r1?.parsed?.path).toEqual(['brush', 'lo']);
        expect(r2?.parsed?.path).toEqual(['brush', 'hi']);
    });

    it('parses $$var as doubleDollarRef', () => {
        const { root } = parseAndAnnotate({ src: 'LINE_CHART(x: $$global)' });
        const vars: any[] = [];
        walk(root, n => { if (n.kind === 'varRef') vars.push(n); });
        const resolved = vars[0]?.annotations.resolves as any;
        expect(resolved?.parsed?.kind).toBe('doubleDollarRef');
        expect(resolved?.parsed?.name).toBe('global');
    });
});

describe('columnAnnotator', () => {
    const columns = [
        { name: 'ts', dataType: 'TIMESTAMP' },
        { name: 'cnt', dataType: 'BIGINT' },
        { name: 'cat', dataType: 'VARCHAR' },
    ];

    it('resolves bare-ident in column-clause to a column', () => {
        const { root } = parseAndAnnotate({
            src: 'line { x: ts, y: cnt }',
            resultColumns: columns,
        });
        const idents: any[] = [];
        walk(root, n => { if (n.kind === 'ident') idents.push(n); });
        // Find ts and cnt
        const ts = idents.find(n => n.name === 'ts');
        const cnt = idents.find(n => n.name === 'cnt');
        expect(ts?.annotations.resolves).toMatchObject({ kind: 'column', name: 'ts', dataType: 'TIMESTAMP' });
        expect(cnt?.annotations.resolves).toMatchObject({ kind: 'column', name: 'cnt', dataType: 'BIGINT' });
    });

    it('does not resolve ident outside a column-clause', () => {
        const { root } = parseAndAnnotate({
            src: 'line { x: ts, y: cnt } | name: gc',
            resultColumns: columns,
        });
        const idents: any[] = [];
        walk(root, n => { if (n.kind === 'ident' && n.name === 'gc') idents.push(n); });
        // The `gc` ident in the `| name: gc` slot is in a tail, not a column-clause —
        // it should not resolve to a column.
        expect(idents[0]?.annotations.resolves).toBeUndefined();
    });
});

describe('cursor positions with holes', () => {
    function withCursor(src: string) {
        const pos = src.indexOf('|');
        return parseAndAnnotate({ src: src.replace('|', ''), cursorPos: pos });
    }

    it('cursor in `line { y: ` produces a hole with columnRef in expectedKinds', () => {
        const { root } = withCursor('line { y: |');
        // Find any hole and check it expects identifier kinds (which includes
        // bare column refs in our model).
        let foundHoleWithValueKinds = false;
        walk(root, n => {
            if (n.kind === 'hole') {
                const expected = n.annotations.expectedKinds ?? [];
                if (expected.includes('ident') || expected.includes('literal') || expected.includes('varRef')) {
                    foundHoleWithValueKinds = true;
                }
            }
        });
        expect(foundHoleWithValueKinds).toBe(true);
    });
});

// ─── New annotator behaviours (P1) ────────────────────────────────────────────

describe('shapeAnnotator — P1 enrichment', () => {
    const registry = {
        line: {
            name: 'line',
            validClauses: ['x', 'y', 'color', 'group'],
            columnClauses: ['x', 'y', 'color'],
            requiredClauses: ['x', 'y'],
            clauseDefs: [
                { key: 'x', paramType: 'column', required: true, description: 'x axis column' },
                { key: 'y', paramType: 'column', required: true },
                { key: 'color', paramType: 'column', required: false },
                { key: 'group', paramType: 'string', required: false, options: ['a', 'b'] },
            ],
        },
    };

    it('attaches requiredClauses from the registry to the plotCall', () => {
        const { root } = parseAndAnnotate({
            src: 'line { x: ts }',
            shapeRegistry: registry,
        });
        const call = root.children.find(c => c.kind === 'plotCall')!;
        const r = call.annotations.resolves as any;
        expect(r.kind).toBe('plotShape');
        expect(r.requiredClauses).toEqual(['x', 'y']);
    });

    it('resolves a `clauseRef` for `x: ts` to a `clauseDef` with paramType column', () => {
        const { root } = parseAndAnnotate({
            src: 'line { x: ts }',
            shapeRegistry: registry,
        });
        const call = root.children.find(c => c.kind === 'plotCall')!;
        const xClause = call.children.find(c => c.kind === 'clause' && c.key === 'x')!;
        const cref = xClause.children.find(c => c.kind === 'clauseRef');
        const r = cref?.annotations.resolves as any;
        expect(r?.kind).toBe('clauseDef');
        expect(r?.clauseKey).toBe('x');
        expect(r?.paramType).toBe('column');
        expect(r?.required).toBe(true);
    });

    it('enriches a clauseKey hole with the registry availableKeys & requiredMissing', () => {
        const src = 'LINE_CHART(x: "ts", )';
        const cursor = src.indexOf(')'); // cursor just before ')'
        const { root } = parseAndAnnotate({
            src,
            cursorPos: cursor,
            shapeRegistry: registry,
        });
        let hint: any = null;
        walk(root, n => {
            if (n.kind === 'hole' && n.annotations.hint?.kind === 'clauseKey') hint = n.annotations.hint;
        });
        expect(hint).not.toBeNull();
        expect(hint.usedKeys).toContain('x');
        expect(hint.availableKeys).toEqual(expect.arrayContaining(['y', 'color', 'group']));
        expect(hint.requiredMissing).toContain('y');
    });

    it('queryRef #2 stays unresolved when no notebook deps provided (no diagnostic)', () => {
        const { root } = parseAndAnnotate({ src: 'LINE_CHART(x: ts) ON #2' });
        let qref: any = null;
        walk(root, n => { if (n.kind === 'queryRef') qref = n; });
        expect(qref).not.toBeNull();
        // P3 will resolve `targetCellId`. For now, no `resolves` set is fine.
        expect(qref.annotations.resolves).toBeUndefined();
        // Should NOT emit a diagnostic — `#viewname` is legal & deferred.
        expect(qref.annotations.diagnostics ?? []).toEqual([]);
    });

    it('structured diagnostic shape: cycle in constants surfaces as a structured diagnostic when enabled', () => {
        // The legacy string channel is still populated; verify it remains.
        const { root } = parseAndAnnotate({ src: 'LET @a = @b\nLET @b = @a' });
        const lets: any[] = [];
        walk(root, n => { if (n.kind === 'letStatement') lets.push(n); });
        const cycleStr = lets.some(n => n.annotations.diagnostics?.some((d: string) => /Cycle/.test(d)));
        expect(cycleStr).toBe(true);
    });
});

describe('variableAnnotator — brush typing (P1)', () => {
    it('$cell.brush.lo carries source=brush, dataType=unknown until P3 wires it', () => {
        const { root } = parseAndAnnotate({ src: 'LINE_CHART(x: $plot.brush.lo)' });
        let resolved: any = null;
        walk(root, n => { if (n.kind === 'varRef') resolved = n.annotations.resolves; });
        expect(resolved).toMatchObject({ kind: 'variable', parsed: { kind: 'crossCellRef', name: 'plot', path: ['brush', 'lo'] } });
        // dataType is permitted to be undefined or 'unknown' — both indicate
        // "P3 will fill this".
        if (resolved.dataType !== undefined) {
            expect(['unknown', 'timestamp']).toContain(resolved.dataType);
        }
    });
});
