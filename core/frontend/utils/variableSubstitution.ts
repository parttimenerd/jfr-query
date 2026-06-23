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
    const patterns: Array<{ re: RegExp; value: string }> = names.map(name => {
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const leftBoundary = name.startsWith('$$') ? '' : '(?<!\\$)';
        return {
            re: new RegExp(`${leftBoundary}${escapedName}(?!\\w)`, 'g'),
            value: variables[name],
        };
    });

    let out = sql;
    // Iterate to fixpoint: if a variable value itself contains $-references,
    // those get resolved on subsequent passes. Cap at 10 to break cycles.
    for (let pass = 0; pass < 10; pass++) {
        let changed = false;
        for (const { re, value } of patterns) {
            re.lastIndex = 0;
            const next = out.replace(re, () => value);
            if (next !== out) { out = next; changed = true; }
        }
        if (!changed) break;
    }
    return out;
}

/**
 * Returns the de-duplicated list of `$name` and `$$name` tokens still present
 * in `sql`. Intended to be called on the output of `substituteVariables` to
 * detect references that had no binding.
 */
export function findRemainingVariables(sql: string): string[] {
    const matches = sql.match(/\$\$?\w+/g);
    if (!matches) return [];
    return [...new Set(matches)];
}
