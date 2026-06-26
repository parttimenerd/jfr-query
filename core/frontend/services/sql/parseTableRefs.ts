/**
 * W9 — Best-effort extraction of table references from a SQL statement.
 *
 * Returns an empty list on parse failure rather than throwing. The plot model
 * uses this to build a schema preamble; missing tables silently mean no
 * preamble, which is graceful — the model still has typed columns to work with.
 *
 * Handles: FROM tbl, FROM "tbl", FROM schema.tbl, JOIN tbl, LEFT/RIGHT/INNER/OUTER JOIN,
 * comma-separated tables in FROM clause, CTE names defined in WITH (ignored so
 * they don't pollute the schema preamble).
 *
 * Does NOT understand: subqueries (skipped — best-effort regex), correlated
 * references, recursive CTEs.
 */
export function extractTableRefs(sql: string): string[] {
    if (!sql || !sql.trim()) return [];

    // Collect names defined in WITH ... AS (...) so we can exclude them from
    // the result (CTE names aren't real tables).
    const cteNames = new Set<string>();
    const ctePattern = /\bWITH\s+(?:RECURSIVE\s+)?([\w"]+)(?:\s*\([^)]*\))?\s+AS\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = ctePattern.exec(sql)) !== null) {
        cteNames.add(unquote(m[1]).toLowerCase());
    }
    // Subsequent CTE definitions are separated by commas at the WITH level.
    // We'll catch ", name AS (" as a follow-on CTE definition.
    const followCte = /,\s*([\w"]+)(?:\s*\([^)]*\))?\s+AS\s*\(/gi;
    while ((m = followCte.exec(sql)) !== null) {
        cteNames.add(unquote(m[1]).toLowerCase());
    }

    const out = new Set<string>();
    // FROM tbl  or  FROM tbl, tbl2  or  FROM "tbl"
    const fromPattern = /\b(?:FROM|JOIN)\s+([\w"\.]+(?:\s*,\s*[\w"\.]+)*)/gi;
    while ((m = fromPattern.exec(sql)) !== null) {
        for (const raw of m[1].split(',')) {
            const t = unquote(raw.trim());
            if (!t) continue;
            // schema.table → take the last segment
            const name = t.split('.').pop()!;
            if (!cteNames.has(name.toLowerCase())) out.add(name);
        }
    }
    return Array.from(out);
}

function unquote(s: string): string {
    return s.replace(/^["'`]|["'`]$/g, '');
}
