import type { TableSchema, ViewSchema, MacroSchema, ColumnSchema } from '../../types';

export type VisibilityMode = 'no-data' | 'sanitized' | 'full';

export interface ResultColumn {
    name: string;
    type: string;
}

export interface RecentResult {
    columns: ResultColumn[];
    rows: Array<Record<string, any>>;
}

export interface SchemaBundle {
    tables: TableSchema[];
    views: ViewSchema[];
    macros: MacroSchema[];
}

export const DEFAULT_FULL_ROW_LIMIT = 50;
export const MAX_FULL_ROW_LIMIT = 500;

// Regex used to scrub any reference to the protected variable namespace.
// Single source of construction so all visibility payloads share the same
// strip rule.
const PROTECTED_TOKEN_RE = /\$ai_providers\b/gi;

function isNumericType(type: string | undefined | null): boolean {
    if (!type) return false;
    const t = type.toUpperCase();
    return (
        t.includes('INT') ||
        t.includes('DECIMAL') ||
        t.includes('DOUBLE') ||
        t.includes('FLOAT') ||
        t.includes('REAL') ||
        t.includes('NUMERIC') ||
        t.includes('HUGEINT') ||
        t.includes('UTINYINT') ||
        t.includes('USMALLINT') ||
        t.includes('UINTEGER') ||
        t.includes('UBIGINT') ||
        t.includes('TINYINT') ||
        t.includes('SMALLINT') ||
        t.includes('BIGINT')
    );
}

function isStringType(type: string | undefined | null): boolean {
    if (!type) return false;
    const t = type.toUpperCase();
    return t.includes('VARCHAR') || t.includes('CHAR') || t.includes('TEXT') || t.includes('STRING') || t === 'UUID';
}

/**
 * Strip any value matching the protected token regex. Mutates strings only.
 */
export function stripProtected(input: string): string {
    if (!input) return input;
    return input.replace(PROTECTED_TOKEN_RE, '[REDACTED]');
}

function describeSchema(schema: SchemaBundle | null | undefined): string {
    if (!schema) return 'No schema available.';
    const tables = schema.tables ?? [];
    const views = schema.views ?? [];
    const macros = schema.macros ?? [];
    let out = 'SCHEMA:\n';
    if (tables.length === 0) {
        out += 'TABLES: (none)\n';
    } else {
        out += 'TABLES:\n';
        for (const t of tables) {
            const cols = (t.columns ?? []).map(c => `"${c.name}" ${c.type}`).join(', ');
            out += `- "${t.name}": (${cols})\n`;
        }
    }
    if (views.length > 0) {
        out += 'VIEWS:\n';
        for (const v of views) {
            out += `- "${v.name}"\n`;
        }
    }
    if (macros.length > 0) {
        out += 'MACROS:\n';
        for (const m of macros) {
            out += `- ${m.name}(${(m.parameters ?? []).join(', ')})\n`;
        }
    }
    return out;
}

function summarizeColumn(col: ResultColumn, rows: Array<Record<string, any>>): string {
    if (isNumericType(col.type)) {
        const xs = rows
            .map(r => r?.[col.name])
            .filter((v: any) => typeof v === 'number' && Number.isFinite(v)) as number[];
        if (xs.length === 0) return `${col.name} (${col.type}): all null`;
        const sorted = [...xs].sort((a, b) => a - b);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const median = sorted[Math.floor(sorted.length / 2)];
        return `${col.name} (${col.type}): min=${min}, median=${median}, max=${max}`;
    }
    if (isStringType(col.type)) {
        const distinct = [...new Set(rows.map(r => r?.[col.name]).filter(v => v != null))].slice(0, 3);
        if (distinct.length === 0) return `${col.name} (${col.type}): all null`;
        return `${col.name} (${col.type}): sample=[${distinct.map(s => JSON.stringify(s)).join(', ')}]`;
    }
    return `${col.name} (${col.type})`;
}

function clampRowCap(rowCap: number | undefined): number {
    if (typeof rowCap !== 'number' || !Number.isFinite(rowCap) || rowCap <= 0) {
        return DEFAULT_FULL_ROW_LIMIT;
    }
    return Math.min(Math.floor(rowCap), MAX_FULL_ROW_LIMIT);
}

/**
 * Build the context payload string sent to the AI. Mode controls how much of
 * the most-recent query result is exposed.
 *
 * - no-data: only schema; result columns/rows are not included.
 * - sanitized: schema + per-column aggregates (numeric min/median/max,
 *   string sample distinct values) + row count. No raw rows.
 * - full: schema + first N rows verbatim, capped by rowCap (default 50,
 *   absolute max 500).
 *
 * All produced text is run through stripProtected to remove any references
 * to the protected variable namespace before returning.
 */
export function buildContextPayload(
    mode: VisibilityMode,
    schema: SchemaBundle | null | undefined,
    lastResult: RecentResult | null | undefined,
    rowCap?: number,
): string {
    const schemaText = describeSchema(schema);
    let body = '';

    if (mode === 'no-data') {
        body = `${schemaText}\nDATA VISIBILITY: no-data — the assistant cannot see any rows or column statistics from the most recent query result.`;
    } else if (mode === 'sanitized') {
        if (!lastResult || !lastResult.columns || lastResult.columns.length === 0) {
            body = `${schemaText}\nDATA VISIBILITY: sanitized — no recent query result available.`;
        } else {
            const rows = lastResult.rows ?? [];
            const lines = lastResult.columns.map(c => `- ${summarizeColumn(c, rows)}`);
            body = `${schemaText}\nDATA VISIBILITY: sanitized — schema + per-column aggregates from the last query result.\nROW COUNT: ${rows.length}\nCOLUMN SUMMARIES:\n${lines.join('\n')}`;
        }
    } else {
        // full
        const cap = clampRowCap(rowCap);
        if (!lastResult || !lastResult.columns || lastResult.columns.length === 0) {
            body = `${schemaText}\nDATA VISIBILITY: full — no recent query result available.`;
        } else {
            const rows = lastResult.rows ?? [];
            const limited = rows.slice(0, cap);
            const colDecl = lastResult.columns.map(c => `${c.name} (${c.type})`).join(', ');
            body =
                `${schemaText}\nDATA VISIBILITY: full — first ${limited.length} of ${rows.length} rows from the last query result (cap=${cap}).\n` +
                `COLUMNS: ${colDecl}\nROWS:\n${JSON.stringify(limited)}`;
        }
    }

    return stripProtected(body);
}
