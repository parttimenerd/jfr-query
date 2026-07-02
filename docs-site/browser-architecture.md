# Browser Architecture

The web app runs in two modes depending on how it was launched:

| Mode | When | Where queries run |
|------|------|-------------------|
| **Server mode** | Started with `java -jar query.jar serve` | Java backend (DuckDB via JDBC) |
| **Standalone mode** | Opened directly (GitHub Pages, file drop) | In-browser via DuckDB WASM |

The UI detects which mode is active by probing `/api/query` on startup. If the endpoint
responds, server mode is used; otherwise it falls back to WASM. From the notebook's perspective
the two modes are identical — the same SQL runs, the same results come back.

## Server mode

In server mode the backend:

1. Imports the JFR file into an in-memory DuckDB database using the Java importer (see
   [JFR to DuckDB Mapping](jfr-to-duckdb.md)).
2. Registers all built-in views and macros.
3. Exposes a `POST /api/query` endpoint that accepts a JSON body `{"sql": "..."}` and returns
   a JSON array of row objects.

The frontend holds no database state — it sends every SQL string over HTTP and displays the
JSON response. Unlimited result sizes, no WASM overhead.

## Standalone / WASM mode

When there is no backend, the entire pipeline runs inside the browser:

```
JFR file (File API)
       │
       ▼
  Chunk splitter          ← reads only 16-byte headers to find chunk boundaries
       │
   ┌───┴──────────────────────┐
   │  Worker 1 (GraalVM WASM) │   ← runs jfr-importer.js compiled from Java
   │  Worker 2 (GraalVM WASM) │   ← parallel chunk parsing
   └───┬──────────────────────┘
       │  Arrow IPC (transferable ArrayBuffer)
       ▼
  DuckDB WASM             ← @duckdb/duckdb-wasm in main thread
       │
       ▼
  SQL query results
```

### GraalVM WebAssembly: running Java in the browser

The JFR importer is compiled from Java to WebAssembly using **GraalVM native-image**. The
result is a pair of files served at `/wasm/`:

- `jfr-importer.js` — GraalVM bootstrap JavaScript (~1 MB)
- `jfr-importer.js.wasm` — the compiled WebAssembly binary (~15 MB)

When a worker loads these files it gets a `JFRImporter` global with a single entry point:

```javascript
JFRImporter.importJfrIntoDuckDB(
  bytes,          // Uint8Array — raw bytes of one JFR chunk
  fakeConn,       // object implementing query() and insertArrowTable()
  fakeDb,         // unused placeholder
  stacktraceDepth,
  tablePrefix,    // e.g. "chunk3_" for parallel merge
)
```

The importer calls `fakeConn.insertArrowTable()` to send batches of rows to DuckDB. Rather
than serialising through JSON, it uses the [Apache Arrow](https://arrow.apache.org/) IPC
stream format: the worker serialises an Arrow table to a binary buffer and posts it to the
main thread as a **transferable** `ArrayBuffer` (zero-copy), which the main thread loads into
DuckDB WASM with `insertArrowFromIPCStream()`.

### DuckDB WASM

The browser-side database is [`@duckdb/duckdb-wasm`](https://duckdb.org/docs/api/wasm/overview).
It runs in a dedicated Web Worker and communicates via a small async RPC layer. Initialisation
happens eagerly in the background so the database is ready by the time the user drops a file.

Because DuckDB WASM uses **pthreads** (shared memory multi-threading) for its internal query
parallelism, the page must be served with two HTTP headers:

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy:   same-origin
```

These enable `SharedArrayBuffer`, which pthreads depend on. The `serve` command sets these
headers automatically; the GitHub Pages deployment uses a
[`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker) polyfill to inject them
at the service-worker layer.

### Chunk-parallel parsing

A JFR file is a sequence of self-contained **chunks** (typically one per second of recording).
Each chunk starts with the magic bytes `FLR\0` followed by the chunk size as a big-endian
64-bit integer at offset 8. The splitter reads only these 16-byte headers to locate every
chunk boundary without loading the whole file into memory.

Chunks are then processed in parallel across 2–3 Web Workers (the exact count depends on
`navigator.deviceMemory`, since each GraalVM worker allocates 300–600 MB of linear memory).
Each worker writes its results to tables prefixed with its chunk index (e.g. `chunk0_Method`,
`chunk1_Method`), which are merged into the final tables after all workers finish.

### Merge and deduplication

Referenced structs (e.g. `Method`, `Class`) appear in every chunk that references them, so
the same method can arrive from multiple workers with different local IDs. The merge pass:

1. Collects all `chunkN_<table>` tables discovered in the database.
2. For each struct table, computes a `DENSE_RANK()` over the natural key (the set of
   non-`_id` columns) to assign globally unique IDs and builds an `_idmap` table.
3. Rewrites all foreign-key columns in the event tables using the `_idmap`.
4. Drops the chunk-prefixed staging tables.

This runs across 4 parallel DuckDB connections to amortise the latency of the remapping
queries.

### Backpressure and memory management

Without flow control, a fast Java parser can queue hundreds of Arrow buffers faster than
DuckDB WASM can drain them, exhausting the browser's memory. An `InsertSemaphore` limits
concurrent in-flight `insertArrowTable` calls to 4 across all workers. When the semaphore is
full, the worker blocks until DuckDB finishes a prior insert.

Worker memory (the GraalVM linear memory) is released as soon as the parse phase completes —
well before the merge pass begins — to keep peak RSS within browser limits.

### WASM pre-compilation

Compiling a 15 MB `.wasm` binary inside a Web Worker takes 5–8 seconds the first time. To
avoid paying this cost for each parallel worker:

1. The main thread calls `WebAssembly.compileStreaming()` as soon as the page loads, in the
   background.
2. The compiled `WebAssembly.Module` object is **transferable** and can be `postMessage`d to
   workers at zero cost.
3. Each worker receives the pre-compiled module and skips its own compilation step, reducing
   worker startup from ~8 s to ~300 ms.

Similarly, the 1 MB `jfr-importer.js` bootstrap script is fetched once on the main thread and
its text is forwarded to all workers, saving N redundant network round-trips.

### Result extraction

Query results from DuckDB WASM arrive as Arrow record batches. The frontend reads each column
as a typed array (avoiding the slow per-row `toJSON()` path) and weaves the columns back into
row objects. Special handling:

- **Decimal128 columns** — divided by `10^scale` from the Arrow schema to produce a JavaScript
  number.
- **BigInt values** — preserved as strings when they exceed `Number.MAX_SAFE_INTEGER` to avoid
  precision loss.
- **Row limit** — WASM queries are capped at 50 000 rows by default to prevent OOM on large
  result sets. Append `-- no-limit` to the SQL to bypass this.

## See also

- [JFR to DuckDB Mapping](jfr-to-duckdb.md) — how JFR events become tables
- [Getting Started](getting-started.md) — how to run the tool
- [CLI Commands](cli.md) — `serve` flags including `--port` and `--no-open`
