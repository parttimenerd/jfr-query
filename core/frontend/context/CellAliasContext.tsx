import React, { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ColumnSchema } from '../types';
import { DataContext } from './DuckDBContext';
import { quoteIdent, quoteLiteral, sanitizeForDuckDB } from '../utils/cellHandle';

/**
 * Information captured about a SQL cell's alias after a successful run.
 * Aliases are exposed in DuckDB two ways:
 *   - Cell-qualified: `<H>.<A_or_1>` (always; collision-free; `<H>` is the cell handle)
 *   - Bare:           `<A>` (only when no JFR table of that name exists)
 */
export interface AliasInfo {
    /** Cell handle the alias belongs to (e.g. `gc-overview` or `cell_3`). Sanitized for DuckDB. */
    cellHandle: string;
    /** Raw, source-form cell handle (for display). */
    cellHandleDisplay: string;
    /** 0-based index of the cell in source order. */
    cellIndex: number;
    /** 0-based index of the SQL block within the cell. */
    sqlIndex: number;
    /** Author-supplied alias name (`-- alias <name>`), or null if absent. */
    alias: string | null;
    /** Columns from the result's schema; empty until first run completes. */
    columns: ColumnSchema[];
    /** Monotonic version, bumped on every (re-)registration. */
    version: number;
    /** True if `-- alias … materialized` — uses TEMP TABLE instead of TEMP VIEW. */
    materialized: boolean;
    /** True if a JFR table shadowed the bare alias name; bare view was NOT created. */
    bareShadowed: boolean;
}

interface RegisterArgs {
    cellId: string;
    cellHandle: string;
    cellIndex: number;
    sqlIndex: number;
    alias: string | null;
    sql: string;
    materialized: boolean;
}

// ---------------------------------------------------------------------------
// Actions context — stable callbacks; never triggers re-renders on alias updates.
// ---------------------------------------------------------------------------

interface CellAliasActionsContextType {
    /** Compile + create the temp view(s) for this alias and bump its version. */
    registerAlias: (args: RegisterArgs) => Promise<AliasInfo | null>;
    /** Drop all aliases registered against a cell (called on cell unmount). */
    unregisterCell: (cellId: string) => Promise<void>;
    /** Get alias info by bare name (e.g. `gc_pauses`). */
    getByBare: (name: string) => AliasInfo | undefined;
    /** Get alias info by cell-qualified ref (e.g. `cell_3.gc_pauses`). */
    getByQualified: (handle: string, aliasOr1: string) => AliasInfo | undefined;
}

const noopAsync = async () => null;

const defaultActionsCtx: CellAliasActionsContextType = {
    registerAlias: noopAsync as any,
    unregisterCell: async () => {},
    getByBare: () => undefined,
    getByQualified: () => undefined,
};

export const CellAliasActionsContext = createContext<CellAliasActionsContextType>(defaultActionsCtx);

// ---------------------------------------------------------------------------
// State context — aliases snapshot; changes on every registration/unregistration.
// ---------------------------------------------------------------------------

/** Snapshot of all currently registered aliases. */
export const CellAliasContext = createContext<Record<string, AliasInfo>>({});

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Returns stable callbacks. Does NOT re-render when aliases change. */
export const useCellAliasActions = () => useContext(CellAliasActionsContext);

/** Returns the aliases snapshot. Re-renders when any alias changes. */
export const useCellAliases = () => useContext(CellAliasContext);

/** Key used for the aliases map: `<sanitized-handle>.<alias_or_1>`. */
const qualifiedKey = (handle: string, aliasOr1: string) => `${handle}.${aliasOr1}`;

/**
 * Pure helper exposed for testing: builds the SQL statements needed to
 * (re-)materialize a cell alias. Returns the statements to execute in order
 * (schema-creation first, then qualified view/table, then optionally bare).
 *
 * `shadowedTableNames` is the set of real (non-temp) table/view names the
 * caller knows about; if `alias` collides with one of them, the bare view is
 * skipped (the qualified one is always created).
 */
export interface BuildAliasSqlArgs {
    cellHandle: string;
    alias: string | null;
    sql: string;
    materialized: boolean;
    shadowedTableNames: Set<string>;
}
export interface BuildAliasSqlResult {
    sanitizedHandle: string;
    aliasOr1: string;
    statements: string[];
    bareShadowed: boolean;
    /** SQL to fetch the column schema from information_schema. */
    columnsQuery: string;
}

export const buildAliasSql = (args: BuildAliasSqlArgs): BuildAliasSqlResult => {
    const { cellHandle, alias, sql, materialized, shadowedTableNames } = args;
    const sanHandle = sanitizeForDuckDB(cellHandle);
    const aliasOr1 = alias ?? '1';
    const objectKind = materialized ? 'TABLE' : 'VIEW';

    const statements: string[] = [
        `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(sanHandle)}`,
        `CREATE OR REPLACE TEMP ${objectKind} ${quoteIdent(sanHandle)}.${quoteIdent(aliasOr1)} AS (${sql})`,
    ];

    let bareShadowed = false;
    if (alias) {
        if (shadowedTableNames.has(alias)) {
            bareShadowed = true;
        } else {
            statements.push(`CREATE OR REPLACE TEMP ${objectKind} ${quoteIdent(alias)} AS (${sql})`);
        }
    }

    const columnsQuery =
        `SELECT column_name, data_type FROM information_schema.columns ` +
        `WHERE table_schema = ${quoteLiteral(sanHandle)} ` +
        `AND table_name = ${quoteLiteral(aliasOr1)}`;

    return { sanitizedHandle: sanHandle, aliasOr1, statements, bareShadowed, columnsQuery };
};

export const CellAliasProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { query, schema, dbState } = useContext(DataContext);
    const [aliases, setAliases] = useState<Record<string, AliasInfo>>({});
    const aliasesRef = useRef(aliases);
    aliasesRef.current = aliases;
    /** cellId -> set of qualified keys currently owned by that cell. */
    const cellOwnership = useRef<Record<string, Set<string>>>({});
    /** "cellId::sqlIndex" -> { qualKey, bareKey | null } for per-slot cleanup. */
    const slotOwnership = useRef<Record<string, { qualKey: string; bareKey: string | null }>>({});
    const versionRef = useRef(0);

    /** Pre-computed set of all table/view names — rebuilt only when schema changes. */
    const shadowedNames = useMemo(() => {
        const s = new Set<string>();
        for (const t of schema?.tables ?? []) s.add(t.name);
        for (const v of schema?.views ?? []) s.add(v.name);
        return s;
    }, [schema?.tables, schema?.views]);

    const registerAlias = useCallback(async (args: RegisterArgs): Promise<AliasInfo | null> => {
        if (dbState !== 4 /* DBState.READY */) return null;
        const { cellId, cellHandle: rawHandle, cellIndex, sqlIndex, alias, sql, materialized } = args;
        if (!sql.trim()) return null;

        const built = buildAliasSql({
            cellHandle: rawHandle,
            alias,
            sql,
            materialized,
            shadowedTableNames: shadowedNames,
        });

        try {
            for (const stmt of built.statements) {
                await query(stmt);
            }
        } catch (err) {
            // If the materialization fails (e.g. SQL parse error), do NOT register.
            // The cell's own result panel already surfaces the error.
            return null;
        }

        // Capture column schema from the just-created view/table.
        // If this fetch fails, rollback the created objects so no orphaned
        // schema entry is left in the registry.
        let columns: ColumnSchema[] = [];
        try {
            const cols = await query(built.columnsQuery);
            columns = cols.map((r: any) => ({ name: String(r.column_name), type: String(r.data_type) }));
        } catch {
            // Rollback: drop what we just created so the registry stays consistent.
            const objectKind = materialized ? 'TABLE' : 'VIEW';
            const rollbackStatements: string[] = [
                `DROP ${objectKind} IF EXISTS ${quoteIdent(built.sanitizedHandle)}.${quoteIdent(built.aliasOr1)}`,
            ];
            if (alias && !built.bareShadowed) {
                rollbackStatements.push(`DROP ${objectKind} IF EXISTS ${quoteIdent(alias)}`);
            }
            for (const stmt of rollbackStatements) {
                try { await query(stmt); } catch { /* best-effort */ }
            }
            return null;
        }

        versionRef.current += 1;
        const info: AliasInfo = {
            cellHandle: built.sanitizedHandle,
            cellHandleDisplay: rawHandle,
            cellIndex,
            sqlIndex,
            alias,
            columns,
            version: versionRef.current,
            materialized,
            bareShadowed: built.bareShadowed,
        };

        const qualKey = qualifiedKey(built.sanitizedHandle, built.aliasOr1);

        // Drop any previously registered keys for this exact (cellId, sqlIndex) slot
        // so renamed or removed aliases don't accumulate as stale entries.
        const slotKey = `${cellId}::${sqlIndex}`;
        const prevSlot = slotOwnership.current[slotKey];
        if (prevSlot && prevSlot.qualKey !== qualKey) {
            const prevObjectKind = aliasesRef.current[prevSlot.qualKey]?.materialized ? 'TABLE' : 'VIEW';
            if (prevSlot.qualKey.includes('.')) {
                const dotIdx = prevSlot.qualKey.indexOf('.');
                const h = prevSlot.qualKey.slice(0, dotIdx);
                const a = prevSlot.qualKey.slice(dotIdx + 1);
                try { await query(`DROP ${prevObjectKind} IF EXISTS ${quoteIdent(h)}.${quoteIdent(a)}`); } catch { /* best-effort */ }
            }
            if (prevSlot.bareKey) {
                try { await query(`DROP ${prevObjectKind} IF EXISTS ${quoteIdent(prevSlot.bareKey)}`); } catch { /* best-effort */ }
            }
            const owned = cellOwnership.current[cellId];
            if (owned) {
                owned.delete(prevSlot.qualKey);
                if (prevSlot.bareKey) owned.delete(prevSlot.bareKey);
            }
            setAliases(prev => {
                const next = { ...prev };
                delete next[prevSlot.qualKey];
                if (prevSlot.bareKey) delete next[prevSlot.bareKey];
                return next;
            });
        }

        const owned = cellOwnership.current[cellId] ?? new Set<string>();
        owned.add(qualKey);
        if (alias && !built.bareShadowed) owned.add(alias);
        cellOwnership.current[cellId] = owned;
        slotOwnership.current[slotKey] = { qualKey, bareKey: alias && !built.bareShadowed ? alias : null };

        setAliases(prev => {
            const next = { ...prev, [qualKey]: info };
            if (alias && !built.bareShadowed) next[alias] = info;
            return next;
        });

        return info;
    }, [query, dbState, shadowedNames]);

    const unregisterCell = useCallback(async (cellId: string) => {
        const owned = cellOwnership.current[cellId];
        if (!owned || owned.size === 0) return;
        // Best-effort DROP; ignore failures (cell might never have created the view).
        for (const key of owned) {
            try {
                if (key.includes('.')) {
                    const dotIdx = key.indexOf('.');
                    const h = key.slice(0, dotIdx);
                    const a = key.slice(dotIdx + 1);
                    await query(`DROP VIEW IF EXISTS ${quoteIdent(h)}.${quoteIdent(a)}`);
                    await query(`DROP TABLE IF EXISTS ${quoteIdent(h)}.${quoteIdent(a)}`);
                } else {
                    await query(`DROP VIEW IF EXISTS ${quoteIdent(key)}`);
                    await query(`DROP TABLE IF EXISTS ${quoteIdent(key)}`);
                }
            } catch { /* swallow */ }
        }
        delete cellOwnership.current[cellId];
        // Clean up per-slot tracking for all slots belonging to this cell.
        for (const slotKey of Object.keys(slotOwnership.current)) {
            if (slotKey.startsWith(`${cellId}::`)) delete slotOwnership.current[slotKey];
        }
        setAliases(prev => {
            const next = { ...prev };
            for (const key of owned) delete next[key];
            return next;
        });
    }, [query]);

    // Read aliases via ref so these callbacks don't rebuild when aliases change.
    const getByBare = useCallback((name: string) => aliasesRef.current[name], []);
    const getByQualified = useCallback((handle: string, aliasOr1: string) => {
        const sanHandle = sanitizeForDuckDB(handle);
        return aliasesRef.current[qualifiedKey(sanHandle, aliasOr1)];
    }, []);

    const actions = useMemo<CellAliasActionsContextType>(() => ({
        registerAlias,
        unregisterCell,
        getByBare,
        getByQualified,
    }), [registerAlias, unregisterCell, getByBare, getByQualified]);

    return (
        <CellAliasActionsContext.Provider value={actions}>
            <CellAliasContext.Provider value={aliases}>
                {children}
            </CellAliasContext.Provider>
        </CellAliasActionsContext.Provider>
    );
};

