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
];
