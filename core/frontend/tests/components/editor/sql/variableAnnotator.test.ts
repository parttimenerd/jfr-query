import { describe, it, expect } from 'vitest';
import { annotateVariables } from '../../../../components/editor/sql/annotators/variableAnnotator';
import { parse } from '../../../../components/editor/sql/parser';
import type { VariableAnnotatorInput } from '../../../../components/editor/sql/annotators/variableAnnotator';

function findAll(root: ReturnType<typeof parse>['root'], kind: string): ReturnType<typeof parse>['root'][] {
    const found: ReturnType<typeof parse>['root'][] = [];
    function walk(n: typeof root) {
        if (n.kind === kind) found.push(n);
        for (const c of n.children) walk(c);
    }
    walk(root);
    return found;
}

function makeInput(overrides: Partial<VariableAnnotatorInput> = {}): VariableAnnotatorInput {
    return {
        cellVariables: new Map(),
        workspaceVariables: new Map(),
        cellExports: new Map(),
        ...overrides,
    };
}

// ── annotateVariables ─────────────────────────────────────────────────────────

describe('annotateVariables — variableRef (single $)', () => {
    it('resolves $var from cell variables', () => {
        const { root } = parse('SELECT $limit FROM events');
        annotateVariables(root, makeInput({ cellVariables: new Map([['limit', '100']]) }));
        const vars = findAll(root, 'variableRef');
        expect(vars[0]?.annotations.resolves?.kind).toBe('variable');
        expect(vars[0]?.annotations.resolves?.name).toBe('limit');
        expect(vars[0]?.annotations.resolves?.value).toBe('100');
        expect(vars[0]?.annotations.resolves?.source).toBe('cell');
    });

    it('falls back to workspace when not in cell variables', () => {
        const { root } = parse('SELECT $threshold FROM events');
        annotateVariables(root, makeInput({ workspaceVariables: new Map([['threshold', '500']]) }));
        const vars = findAll(root, 'variableRef');
        expect(vars[0]?.annotations.resolves?.source).toBe('workspace');
        expect(vars[0]?.annotations.resolves?.value).toBe('500');
    });

    it('leaves unresolved when variable not found anywhere', () => {
        const { root } = parse('SELECT $unknown FROM events');
        annotateVariables(root, makeInput());
        const vars = findAll(root, 'variableRef');
        expect(vars[0]?.annotations.resolves).toBeUndefined();
    });

    it('prefers cell variable over workspace variable', () => {
        const { root } = parse('SELECT $v FROM t');
        annotateVariables(root, makeInput({
            cellVariables: new Map([['v', 'cell-value']]),
            workspaceVariables: new Map([['v', 'workspace-value']]),
        }));
        const vars = findAll(root, 'variableRef');
        expect(vars[0]?.annotations.resolves?.value).toBe('cell-value');
        expect(vars[0]?.annotations.resolves?.source).toBe('cell');
    });
});

describe('annotateVariables — doubleDollarRef ($$)', () => {
    it('resolves $$var from workspace variables', () => {
        const { root } = parse('SELECT * FROM events WHERE ts > $$start');
        annotateVariables(root, makeInput({ workspaceVariables: new Map([['start', '0']]) }));
        const vars = findAll(root, 'doubleDollarRef');
        expect(vars[0]?.annotations.resolves?.kind).toBe('variable');
        expect(vars[0]?.annotations.resolves?.source).toBe('workspace');
        expect(vars[0]?.annotations.resolves?.value).toBe('0');
    });

    it('does not resolve $$var from cell variables', () => {
        const { root } = parse('SELECT $$myVar FROM t');
        annotateVariables(root, makeInput({ cellVariables: new Map([['myVar', 'cell']]) }));
        const vars = findAll(root, 'doubleDollarRef');
        // doubleDollarRef only looks in workspaceVariables
        expect(vars[0]?.annotations.resolves).toBeUndefined();
    });

    it('leaves unresolved when $$var not in workspace', () => {
        const { root } = parse('SELECT $$missing FROM t');
        annotateVariables(root, makeInput());
        const vars = findAll(root, 'doubleDollarRef');
        expect(vars[0]?.annotations.resolves).toBeUndefined();
    });
});

describe('annotateVariables — crossCellRef ($cell.var)', () => {
    it('resolves $cell.var from cellExports', () => {
        const { root } = parse('SELECT * FROM t WHERE ts > $gc.threshold');
        const exports = new Map([['gc', new Map([['threshold', '1000']])]]);
        annotateVariables(root, makeInput({ cellExports: exports }));
        const vars = findAll(root, 'crossCellRef');
        expect(vars[0]?.annotations.resolves?.kind).toBe('variable');
        expect(vars[0]?.annotations.resolves?.value).toBe('1000');
        expect(vars[0]?.annotations.resolves?.source).toBe('cell');
    });

    it('marks $cell.brush as gesture source', () => {
        const { root } = parse('SELECT * FROM t WHERE ts IN $gc.brush');
        annotateVariables(root, makeInput({ cellsWithBrush: new Set(['gc']) }));
        const vars = findAll(root, 'crossCellRef');
        if (vars[0]) {
            expect(vars[0].annotations.resolves?.source).toBe('gesture');
        }
    });

    it('leaves unresolved when cell not in exports', () => {
        const { root } = parse('SELECT * FROM t WHERE ts > $missing.val');
        annotateVariables(root, makeInput());
        const vars = findAll(root, 'crossCellRef');
        expect(vars[0]?.annotations.resolves).toBeUndefined();
    });
});

describe('annotateVariables — general', () => {
    it('does not overwrite existing annotations.resolves', () => {
        const { root } = parse('SELECT $v FROM t');
        const vars = findAll(root, 'variableRef');
        if (vars[0]) {
            vars[0].annotations.resolves = { kind: 'variable', name: 'v', value: 'existing', source: 'cell' };
        }
        annotateVariables(root, makeInput({ cellVariables: new Map([['v', 'new']]) }));
        // Should NOT overwrite
        expect(vars[0]?.annotations.resolves?.value).toBe('existing');
    });

    it('handles SQL with no variable refs without throwing', () => {
        const { root } = parse('SELECT 1 FROM t');
        expect(() => annotateVariables(root, makeInput())).not.toThrow();
    });
});
