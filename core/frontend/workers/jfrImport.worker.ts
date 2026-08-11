/**
 * Web Worker for JFR WASM import.
 *
 * Runs the GraalVM-compiled jfr-importer.js entirely off the main thread so the
 * UI stays responsive during the Java parsing phase on large files.
 *
 * The worker is long-lived and reusable: the WASM module is compiled once (either
 * pre-compiled by the main thread and posted as a WebAssembly.Module, or compiled
 * here on first use) and kept resident for subsequent imports.
 *
 * Protocol (main → worker):
 *   { type: 'init', wasmModule?: WebAssembly.Module }  — optional pre-compiled module
 *   { type: 'import', bytes: Uint8Array, stacktraceDepth: number, tablePrefix: string }
 *
 * Protocol (worker → main):
 *   { type: 'ready' }                                  — WASM loaded, ready for imports
 *   { type: 'query',  reqId: number, sql: string }
 *   { type: 'insert', reqId: number, tableName: string, ipcBytes: ArrayBuffer }
 *   { type: 'pending', delta: number }
 *   { type: 'done' }
 *   { type: 'error', message: string }
 *
 * Protocol (main → worker, replies):
 *   { type: 'query-result',  reqId: number, rows: Array<{name: string}> }
 *   { type: 'insert-result', reqId: number }
 */

declare global {
  interface WorkerGlobalScope {
    JFRImporter?: {
      importJfrIntoDuckDB(bytes: Uint8Array, conn: unknown, db: unknown, stacktraceDepth: number, tablePrefix: string): void;
    };
    CJFRImporter?: {
      importCjfrIntoDuckDB(bytes: Uint8Array, conn: unknown, db: unknown, tablePrefix: string): void;
    };
    _jfrCsvPending?: number;
    _jfrStacktraceDepth?: number;
    __arrow?: typeof import('apache-arrow');
    __jfrPendingValue?: number;
    __jfrWasmReady?: boolean;
  }
}

let reqIdCounter = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

// Initialization state — only load WASM once per worker lifetime
let wasmInitPromise: Promise<void> | null = null;

// Serialize concurrent 'import' messages — the import process uses shared
// module-level state (__jfrPendingValue counter, Object.defineProperty on
// _jfrCsvPending) that is not safe for concurrent calls.
let importQueue: Promise<void> = Promise.resolve();

self.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'query-result' || msg.type === 'insert-result') {
    const p = pending.get(msg.reqId);
    if (p) { pending.delete(msg.reqId); p.resolve(msg); }
    return;
  }

  if (msg.type === 'init') {
    // Pre-warm: load WASM now so it's ready before 'import' arrives.
    // Accept an optional pre-compiled WebAssembly.Module to skip compilation,
    // and an optional importerSrc string to skip the fetch of jfr-importer.js.
    wasmInitPromise = loadWasm(msg.wasmModule ?? null, msg.importerSrc ?? null);
    wasmInitPromise
      .then(() => self.postMessage({ type: 'ready' }))
      .catch(err => self.postMessage({ type: 'error', message: String(err) }));
    return;
  }

  if (msg.type === 'import') {
    const isCjfr = !!(msg.isCjfr as boolean);
    importQueue = importQueue.then(async () => {
      // For CJFR: accept either a pre-materialized Uint8Array (legacy) or a File
      // object (new path). Resolving the File inside the worker keeps the main thread
      // free of the 200MB+ arrayBuffer() allocation on large CJFR files.
      if (isCjfr) {
        let bytes: Uint8Array;
        if (msg.file) {
          bytes = new Uint8Array(await (msg.file as File).arrayBuffer());
        } else {
          bytes = msg.bytes as Uint8Array;
        }
        return handleCjfrImport(bytes, (msg.tablePrefix as string) ?? '');
      }
      return handleImport(msg.bytes as Uint8Array, msg.stacktraceDepth as number, (msg.tablePrefix as string) ?? '');
    }).catch(() => {});
  }
});

async function loadWasm(precompiledModule: WebAssembly.Module | null, importerSrc: string | null): Promise<void> {
  if ((self as any).__jfrWasmReady) return; // already loaded

  if (!(self as any).__arrow) {
    (self as any).__arrow = await import('apache-arrow');
  }

  await new Promise<void>((resolve, reject) => {
    const applyPatch = (src: string) => {
      // Patch GraalVM bootstrap:
      // 1. Override wasm_path so the loader finds the .wasm file by absolute URL.
      // 2. If a pre-compiled WebAssembly.Module was provided, inject it into the
      //    GraalVM config so it skips the compile step (~10× faster instantiation).
      let patch = 'const config = new GraalVM.Config(); config.wasm_path = "/wasm/jfr-importer.js.wasm";';
      if (precompiledModule) {
        (self as any).__jfrPrecompiledModule = precompiledModule;
        patch = `const config = new GraalVM.Config();
config.wasm_path = "/wasm/jfr-importer.js.wasm";
if (globalThis.__jfrPrecompiledModule) { try { config.wasm_module = globalThis.__jfrPrecompiledModule; } catch(_){} }`;
      }
      const patchedSrc = src.replace('const config = new GraalVM.Config();', patch);
      // eslint-disable-next-line no-eval
      (0, eval)(patchedSrc);
      resolve();
    };

    if (importerSrc) {
      // Source was pre-fetched by main thread — skip the network round-trip.
      try { applyPatch(importerSrc); } catch (e) { reject(e); }
    } else {
      fetch('/wasm/jfr-importer.js')
        .then(r => r.text())
        .then(applyPatch)
        .catch(reject);
    }
  });

  // Wait for JFRImporter global (CJFRImporter is registered in the same main() call)
  await new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const wait = () => {
      if ((self as any).JFRImporter) return resolve();
      if (Date.now() - start > 15_000) return reject(new Error('JFRImporter global never appeared'));
      setTimeout(wait, 50);
    };
    wait();
  });

  (self as any).__jfrWasmReady = true;
}

async function handleImport(bytes: Uint8Array, stacktraceDepth: number, tablePrefix = '') {
  try {
    // Ensure WASM is loaded (may already be in progress from 'init' message)
    if (!wasmInitPromise) {
      wasmInitPromise = loadWasm(null, null);
    }
    await wasmInitPromise;

    // Reset pending counter for this import
    (self as any).__jfrPendingValue = 0;

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
        const { tableToIPC } = (self as any).__arrow as typeof import('apache-arrow');
        const ipcBytes: Uint8Array = tableToIPC(arrowTable as any, 'stream');
        const reqId = ++reqIdCounter;
        const resultPromise = new Promise<unknown>((resolve, reject) => {
          pending.set(reqId, { resolve, reject });
        });
        const buf = ipcBytes.byteOffset === 0 && ipcBytes.byteLength === ipcBytes.buffer.byteLength
          ? ipcBytes.buffer
          : ipcBytes.slice().buffer;
        (self as unknown as Worker).postMessage(
          { type: 'insert', reqId, tableName: opts.name, ipcBytes: buf },
          [buf],
        );
        return resultPromise;
      },
    };
    const fakeDb = {};

    Object.defineProperty(self, '_jfrCsvPending', {
      get() { return (self as any).__jfrPendingValue ?? 0; },
      set(v: number) {
        const prev = (self as any).__jfrPendingValue ?? 0;
        (self as any).__jfrPendingValue = v;
        self.postMessage({ type: 'pending', delta: v - prev });
      },
      configurable: true,
    });

    (self as any).JFRImporter.importJfrIntoDuckDB(bytes, fakeConn, fakeDb, stacktraceDepth, tablePrefix);

    while (((self as any).__jfrPendingValue ?? 0) > 0) {
      await new Promise(r => setTimeout(r, 10));
    }

    self.postMessage({ type: 'done' });
  } catch (e: unknown) {
    self.postMessage({ type: 'error', message: String(e) });
  }
}

async function handleCjfrImport(bytes: Uint8Array, tablePrefix = '') {
  try {
    if (!wasmInitPromise) {
      wasmInitPromise = loadWasm(null, null);
    }
    await wasmInitPromise;

    (self as any).__jfrPendingValue = 0;

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
        const { tableToIPC } = (self as any).__arrow as typeof import('apache-arrow');
        const ipcBytes: Uint8Array = tableToIPC(arrowTable as any, 'stream');
        const reqId = ++reqIdCounter;
        const resultPromise = new Promise<unknown>((resolve, reject) => {
          pending.set(reqId, { resolve, reject });
        });
        const buf = ipcBytes.byteOffset === 0 && ipcBytes.byteLength === ipcBytes.buffer.byteLength
          ? ipcBytes.buffer
          : ipcBytes.slice().buffer;
        (self as unknown as Worker).postMessage(
          { type: 'insert', reqId, tableName: opts.name, ipcBytes: buf },
          [buf],
        );
        return resultPromise;
      },
    };
    const fakeDb = {};

    Object.defineProperty(self, '_jfrCsvPending', {
      get() { return (self as any).__jfrPendingValue ?? 0; },
      set(v: number) {
        const prev = (self as any).__jfrPendingValue ?? 0;
        (self as any).__jfrPendingValue = v;
        self.postMessage({ type: 'pending', delta: v - prev });
      },
      configurable: true,
    });

    (self as any).CJFRImporter.importCjfrIntoDuckDB(bytes, fakeConn, fakeDb, tablePrefix);

    while (((self as any).__jfrPendingValue ?? 0) > 0) {
      await new Promise(r => setTimeout(r, 10));
    }

    self.postMessage({ type: 'done' });
  } catch (e: unknown) {
    self.postMessage({ type: 'error', message: String(e) });
  }
}
