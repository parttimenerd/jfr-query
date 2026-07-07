import { describe, it, expect } from 'vitest';
import { formatPlotCode } from '../utils/plotFormatter';

interface Case { name: string; in: string; out?: string; }

const CASES: Case[] = [
    // ---- 1-10: simple plot calls ----
    { name: 'line-chart-basic', in: 'line_chart(x:"t",y:["v"])', out: 'LINE_CHART(x: "t", y: ["v"])' },
    { name: 'bar-chart', in: 'bar_chart(x:"c",y:"n")', out: 'BAR_CHART(x: "c", y: "n")' },
    { name: 'scatter', in: 'scatter_plot(x:"a",y:"b")', out: 'SCATTER_PLOT(x: "a", y: "b")' },
    { name: 'heatmap', in: 'heatmap(x:"a",y:"b",value:"c")', out: 'HEATMAP(x: "a", y: "b", value: "c")' },
    { name: 'histogram', in: 'histogram(x:"a")', out: 'HISTOGRAM(x: "a")' },
    { name: 'boxplot', in: 'box_plot(y:"v")', out: 'BOX_PLOT(y: "v")' },
    { name: 'pie', in: 'pie_chart(name:"a",value:"b")', out: 'PIE_CHART(name: "a", value: "b")' },
    { name: 'area', in: 'area_chart(x:"t",y:"v")', out: 'AREA_CHART(x: "t", y: "v")' },
    { name: 'gantt', in: 'gantt_chart(start:"a",end:"b")', out: 'GANTT_CHART(start: "a", end: "b")' },
    { name: 'table', in: 'table()', out: 'TABLE()' },

    // ---- 11-20: casing tolerance ----
    { name: 'already-upper', in: 'LINE_CHART(x: "t", y: ["v"])', out: 'LINE_CHART(x: "t", y: ["v"])' },
    { name: 'mixed-case-shape', in: 'Line_Chart(x:"a",y:"b")', out: 'LINE_CHART(x: "a", y: "b")' },
    { name: 'upper-keys-stay-lower', in: 'LINE_CHART(X: "a", Y: "b")', out: 'LINE_CHART(x: "a", y: "b")' },
    { name: 'mixed-case-bar', in: 'BAR_chart(x: "a")', out: 'BAR_CHART(x: "a")' },
    { name: 'mixed-tail-keyword', in: 'table() Title "x"', out: 'TABLE() TITLE "x"' },
    { name: 'lower-tail-keyword-via-pipe', in: 'table() | title: "x"' },
    { name: 'pie-uppercase-name', in: 'PIE_CHART(NAME: "a", VALUE: "b")', out: 'PIE_CHART(name: "a", value: "b")' },
    { name: 'all-caps-input', in: 'TABLE() TITLE "X"', out: 'TABLE() TITLE "X"' },
    { name: 'snake-line', in: 'line(x:"a",y:"b")', out: 'LINE(x: "a", y: "b")' },
    { name: 'snake-bar', in: 'bar(x:"a",y:"b")', out: 'BAR(x: "a", y: "b")' },

    // ---- 21-30: spacing ----
    { name: 'no-space-key', in: 'line_chart(x:"a",y:"b")', out: 'LINE_CHART(x: "a", y: "b")' },
    { name: 'extra-space-key', in: 'line_chart(  x  :  "a"  ,  y  :  "b"  )', out: 'LINE_CHART(x: "a", y: "b")' },
    { name: 'space-before-comma', in: 'line_chart(x:"a" ,y:"b")', out: 'LINE_CHART(x: "a", y: "b")' },
    { name: 'space-after-comma-only', in: 'line_chart(x: "a", y: "b")', out: 'LINE_CHART(x: "a", y: "b")' },
    { name: 'empty-array', in: 'line_chart(x:"t",y:[])', out: 'LINE_CHART(x: "t", y: [])' },
    { name: 'one-elem-array', in: 'line_chart(x:"t",y:["v"])', out: 'LINE_CHART(x: "t", y: ["v"])' },
    { name: 'multi-elem-array', in: 'line_chart(x:"t",y:["a","b","c"])', out: 'LINE_CHART(x: "t", y: ["a", "b", "c"])' },
    { name: 'array-with-spaces', in: 'line_chart(x:"t",y:[ "a" ,  "b" ])', out: 'LINE_CHART(x: "t", y: ["a", "b"])' },
    { name: 'numeric-value', in: 'line_chart(x:"t",y:"v",width:300)', out: 'LINE_CHART(x: "t", y: "v", width: 300)' },
    { name: 'boolean-value', in: 'line_chart(x:"t",y:"v",disabled:true)', out: 'LINE_CHART(x: "t", y: "v", disabled: true)' },

    // ---- 31-40: tail keywords (uppercase form) ----
    { name: 'tail-title', in: 'table() title "My Title"', out: 'TABLE() TITLE "My Title"' },
    { name: 'tail-name', in: 'table() name "x"', out: 'TABLE() NAME "x"' },
    { name: 'tail-width', in: 'table() width "500px"', out: 'TABLE() WIDTH "500px"' },
    { name: 'tail-height', in: 'table() height "300px"', out: 'TABLE() HEIGHT "300px"' },
    { name: 'tail-zoom', in: 'table() zoom "100%"', out: 'TABLE() ZOOM "100%"' },
    { name: 'tail-link-x', in: 'table() link_x "g1"', out: 'TABLE() LINK_X "g1"' },
    { name: 'tail-link-y', in: 'table() link_y "g1"', out: 'TABLE() LINK_Y "g1"' },
    { name: 'tail-link-xy', in: 'table() link_xy "g1"', out: 'TABLE() LINK_XY "g1"' },
    { name: 'multiple-tails', in: 'table() title "x" height "200px"', out: 'TABLE() TITLE "x" HEIGHT "200px"' },

    // ---- 41-50: lowercase tails (pipe-syntax) ----
    { name: 'pipe-title', in: 'table() | title: "x"' },
    { name: 'pipe-name', in: 'table() | name: "x"' },
    { name: 'pipe-width', in: 'table() | width: "500px"' },
    { name: 'pipe-height', in: 'table() | height: "300px"' },
    { name: 'pipe-hyphen-link-x', in: 'table() | link-x: "g1"' },
    { name: 'pipe-hyphen-link-y', in: 'table() | link-y: "g1"' },
    { name: 'pipe-hyphen-link-xy', in: 'table() | link-xy: "g1"' },
    { name: 'pipe-zoom', in: 'table() | zoom: "100%"' },
    { name: 'pipe-multi-tails', in: 'table() | title: "x" | height: "200px"' },
    { name: 'pipe-disabled', in: 'table() | disabled: true' },

    // ---- 51-60: LET ----
    { name: 'let-num', in: 'let @x = 1', out: 'LET @x = 1' },
    { name: 'let-string', in: 'let @x = "hi"', out: 'LET @x = "hi"' },
    { name: 'let-expr', in: 'let @x = 1 + 2', out: 'LET @x = 1 + 2' },
    { name: 'let-arr', in: 'let @x = [1, 2, 3]', out: 'LET @x = [1, 2, 3]' },
    { name: 'let-then-plot', in: 'let @x = 1\ntable()' },
    { name: 'two-lets', in: 'let @a = 1\nlet @b = 2' },
    { name: 'let-with-comment', in: 'let @x = 1' },
    { name: 'let-uppercased', in: 'LET @x = 1', out: 'LET @x = 1' },
    { name: 'let-mixed-case', in: 'Let @y = 2', out: 'LET @y = 2' },
    { name: 'let-dollar-ref', in: 'let @x = $cell.foo' },

    // ---- 61-70: composites (row/col) ----
    { name: 'row-simple', in: 'row { table() ; table() }' },
    { name: 'col-simple', in: 'col { table() ; table() }' },
    { name: 'row-no-semi', in: 'row { table() table() }' },
    { name: 'row-three', in: 'row { table() table() table() }' },
    { name: 'row-nested-col', in: 'row { col { table() table() } table() }' },
    { name: 'row-with-tail', in: 'row { table() table() } title "x"' },
    { name: 'col-nested', in: 'col { row { table() } row { table() } }' },
    { name: 'row-with-let', in: 'let @h = "200px"\nrow { table() table() }' },
    { name: 'row-mixed-case', in: 'ROW { TABLE() TABLE() }' },
    { name: 'col-mixed-case', in: 'COL { TABLE() }' },

    // ---- 71-80: overlay (+) ----
    { name: 'overlay-simple', in: 'line_chart(x:"t",y:"a") + line_chart(x:"t",y:"b")', out: 'LINE_CHART(x: "t", y: "a") + LINE_CHART(x: "t", y: "b")' },
    { name: 'overlay-no-space', in: 'line_chart(x:"t",y:"a")+line_chart(x:"t",y:"b")', out: 'LINE_CHART(x: "t", y: "a") + LINE_CHART(x: "t", y: "b")' },
    { name: 'overlay-three', in: 'line_chart(x:"t",y:"a") + line_chart(x:"t",y:"b") + bar_chart(x:"t",y:"c")' },
    { name: 'overlay-with-tail', in: 'line_chart(x:"t",y:"a") + line_chart(x:"t",y:"b") title "combined"' },
    { name: 'overlay-mixed-shapes', in: 'bar_chart(x:"a",y:"b") + line_chart(x:"a",y:"c")' },
    { name: 'overlay-scatter-line', in: 'scatter_plot(x:"a",y:"b") + line(x:"a",y:"c")' },
    { name: 'overlay-area-line', in: 'area(x:"a",y:"b") + line(x:"a",y:"c")' },
    { name: 'overlay-with-color', in: 'line_chart(x:"a",y:"b",color:"c") + line_chart(x:"a",y:"d",color:"e")' },
    { name: 'overlay-with-width', in: 'line_chart(x:"a",y:"b") + line_chart(x:"a",y:"c") width "800px"' },
    { name: 'overlay-already-canonical', in: 'LINE_CHART(x: "a", y: "b") + LINE_CHART(x: "a", y: "c")', out: 'LINE_CHART(x: "a", y: "b") + LINE_CHART(x: "a", y: "c")' },

    // ---- 81-90: strings, dollar vars, refs ----
    { name: 'single-quoted', in: "table() title 'My'", out: "TABLE() TITLE 'My'" },
    { name: 'double-quoted', in: 'table() title "My"', out: 'TABLE() TITLE "My"' },
    { name: 'dollar-var', in: 'line_chart(x: "t", y: "v", color: $host)' },
    { name: 'dollar-cross-cell', in: 'line_chart(x: "t", y: "v", color: $cell.host)' },
    { name: 'const-ref-hash', in: 'table() | name: gc' },
    { name: 'hash-ref', in: 'table() | link-x: #brush1' },
    { name: 'numeric-color', in: 'line_chart(x: "t", y: "v", color: "#ff0")' },
    { name: 'array-of-numbers', in: 'line_chart(x: "t", y: [1, 2, 3])', out: 'LINE_CHART(x: "t", y: [1, 2, 3])' },
    { name: 'mixed-array', in: 'line_chart(x: "t", y: ["a", 1, true])', out: 'LINE_CHART(x: "t", y: ["a", 1, true])' },
    { name: 'long-string', in: 'table() title "a very long title with spaces and punctuation: yes, it works!"' },

    // ---- 91-100: edge / idempotence anchors ----
    { name: 'no-args', in: 'table()', out: 'TABLE()' },
    { name: 'trailing-whitespace', in: 'table()   ', out: 'TABLE()' },
    { name: 'leading-whitespace', in: '   table()', out: 'TABLE()' },
    { name: 'tabs-and-newlines', in: '\tline_chart(\n\tx: "a",\n\ty: "b"\n)', out: 'LINE_CHART(x: "a", y: "b")' },
    { name: 'flamegraph', in: 'flamegraph(name: "fn", value: "samples")', out: 'FLAMEGRAPH(name: "fn", value: "samples")' },
    { name: 'range-plot', in: 'range_plot(x: "t", y: ["a", "b"])', out: 'RANGE_PLOT(x: "t", y: ["a", "b"])' },
    { name: 'preserved-string-escape', in: 'table() title "a \\"b\\""' },
    { name: 'many-keys', in: 'line_chart(x:"t",y:"v",color:"c",size:"s",shape:"h")' },
    { name: 'nested-composite', in: 'row { col { table() } col { table() table() } }' },
    { name: 'three-level-composite', in: 'row { col { row { table() } } col { table() } }' },

    // ---- 101-110: extras ----
    { name: 'comment-stripped', in: 'table() // a comment', out: 'TABLE()' },
    { name: 'hash-comment-stripped', in: 'table() # a comment', out: 'TABLE()' },
    { name: 'multi-line-input-compressed', in: 'line_chart(\n  x: "a",\n  y: "b"\n)', out: 'LINE_CHART(x: "a", y: "b")' },
    { name: 'tab-indented', in: '\ttable()\t', out: 'TABLE()' },
    { name: 'lower-and-upper-mix', in: 'line_CHART(X: "a", y: "b")', out: 'LINE_CHART(x: "a", y: "b")' },
    { name: 'pie-snake', in: 'pie(name: "a", value: "b")', out: 'PIE(name: "a", value: "b")' },
    { name: 'gantt-snake', in: 'gantt(start: "s", end: "e")', out: 'GANTT(start: "s", end: "e")' },
    { name: 'range-snake', in: 'range(x: "t", y: ["a", "b"])', out: 'RANGE(x: "t", y: ["a", "b"])' },
    { name: 'boxplot-snake', in: 'boxplot(y: "v")', out: 'BOXPLOT(y: "v")' },
    { name: 'area-snake', in: 'area(x: "t", y: "v")', out: 'AREA(x: "t", y: "v")' },
];

describe('Plot formatter — corpus', () => {
    for (const c of CASES) {
        it(c.name, () => {
            const formatted = formatPlotCode(c.in);
            if (c.out !== undefined) {
                expect(formatted).toBe(c.out);
            }
            // Idempotence
            expect(formatPlotCode(formatted)).toBe(formatted);
            // Validation gate safety
            if (c.in.trim()) expect(formatted.length).toBeGreaterThan(0);
        });
    }
});

describe('Plot formatter — anchors', () => {
    it('uppercases known plot shapes', () => {
        expect(formatPlotCode('line_chart(x:"t")')).toContain('LINE_CHART(');
        expect(formatPlotCode('bar_chart(x:"t")')).toContain('BAR_CHART(');
        expect(formatPlotCode('scatter_plot(x:"a")')).toContain('SCATTER_PLOT(');
    });

    it('uppercases tail keywords', () => {
        const out = formatPlotCode('table() title "x" height "300px"');
        expect(out).toContain('TITLE');
        expect(out).toContain('HEIGHT');
    });

    it('lowercases composite row/col', () => {
        expect(formatPlotCode('ROW { TABLE() }')).toMatch(/^row\s*\{/);
        expect(formatPlotCode('COL { TABLE() }')).toMatch(/^col\s*\{/);
    });

    it('inserts space after colon and comma', () => {
        const out = formatPlotCode('line_chart(x:"a",y:"b")');
        expect(out).toContain('x: "a"');
        expect(out).toContain(', y:');
    });

    it('handles empty input', () => {
        expect(formatPlotCode('')).toBe('');
    });

    it('keeps array elements inline when call args break across lines', () => {
        // Regression: commas inside [...] were broken onto new lines along with
        // top-level clause commas when total call length exceeded the threshold.
        const input = 'BAR_CHART(x: "cause", y: ["count", "avg_ms"], layout: "grouped") TITLE "GC Causes"';
        const out = formatPlotCode(input);
        expect(out).toContain('y: ["count", "avg_ms"]');
        expect(out).toContain('\n');
    });
});
