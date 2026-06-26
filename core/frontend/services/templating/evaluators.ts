/**
 * Evaluator for `{if SELECT … }` conditionals.
 *
 * The contract:
 *   - Caller passes a `query(sql) => Promise<row[]>` function (typically
 *     `useDB().query`) and the SQL to evaluate.
 *   - We run the SQL, examine the first row's first column, and return a
 *     `{ kind: 'ok', value: boolean }` payload. Truthy = body shown.
 *   - On parse/execution error, returns `{ kind: 'error', message }`.
 *   - On 0 rows, returns `{ kind: 'ok', value: false }`.
 *
 * Caching is the caller's responsibility — this evaluator is stateless so
 * tests can run it without a cache. `TemplatedMarkdown.tsx` wraps these
 * calls in a useMemo keyed on `(sql, depVersions)`.
 */

export type ConditionResult =
    | { kind: 'ok'; value: boolean }
    | { kind: 'error'; message: string };

export type ScalarResult =
    | { kind: 'ok'; value: unknown }
    | { kind: 'empty' }
    | { kind: 'error'; message: string };

type QueryFn = (sql: string) => Promise<any[]>;

const truthy = (v: unknown): boolean => {
    if (v == null) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0 && !isNaN(v);
    if (typeof v === 'bigint') return v !== 0n;
    if (typeof v === 'string') return v.length > 0 && v.toLowerCase() !== 'false' && v !== '0';
    return true;
};

const firstScalar = (rows: any[]): unknown => {
    if (!rows || rows.length === 0) return undefined;
    const first = rows[0];
    if (first == null) return undefined;
    if (typeof first !== 'object') return first;
    const keys = Object.keys(first);
    return keys.length > 0 ? first[keys[0]] : undefined;
};

export const evaluateCondition = async (
    query: QueryFn,
    sql: string,
): Promise<ConditionResult> => {
    if (!sql.trim()) return { kind: 'ok', value: false };
    try {
        const rows = await query(sql);
        const v = firstScalar(rows);
        return { kind: 'ok', value: truthy(v) };
    } catch (err: any) {
        return { kind: 'error', message: err?.message ?? String(err) };
    }
};

export const evaluateScalar = async (
    query: QueryFn,
    sql: string,
): Promise<ScalarResult> => {
    if (!sql.trim()) return { kind: 'empty' };
    try {
        const rows = await query(sql);
        if (!rows || rows.length === 0) return { kind: 'empty' };
        const v = firstScalar(rows);
        if (v === undefined) return { kind: 'empty' };
        return { kind: 'ok', value: v };
    } catch (err: any) {
        return { kind: 'error', message: err?.message ?? String(err) };
    }
};
