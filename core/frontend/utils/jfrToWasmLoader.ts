import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { tableFromIPC } from 'apache-arrow';
import { BUILTIN_MACROS_SQL, BUILTIN_VIEWS_SQL } from '../data/builtinSql';

const PERF_KEY = 'jfr_import_ms_per_byte';

// Determine maximum workers based on available device memory.
// Each worker allocates a GraalVM WebAssembly linear memory that grows with
// chunk size — typically 300–600 MB per worker for real JFR files.
// Browser renderer processes are capped at ~1–2 GB total (OS sandbox), so
// 3 workers risk OOM on larger files. Cap at 2 workers as the safe default;
// allow 3 only on machines with ≥16 GB where the OS may grant a larger cap.
// Override via URL: ?maxWorkers=N
function getMaxWorkers(): number {
  const override = new URLSearchParams(location.search).get('maxWorkers');
  if (override) return Math.max(1, Math.min(4, parseInt(override, 10)));
  const mem = (navigator as any).deviceMemory as number | undefined;
  if (mem !== undefined && mem >= 16) return 3;
  return 2;
}

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

/**
 * Semaphore that limits concurrent insertArrowTable calls across all workers.
 * Without backpressure, fire-and-forget inserts for a 200+ chunk file accumulate
 * all in-flight Arrow IPC buffers simultaneously, causing OOM crashes.
 */
class InsertSemaphore {
  private slots: number;
  private queue: Array<() => void> = [];

  constructor(concurrency: number) { this.slots = concurrency; }

  async acquire(): Promise<void> {
    if (this.slots > 0) { this.slots--; return; }
    await new Promise<void>(resolve => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) { next(); } else { this.slots++; }
  }
}

// Shared across all workers for this import session; re-created per import.
let insertSemaphore = new InsertSemaphore(4);

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
 * Returns a Promise that resolves when the WASM parse phase is done (all
 * `insert` messages have been *sent back* — not necessarily flushed to DuckDB).
 * Each insert acquires a semaphore slot before calling insertArrowTable and
 * releases it in .finally() — this bounds concurrent in-flight Arrow buffers.
 *
 * Returns the array of in-flight insert Promises so the caller can drain them
 * before starting the next batch (per-batch drain = bounded peak memory).
 */
async function dispatchToPooledWorker(
  pooled: PooledWorker,
  slice: Uint8Array,
  tablePrefix: string,
  stacktraceDepth: number,
  onChunkDone?: () => void,
): Promise<Promise<void>[]> {
  pooled.busy = true;
  const insertPromises: Promise<void>[] = [];
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
          const p = insertSemaphore.acquire().then(() =>
            conn.insertArrowTable(
              tableFromIPC(new Uint8Array(msg.ipcBytes as ArrayBuffer)),
              { name: msg.tableName as string, create: false },
            ).catch((err) => console.warn(`[jfr-worker ${tablePrefix}] insert failed for`, msg.tableName, err))
              .finally(() => insertSemaphore.release())
          );
          insertPromises.push(p);
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
    onChunkDone?.();
  }
  return insertPromises;
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
 *
 * Phases 3 (struct) and 4 (event) each run their per-table work in parallel
 * using up to MERGE_PARALLELISM DuckDB connections. Phase 3 fully completes
 * before phase 4 starts because event tables reference the _idmap tables
 * produced in phase 3.
 */
async function mergeChunkTables(
  conn: AsyncDuckDBConnection,
  db: AsyncDuckDB,
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

  // Open MERGE_PARALLELISM-1 extra connections for parallel merge queries.
  // All extra connections are closed in the finally block regardless of errors.
  const MERGE_PARALLELISM = 4;
  const extraConns: AsyncDuckDBConnection[] = [];
  try {
    for (let i = 0; i < MERGE_PARALLELISM - 1; i++) {
      extraConns.push(await db.connect());
    }
    const allConns = [conn, ...extraConns];
    const getConn = (i: number) => allConns[i % allConns.length];

    // 3. Struct tables in parallel (each table's 3 queries stay sequential within that table).
    await Promise.all(structTables.map(async (base, idx) => {
      const c = getConn(idx);
      const workers = baseToWorkers.get(base)!;
      const firstWorker = workers[0];
      const colsResult = await c.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='main' AND table_name='chunk${firstWorker}_${base.replace(/'/g, "''")}' AND column_name != '_id' ORDER BY ordinal_position`
      );
      const naturalCols = colsResult.toArray().map((r: any) => `"${String((r as any).column_name)}"`);
      const naturalKey = naturalCols.join(', ');

      // Union only chunks that have this table
      const unionParts = workers.map((i) =>
        `SELECT ${i} AS _worker, * FROM "chunk${i}_${base}"`
      ).join(' UNION ALL ');

      await c.query(
        `CREATE TEMP TABLE "_stage_${base}" AS ${unionParts}`
      ).catch((e) => console.warn(`merge stage failed for ${base}:`, e));

      await c.query(
        `CREATE TEMP TABLE "_idmap_${base}" AS
         SELECT _worker, _id AS old_id,
           CASE WHEN _id = 0 THEN 0
                ELSE DENSE_RANK() OVER (ORDER BY ${naturalKey}) END AS new_id
         FROM "_stage_${base}"`
      ).catch((e) => console.warn(`merge idmap failed for ${base}:`, e));

      const selectCols = naturalCols.join(', ');
      await c.query(
        `CREATE TABLE "${base}" AS
         SELECT DISTINCT m.new_id AS _id, ${selectCols}
         FROM "_stage_${base}" s
         JOIN "_idmap_${base}" m ON s._worker = m._worker AND s._id = m.old_id
         ORDER BY _id`
      ).catch((e) => console.warn(`merge create ${base} failed:`, e));
    }));

    // 4. Event tables in parallel — runs only after all struct tables are done
    // (event tables reference _idmap tables produced in step 3).
    // DuckDB WASM doesn't support correlated subqueries in lambda/list_transform, so we
    // remap scalar FKs via a LEFT JOIN and array FKs via unnest+list_agg+JOIN.
    const refPattern = /Column "([^"]+)": (Array of references to|references) "([^"]+)"\(_id\)/g;

    await Promise.all(eventTables.map(async (base, idx) => {
      const c = getConn(idx);
      const workers = baseToWorkers.get(base)!;
      const firstWorker = workers[0];

      const commentResult = await c.query(
        `SELECT comment FROM duckdb_tables() WHERE table_name='chunk${firstWorker}_${base.replace(/'/g, "''")}'`
      ).catch(() => null);
      const comment = commentResult?.toArray()[0] ? String((commentResult.toArray()[0] as any).comment ?? '') : '';

      const colRemap = new Map<string, { structTable: string; isArray: boolean }>();
      let m: RegExpExecArray | null;
      // Each async task gets its own regex instance to avoid shared lastIndex state.
      const localRefPattern = /Column "([^"]+)": (Array of references to|references) "([^"]+)"\(_id\)/g;
      while ((m = localRefPattern.exec(comment)) !== null) {
        const colName = m[1];
        const isArray = m[2] === 'Array of references to';
        const structTable = m[3];
        if (structTables.includes(structTable)) {
          colRemap.set(colName, { structTable, isArray });
        }
      }

      const colsResult = await c.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='main' AND table_name='chunk${firstWorker}_${base.replace(/'/g, "''")}' ORDER BY ordinal_position`
      );
      const allCols = colsResult.toArray().map((r: any) => String((r as any).column_name));

      // Separate scalar-FK and array-FK columns
      const arrayFkCols = allCols.filter(col => colRemap.get(col)?.isArray);
      const scalarFkCols = allCols.filter(col => colRemap.get(col) && !colRemap.get(col)!.isArray);

      if (arrayFkCols.length > 0) {
        // Array-FK remapping: for each chunk, expand arrays via unnest, join idmap, re-aggregate.
        // We build the final table chunk by chunk to avoid cross-chunk unnest complexity.

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
            await c.query(`CREATE TABLE "${base}" AS ${sql}`).catch((e) => console.warn(`merge event ${base} (w${wi}) create failed:`, e));
            created = true;
          } else {
            await c.query(`INSERT INTO "${base}" ${sql}`).catch((e) => console.warn(`merge event ${base} (w${wi}) insert failed:`, e));
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
          `SELECT ${i} AS _w, ${allCols.map(col => `"${col}"`).join(', ')} FROM "chunk${i}_${base}"`
        ).join(' UNION ALL ');

        const selectList = ['_w', ...selectExprs].join(', ');
        await c.query(
          `CREATE TABLE "${base}" AS SELECT ${allCols.map(col => `"${col}"`).join(', ')} FROM (SELECT ${selectList} FROM (${unionParts}) e\n${joins})`
        ).catch((e) => console.warn(`merge event ${base} failed:`, e));
      }
    }));

  } finally {
    for (const c of extraConns) c.close().catch(() => {});
  }

  // 5. Drop all chunk-prefixed and staging tables in parallel
  await Promise.all(allBaseNames.map(async (base) => {
    const workers = baseToWorkers.get(base)!;
    await Promise.all([
      ...workers.map(i => conn.query(`DROP TABLE IF EXISTS "chunk${i}_${base}"`).catch(() => {})),
      conn.query(`DROP TABLE IF EXISTS "_stage_${base}"`).catch(() => {}),
      conn.query(`DROP TABLE IF EXISTS "_idmap_${base}"`).catch(() => {}),
    ]);
  }));
}

/**
 * Imports `jfrBytes` into the given DuckDB WASM connection via Web Workers.
 *
 * Multi-chunk JFR files (common for recordings >~5 MB) are parsed into their
 * constituent chunks and imported in parallel — one worker per chunk (up to
 * the max returned by getMaxWorkers()). Struct tables (Method, Class, etc.) are deduplicated by
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
  const maxWorkers = getMaxWorkers();
  const numWorkers = Math.min(numChunks, maxWorkers);

  console.log(`[jfr-import] ${numChunks} chunk(s), using up to ${numWorkers} parallel worker(s)`);

  // Reset semaphore for this import session.
  insertSemaphore = new InsertSemaphore(4);

  // Progress phases:
  //   0–5%:  initialization / pool warm
  //   5–70%: Java parse (each completed chunk advances evenly)
  //   70–85%: drain remaining inserts
  //   85–95%: merge pass
  //   95–100%: SQL registration
  let chunksCompleted = 0;
  const parseProgressPerChunk = 0.65 / numChunks;
  const reportParseProgress = () => {
    chunksCompleted++;
    onProgress?.(0.05 + chunksCompleted * parseProgressPerChunk);
  };

  onProgress?.(0.01);

  const tJava0 = performance.now();

  // Pre-warm pool in parallel with chunk boundary parsing.
  const wasmModule = await getPrecompiledModule();
  const tWasmCompile = performance.now();
  console.log(`[jfr-perf] WASM compile: ${(tWasmCompile - tJava0).toFixed(0)}ms`);

  onProgress?.(0.03);

  // For single-chunk files, warm a persistent pool worker (reused across re-imports).
  // For multi-chunk files, workers are created fresh per-batch (see below).
  if (!useParallel) {
    const toCreate = 1 - workerPool.length;
    if (toCreate > 0) {
      const newWorkers = await Promise.all(
        Array.from({ length: toCreate }, () => createPooledWorker(db, wasmModule)),
      );
      workerPool.push(...newWorkers);
    }
  }
  const tPoolReady = performance.now();
  console.log(`[jfr-perf] pool ready: ${(tPoolReady - tWasmCompile).toFixed(0)}ms`);

  onProgress?.(0.05);

  // All insert promises collected across all batches, for final drain accounting.
  let allInsertPromises: Promise<void>[] = [];

  if (!useParallel) {
    // Single-chunk path — reuse persistent pool worker
    const pooled = workerPool[0];
    const buf = jfrBytes.buffer.byteLength === jfrBytes.byteLength ? jfrBytes.buffer : jfrBytes.slice().buffer;
    const insertPs = await dispatchToPooledWorker(pooled, new Uint8Array(buf), '', stacktraceDepth, reportParseProgress);
    allInsertPromises = insertPs;
    await Promise.all(insertPs);
  } else {
    // Multi-chunk parallel path.
    //
    // Workers are EPHEMERAL: created fresh for each batch and terminated after
    // the batch drains. This releases the GraalVM WASM linear memory (~300–600 MB
    // per worker) between batches, preventing the renderer process OOM that
    // occurs when all workers stay alive for the full duration of a large import.
    //
    // WASM compilation cost is paid once at module load (getPrecompiledModule()),
    // so recreation only costs ~300 ms for WASM instantiation — acceptable vs
    // the memory savings for large files (18 chunks × 13 MB = 242 MB).
    let globalWorkerIdx = 0;
    for (let batchStart = 0; batchStart < chunks.length; batchStart += maxWorkers) {
      const batchChunks = chunks.slice(batchStart, batchStart + maxWorkers);

      // Spin up fresh workers for this batch in parallel
      const tBatchStart = performance.now();
      const batchWorkers = await Promise.all(
        batchChunks.map(() => createPooledWorker(db, wasmModule)),
      );

      // Parse chunks in parallel, collect insert-promise arrays.
      // Terminate workers immediately when parse finishes — this releases the
      // GraalVM WASM linear memory (300–600 MB per worker) before we drain inserts.
      const batchInsertArrays = await Promise.all(
        batchChunks.map((chunk, i) => {
          const workerIdx = globalWorkerIdx + i;
          const slice = jfrBytes.slice(chunk.start, chunk.end);
          return dispatchToPooledWorker(batchWorkers[i], slice, `chunk${workerIdx}_`, stacktraceDepth, reportParseProgress);
        }),
      ).finally(() => {
        batchWorkers.forEach(pw => pw.worker.terminate());
      });

      // Drain inserts (Arrow IPC → DuckDB) for this batch before allocating the next.
      const batchInserts = batchInsertArrays.flat();
      allInsertPromises.push(...batchInserts);
      await Promise.all(batchInserts);

      // Close DuckDB connections from this batch (no longer needed).
      await Promise.all(batchWorkers.map(pw => pw.conn.close().catch(() => {})));

      const batchIdx = batchStart / maxWorkers;
      console.log(`[jfr-perf] batch ${batchIdx + 1}/${Math.ceil(chunks.length / maxWorkers)}: ${(performance.now() - tBatchStart).toFixed(0)}ms`);
      globalWorkerIdx += batchChunks.length;
    }
  }

  const tJavaDone = performance.now();
  const actualJavaMs = tJavaDone - tJava0;

  onProgress?.(0.70);

  // Final drain: wait for any remaining inserts (single-chunk path already drained,
  // parallel path drained per-batch — this is a safety net).
  const tDrainStart = performance.now();
  await Promise.all(allInsertPromises);
  const tDrainDone = performance.now();

  onProgress?.(0.85);

  // Multi-chunk: merge prefixed tables into final tables
  let mergeMs = 0;
  if (useParallel) {
    const tMergeStart = performance.now();
    await mergeChunkTables(conn, db, numChunks);
    mergeMs = performance.now() - tMergeStart;
    console.log(`[jfr-perf] merge pass: ${mergeMs.toFixed(0)}ms`);
  }

  onProgress?.(0.95);

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
  onProgress?.(1.0);
  (window as any).__lastJfrPerf = {
    ...(window as any).__lastJfrPerf,
    sqlRegMs: sqlMs,
    sqlParallelism: PARALLELISM,
  };
}
