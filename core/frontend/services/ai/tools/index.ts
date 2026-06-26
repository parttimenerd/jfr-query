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
        description: 'Execute a read-only SQL query against the loaded DuckDB. Returns the first 100 rows.',
        inputSchema: {
            type: 'object',
            properties: {
                sql: { type: 'string', description: 'A read-only SQL query.' },
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
                limit: { type: 'integer', maximum: 100, minimum: 1 },
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
        name: 'addCell',
        kind: 'mutate',
        description: 'Add a new cell to the notebook. Cell type must be one of sql, plot, or markdown.',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['sql', 'plot', 'markdown'] },
                content: { type: 'string' },
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
        description: 'Set a plot configuration on an existing plot cell.',
        inputSchema: {
            type: 'object',
            properties: {
                cellId: { type: 'string' },
                plotConfig: { type: 'string' },
            },
            required: ['cellId', 'plotConfig'],
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
