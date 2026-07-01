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
    // duckdb_tables() is a global function — filter by database_name to get
    // only the attached db's tables, not the in-memory default catalog.
    const tables = await conn.query(
      "SELECT table_name FROM duckdb_tables() WHERE database_name='src' AND schema_name='main'"
    );
    for (const row of tables.toArray()) {
      const t = (row as any).table_name;
      const safe = String(t).replace(/"/g, '""');
      await conn.query(`CREATE TABLE IF NOT EXISTS "${safe}" AS SELECT * FROM src.main."${safe}"`);
    }
    const views = await conn.query(
      "SELECT view_name, sql FROM duckdb_views() WHERE database_name='src' AND NOT internal AND schema_name='main'"
    );
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
  for (const sql of BUILTIN_MACROS_SQL) {
    try { await conn.query(sql); } catch { /* skip macros that depend on missing tables */ }
  }
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
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  return db;
}
