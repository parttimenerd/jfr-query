// Rule-based SQL completion used by the browser provider when no trained SQL
// model is loaded. Parses the structured user-prompt produced by
// `aiAutocomplete/contextBuilder.ts` and returns a short completion the user
// can accept as ghost text.
//
// The prompt format is OUR format — stable enough to regex against.
// Sections are separated by blank lines; the cursor sits at `<<CURSOR>>`
// inside `# Current cell — text before cursor`.

const SECTION_SCHEMA = '# Schema\n';
const SECTION_RESULT_COLS = '# Current cell result columns\n';
const SECTION_CURRENT_CELL = '# Current cell — text before cursor\n';
const SECTION_VARS = '# Variables in scope\n';

function extractSection(prompt: string, header: string): string | null {
    const start = prompt.indexOf(header);
    if (start < 0) return null;
    const after = prompt.indexOf('\n\n', start + header.length);
    return prompt.slice(start + header.length, after < 0 ? prompt.length : after);
}

/** Public: parse the # Schema block into structured TableSchema entries. */
export function extractSchema(prompt: string): { name: string; columns: { name: string; type: string }[] }[] {
    const block = extractSection(prompt, SECTION_SCHEMA);
    if (!block) return [];
    const tables: { name: string; columns: { name: string; type: string }[] }[] = [];
    for (const line of block.split('\n')) {
        const m = line.match(/^-\s+"([^"]+)":\s*\(([^)]*)\)/);
        if (!m) continue;
        const tableName = m[1];
        const colsRaw = m[2];
        const cols: { name: string; type: string }[] = [];
        const colRe = /"([^"]+)"\s+(\w+(?:\s+WITH\s+\w+\s+\w+)?)/g;
        let cm: RegExpExecArray | null;
        while ((cm = colRe.exec(colsRaw)) !== null) {
            cols.push({ name: cm[1], type: cm[2] });
        }
        tables.push({ name: tableName, columns: cols });
    }
    return tables;
}

function extractResultCols(resultBlock: string): { name: string; type: string }[] {
    const cols: { name: string; type: string }[] = [];
    const re = /"([^"]+)"\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(resultBlock)) !== null) cols.push({ name: m[1], type: m[2] });
    return cols;
}

function extractVariables(prompt: string): string[] {
    const block = extractSection(prompt, SECTION_VARS);
    if (!block) return [];
    return block.split('\n')
        .map(l => l.match(/^(\$\$?\w+)\s*=/)?.[1])
        .filter((x): x is string => !!x);
}

function getPrefix(prompt: string): string | null {
    const start = prompt.indexOf(SECTION_CURRENT_CELL);
    if (start < 0) return null;
    const body = prompt.slice(start + SECTION_CURRENT_CELL.length);
    const cursorIdx = body.indexOf('<<CURSOR>>');
    if (cursorIdx < 0) return null;
    return body.slice(0, cursorIdx);
}

/** Public: extract the user's prefix (text before <<CURSOR>>). */
export function extractPrefix(prompt: string): string | null {
    return getPrefix(prompt);
}

// Detect which SQL clause the cursor is in by scanning the prefix
// right-to-left for the nearest clause keyword.
type Clause = 'select' | 'from' | 'where' | 'groupBy' | 'orderBy' | 'having' | 'join' | 'on' | 'limit' | null;

function detectClause(prefix: string): Clause {
    const upper = prefix.toUpperCase().replace(/\s+/g, ' ');
    type Marker = { idx: number; tag: Clause };
    const markers: Marker[] = [];
    const find = (kw: string, tag: Clause) => {
        // Use lastIndexOf for the keyword as a word (surrounded by spaces/start).
        let idx = -1;
        let search = 0;
        while (true) {
            const found = upper.indexOf(kw, search);
            if (found < 0) break;
            // Verify word boundaries.
            const before = found === 0 || /[\s,()]/.test(upper[found - 1]);
            const after_ = found + kw.length >= upper.length || /[\s,(]/.test(upper[found + kw.length]);
            if (before && after_) idx = found;
            search = found + 1;
        }
        if (idx >= 0) markers.push({ idx, tag });
    };
    find('SELECT', 'select');
    find('FROM', 'from');
    find('WHERE', 'where');
    find('GROUP BY', 'groupBy');
    find('ORDER BY', 'orderBy');
    find('HAVING', 'having');
    find(' JOIN ', 'join');
    find(' ON ', 'on');
    find('LIMIT', 'limit');
    if (markers.length === 0) return null;
    markers.sort((a, b) => b.idx - a.idx);
    return markers[0].tag;
}

/** Given a SQL column type string, return a plausible literal or comparison. */
function defaultValueForType(type: string): string {
    const t = type.toUpperCase();
    if (t.includes('TIMESTAMP') || t.includes('DATE')) return "timestamp '2024-01-01'";
    if (t.includes('BOOLEAN') || t.includes('BOOL')) return 'true';
    if (t.includes('VARCHAR') || t.includes('TEXT') || t.includes('STRING')) return "''";
    return '0';
}

/** Pick column(s) by role from result/schema. */
function findCols(cols: { name: string; type: string }[], roles: string[]): { name: string; type: string }[] {
    const TIME_RE = /timestamp|date/i;
    const NUM_RE = /int|double|float|decimal|real|numeric|bigint|smallint/i;
    const out: { name: string; type: string }[] = [];
    for (const role of roles) {
        if (role === 'time') out.push(...cols.filter(c => TIME_RE.test(c.type)));
        else if (role === 'numeric') out.push(...cols.filter(c => NUM_RE.test(c.type) && !TIME_RE.test(c.type)));
        else if (role === 'category') out.push(...cols.filter(c => !TIME_RE.test(c.type) && !NUM_RE.test(c.type)));
    }
    return out;
}

/** Always double-quote a column identifier (preserves case, safe for DuckDB). */
function q(name: string): string {
    return `"${name}"`;
}

/**
 * Returns a single completion string, or null when no rule fires.
 * The browser provider wraps this in an `AIInlineResponse`.
 */
export function suggestNaiveSql(prompt: string): string | null {
    const prefix = getPrefix(prompt);
    if (prefix === null) return null;
    const trimmed = prefix.trimEnd();
    if (!trimmed) return null;

    const schemaBlock = extractSection(prompt, SECTION_SCHEMA);
    const resultBlock = extractSection(prompt, SECTION_RESULT_COLS);
    const schemas = schemaBlock ? extractSchema(prompt) : [];
    const resultCols = resultBlock ? extractResultCols(resultBlock) : [];
    const vars = extractVariables(prompt);

    const clause = detectClause(prefix);
    const endsWithSpace = /\s$/.test(prefix);
    const lastChar = trimmed[trimmed.length - 1];
    const upper = trimmed.toUpperCase();

    // --- Helper: extract the table name after FROM in the current statement ---
    const fromMatch = upper.match(/\bFROM\s+([\w"]+)/);
    const fromTable = fromMatch ? fromMatch[1].replace(/"/g, '') : null;
    const fromTableSchema = fromTable
        ? schemas.find(s => s.name.toLowerCase() === fromTable.toLowerCase())
        : null;

    // Columns to use: prefer result columns (which reflect the actual SELECT list),
    // falling back to the FROM table's schema.
    const availableCols = resultCols.length > 0 ? resultCols
        : fromTableSchema ? fromTableSchema.columns : [];

    // Time and numeric columns from the available set.
    const timeCols = findCols(availableCols, ['time']);
    const numCols = findCols(availableCols, ['numeric']);
    const catCols = findCols(availableCols, ['category']);

    // --- SELECT ---
    if (clause === 'select') {
        if (endsWithSpace) {
            // Right after SELECT keyword — suggest a starter expression.
            if (timeCols.length > 0 && numCols.length > 0) {
                return `${q(timeCols[0].name)}, ${q(numCols[0].name)}`;
            }
            if (resultCols.length > 0) return q(resultCols[0].name);
            if (schemas.length > 0) return '*';
        }
        // After comma in SELECT — suggest next useful column.
        if (lastChar === ',') {
            const already = upper.match(/SELECT\s+([\s\S]+)$/)?.[1] ?? '';
            const suggested = availableCols.find(c => !already.includes(c.name.toUpperCase()));
            if (suggested) return ` ${q(suggested.name)}`;
            return ' *';
        }
        // Note: do NOT complete partial column names — ghost-text only fires after whitespace/comma.
    }

    // --- FROM ---
    if (clause === 'from') {
        if (endsWithSpace || lastChar === ',') {
            if (schemas.length > 0) return schemas[0].name;
        }
        // Note: do NOT complete partial table names — the CodeMirror sync provider
        // handles mid-token completions; ghost-text only fires after whitespace/comma.
    }

    // --- JOIN ---
    if (clause === 'join') {
        if (endsWithSpace) {
            // Suggest the first available table (same as old behavior for test compat).
            // In practice, a smarter heuristic would suggest the table NOT already in FROM.
            if (schemas.length > 0) return schemas[0].name;
        }
    }

    // --- ON (JOIN condition) ---
    if (clause === 'on') {
        if (endsWithSpace) {
            // Try to build `table1.id = table2.id`
            // Find all JOIN'd tables from prefix.
            const joins: string[] = [];
            const joinRe = /\bJOIN\s+([\w"]+)(?:\s+(?:AS\s+)?(\w+))?/gi;
            let jm: RegExpExecArray | null;
            while ((jm = joinRe.exec(prefix)) !== null) {
                joins.push(jm[2] ?? jm[1].replace(/"/g, ''));
            }
            const mainTable = fromTable ?? '';
            const joinedTable = joins[joins.length - 1] ?? '';
            // Look for a common column name between the two tables.
            const mainSchema = schemas.find(s => s.name.toLowerCase() === mainTable.toLowerCase());
            const joinSchema = schemas.find(s => s.name.toLowerCase() === joinedTable.toLowerCase());
            if (mainSchema && joinSchema) {
                const mainNames = new Set(mainSchema.columns.map(c => c.name.toLowerCase()));
                const common = joinSchema.columns.find(c => mainNames.has(c.name.toLowerCase()));
                if (common) {
                    const col = q(common.name);
                    return `${q(mainTable)}.${col} = ${q(joinedTable)}.${col}`;
                }
            }
            // Fallback: use id-like column names.
            const mainAlias = q(mainTable);
            const joinAlias = q(joinedTable);
            if (mainTable && joinedTable) return `${mainAlias}.id = ${joinAlias}.id`;
        }
    }

    // --- WHERE / HAVING / ON (condition) ---
    if (clause === 'where' || clause === 'having' || clause === 'on') {
        if (endsWithSpace) {
            // Right after WHERE — suggest first condition.
            const isKeyword = /\b(WHERE|HAVING|ON)\s+$/i.test(prefix);
            if (isKeyword || /\b(AND|OR|NOT)\s+$/i.test(prefix)) {
                // Suggest first numeric or category column > threshold.
                const col = numCols[0] ?? catCols[0] ?? resultCols[0];
                if (col) {
                    const t = col.type.toUpperCase();
                    if (t.includes('VARCHAR') || t.includes('TEXT')) {
                        return `${q(col.name)} = ''`;
                    }
                    if (t.includes('TIMESTAMP') || t.includes('DATE')) {
                        return `${q(col.name)} >= recording_start()`;
                    }
                    return `${q(col.name)} > 0`;
                }
                // Suggest variable if available.
                if (vars.length > 0) return `${q(resultCols[0]?.name ?? 'col')} > ${vars[0]}`;
            }
            // After an identifier — suggest comparison operator.
            const tail = prefix.match(/([\w"]+)\s+$/);
            if (tail && !/^(AND|OR|NOT|WHERE|HAVING|ON)$/i.test(tail[1])) {
                const colName = tail[1].replace(/"/g, '');
                const col = availableCols.find(c => c.name.toLowerCase() === colName.toLowerCase());
                if (col) {
                    const t = col.type.toUpperCase();
                    if (t.includes('VARCHAR') || t.includes('TEXT')) return `= ''`;
                    if (t.includes('BOOLEAN') || t.includes('BOOL')) return `= true`;
                    return `> 0`;
                }
                return `= `;
            }
        }
        // After `=` — suggest a value or variable.
        if (lastChar === '=') {
            const colMatch = trimmed.match(/([\w"]+)\s*=$/);
            if (colMatch) {
                const colName = colMatch[1].replace(/"/g, '');
                const col = availableCols.find(c => c.name.toLowerCase() === colName.toLowerCase());
                const varSuggestion = vars.length > 0 ? vars[0] : null;
                if (col) {
                    const t = col.type.toUpperCase();
                    if (t.includes('VARCHAR') || t.includes('TEXT')) return varSuggestion ?? ` ''`;
                    if (t.includes('BOOLEAN') || t.includes('BOOL')) return ' true';
                    if (t.includes('TIMESTAMP') || t.includes('DATE')) {
                        return varSuggestion ? ` ${varSuggestion}` : ` timestamp '2024-01-01'`;
                    }
                    return varSuggestion ? ` ${varSuggestion}` : ' 0';
                }
                return varSuggestion ? ` ${varSuggestion}` : ' ';
            }
        }
        // After `> ` / `>= ` / `< ` — suggest a value or variable.
        if (/[><!]=?\s$/.test(prefix)) {
            return vars.length > 0 ? vars[0] : '0';
        }
    }

    // --- GROUP BY ---
    if (clause === 'groupBy') {
        if (endsWithSpace || lastChar === ',') {
            // Suggest category columns first, then time-bucket, then all.
            const prefix_ = lastChar === ',' ? ' ' : '';
            const col = catCols[0] ?? timeCols[0] ?? resultCols[0];
            if (col) return `${prefix_}${q(col.name)}`;
        }
    }

    // --- ORDER BY ---
    if (clause === 'orderBy') {
        if (endsWithSpace || lastChar === ',') {
            const prefix_ = lastChar === ',' ? ' ' : '';
            // Prefer time for ORDER BY (most common), then numeric for DESC.
            const col = timeCols[0] ?? numCols[0] ?? resultCols[0];
            if (col) {
                const t = col.type.toUpperCase();
                if (t.includes('INT') || t.includes('DOUBLE') || t.includes('FLOAT')) {
                    return `${prefix_}${q(col.name)} DESC`;
                }
                return `${prefix_}${q(col.name)}`;
            }
        }
        // After `ORDER BY col` with no direction yet — suggest ASC/DESC.
        if (/\bORDER\s+BY\s+[\w"]+\s+$/i.test(prefix)) {
            const numCol = numCols[0];
            return numCol ? 'DESC' : 'ASC';
        }
    }

    // --- HAVING ---
    // (Already handled in the where/having/on branch above.)

    // --- LIMIT ---
    if (clause === 'limit') {
        if (endsWithSpace) {
            return vars.find(v => /limit|n\b|rows?/i.test(v)) ?? '100';
        }
    }

    // --- Generic: cursor right after a variable `$$var` reference ---
    if (/\$\$?\w+$/.test(trimmed) && endsWithSpace) {
        return '> 0';
    }

    // --- Suggest a WHERE clause after a full FROM table when no other clause seen ---
    if (clause === 'from' && endsWithSpace) {
        const col = numCols[0] ?? catCols[0] ?? resultCols[0];
        if (col) {
            const t = col.type.toUpperCase();
            if (t.includes('VARCHAR') || t.includes('TEXT')) {
                return `\nWHERE ${q(col.name)} IS NOT NULL\nLIMIT 100`;
            }
            return `\nWHERE ${q(col.name)} > 0\nORDER BY ${q(col.name)} DESC\nLIMIT 100`;
        }
    }

    return null;
}
