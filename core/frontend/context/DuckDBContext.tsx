import React, { createContext, useState, useCallback, useMemo, ReactNode, useEffect, useRef } from 'react';
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { TableSchema, ViewSchema, MacroSchema } from '../types';
import { initDuckDBWasm, loadDuckDbFileIntoWasm } from '../utils/duckdbWasmLoader';
import { loadJfrIntoWasm } from '../utils/jfrToWasmLoader';
import { DEMO_SETUP_SQL } from '../data/demoNotebook';
import { BUILTIN_MACROS_SQL } from '../data/builtinSql';

const QUERY_ENDPOINT = `/api/query`;

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
export type SourceType = 'jfr' | 'duckdb';
export enum DBState { SCHEMA_LOADING, NEEDS_FILE, IMPORTING, READY, ERROR }
interface Schema { tables: TableSchema[]; views: ViewSchema[]; macros: MacroSchema[]; }

interface DataContextType {
  dbState: DBState;
  mode: DBMode | null;
  sourceType: SourceType | null;
  schema: Schema | null;
  errorMessage: string | null;
  serverProbeError: string | null;
  serverCurrentFile: string | null;
  recordingStart: number | null;
  recordingEnd: number | null;
  importProgress: number | null;
  query: (sql: string) => Promise<any[]>;
  refreshSchema: () => Promise<void>;
  loadFile: (source: File | Uint8Array, fileName: string, stacktraceDepth?: number) => Promise<void>;
  loadServerFile: (path: string) => Promise<void>;
  loadDemo: () => Promise<void>;
}

export const DataContext = createContext<DataContextType>({
  dbState: DBState.SCHEMA_LOADING,
  mode: null,
  sourceType: null,
  schema: null,
  errorMessage: null,
  serverProbeError: null,
  serverCurrentFile: null,
  recordingStart: null,
  recordingEnd: null,
  importProgress: null,
  query: async () => { throw new Error('DataContext not initialized'); },
  refreshSchema: async () => { throw new Error('DataContext not initialized'); },
  loadFile: async () => { throw new Error('DataContext not initialized'); },
  loadServerFile: async () => { throw new Error('DataContext not initialized'); },
  loadDemo: async () => { throw new Error('DataContext not initialized'); },
});

const executeRemoteQuery = async (sql: string): Promise<any> => {
    await dbLock.acquire();
    try {
        const r = await fetch(QUERY_ENDPOINT, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({sql}) });
        const text = await r.text();
        let body: any;
        try { body = JSON.parse(text); } catch { throw new Error(`Server returned non-JSON response: ${text}`); }
        if (!r.ok || body.error) throw new Error(body.error || `Request failed with status ${r.status}`);
        if (typeof body === 'string') try { return JSON.parse(body); } catch { throw new Error(`Could not parse string response: ${body}`); }
        return body;
    } finally {
        dbLock.release();
    }
};

const probeServer = async (): Promise<{ ok: boolean; reason?: string; silent?: boolean }> => {
    try {
        const r = await fetch(QUERY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: 'SELECT 1' }),
        });
        // 5xx / 404 typically means "no query server is running here" — that's
        // the normal WASM-only setup, not a noteworthy failure. Don't bother
        // the user with a toast.
        if (!r.ok) {
            const silent = r.status >= 500 || r.status === 404;
            return { ok: false, reason: `server probe returned HTTP ${r.status}`, silent };
        }
        const body = await r.json().catch(() => null);
        if (Array.isArray(body) || (body && !body.error)) return { ok: true };
        return { ok: false, reason: body?.error || 'unexpected probe response' };
    } catch (err: any) {
        // Network errors (server unreachable) are the WASM-only happy path.
        return { ok: false, reason: err.message || 'network error', silent: true };
    }
};

const runWasmQuery = async (conn: AsyncDuckDBConnection, sql: string): Promise<any[]> => {
    await dbLock.acquire();
    try {
        const result = await conn.query(sql);

        // Build a map of column name → decimal scale from the Arrow schema so
        // that Decimal128 columns (e.g. the result of round()) are divided by
        // 10^scale to restore the true floating-point value. Without this,
        // round(x, 3) returns values 1000× too large because Arrow encodes the
        // unscaled integer (e.g. 225000 for 225.000) and we were just reading
        // arr[0] directly.
        const decimalScales = new Map<string, number>();
        for (const field of (result.schema?.fields ?? [])) {
            const t = (field as any).type;
            if (t && typeof t.scale === 'number' && typeof t.precision === 'number') {
                decimalScales.set(field.name as string, t.scale);
            }
        }

        return result.toArray().map((row: any) => {
            const obj = row.toJSON();
            for (const k of Object.keys(obj)) {
                const v = obj[k];
                if (typeof v === 'bigint') {
                    // B-133: keep BigInt precision for values that exceed Number.MAX_SAFE_INTEGER
                    // (e.g. JFR nanosecond timestamps ~1.7×10^18 > 2^53). Only convert to Number
                    // when the value is safely representable.
                    const abs = v < 0n ? -v : v;
                    obj[k] = abs <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
                } else if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
                    // Arrow returns HUGEINT/DECIMAL/INT128 scalars as a 4-element
                    // Int32 view (the little-endian byte representation of the
                    // 128-bit integer). When the upper three words are zero the
                    // value fits in 32 bits and we unwrap to that scalar so
                    // downstream formatters see a real number rather than
                    // "1234,0,0,0". Genuine LIST columns are left as plain
                    // arrays for Recharts.
                    //
                    // For Decimal columns we also apply the scale divisor so
                    // that round(x, 3) returns 225.0 instead of 225000.
                    const arr = Array.from(v as unknown as ArrayLike<unknown>) as number[];
                    if (arr.length === 4 && arr[1] === 0 && arr[2] === 0 && arr[3] === 0
                        && typeof arr[0] === 'number') {
                        const raw = arr[0];
                        const scale = decimalScales.get(k);
                        obj[k] = (scale !== undefined && scale > 0) ? raw / Math.pow(10, scale) : raw;
                    } else {
                        obj[k] = arr;
                    }
                }
            }
            return obj;
        });
    } finally {
        dbLock.release();
    }
};

const parseMacroParameters = (params: any): string[] => {
    if (Array.isArray(params)) return params.map(String);
    if (typeof params === 'string') {
        if (params.trim() === '') return [];
        return params.split(',').map(p => p.trim());
    }
    return [];
};

async function detectSourceType(runQuery: (sql: string) => Promise<any[]>): Promise<SourceType> {
    try {
        const r = await runQuery(`SELECT COUNT(*) AS c FROM duckdb_tables() WHERE table_name='RecordingInfo'`);
        return Number(r[0]?.c) > 0 ? 'jfr' : 'duckdb';
    } catch {
        return 'duckdb';
    }
}

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [dbState, setDbState] = useState<DBState>(DBState.SCHEMA_LOADING);
  const [mode, setMode] = useState<DBMode | null>(null);
  const [sourceType, setSourceType] = useState<SourceType | null>(null);
  const [schema, setSchema] = useState<Schema | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [serverProbeError, setServerProbeError] = useState<string | null>(null);
  const [serverCurrentFile, setServerCurrentFile] = useState<string | null>(null);
  const [recordingStart, setRecordingStart] = useState<number | null>(null);
  const [recordingEnd, setRecordingEnd] = useState<number | null>(null);
  const [importProgress, setImportProgress] = useState<number | null>(null);

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
            const exists = await runQuery(`SELECT 1 FROM duckdb_tables() WHERE table_name='RecordingInfo' LIMIT 1`);
            if (exists.length > 0) {
              const info = await runQuery(`SELECT "firstEvent", "lastEvent" FROM "RecordingInfo" LIMIT 1;`);
              // B-194: new Date(null).getTime() === 0 which passes !isNaN(), causing epoch-1970
              // to be applied as recording bounds. Guard against null/falsy values explicitly.
              if (info[0]?.firstEvent != null && info[0]?.lastEvent != null) {
                const s = new Date(info[0].firstEvent).getTime(), e = new Date(info[0].lastEvent).getTime();
                if (!isNaN(s) && !isNaN(e) && s > 0 && e > 0) { setRecordingStart(s); setRecordingEnd(e); }
              }
            } else {
              // No RecordingInfo table — derive bounds from JFR tables that have a startTime column.
              const tablesWithStartTime = await runQuery(
                `SELECT table_name FROM duckdb_columns() WHERE column_name='startTime' AND table_name NOT IN (SELECT view_name FROM duckdb_views()) LIMIT 10`
              );
              if (tablesWithStartTime.length > 0) {
                const unionParts = tablesWithStartTime.map((r: any) => `SELECT MIN("startTime") AS lo, MAX("startTime") AS hi FROM "${r.table_name.replace(/"/g, '""')}"`);
                const bounds = await runQuery(`SELECT MIN(lo) AS lo, MAX(hi) AS hi FROM (${unionParts.join(' UNION ALL ')})`);
                if (bounds[0]?.lo != null) {
                  const s = new Date(bounds[0].lo).getTime(), e = new Date(bounds[0].hi).getTime();
                  if (!isNaN(s) && !isNaN(e)) { setRecordingStart(s); setRecordingEnd(e); }
                }
              }
            }
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

      // Build the counts query. The two escape paths are kept strictly
      // separate (B-134): identEsc uses ISO double-quote doubling for the FROM
      // clause identifier; litEsc uses single-quote doubling for the SELECT
      // string literal that carries the table name back to JS.
      // B-052: batch into chunks of 20 so the UNION ALL stays manageable.
      const CHUNK = 20;
      try {
        const countsMap = new Map<string, number>();
        for (let i = 0; i < tables.length; i += CHUNK) {
            const chunk = tables.slice(i, i + CHUNK);
            const countsQuery = chunk.map(t => {
                const identEsc = t.name.replace(/"/g, '""');
                const litEsc   = t.name.replace(/'/g, "''");
                return `SELECT '${litEsc}' as name, COUNT(*) as count FROM "${identEsc}"`;
            }).join(' UNION ALL ');
            const counts = await runQuery(countsQuery);
            if (Array.isArray(counts)) {
                counts.forEach((row: any) => {
                    if (row && typeof row.name === 'string' && row.count !== null && row.count !== undefined) {
                        const numCount = Number(row.count);
                        if (!isNaN(numCount)) countsMap.set(row.name, numCount);
                    }
                });
            }
        }
        tables.forEach(t => { t.rowCount = countsMap.get(t.name); });
      } catch (e) {
          console.warn('Could not fetch row counts', e);
      }

      setSchema({ tables, views: Array.from(viewsMap.values()), macros });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const probe = await probeServer();
      if (cancelled) return;
      if (probe.ok) {
        setMode('server');
        try {
          const type = await detectSourceType(executeRemoteQuery);
          if (!cancelled) setSourceType(type);
          try {
            const statusRes = await fetch('/api/status');
            if (statusRes.ok) {
              const status = await statusRes.json();
              if (!cancelled && status.currentFile) setServerCurrentFile(status.currentFile);
            }
          } catch { /* server may not have /api/status yet */ }
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
        if (!probe.silent) setServerProbeError(probe.reason || 'server probe failed');
        setDbState(DBState.NEEDS_FILE);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchSchemaFor]);

  const loadFile = useCallback(async (source: File | Uint8Array, fileName: string, stacktraceDepth = 10) => {
    setDbState(DBState.IMPORTING);
    setImportProgress(0.01);
    setErrorMessage(null);
    try {
      if (!wasmDbRef.current) {
        wasmDbRef.current = await initDuckDBWasm();
        wasmConnRef.current = await wasmDbRef.current.connect();
      }
      const conn = wasmConnRef.current!;
      const isJfr = fileName.toLowerCase().endsWith('.jfr');
      if (isJfr) {
        await loadJfrIntoWasm(source, conn, wasmDbRef.current!, stacktraceDepth, setImportProgress);
      } else {
        const bytes = source instanceof File ? new Uint8Array(await source.arrayBuffer()) : source;
        await loadDuckDbFileIntoWasm(wasmDbRef.current!, conn, bytes);
      }
      const type = await detectSourceType((sql) => runWasmQuery(conn, sql));
      setSourceType(type);
      setDbState(DBState.SCHEMA_LOADING);
      setImportProgress(0.97);
      await fetchSchemaFor((sql) => runWasmQuery(conn, sql), true);
      setImportProgress(null);
      setDbState(DBState.READY);
    } catch (err: any) {
      console.error('File import failed', err);
      setErrorMessage(err.message || String(err));
      setImportProgress(null);
      setDbState(DBState.ERROR);
    }
  }, [fetchSchemaFor]);

  const loadDemo = useCallback(async () => {
    setDbState(DBState.IMPORTING);
    setErrorMessage(null);
    try {
      if (!wasmDbRef.current) {
        wasmDbRef.current = await initDuckDBWasm();
        wasmConnRef.current = await wasmDbRef.current.connect();
      }
      const conn = wasmConnRef.current!;
      // Execute each statement in DEMO_SETUP_SQL individually
      for (const stmt of DEMO_SETUP_SQL.split(/;\s*\n/).map(s => s.trim()).filter(Boolean)) {
        await runWasmQuery(conn, stmt + ';');
      }
      // Register built-in macros so notebooks can use P90(), format_duration(), etc.
      for (const sql of BUILTIN_MACROS_SQL) {
        try { await conn.query(sql); } catch (e) { console.warn('builtin macro failed:', e); }
      }
      setSourceType('jfr');
      setDbState(DBState.SCHEMA_LOADING);
      await fetchSchemaFor((sql) => runWasmQuery(conn, sql), true);
      setDbState(DBState.READY);
    } catch (err: any) {
      console.error('Demo load failed', err);
      setErrorMessage(err.message || String(err));
      setDbState(DBState.ERROR);
    }
  }, [fetchSchemaFor]);

  const loadServerFile = useCallback(async (path: string) => {
    setDbState(DBState.IMPORTING);
    setErrorMessage(null);
    try {
      const r = await fetch('/api/load-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const body = await r.json();
      if (!r.ok || body.error) throw new Error(body.error || 'load failed');
      setServerCurrentFile(path);
      setRecordingStart(null);
      setRecordingEnd(null);
      const type = await detectSourceType(executeRemoteQuery);
      setSourceType(type);
      setDbState(DBState.SCHEMA_LOADING);
      await fetchSchemaFor(executeRemoteQuery, true);
      setDbState(DBState.READY);
    } catch (err: any) {
      setErrorMessage(err.message || String(err));
      setDbState(DBState.ERROR);
    }
  }, [fetchSchemaFor]);

  const query = useCallback(async (sql: string): Promise<any[]> => {
    if (dbState !== DBState.READY) {
      throw new Error(`Cannot run query: database is in state "${dbState}". Wait for it to finish loading or reload the page if it appears stuck.`);
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
    dbState, mode, sourceType, schema, query, errorMessage, serverProbeError, serverCurrentFile,
    recordingStart, recordingEnd, importProgress, refreshSchema, loadFile, loadServerFile, loadDemo,
  }), [dbState, mode, sourceType, schema, query, errorMessage, serverProbeError, serverCurrentFile,
    recordingStart, recordingEnd, importProgress, refreshSchema, loadFile, loadServerFile, loadDemo]);

  return <DataContext.Provider value={contextValue}>{children}</DataContext.Provider>;
};
