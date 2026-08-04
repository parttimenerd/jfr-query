import { describe, it, expect } from 'vitest';
import { annotateConstants } from '../../../../components/editor/plot/annotators/constAnnotator';
import { parse } from '../../../../components/editor/plot/parser';
import { PlotScope } from '../../../../components/editor/plot/scope';

function annotate(src: string): { scope: PlotScope; root: ReturnType<typeof parse> } {
    const root = parse(src);
    const scope = new PlotScope();
    annotateConstants(root, scope);
    return { scope, root };
}

// ── annotateConstants ─────────────────────────────────────────────────────────

describe('annotateConstants', () => {
    it('registers a simple LET constant in scope', () => {
        const { scope } = annotate('LET @threshold = 100\nTABLE()');
        const c = scope.lookupConstant('threshold');
        expect(c).toBeDefined();
        expect(c?.valueText).toBe('100');
    });

    it('annotates letStatement node with resolves.kind = constant', () => {
        const { root } = annotate('LET @limit = 50\nTABLE()');
        const letNode = root.children.find(n => n.kind === 'letStatement');
        expect(letNode?.annotations.resolves?.kind).toBe('constant');
        expect((letNode?.annotations.resolves as any)?.name).toBe('limit');
    });

    it('resolves @ref in a later plotCall to the declared constant', () => {
        const { root } = annotate('LET @bins = 20\nHISTOGRAM(x: dur, bins: @bins)');
        // Find the constRef node for @bins inside the plotCall
        let constRef: ReturnType<typeof parse> | undefined;
        function findRef(n: typeof root) {
            if (n.kind === 'constRef') { constRef = n; return; }
            for (const c of n.children) findRef(c);
        }
        // Skip first child (letStatement) and search the plot
        if (root.children[1]) findRef(root.children[1]);
        expect(constRef?.annotations.resolves?.kind).toBe('constant');
        expect((constRef?.annotations.resolves as any)?.name).toBe('bins');
        expect((constRef?.annotations.resolves as any)?.valueText).toBe('20');
    });

    it('registers multiple constants in declaration order', () => {
        const { scope } = annotate('LET @a = 1\nLET @b = 2\nTABLE()');
        expect(scope.lookupConstant('a')?.valueText).toBe('1');
        expect(scope.lookupConstant('b')?.valueText).toBe('2');
    });

    it('flags an undefined @ref with a diagnostic', () => {
        const { root } = annotate('TABLE(x: @missing)');
        let constRef: ReturnType<typeof parse> | undefined;
        function findRef(n: typeof root) {
            if (n.kind === 'constRef') { constRef = n; return; }
            for (const c of n.children) findRef(c);
        }
        findRef(root);
        expect(constRef?.annotations.diagnostics?.some(d => d.includes('Undefined'))).toBe(true);
    });

    it('does not register unknown constants to scope', () => {
        const { scope } = annotate('TABLE()');
        expect(scope.lookupConstant('unknown')).toBeUndefined();
    });

    it('handles script with no letStatements without throwing', () => {
        expect(() => annotate('TABLE()')).not.toThrow();
    });

    it('handles empty script without throwing', () => {
        expect(() => annotate('')).not.toThrow();
    });
});
