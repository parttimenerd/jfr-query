import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { parseGcErgoLog } from './gcErgoLogParser';

/**
 * Parse a gc+ergo Xlog text file and insert it into the DuckDB connection as
 * table "GCErgoLog" with columns:
 *   uptime_s DOUBLE, level VARCHAR, tag VARCHAR, gc_id INTEGER, message VARCHAR
 *
 * Existing "GCErgoLog" table is dropped and recreated.
 */
export async function loadGcErgoLogIntoWasm(
  source: File | string,
  conn: AsyncDuckDBConnection,
): Promise<number> {
  const text = typeof source === 'string' ? source : await source.text();
  const rows = parseGcErgoLog(text);

  await conn.query(`DROP TABLE IF EXISTS GCErgoLog`);
  await conn.query(`
    CREATE TABLE GCErgoLog (
      uptime_s DOUBLE,
      level    VARCHAR,
      tag      VARCHAR,
      gc_id    INTEGER,
      message  VARCHAR
    )
  `);

  if (rows.length === 0) return 0;

  // Batch insert via VALUES to avoid N round-trips.
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const vals = chunk
      .map(r => {
        const uptime = r.uptime_s;
        const level = sqlStr(r.level);
        const tag = sqlStr(r.tag);
        const gcId = r.gc_id == null ? 'NULL' : String(r.gc_id);
        const msg = sqlStr(r.message);
        return `(${uptime}, ${level}, ${tag}, ${gcId}, ${msg})`;
      })
      .join(',\n');
    await conn.query(`INSERT INTO GCErgoLog VALUES ${vals}`);
  }

  return rows.length;
}

function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
