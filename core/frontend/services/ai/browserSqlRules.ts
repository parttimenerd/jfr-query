// Naive rule-based SQL completion used by the browser provider when no
// trained SQL model is loaded. Parses the structured user-prompt produced
// by `aiAutocomplete/contextBuilder.ts` and returns a single short
// completion the user can accept as ghost text.
//
// The prompt format is OUR format — stable enough to regex against.
// Sections are separated by blank lines; the cursor sits at `<<CURSOR>>`
// inside `# Current cell — text before cursor`.

const SECTION_SCHEMA = '# Schema\n';
const SECTION_RESULT_COLS = '# Current cell result columns\n';
const SECTION_CURRENT_CELL = '# Current cell — text before cursor\n';

function extractSection(prompt: string, header: string): string | null {
    const start = prompt.indexOf(header);
    if (start < 0) return null;
    const after = prompt.indexOf('\n\n', start + header.length);
    return prompt.slice(start + header.length, after < 0 ? prompt.length : after);
}

function extractTablesFromSchema(schemaBlock: string): string[] {
    const tables: string[] = [];
    for (const line of schemaBlock.split('\n')) {
        const m = line.match(/^-\s+"([^"]+)":/);
        if (m) tables.push(m[1]);
    }
    return tables;
}

function extractResultCols(resultBlock: string): string[] {
    const cols: string[] = [];
    const re = /"([^"]+)"\s+\w+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(resultBlock)) !== null) cols.push(m[1]);
    return cols;
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

/** Public: parse the # Schema block into structured TableSchema entries. */
export function extractSchema(prompt: string): { name: string; columns: { name: string; type: string }[] }[] {
    const block = extractSection(prompt, SECTION_SCHEMA);
    if (!block) return [];
    const tables: { name: string; columns: { name: string; type: string }[] }[] = [];
    for (const line of block.split('\n')) {
        // Line shape: - "tableName": ("col1" TYPE, "col2" TYPE)
        const m = line.match(/^-\s+"([^"]+)":\s*\(([^)]*)\)/);
        if (!m) continue;
        const tableName = m[1];
        const colsRaw = m[2];
        const cols: { name: string; type: string }[] = [];
        const colRe = /"([^"]+)"\s+(\w+)/g;
        let cm: RegExpExecArray | null;
        while ((cm = colRe.exec(colsRaw)) !== null) {
            cols.push({ name: cm[1], type: cm[2] });
        }
        tables.push({ name: tableName, columns: cols });
    }
    return tables;
}

// Detect which SQL clause the cursor is in by scanning the prefix
// right-to-left for the nearest clause keyword. Naive but covers the
// common cases.
type Clause = 'select' | 'from' | 'where' | 'groupBy' | 'orderBy' | 'having' | 'join' | 'on' | null;

function detectClause(prefix: string): Clause {
    const upper = prefix.toUpperCase();
    // Walk markers right-to-left.
    type Marker = { idx: number; tag: Clause };
    const markers: Marker[] = [];
    const find = (kw: string, tag: Clause) => {
        const idx = upper.lastIndexOf(kw);
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
    if (markers.length === 0) return null;
    markers.sort((a, b) => b.idx - a.idx);
    return markers[0].tag;
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
    const tables = schemaBlock ? extractTablesFromSchema(schemaBlock) : [];
    const resultCols = resultBlock ? extractResultCols(resultBlock) : [];

    const clause = detectClause(prefix);
    const endsWithSpace = /\s$/.test(prefix);
    const lastChar = trimmed[trimmed.length - 1];

    // SELECT list — suggest first result column or `*`.
    if (clause === 'select' && endsWithSpace) {
        if (resultCols.length > 0) return `"${resultCols[0]}"`;
        if (tables.length > 0) return '*';
    }

    // After a comma in SELECT — suggest next result column.
    if (clause === 'select' && lastChar === ',') {
        if (resultCols.length > 1) return ` "${resultCols[1]}"`;
        if (resultCols.length > 0) return ` "${resultCols[0]}"`;
    }

    // FROM — suggest first schema table.
    if (clause === 'from' && (endsWithSpace || lastChar === ',')) {
        if (tables.length > 0) return tables[0];
    }

    // JOIN — also wants a table.
    if (clause === 'join' && endsWithSpace) {
        if (tables.length > 0) return tables[0];
    }

    // WHERE — if the last token looks like an identifier, suggest `= `.
    if ((clause === 'where' || clause === 'having' || clause === 'on') && endsWithSpace) {
        // Word right before the cursor — if it's an identifier, suggest operator.
        const tail = prefix.match(/([\w"]+)\s+$/);
        if (tail) {
            // Already-typed identifier — suggest equality op.
            return '= ';
        }
        // Cursor right after WHERE — suggest first result column.
        if (resultCols.length > 0) return `"${resultCols[0]}"`;
    }

    // GROUP BY / ORDER BY — suggest first column.
    if ((clause === 'groupBy' || clause === 'orderBy') && endsWithSpace) {
        if (resultCols.length > 0) return `"${resultCols[0]}"`;
    }

    return null;
}
