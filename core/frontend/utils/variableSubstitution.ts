/**
 * Substitutes `$name` references in a SQL string with values from `variables`.
 *
 * - Uses a `(?!\w)` right boundary so `$v` does not match inside `$v2`.
 * - Uses a `(?<!\$)` left boundary so `$x` does not match inside `$$x`
 *   (notebook-scoped variables use the `$$` prefix; cell-local use `$`).
 * - Escapes regex meta-chars in the variable name (in case names ever contain
 *   characters beyond `[A-Za-z_]\w*`).
 * - Escapes `$` characters in the *replacement* value via a function-form
 *   replacer, so values like `'foo$1bar'` or `'$&'` are inserted verbatim
 *   instead of being interpreted as backreferences by `String.prototype.replace`.
 * - Iterates to fixpoint (up to 10 passes) so transitive references like
 *   `$a = $b + 1` and `$b = 2` resolve correctly regardless of key order.
 *   A cycle guard stops after 10 iterations — unresolved cycles are left as-is.
 *
 * Returns the substituted string.
 */
export function substituteVariables(
    sql: string,
    variables: Record<string, string>,
): string {
    if (Object.keys(variables).length === 0) return sql;

    // Process longer keys first so `$$foo` is consumed before `$foo` would
    // match inside it (defense in depth alongside the `(?<!\$)` boundary).
    const names = Object.keys(variables).sort((a, b) => b.length - a.length);

    // Build regexes once.
    // Keys may be stored with or without a leading `$`/`$$` prefix:
    //   - `$$threshold_ms`  → match `$$threshold_ms` literally
    //   - `$limit`          → match `$limit` literally
    //   - `session_start`   → match `$session_start` (app-injected variables
    //                         like session bounds are stored without the `$`
    //                         but referenced as `$name` in SQL / markdown)
    const patterns: Array<{ re: RegExp; value: string }> = names
        .filter(name => variables[name] != null)   // skip null/undefined values — don't substitute "null" into SQL
        .map(name => {
        const refName = name.startsWith('$') ? name : `$${name}`;
        const escapedName = refName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const leftBoundary = refName.startsWith('$$') ? '' : '(?<!\\$)';
        return {
            re: new RegExp(`${leftBoundary}${escapedName}(?!\\w)`, 'g'),
            value: variables[name],
        };
    });

    let out = sql;
    // Iterate to fixpoint: if a variable value itself contains $-references,
    // those get resolved on subsequent passes. Cap at 10 to break cycles.
    // Cycle detection: track how many $-tokens remain; once the count stops
    // decreasing we've hit a cycle and further passes would only grow the string.
    let prevTokenCount = -1;
    for (let pass = 0; pass < 10; pass++) {
        let changed = false;
        for (const { re, value } of patterns) {
            re.lastIndex = 0;
            const next = out.replace(re, () => value);
            if (next !== out) { out = next; changed = true; }
        }
        if (!changed) break;
        // Count remaining unresolved $-tokens; stop if no progress since last pass.
        const tokenCount = (out.match(/\$\$?\w+/g) ?? []).length;
        if (tokenCount >= prevTokenCount && prevTokenCount >= 0) break;
        prevTokenCount = tokenCount;
    }
    return out;
}

// ISO 8601 datetime pattern: YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss (with optional ms/tz)
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Returns a copy of `variables` where values that look like ISO datetime strings
 * are wrapped in single-quoted SQL string literals (e.g. `2024-03-15T11:00` →
 * `'2024-03-15T11:00'`). Any embedded single quotes in the value are escaped.
 *
 * Use this before calling `substituteVariables` for SQL contexts so that
 * datetime variables like `$session_start` produce valid SQL (`TIMESTAMPTZ`
 * comparison works against a quoted string). For markdown/text contexts, use
 * the raw variables map directly.
 */
export function toSqlVariables(variables: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables)) {
        if (value == null) { out[key] = ''; continue; }
        out[key] = ISO_DATETIME_RE.test(value) ? `'${value.replace(/'/g, "''")}'` : value;
    }
    return out;
}

/**
 * Returns the de-duplicated list of `$name` and `$$name` tokens still present
 * in `sql`. Intended to be called on the output of `substituteVariables` to
 * detect references that had no binding.
 *
 * Captures dotted paths too (`$sel.brush`, `$Overview.start`, `$sel.brush.lo`)
 * so callers can produce correct error messages for brush variables.
 */
export function findRemainingVariables(sql: string): string[] {
    // Match $$name or $name, optionally followed by .segment parts (for
    // dotted-path vars like $sel.brush or $Overview.start).
    const matches = sql.match(/\$\$?\w+(?:\.\w+)*/g);
    if (!matches) return [];
    return [...new Set(matches)];
}
