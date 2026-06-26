import { describe, it, expect } from 'vitest';
import { extractReferences } from '../services/templating/dependencies';
import { buildExecutionGraph, GraphCell } from '../runtime/executionGraph';

describe('extractReferences', () => {
    it('returns bare identifiers for simple FROM', () => {
        const refs = extractReferences('SELECT * FROM gc_pauses');
        expect(refs).toContainEqual({ kind: 'bare', name: 'gc_pauses' });
    });

    it('returns qualified handle.alias refs', () => {
        const refs = extractReferences('SELECT * FROM cell_3.gc_pauses');
        expect(refs).toContainEqual({ kind: 'qualified', handle: 'cell_3', alias: 'gc_pauses' });
    });

    it('returns variables with scoped flag', () => {
        const refs = extractReferences("SELECT * FROM gc WHERE d > $$threshold AND s = $size");
        expect(refs).toContainEqual({ kind: 'variable', name: 'threshold', scoped: true });
        expect(refs).toContainEqual({ kind: 'variable', name: 'size', scoped: false });
    });

    it('ignores string literals', () => {
        const refs = extractReferences("SELECT 'foo_bar' FROM t");
        expect(refs.map(r => (r as any).name)).not.toContain('foo_bar');
    });

    it('ignores line comments', () => {
        const refs = extractReferences('-- alias gc_pauses\nSELECT 1 FROM t');
        expect(refs.map(r => (r as any).name)).not.toContain('alias');
        expect(refs.map(r => (r as any).name)).not.toContain('gc_pauses');
    });

    it('ignores block comments', () => {
        const refs = extractReferences('SELECT /* FROM hidden */ 1 FROM real');
        const names = refs.map(r => (r as any).name);
        expect(names).toContain('real');
        expect(names).not.toContain('hidden');
    });

    it('filters out SQL keywords', () => {
        const refs = extractReferences('SELECT * FROM t WHERE a IS NULL ORDER BY a');
        const names = refs.map(r => (r as any).name).filter(Boolean);
        expect(names).not.toContain('select');
        expect(names).not.toContain('null');
        expect(names).not.toContain('order');
    });

    it('does not match variable letters as bare identifiers', () => {
        const refs = extractReferences('SELECT $x FROM t');
        // Only one ref for x — as a variable, not also as bare
        const xRefs = refs.filter(r => (r as any).name === 'x');
        expect(xRefs).toHaveLength(1);
        expect(xRefs[0].kind).toBe('variable');
    });
});

describe('buildExecutionGraph', () => {
    const mkCell = (id: string, handle: string, sql: string, aliases: string[] = []): GraphCell => ({
        id, handle, producedBareAliases: aliases, referencedSql: sql,
    });

    it('topo-sorts a simple chain (B depends on A)', () => {
        const cells = [
            mkCell('a', 'cell_1', 'SELECT 1', ['gc']),
            mkCell('b', 'cell_2', 'SELECT * FROM gc'),
        ];
        const g = buildExecutionGraph(cells);
        expect(g.order).toEqual(['a', 'b']);
        expect(g.deps.get('b')!.has('a')).toBe(true);
        expect(g.cycles.size).toBe(0);
    });

    it('resolves forward references (document order != topo order)', () => {
        const cells = [
            mkCell('b', 'cell_1', 'SELECT * FROM gc'),
            mkCell('a', 'cell_2', 'SELECT 1', ['gc']),
        ];
        const g = buildExecutionGraph(cells);
        expect(g.order).toEqual(['a', 'b']);
    });

    it('resolves qualified references', () => {
        const cells = [
            mkCell('b', 'cell_2', 'SELECT * FROM cell_1.gc'),
            mkCell('a', 'cell_1', 'SELECT 1', ['gc']),
        ];
        const g = buildExecutionGraph(cells);
        expect(g.order).toEqual(['a', 'b']);
    });

    it('detects a 2-cycle and reports both participants', () => {
        const cells = [
            mkCell('a', 'cell_1', 'SELECT * FROM b_view', ['a_view']),
            mkCell('b', 'cell_2', 'SELECT * FROM a_view', ['b_view']),
        ];
        const g = buildExecutionGraph(cells);
        expect(g.cycles.has('a')).toBe(true);
        expect(g.cycles.has('b')).toBe(true);
    });

    it('keeps independent cells in input order', () => {
        const cells = [
            mkCell('a', 'cell_1', 'SELECT 1', ['x']),
            mkCell('b', 'cell_2', 'SELECT 2', ['y']),
            mkCell('c', 'cell_3', 'SELECT * FROM x'),
        ];
        const g = buildExecutionGraph(cells);
        // a and c must be in order; b can appear anywhere relative to them
        expect(g.order.indexOf('a')).toBeLessThan(g.order.indexOf('c'));
    });

    it('ignores self-references', () => {
        const cells = [
            mkCell('a', 'cell_1', 'SELECT * FROM x', ['x']),
        ];
        const g = buildExecutionGraph(cells);
        expect(g.deps.get('a')!.size).toBe(0);
        expect(g.cycles.size).toBe(0);
    });

    // B-111: index-pointer Kahn's — verify correctness on a longer chain
    it('correctly topo-sorts a long linear chain without shift() (B-111)', () => {
        // Build a chain: c0 <- c1 <- c2 <- ... <- c19
        // Each cell i depends on cell i-1's alias
        const N = 20;
        const cells: GraphCell[] = [];
        for (let i = 0; i < N; i++) {
            cells.push(mkCell(
                `c${i}`,
                `cell_${i}`,
                i === 0 ? 'SELECT 1' : `SELECT * FROM alias_${i - 1}`,
                [`alias_${i}`],
            ));
        }
        const g = buildExecutionGraph(cells);
        expect(g.cycles.size).toBe(0);
        expect(g.order).toHaveLength(N);
        // Each cell must appear before all its dependents
        for (let i = 1; i < N; i++) {
            expect(g.order.indexOf(`c${i - 1}`)).toBeLessThan(g.order.indexOf(`c${i}`));
        }
    });
});

// B-161: plot ON clause named refs must be tracked as cross-cell DAG edges.
describe('buildExecutionGraph — B-161 plot ON alias refs', () => {
    const mkCell = (id: string, handle: string, sql: string, aliases: string[] = [], plotOnRefs: string[] = []): GraphCell => ({
        id, handle, producedBareAliases: aliases, referencedSql: sql, plotOnRefs,
    });

    it('enforces execution order when a plot ON clause references a cross-cell alias', () => {
        const cells = [
            mkCell('b', 'cell_2', '', [], ['gc_pauses']),
            mkCell('a', 'cell_1', 'SELECT 1', ['gc_pauses']),
        ];
        const g = buildExecutionGraph(cells);
        expect(g.order.indexOf('a')).toBeLessThan(g.order.indexOf('b'));
        expect(g.deps.get('b')!.has('a')).toBe(true);
    });

    it('ignores numeric ON refs (#1, 1) — those are cell-local', () => {
        const cells = [
            mkCell('a', 'cell_1', 'SELECT 1', ['x']),
            mkCell('b', 'cell_2', '', [], ['1', '#1']),
        ];
        const g = buildExecutionGraph(cells);
        expect(g.deps.get('b')!.size).toBe(0);
    });

    it('does not add a self-dependency when the plot ON ref names an alias in the same cell', () => {
        const cells = [
            mkCell('a', 'cell_1', 'SELECT 1', ['my_view'], ['my_view']),
        ];
        const g = buildExecutionGraph(cells);
        expect(g.deps.get('a')!.size).toBe(0);
        expect(g.cycles.size).toBe(0);
    });

    it('correctly detects cycle when cells ON-ref each other', () => {
        const cells = [
            mkCell('a', 'cell_1', 'SELECT 1', ['a_view'], ['b_view']),
            mkCell('b', 'cell_2', 'SELECT 1', ['b_view'], ['a_view']),
        ];
        const g = buildExecutionGraph(cells);
        expect(g.cycles.has('a')).toBe(true);
        expect(g.cycles.has('b')).toBe(true);
    });
});
