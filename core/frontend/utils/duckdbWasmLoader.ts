import * as duckdb from '@duckdb/duckdb-wasm';

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
