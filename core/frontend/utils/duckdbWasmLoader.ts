import * as duckdb from '@duckdb/duckdb-wasm';
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { BUILTIN_MACROS_SQL } from '../data/builtinSql';

export async function loadDuckDbFileIntoWasm(
  db: AsyncDuckDB,
  conn: AsyncDuckDBConnection,
  bytes: Uint8Array
): Promise<void> {
  const t0 = performance.now();
  await db.registerFileBuffer('input.db', bytes);
  const t1 = performance.now();
  await conn.query("ATTACH 'input.db' AS src (READ_ONLY)");
  const t2 = performance.now();
  try {
    // Fetch table and view lists in parallel — two independent catalog reads.
    const [tables, views] = await Promise.all([
      conn.query("SELECT table_name FROM duckdb_tables() WHERE database_name='src' AND schema_name='main'"),
      conn.query("SELECT view_name, sql FROM duckdb_views() WHERE database_name='src' AND NOT internal AND schema_name='main'"),
    ]);
    // Batch all CREATE TABLE statements into one multi-statement call to avoid N serial round-trips.
    const tableRows = tables.toArray();
    if (tableRows.length > 0) {
      const createStmts = tableRows.map((row: any) => {
        const safe = String(row.table_name).replace(/"/g, '""');
        return `CREATE TABLE IF NOT EXISTS "${safe}" AS SELECT * FROM src.main."${safe}"`;
      });
      await conn.query(createStmts.join(';\n')).catch(async () => {
        for (const sql of createStmts) {
          await conn.query(sql).catch(() => {});
        }
      });
    }
    for (const row of views.toArray()) {
      const r = row as any;
      try { await conn.query(r.sql); } catch { /* skip views that can't be recreated */ }
    }
  } finally {
    await conn.query("DETACH src");
  }
  const t3 = performance.now();
  // Re-register builtin macros — DuckDB WASM doesn't support ATTACH for
  // function/macro objects, so they must be recreated in the in-memory catalog.
  // Batch all macros into a single query() call to save ~45 round-trips.
  await conn.query(BUILTIN_MACROS_SQL.join(';\n')).catch(async () => {
    for (const sql of BUILTIN_MACROS_SQL) {
      try { await conn.query(sql); } catch { /* skip macros that depend on missing tables */ }
    }
  });
  const t4 = performance.now();
  console.log(`[duckdb-load] register: ${(t1-t0).toFixed(0)}ms attach+copy: ${(t3-t2).toFixed(0)}ms macros: ${(t4-t3).toFixed(0)}ms total: ${(t4-t0).toFixed(0)}ms`);
}

/**
 * Initializes a fresh DuckDB WASM instance using the bundled jsdelivr modules.
 *
 * The notebook calls this lazily — only when no jfr-query server is reachable
 * and the user opts into in-browser mode by dropping a `.jfr` file.
 */
export async function initDuckDBWasm(): Promise<duckdb.AsyncDuckDB> {
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);
  if (!bundle.mainWorker) {
    throw new Error('No mainWorker in selected DuckDB bundle');
  }
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  try {
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  } catch (e) {
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
    throw e;
  }
  URL.revokeObjectURL(workerUrl);
  // Use multiple threads on multi-core machines — DuckDB WASM supports parallel
  // query execution within a connection. Cap at 4 to avoid excessive thread overhead.
  // navigator.hardwareConcurrency is available in all modern browsers.
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 1) : 1;
  if (cores > 1) {
    const dbConn = await db.connect();
    try {
      await dbConn.query(`PRAGMA threads=${Math.min(cores, 4)}`).catch(() => {});
    } finally {
      await dbConn.close().catch(() => {});
    }
  }
  return db;
}
