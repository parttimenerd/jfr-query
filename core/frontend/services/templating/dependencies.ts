/**
 * Lightweight, regex-based extractor of identifiers a SQL fragment references.
 *
 * Used by the templating runtime to compute a cell-level dependency graph
 * (alias → alias and alias → variable). This is intentionally NOT a real SQL
 * parser. Documented limitations:
 *
 *   - Quoted identifiers (`"x"`) are stripped from consideration; we only look
 *     at unquoted bare-word references.
 *   - CTEs that locally rebind an alias name will be incorrectly counted as
 *     external dependencies. The runtime accepts the false positive (extra
 *     edges in the DAG) — it costs an unnecessary `await`, not correctness.
 *   - String literals are masked before identifier scanning so words inside
 *     `'…'` are not picked up.
 *   - Comments (`-- …` to end of line, `/* … *\/`) are masked.
 *
 * Identifiers returned are lowercased for case-insensitive matching against
 * the alias registry (DuckDB identifiers are case-insensitive by default).
 * Cell-qualified refs come back as `{ kind: 'qualified', handle, alias }`;
 * bare refs as `{ kind: 'bare', name }`. Variables (`$x`, `$$x`) come back
 * as `{ kind: 'variable', name, scoped }`.
 */

export type Reference =
    | { kind: 'bare'; name: string }
    | { kind: 'qualified'; handle: string; alias: string }
    | { kind: 'variable'; name: string; scoped: boolean };

/** Mask string literals and SQL comments with spaces so they don't pollute scanning. */
const stripStringsAndComments = (sql: string): string => {
    let out = '';
    let i = 0;
    const n = sql.length;
    while (i < n) {
        const ch = sql[i];
        // -- line comment
        if (ch === '-' && sql[i + 1] === '-') {
            while (i < n && sql[i] !== '\n') {
                out += ' ';
                i++;
            }
            continue;
        }
        // /* block comment */
        if (ch === '/' && sql[i + 1] === '*') {
            out += '  ';
            i += 2;
            while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) {
                out += sql[i] === '\n' ? '\n' : ' ';
                i++;
            }
            if (i < n) { out += '  '; i += 2; }
            continue;
        }
        // '…' or "…" or `…`
        if (ch === "'" || ch === '"' || ch === '`') {
            const quote = ch;
            out += ' ';
            i++;
            while (i < n) {
                if (sql[i] === quote) {
                    // double-quote escape: `''` inside `'…'`
                    if (sql[i + 1] === quote) { out += '  '; i += 2; continue; }
                    out += ' ';
                    i++;
                    break;
                }
                out += sql[i] === '\n' ? '\n' : ' ';
                i++;
            }
            continue;
        }
        out += ch;
        i++;
    }
    return out;
};

// SQL keywords we filter out so they aren't confused with identifiers.
// Intentionally minimal — false positives are tolerated by the runtime.
const SQL_KEYWORDS = new Set([
    'select', 'from', 'where', 'group', 'by', 'order', 'having', 'limit', 'offset',
    'join', 'inner', 'outer', 'left', 'right', 'full', 'cross', 'on', 'using',
    'as', 'and', 'or', 'not', 'in', 'is', 'null', 'true', 'false',
    'with', 'union', 'all', 'distinct', 'case', 'when', 'then', 'else', 'end',
    'cast', 'between', 'like', 'ilike', 'exists', 'asc', 'desc',
    'create', 'or', 'replace', 'temp', 'temporary', 'view', 'table', 'schema',
    'if', 'exists', 'drop', 'insert', 'into', 'values', 'update', 'set', 'delete',
    'count', 'sum', 'avg', 'min', 'max', 'first', 'last',
]);

/**
 * Extract references from a SQL fragment.
 *
 * @param sql The SQL text to scan (post-variable-substitution is NOT required;
 *   variables are returned as their own reference kind).
 */
export const extractReferences = (sql: string): Reference[] => {
    const cleaned = stripStringsAndComments(sql);
    const refs: Reference[] = [];
    const seen = new Set<string>();

    // Variables: $$name (scoped) and $name (notebook)
    const varRe = /\$(\$?)([A-Za-z_][\w]*)/g;
    let m: RegExpExecArray | null;
    while ((m = varRe.exec(cleaned))) {
        const scoped = m[1] === '$';
        const name = m[2];
        const key = `var:${scoped ? '$$' : '$'}${name}`;
        if (!seen.has(key)) {
            seen.add(key);
            refs.push({ kind: 'variable', name, scoped });
        }
    }

    // Qualified: handle.alias (both alphanumeric). Capture greedily; SQL uses
    // dot for schema.table — same thing in our model. The alias side also
    // accepts plain digits (e.g. cell_3.1) per B-164.
    const qualRe = /\b([A-Za-z_][\w]*)\.([A-Za-z_][\w]*|\d+)\b/g;
    while ((m = qualRe.exec(cleaned))) {
        const handle = m[1];
        const alias = m[2];
        // Skip if the "handle" is actually a SQL keyword (e.g. `case.foo`)
        if (SQL_KEYWORDS.has(handle.toLowerCase())) continue;
        const key = `qual:${handle.toLowerCase()}.${alias.toLowerCase()}`;
        if (!seen.has(key)) {
            seen.add(key);
            refs.push({ kind: 'qualified', handle, alias });
        }
    }

    // Bare identifiers — but exclude ones that appeared on the LHS or RHS of a
    // qualified ref (already captured). Mask out the dotted forms first.
    qualRe.lastIndex = 0;
    const masked = cleaned.replace(qualRe, '');
    const bareRe = /\b([A-Za-z_][\w]*)\b/g;
    while ((m = bareRe.exec(masked))) {
        const name = m[1];
        const lower = name.toLowerCase();
        if (SQL_KEYWORDS.has(lower)) continue;
        // Skip if preceded by `$` (variable, handled above)
        const before = masked[m.index - 1];
        if (before === '$') continue;
        const key = `bare:${lower}`;
        if (!seen.has(key)) {
            seen.add(key);
            refs.push({ kind: 'bare', name });
        }
    }

    return refs;
};
