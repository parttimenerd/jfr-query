import { describe, it, expect } from 'vitest';
import { cleanDuckDBError, heuristicTip } from '../utils/sqlErrorMessage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Asserts idempotence: clean(clean(x)) === clean(x). */
function assertIdempotent(raw: string) {
    const once = cleanDuckDBError(raw);
    const twice = cleanDuckDBError(once);
    expect(twice).toBe(once);
}

// ---------------------------------------------------------------------------
// cleanDuckDBError
// ---------------------------------------------------------------------------

describe('cleanDuckDBError', () => {

    // ---- Empty / whitespace inputs ----------------------------------------

    it('returns empty string as-is', () => {
        expect(cleanDuckDBError('')).toBe('');
    });

    it('returns null-ish falsy value as-is (empty string passthrough)', () => {
        // raw === '' is falsy; the function returns raw directly
        expect(cleanDuckDBError('')).toBe('');
    });

    it('trims a whitespace-only string to empty', () => {
        // Only spaces — kept.length stays 0 so all blank lines are dropped,
        // then the final .trim() results in ''
        expect(cleanDuckDBError('   ')).toBe('');
    });

    it('trims a newline-only string to empty', () => {
        expect(cleanDuckDBError('\n\n\n')).toBe('');
    });

    // ---- "Error: " prefix stripping ----------------------------------------

    it('strips leading "Error: " wrapper', () => {
        const raw = 'Error: Parser Error: syntax error at or near ","';
        expect(cleanDuckDBError(raw)).toBe('Parser Error: syntax error at or near ","');
    });

    it('strips "Error: " case-insensitively', () => {
        const raw = 'ERROR: Binder Error: Column "x" does not exist!';
        expect(cleanDuckDBError(raw)).toBe('Binder Error: Column "x" does not exist!');
    });

    it('does not strip "Error:" that is part of a longer token (e.g. "Binder Error:")', () => {
        const raw = 'Binder Error: Column "foo" does not exist!';
        expect(cleanDuckDBError(raw)).toBe('Binder Error: Column "foo" does not exist!');
    });

    it('strips double "Error: Error: " wrapper (one level only)', () => {
        // After one strip the remaining text still begins with "Error: " which
        // becomes the error type label — the function strips the outermost only.
        const raw = 'Error: Error: some inner message';
        expect(cleanDuckDBError(raw)).toBe('Error: some inner message');
    });

    it('strips "Error: " from a full real DuckDB wrapper', () => {
        const raw =
            'Error: Parser Error: syntax error at or near "select"\n\nLINE 1: SELECT, select\n                ^\n';
        const result = cleanDuckDBError(raw);
        expect(result).toContain('Parser Error:');
        expect(result).not.toMatch(/^Error:/);
    });

    // ---- LINE N: echo stripping -------------------------------------------

    it('strips a "LINE 1: <sql>" echo line', () => {
        const raw = 'Parser Error: syntax error at or near ","\n\nLINE 1: SELECT,\n              ^\n';
        const result = cleanDuckDBError(raw);
        expect(result).not.toMatch(/LINE\s+\d+:/i);
    });

    it('strips "LINE 2:" echo lines as well', () => {
        const raw = 'Parser Error: foo\n\nLINE 2: WHERE x =\n                 ^\n';
        const result = cleanDuckDBError(raw);
        expect(result).not.toMatch(/LINE\s+\d+:/i);
    });

    it('strips LINE echo for Binder Error', () => {
        const raw =
            'Binder Error: Column "foo" does not exist!\n\nLINE 1: SELECT foo FROM bar\n               ^';
        const result = cleanDuckDBError(raw);
        expect(result).not.toMatch(/LINE\s+\d+:/i);
        expect(result).toContain('Binder Error: Column "foo" does not exist!');
    });

    it('strips indented "  LINE 1:" echo', () => {
        const raw = 'Parser Error: syntax error\n\n  LINE 1: SELECT *\n          ^';
        expect(cleanDuckDBError(raw)).not.toMatch(/LINE\s+\d+:/i);
    });

    // ---- Caret indicator stripping -----------------------------------------

    it('strips a plain caret "^" line', () => {
        const raw = 'Parser Error: syntax error at or near ","\n\nLINE 1: SELECT,\n^\n';
        expect(cleanDuckDBError(raw)).not.toMatch(/^\s*\^\s*$/m);
    });

    it('strips a caret with leading spaces "     ^"', () => {
        const raw = 'Parser Error: foo\n\nLINE 1: SELECT foo\n     ^\n';
        expect(cleanDuckDBError(raw)).not.toMatch(/^\s*\^\s*$/m);
    });

    it('strips a "-----^" dash-caret indicator', () => {
        const raw = 'Parser Error: foo\n\nLINE 1: SELECT foo\n-----^\n';
        expect(cleanDuckDBError(raw)).not.toMatch(/^\s*[-^]+\s*$/m);
    });

    it('strips a "^^^^^" multi-caret line', () => {
        const raw = 'Parser Error: foo\n\nLINE 1: foo bar\n^^^^^\n';
        expect(cleanDuckDBError(raw)).not.toMatch(/^\s*\^+\s*$/m);
    });

    it('strips a line that is only dashes "-------"', () => {
        const raw = 'Parser Error: foo\n-------\n';
        expect(cleanDuckDBError(raw)).not.toMatch(/^\s*-+\s*$/m);
    });

    // ---- Leading blank line stripping --------------------------------------

    it('strips a single leading blank line', () => {
        const raw = '\nParser Error: syntax error';
        const result = cleanDuckDBError(raw);
        expect(result).toBe('Parser Error: syntax error');
        expect(result).not.toMatch(/^\n/);
    });

    it('strips multiple leading blank lines', () => {
        const raw = '\n\n\nBinder Error: Column "x" does not exist!';
        expect(cleanDuckDBError(raw)).toBe('Binder Error: Column "x" does not exist!');
    });

    it('strips leading blank lines left after stripping LINE echo', () => {
        // After stripping "LINE 1: ..." the blank separator lines at the top
        // should also be dropped.
        const raw = 'Parser Error: foo\n\nLINE 1: SELECT foo\n               ^';
        const result = cleanDuckDBError(raw);
        expect(result).not.toMatch(/^\n/);
    });

    // ---- Trailing blank line stripping -------------------------------------

    it('strips a single trailing blank line', () => {
        const raw = 'Parser Error: syntax error\n';
        expect(cleanDuckDBError(raw)).toBe('Parser Error: syntax error');
    });

    it('strips multiple trailing blank lines', () => {
        const raw = 'Parser Error: syntax error\n\n\n';
        expect(cleanDuckDBError(raw)).toBe('Parser Error: syntax error');
    });

    it('strips trailing blank lines after a full DuckDB error block', () => {
        const raw = 'Parser Error: syntax error at or near ","\n\nLINE 1: SELECT,\n              ^\n\n\n';
        const result = cleanDuckDBError(raw);
        expect(result).not.toMatch(/\n$/);
    });

    // ---- "Did you mean?" preservation -------------------------------------

    it('preserves a "Did you mean?" suggestion line', () => {
        const raw =
            'Catalog Error: Table with name events does not exist!\nDid you mean "GarbageCollection"?';
        const result = cleanDuckDBError(raw);
        expect(result).toContain('Did you mean "GarbageCollection"?');
    });

    it('preserves multi-word "Did you mean?" suggestion', () => {
        const raw = 'Binder Error: Column "starttime" does not exist!\nDid you mean "startTime"?';
        const result = cleanDuckDBError(raw);
        expect(result).toContain('Did you mean "startTime"?');
    });

    it('preserves "Did you mean?" even when LINE block is also present', () => {
        const raw =
            'Binder Error: Column "foo" does not exist!\n\nLINE 1: SELECT foo FROM bar\n               ^\nDid you mean "fooBar"?';
        const result = cleanDuckDBError(raw);
        expect(result).toContain('Did you mean "fooBar"?');
        expect(result).not.toMatch(/LINE\s+\d+:/i);
    });

    // ---- Multi-line error message preservation ----------------------------

    it('preserves a multi-line Binder Error with detail', () => {
        const raw = 'Binder Error: UNNEST requires a single list as input\nUse LIST_VALUE to create a list from multiple values.';
        const result = cleanDuckDBError(raw);
        expect(result).toContain('UNNEST requires a single list');
        expect(result).toContain('Use LIST_VALUE');
    });

    it('preserves both error line and suggestion when there is no LINE block', () => {
        const raw = 'Catalog Error: Table with name foo does not exist!\nDid you mean "bar"?';
        const result = cleanDuckDBError(raw);
        const lines = result.split('\n');
        expect(lines.length).toBe(2);
        expect(lines[0]).toContain('Catalog Error');
        expect(lines[1]).toContain('Did you mean');
    });

    // ---- Full real-world DuckDB error formats ------------------------------

    it('cleans a real parser error with comma', () => {
        const raw = 'Parser Error: syntax error at or near ","\n\nLINE 1: SELECT,\n              ^\n';
        const result = cleanDuckDBError(raw);
        expect(result).toBe('Parser Error: syntax error at or near ","');
    });

    it('cleans a real Binder Error with LINE block', () => {
        const raw =
            'Binder Error: Column "foo" does not exist!\n\nLINE 1: SELECT foo FROM bar\n               ^';
        const result = cleanDuckDBError(raw);
        expect(result).toBe('Binder Error: Column "foo" does not exist!');
    });

    it('cleans a real Catalog Error with Did you mean', () => {
        const raw =
            'Catalog Error: Table with name events does not exist!\nDid you mean "GarbageCollection"?';
        const result = cleanDuckDBError(raw);
        expect(result).toBe('Catalog Error: Table with name events does not exist!\nDid you mean "GarbageCollection"?');
    });

    it('cleans Error: wrapped Parser Error with LINE block', () => {
        const raw =
            'Error: Parser Error: syntax error at or near "select"\n\nLINE 1: SELECT, select\n                ^\n';
        const result = cleanDuckDBError(raw);
        expect(result).toBe('Parser Error: syntax error at or near "select"');
    });

    it('cleans an error that has only a message and no LINE block', () => {
        const raw = 'Conversion Error: Could not convert string "abc" to INT32';
        expect(cleanDuckDBError(raw)).toBe('Conversion Error: Could not convert string "abc" to INT32');
    });

    it('cleans a division by zero error', () => {
        const raw = 'Out of Range Error: Division by zero!';
        expect(cleanDuckDBError(raw)).toBe('Out of Range Error: Division by zero!');
    });

    it('cleans a type mismatch error', () => {
        const raw =
            'Binder Error: Cannot compare values of type INTEGER and VARCHAR\n\nLINE 1: WHERE id = \'abc\'\n               ^';
        const result = cleanDuckDBError(raw);
        expect(result).toBe('Binder Error: Cannot compare values of type INTEGER and VARCHAR');
    });

    it('cleans a GROUP BY error', () => {
        const raw =
            'Binder Error: column "name" must appear in the GROUP BY clause or be used in an aggregate function\n\nLINE 1: SELECT name, COUNT(*) FROM t\n               ^';
        const result = cleanDuckDBError(raw);
        expect(result).toBe('Binder Error: column "name" must appear in the GROUP BY clause or be used in an aggregate function');
    });

    it('cleans a LIMIT clause error', () => {
        const raw = 'Parser Error: Limit clause can only contain a constant or a parameter\n\nLINE 1: LIMIT n\n        ^';
        const result = cleanDuckDBError(raw);
        expect(result).toBe('Parser Error: Limit clause can only contain a constant or a parameter');
    });

    it('cleans ambiguous column reference error', () => {
        const raw =
            'Binder Error: Ambiguous reference to column name "id" (use: "a.id" or "b.id")\n\nLINE 1: SELECT id FROM a JOIN b ON a.x = b.x\n               ^';
        const result = cleanDuckDBError(raw);
        expect(result).toBe('Binder Error: Ambiguous reference to column name "id" (use: "a.id" or "b.id")');
    });

    it('cleans end-of-input syntax error', () => {
        const raw = 'Parser Error: syntax error at end of input\n\nLINE 1: SELECT *\n                ^';
        const result = cleanDuckDBError(raw);
        expect(result).toBe('Parser Error: syntax error at end of input');
    });

    it('cleans syntax error at "from"', () => {
        const raw = 'Parser Error: syntax error at or near "from"\n\nLINE 1: SELECT a, FROM t\n                  ^';
        const result = cleanDuckDBError(raw);
        expect(result).toBe('Parser Error: syntax error at or near "from"');
    });

    it('cleans syntax error at "where"', () => {
        const raw = 'Parser Error: syntax error at or near "where"\n\nLINE 1: SELECT WHERE\n               ^';
        const result = cleanDuckDBError(raw);
        expect(result).toBe('Parser Error: syntax error at or near "where"');
    });

    it('cleans syntax error at ")"', () => {
        const raw = 'Parser Error: syntax error at or near ")"\n\nLINE 1: SELECT COUNT(* ) )\n                        ^';
        const result = cleanDuckDBError(raw);
        expect(result).toBe('Parser Error: syntax error at or near ")"');
    });

    it('handles a message with no trailing newline', () => {
        const raw = 'Binder Error: Column "x" does not exist!';
        expect(cleanDuckDBError(raw)).toBe('Binder Error: Column "x" does not exist!');
    });

    it('strips the LINE block but keeps all non-echo, non-caret lines', () => {
        const raw =
            'Parser Error: syntax error at or near ","\n\nLINE 1: SELECT a,\n              ^\nNote: trailing comma detected';
        const result = cleanDuckDBError(raw);
        expect(result).toContain('Parser Error:');
        expect(result).toContain('Note: trailing comma detected');
        expect(result).not.toMatch(/LINE\s+\d+:/i);
    });

    // ---- Idempotence -------------------------------------------------------

    it('is idempotent on an already-clean error message', () => {
        assertIdempotent('Binder Error: Column "foo" does not exist!');
    });

    it('is idempotent on a raw parser error with LINE block', () => {
        assertIdempotent('Parser Error: syntax error at or near ","\n\nLINE 1: SELECT,\n              ^\n');
    });

    it('is idempotent on a Catalog Error with Did you mean', () => {
        assertIdempotent('Catalog Error: Table with name events does not exist!\nDid you mean "GarbageCollection"?');
    });

    it('is idempotent on an Error:-wrapped message', () => {
        assertIdempotent('Error: Parser Error: syntax error at or near "select"\n\nLINE 1: SELECT, select\n                ^\n');
    });

    it('is idempotent on an empty string', () => {
        assertIdempotent('');
    });

    it('is idempotent on a plain one-liner error', () => {
        assertIdempotent('Out of Range Error: Division by zero!');
    });

    it('is idempotent on a conversion error', () => {
        assertIdempotent('Conversion Error: Could not convert string "abc" to INT32');
    });

    // ---- Never returns empty string for meaningful input ------------------

    it('never returns empty string for a non-empty error type line', () => {
        const raw = 'Parser Error: syntax error at or near ","';
        expect(cleanDuckDBError(raw)).not.toBe('');
    });

    it('never returns empty string for a Catalog Error without LINE block', () => {
        const raw = 'Catalog Error: Table with name t does not exist!';
        expect(cleanDuckDBError(raw)).not.toBe('');
    });

    it('never returns empty string for an Error:-wrapped message', () => {
        const raw = 'Error: Binder Error: Column "x" does not exist!';
        expect(cleanDuckDBError(raw)).not.toBe('');
    });

    it('never returns empty string when only LINE/caret lines are present but a real message leads', () => {
        const raw = 'Parser Error: foo\nLINE 1: SELECT foo\n               ^';
        expect(cleanDuckDBError(raw)).not.toBe('');
    });
});

// ---------------------------------------------------------------------------
// heuristicTip
// ---------------------------------------------------------------------------

describe('heuristicTip', () => {

    // ---- No match → empty string ------------------------------------------

    it('returns empty string for an unrecognized error', () => {
        expect(heuristicTip('Something completely unknown happened')).toBe('');
    });

    it('returns empty string for an empty string', () => {
        expect(heuristicTip('')).toBe('');
    });

    it('returns empty string for a generic "Internal Error" message', () => {
        expect(heuristicTip('Internal Error: Assertion failed at optimizer.cpp:42')).toBe('');
    });

    it('returns empty string for a message with "error" but no known pattern', () => {
        expect(heuristicTip('error loading file')).toBe('');
    });

    // ---- Syntax error: extra comma ----------------------------------------

    it('returns comma tip for syntax error at or near ","', () => {
        const tip = heuristicTip('Parser Error: syntax error at or near ","');
        expect(tip).toBe('Tip: Check for an extra comma or a missing keyword before this position.');
    });

    it('comma tip matches case-insensitively (uppercase SYNTAX ERROR)', () => {
        const tip = heuristicTip('PARSER ERROR: SYNTAX ERROR AT OR NEAR ","');
        expect(tip).toContain('Tip:');
        expect(tip).toContain('comma');
    });

    it('comma tip works on a cleaned multi-line error', () => {
        const cleaned = cleanDuckDBError(
            'Parser Error: syntax error at or near ","\n\nLINE 1: SELECT,\n              ^\n',
        );
        expect(heuristicTip(cleaned)).toContain('comma');
    });

    // ---- Syntax error: SELECT mid-query -----------------------------------

    it('returns SELECT tip for syntax error at or near "select"', () => {
        const tip = heuristicTip('Parser Error: syntax error at or near "select"');
        expect(tip).toBe('Tip: A SELECT may have started mid-query. Check for extra commas or unexpected newlines.');
    });

    it('SELECT tip matches regardless of case in error text', () => {
        const tip = heuristicTip('parser error: syntax error at or near "SELECT"');
        expect(tip).toContain('SELECT');
    });

    // ---- Syntax error: FROM -----------------------------------------------

    it('returns FROM tip for syntax error at or near "from"', () => {
        const tip = heuristicTip('Parser Error: syntax error at or near "from"');
        expect(tip).toBe('Tip: Unexpected FROM. Check that the SELECT list is complete and has no trailing comma.');
    });

    it('FROM tip matches uppercase "FROM"', () => {
        const tip = heuristicTip('Parser Error: syntax error at or near "FROM"');
        expect(tip).toContain('FROM');
    });

    // ---- Syntax error: WHERE ----------------------------------------------

    it('returns WHERE tip for syntax error at or near "where"', () => {
        const tip = heuristicTip('Parser Error: syntax error at or near "where"');
        expect(tip).toBe('Tip: Unexpected WHERE. Make sure the FROM clause and table name are present.');
    });

    it('WHERE tip matches uppercase "WHERE"', () => {
        const tip = heuristicTip('Parser Error: syntax error at or near "WHERE"');
        expect(tip).toContain('WHERE');
    });

    // ---- Syntax error: GROUP ----------------------------------------------

    it('returns GROUP tip for syntax error at or near "group"', () => {
        const tip = heuristicTip('Parser Error: syntax error at or near "group"');
        expect(tip).toBe('Tip: Unexpected GROUP. Ensure the SELECT and FROM clauses are complete.');
    });

    // ---- Syntax error: ORDER ----------------------------------------------

    it('returns ORDER tip for syntax error at or near "order"', () => {
        const tip = heuristicTip('Parser Error: syntax error at or near "order"');
        expect(tip).toBe('Tip: Unexpected ORDER. Make sure all clauses before ORDER BY are complete.');
    });

    // ---- Syntax error: HAVING ---------------------------------------------

    it('returns HAVING tip for syntax error at or near "having"', () => {
        const tip = heuristicTip('Parser Error: syntax error at or near "having"');
        expect(tip).toBe('Tip: HAVING requires a GROUP BY clause. Make sure GROUP BY comes first.');
    });

    // ---- Syntax error: ) --------------------------------------------------

    it('returns paren tip for syntax error at or near ")"', () => {
        const tip = heuristicTip('Parser Error: syntax error at or near ")"');
        expect(tip).toBe('Tip: Unexpected closing parenthesis. Check for unmatched or extra parentheses.');
    });

    it('closing paren tip matches uppercase SYNTAX ERROR', () => {
        const tip = heuristicTip('PARSER ERROR: SYNTAX ERROR AT OR NEAR ")"');
        expect(tip).toContain('parenthes');
    });

    // ---- Syntax error: ( --------------------------------------------------

    it('returns opening paren tip for syntax error at or near "("', () => {
        const tip = heuristicTip('Parser Error: syntax error at or near "("');
        expect(tip).toBe('Tip: Unexpected opening parenthesis. Check function call syntax or subquery placement.');
    });

    // ---- Syntax error: ; --------------------------------------------------

    it('returns semicolon tip for syntax error at or near ";"', () => {
        const tip = heuristicTip('Parser Error: syntax error at or near ";"');
        expect(tip).toBe('Tip: Unexpected semicolon. Each SQL block should contain one statement.');
    });

    // ---- Syntax error: end of input ---------------------------------------

    it('returns incomplete-query tip for syntax error at or near "end of input"', () => {
        // The TIPS array matches /syntax error at or near "end of input"/i, so
        // the input must include the literal token "end of input" in quotes.
        const tip = heuristicTip('Parser Error: syntax error at or near "end of input"');
        expect(tip).toBe('Tip: The query appears incomplete. Make sure all clauses and parentheses are closed.');
    });

    it('"end of input" tip matches case-insensitively', () => {
        const tip = heuristicTip('PARSER ERROR: SYNTAX ERROR AT OR NEAR "END OF INPUT"');
        expect(tip).toContain('incomplete');
    });

    it('plain "syntax error at end of input" (no quotes) falls through to generic syntax tip', () => {
        // The specific pattern requires the token in double-quotes; without them
        // the generic syntax error fallback fires instead.
        const tip = heuristicTip('Parser Error: syntax error at end of input');
        expect(tip).toBe('Tip: Check the query near the highlighted position for a typo, missing keyword, or unbalanced parenthesis.');
    });

    // ---- Generic syntax error fallback ------------------------------------

    it('returns generic syntax tip when no specific token is named', () => {
        const tip = heuristicTip('Parser Error: syntax error near position 42');
        expect(tip).toBe('Tip: Check the query near the highlighted position for a typo, missing keyword, or unbalanced parenthesis.');
    });

    it('generic syntax tip is a fallback and does not fire for specific tokens', () => {
        // "," is more specific and should win over the generic fallback
        const tip = heuristicTip('Parser Error: syntax error at or near ","');
        expect(tip).not.toContain('typo');
    });

    // ---- Column does not exist --------------------------------------------

    it('returns column tip for column does not exist error', () => {
        const tip = heuristicTip('Binder Error: Column "foo" does not exist!');
        expect(tip).toBe('Tip: Check the column name spelling. Use the columns bar above the query result to see available columns.');
    });

    it('column tip matches regardless of column name', () => {
        const tip = heuristicTip('Binder Error: Column "startTime" does not exist!');
        expect(tip).toContain('column name spelling');
    });

    it('column tip matches case-insensitively', () => {
        const tip = heuristicTip('BINDER ERROR: COLUMN "X" DOES NOT EXIST!');
        expect(tip).toContain('column name spelling');
    });

    // ---- Referenced column not found --------------------------------------

    it('returns "not found" tip for referenced column not found', () => {
        const tip = heuristicTip('Binder Error: Referenced column "total" not found in FROM clause');
        expect(tip).toBe('Tip: The column was not found in the query result. Verify the column name or add it to the SELECT list.');
    });

    // ---- Generic binder column error --------------------------------------

    it('returns binder column tip for generic binder column message', () => {
        const tip = heuristicTip('Binder Error: column is ambiguous');
        expect(tip).toContain('column name');
    });

    // ---- Table does not exist ---------------------------------------------

    it('returns table tip for table does not exist error', () => {
        const tip = heuristicTip('Catalog Error: Table "events" does not exist!');
        expect(tip).toContain('table name');
    });

    it('table tip matches case-insensitively', () => {
        const tip = heuristicTip('CATALOG ERROR: TABLE "EVENTS" DOES NOT EXIST!');
        expect(tip).toContain('table');
    });

    // ---- "Table with name" variant ----------------------------------------

    it('returns table tip for "Table with name X does not exist" variant', () => {
        // Note: "Catalog Error: Table with name ..." matches the generic
        // /catalog error/i pattern before /table with name.../i in TIPS, so
        // the catalog error tip fires.
        const tip = heuristicTip('Catalog Error: Table with name events does not exist!');
        expect(tip).toBe('Tip: The table or view may not exist yet. Run the notebook cells in order to create required views.');
    });

    it('"table with name" tip works after cleanDuckDBError with Did you mean', () => {
        const raw =
            'Catalog Error: Table with name events does not exist!\nDid you mean "GarbageCollection"?';
        const cleaned = cleanDuckDBError(raw);
        const tip = heuristicTip(cleaned);
        // catalog error pattern fires first
        expect(tip).toContain('table or view');
    });

    // ---- Catalog Error generic --------------------------------------------

    it('returns catalog tip for a generic Catalog Error', () => {
        const tip = heuristicTip('Catalog Error: Entry with name "my_view" does not exist!');
        expect(tip).toBe('Tip: The table or view may not exist yet. Run the notebook cells in order to create required views.');
    });

    it('catalog tip matches case-insensitively', () => {
        const tip = heuristicTip('CATALOG ERROR: some schema object missing');
        expect(tip).toContain('table or view');
    });

    // ---- Division by zero -------------------------------------------------

    it('returns NULLIF tip for division by zero', () => {
        const tip = heuristicTip('Out of Range Error: Division by zero!');
        expect(tip).toBe('Tip: Add a guard: use NULLIF(divisor, 0) to prevent division-by-zero errors.');
    });

    it('division by zero tip matches case-insensitively', () => {
        const tip = heuristicTip('OUT OF RANGE ERROR: DIVISION BY ZERO');
        expect(tip).toContain('NULLIF');
    });

    // ---- LIMIT constant ---------------------------------------------------

    it('returns LIMIT tip for "Limit clause can only contain a constant"', () => {
        const tip = heuristicTip('Parser Error: Limit clause can only contain a constant or a parameter');
        expect(tip).toBe('Tip: Use a numeric literal as the LIMIT value, e.g. LIMIT 10.');
    });

    it('LIMIT tip matches case-insensitively', () => {
        const tip = heuristicTip('PARSER ERROR: LIMIT CLAUSE CAN ONLY CONTAIN A CONSTANT');
        expect(tip).toContain('LIMIT');
    });

    // ---- GROUP BY requirement ---------------------------------------------

    it('returns GROUP BY tip for non-aggregated column in SELECT', () => {
        // The message contains "Binder Error: column..." which matches
        // /binder error.*column/i before /must appear in the GROUP BY clause/i.
        // To reach the GROUP BY tip, the message must NOT match the column pattern.
        const tip = heuristicTip(
            'Binder Error: "name" must appear in the GROUP BY clause or be used in an aggregate function',
        );
        expect(tip).toBe('Tip: All non-aggregated columns in SELECT must appear in the GROUP BY clause.');
    });

    it('GROUP BY tip matches case-insensitively', () => {
        const tip = heuristicTip(
            'BINDER ERROR: "X" MUST APPEAR IN THE GROUP BY CLAUSE',
        );
        expect(tip).toContain('GROUP BY');
    });

    // ---- Type conversion / casting ----------------------------------------

    it('returns cast tip for cannot compare values of type', () => {
        const tip = heuristicTip('Binder Error: Cannot compare values of type INTEGER and VARCHAR');
        expect(tip).toBe('Tip: You may be comparing incompatible types. Try casting with ::INTEGER or ::VARCHAR.');
    });

    it('returns cast tip for conversion error', () => {
        const tip = heuristicTip('Conversion Error: Could not convert string "abc" to INT32');
        expect(tip).toBe('Tip: A value cannot be cast to the expected type. Check that the column contains the expected data type.');
    });

    it('conversion tip matches case-insensitively', () => {
        const tip = heuristicTip('CONVERSION ERROR: COULD NOT CONVERT VALUE');
        expect(tip).toContain('cast');
    });

    // ---- Operator does not exist ------------------------------------------

    it('returns operator tip for "operator does not exist"', () => {
        const tip = heuristicTip('Binder Error: Operator + does not exist for types VARCHAR and INTEGER');
        expect(tip).toBe('Tip: The operator cannot be applied to these types. You may need an explicit cast.');
    });

    // ---- Ambiguous reference ----------------------------------------------

    it('returns qualify tip for ambiguous reference', () => {
        // A message with "Binder Error: Ambiguous reference" but without the
        // word "column" does NOT match /binder error.*column/i, so the
        // /ambiguous reference/i pattern fires.
        const tip = heuristicTip('Binder Error: Ambiguous reference to "id" — use table alias');
        expect(tip).toBe('Tip: Qualify the column with its table alias, e.g. t1.column_name.');
    });

    it('ambiguous reference tip fires when "Binder Error" and "column" are absent', () => {
        // If the message does not start with "Binder Error" and contains "ambiguous reference"
        // the dedicated tip fires.
        const tip = heuristicTip('Planner: ambiguous reference to field "id"');
        expect(tip).toBe('Tip: Qualify the column with its table alias, e.g. t1.column_name.');
    });

    it('"Binder Error: Ambiguous reference to column name" fires ambiguous reference tip', () => {
        // ambiguous reference pattern now sits before binder error.*column in TIPS
        // so the dedicated qualify-tip fires even when the message also contains "column".
        const tip = heuristicTip('Binder Error: Ambiguous reference to column name "id"');
        expect(tip).toBe('Tip: Qualify the column with its table alias, e.g. t1.column_name.');
    });

    it('ambiguous reference tip matches case-insensitively when no binder+column overlap', () => {
        const tip = heuristicTip('AMBIGUOUS REFERENCE TO IDENTIFIER "x"');
        expect(tip).toContain('table alias');
    });

    // ---- Nested aggregates ------------------------------------------------

    it('returns nested-aggregate tip for "aggregates cannot be nested"', () => {
        const tip = heuristicTip('Binder Error: Aggregates cannot be nested!');
        expect(tip).toBe('Tip: You cannot nest aggregate functions (e.g. SUM inside COUNT). Use a subquery or CTE instead.');
    });

    // ---- Aggregate in WHERE -----------------------------------------------

    it('returns HAVING tip for aggregate function inside group context message', () => {
        const tip = heuristicTip('Binder Error: Aggregate function inside group');
        expect(tip).toContain('HAVING');
    });

    // ---- Out-of-range / overflow ------------------------------------------

    it('returns overflow tip for out of range error', () => {
        const tip = heuristicTip('Out of Range Error: Overflow in operator multiply');
        expect(tip).toBe('Tip: A numeric value overflowed its type. Try casting to BIGINT or DOUBLE.');
    });

    it('out of range tip matches case-insensitively', () => {
        const tip = heuristicTip('OUT OF RANGE ERROR: VALUE 99999 OUT OF RANGE FOR INT8');
        expect(tip).toContain('BIGINT');
    });

    // ---- Only single SELECT statement ------------------------------------

    it('returns single-statement tip for "only a single select statement"', () => {
        const tip = heuristicTip('Parser Error: only a single select statement is allowed');
        expect(tip).toBe('Tip: Place each SQL statement in a separate SQL block.');
    });

    // ---- All returned tips start with "Tip:" ------------------------------

    const knownErrorsAndExpectedSubstrings: Array<[string, string]> = [
        ['Parser Error: syntax error at or near ","', 'comma'],
        ['Parser Error: syntax error at or near "select"', 'SELECT'],
        ['Parser Error: syntax error at or near "from"', 'FROM'],
        ['Parser Error: syntax error at or near "where"', 'WHERE'],
        ['Parser Error: syntax error at or near "group"', 'GROUP'],
        ['Parser Error: syntax error at or near "order"', 'ORDER'],
        ['Parser Error: syntax error at or near "having"', 'HAVING'],
        ['Parser Error: syntax error at or near ")"', 'parenthes'],
        ['Parser Error: syntax error at or near "("', 'parenthesis'],
        ['Parser Error: syntax error at or near ";"', 'semicolon'],
        // "end of input" must appear in quotes to match the specific pattern
        ['Parser Error: syntax error at or near "end of input"', 'incomplete'],
        ['Parser Error: syntax error near position 5', 'typo'],
        ['Binder Error: Column "x" does not exist!', 'column name spelling'],
        ['Catalog Error: Table "t" does not exist!', 'table name'],
        ['Catalog Error: Entry "v" does not exist!', 'table or view'],
        ['Out of Range Error: Division by zero!', 'NULLIF'],
        ['Parser Error: Limit clause can only contain a constant', 'LIMIT 10'],
        // GROUP BY tip only fires when the text doesn't also say "column"
        ['"name" must appear in the GROUP BY clause or be used in an aggregate function', 'GROUP BY'],
        ['Binder Error: Cannot compare values of type INTEGER and VARCHAR', '::INTEGER'],
        ['Conversion Error: Could not convert string "x" to INT32', 'cast'],
        // Ambiguous reference tip only fires when binder error + column don't both appear
        ['AMBIGUOUS REFERENCE TO IDENTIFIER "x"', 'table alias'],
        ['Out of Range Error: Overflow in operator', 'BIGINT'],
    ];

    for (const [msg, expectedSubstr] of knownErrorsAndExpectedSubstrings) {
        it(`tip for "${msg.slice(0, 50)}..." starts with "Tip:"`, () => {
            const tip = heuristicTip(msg);
            expect(tip).toMatch(/^Tip:/);
        });

        it(`tip for "${msg.slice(0, 50)}..." contains "${expectedSubstr}"`, () => {
            expect(heuristicTip(msg)).toContain(expectedSubstr);
        });
    }
});
