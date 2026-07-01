// Tool registry for AI tool calling. Each tool has a name, description, a
// JSON Schema for its inputs, and a "kind" — read tools can usually execute
// without explicit user approval (gated only by visibility mode); mutate
// tools always require explicit user approval before running.
//
// The seven canonical tools below are intentionally minimal; they cover the
// read paths the assistant needs to inspect data and the mutate paths it
// needs to edit a notebook on the user's behalf.

export type ToolKind = 'read' | 'mutate';

export interface JsonSchema {
    type: string;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    enum?: any[];
    items?: JsonSchema;
    description?: string;
    maximum?: number;
    minimum?: number;
}

export interface Tool {
    name: string;
    description: string;
    kind: ToolKind;
    inputSchema: JsonSchema;
}

export const TOOLS: Tool[] = [
    {
        name: 'runQuery',
        kind: 'read',
        description: 'Execute a read-only SQL query against the loaded DuckDB. Returns up to 500 rows per page. Use `offset` to page through large result sets.',
        inputSchema: {
            type: 'object',
            properties: {
                sql: { type: 'string', description: 'A read-only SQL query.' },
                limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Max rows to return (default 100, max 500).' },
                offset: { type: 'integer', minimum: 0, description: 'Row offset for pagination (default 0).' },
            },
            required: ['sql'],
        },
    },
    {
        name: 'describeTable',
        kind: 'read',
        description: 'Get column names and types for a table or view.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Table or view name.' },
            },
            required: ['name'],
        },
    },
    {
        name: 'sampleRows',
        kind: 'read',
        description: 'Return the first N rows from a table. Honors the current visibility mode.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                limit: { type: 'integer', maximum: 500, minimum: 1 },
            },
            required: ['name'],
        },
    },
    {
        name: 'listPlots',
        kind: 'read',
        description: 'List plot cells in the notebook with their declared names and configs.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'previewPlot',
        kind: 'read',
        description: 'Render a plot inline in the chat by running a SQL query and applying a plot DSL config. The user sees the chart in chat and can promote it to the notebook with one click. Use this to PROPOSE a plot without modifying the notebook — do not also call addCell for the same chart. plotConfig MUST be a DSL string like BAR_CHART(x: "col", y: ["col2"]) TITLE "Title". Disabled when chat visibility is "no-data".',
        inputSchema: {
            type: 'object',
            properties: {
                sql: { type: 'string', description: 'A read-only SQL query whose result rows become the plot data.' },
                plotConfig: { type: 'string', description: 'A plot DSL string, e.g. BAR_CHART(x: "objectClass", y: ["totalWeight"]) TITLE "Top Classes".' },
                limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Max rows fed into the plot (default 200).' },
            },
            required: ['sql', 'plotConfig'],
        },
    },
    {
        name: 'screenshotPlot',
        kind: 'read',
        description: 'Capture a PNG of a plot previously rendered with previewPlot. Returns the image so you can see what the user sees. Use sparingly — only when you need visual confirmation (e.g. label readability, layout) that you cannot infer from the SQL+DSL alone. Requires chat visibility "full"; returns an error otherwise.',
        inputSchema: {
            type: 'object',
            properties: {
                previewId: { type: 'string', description: 'The previewId returned by a recent previewPlot call. The chart with that id will be screenshotted.' },
            },
            required: ['previewId'],
        },
    },
    {
        name: 'addCell',
        kind: 'mutate',
        description: 'Add a new cell to the notebook. Cell type must be one of sql, plot, or markdown. For plot cells, content MUST be a plot DSL string such as: BAR_CHART(x: "col", y: ["col2"]) TITLE "Title" — NOT JSON or Observable Plot syntax.',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['sql', 'plot', 'markdown'] },
                content: { type: 'string', description: 'For plot type: a DSL string like BAR_CHART(x: "objectClass", y: ["totalWeight"]) TITLE "My Chart". For sql type: the SQL query string. For markdown: markdown text.' },
                afterCellId: { type: 'string', description: 'Optional id of the cell after which to insert.' },
            },
            required: ['type', 'content'],
        },
    },
    {
        name: 'editCell',
        kind: 'mutate',
        description: 'Replace the content of an existing cell.',
        inputSchema: {
            type: 'object',
            properties: {
                cellId: { type: 'string' },
                content: { type: 'string' },
            },
            required: ['cellId', 'content'],
        },
    },
    {
        name: 'applyPlot',
        kind: 'mutate',
        description: 'Set a plot configuration on an existing plot cell using the DSL string format. plotConfig MUST be a DSL string like: BAR_CHART(x: "col", y: ["col2"]) TITLE "Title" — NOT JSON. Use plotBlockIndex (0-based) to target a specific plot block when the cell has multiple plot blocks.',
        inputSchema: {
            type: 'object',
            properties: {
                cellId: { type: 'string' },
                plotConfig: { type: 'string', description: 'A plot DSL string, e.g.: BAR_CHART(x: "objectClass", y: ["totalWeight"]) TITLE "Top Classes". Valid plot types: LINE_CHART, BAR_CHART, AREA_CHART, SCATTER_PLOT, PIE_CHART, BOX_PLOT, TABLE. Do NOT use JSON or Observable Plot syntax.' },
                plotBlockIndex: { type: 'number', description: '0-based index of the plot block to replace within the cell. Defaults to 0 (first plot block).' },
            },
            required: ['cellId', 'plotConfig'],
        },
    },
    {
        name: 'listCells',
        kind: 'read',
        description: 'List all cells in the notebook in order. Returns each cell\'s id, type, a content preview (up to 200 chars), and the full content length. Use readCell to fetch the full content of a specific cell.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'readCell',
        kind: 'read',
        description: 'Return the full content of a single cell by id. Pair with listCells when you need to inspect a specific cell\'s full body.',
        inputSchema: {
            type: 'object',
            properties: {
                cellId: { type: 'string', description: 'The id of the cell to read.' },
            },
            required: ['cellId'],
        },
    },
    {
        name: 'deleteCell',
        kind: 'mutate',
        description: 'Delete a cell from the notebook by id. Requires user approval.',
        inputSchema: {
            type: 'object',
            properties: {
                cellId: { type: 'string', description: 'The id of the cell to delete.' },
            },
            required: ['cellId'],
        },
    },
    {
        name: 'moveCell',
        kind: 'mutate',
        description: 'Reorder a cell relative to another cell. position must be "before" or "after". Requires user approval.',
        inputSchema: {
            type: 'object',
            properties: {
                cellId: { type: 'string', description: 'The id of the cell to move.' },
                targetCellId: { type: 'string', description: 'The id of the cell that cellId should be placed before/after.' },
                position: { type: 'string', enum: ['before', 'after'], description: 'Whether to place cellId before or after targetCellId.' },
            },
            required: ['cellId', 'targetCellId', 'position'],
        },
    },
    {
        name: 'listVariables',
        kind: 'read',
        description: 'List the notebook\'s variables. Variables are referenced in SQL as $name (e.g. $session_start). Returns an object map of name → string value.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'setVariable',
        kind: 'mutate',
        description: 'Set (or create) a notebook variable. Variables are referenced in SQL as $name. Value is always a string.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Variable name without the leading $.' },
                value: { type: 'string', description: 'Value to assign (always stored as a string).' },
            },
            required: ['name', 'value'],
        },
    },
    {
        name: 'deleteVariable',
        kind: 'mutate',
        description: 'Delete a notebook variable by name. No error if it does not exist.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Variable name without the leading $.' },
            },
            required: ['name'],
        },
    },
    {
        name: 'rememberFact',
        kind: 'read',
        description: 'Store a short fact about this session (max 10 facts, LRU). Use for user preferences, constraints, or findings that should persist across turns.',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Short identifier, e.g. "cpu_count".' },
                value: { type: 'string', description: 'The fact to remember (max 200 chars).' },
            },
            required: ['key', 'value'],
        },
    },
    {
        name: 'recallMemory',
        kind: 'read',
        description: 'List all stored facts for this session.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'updateTaskList',
        kind: 'read',
        description: 'Set the visible task checklist shown to the user. Call at the start of multi-step work and after each step to tick off completed tasks. Pass an empty array to clear.',
        inputSchema: {
            type: 'object',
            properties: {
                tasks: {
                    type: 'array',
                    description: 'Array of { id: string, text: string, done: boolean }.',
                    items: { type: 'object' },
                },
            },
            required: ['tasks'],
        },
    },
];

export function getTool(name: string): Tool | undefined {
    return TOOLS.find(t => t.name === name);
}

/**
 * Validate an args object against a tool's JSON Schema. Lightweight —
 * checks `required` keys exist, basic type matches, and enum membership.
 * Returns null if valid, an error string otherwise. We intentionally do
 * not pull in a full JSON-Schema library; tool inputs are small and the
 * adapters already constrain shapes at the provider boundary.
 */
export function validateToolArgs(tool: Tool, args: any): string | null {
    const schema = tool.inputSchema;
    if (!args || typeof args !== 'object') return 'args must be an object';
    const props = schema.properties ?? {};
    for (const required of schema.required ?? []) {
        if (!(required in args)) return `missing required field: ${required}`;
    }
    for (const [key, value] of Object.entries(args)) {
        const prop = props[key];
        if (!prop) continue; // allow extra unknown keys; providers sometimes echo metadata
        if (prop.type === 'string' && typeof value !== 'string') return `${key} must be a string`;
        if (prop.type === 'integer' && (!Number.isInteger(value))) return `${key} must be an integer`;
        if (prop.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
            return `${key} must be an object`;
        }
        if (prop.enum && !prop.enum.includes(value)) {
            return `${key} must be one of ${JSON.stringify(prop.enum)}`;
        }
        if (prop.type === 'integer' && typeof prop.maximum === 'number' && (value as number) > prop.maximum) {
            return `${key} exceeds maximum ${prop.maximum}`;
        }
    }
    return null;
}
