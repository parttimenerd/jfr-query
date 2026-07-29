import type { PlotParameter } from '../components/plots/plotTypes';

export interface ClauseDoc {
    name: string;
    signature: string;
    description: string;
    params: PlotParameter[];
}

export const plotClauseDocs: Record<string, ClauseDoc> = {
    TITLE: {
        name: 'TITLE',
        signature: 'TITLE "string"',
        description: 'Adds a title displayed above the plot or grid cell.',
        params: [
            { name: 'string', type: 'string', required: true, description: 'The title text to display.' }
        ]
    },
    ON: {
        name: 'ON',
        signature: 'ON query_ref[, query_ref2, ...]',
        description: 'Specifies which query result(s) the plot should use. If omitted, defaults to the preceding query in the cell.',
        params: [
            { name: 'query_ref', type: 'number | string', required: true, description: 'A 1-based index of the query in the cell (e.g. `1`, `2`), or a view alias defined with `CREATE VIEW alias AS`.' }
        ]
    },
    WIDTH: {
        name: 'WIDTH',
        signature: 'WIDTH size',
        description: 'Sets the flex-basis width of a plot in a multi-column grid row. Ignored for single plots.',
        params: [
            { name: 'size', type: 'string', required: true, description: 'A CSS size value, e.g. `300px` or `50%`.' }
        ]
    },
    HEIGHT: {
        name: 'HEIGHT',
        signature: 'HEIGHT size',
        description: 'Sets the height of the plot container.',
        params: [
            { name: 'size', type: 'string', required: true, description: 'A CSS size value, e.g. `400px`.' }
        ]
    },
    ZOOM: {
        name: 'ZOOM',
        signature: 'ZOOM factor',
        description: 'Visually scales the plot content within its container. Values below 1.0 shrink the chart; above 1.0 enlarge it. Useful when placing many charts in a grid row.',
        params: [
            { name: 'factor', type: 'number', required: true, description: 'Scale factor: `0.8` = 80%, `1.2` = 120%.' }
        ]
    },
    ZOOM_X: {
        name: 'ZOOM_X',
        signature: 'ZOOM_X factor',
        description: 'Scales only the horizontal axis of the chart, leaving text and vertical dimensions unchanged.',
        params: [
            { name: 'factor', type: 'number', required: true, description: 'Horizontal scale factor.' }
        ]
    },
    LEGEND: {
        name: 'LEGEND',
        signature: 'LEGEND AT position | LEGEND HIDDEN',
        description: 'Controls the position of the chart legend. Use `HIDDEN` to suppress it entirely.',
        params: [
            { name: 'position', type: 'string', required: true, description: 'One of: `RIGHT` (default), `LEFT`, `TOP`, `BOTTOM`, `NONE`, or keyword `HIDDEN`.' }
        ]
    },
    PALETTE: {
        name: 'PALETTE',
        signature: 'PALETTE "palette_name"',
        description: 'Sets the color palette for series. Supports D3 named palettes and custom hex lists.',
        params: [
            { name: 'palette_name', type: 'string', required: true, description: 'A palette name such as `category10`, `tableau10`, `pastel1`, or a comma-separated list of hex colors like `"#e41a1c,#377eb8,#4daf4a"`.' }
        ]
    },
    BRUSH: {
        name: 'BRUSH',
        signature: 'BRUSH $var_name MODE X|Y|XY',
        description: 'Adds an interactive brush overlay to the chart. Dragging the brush stores the selection as `$var_name.lo` and `$var_name.hi` in cell variables. Other queries in the cell can filter using `IN $var_name`.',
        params: [
            { name: '$var_name', type: 'variable', required: true, description: 'The cell variable prefix to store the selection (e.g. `$sel` creates `$sel.lo` and `$sel.hi`).' },
            { name: 'MODE', type: 'string', required: true, description: '`X` for horizontal selection, `Y` for vertical, `XY` for rectangular.' }
        ]
    },
    LINK_X: {
        name: 'LINK_X',
        signature: 'LINK_X($start_var, $end_var[, master][, clamp])',
        description: 'Links a plot\'s X-axis viewport to cell variables for synchronized zooming and panning across multiple charts. All charts in the cell with the same variable pair are kept in sync.',
        params: [
            { name: '$start_var', type: 'variable', required: true, description: 'Cell variable storing the visible X minimum (e.g. `$start`).' },
            { name: '$end_var', type: 'variable', required: true, description: 'Cell variable storing the visible X maximum (e.g. `$end`).' },
            { name: 'master', type: 'keyword', required: false, description: 'Optional. This chart initializes the variables to its full data extent on first render.' },
            { name: 'clamp', type: 'keyword', required: false, description: 'Optional. Prevents panning or zooming beyond the chart\'s own data range.' }
        ]
    },
    LINK_Y: {
        name: 'LINK_Y',
        signature: 'LINK_Y $var_name',
        description: 'Links a plot\'s Y-axis scroll/pan position to a cell variable so multiple tall charts scroll in unison.',
        params: [
            { name: '$var_name', type: 'variable', required: true, description: 'Cell variable that holds the shared Y position.' }
        ]
    },
    LINK_XY: {
        name: 'LINK_XY',
        signature: 'LINK_XY $var_name',
        description: 'Links both axes (X and Y) to a single variable prefix for 2D synchronization across scatter or heatmap charts.',
        params: [
            { name: '$var_name', type: 'variable', required: true, description: 'Cell variable prefix for shared XY position.' }
        ]
    },
    LINK_SCROLL: {
        name: 'LINK_SCROLL',
        signature: 'LINK_SCROLL "group_name"',
        description: 'Synchronizes the scroll position of this plot\'s container with all other plots in the same named group. Useful for side-by-side tall charts.',
        params: [
            { name: 'group_name', type: 'string', required: true, description: 'An arbitrary group identifier. All plots with the same name scroll together.' }
        ]
    },
    AXIS_X: {
        name: 'AXIS_X',
        signature: 'AXIS_X [LABEL "text"] [TYPE LINEAR|LOG|TIME|BAND] [DOMAIN [min, max]] [FORMAT "fmt"]',
        description: 'Configures the X axis. All sub-clauses are optional and can be combined.',
        params: [
            { name: 'LABEL', type: 'string', required: false, description: 'Axis label text, e.g. `LABEL "Time (ms)"`.' },
            { name: 'TYPE', type: 'string', required: false, description: '`LINEAR` (default), `LOG` (log scale), `TIME` (timestamp formatting), or `BAND` (categorical/ordinal).' },
            { name: 'DOMAIN', type: 'array', required: false, description: 'Fixed axis extent as `[min, max]`, e.g. `DOMAIN [0, 1000]`. Use `auto` for either bound.' },
            { name: 'FORMAT', type: 'string', required: false, description: 'A d3-format or date-format string, e.g. `FORMAT ".2f"` or `FORMAT "%H:%M"`.' }
        ]
    },
    AXIS_Y: {
        name: 'AXIS_Y',
        signature: 'AXIS_Y [LABEL "text"] [TYPE LINEAR|LOG|TIME|BAND] [DOMAIN [min, max]] [FORMAT "fmt"]',
        description: 'Configures the Y axis. All sub-clauses are optional and can be combined.',
        params: [
            { name: 'LABEL', type: 'string', required: false, description: 'Axis label text.' },
            { name: 'TYPE', type: 'string', required: false, description: '`LINEAR` (default), `LOG`, `TIME`, or `BAND`.' },
            { name: 'DOMAIN', type: 'array', required: false, description: 'Fixed axis extent, e.g. `DOMAIN [0, 100]`.' },
            { name: 'FORMAT', type: 'string', required: false, description: 'A d3-format string, e.g. `FORMAT ".1f"` for one decimal place.' }
        ]
    },
    TOOLTIP: {
        name: 'TOOLTIP COLUMNS',
        signature: 'TOOLTIP COLUMNS [col1, col2, ...]',
        description: 'Limits the columns shown in the hover tooltip to a specific subset. By default all columns are shown.',
        params: [
            { name: 'columns', type: 'array', required: true, description: 'Comma-separated list of column names to show in the tooltip.' }
        ]
    },
    'TOOLTIP COLUMNS': {
        name: 'TOOLTIP COLUMNS',
        signature: 'TOOLTIP COLUMNS [col1, col2, ...]',
        description: 'Limits the columns shown in the hover tooltip to a specific subset. By default all columns are shown.',
        params: [
            { name: 'columns', type: 'array', required: true, description: 'Comma-separated list of column names to show in the tooltip.' }
        ]
    },
    'ON HOVER TOOLTIP': {
        name: 'ON HOVER TOOLTIP',
        signature: 'ON HOVER TOOLTIP "template"',
        description: 'Custom tooltip template rendered on hover. Use {columnName} placeholders — e.g. ON HOVER TOOLTIP "{cause}: {duration}ms".',
        params: [
            { name: 'template', type: 'string', required: true, description: 'Template string with {column} placeholders for each data column.' }
        ]
    },
    NAME: {
        name: 'NAME',
        signature: 'NAME "cell_name"',
        description: 'Assigns a named alias to this plot cell so other plots can reference it with `ON "name"`. Also appears in the sidebar for navigation.',
        params: [
            { name: 'cell_name', type: 'string', required: true, description: 'A unique name for this cell.' }
        ]
    },
    DATASET: {
        name: 'DATASET',
        signature: 'DATASET table_or_view',
        description: 'Overrides the data source for the plot, using a named DuckDB table or view instead of a query result. Useful for very large static datasets.',
        params: [
            { name: 'table_or_view', type: 'string', required: true, description: 'Name of a DuckDB table or view to use as the data source.' }
        ]
    },
    LET: {
        name: 'LET',
        signature: 'LET @alias = "value"',
        description: 'Defines a reusable constant within the plot config block. Reference it as @alias anywhere in the same block. Useful to avoid repeating column names or string values across multiple parameters.',
        params: [
            { name: '@alias', type: 'identifier', required: true, description: 'A name starting with @ that you can use in the config body, e.g. `@col`.' },
            { name: 'value', type: 'string | number', required: true, description: 'A quoted string or number, e.g. `"cpu_usage"` or `100`.' }
        ]
    },
    DISABLED: {
        name: 'DISABLED',
        signature: 'DISABLED',
        description: 'Suppresses rendering of this plot — shows a placeholder instead. Useful for temporarily hiding a chart without deleting its config.',
        params: []
    }
};
