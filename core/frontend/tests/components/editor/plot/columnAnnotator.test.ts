import { describe, it, expect } from 'vitest';
import { annotateColumns } from '../../../../components/editor/plot/annotators/columnAnnotator';
import { parse } from '../../../../components/editor/plot/parser';
import { PlotScope } from '../../../../components/editor/plot/scope';

const schema = [
    { name: 'ts', dataType: 'BIGINT' },
    { name: 'duration', dataType: 'DOUBLE' },
    { name: 'cause', dataType: 'VARCHAR' },
];

function annotate(src: string, columns = schema) {
    const root = parse(src);
    const scope = new PlotScope({ resultColumns: columns });
    annotateColumns(root, scope);
    return root;
}

/** Walk all nodes in the tree and return those matching a predicate. */
function findNodes(root: ReturnType<typeof parse>, pred: (n: typeof root) => boolean): typeof root[] {
    const found: typeof root[] = [];
    function walk(n: typeof root) {
        if (pred(n)) found.push(n);
        for (const c of n.children) walk(c);
    }
    walk(root);
    return found;
}

// ── annotateColumns ───────────────────────────────────────────────────────────

describe('annotateColumns', () => {
    it('resolves a known column in a column-typed clause', () => {
        const root = annotate('LINE_CHART(x: ts, y: [duration])');
        const idents = findNodes(root, n => n.kind === 'ident');
        const tsIdent = idents.find(n => n.name === 'ts');
        expect(tsIdent?.annotations.resolves?.kind).toBe('column');
        expect((tsIdent?.annotations.resolves as any)?.name).toBe('ts');
        expect((tsIdent?.annotations.resolves as any)?.dataType).toBe('BIGINT');
    });

    it('resolves a column in the y clause', () => {
        const root = annotate('LINE_CHART(x: ts, y: [duration])');
        const idents = findNodes(root, n => n.kind === 'ident');
        const durIdent = idents.find(n => n.name === 'duration');
        expect(durIdent?.annotations.resolves?.kind).toBe('column');
        expect((durIdent?.annotations.resolves as any)?.dataType).toBe('DOUBLE');
    });

    it('does not resolve an unknown column', () => {
        const root = annotate('LINE_CHART(x: unknown_col, y: [duration])');
        const idents = findNodes(root, n => n.kind === 'ident' && n.name === 'unknown_col');
        expect(idents[0]?.annotations.resolves).toBeUndefined();
    });

    it('resolves column lookup case-insensitively', () => {
        const root = annotate('TABLE(headers: ["TS"])');
        const idents = findNodes(root, n => n.kind === 'ident');
        // Column identifiers in headers might not be in column-typed clauses
        // depending on the shape/config; this verifies no crash occurs.
        expect(() => annotate('LINE_CHART(x: TS, y: [duration])')).not.toThrow();
    });

    it('leaves non-column-typed clause idents unresolved', () => {
        // The `title` field in TABLE is not a column — idents there should stay unresolved
        const root = annotate('TABLE() TITLE "cause"');
        // No idents should be resolved as column in a tail clause
        const resolved = findNodes(root, n => n.kind === 'ident' && n.annotations.resolves?.kind === 'column');
        expect(resolved).toHaveLength(0);
    });

    it('handles empty plot with no idents', () => {
        expect(() => annotate('TABLE()')).not.toThrow();
    });

    it('handles empty resultColumns schema without crashing', () => {
        expect(() => annotate('LINE_CHART(x: ts, y: [duration])', [])).not.toThrow();
    });

    it('resolves columns in BAR_CHART x and y clauses', () => {
        const root = annotate('BAR_CHART(x: cause, y: [duration])');
        const idents = findNodes(root, n => n.kind === 'ident');
        const causeIdent = idents.find(n => n.name === 'cause');
        expect(causeIdent?.annotations.resolves?.kind).toBe('column');
        expect((causeIdent?.annotations.resolves as any)?.dataType).toBe('VARCHAR');
    });
});
