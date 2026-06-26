// Tables, views, CTEs, functions, and macros providers.

import type { Completion } from '@codemirror/autocomplete';
import type { CompletionProvider, ProviderContext } from '../types';
import { SQL_FUNCTIONS } from '../../../sqlFunctions';
import { wrap, VALID_FOR_IDENT } from '../helpers';

function isTableContext(ctx: ProviderContext): boolean {
    const c = ctx.enclosingClause;
    return c === 'from' || c === 'join' || c === null;
}

function isColumnContext(ctx: ProviderContext): boolean {
    const c = ctx.enclosingClause;
    return c === 'select' || c === 'where' || c === 'having' ||
        c === 'groupBy' || c === 'orderBy' || c === 'on' || c === 'qualify';
}

// ------------------------------ tables ------------------------------

export const tableProvider: CompletionProvider = {
    name: 'table',
    priority: 80,

    matches(node, ctx) {
        if (ctx.token.includes('.')) return false;
        // Offer tables in table-context clauses or when no clause is active
        // (top-level), and as a low-priority fallback in column contexts.
        return isTableContext(ctx) || !isColumnContext(ctx) || isColumnContext(ctx);
    },

    provide(node, ctx) {
        const isQuoted = ctx.token.startsWith('"');
        const lc = ctx.token.toLowerCase().replace(/^"/, '');
        const items: Completion[] = [];
        const inTable = isTableContext(ctx);
        for (const t of ctx.schema.tables) {
            if (lc && !t.name.toLowerCase().startsWith(lc)) continue;
            items.push({
                label: t.name,
                detail: t.rowCount != null
                    ? `table · ${t.rowCount.toLocaleString()} rows`
                    : 'table',
                type: 'table',
                apply: wrap(t.name, isQuoted),
                boost: inTable ? 6 : 1,
            });
        }
        return {
            items,
            from: ctx.tokenFrom,
            validFor: VALID_FOR_IDENT,
        };
    },
};

// ------------------------------ views -------------------------------

export const viewProvider: CompletionProvider = {
    name: 'view',
    priority: 80,

    matches(node, ctx) {
        if (ctx.token.includes('.')) return false;
        return isTableContext(ctx) || !isColumnContext(ctx) || isColumnContext(ctx);
    },

    provide(node, ctx) {
        const isQuoted = ctx.token.startsWith('"');
        const lc = ctx.token.toLowerCase().replace(/^"/, '');
        const items: Completion[] = [];
        const inTable = isTableContext(ctx);
        for (const v of ctx.schema.views) {
            if (lc && !v.name.toLowerCase().startsWith(lc)) continue;
            items.push({
                label: v.name,
                detail: 'view',
                type: 'view',
                apply: wrap(v.name, isQuoted),
                boost: inTable ? 6 : 1,
            });
        }
        return {
            items,
            from: ctx.tokenFrom,
            validFor: VALID_FOR_IDENT,
        };
    },
};

// ------------------------------- CTEs -------------------------------

export const cteProvider: CompletionProvider = {
    name: 'cte',
    priority: 85,

    matches(node, ctx) {
        if (ctx.token.includes('.')) return false;
        if (!ctx.scope) return false;
        return isTableContext(ctx) || !isColumnContext(ctx);
    },

    provide(node, ctx) {
        if (!ctx.scope) return { items: [] };
        const lc = ctx.token.toLowerCase().replace(/^"/, '');
        const items: Completion[] = [];
        for (const c of ctx.scope.listCtes()) {
            if (lc && !c.name.toLowerCase().startsWith(lc)) continue;
            items.push({
                label: c.name,
                detail: 'CTE (this query)',
                type: 'view',
                apply: c.name,
                boost: 8,
            });
        }
        return {
            items,
            from: ctx.tokenFrom,
            validFor: VALID_FOR_IDENT,
        };
    },
};

// ----------------------------- functions ----------------------------

export const functionProvider: CompletionProvider = {
    name: 'function',
    priority: 70,

    matches(node, ctx) {
        if (ctx.token.includes('.')) return false;
        // Functions are valid in column/expression contexts.
        return isColumnContext(ctx);
    },

    provide(node, ctx) {
        const lc = ctx.token.toLowerCase().replace(/^"/, '');
        const items: Completion[] = [];
        for (const fn of SQL_FUNCTIONS) {
            if (lc && !fn.name.toLowerCase().startsWith(lc)) continue;
            items.push({
                label: fn.name,
                detail: fn.detail,
                info: fn.signature,
                type: 'function',
                apply: fn.signature.startsWith(fn.name + '(') ? `${fn.name}(` : fn.name,
                boost: fn.boost ?? 1,
            });
        }
        return {
            items,
            from: ctx.tokenFrom,
            validFor: VALID_FOR_IDENT,
        };
    },
};

// ------------------------------ macros ------------------------------

export const macroProvider: CompletionProvider = {
    name: 'macro',
    priority: 65,

    matches(_node, ctx) {
        if (ctx.token.includes('.')) return false;
        // Macros are valid anywhere a function is — i.e. expression contexts.
        // Old completer always offered them; we preserve that.
        return true;
    },

    provide(_node, ctx) {
        const lc = ctx.token.toLowerCase().replace(/^"/, '');
        const items: Completion[] = [];
        for (const m of ctx.schema.macros) {
            if (lc && !m.name.toLowerCase().startsWith(lc)) continue;
            const sig = m.parameters.length > 0 ? `(${m.parameters.join(', ')})` : '()';
            items.push({
                label: m.name,
                detail: `macro${sig} → ${m.returnType}`,
                type: 'function',
                apply: `${m.name}(`,
                boost: 2,
            });
        }
        return {
            items,
            from: ctx.tokenFrom,
            validFor: VALID_FOR_IDENT,
        };
    },
};
