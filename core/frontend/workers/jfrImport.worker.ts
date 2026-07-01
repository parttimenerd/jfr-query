/**
 * Web Worker for JFR WASM import.
 *
 * Runs the GraalVM-compiled jfr-importer.js entirely off the main thread so the
 * UI stays responsive during the 30-60 s Java parsing phase on large files.
 *
 * Protocol (main → worker):
 *   { type: 'import', bytes: Uint8Array, stacktraceDepth: number }
 *
 * Protocol (worker → main):
 *   { type: 'query',       reqId: number, sql: string }
 *   { type: 'insert',      reqId: number, tableName: string, ipcBytes: ArrayBuffer }
 *   { type: 'pending',     delta: number }   // +1 before async, -1 after
 *   { type: 'done' }
 *   { type: 'error',       message: string }
 *   { type: 'log',         message: string }
 *   { type: 'flushLog',    line: string }
 *
 * Protocol (main → worker, replies):
 *   { type: 'query-result',  reqId: number, rows: Array<{name: string}> }
 *   { type: 'insert-result', reqId: number }
 */

// Typed globals injected into this worker scope
declare global {
  interface WorkerGlobalScope {
    JFRImporter?: {
      importJfrIntoDuckDB(bytes: Uint8Array, conn: unknown, db: unknown, stacktraceDepth: number): void;
    };
    _jfrStagedBytes?: Uint8Array | null;
    _jfrCsvPending?: number;
    _jfrLog?: string[];
    _jfrFlushLog?: string[];
    _jfrStacktraceDepth?: number;
    __arrow?: typeof import('apache-arrow');
    __jfrPendingValue?: number;
  }
}

let reqIdCounter = 0;
// Pending reply promises: reqId → { resolve, reject }
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

// Reply handler: main thread sends query-result / insert-result messages back here
self.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'query-result' || msg.type === 'insert-result') {
    const p = pending.get(msg.reqId);
    if (p) {
      pending.delete(msg.reqId);
      p.resolve(msg);
    }
    return;
  }
  if (msg.type === 'import') {
    handleImport(msg.bytes as Uint8Array, msg.stacktraceDepth as number);
  }
});

async function handleImport(bytes: Uint8Array, stacktraceDepth: number) {
  try {
    // Load the GraalVM WASM bundle into this worker context.
    // In a module worker, importScripts() is unavailable, and self.location.href
    // points to the worker script (not /wasm/jfr-importer.js), so the WASM loader
    // would resolve jfr-importer.wasm from the wrong URL.
    //
    // Fix: fetch the JS source, inject a wasm_path override that intercepts
    // GraalVM.Config construction before the auto-run fires, then eval in worker scope.
    await new Promise<void>((resolve, reject) => {
      fetch('/wasm/jfr-importer.js')
        .then(r => r.text())
        .then(src => {
          // Inject config.wasm_path = '/wasm/jfr-importer.wasm' by monkey-patching
          // GraalVM.Config before the IIFE at the bottom calls new GraalVM.Config().
          // We replace the final bootstrap IIFE with a patched version.
          const patchedSrc = src.replace(
            'const config = new GraalVM.Config();',
            'const config = new GraalVM.Config(); config.wasm_path = "/wasm/jfr-importer.js.wasm";',
          );
          // Use indirect eval so it runs in the global (worker) scope.
          // eslint-disable-next-line no-eval
          (0, eval)(patchedSrc);
          resolve();
        })
        .catch(reject);
    });

    // Wait for JFRImporter global (same polling logic as main-thread loader).
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const wait = () => {
        if ((self as any).JFRImporter) return resolve();
        if (Date.now() - start > 10_000) return reject(new Error('JFRImporter global never appeared'));
        setTimeout(wait, 50);
      };
      wait();
    });

    // Stage Arrow module so BinaryAppender's @JS code can use it.
    if (!(self as any).__arrow) {
      (self as any).__arrow = await import('apache-arrow');
    }

    // Reset pending counter
    (self as any)._jfrCsvPending = 0;

    // Build the fake conn and db objects.
    // BinaryAppender's @JS template uses:
    //   conn.query(sql)                                  — DDL only, return ignored
    //   conn.insertArrowTable(arrowTable, {name, create}) — transfer Arrow IPC to main
    // JsDuckDBSink uses:
    //   conn.query(sql)                                  — same
    // db is passed to BinaryAppender constructor but never called in current code.
    const fakeConn = {
      query(sql: string) {
        const reqId = ++reqIdCounter;
        const resultPromise = new Promise<unknown>((resolve, reject) => {
          pending.set(reqId, { resolve, reject });
        });
        self.postMessage({ type: 'query', reqId, sql });
        return resultPromise;
      },
      async insertArrowTable(arrowTable: unknown, opts: { name: string; create: boolean }) {
        // Serialise the Arrow table to IPC stream bytes and transfer zero-copy.
        const { tableToIPC } = (self as any).__arrow as typeof import('apache-arrow');
        const ipcBytes: Uint8Array = tableToIPC(arrowTable as any, 'stream');
        const reqId = ++reqIdCounter;
        const resultPromise = new Promise<unknown>((resolve, reject) => {
          pending.set(reqId, { resolve, reject });
        });
        // Transfer the underlying ArrayBuffer — zero-copy, main gets ownership.
        (self as unknown as Worker).postMessage(
          { type: 'insert', reqId, tableName: opts.name, ipcBytes: ipcBytes.buffer },
          [ipcBytes.buffer],
        );
        return resultPromise;
      },
    };
    const fakeDb = {}; // db is never actually called in BinaryAppender

    // Override loadColumnarData's globalThis._jfrCsvPending tracking so it matches
    // what the main thread drains. We intercept the pending counter changes by
    // monkey-patching the global the @JS template writes to.
    Object.defineProperty(self, '_jfrCsvPending', {
      get() { return (self as any).__jfrPendingValue ?? 0; },
      set(v: number) {
        const prev = (self as any).__jfrPendingValue ?? 0;
        (self as any).__jfrPendingValue = v;
        self.postMessage({ type: 'pending', delta: v - prev });
      },
      configurable: true,
    });

    // The Java WASM call — blocks this worker thread for the full parse duration.
    // Main thread stays responsive throughout.
    (self as any).JFRImporter.importJfrIntoDuckDB(bytes, fakeConn, fakeDb, stacktraceDepth);

    // Drain: wait for all insertArrowTable round-trips to complete.
    while (((self as any).__jfrPendingValue ?? 0) > 0) {
      await new Promise(r => setTimeout(r, 10));
    }

    self.postMessage({ type: 'done' });
  } catch (e: unknown) {
    self.postMessage({ type: 'error', message: String(e) });
  }
}
