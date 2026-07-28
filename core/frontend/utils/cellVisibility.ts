import { substituteVariables } from './variableSubstitution';

export type CellQueryFn = (sql: string) => Promise<Array<Record<string, unknown>>>;

const isTruthy = (v: unknown): boolean => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
    if (typeof v === 'string') return v.length > 0 && v.toLowerCase() !== 'false' && v !== '0';
    if (typeof v === 'boolean') return v;
    if (typeof v === 'bigint') return v !== 0n;
    return true;
};

/**
 * Normalises `${name}` → `$name` so cellCondition SQL can use either spelling.
 * The standard substituteVariables only handles `$name`.
 */
function normaliseBraces(sql: string): string {
    return sql.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g, '$$$1');
}

export async function resolveCellVisibility(
    cellName: string,
    cellConditions: Record<string, string> | undefined,
    variables: Record<string, string>,
    query: CellQueryFn,
): Promise<boolean> {
    if (!cellConditions) return true;
    const predicate = cellConditions[cellName];
    if (!predicate) return true;

    const expanded = substituteVariables(normaliseBraces(predicate), variables);
    try {
        const rows = await query(expanded);
        if (!rows || rows.length === 0) return false;
        const firstVal = Object.values(rows[0])[0];
        return isTruthy(firstVal);
    } catch {
        return true;
    }
}
