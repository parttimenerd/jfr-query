import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { BUILTIN_MACROS_SQL, BUILTIN_VIEWS_SQL } from '../data/builtinSql';

const PERF_KEY = 'jfr_import_ms_per_byte';

/**
 * Bridge to the GraalVM Web Image module that wraps `BasicParallelImporter`.
 *
 * The WASM bundle, when loaded, attaches a global named `JFRImporter` (see
 * {@code WasmMain.registerEntry}). Calling its single method imports a JFR
 * recording's bytes into the provided DuckDB connection, materializing all
 * tables/macros/views the same way the CLI/server path does.
 */
declare global {
  interface Window {
    JFRImporter?: {
      importJfrIntoDuckDB(bytes: Uint8Array, conn: unknown, db: unknown, stacktraceDepth: number): void;
    };
    _jfrCsvPending?: number;
  }
}

let importerLoadPromise: Promise<void> | null = null;

/**
 * Lazily injects `wasm/jfr-importer.js` once. Subsequent calls reuse the same
 * promise so we don't duplicate `<script>` tags or re-init the runtime.
 */
function loadJfrImporterScript(): Promise<void> {
  if (window.JFRImporter) return Promise.resolve();
  if (importerLoadPromise) return importerLoadPromise;

  importerLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/wasm/jfr-importer.js';
    script.async = true;
    script.onload = () => {
      const start = Date.now();
      const wait = () => {
        if (window.JFRImporter) return resolve();
        if (Date.now() - start > 10_000) {
          return reject(new Error('JFRImporter global never appeared after loading jfr-importer.js'));
        }
        setTimeout(wait, 50);
      };
      wait();
    };
    script.onerror = () => reject(new Error('Failed to load /wasm/jfr-importer.js — was the wasm module built (mvn -Pwasm package) and copied to frontend/public/wasm/?'));
    document.head.appendChild(script);
  });
  return importerLoadPromise;
}

/**
 * Imports `jfrBytes` into the given DuckDB WASM connection. After this call
 * returns, the connection contains all JFR tables, macros, and views that the
 * server path would have created.
 *
 * @param stacktraceDepth Max stack frames stored in the `$methods` array column
 *   per event (default 10). Pass a lower value (e.g. 3) for large recordings to
 *   significantly reduce import time; pass 0 to skip the methods array entirely.
 * @param onProgress Optional callback (0–1) called at key checkpoints. The Java
 *   phase blocks the JS thread so no updates fire during that window; progress
 *   jumps to ~0.80 once Java returns, then tracks the Arrow-drain phase.
 */
export async function loadJfrIntoWasm(
  jfrBytes: Uint8Array,
  conn: AsyncDuckDBConnection,
  db: AsyncDuckDB,
  stacktraceDepth = 10,
  onProgress?: (pct: number) => void,
): Promise<void> {
  await loadJfrImporterScript();
  if (!window.JFRImporter) {
    throw new Error('JFRImporter global is missing after script load');
  }

  // Stage the Arrow module on globalThis so BinaryAppender's @JS code can use typed
  // vectors without a dynamic import() inside the GraalVM bridge context.
  if (!(window as any).__arrow) {
    const arrow = await import('apache-arrow');
    (window as any).__arrow = arrow;
  }

  // Reset the pending counter tracked by BinaryAppender.loadColumnarData
  window._jfrCsvPending = 0;

  // Estimate Java-phase duration from stored calibration (ms per byte).
  // Default: 1.2 µs/byte based on benchmarks (6.2MB=1.5s, 19MB=22s).
  const storedMsPerByte = (() => {
    try { return parseFloat(localStorage.getItem(PERF_KEY) ?? '') || 0; } catch { return 0; }
  })();
  const msPerByte = storedMsPerByte > 0 ? storedMsPerByte : 0.0012;
  const estimatedJavaMs = jfrBytes.byteLength * msPerByte;

  onProgress?.(0.01);

  const tJava0 = performance.now();
  // The importer is synchronous from Java's perspective; offload to a microtask
  // so the UI gets a chance to repaint the "importing" state.
  await new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      try {
        window.JFRImporter!.importJfrIntoDuckDB(jfrBytes, conn, db, stacktraceDepth);
        resolve();
      } catch (e) {
        reject(e);
      }
    }, 0);
  });
  const tJavaDone = performance.now();
  const actualJavaMs = tJavaDone - tJava0;

  // Java phase complete — jump to 80%, drain from there.
  onProgress?.(0.80);

  // Capture peak pending count to track drain fraction.
  const peakPending = window._jfrCsvPending ?? 0;

  // Drain: wait for all pending insertArrowTable promises.
  const tDrainStart = performance.now();
  while ((window._jfrCsvPending ?? 0) > 0) {
    await new Promise(r => setTimeout(r, 10));
    if (peakPending > 0) {
      const drained = peakPending - (window._jfrCsvPending ?? 0);
      onProgress?.(0.80 + 0.15 * (drained / peakPending));
    }
  }
  const tDrainDone = performance.now();

  // Drain complete — 95%, schema loading takes it to 100%.
  onProgress?.(0.95);

  const jfrPerfMsg = `[jfr-perf] Java sync: ${(tJavaDone - tJava0).toFixed(0)}ms | CSV drain: ${(tDrainDone - tDrainStart).toFixed(0)}ms`;
  console.log(jfrPerfMsg);
  (window as any).__lastJfrPerf = { javaSyncMs: tJavaDone - tJava0, drainMs: tDrainDone - tDrainStart, bytes: jfrBytes.byteLength };

  // Update calibration: smooth toward actual observed ms/byte.
  if (jfrBytes.byteLength > 0 && actualJavaMs > 500) {
    const observed = actualJavaMs / jfrBytes.byteLength;
    // Exponential smoothing: weight new observation at 30%.
    const updated = storedMsPerByte > 0 ? 0.7 * storedMsPerByte + 0.3 * observed : observed;
    try { localStorage.setItem(PERF_KEY, String(updated)); } catch { /* storage full */ }
  }

  // Register built-in macros and views — the Java WASM path skips these because
  // they require a JDBC connection. Run them client-side instead.
  //
  // Strategy: open PARALLELISM extra connections and distribute the ~134 SQL
  // statements across them so they execute concurrently. DuckDB WASM serialises
  // per-connection but allows multiple connections to overlap.
  const tSqlStart = performance.now();
  const PARALLELISM = new URL(location.href).searchParams.has('sqlSerial') ? 1 : 4;
  const allSql = [...BUILTIN_MACROS_SQL, ...BUILTIN_VIEWS_SQL];
  const extraConns: typeof conn[] = [];
  try {
    for (let i = 0; i < PARALLELISM - 1; i++) {
      extraConns.push(await db.connect());
    }
    const conns = [conn, ...extraConns];
    const chunkSize = Math.ceil(allSql.length / PARALLELISM);
    await Promise.allSettled(
      conns.map((c, ci) => {
        const slice = allSql.slice(ci * chunkSize, (ci + 1) * chunkSize);
        return slice.reduce(
          (chain, sql) => chain.then(() => c.query(sql).catch((e) => console.warn('builtin sql failed:', e))),
          Promise.resolve(),
        );
      }),
    );
  } finally {
    for (const c of extraConns) {
      c.close().catch(() => {});
    }
  }
  const sqlMs = performance.now() - tSqlStart;
  console.log(`[jfr-perf] SQL reg (parallel×${PARALLELISM}): ${sqlMs.toFixed(0)}ms`);
  (window as any).__lastJfrPerf = {
    ...(window as any).__lastJfrPerf,
    sqlRegMs: sqlMs,
    sqlParallelism: PARALLELISM,
  };
}

