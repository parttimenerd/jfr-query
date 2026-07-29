// Distinct-value provider — fires when the cursor is inside an unclosed
// string literal whose LHS resolves to a column. Verbatim port of the
// behavior in the old `completions.ts` so the contract with
// `distinctValues.ts` is preserved.

import type { Completion } from '@codemirror/autocomplete';
import type { CompletionProvider, ProviderContext, ProviderResult } from '../types';
import {
    lookupCachedValues,
    requestDistinctValues,
} from '../../../distinctValues';

// Detect `… col = '` or `… tbl.col = '` (and IN / LIKE / ILIKE / != / <>)
// immediately before the opening quote. Returns null if the cursor isn't
// inside an open string literal whose left side identifies a column.
function detectStringValueColumn(stmt: string): { column: string; table: string | null } | null {
    const lastQuote = stmt.lastIndexOf("'");
    if (lastQuote < 0) return null;
    // Total quote count: even ⇒ outside, odd ⇒ inside.
    // DuckDB uses '' (doubled single quote) to escape; skip pairs so they don't flip parity.
    let count = 0;
    for (let i = 0; i < stmt.length; i++) {
        if (stmt[i] === "'") {
            if (stmt[i + 1] === "'") { i++; continue; }
            count++;
        }
    }
    if (count % 2 === 0) return null;
    const head = stmt.slice(0, lastQuote).replace(/\s+$/, '');
    const m = head.match(
        /(\w+|"[^"]+")(?:\.(\w+|"[^"]+"))?\s*(?:=|<>|!=|LIKE|ILIKE|IN\s*\(\s*(?:'[^']*'\s*,\s*)*)\s*$/i,
    );
    if (!m) return null;
    const left = unquote(m[1]);
    const right = m[2] ? unquote(m[2]) : null;
    return right ? { column: right, table: left } : { column: left, table: null };
}

function unquote(s: string): string {
    return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

// Set of all table/cte names visible at the cursor — passed to the runner so
// it can guess which table a bare column belongs to.
function visibleTableNames(ctx: ProviderContext): Set<string> {
    const out = new Set<string>();
    if (ctx.scope) {
        for (const t of ctx.scope.listTables()) {
            out.add(t.target.toLowerCase());
            if (t.alias) out.add(t.alias.toLowerCase());
        }
        for (const c of ctx.scope.listCtes()) out.add(c.name.toLowerCase());
    }
    return out;
}

export const distinctValueProvider: CompletionProvider = {
    name: 'distinctValue',
    priority: 90,

    matches(_node, ctx) {
        const det = detectStringValueColumn(ctx.upTo);
        return det != null;
    },

    provide(_node, ctx): ProviderResult {
        const det = detectStringValueColumn(ctx.upTo);
        if (!det) return { items: [] };
        const referenced = visibleTableNames(ctx);
        if (ctx.runner) {
            requestDistinctValues(ctx.runner, ctx.schema, det.table, det.column, referenced);
        }
        const values = lookupCachedValues(ctx.schema, det.table, det.column, referenced);
        const lastQuote = ctx.upTo.lastIndexOf("'");
        const stringStart = lastQuote + 1;
        const partial = ctx.upTo.slice(stringStart).toLowerCase();
        if (!values || values.length === 0) return { items: [] };
        const items: Completion[] = values
            .filter(v => v.toLowerCase().startsWith(partial))
            .slice(0, 50)
            .map(v => ({
                label: v,
                detail: 'value',
                type: 'text',
                apply: v + "'",
                boost: 10,
            }));
        return {
            items,
            from: stringStart,
            validFor: /^[^']*$/,
        };
    },
};
