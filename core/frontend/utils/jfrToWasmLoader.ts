import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { tableFromIPC } from 'apache-arrow';
import { BUILTIN_MACROS_SQL, BUILTIN_VIEWS_SQL } from '../data/builtinSql';

const PERF_KEY = 'jfr_import_ms_per_byte';

// Maximum workers to run in parallel.
// Kept at 2: each worker instantiates its own 11 MB GraalVM WASM binary;
// beyond 2 the combined heap can exhaust browser tab memory on large files.
const MAX_CHUNK_WORKERS = 2;

// ── WASM worker pool ──────────────────────────────────────────────────────────
//
// Workers are long-lived and reused across chunk batches. On first use we
// pre-compile the WebAssembly.Module on the main thread (compileStreaming is
// fast on the main thread and the compiled Module is transferable to workers),
// then post it to each worker so they can skip their own compile step — saving
// ~5-8 s of cold-start per worker.

let _precompiledModulePromise: Promise<WebAssembly.Module | null> | null = null;

function getPrecompiledModule(): Promise<WebAssembly.Module | null> {
  if (!_precompiledModulePromise) {
    _precompiledModulePromise = WebAssembly.compileStreaming(fetch('/wasm/jfr-importer.js.wasm'))
      .catch(() => null); // non-fatal — workers fall back to their own compile
  }
  return _precompiledModulePromise;
}

/** A ready-to-use worker and its associated DuckDB connection. */
interface PooledWorker {
  worker: Worker;
  conn: AsyncDuckDBConnection;
  busy: boolean;
}

const workerPool: PooledWorker[] = [];

// Kick off WASM compilation immediately at module load — so it's likely done
// by the time the user drops a JFR file.
getPrecompiledModule();

/** Create and warm a new pooled worker, sending it the pre-compiled WASM module. */
async function createPooledWorker(
  db: AsyncDuckDB,
  wasmModule: WebAssembly.Module | null,
): Promise<PooledWorker> {
  const conn = await db.connect();
  const worker = new Worker(
    new URL('../workers/jfrImport.worker.ts', import.meta.url),
    { type: 'module' },
  );
  const entry: PooledWorker = { worker, conn, busy: false };

  await new Promise<void>((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data.type === 'ready') { worker.removeEventListener('message', onMsg); resolve(); }
      if (e.data.type === 'error') { worker.removeEventListener('message', onMsg); reject(new Error(e.data.message)); }
    };
    worker.addEventListener('message', onMsg);
    worker.onerror = (ev) => reject(new Error(ev.message));
    if (wasmModule) {
      worker.postMessage({ type: 'init', wasmModule });
    } else {
      worker.postMessage({ type: 'init' });
    }
  });

  return entry;
}

/**
 * Parses JFR chunk boundaries from raw bytes.
 * JFR format: each chunk starts with magic FLR\0 (4 bytes), then 4 bytes version,
 * then chunk size as big-endian int64 at offset 8.
 * Returns array of {start, end} byte offsets for each chunk.
 */
function parseJfrChunks(bytes: Uint8Array): Array<{ start: number; end: number }> {
  const chunks: Array<{ start: number; end: number }> = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 16 <= bytes.byteLength) {
    // Verify magic FLR\0
    if (bytes[offset] !== 0x46 || bytes[offset + 1] !== 0x4C ||
        bytes[offset + 2] !== 0x52 || bytes[offset + 3] !== 0x00) {
      break;
    }
    // Chunk size is big-endian int64 at offset+8 (split into two uint32 since JS BigInt is slow)
    const hi = dv.getUint32(offset + 8, false);
    const lo = dv.getUint32(offset + 12, false);
    // Safe for files up to ~4GB (hi is almost always 0 in practice)
    const chunkSize = hi * 4294967296 + lo;
    if (chunkSize <= 0 || offset + chunkSize > bytes.byteLength + 1) break;
    chunks.push({ start: offset, end: offset + chunkSize });
    offset += chunkSize;
  }
  return chunks.length > 0 ? chunks : [{ start: 0, end: bytes.byteLength }];
}

/**
 * Dispatch one import job to an existing pooled worker.
 * The worker is marked busy for the duration and released on completion.
 * Uses the worker's own dedicated DuckDB connection for all queries/inserts.
 */
async function dispatchToPooledWorker(
  pooled: PooledWorker,
  slice: Uint8Array,
  tablePrefix: string,
  stacktraceDepth: number,
  onInsert?: () => void,
  onInsertDone?: () => void,
): Promise<void> {
  pooled.busy = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const { worker, conn } = pooled;

      const onMsg = async (e: MessageEvent) => {
        const msg = e.data;

        if (msg.type === 'query') {
          try {
            await conn.query(msg.sql as string);
          } catch (err) {
            console.warn(`[jfr-worker ${tablePrefix}] query failed:`, err);
          }
          worker.postMessage({ type: 'query-result', reqId: msg.reqId, rows: [] });
          return;
        }

        if (msg.type === 'insert') {
          onInsert?.();
          conn.insertArrowTable(
            tableFromIPC(new Uint8Array(msg.ipcBytes as ArrayBuffer)),
            { name: msg.tableName as string, create: false },
          ).catch((err) => console.warn(`[jfr-worker ${tablePrefix}] insert failed for`, msg.tableName, err))
            .finally(() => { onInsertDone?.(); });
          worker.postMessage({ type: 'insert-result', reqId: msg.reqId });
          return;
        }

        if (msg.type === 'done') { worker.removeEventListener('message', onMsg); resolve(); return; }
        if (msg.type === 'error') { worker.removeEventListener('message', onMsg); reject(new Error(msg.message as string)); return; }
      };

      worker.addEventListener('message', onMsg);
      worker.onerror = (ev) => {
        worker.removeEventListener('message', onMsg);
        reject(new Error(`JFR import worker error (${tablePrefix}): ${ev.message}`));
      };

      const buf = slice.buffer.byteLength === slice.byteLength ? slice.buffer : slice.slice().buffer;
      worker.postMessage({ type: 'import', bytes: new Uint8Array(buf), stacktraceDepth, tablePrefix }, [buf]);
    });
  } finally {
    pooled.busy = false;
  }
}

/**
 * Merges chunk-prefixed tables (`chunk0_T`, `chunk1_T`, ...) into final tables.
 *
 * For struct tables (those with `_id UINTEGER PRIMARY KEY`):
 *   - Dedup rows across workers by natural key using DENSE_RANK
 *   - Build old_id→new_id mapping tables
 *   - Rewrite UINTEGER and UINTEGER[] columns in event tables that reference struct tables
 *
 * For event tables (no _id primary key):
 *   - Simple UNION ALL insert from all chunk prefixes
 */
async function mergeChunkTables(
  conn: AsyncDuckDBConnection,
  numChunks: number,
): Promise<void> {
  // 1. Collect all base table names across ALL chunks (not just chunk0)
  const allTablesResult = await conn.query(
    `SELECT DISTINCT regexp_replace(table_name, '^chunk\\d+_', '') AS base_name
     FROM information_schema.tables
     WHERE table_schema='main' AND regexp_matches(table_name, '^chunk\\d+_')
     ORDER BY base_name`
  );
  const allBaseNames = allTablesResult.toArray().map((r: any) => String(r.base_name));

  if (allBaseNames.length === 0) return;

  // Build a map: baseName → array of worker indices that have it.
  // Single query fetches all chunk-prefixed table names at once — avoids N×M round-trips.
  const allChunkTablesResult = await conn.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='main' AND regexp_matches(table_name, '^chunk\\d+_')`
  );
  const chunkTableSet = new Set(
    allChunkTablesResult.toArray().map((r: any) => String(r.table_name))
  );
  const baseToWorkers = new Map<string, number[]>();
  for (const base of allBaseNames) {
    const workers: number[] = [];
    for (let i = 0; i < numChunks; i++) {
      if (chunkTableSet.has(`chunk${i}_${base}`)) workers.push(i);
    }
    baseToWorkers.set(base, workers);
  }

  // 2. Classify tables: struct (has _id as first column) vs event
  const structTables: string[] = [];
  const eventTables: string[] = [];

  for (const base of allBaseNames) {
    const workers = baseToWorkers.get(base)!;
    const firstWorker = workers[0];
    const colsResult = await conn.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='main' AND table_name='chunk${firstWorker}_${base.replace(/'/g, "''")}' ORDER BY ordinal_position LIMIT 1`
    );
    const firstCol = colsResult.toArray()[0];
    if (firstCol && String((firstCol as any).column_name) === '_id') {
      structTables.push(base);
    } else {
      eventTables.push(base);
    }
  }

  // 3. For each struct table: deduplicate by natural key, build idmap
  for (const base of structTables) {
    const workers = baseToWorkers.get(base)!;
    const firstWorker = workers[0];
    const colsResult = await conn.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='main' AND table_name='chunk${firstWorker}_${base.replace(/'/g, "''")}' AND column_name != '_id' ORDER BY ordinal_position`
    );
    const naturalCols = colsResult.toArray().map((r: any) => `"${String((r as any).column_name)}"`);
    const naturalKey = naturalCols.join(', ');

    // Union only chunks that have this table
    const unionParts = workers.map((i) =>
      `SELECT ${i} AS _worker, * FROM "chunk${i}_${base}"`
    ).join(' UNION ALL ');

    await conn.query(
      `CREATE TEMP TABLE "_stage_${base}" AS ${unionParts}`
    ).catch((e) => console.warn(`merge stage failed for ${base}:`, e));

    await conn.query(
      `CREATE TEMP TABLE "_idmap_${base}" AS
       SELECT _worker, _id AS old_id,
         CASE WHEN _id = 0 THEN 0
              ELSE DENSE_RANK() OVER (ORDER BY ${naturalKey}) END AS new_id
       FROM "_stage_${base}"`
    ).catch((e) => console.warn(`merge idmap failed for ${base}:`, e));

    const selectCols = naturalCols.join(', ');
    await conn.query(
      `CREATE TABLE "${base}" AS
       SELECT DISTINCT m.new_id AS _id, ${selectCols}
       FROM "_stage_${base}" s
       JOIN "_idmap_${base}" m ON s._worker = m._worker AND s._id = m.old_id
       ORDER BY _id`
    ).catch((e) => console.warn(`merge create ${base} failed:`, e));
  }

  // 4. For event tables: UNION ALL from chunks that have the table, remapping FK columns.
  // DuckDB WASM doesn't support correlated subqueries in lambda/list_transform, so we
  // remap scalar FKs via a LEFT JOIN and array FKs via unnest+list_agg+JOIN.
  const refPattern = /Column "([^"]+)": (Array of references to|references) "([^"]+)"\(_id\)/g;

  for (const base of eventTables) {
    const workers = baseToWorkers.get(base)!;
    const firstWorker = workers[0];

    const commentResult = await conn.query(
      `SELECT comment FROM duckdb_tables() WHERE table_name='chunk${firstWorker}_${base.replace(/'/g, "''")}'`
    ).catch(() => null);
    const comment = commentResult?.toArray()[0] ? String((commentResult.toArray()[0] as any).comment ?? '') : '';

    const colRemap = new Map<string, { structTable: string; isArray: boolean }>();
    let m: RegExpExecArray | null;
    refPattern.lastIndex = 0;
    while ((m = refPattern.exec(comment)) !== null) {
      const colName = m[1];
      const isArray = m[2] === 'Array of references to';
      const structTable = m[3];
      if (structTables.includes(structTable)) {
        colRemap.set(colName, { structTable, isArray });
      }
    }

    const colsResult = await conn.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='main' AND table_name='chunk${firstWorker}_${base.replace(/'/g, "''")}' ORDER BY ordinal_position`
    );
    const allCols = colsResult.toArray().map((r: any) => String((r as any).column_name));

    // Separate scalar-FK and array-FK columns
    const arrayFkCols = allCols.filter(col => colRemap.get(col)?.isArray);
    const scalarFkCols = allCols.filter(col => colRemap.get(col) && !colRemap.get(col)!.isArray);

    if (arrayFkCols.length > 0) {
      // Array-FK remapping: for each chunk, expand arrays via unnest, join idmap, re-aggregate.
      // We build the final table chunk by chunk to avoid cross-chunk unnest complexity.
      const nonArrayCols = allCols.filter(c => !arrayFkCols.includes(c));

      // Create the table structure from the first chunk first
      const firstChunkCols = allCols.map(col => {
        const remap = colRemap.get(col);
        if (!remap) return `"${col}"`;
        if (remap.isArray) return `"${col}"`;
        return `coalesce(idmap_${col}.new_id, 0) AS "${col}"`;
      });

      // Build from first available chunk
      let created = false;
      for (const wi of workers) {
        const prefix = `chunk${wi}_`;
        // For scalar FKs use JOIN, for array FKs remap inline per-row using a CTE
        let sql: string;
        if (arrayFkCols.length === 0) {
          const joins = scalarFkCols.map(col => {
            const { structTable } = colRemap.get(col)!;
            return `LEFT JOIN "_idmap_${structTable}" AS idmap_${col} ON idmap_${col}._worker=${wi} AND idmap_${col}.old_id=e."${col}"`;
          }).join('\n');
          const selectExprs2 = allCols.map(col => {
            const remap = colRemap.get(col);
            if (!remap) return `e."${col}"`;
            return `coalesce(idmap_${col}.new_id, 0) AS "${col}"`;
          });
          sql = `SELECT ${selectExprs2.join(', ')} FROM "${prefix}${base}" e\n${joins}`;
        } else {
          // Use array_transform with idmap lookup via join on unnested values
          // Strategy: build a lookup list from idmap, then use list_transform with list indexing
          // Simpler: remap each array column via a subquery that builds a replacement array
          const selectExprs2 = allCols.map(col => {
            const remap = colRemap.get(col);
            if (!remap) return `e."${col}"`;
            const { structTable, isArray } = remap;
            if (!isArray) {
              return `coalesce(idmap_${col}.new_id, 0) AS "${col}"`;
            }
            // Array FK: use list_transform with a precomputed map
            // DuckDB supports list_transform with a non-correlated lambda
            // Build map as: map(old_ids, new_ids) from idmap filtered to this worker
            return `(SELECT list(m.new_id ORDER BY pos)
                     FROM (SELECT unnest(e."${col}") AS oid, generate_subscripts(e."${col}", 1) AS pos) t
                     JOIN "_idmap_${structTable}" m ON m._worker=${wi} AND m.old_id=t.oid
                    ) AS "${col}"`;
          });
          const scalarJoins = scalarFkCols.map(col => {
            const { structTable } = colRemap.get(col)!;
            return `LEFT JOIN "_idmap_${structTable}" AS idmap_${col} ON idmap_${col}._worker=${wi} AND idmap_${col}.old_id=e."${col}"`;
          }).join('\n');
          sql = `SELECT ${selectExprs2.join(', ')} FROM "${prefix}${base}" e\n${scalarJoins}`;
        }
        if (!created) {
          await conn.query(`CREATE TABLE "${base}" AS ${sql}`).catch((e) => console.warn(`merge event ${base} (w${wi}) create failed:`, e));
          created = true;
        } else {
          await conn.query(`INSERT INTO "${base}" ${sql}`).catch((e) => console.warn(`merge event ${base} (w${wi}) insert failed:`, e));
        }
      }
    } else {
      // No array FKs — simpler path with JOIN for scalar FKs
      const selectExprs = allCols.map(col => {
        const remap = colRemap.get(col);
        if (!remap) return `e."${col}"`;
        return `coalesce(idmap_${col}.new_id, 0) AS "${col}"`;
      });
      const joins = scalarFkCols.map(col => {
        const { structTable } = colRemap.get(col)!;
        return `LEFT JOIN "_idmap_${structTable}" AS idmap_${col} ON idmap_${col}._worker=e._w AND idmap_${col}.old_id=e."${col}"`;
      }).join('\n');

      const unionParts = workers.map((i) =>
        `SELECT ${i} AS _w, ${allCols.map(c => `"${c}"`).join(', ')} FROM "chunk${i}_${base}"`
      ).join(' UNION ALL ');

      const selectList = ['_w', ...selectExprs].join(', ');
      await conn.query(
        `CREATE TABLE "${base}" AS SELECT ${allCols.map(c => `"${c}"`).join(', ')} FROM (SELECT ${selectList} FROM (${unionParts}) e\n${joins})`
      ).catch((e) => console.warn(`merge event ${base} failed:`, e));
    }
  }

  // 5. Drop all chunk-prefixed and staging tables
  for (const base of allBaseNames) {
    const workers = baseToWorkers.get(base)!;
    for (const i of workers) {
      await conn.query(`DROP TABLE IF EXISTS "chunk${i}_${base}"`).catch(() => {});
    }
    await conn.query(`DROP TABLE IF EXISTS "_stage_${base}"`).catch(() => {});
    await conn.query(`DROP TABLE IF EXISTS "_idmap_${base}"`).catch(() => {});
  }
}

/**
 * Imports `jfrBytes` into the given DuckDB WASM connection via Web Workers.
 *
 * Multi-chunk JFR files (common for recordings >~5 MB) are parsed into their
 * constituent chunks and imported in parallel — one worker per chunk (up to
 * MAX_CHUNK_WORKERS). Struct tables (Method, Class, etc.) are deduplicated by
 * natural key and merged; event tables are union-appended with ID remapping.
 *
 * @param stacktraceDepth Max stack frames per event (default 10).
 * @param onProgress Optional callback (0–1) called at key checkpoints.
 */
export async function loadJfrIntoWasm(
  jfrBytes: Uint8Array,
  conn: AsyncDuckDBConnection,
  db: AsyncDuckDB,
  stacktraceDepth = 10,
  onProgress?: (pct: number) => void,
): Promise<void> {
  if (!(window as any).__arrow) {
    (window as any).__arrow = await import('apache-arrow');
  }

  onProgress?.(0.01);

  const storedMsPerByte = (() => {
    try { return parseFloat(localStorage.getItem(PERF_KEY) ?? '') || 0; } catch { return 0; }
  })();

  const jfrByteLength = jfrBytes.byteLength;

  // Parse chunk boundaries before any transfer (buffer stays valid here)
  const chunks = parseJfrChunks(jfrBytes);
  const numChunks = chunks.length;
  const useParallel = numChunks > 1;
  const numWorkers = Math.min(numChunks, MAX_CHUNK_WORKERS);

  console.log(`[jfr-import] ${numChunks} chunk(s), using up to ${numWorkers} parallel worker(s)`);

  const tJava0 = performance.now();
  let pendingInserts = 0;
  let peakPending = 0;

  // Pre-warm pool in parallel with chunk boundary parsing.
  // We need exactly numWorkers pooled entries.
  // getPrecompiledModule() was already called above; it may still be compiling — that's fine.
  const wasmModule = await getPrecompiledModule();
  const tWasmCompile = performance.now();
  console.log(`[jfr-perf] WASM compile: ${(tWasmCompile - tJava0).toFixed(0)}ms`);

  // Ensure pool has enough workers for this import.
  // Reuse existing idle workers; create new ones as needed — in parallel.
  const toCreate = numWorkers - workerPool.length;
  if (toCreate > 0) {
    const newWorkers = await Promise.all(
      Array.from({ length: toCreate }, () => createPooledWorker(db, wasmModule)),
    );
    workerPool.push(...newWorkers);
  }
  const tPoolReady = performance.now();
  console.log(`[jfr-perf] pool ready (${numWorkers} workers): ${(tPoolReady - tWasmCompile).toFixed(0)}ms`);

  if (!useParallel) {
    // Single-chunk: use pool worker 0 with empty prefix
    const pooled = workerPool[0];
    const buf = jfrBytes.buffer.byteLength === jfrBytes.byteLength ? jfrBytes.buffer : jfrBytes.slice().buffer;
    await dispatchToPooledWorker(
      pooled,
      new Uint8Array(buf),
      '',
      stacktraceDepth,
      () => { pendingInserts++; peakPending = Math.max(peakPending, pendingInserts); },
      () => { pendingInserts--; },
    );
  } else {
    // Multi-chunk parallel path: dispatch chunks to pool workers round-robin.
    // Process in batches of MAX_CHUNK_WORKERS; wait for each batch before advancing
    // so we don't enqueue more work than the pool has capacity for.
    let globalWorkerIdx = 0;
    for (let batchStart = 0; batchStart < chunks.length; batchStart += MAX_CHUNK_WORKERS) {
      const batchChunks = chunks.slice(batchStart, batchStart + MAX_CHUNK_WORKERS);

      const batchPromises = batchChunks.map((chunk, i) => {
        const workerIdx = globalWorkerIdx + i;
        const pooled = workerPool[i % workerPool.length];
        const slice = jfrBytes.slice(chunk.start, chunk.end);
        return dispatchToPooledWorker(
          pooled,
          slice,
          `chunk${workerIdx}_`,
          stacktraceDepth,
          () => { pendingInserts++; peakPending = Math.max(peakPending, pendingInserts); },
          () => { pendingInserts--; },
        );
      });

      await Promise.all(batchPromises);
      globalWorkerIdx += batchChunks.length;
    }
  }

  const tJavaDone = performance.now();
  const actualJavaMs = tJavaDone - tJava0;

  onProgress?.(0.75);

  // Drain: wait for all pending insertArrowTable calls to complete
  const tDrainStart = performance.now();
  while (pendingInserts > 0) {
    await new Promise(r => setTimeout(r, 10));
    if (peakPending > 0) {
      onProgress?.(0.75 + 0.10 * (1 - pendingInserts / peakPending));
    }
  }
  const tDrainDone = performance.now();

  onProgress?.(0.85);

  // Multi-chunk: merge prefixed tables into final tables
  let mergeMs = 0;
  if (useParallel) {
    const tMergeStart = performance.now();
    await mergeChunkTables(conn, numChunks);
    mergeMs = performance.now() - tMergeStart;
    console.log(`[jfr-perf] merge pass: ${mergeMs.toFixed(0)}ms`);
  }

  onProgress?.(0.90);

  console.log(`[jfr-perf] Java+drain: ${actualJavaMs.toFixed(0)}ms | drain: ${(tDrainDone - tDrainStart).toFixed(0)}ms | merge: ${mergeMs.toFixed(0)}ms`);
  (window as any).__lastJfrPerf = {
    javaSyncMs: actualJavaMs,
    drainMs: tDrainDone - tDrainStart,
    mergeMs,
    bytes: jfrByteLength,
    numChunks,
    numWorkers,
  };

  if (jfrByteLength > 0 && actualJavaMs > 500) {
    const observed = actualJavaMs / jfrByteLength;
    const updated = storedMsPerByte > 0 ? 0.7 * storedMsPerByte + 0.3 * observed : observed;
    try { localStorage.setItem(PERF_KEY, String(updated)); } catch { /* storage full */ }
  }

  // Register built-in macros and views in parallel across 4 connections
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
