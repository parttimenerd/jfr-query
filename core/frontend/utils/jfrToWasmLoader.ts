import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { tableFromIPC } from 'apache-arrow';
import { BUILTIN_MACROS_SQL, BUILTIN_VIEWS_SQL } from '../data/builtinSql';

const PERF_KEY = 'jfr_import_ms_per_byte';

/**
 * Imports `jfrBytes` into the given DuckDB WASM connection via a Web Worker.
 *
 * The GraalVM WASM bundle runs entirely in the worker so the main thread — and
 * therefore the UI — stays responsive during the 30-60 s Java parse phase on
 * large recordings.
 *
 * Worker protocol:
 *   main → worker  { type:'import', bytes:Uint8Array, stacktraceDepth:number }
 *   worker → main  { type:'query',  reqId, sql }
 *   worker → main  { type:'insert', reqId, tableName, ipcBytes:ArrayBuffer }
 *   worker → main  { type:'done' }
 *   worker → main  { type:'error', message }
 *   main → worker  { type:'query-result',  reqId, rows }
 *   main → worker  { type:'insert-result', reqId }
 *
 * @param stacktraceDepth Max stack frames per event (default 10). Lower values
 *   significantly reduce import time on sampling-heavy recordings.
 * @param onProgress Optional callback (0–1) called at key checkpoints.
 */
export async function loadJfrIntoWasm(
  jfrBytes: Uint8Array,
  conn: AsyncDuckDBConnection,
  db: AsyncDuckDB,
  stacktraceDepth = 10,
  onProgress?: (pct: number) => void,
): Promise<void> {
  // Stage Arrow module on globalThis — needed for main-thread insertArrowTable calls.
  if (!(window as any).__arrow) {
    (window as any).__arrow = await import('apache-arrow');
  }

  onProgress?.(0.01);

  const storedMsPerByte = (() => {
    try { return parseFloat(localStorage.getItem(PERF_KEY) ?? '') || 0; } catch { return 0; }
  })();

  // Record byte count before transfer (buffer becomes detached after postMessage).
  const jfrByteLength = jfrBytes.byteLength;

  const tJava0 = performance.now();

  // Track in-flight insertArrowTable calls on the main thread for drain + progress.
  let pendingInserts = 0;
  let peakPending = 0;

  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(
      new URL('../workers/jfrImport.worker.ts', import.meta.url),
      // Must be 'module' for Vite to bundle the worker with its imports.
      // The jfr-importer.js WASM bundle is loaded inside the worker via fetch+eval
      // (see jfrImport.worker.ts) rather than importScripts to stay compatible
      // with module workers.
      { type: 'module' },
    );

    worker.onmessage = async (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'query') {
        // DDL from JsDuckDBSink.jsExecute — fire on real conn, return value ignored.
        try {
          await conn.query(msg.sql as string);
        } catch (err) {
          console.warn('[jfr-worker] query failed:', err);
        }
        worker.postMessage({ type: 'query-result', reqId: msg.reqId, rows: [] });
        return;
      }

      if (msg.type === 'insert') {
        // Arrow IPC bytes from BinaryAppender — deserialise and insert into real conn.
        pendingInserts++;
        peakPending = Math.max(peakPending, pendingInserts);
        // Don't await before replying — let the worker continue processing events
        // while we insert. Track completion locally for drain.
        conn.insertArrowTable(
          tableFromIPC(new Uint8Array(msg.ipcBytes as ArrayBuffer)),
          { name: msg.tableName as string, create: false },
        ).catch((err) => console.warn('[jfr-worker] insert failed for', msg.tableName, err))
          .finally(() => { pendingInserts--; });
        // Reply immediately so the worker's pending counter decrements and Java continues.
        worker.postMessage({ type: 'insert-result', reqId: msg.reqId });
        return;
      }

      if (msg.type === 'done') {
        worker.terminate();
        resolve();
        return;
      }

      if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.message as string));
        return;
      }
    };

    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(`JFR import worker error: ${e.message}`));
    };

    // Transfer the bytes zero-copy — worker takes ownership of the buffer.
    const buf = jfrBytes.buffer.byteLength === jfrBytes.byteLength
      ? jfrBytes.buffer
      : jfrBytes.slice().buffer;

    worker.postMessage(
      { type: 'import', bytes: new Uint8Array(buf), stacktraceDepth },
      [buf],
    );
  });

  const tJavaDone = performance.now();
  const actualJavaMs = tJavaDone - tJava0;

  onProgress?.(0.80);

  // Drain: wait for all main-thread insertArrowTable calls to complete.
  const tDrainStart = performance.now();
  while (pendingInserts > 0) {
    await new Promise(r => setTimeout(r, 10));
    if (peakPending > 0) {
      onProgress?.(0.80 + 0.15 * (1 - pendingInserts / peakPending));
    }
  }
  const tDrainDone = performance.now();

  onProgress?.(0.95);

  console.log(`[jfr-perf] Java+drain: ${actualJavaMs.toFixed(0)}ms | main-thread drain: ${(tDrainDone - tDrainStart).toFixed(0)}ms`);
  (window as any).__lastJfrPerf = {
    javaSyncMs: actualJavaMs,
    drainMs: tDrainDone - tDrainStart,
    bytes: jfrByteLength,
  };

  // Update calibration: smooth toward actual observed ms/byte.
  if (jfrByteLength > 0 && actualJavaMs > 500) {
    const observed = actualJavaMs / jfrByteLength;
    const updated = storedMsPerByte > 0 ? 0.7 * storedMsPerByte + 0.3 * observed : observed;
    try { localStorage.setItem(PERF_KEY, String(updated)); } catch { /* storage full */ }
  }

  // Register built-in macros and views in parallel across 4 connections.
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
