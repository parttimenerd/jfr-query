import React, { createContext, useState, useCallback, useMemo, ReactNode, useEffect, useRef } from 'react';
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { TableSchema, ViewSchema, MacroSchema } from '../types';
import { initDuckDBWasm } from '../utils/duckdbWasmLoader';
import { loadJfrIntoWasm } from '../utils/jfrToWasmLoader';

const QUERY_ENDPOINT = `/api/query`;

// Simple async lock to prevent concurrent database access.
class AsyncLock {
  private isLocked = false;
  private queue: (() => void)[] = [];

  acquire(): Promise<void> {
    return new Promise(resolve => {
      if (!this.isLocked) {
        this.isLocked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const nextResolve = this.queue.shift();
      if (nextResolve) {
        nextResolve();
      }
    } else {
      this.isLocked = false;
    }
  }
}

const dbLock = new AsyncLock();


export type DBMode = 'server' | 'wasm';
export enum DBState { SCHEMA_LOADING, NEEDS_FILE, IMPORTING, READY, ERROR }
interface Schema { tables: TableSchema[]; views: ViewSchema[]; macros: MacroSchema[]; }

interface DataContextType {
  dbState: DBState;
  mode: DBMode | null;
  schema: Schema | null;
  errorMessage: string | null;
  recordingStart: number | null;
  recordingEnd: number | null;
  query: (sql: string) => Promise<any[]>;
  refreshSchema: () => Promise<void>;
  loadJfrFile: (bytes: Uint8Array) => Promise<void>;
}

export const DataContext = createContext<DataContextType>({
  dbState: DBState.SCHEMA_LOADING,
  mode: null,
  schema: null,
  errorMessage: null,
  recordingStart: null,
  recordingEnd: null,
  query: async () => { throw new Error('DataContext not initialized'); },
  refreshSchema: async () => { throw new Error('DataContext not initialized'); },
  loadJfrFile: async () => { throw new Error('DataContext not initialized'); },
});

const executeRemoteQuery = async (sql: string): Promise<any> => {
    await dbLock.acquire();
    try {
        const r = await fetch(QUERY_ENDPOINT, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({sql}) });
        let body; try { body = await r.json(); } catch(e) { throw new Error(`Server returned non-JSON response: ${await r.text()}`); }
        if (!r.ok || body.error) throw new Error(body.error || `Request failed with status ${r.status}`);
        if (typeof body === 'string') try { return JSON.parse(body); } catch(e) { throw new Error(`Could not parse string response: ${body}`);}
        return body;
    } finally {
        dbLock.release();
    }
};

/**
 * Probe `/api/query` with a trivial SELECT. If we get a usable JSON response,
 * we're talking to a real jfr-query server; otherwise the page is being served
 * statically (e.g. from `npm run dev` with no backend, or from the
 * frontend-only deployment) and we must fall back to in-browser WASM mode.
 */
const probeServer = async (): Promise<boolean> => {
    try {
        const r = await fetch(QUERY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: 'SELECT 1' }),
        });
        if (!r.ok) return false;
        const body = await r.json().catch(() => null);
        return Array.isArray(body) || (body && !body.error);
    } catch {
        return false;
    }
};

/**
 * Run a query against a DuckDB-WASM connection and convert the Arrow result
 * to plain JS objects matching the server response shape.
 */
const runWasmQuery = async (conn: AsyncDuckDBConnection, sql: string): Promise<any[]> => {
    await dbLock.acquire();
    try {
        const result = await conn.query(sql);
        return result.toArray().map((row: any) => {
            const obj = row.toJSON();
            for (const k of Object.keys(obj)) {
                const v = obj[k];
                // BigInt isn't JSON-serializable and downstream code uses Number().
                if (typeof v === 'bigint') {
                    obj[k] = Number(v);
                }
            }
            return obj;
        });
    } finally {
        dbLock.release();
    }
};

/**
 * Safely parses the 'parameters' field for a macro, which might be a string,
 * an array, or null from the database.
 * @param params The raw parameters value.
 * @returns A string array of parameter names.
 */
const parseMacroParameters = (params: any): string[] => {
    if (Array.isArray(params)) {
        return params.map(String); // Ensure all elements are strings
    }
    if (typeof params === 'string') {
        if (params.trim() === '') {
            return [];
        }
        // Assuming comma-separated string if not an array
        return params.split(',').map(p => p.trim());
    }
    // Return empty array for null, undefined, or other types
    return [];
};


export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [dbState, setDbState] = useState<DBState>(DBState.SCHEMA_LOADING);
  const [mode, setMode] = useState<DBMode | null>(null);
  const [schema, setSchema] = useState<Schema | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recordingStart, setRecordingStart] = useState<number | null>(null);
  const [recordingEnd, setRecordingEnd] = useState<number | null>(null);

  const wasmDbRef = useRef<AsyncDuckDB | null>(null);
  const wasmConnRef = useRef<AsyncDuckDBConnection | null>(null);

  const executeQuery = useCallback(async (sql: string): Promise<any> => {
    if (mode === 'wasm') {
        if (!wasmConnRef.current) throw new Error('WASM DB not initialized');
        return runWasmQuery(wasmConnRef.current, sql);
    }
    return executeRemoteQuery(sql);
  }, [mode]);

  const fetchSchemaFor = useCallback(async (
    runQuery: (sql: string) => Promise<any>,
    isInitial: boolean,
  ) => {
      if (isInitial) {
          try {
            const info = await runQuery(`SELECT "firstEvent", "lastEvent" FROM "RecordingInfo" LIMIT 1;`);
            if (info[0]) { const s = new Date(info[0].firstEvent).getTime(), e = new Date(info[0].lastEvent).getTime(); if(!isNaN(s)&&!isNaN(e)){ setRecordingStart(s); setRecordingEnd(e); }}
          } catch (e) { console.warn(`Could not get recording time, using fallback.`, e); }
      }

      const [tablesData, viewsData, macrosData] = await Promise.all([
        runQuery(`SELECT table_name, column_name, data_type FROM duckdb_columns() WHERE table_name NOT IN (SELECT view_name FROM duckdb_views()) ORDER BY 1,3;`),
        runQuery(`SELECT v.view_name, v.sql, v.internal, c.column_name, c.data_type FROM duckdb_views() v JOIN duckdb_columns() c ON v.view_name = c.table_name ORDER BY 1,4;`),
        runQuery(`SELECT function_name, parameters, return_type, macro_definition AS sql FROM duckdb_functions() WHERE internal=false AND function_type='macro';`)
      ]);

      const tablesMap = new Map<string, TableSchema>();
      tablesData.forEach((r: any) => { if(!tablesMap.has(r.table_name)) tablesMap.set(r.table_name, {name:r.table_name,columns:[]}); tablesMap.get(r.table_name)!.columns.push({name:r.column_name,type:r.data_type}); });
      const tables = Array.from(tablesMap.values()).sort((a,b)=>a.name.localeCompare(b.name));

      const viewsMap = new Map<string, ViewSchema>();
      viewsData.forEach((r:any) => { if(!viewsMap.has(r.view_name)) viewsMap.set(r.view_name, {name:r.view_name,query:r.sql,columns:[],internal:r.internal}); viewsMap.get(r.view_name)!.columns.push({name:r.column_name,type:r.data_type}); });

      const macros: MacroSchema[] = macrosData.map((r:any)=>({
          name: r.function_name,
          parameters: parseMacroParameters(r.parameters),
          returnType: r.return_type,
          sql: r.sql
      }));

      const countsQuery = tables.map(t => {
        const safeName = t.name.replace(/"/g, '""');
        return `SELECT '${t.name.replace(/'/g, "''")}' as name, COUNT(*) as count FROM "${safeName}"`;
      }).join(' UNION ALL ');
      try {
        const counts = tables.length > 0 ? await runQuery(countsQuery) : [];
        if (Array.isArray(counts)) {
            const countsMap = new Map<string, number>();
            counts.forEach((row: any) => {
                if (row && typeof row.name === 'string' && row.count !== null && row.count !== undefined) {
                    const numCount = Number(row.count);
                    if (!isNaN(numCount)) {
                        countsMap.set(row.name, numCount);
                    }
                }
            });
            tables.forEach(t => {
                t.rowCount = countsMap.get(t.name);
            });
        }
      } catch (e) {
          console.warn('Could not fetch row counts', e);
      }

      setSchema({ tables, views: Array.from(viewsMap.values()), macros });
  }, []);

  // Initial mode selection: probe the server, otherwise enter wasm mode and
  // wait for the user to drop a JFR file.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hasServer = await probeServer();
      if (cancelled) return;
      if (hasServer) {
        setMode('server');
        try {
          await fetchSchemaFor(executeRemoteQuery, true);
          if (!cancelled) setDbState(DBState.READY);
        } catch (err: any) {
          if (!cancelled) {
            setErrorMessage(err.message);
            setDbState(DBState.ERROR);
          }
        }
      } else {
        setMode('wasm');
        setDbState(DBState.NEEDS_FILE);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchSchemaFor]);

  const loadJfrFile = useCallback(async (bytes: Uint8Array) => {
    setDbState(DBState.IMPORTING);
    setErrorMessage(null);
    try {
      if (!wasmDbRef.current) {
        wasmDbRef.current = await initDuckDBWasm();
        wasmConnRef.current = await wasmDbRef.current.connect();
      }
      const conn = wasmConnRef.current!;
      await loadJfrIntoWasm(bytes, conn);
      setDbState(DBState.SCHEMA_LOADING);
      await fetchSchemaFor((sql) => runWasmQuery(conn, sql), true);
      setDbState(DBState.READY);
    } catch (err: any) {
      console.error('JFR import failed', err);
      setErrorMessage(err.message || String(err));
      setDbState(DBState.ERROR);
    }
  }, [fetchSchemaFor]);

  const query = useCallback(async (sql: string): Promise<any[]> => {
    if (dbState !== DBState.READY && sql.trim().toLowerCase().startsWith('select')) {
      throw new Error('DB not ready.');
    }
    return executeQuery(sql);
  }, [dbState, executeQuery]);

  const refreshSchema = useCallback(async () => {
    if (mode === 'wasm') {
      if (!wasmConnRef.current) return;
      const conn = wasmConnRef.current;
      await fetchSchemaFor((sql) => runWasmQuery(conn, sql), false);
    } else {
      await fetchSchemaFor(executeRemoteQuery, false);
    }
  }, [mode, fetchSchemaFor]);

  const contextValue = useMemo(() => ({
    dbState, mode, schema, query, errorMessage, recordingStart, recordingEnd, refreshSchema, loadJfrFile,
  }), [dbState, mode, schema, query, errorMessage, recordingStart, recordingEnd, refreshSchema, loadJfrFile]);

  return <DataContext.Provider value={contextValue}>{children}</DataContext.Provider>;
};
