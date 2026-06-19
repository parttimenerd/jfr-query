import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';

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
      importJfrIntoDuckDB(bytes: Uint8Array, conn: unknown): void;
    };
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
 */
export async function loadJfrIntoWasm(jfrBytes: Uint8Array, conn: AsyncDuckDBConnection): Promise<void> {
  await loadJfrImporterScript();
  if (!window.JFRImporter) {
    throw new Error('JFRImporter global is missing after script load');
  }
  // The importer is synchronous from Java's perspective; offload to a microtask
  // so the UI gets a chance to repaint the "importing" state.
  await new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      try {
        window.JFRImporter!.importJfrIntoDuckDB(jfrBytes, conn);
        resolve();
      } catch (e) {
        reject(e);
      }
    }, 0);
  });
}
