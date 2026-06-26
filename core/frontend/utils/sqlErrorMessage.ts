// Utilities for cleaning up DuckDB error messages before displaying them.
//
// DuckDB error messages often contain redundant boilerplate: the full SQL
// echo back, "Error:" prefixes, catalog stack traces, suggestion lines, and
// various internal hints that are noise for end-users.  `cleanDuckDBError`
// strips those and returns only the human-readable explanation line(s).
// `heuristicTip` matches the cleaned message against known patterns and
// returns a short actionable suggestion.

/**
 * Strips DuckDB-specific boilerplate from a raw error message.
 *
 * Keeps:
 *  - The first meaningful sentence (the one starting with the error type, e.g.
 *    "Binder Error: Column "foo" does not exist!")
 *  - Any "Did you mean …?" suggestion appended immediately after.
 *
 * Removes:
 *  - "Error: " repeated-prefix wrappers
 *  - The SQL echo block that starts with "LINE N:" and the caret indicator line
 *  - "Catalog: …" / "Error: " wrapper lines
 *  - Empty trailing lines
 */
export function cleanDuckDBError(raw: string): string {
    if (!raw) return raw;

    // Strip an outer "Error: " wrapper that DuckDB sometimes prepends.
    let msg = raw.replace(/^Error:\s*/i, '');

    // Split into lines for per-line filtering.
    const lines = msg.split('\n');
    const kept: string[] = [];

    for (const line of lines) {
        // Drop the SQL echo line ("LINE N: <sql text>")
        if (/^\s*LINE\s+\d+:/i.test(line)) continue;
        // Drop the caret indicator line ("      ^")
        if (/^\s*\^+\s*$/.test(line)) continue;
        // Drop lines that are just the caret after spaces / dashes
        if (/^\s*[-^]+\s*$/.test(line)) continue;
        // Drop empty continuation whitespace-only lines at the very beginning.
        if (kept.length === 0 && line.trim() === '') continue;

        kept.push(line);
    }

    // Trim trailing empty lines.
    while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();

    return kept.join('\n').trim();
}

/** Heuristic tip patterns: [regex, tip text]. Matched against the cleaned message. */
const TIPS: Array<[RegExp, string]> = [
    // Syntax errors — comma/keyword issues
    [
        /syntax error at or near ","/i,
        'Tip: Check for an extra comma or a missing keyword before this position.',
    ],
    [
        /syntax error at or near "select"/i,
        'Tip: A SELECT may have started mid-query. Check for extra commas or unexpected newlines.',
    ],
    [
        /syntax error at or near "from"/i,
        'Tip: Unexpected FROM. Check that the SELECT list is complete and has no trailing comma.',
    ],
    [
        /syntax error at or near "where"/i,
        'Tip: Unexpected WHERE. Make sure the FROM clause and table name are present.',
    ],
    [
        /syntax error at or near "group"/i,
        'Tip: Unexpected GROUP. Ensure the SELECT and FROM clauses are complete.',
    ],
    [
        /syntax error at or near "order"/i,
        'Tip: Unexpected ORDER. Make sure all clauses before ORDER BY are complete.',
    ],
    [
        /syntax error at or near "having"/i,
        'Tip: HAVING requires a GROUP BY clause. Make sure GROUP BY comes first.',
    ],
    [
        /syntax error at or near "\)"/i,
        'Tip: Unexpected closing parenthesis. Check for unmatched or extra parentheses.',
    ],
    [
        /syntax error at or near "\("/i,
        'Tip: Unexpected opening parenthesis. Check function call syntax or subquery placement.',
    ],
    [
        /syntax error at or near ";"/i,
        'Tip: Unexpected semicolon. Each SQL block should contain one statement.',
    ],
    [
        /syntax error at or near "end of input"/i,
        'Tip: The query appears incomplete. Make sure all clauses and parentheses are closed.',
    ],
    [
        /syntax error\b/i,
        'Tip: Check the query near the highlighted position for a typo, missing keyword, or unbalanced parenthesis.',
    ],

    // Aggregation errors — must come before generic binder error catch-all
    [
        /aggregate[s ].*cannot be nested/i,
        'Tip: You cannot nest aggregate functions (e.g. SUM inside COUNT). Use a subquery or CTE instead.',
    ],
    [
        /aggregate function.*inside.*group/i,
        'Tip: Use a HAVING clause to filter by aggregate values, not WHERE.',
    ],
    [
        /must appear in the GROUP BY clause/i,
        'Tip: All non-aggregated columns in SELECT must appear in the GROUP BY clause.',
    ],

    // Column/binding errors
    [
        /column[^"]*"([^"]+)"[^.]*does not exist/i,
        'Tip: Check the column name spelling. Use the columns bar above the query result to see available columns.',
    ],
    [
        /referenced column "[^"]+" not found/i,
        'Tip: The column was not found in the query result. Verify the column name or add it to the SELECT list.',
    ],
    // Ambiguous references — must come before generic binder error catch-all
    [
        /ambiguous reference/i,
        'Tip: Qualify the column with its table alias, e.g. t1.column_name.',
    ],
    [
        /binder error.*column/i,
        'Tip: Check the column name spelling. It must appear in the FROM clause tables or be aliased in the SELECT list.',
    ],

    // Table/catalog errors
    [
        /scalar function with name[^.]*does not exist/i,
        'Tip: This function is not recognised. If it is a user-defined macro, run the cell that defines it first.',
    ],
    [
        /aggregate function with name[^.]*does not exist/i,
        'Tip: This aggregate function is not recognised. Check the name or use a supported aggregate like COUNT, SUM, AVG, MEDIAN, or QUANTILE.',
    ],
    [
        /table[^"]*"([^"]+)"[^.]*does not exist/i,
        'Tip: Check the table name spelling. Use the schema explorer to see available tables.',
    ],
    [
        /catalog error/i,
        'Tip: The table or view may not exist yet. Run the notebook cells in order to create required views.',
    ],
    [
        /table with name[^.]*does not exist/i,
        'Tip: Check the table name. Use the schema explorer to see available tables.',
    ],

    // LIMIT
    [
        /limit clause can only contain a constant/i,
        'Tip: Use a numeric literal as the LIMIT value, e.g. LIMIT 10.',
    ],

    // Type errors
    [
        /cannot compare values of type/i,
        'Tip: You may be comparing incompatible types. Try casting with ::INTEGER or ::VARCHAR.',
    ],
    [
        /conversion error.*could not convert/i,
        'Tip: A value cannot be cast to the expected type. Check that the column contains the expected data type.',
    ],
    [
        /operator.*does not exist/i,
        'Tip: The operator cannot be applied to these types. You may need an explicit cast.',
    ],

    // Division by zero
    [
        /division by zero/i,
        'Tip: Add a guard: use NULLIF(divisor, 0) to prevent division-by-zero errors.',
    ],

    // Out-of-range / overflow
    [
        /out of range/i,
        'Tip: A numeric value overflowed its type. Try casting to BIGINT or DOUBLE.',
    ],

    // Semicolon / multiple statements
    [
        /only a single select statement/i,
        'Tip: Place each SQL statement in a separate SQL block.',
    ],
];

/**
 * Returns a heuristic tip for a cleaned DuckDB error message, or an empty
 * string if no known pattern matches.
 */
export function heuristicTip(cleanedMessage: string): string {
    for (const [re, tip] of TIPS) {
        if (re.test(cleanedMessage)) return tip;
    }
    return '';
}

/**
 * Extracts column name candidates from DuckDB "Candidate bindings: ..." lines.
 * Returns an array of unquoted column name strings, or empty array if none found.
 *
 * DuckDB emits these in several forms:
 *   Candidate bindings: "col1", "col2"
 *   Did you mean "col1"?
 *   Nearby candidates: "col1", "col2"
 */
export function parseCandidateBindings(cleanedMessage: string): string[] {
    const results: string[] = [];
    // Match "Candidate bindings: ..." or "Nearby candidates: ..."
    const bindingsM = cleanedMessage.match(/(?:Candidate bindings|Nearby candidates)\s*:\s*(.+)/i);
    if (bindingsM) {
        const raw = bindingsM[1];
        const quoted = raw.match(/"([^"]+)"/g);
        if (quoted) {
            for (const q of quoted) results.push(q.slice(1, -1));
        }
    }
    // Also pick up "Did you mean "col"?" suggestions
    const didYouMean = cleanedMessage.match(/Did you mean\s+"([^"]+)"\??/gi);
    if (didYouMean) {
        for (const m of didYouMean) {
            const inner = m.match(/"([^"]+)"/);
            if (inner && !results.includes(inner[1])) results.push(inner[1]);
        }
    }
    return results;
}
