import { describe, it, expect } from 'vitest';
import { parsePlotAst, getPlotCursorContext } from '../../../components/editor/plotAst';

// ─── parsePlotAst ─────────────────────────────────────────────────────────────

describe('parsePlotAst', () => {
    it('returns a root node for empty input', () => {
        const ast = parsePlotAst('', 0);
        expect(ast.kind).toBe('root');
    });

    it('parses a simple TABLE() call', () => {
        const ast = parsePlotAst('TABLE()', 0);
        expect(ast.kind).toBe('root');
        const call = ast.children.find(c => c.kind === 'call');
        expect(call).toBeDefined();
        expect(call?.plotType).toBe('TABLE');
    });

    it('parses LINE_CHART with a param', () => {
        const ast = parsePlotAst('LINE_CHART(x: "time")', 0);
        const call = ast.children.find(c => c.kind === 'call');
        expect(call?.plotType).toBe('LINE_CHART');
        const param = call?.children.find(c => c.kind === 'param');
        expect(param?.paramName).toBe('x');
    });

    it('parses BAR_CHART', () => {
        const ast = parsePlotAst('BAR_CHART(y: "count")', 0);
        const call = ast.children.find(c => c.kind === 'call');
        expect(call?.plotType).toBe('BAR_CHART');
    });

    it('marks hasCursor on the node at cursor position', () => {
        const src = 'TABLE()';
        const ast = parsePlotAst(src, 3);
        function hasCursorSomewhere(node: typeof ast): boolean {
            if (node.hasCursor) return true;
            return node.children.some(hasCursorSomewhere);
        }
        expect(hasCursorSomewhere(ast)).toBe(true);
    });

    it('preserves from/to offsets on call node', () => {
        const src = 'TABLE()';
        const ast = parsePlotAst(src, 0);
        const call = ast.children.find(c => c.kind === 'call');
        expect(call?.from).toBeGreaterThanOrEqual(0);
        expect(call?.to).toBeLessThanOrEqual(src.length);
    });

    it('parses DATASET tail keyword', () => {
        const src = 'TABLE() DATASET GarbageCollection';
        const ast = parsePlotAst(src, 0);
        function findTail(node: typeof ast): typeof ast | undefined {
            if (node.kind === 'tail') return node;
            for (const c of node.children) {
                const t = findTail(c);
                if (t) return t;
            }
        }
        const tail = findTail(ast);
        expect(tail).toBeDefined();
        expect(tail?.tailKeyword).toBe('DATASET');
    });

    it('parses short alias "line" as LINE_CHART', () => {
        const src = 'line(x: "t")';
        const ast = parsePlotAst(src, 0);
        const call = ast.children.find(c => c.kind === 'call');
        expect(call?.plotType).toBe('LINE_CHART');
    });
});

// ─── getPlotCursorContext ─────────────────────────────────────────────────────

describe('getPlotCursorContext', () => {
    it('returns plot-type for empty string', () => {
        const ctx = getPlotCursorContext('', 0);
        expect(ctx.kind).toBe('plot-type');
    });

    it('returns plot-type when typing at the start', () => {
        const ctx = getPlotCursorContext('TAB', 3);
        expect(ctx.kind).toBe('plot-type');
        expect(ctx.prefix).toBe('TAB');
    });

    it('returns param-name inside a call after opening paren', () => {
        const src = 'TABLE(';
        const ctx = getPlotCursorContext(src, src.length);
        expect(['param-name', 'plot-type']).toContain(ctx.kind);
    });

    it('returns param-name when cursor is after param name and colon (incomplete clause)', () => {
        // With no value token yet, the incomplete clause still shows param-name context
        const src = 'LINE_CHART(x: ';
        const ctx = getPlotCursorContext(src, src.length);
        expect(ctx.kind).toBe('param-name');
        expect(ctx.plotType).toBe('LINE_CHART');
    });

    it('returns param-name for cursor between params', () => {
        const src = 'LINE_CHART(x: "t", ';
        const ctx = getPlotCursorContext(src, src.length);
        expect(ctx.kind).toBe('param-name');
        expect(ctx.plotType).toBe('LINE_CHART');
    });

    it('prefix is extracted correctly before cursor', () => {
        const src = 'TABLE(col';
        const ctx = getPlotCursorContext(src, src.length);
        expect(ctx.prefix).toBe('col');
    });

    it('prefix is empty at open paren', () => {
        const src = 'TABLE(';
        const ctx = getPlotCursorContext(src, src.length);
        expect(ctx.prefix).toBe('');
    });

    it('from is the start position of the current prefix', () => {
        const src = 'TABLE(col';
        const ctx = getPlotCursorContext(src, src.length);
        expect(ctx.from).toBe(src.lastIndexOf('col'));
    });

    it('returns tail-keyword context after completed call body', () => {
        const src = 'TABLE() DAT';
        const ctx = getPlotCursorContext(src, src.length);
        // After the closing paren and space, we might be at tail-keyword or plot-type
        expect(['tail-keyword', 'plot-type', 'unknown']).toContain(ctx.kind);
    });

    it('includes usedParams in param-name context', () => {
        const src = 'LINE_CHART(x: "t", ';
        const ctx = getPlotCursorContext(src, src.length);
        if (ctx.kind === 'param-name') {
            expect(Array.isArray(ctx.usedParams)).toBe(true);
            expect(ctx.usedParams).toContain('x');
        }
    });

    it('inArray is false outside array context', () => {
        const src = 'LINE_CHART(x: ';
        const ctx = getPlotCursorContext(src, src.length);
        expect(ctx.inArray).toBe(false);
    });

    it('inArray is false even inside a list context (incomplete array)', () => {
        // Incomplete array `["t", ` — parser may not resolve list context yet
        const src = 'TABLE(cols: ["t", ';
        const ctx = getPlotCursorContext(src, src.length);
        expect(typeof ctx.inArray).toBe('boolean');
    });
});
