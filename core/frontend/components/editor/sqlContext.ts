/**
 * Parses the SQL text up to the cursor into a rich context object the
 * completion source uses to make smarter decisions.
 *
 * This is intentionally regex-based rather than a real SQL parser — completions
 * need to work on incomplete/invalid SQL, and we only need a few specific
 * structural facts: what's referenced, what aliases exist, what CTEs are
 * defined, and what clause we're currently inside.
 */

export interface SqlAlias {
  /** The alias as the user wrote it, e.g. `t`. */
  alias: string;
  /** The underlying table/view/CTE name, e.g. `RecordingInfo`. */
  target: string;
}

export interface SqlCte {
  name: string;
  /** Column names if visible in the CTE header `WITH foo(a, b) AS (...)`. */
  columns: string[] | null;
}

export type SqlClause =
  | 'select'
  | 'from'
  | 'join'
  | 'where'
  | 'having'
  | 'on'
  | 'group_by'
  | 'order_by'
  | 'limit'
  | 'with'
  | null;

export interface SqlContext {
  /** Tables/views referenced in FROM and JOIN, lowercased. */
  referenced: Set<string>;
  /** Map of lowercase alias → original (case-preserved) target name. */
  aliases: Map<string, SqlAlias>;
  /** CTE names (lowercased) → CTE info. */
  ctes: Map<string, SqlCte>;
  /** Clause the cursor is currently inside. */
  clause: SqlClause;
  /**
   * If the cursor is right after `alias.`, this is the alias text (lowercased).
   * Triggers alias-scoped column completion.
   */
  qualifierAlias: string | null;
  /**
   * If the cursor is inside a single-quoted string in a WHERE comparison like
   * `col = '...` or `col IN ('a', '...`, this names the column we're comparing.
   * Triggers live distinct-value lookup.
   */
  insideStringForColumn: { column: string; table: string | null } | null;
  /** True if inside a `(...)` of a function call (used for arg hints). */
  insideFunctionArgs: { funcName: string; argIndex: number } | null;
}

const CLAUSE_PATTERNS: Array<{ name: SqlClause; re: RegExp }> = [
  { name: 'order_by', re: /\bORDER\s+BY\b[^;]*$/i },
  { name: 'group_by', re: /\bGROUP\s+BY\b[^;]*$/i },
  { name: 'having', re: /\bHAVING\b[^;]*$/i },
  { name: 'where', re: /\bWHERE\b[^;]*$/i },
  { name: 'on', re: /\bON\b[^;()]*$/i },
  { name: 'join', re: /\b(?:INNER|LEFT|RIGHT|FULL|CROSS)?\s*JOIN\s+[^\s;]*$/i },
  { name: 'from', re: /\bFROM\s+[^;]*$/i },
  { name: 'limit', re: /\bLIMIT\b[^;]*$/i },
  { name: 'with', re: /\bWITH\b(?![\s\S]*\bSELECT\b)/i },
  { name: 'select', re: /\bSELECT\b[^;]*$/i },
];

export function detectClause(textUpToCursor: string): SqlClause {
  // Strip the part before the last semicolon — only the current statement matters.
  const stmt = textUpToCursor.replace(/^[\s\S]*;/, '');
  for (const { name, re } of CLAUSE_PATTERNS) {
    if (re.test(stmt)) return name;
  }
  return null;
}

/**
 * Pulls FROM/JOIN target+alias pairs from anywhere in the statement.
 * Handles: `FROM Table`, `FROM "Quoted Name"`, `FROM Table t`, `FROM Table AS t`,
 * `JOIN x ON ...`, multiple comma-separated tables in FROM.
 */
const FROM_JOIN_RE =
  /\b(?:FROM|JOIN)\s+("[^"]+"|\w+)(?:\s+(?:AS\s+)?(\w+))?(?=\s*(?:,|\bON\b|\bUSING\b|\bWHERE\b|\bGROUP\b|\bORDER\b|\bHAVING\b|\bLIMIT\b|\bJOIN\b|\bINNER\b|\bLEFT\b|\bRIGHT\b|\bFULL\b|\bCROSS\b|\)|;|$))/gi;

function unquote(s: string): string {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

/**
 * Parses simple CTE definitions: `WITH foo AS (...)`, `WITH foo(a, b) AS (...)`,
 * and chained CTEs separated by commas. Doesn't try to handle nested WITH.
 */
function parseCtes(stmt: string): Map<string, SqlCte> {
  const out = new Map<string, SqlCte>();
  const withMatch = stmt.match(/\bWITH\b/i);
  if (!withMatch) return out;
  // Naive scan: find `name (cols)? AS (` patterns up to the main SELECT.
  const after = stmt.slice(withMatch.index! + 4);
  const cteRe = /(\w+)\s*(?:\(([^)]+)\))?\s+AS\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = cteRe.exec(after)) !== null) {
    const name = m[1].toLowerCase();
    // Guard against catching `EXISTS AS (` or similar inside the body.
    if (/^(select|from|where|group|having|order|limit|join|on|using|as|by)$/i.test(m[1])) continue;
    const cols = m[2] ? m[2].split(',').map(s => s.trim()).filter(Boolean) : null;
    out.set(name, { name, columns: cols });
  }
  return out;
}

/**
 * Detects whether the cursor sits inside `<col> = '<partial>` or `<col> IN ('a',
 * '<partial>`, and returns the column being filtered. Returns null otherwise.
 */
function detectStringValueColumn(stmt: string): { column: string; table: string | null } | null {
  // Look at the last unclosed single quote.
  const lastQuote = stmt.lastIndexOf("'");
  if (lastQuote < 0) return null;
  // Count quotes before — if odd, lastQuote is closing a string; if even, lastQuote opens one (cursor is inside).
  const before = stmt.slice(0, lastQuote);
  let inside = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === "'" && before[i - 1] !== '\\') inside++;
  }
  if (inside % 2 !== 0) return null;
  // Walk back from the opening quote to find an operator and column reference.
  const head = before.replace(/\s+$/, '');
  // Allow `=`, `<>`, `!=`, `IN (`, `LIKE`, `ILIKE`
  const m = head.match(/(\w+|"[^"]+")(?:\.(\w+|"[^"]+"))?\s*(?:=|<>|!=|LIKE|ILIKE|IN\s*\(\s*(?:'[^']*'\s*,\s*)*)\s*$/i);
  if (!m) return null;
  const left = unquote(m[1]);
  const right = m[2] ? unquote(m[2]) : null;
  return right ? { column: right, table: left } : { column: left, table: null };
}

/**
 * Detects `funcname(arg1, arg2, |partial` and returns the function name plus
 * which argument index the cursor is on. Skips matching subqueries (anything
 * with SELECT) and arithmetic groupings.
 */
function detectFunctionArgs(stmt: string): { funcName: string; argIndex: number } | null {
  // Find the most recent unmatched `(`.
  let depth = 0;
  let openAt = -1;
  for (let i = stmt.length - 1; i >= 0; i--) {
    const c = stmt[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) {
        openAt = i;
        break;
      }
      depth--;
    }
  }
  if (openAt < 0) return null;
  const before = stmt.slice(0, openAt).trimEnd();
  const fn = before.match(/(\w+)$/);
  if (!fn) return null;
  // Skip parens used for grouping in `WHERE (a OR b)` etc — must be a function-like name.
  const argText = stmt.slice(openAt + 1);
  // Don't suggest args inside a subquery.
  if (/\bselect\b/i.test(argText)) return null;
  // Count commas at depth 0 from openAt to cursor.
  let d = 0;
  let argIndex = 0;
  for (const c of argText) {
    if (c === '(') d++;
    else if (c === ')') d--;
    else if (c === ',' && d === 0) argIndex++;
  }
  return { funcName: fn[1], argIndex };
}

export function parseSqlContext(textUpToCursor: string, fullDocText?: string): SqlContext {
  const stmt = textUpToCursor.replace(/^[\s\S]*;/, '');
  // For alias extraction, scan the full document when available so that
  // `SELECT t.| FROM Table t` works even with the cursor before the FROM clause.
  const fullStmt = fullDocText
    ? fullDocText.replace(/^[\s\S]*;/, '')
    : stmt;
  const referenced = new Set<string>();
  const aliases = new Map<string, SqlAlias>();

  FROM_JOIN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FROM_JOIN_RE.exec(fullStmt)) !== null) {
    const target = unquote(m[1]);
    referenced.add(target.toLowerCase());
    if (m[2] && !/^(WHERE|GROUP|ORDER|HAVING|JOIN|ON|USING|LIMIT|INNER|LEFT|RIGHT|FULL|CROSS)$/i.test(m[2])) {
      aliases.set(m[2].toLowerCase(), { alias: m[2], target });
    }
  }

  const ctes = parseCtes(fullStmt);
  // CTEs are queryable like tables.
  for (const name of ctes.keys()) referenced.add(name);

  const clause = detectClause(textUpToCursor);

  // qualifierAlias: did the user just type `foo.`?
  const qmatch = stmt.match(/(\w+)\.$/);
  const qualifierAlias = qmatch ? qmatch[1].toLowerCase() : null;

  const insideStringForColumn = detectStringValueColumn(stmt);
  const insideFunctionArgs = detectFunctionArgs(stmt);

  return {
    referenced,
    aliases,
    ctes,
    clause,
    qualifierAlias,
    insideStringForColumn,
    insideFunctionArgs,
  };
}
