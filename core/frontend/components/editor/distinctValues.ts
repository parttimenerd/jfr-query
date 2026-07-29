/**
 * Cache for distinct-value lookups used by the WHERE-clause value completion.
 *
 * Trigger: when the user types `col = '` or `col IN ('...`, we kick off a
 * `SELECT DISTINCT col FROM tbl LIMIT 50` and stash the result. The current
 * keystroke can't await — it returns no suggestions — but the next keystroke
 * reads the cache synchronously and offers the values.
 */

import type { SchemaForCompletion } from './completions';

const CACHE_LIMIT = 100;
const MAX_VALUES = 50;
/** Skip columns whose distinct-set is huge. We never run the query for these types. */
const HIGH_CARDINALITY_TYPES = new Set([
  'TIMESTAMP', 'TIMESTAMP_NS', 'TIMESTAMP_MS', 'TIMESTAMP_S', 'TIMESTAMPTZ',
  'DATE', 'TIME', 'INTERVAL',
  'BIGINT', 'HUGEINT', 'UBIGINT',
  'DOUBLE', 'FLOAT', 'REAL', 'DECIMAL',
  'BLOB', 'JSON',
]);

export type DistinctValuesRunner = (sql: string) => Promise<any[]>;

type CacheEntry =
  | { state: 'pending'; promise: Promise<void> }
  | { state: 'ready'; values: string[] }
  | { state: 'error' };

const cache = new Map<string, CacheEntry>();
const inflight = new Set<string>();

function unquoteIdent(s: string): string {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

function cacheKey(table: string, column: string): string {
  return `${unquoteIdent(table).toLowerCase()}::${unquoteIdent(column).toLowerCase()}`;
}

function evict() {
  while (cache.size > CACHE_LIMIT) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
}

function findColumn(
  schema: SchemaForCompletion,
  table: string,
  column: string,
): { type: string; tableName: string; columnName: string } | null {
  const tlc = unquoteIdent(table).toLowerCase();
  const clc = unquoteIdent(column).toLowerCase();
  const tbl = schema.tableMap.get(tlc);
  if (tbl) {
    const col = tbl.columns.find(c => c.name.toLowerCase() === clc);
    if (col) return { type: col.type, tableName: tbl.name, columnName: col.name };
  }
  const vw = schema.viewMap.get(tlc);
  if (vw) {
    const col = vw.columns.find(c => c.name.toLowerCase() === clc);
    if (col) return { type: col.type, tableName: vw.name, columnName: col.name };
  }
  return null;
}

/**
 * Find a (table, column, type) triple given a column name and a set of
 * candidate table names. Falls back to scanning all tables when none match.
 */
function resolveColumn(
  schema: SchemaForCompletion,
  column: string,
  candidates: Set<string>,
): { type: string; tableName: string; columnName: string } | null {
  const clc = unquoteIdent(column).toLowerCase();
  for (const t of candidates) {
    const tbl = schema.tableMap.get(t);
    if (tbl) {
      const col = tbl.columns.find(c => c.name.toLowerCase() === clc);
      if (col) return { type: col.type, tableName: tbl.name, columnName: col.name };
    }
    const vw = schema.viewMap.get(t);
    if (vw) {
      const col = vw.columns.find(c => c.name.toLowerCase() === clc);
      if (col) return { type: col.type, tableName: vw.name, columnName: col.name };
    }
  }
  return null;
}

export function isHighCardinality(type: string): boolean {
  const upper = type.toUpperCase();
  for (const bad of HIGH_CARDINALITY_TYPES) {
    if (upper.includes(bad)) return true;
  }
  return false;
}

export function getCachedValues(table: string, column: string): string[] | null {
  const entry = cache.get(cacheKey(table, column));
  if (!entry) return null;
  if (entry.state === 'ready') return entry.values;
  return null;
}

/**
 * Kick off a lookup if we haven't already. Returns synchronously — the result
 * lands in the cache and shows up on the user's next keystroke.
 */
export function requestDistinctValues(
  runner: DistinctValuesRunner,
  schema: SchemaForCompletion,
  table: string | null,
  column: string,
  referenced: Set<string>,
): void {
  let resolved: { tableName: string; columnName: string; type: string } | null = null;
  if (table) {
    const r = findColumn(schema, table, column);
    if (r) resolved = { tableName: r.tableName, columnName: r.columnName, type: r.type };
  } else {
    resolved = resolveColumn(schema, column, referenced);
  }
  if (!resolved) return;
  if (isHighCardinality(resolved.type)) return;

  const key = cacheKey(resolved.tableName, resolved.columnName);
  if (cache.has(key) || inflight.has(key)) return;
  inflight.add(key);

  const safeTable = resolved.tableName.replace(/"/g, '""');
  const safeCol = resolved.columnName.replace(/"/g, '""');
  const sql = `SELECT DISTINCT "${safeCol}" AS v FROM "${safeTable}" WHERE "${safeCol}" IS NOT NULL LIMIT ${MAX_VALUES};`;

  const promise = runner(sql)
    .then(rows => {
      const values = rows
        .map(r => (r.v == null ? null : String(r.v)))
        .filter((v): v is string => v != null && v.length < 200);
      cache.set(key, { state: 'ready', values });
      evict();
    })
    .catch(() => {
      cache.set(key, { state: 'error' });
      evict();
    })
    .finally(() => {
      inflight.delete(key);
    });

  cache.set(key, { state: 'pending', promise });
}

/** Resolve a column under the current referenced-tables set (case-insensitive). */
export function lookupCachedValues(
  schema: SchemaForCompletion,
  table: string | null,
  column: string,
  referenced: Set<string>,
): string[] | null {
  let tname: string | null = null;
  if (table) {
    const r = findColumn(schema, table, column);
    if (r) tname = r.tableName;
  } else {
    const r = resolveColumn(schema, column, referenced);
    if (r) tname = r.tableName;
  }
  if (!tname) return null;
  return getCachedValues(tname, column);
}

/** Clear cache — exported so tests and schema-changed events can flush. */
export function clearDistinctValueCache(): void {
  cache.clear();
  inflight.clear();
}
