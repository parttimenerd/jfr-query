import * as duckdb from '@duckdb/duckdb-wasm';
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';

export async function loadDuckDbFileIntoWasm(
  db: AsyncDuckDB,
  conn: AsyncDuckDBConnection,
  bytes: Uint8Array
): Promise<void> {
  await db.registerFileBuffer('input.db', bytes);
  await conn.query("ATTACH 'input.db' AS src (READ_ONLY)");
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
