import type { Tool, ToolDeps } from './runtime';

export const QUERY_DATA_TOOL: Tool = {
    name: 'query_data',
    kind: 'read',
    description:
        'Run a read-only SQL query against the loaded JFR session data. ' +
        'Always include the reason and the table names you will access — these are shown to the user.',
    inputSchema: {
        type: 'object',
        properties: {
            sql: {
                type: 'string',
                description: 'A read-only SQL SELECT query.',
            },
            reason: {
                type: 'string',
                description: 'One sentence explaining why this query answers the question.',
            },
            tables: {
                type: 'array',
                items: { type: 'string' },
                description: 'Table names this query accesses — shown to the user before running.',
            },
        },
        required: ['sql', 'reason', 'tables'],
    },
};

export async function handleQueryData(
    args: { sql: string; reason: string; tables: string[] },
    deps: Pick<ToolDeps, 'duckdbQuery' | 'checkQueryPermission'>,
): Promise<string> {
    try {
        if (deps.checkQueryPermission) {
            await deps.checkQueryPermission(args);
        }
        const result = await deps.duckdbQuery(args.sql);
        const columns = result.columns.map(c => c.name);
        const { rows } = result;
        return JSON.stringify({ columns, rows: rows.slice(0, 100), totalRows: rows.length });
    } catch (err: unknown) {
        return JSON.stringify({ error: String((err as Error)?.message ?? err) });
    }
}
