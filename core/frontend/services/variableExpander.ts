/**
 * Expands `IN $varName.brush` → `BETWEEN $varName.brush.lo AND $varName.brush.hi`
 * in a SQL string, before it reaches variable substitution.
 *
 * This allows cells to write readable brush-range filters like:
 *   WHERE ts IN $gc.brush
 * which expands to:
 *   WHERE ts BETWEEN $gc.brush.lo AND $gc.brush.hi
 *
 * The expanded tokens ($gc.brush.lo / $gc.brush.hi) are then resolved
 * by the standard substituteVariables pass.
 *
 * If `variables` is supplied, only expands when the `.lo` sub-key is present —
 * i.e. when the brush is actually set. When the brush is not yet set the
 * original `IN $varName.brush` token is left intact (and the query is skipped
 * by the caller's unresolved-variable check, producing a clear message).
 */
export function expandBrushOperator(sql: string, variables?: Record<string, string>): string {
    return sql.replace(
        /\bIN\s+\$([a-zA-Z_][a-zA-Z0-9_]*\.brush)\b/g,
        (_match, varPath) => {
            if (variables && variables[`$${varPath}`] === undefined) {
                // Brush not yet set — leave the token unresolved so the caller
                // knows to skip execution (rather than producing a confusing
                // DuckDB syntax error from the unsubstituted $x.brush.lo tokens).
                return `IN $${varPath}`;
            }
            return `BETWEEN $${varPath}.lo AND $${varPath}.hi`;
        },
    );
}
