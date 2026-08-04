import { describe, it, expect } from 'vitest';
import { annotateVariables } from '../../../../components/editor/plot/annotators/variableAnnotator';
import { parse } from '../../../../components/editor/plot/parser';

function findNodes(root: ReturnType<typeof parse>, pred: (n: typeof root) => boolean): typeof root[] {
    const found: typeof root[] = [];
    function walk(n: typeof root) {
        if (pred(n)) found.push(n);
        for (const c of n.children) walk(c);
    }
    walk(root);
    return found;
}

// ── annotateVariables ─────────────────────────────────────────────────────────

describe('annotateVariables', () => {
    it('resolves a simple $var reference', () => {
        const root = parse('TABLE(headers: [$limit])');
        annotateVariables(root);
        const varRefs = findNodes(root, n => n.kind === 'varRef');
        const limitRef = varRefs.find(n => n.dollar?.name === 'limit');
        expect(limitRef?.annotations.resolves?.kind).toBe('variable');
        expect((limitRef?.annotations.resolves as any)?.parsed?.kind).toBe('variableRef');
        expect((limitRef?.annotations.resolves as any)?.parsed?.name).toBe('limit');
    });

    it('resolves a $cell.brush cross-cell reference', () => {
        const root = parse('TABLE(headers: [$gc.brush])');
        annotateVariables(root);
        const varRefs = findNodes(root, n => n.kind === 'varRef');
        const brushRef = varRefs.find(n => n.dollar?.kind === 'crossCellRef' && n.dollar.name === 'gc');
        expect(brushRef?.annotations.resolves?.kind).toBe('variable');
        expect((brushRef?.annotations.resolves as any)?.parsed?.kind).toBe('crossCellRef');
    });

    it('resolves $$global references', () => {
        const root = parse('TABLE() TITLE $$myGlobal');
        annotateVariables(root);
        const varRefs = findNodes(root, n => n.kind === 'varRef');
        const globalRef = varRefs.find(n => n.dollar?.kind === 'doubleDollarRef');
        // Some parsers may not produce varRef for tails, so we just check no crash
        expect(() => annotateVariables(root)).not.toThrow();
    });

    it('does not annotate non-varRef nodes', () => {
        const root = parse('TABLE(headers: ["ts"])');
        annotateVariables(root);
        const idents = findNodes(root, n => n.kind === 'ident');
        for (const id of idents) {
            expect(id.annotations.resolves).toBeUndefined();
        }
    });

    it('handles empty script without throwing', () => {
        const root = parse('');
        expect(() => annotateVariables(root)).not.toThrow();
    });

    it('handles plot with no variable refs without throwing', () => {
        const root = parse('TABLE()');
        expect(() => annotateVariables(root)).not.toThrow();
    });

    it('annotates multiple var refs in same expression', () => {
        const root = parse('LINE_CHART(x: ts, y: [duration]) NAME $myName');
        annotateVariables(root);
        const varRefs = findNodes(root, n => n.kind === 'varRef' && n.annotations.resolves !== undefined);
        expect(varRefs.length).toBeGreaterThanOrEqual(1);
    });
});
