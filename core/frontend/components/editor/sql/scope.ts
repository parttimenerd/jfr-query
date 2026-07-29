// Lexical scope for the SQL AST. One Scope per `query` node — outer scope
// is the enclosing query (for correlated subqueries), or null at the script
// root. CTEs declared in a `WITH` clause live on the enclosing query's scope.
//
// The scope holds three kinds of bindings:
//   - CTEs:    name → { kind:'cte', columns? }
//   - tables:  alias-or-name → { kind:'table'|'view'|'cte'|'subquery', columns }
//   - none for raw columns — columns are looked up via the table bindings.
//
// `resolveIdent('cause')` walks the bindings to find a table whose columns
// include 'cause' (ambiguous → returns the first match plus an `ambiguous`
// flag). `resolveQualified('r', 'cause')` looks up the alias `r` then matches
// 'cause' among its columns.

import type { ColumnSchema, TableSchema, ViewSchema } from '../../../types';

let nextScopeId = 1;

export type TableSourceKind = 'table' | 'view' | 'cte' | 'subquery' | 'unknown';

export interface TableBinding {
    // The user-visible name in this scope — the alias if one was given, else
    // the underlying table/view/cte name.
    alias: string;
    // The underlying target name (table/view/cte name, or '' for inline subqueries).
    target: string;
    kind: TableSourceKind;
    columns: ColumnSchema[];
}

export interface CteBinding {
    name: string;
    // Columns declared explicitly (e.g. `WITH foo(a, b) AS ...`) or inferred
    // from the CTE body (post-annotation). May be empty when unknown.
    columns: ColumnSchema[];
    recursive: boolean;
}

export interface ResolvedColumn {
    table: string;          // user-visible name (alias if any)
    column: string;         // canonical column name
    dataType: string;
    ambiguous: boolean;     // true when more than one table in scope has this column
}

export interface ResolvedTable {
    name: string;           // user-visible name (alias if any)
    target: string;         // underlying name
    kind: TableSourceKind;
    columns: ColumnSchema[];
}

export class Scope {
    readonly id: number;
    readonly parent: Scope | null;
    private ctes = new Map<string, CteBinding>();
    private tables: TableBinding[] = [];

    constructor(parent: Scope | null = null) {
        this.id = nextScopeId++;
        this.parent = parent;
    }

    // --- CTE registration ---------------------------------------------------

    addCte(b: CteBinding): void {
        this.ctes.set(b.name.toLowerCase(), b);
    }

    // Find a CTE visible from this scope. CTEs are visible in the scope that
    // declared them and in all descendant scopes.
    findCte(name: string): CteBinding | undefined {
        const key = name.toLowerCase();
        let s: Scope | null = this;
        while (s) {
            const hit = s.ctes.get(key);
            if (hit) return hit;
            s = s.parent;
        }
        return undefined;
    }

    listCtes(): CteBinding[] {
        const out: CteBinding[] = [];
        const seen = new Set<string>();
        let s: Scope | null = this;
        while (s) {
            for (const c of s.ctes.values()) {
                if (!seen.has(c.name.toLowerCase())) {
                    seen.add(c.name.toLowerCase());
                    out.push(c);
                }
            }
            s = s.parent;
        }
        return out;
    }

    // --- table-binding registration ----------------------------------------

    addTable(b: TableBinding): void {
        this.tables.push(b);
    }

    // Tables bound in *this* scope only (no ancestors). Use for completion
    // candidate generation where ancestor FROM bindings are NOT visible
    // (e.g. SELECT-list inside a derived table — only the inner FROM counts).
    ownTables(): TableBinding[] {
        return this.tables.slice();
    }

    // All tables visible from this scope (this scope first, then ancestors).
    // Ancestor tables are visible to correlated subqueries.
    listTables(): TableBinding[] {
        const out: TableBinding[] = [];
        let s: Scope | null = this;
        while (s) {
            out.push(...s.tables);
            s = s.parent;
        }
        return out;
    }

    // --- resolution ---------------------------------------------------------

    // Look up an unqualified column name. Walks all visible tables; if more
    // than one matches, returns the first hit with `ambiguous: true`.
    resolveIdent(name: string): ResolvedColumn | undefined {
        const key = name.toLowerCase();
        const hits: { binding: TableBinding; column: ColumnSchema }[] = [];
        for (const t of this.listTables()) {
            for (const c of t.columns) {
                if (c.name.toLowerCase() === key) {
                    hits.push({ binding: t, column: c });
                }
            }
        }
        if (hits.length === 0) return undefined;
        const first = hits[0];
        return {
            table: first.binding.alias,
            column: first.column.name,
            dataType: first.column.type,
            ambiguous: hits.length > 1,
        };
    }

    // Look up `qualifier.name` — typically `alias.column` or `table.column`.
    // The qualifier matches against the alias OR the target name.
    // Walk all matching bindings before giving up, so that a correlated
    // subquery with the same alias in an ancestor scope is still checked when
    // the innermost match doesn't have the requested column.
    resolveQualified(qualifier: string, name: string): ResolvedColumn | undefined {
        const qkey = qualifier.toLowerCase();
        const ckey = name.toLowerCase();
        let qualifierMatched = false;
        for (const t of this.listTables()) {
            if (t.alias.toLowerCase() === qkey || t.target.toLowerCase() === qkey) {
                qualifierMatched = true;
                for (const c of t.columns) {
                    if (c.name.toLowerCase() === ckey) {
                        return {
                            table: t.alias,
                            column: c.name,
                            dataType: c.type,
                            ambiguous: false,
                        };
                    }
                }
                // Qualifier matched but column not found in this binding —
                // continue to check further bindings with the same qualifier
                // (covers correlated subqueries where the outer scope has a
                // table with the same alias).
            }
        }
        // If the qualifier was recognized but no binding had the column, return
        // undefined so callers can emit a "column not found on table" diagnostic.
        if (qualifierMatched) return undefined;
        return undefined;
    }

    // Resolve a bare table reference (e.g. in FROM) against schema and CTEs.
    // Returns a synthetic binding describing what was matched.
    static resolveTableRef(
        name: string,
        ctes: Iterable<CteBinding>,
        tables: ReadonlyArray<TableSchema>,
        views: ReadonlyArray<ViewSchema>,
    ): ResolvedTable | undefined {
        const key = name.toLowerCase();
        for (const c of ctes) {
            if (c.name.toLowerCase() === key) {
                return { name: c.name, target: c.name, kind: 'cte', columns: c.columns };
            }
        }
        for (const t of tables) {
            if (t.name.toLowerCase() === key) {
                return { name: t.name, target: t.name, kind: 'table', columns: t.columns };
            }
        }
        for (const v of views) {
            if (v.name.toLowerCase() === key) {
                return { name: v.name, target: v.name, kind: 'view', columns: v.columns };
            }
        }
        return undefined;
    }
}

// For tests: reset the global id counter so snapshots stay stable.
export function _resetScopeIdsForTests(): void {
    nextScopeId = 1;
}
