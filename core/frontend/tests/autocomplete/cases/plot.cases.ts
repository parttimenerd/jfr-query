import type { AutocompleteCase } from '../harness';

// Plot DSL cases. Default result columns: ts, cpu, host.
// `|` marks the cursor.

export const plotCases: AutocompleteCase[] = [
    // --- Tier: plot-toplevel ---
    {
        name: 'empty-doc-offers-plot-shapes',
        kind: 'plot',
        tier: 'plot-toplevel',
        input: '|',
        expected: { contains: ['LINE_CHART', 'BAR_CHART'] },
    },
    {
        name: 'empty-doc-offers-row-col',
        kind: 'plot',
        tier: 'plot-toplevel',
        input: '|',
        expected: { contains: ['row', 'col'] },
    },
    {
        name: 'half-typed-line',
        kind: 'plot',
        tier: 'plot-toplevel',
        input: 'LINE|',
        expected: { contains: ['LINE_CHART'] },
    },

    // --- Tier: plot-body ---
    {
        name: 'line-x-value-offers-columns',
        kind: 'plot',
        tier: 'plot-body',
        input: 'LINE_CHART(x: |)',
        expected: { contains: ['ts', 'cpu', 'host'] },
    },
    {
        name: 'line-y-value-offers-columns',
        kind: 'plot',
        tier: 'plot-body',
        input: 'LINE_CHART(x: "ts", y: |)',
        expected: { contains: ['cpu', 'host'] },
    },
    {
        name: 'line-second-clause-key',
        kind: 'plot',
        tier: 'plot-body',
        input: 'LINE_CHART(x: "ts", |)',
        expected: { matchesRegex: /^(y|color|category)/i },
    },
    {
        name: 'bar-x-offers-columns',
        kind: 'plot',
        tier: 'plot-body',
        input: 'BAR_CHART(x: |)',
        expected: { contains: ['host', 'ts', 'cpu'] },
    },
    {
        name: 'scatter-x-offers-columns',
        kind: 'plot',
        tier: 'plot-body',
        input: 'SCATTER_PLOT(x: |)',
        expected: { contains: ['ts', 'cpu'] },
    },
    {
        name: 'histogram-value-offers-columns',
        kind: 'plot',
        tier: 'plot-body',
        input: 'HISTOGRAM(value: |)',
        expected: { contains: ['cpu', 'ts'] },
    },
    {
        name: 'box-value-offers-columns',
        kind: 'plot',
        tier: 'plot-body',
        input: 'BOX_PLOT(value: |)',
        expected: { contains: ['cpu', 'ts'] },
    },
    {
        name: 'partial-column-value',
        kind: 'plot',
        tier: 'plot-body',
        input: 'LINE_CHART(x: "t|")',
        expected: { contains: ['ts'] },
    },
    {
        name: 'pie-value-offers-columns',
        kind: 'plot',
        tier: 'plot-body',
        input: 'PIE_CHART(value: |)',
        expected: { contains: ['cpu'] },
    },

    // --- Tier: plot-clause ---
    {
        name: 'tail-key-after-plot-call',
        kind: 'plot',
        tier: 'plot-clause',
        input: 'LINE_CHART(x: "ts", y: "cpu") |',
        expected: { matchesRegex: /^(TITLE|NAME|HEIGHT|WIDTH|LINK_X|LINK_Y|ON)$/i },
    },
    {
        name: 'tail-key-partial',
        kind: 'plot',
        tier: 'plot-clause',
        input: 'LINE_CHART(x: "ts", y: "cpu") TIT|',
        expected: { contains: ['TITLE'] },
    },
    {
        name: 'name-tail-empty-value',
        kind: 'plot',
        tier: 'plot-clause',
        input: 'LINE_CHART(x: "ts", y: "cpu") NAME |',
        expected: {},
    },

    // --- Tier: plot-composite ---
    {
        name: 'row-body-offers-plots',
        kind: 'plot',
        tier: 'plot-composite',
        input: 'row { |',
        expected: { contains: ['LINE_CHART', 'BAR_CHART'] },
    },
    {
        name: 'col-body-offers-plots',
        kind: 'plot',
        tier: 'plot-composite',
        input: 'col { |',
        expected: { contains: ['LINE_CHART', 'BAR_CHART'] },
    },
    {
        name: 'row-after-first-plot-offers-second',
        kind: 'plot',
        tier: 'plot-composite',
        input: 'row { LINE_CHART(x: "ts", y: "cpu") |',
        expected: { matchesRegex: /LINE_CHART|TITLE|NAME/ },
    },
    {
        name: 'nested-row-col',
        kind: 'plot',
        tier: 'plot-composite',
        input: 'row { col { |',
        expected: { contains: ['LINE_CHART'] },
    },
    {
        name: 'row-inner-plot-param-offers-cols',
        kind: 'plot',
        tier: 'plot-composite',
        // Inside row's inner LINE_CHART's x: param, cell result cols must appear.
        input: 'row { LINE_CHART(x: |',
        expected: { contains: ['ts', 'cpu', 'host'] },
    },
    {
        name: 'col-inner-plot-second-clause-key',
        kind: 'plot',
        tier: 'plot-composite',
        // After `x: "ts",` inside a col-wrapped plot, completion should offer
        // remaining clause keys (y, color, ...).
        input: 'col { LINE_CHART(x: "ts", |',
        expected: { matchesRegex: /^(y|color|category)/i },
    },
    {
        name: 'unclosed-line-second-clause-key',
        kind: 'plot',
        tier: 'plot-body',
        // Top-level plot with unclosed paren — cursor after comma should offer
        // clause keys, not plot shapes.
        input: 'LINE_CHART(x: "ts", |',
        expected: { matchesRegex: /^(y|color|category)/i, excludes: ['LINE_CHART', 'BAR_CHART'] },
    },

    // --- Tier: plot-variables ---
    {
        name: 'variable-after-dollar',
        kind: 'plot',
        tier: 'plot-variables',
        input: 'LINE_CHART(x: "ts", y: $|)',
        variables: { threshold: '0.5' },
        expected: { contains: ['$threshold'] },
    },
    {
        name: 'const-after-at',
        kind: 'plot',
        tier: 'plot-variables',
        input: 'LET @max = 100\nLINE_CHART(x: "ts", y: "cpu") HEIGHT @|',
        expected: { contains: ['@max'] },
    },

    // --- Tier: plot-link ---
    {
        name: 'link-x-takes-variables',
        kind: 'plot',
        tier: 'plot-link',
        input: 'LINE_CHART(x: "ts", y: "cpu") LINK_X |',
        variables: { brush: 'a' },
        expected: { contains: ['$brush'] },
    },
    {
        name: 'link-x-paren-empty-offers-brush-refs',
        kind: 'plot',
        tier: 'plot-link',
        input: 'LINE_CHART(x: "ts", y: "cpu") LINK_X(|)',
        plotScope: {
            namedPlots: [],
            queryRefs: [],
            variables: new Map(),
            brushes: new Map([
                ['gc', { plotName: 'gc', cellId: 'c0', xType: 'timestamp', yType: 'number' }],
            ]),
        },
        expected: { contains: ['$gc.brush.lo', '$gc.brush.hi'] },
    },
    {
        name: 'link-y-paren-empty-offers-brush-refs',
        kind: 'plot',
        tier: 'plot-link',
        input: 'LINE_CHART(x: "ts", y: "cpu") LINK_Y(|)',
        plotScope: {
            namedPlots: [
                { plotName: 'lat', cellId: 'c0', plotIndexInCell: 0, shape: 'line', hasBrush: true, brushVarName: 'latBrush' },
            ],
            queryRefs: [],
            variables: new Map(),
            brushes: new Map([
                ['lat', { plotName: 'lat', cellId: 'c0', xType: 'timestamp', yType: 'number' }],
            ]),
        },
        expected: { contains: ['$latBrush'] },
    },
    {
        name: 'link-x-paren-mixes-vars-and-brushes',
        kind: 'plot',
        tier: 'plot-link',
        input: 'LINE_CHART(x: "ts", y: "cpu") LINK_X(|)',
        plotScope: {
            namedPlots: [],
            queryRefs: [],
            variables: new Map([
                ['cutoff', { name: 'cutoff', scope: 'cellLocal', value: '0.5', dataType: 'number' }],
            ]),
            brushes: new Map([
                ['gc', { plotName: 'gc', cellId: 'c0', xType: 'timestamp', yType: 'number' }],
            ]),
        },
        expected: { contains: ['$cutoff', '$gc.brush.lo', '$gc.brush.hi'] },
    },
    {
        name: 'link-x-paren-partial-brush-name-filters',
        kind: 'plot',
        tier: 'plot-link',
        // Typing `$g` should filter to brush refs starting with `g`.
        input: 'LINE_CHART(x: "ts", y: "cpu") LINK_X($g|)',
        plotScope: {
            namedPlots: [],
            queryRefs: [],
            variables: new Map(),
            brushes: new Map([
                ['gc', { plotName: 'gc', cellId: 'c0', xType: 'timestamp', yType: 'number' }],
                ['latency', { plotName: 'latency', cellId: 'c0', xType: 'timestamp', yType: 'number' }],
            ]),
        },
        expected: { contains: ['$gc.brush.lo', '$gc.brush.hi'], excludes: ['$latency.brush.lo'] },
    },
    {
        name: 'link-xy-paren-empty-offers-brush-refs',
        kind: 'plot',
        tier: 'plot-link',
        input: 'LINE_CHART(x: "ts", y: "cpu") LINK_XY(|)',
        plotScope: {
            namedPlots: [
                { plotName: 'gc', cellId: 'c0', plotIndexInCell: 0, shape: 'line', hasBrush: true, brushVarName: 'gcBrush' },
            ],
            queryRefs: [],
            variables: new Map(),
            brushes: new Map([
                ['gc', { plotName: 'gc', cellId: 'c0', xType: 'timestamp', yType: 'number' }],
            ]),
        },
        expected: { contains: ['$gcBrush'] },
    },
    {
        name: 'link-x-paren-multiple-brushes',
        kind: 'plot',
        tier: 'plot-link',
        input: 'LINE_CHART(x: "ts", y: "cpu") LINK_X(|)',
        plotScope: {
            namedPlots: [],
            queryRefs: [],
            variables: new Map(),
            brushes: new Map([
                ['gc', { plotName: 'gc', cellId: 'c0', xType: 'timestamp', yType: 'number' }],
                ['lat', { plotName: 'lat', cellId: 'c0', xType: 'timestamp', yType: 'number' }],
            ]),
        },
        expected: { contains: ['$gc.brush.lo', '$gc.brush.hi', '$lat.brush.lo', '$lat.brush.hi'] },
    },

    // --- Tier: plot-onarg ---
    {
        name: 'on-arg-query-ref',
        kind: 'plot',
        tier: 'plot-onarg',
        input: 'LINE_CHART(x: "ts", y: "cpu") ON |',
        sqlBlockCount: 3,
        expected: { matchesRegex: /^#\d+$/ },
    },

    // --- Tier: plot-fuzzy ---
    {
        name: 'lowercase-line-chart',
        kind: 'plot',
        tier: 'plot-fuzzy',
        input: 'line_ch|',
        expected: { contains: ['LINE_CHART'] },
    },
    {
        name: 'partial-bar',
        kind: 'plot',
        tier: 'plot-fuzzy',
        input: 'BAR|',
        expected: { contains: ['BAR_CHART'] },
    },
    {
        name: 'partial-scatter',
        kind: 'plot',
        tier: 'plot-fuzzy',
        input: 'SCAT|',
        expected: { contains: ['SCATTER_PLOT'] },
    },
    {
        name: 'partial-pie',
        kind: 'plot',
        tier: 'plot-fuzzy',
        input: 'PIE|',
        expected: { contains: ['PIE_CHART'] },
    },
    {
        name: 'partial-histogram',
        kind: 'plot',
        tier: 'plot-fuzzy',
        input: 'HIST|',
        expected: { contains: ['HISTOGRAM'] },
    },
    {
        name: 'partial-heatmap',
        kind: 'plot',
        tier: 'plot-fuzzy',
        input: 'HEAT|',
        expected: { contains: ['HEATMAP'] },
    },
    {
        name: 'partial-table',
        kind: 'plot',
        tier: 'plot-fuzzy',
        input: 'TAB|',
        expected: { contains: ['TABLE'] },
    },
    {
        name: 'typo-bar-chrt',
        kind: 'plot',
        tier: 'plot-fuzzy',
        input: 'BAR_CHRT|',
        expected: { contains: ['BAR_CHART'] },
    },
    {
        name: 'typo-line-chrt',
        kind: 'plot',
        tier: 'plot-fuzzy',
        input: 'LINE_CHRT|',
        expected: { contains: ['LINE_CHART'] },
    },
    {
        name: 'typo-histgram',
        kind: 'plot',
        tier: 'plot-fuzzy',
        input: 'HISTGRAM|',
        expected: { contains: ['HISTOGRAM'] },
    },
    {
        name: 'no-fuzzy-when-too-different',
        kind: 'plot',
        tier: 'plot-fuzzy',
        input: 'XXXX|',
        expected: { empty: true },
    },

    // --- Tier: plot-edge ---
    {
        name: 'partial-clause-key-inside-call',
        kind: 'plot',
        tier: 'plot-edge',
        input: 'LINE_CHART(x: "ts", co|)',
        expected: { matchesRegex: /^color$/i },
    },
    {
        name: 'param-value-after-equals-quoted',
        kind: 'plot',
        tier: 'plot-edge',
        input: 'LINE_CHART(x: "t|"',
        expected: { contains: ['ts'] },
    },
    {
        name: 'overlay-plus-second-shape',
        kind: 'plot',
        tier: 'plot-edge',
        input: 'LINE_CHART(x: "ts", y: "cpu") + |',
        expected: { contains: ['LINE_CHART', 'BAR_CHART'] },
    },
    {
        name: 'row-second-child-after-comma',
        kind: 'plot',
        tier: 'plot-edge',
        input: 'row { LINE_CHART(x: "ts", y: "cpu"); |',
        expected: { contains: ['LINE_CHART', 'BAR_CHART'] },
    },
    {
        name: 'nested-col-inside-row',
        kind: 'plot',
        tier: 'plot-edge',
        input: 'row { col { |',
        expected: { contains: ['LINE_CHART'] },
    },
    {
        name: 'let-name-after-at',
        kind: 'plot',
        tier: 'plot-edge',
        input: 'LET @|',
        expected: {},
    },
    {
        name: 'name-clause-empty',
        kind: 'plot',
        tier: 'plot-edge',
        input: 'LINE_CHART(x: "ts", y: "cpu") NAME |',
        expected: {},
    },

    // --- Tier: plot-options ---
    // Verify enumerated option values from plotRegistry params appear in completion.
    {
        name: 'yscale-offers-linear-log',
        kind: 'plot',
        tier: 'plot-options',
        input: 'LINE_CHART(x: "ts", y: "cpu", yScale: |)',
        expected: { contains: ['linear', 'log'] },
    },
    {
        name: 'yscale-partial-filters',
        kind: 'plot',
        tier: 'plot-options',
        input: 'LINE_CHART(x: "ts", y: "cpu", yScale: li|)',
        expected: { contains: ['linear'], excludes: ['log'] },
    },
    {
        name: 'bar-layout-offers-stacked-grouped',
        kind: 'plot',
        tier: 'plot-options',
        input: 'BAR_CHART(x: "host", y: ["cpu"], layout: |)',
        expected: { contains: ['stacked', 'grouped'] },
    },
    {
        name: 'pie-slicelabel-offers-positions',
        kind: 'plot',
        tier: 'plot-options',
        input: 'PIE_CHART(category: "host", value: "cpu", sliceLabel: |)',
        expected: { contains: ['inside', 'outside', 'none'] },
    },
    {
        name: 'linetype-offers-line-dots',
        kind: 'plot',
        tier: 'plot-options',
        input: 'LINE_CHART(x: "ts", y: "cpu", lineType: |)',
        expected: { contains: ['line', 'dots'] },
    },
    {
        name: 'area-layout-offers-stacked-overlay',
        kind: 'plot',
        tier: 'plot-options',
        input: 'AREA_CHART(x: "ts", y: ["cpu"], layout: |)',
        expected: { contains: ['stacked', 'overlay'] },
    },
    {
        name: 'flamegraph-direction-offers-up-down',
        kind: 'plot',
        tier: 'plot-options',
        input: 'FLAMEGRAPH(frame: "host", value: "cpu", direction: |)',
        expected: { contains: ['up', 'down'] },
    },

    // --- Tier: plot-tail-complex ---
    // Test tail keys that interact with scope (BRUSH, LINK_X with master/clamp,
    // ON with aliased query refs).
    {
        name: 'brush-tail-key-appears',
        kind: 'plot',
        tier: 'plot-tail-complex',
        input: 'LINE_CHART(x: "ts", y: "cpu") B|',
        expected: { contains: ['BRUSH'] },
    },
    {
        name: 'link-x-offers-master-clamp-after-two-vars',
        kind: 'plot',
        tier: 'plot-tail-complex',
        // After two variable args, LINK_X should offer 'master' and 'clamp'.
        input: 'LINE_CHART(x: "ts", y: "cpu") LINK_X($lo, $hi, |)',
        plotScope: {
            namedPlots: [],
            queryRefs: [],
            variables: new Map([
                ['lo', { name: 'lo', scope: 'cellLocal', value: '0', dataType: 'number' }],
                ['hi', { name: 'hi', scope: 'cellLocal', value: '100', dataType: 'number' }],
            ]),
            brushes: new Map(),
        },
        expected: { matchesRegex: /master|clamp/i },
    },
    {
        name: 'on-arg-query-alias',
        kind: 'plot',
        tier: 'plot-tail-complex',
        // ON should offer #alias labels when the scope has them.
        input: 'LINE_CHART(x: "ts", y: "cpu") ON |',
        plotScope: {
            namedPlots: [],
            queryRefs: [
                { index: 1, cellId: 'c0', sql: 'SELECT ts, cpu FROM events', alias: 'base' },
                { index: 2, cellId: 'c0', sql: 'SELECT ts, cpu FROM requests', alias: undefined },
            ],
            variables: new Map(),
            brushes: new Map(),
        },
        expected: { contains: ['#1', '#base', '#2'] },
    },
    {
        name: 'on-arg-alias-label',
        kind: 'plot',
        tier: 'plot-tail-complex',
        // Partial `#b` should filter to #base.
        input: 'LINE_CHART(x: "ts", y: "cpu") ON #b|',
        plotScope: {
            namedPlots: [],
            queryRefs: [
                { index: 1, cellId: 'c0', sql: 'SELECT ts, cpu FROM events', alias: 'base' },
                { index: 2, cellId: 'c0', sql: 'SELECT ts FROM requests', alias: 'raw' },
            ],
            variables: new Map(),
            brushes: new Map(),
        },
        expected: { contains: ['#base'], excludes: ['#raw'] },
    },

    // --- Tier: plot-scope-workflow ---
    // End-to-end "workflow" cases: multiple tail clauses, cross-plot brush refs,
    // workspace variables, named-plot completions.
    {
        name: 'workspace-variable-in-tail-value',
        kind: 'plot',
        tier: 'plot-scope-workflow',
        // HEIGHT should accept constants and variables; $$global is a workspace var.
        input: 'LINE_CHART(x: "ts", y: "cpu") HEIGHT $$|',
        plotScope: {
            namedPlots: [],
            queryRefs: [],
            variables: new Map([
                ['global_height', { name: 'global_height', scope: 'workspace', value: '400', dataType: 'number' }],
            ]),
            brushes: new Map(),
        },
        expected: { contains: ['$$global_height'] },
    },
    {
        name: 'named-plot-in-link-y-scope',
        kind: 'plot',
        tier: 'plot-scope-workflow',
        // LINK_Y should offer brush var names of named sibling plots.
        input: 'BAR_CHART(x: "host", y: ["cpu"]) LINK_Y(|)',
        plotScope: {
            namedPlots: [
                { plotName: 'overview', cellId: 'c0', plotIndexInCell: 0, shape: 'line', hasBrush: true, brushVarName: 'overviewBrush' },
                { plotName: 'detail', cellId: 'c0', plotIndexInCell: 1, shape: 'bar', hasBrush: false },
            ],
            queryRefs: [],
            variables: new Map(),
            brushes: new Map([
                ['overview', { plotName: 'overview', cellId: 'c0', xType: 'timestamp', yType: 'number' }],
            ]),
        },
        expected: { contains: ['$overviewBrush'] },
    },
    {
        name: 'brush-ref-in-link-x-two-brushes',
        kind: 'plot',
        tier: 'plot-scope-workflow',
        // With two brushes declared, LINK_X should offer both sets of .lo/.hi.
        input: 'LINE_CHART(x: "ts", y: "cpu") LINK_X(|)',
        plotScope: {
            namedPlots: [],
            queryRefs: [],
            variables: new Map(),
            brushes: new Map([
                ['gcPause', { plotName: 'gcPause', cellId: 'c0', xType: 'timestamp', yType: 'number' }],
                ['alloc', { plotName: 'alloc', cellId: 'c0', xType: 'timestamp', yType: 'number' }],
            ]),
        },
        expected: { contains: ['$gcPause.brush.lo', '$gcPause.brush.hi', '$alloc.brush.lo', '$alloc.brush.hi'] },
    },
    {
        name: 'const-ref-in-clause-value',
        kind: 'plot',
        tier: 'plot-scope-workflow',
        // A @const defined via LET should appear in clause value position.
        input: 'LET @cap = 100\nBAR_CHART(x: "host", y: ["@|"])',
        expected: { contains: ['@cap'] },
    },
    {
        name: 'const-ref-in-height-tail',
        kind: 'plot',
        tier: 'plot-scope-workflow',
        input: 'LET @h = 300\nLINE_CHART(x: "ts", y: "cpu") HEIGHT @|',
        expected: { contains: ['@h'] },
    },
    {
        name: 'multi-tail-second-key-excludes-used',
        kind: 'plot',
        tier: 'plot-scope-workflow',
        // After TITLE is used, typing W should offer WIDTH/HEIGHT but NOT TITLE again.
        input: 'LINE_CHART(x: "ts", y: "cpu") TITLE "Overview" W|',
        expected: { contains: ['WIDTH'], excludes: ['TITLE'] },
    },
];

