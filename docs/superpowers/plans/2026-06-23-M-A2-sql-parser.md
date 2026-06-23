# M-A2: SQL Parser + Identifier Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse SQL blocks to extract FROM/JOIN refs, $-var refs (cell/global/live scopes), macro calls, `-- @ alias` directive, and hasSideEffects. Resolve references against a Catalog. Property tests verify string-literal exclusion at 1000 iters.

**Architecture:** Character-by-character string-literal state machine; regex passes for FROM/JOIN and $-vars on safe spans; no CodeMirror dependency.

**Tech Stack:** TypeScript 5.8, fast-check 3.22, Vitest 4.1

---

## Task 1: Add new types to `types.ts`

- [ ] Append the following block verbatim to the END of `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/types.ts`:

```typescript
// --- M-A2: SQL parser & identifier resolution types ---

export type ReferenceKind = 'alias' | 'variable' | 'global-var' | 'macro' | 'live-var';

export interface SqlReference {
  name: string;           // case-preserved
  resolvedTo: ReferenceKind;
}

export interface VarRef {
  name: string;           // e.g. "x" for $x, "gc_overview.brush" for $alias.brush
  scope: 'cell' | 'global' | 'live';
  path: string[];         // ["brush"] for $alias.brush, [] for plain $x
  renderOnly: boolean;
}

export interface SqlStatement {
  references: SqlReference[];
  varRefs: VarRef[];
  macroRefs: string[];
  registeredAlias: string | null;
  hasSideEffects: boolean;
}

export interface Catalog {
  tables: Set<string>;
  views: Set<string>;
  macros: Set<string>;
  cellAliases: Set<string>;
}

export interface ResolvedReference {
  name: string;
  kind: ReferenceKind;
}
```

- [ ] Verify:
```bash
grep -c "SqlStatement" /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/types.ts
```
Expected output: `2` (one in the comment-adjacent interface decl, one in the export — at minimum `1`, may be higher if other refs exist).

- [ ] Verify shape of all new exports:
```bash
grep -E "^export (type|interface) (ReferenceKind|SqlReference|VarRef|SqlStatement|Catalog|ResolvedReference)" /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/types.ts | wc -l
```
Expected output: `6`

- [ ] Typecheck the project:
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run typecheck
```
Expected: exit code 0.

---

## Task 2: Failing tests — basic FROM reference + stub

- [ ] Create `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/parser/sqlParser.test.ts` with initial content:

```typescript
import { describe, expect, it } from 'vitest';
import { parseSql } from '../../services/parser/sqlParser';
import type { Catalog } from '../../services/parser/types';

const emptyCatalog: Catalog = {
  tables: new Set(),
  views: new Set(),
  macros: new Set(),
  cellAliases: new Set(),
};

describe('parseSql — FROM references (basic)', () => {
  it('extracts single FROM reference', () => {
    const stmt = parseSql('SELECT * FROM gc_pauses', emptyCatalog);
    expect(stmt.references.map((r) => r.name)).toEqual(['gc_pauses']);
  });

  it('returns empty refs for SELECT without FROM', () => {
    const stmt = parseSql('SELECT 1', emptyCatalog);
    expect(stmt.references).toEqual([]);
  });

  it('case-preserves table name', () => {
    const stmt = parseSql('SELECT * FROM GC_Pauses', emptyCatalog);
    expect(stmt.references[0].name).toBe('GC_Pauses');
  });

  it('initializes empty result fields', () => {
    const stmt = parseSql('SELECT 1', emptyCatalog);
    expect(stmt.varRefs).toEqual([]);
    expect(stmt.macroRefs).toEqual([]);
    expect(stmt.registeredAlias).toBeNull();
    expect(stmt.hasSideEffects).toBe(false);
  });
});
```

- [ ] Run tests — must fail because `sqlParser.ts` does not exist:
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- sqlParser 2>&1 | tail -20
```
Expected: a failure mentioning `Failed to resolve import "../../services/parser/sqlParser"` or `Cannot find module`. Test runner exit code: non-zero.

- [ ] Create minimum stub at `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/sqlParser.ts`:

```typescript
import type { Catalog, SqlStatement } from './types';

export function parseSql(_source: string, _catalog: Catalog): SqlStatement {
  return {
    references: [],
    varRefs: [],
    macroRefs: [],
    registeredAlias: null,
    hasSideEffects: false,
  };
}
```

- [ ] Run tests — stub passes the "empty result" and "no FROM" cases, fails the FROM extraction cases:
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- sqlParser 2>&1 | tail -15
```
Expected: 2 passed, 2 failed (the two FROM-extraction tests).

---

## Task 3: Failing tests — JOIN, multi-table, CTE, subquery

- [ ] Append the following block to `sqlParser.test.ts`:

```typescript
describe('parseSql — JOIN / multi-table / CTE', () => {
  it('extracts FROM and JOIN references', () => {
    const stmt = parseSql('SELECT * FROM a JOIN b ON a.id = b.id', emptyCatalog);
    expect(stmt.references.map((r) => r.name).sort()).toEqual(['a', 'b']);
  });

  it('handles LEFT/RIGHT/INNER/FULL OUTER JOIN', () => {
    const stmt = parseSql(
      'SELECT * FROM a LEFT JOIN b ON 1=1 RIGHT JOIN c ON 1=1 INNER JOIN d ON 1=1 FULL OUTER JOIN e ON 1=1',
      emptyCatalog,
    );
    expect(stmt.references.map((r) => r.name).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('extracts comma-separated FROM tables', () => {
    const stmt = parseSql('SELECT * FROM a, b, c', emptyCatalog);
    expect(stmt.references.map((r) => r.name).sort()).toEqual(['a', 'b', 'c']);
  });

  it('does NOT add a reference for parenthesized subquery (no outer ref)', () => {
    const stmt = parseSql('SELECT * FROM (SELECT 1) sub', emptyCatalog);
    expect(stmt.references.map((r) => r.name)).toEqual([]);
  });

  it('extracts inner FROM inside subquery', () => {
    const stmt = parseSql('SELECT * FROM (SELECT * FROM inner_t) sub', emptyCatalog);
    expect(stmt.references.map((r) => r.name)).toEqual(['inner_t']);
  });

  it('extracts CTE-referenced table from final SELECT', () => {
    const stmt = parseSql('WITH t AS (SELECT * FROM raw) SELECT * FROM t', emptyCatalog);
    expect(stmt.references.map((r) => r.name).sort()).toEqual(['raw', 't']);
  });

  it('handles schema-qualified names as a single token', () => {
    const stmt = parseSql('SELECT * FROM main.events', emptyCatalog);
    expect(stmt.references.map((r) => r.name)).toEqual(['main.events']);
  });

  it('handles quoted identifiers', () => {
    const stmt = parseSql('SELECT * FROM "weird name"', emptyCatalog);
    expect(stmt.references.map((r) => r.name)).toEqual(['weird name']);
  });
});
```

- [ ] Run — all 8 should fail (stub returns empty):
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- sqlParser 2>&1 | tail -10
```
Expected: at least 6 failing tests in this describe block. (The "subquery — no outer ref" test passes accidentally because stub returns `[]`.)

---

## Task 4: Failing tests — variable refs ($, $$, $!, $alias.live)

- [ ] Append to `sqlParser.test.ts`:

```typescript
describe('parseSql — variable references', () => {
  it('extracts plain $x as cell-scope', () => {
    const stmt = parseSql('SELECT * FROM t WHERE id = $x', emptyCatalog);
    expect(stmt.varRefs).toEqual([
      { name: 'x', scope: 'cell', path: [], renderOnly: false },
    ]);
  });

  it('extracts $$x as global-scope', () => {
    const stmt = parseSql('SELECT * FROM t WHERE id = $$shared', emptyCatalog);
    expect(stmt.varRefs).toEqual([
      { name: 'shared', scope: 'global', path: [], renderOnly: false },
    ]);
  });

  it('extracts $!x as live-scope', () => {
    const stmt = parseSql('SELECT * FROM t WHERE id = $!live_thing', emptyCatalog);
    expect(stmt.varRefs).toEqual([
      { name: 'live_thing', scope: 'live', path: [], renderOnly: false },
    ]);
  });

  it('extracts $alias.brush as live-scope with path', () => {
    const stmt = parseSql('SELECT * FROM t WHERE x = $gc_overview.brush', emptyCatalog);
    expect(stmt.varRefs).toEqual([
      { name: 'gc_overview.brush', scope: 'live', path: ['brush'], renderOnly: false },
    ]);
  });

  it('extracts $alias.hover as live-scope', () => {
    const stmt = parseSql('SELECT $g.hover FROM t', emptyCatalog);
    expect(stmt.varRefs[0]).toEqual({
      name: 'g.hover',
      scope: 'live',
      path: ['hover'],
      renderOnly: false,
    });
  });

  it('extracts $alias.zoom as live-scope', () => {
    const stmt = parseSql('SELECT $g.zoom FROM t', emptyCatalog);
    expect(stmt.varRefs[0].scope).toBe('live');
    expect(stmt.varRefs[0].path).toEqual(['zoom']);
  });

  it('extracts $alias.selection as live-scope', () => {
    const stmt = parseSql('SELECT $g.selection FROM t', emptyCatalog);
    expect(stmt.varRefs[0].scope).toBe('live');
    expect(stmt.varRefs[0].path).toEqual(['selection']);
  });

  it('extracts $alias.scroll as live-scope', () => {
    const stmt = parseSql('SELECT $g.scroll FROM t', emptyCatalog);
    expect(stmt.varRefs[0].scope).toBe('live');
    expect(stmt.varRefs[0].path).toEqual(['scroll']);
  });

  it('treats $alias.unknown_field as cell-scope (path-form fallback is cell with path)', () => {
    // Spec: only known live-var names trigger live scope. Unknown .field uses cell scope.
    const stmt = parseSql('SELECT $g.something_else FROM t', emptyCatalog);
    expect(stmt.varRefs[0].scope).toBe('cell');
    expect(stmt.varRefs[0].path).toEqual(['something_else']);
  });

  it('extracts multiple var refs in order', () => {
    const stmt = parseSql('SELECT $a, $$b, $!c FROM t WHERE z = $d', emptyCatalog);
    const names = stmt.varRefs.map((v) => `${v.scope}:${v.name}`);
    expect(names).toEqual(['cell:a', 'global:b', 'live:c', 'cell:d']);
  });

  it('does not extract $ followed by non-identifier', () => {
    const stmt = parseSql('SELECT 5 + $ FROM t', emptyCatalog);
    expect(stmt.varRefs).toEqual([]);
  });
});
```

- [ ] Run:
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- sqlParser 2>&1 | tail -10
```
Expected: at least 10 additional failing tests.

---

## Task 5: Failing tests — string-literal exclusion

- [ ] Append to `sqlParser.test.ts`:

```typescript
describe('parseSql — string-literal exclusion', () => {
  it('ignores $x inside single-quoted string', () => {
    const stmt = parseSql("SELECT * FROM t WHERE name = '$placeholder'", emptyCatalog);
    expect(stmt.varRefs).toEqual([]);
  });

  it('ignores $$x inside single-quoted string', () => {
    const stmt = parseSql("SELECT * FROM t WHERE id = '$$nope'", emptyCatalog);
    expect(stmt.varRefs).toEqual([]);
  });

  it('extracts real ref but ignores fake ref inside string', () => {
    const stmt = parseSql(
      "SELECT * FROM t WHERE x = $real AND y = '$fake'",
      emptyCatalog,
    );
    expect(stmt.varRefs).toEqual([
      { name: 'real', scope: 'cell', path: [], renderOnly: false },
    ]);
  });

  it('ignores $x inside double-quoted identifier-quote string (treats as identifier literal)', () => {
    const stmt = parseSql('SELECT "$x_col" FROM t', emptyCatalog);
    expect(stmt.varRefs).toEqual([]);
  });

  it('handles escaped single quotes in string literal', () => {
    const stmt = parseSql(
      "SELECT * FROM t WHERE x = 'it''s $fake' AND y = $real",
      emptyCatalog,
    );
    expect(stmt.varRefs.map((v) => v.name)).toEqual(['real']);
  });

  it('handles dollar-quoted strings ($$...$$)', () => {
    const stmt = parseSql(
      'SELECT * FROM t WHERE x = $$body has $fake here$$ AND y = $real',
      emptyCatalog,
    );
    expect(stmt.varRefs.map((v) => v.name)).toEqual(['real']);
  });

  it('FROM after a string literal still works', () => {
    const stmt = parseSql("SELECT 'literal' FROM t", emptyCatalog);
    expect(stmt.references.map((r) => r.name)).toEqual(['t']);
  });
});
```

- [ ] Run:
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- sqlParser 2>&1 | tail -10
```
Expected: 7 additional failing tests (some may pass by accident, total failing count grows).

---

## Task 6: Failing tests — alias directive + hasSideEffects + macros

- [ ] Append to `sqlParser.test.ts`:

```typescript
describe('parseSql — alias directive (-- @ name)', () => {
  it('extracts alias from first line', () => {
    const stmt = parseSql('-- @ my_alias\nSELECT 1', emptyCatalog);
    expect(stmt.registeredAlias).toBe('my_alias');
  });

  it('extracts alias with leading whitespace', () => {
    const stmt = parseSql('   --   @   my_alias  \nSELECT 1', emptyCatalog);
    expect(stmt.registeredAlias).toBe('my_alias');
  });

  it('does NOT register alias when directive is on a non-first line', () => {
    const stmt = parseSql('SELECT 1\n-- @ late', emptyCatalog);
    expect(stmt.registeredAlias).toBeNull();
  });

  it('ignores blank lines before the directive (first non-blank wins)', () => {
    const stmt = parseSql('\n\n-- @ ok\nSELECT 1', emptyCatalog);
    expect(stmt.registeredAlias).toBe('ok');
  });

  it('rejects alias names that do not start with a lowercase letter', () => {
    const stmt = parseSql('-- @ Bad_Name\nSELECT 1', emptyCatalog);
    expect(stmt.registeredAlias).toBeNull();
  });

  it('rejects alias names that start with digit', () => {
    const stmt = parseSql('-- @ 9bad\nSELECT 1', emptyCatalog);
    expect(stmt.registeredAlias).toBeNull();
  });
});

describe('parseSql — hasSideEffects', () => {
  it.each([
    ['INSERT INTO t VALUES (1)', true],
    ['UPDATE t SET x = 1', true],
    ['DELETE FROM t', true],
    ['CREATE TABLE t (x INT)', true],
    ['DROP TABLE t', true],
    ['COPY t FROM stdin', true],
    ['SELECT * FROM t', false],
    ['WITH x AS (SELECT 1) SELECT * FROM x', false],
  ])('hasSideEffects for `%s` === %s', (sql, expected) => {
    const stmt = parseSql(sql, emptyCatalog);
    expect(stmt.hasSideEffects).toBe(expected);
  });

  it('ignores DDL keywords inside string literals', () => {
    const stmt = parseSql("SELECT 'INSERT' FROM t", emptyCatalog);
    expect(stmt.hasSideEffects).toBe(false);
  });

  it('is case-insensitive', () => {
    const stmt = parseSql('insert into t values (1)', emptyCatalog);
    expect(stmt.hasSideEffects).toBe(true);
  });
});

describe('parseSql — macroRefs', () => {
  it('extracts macro call names when present in catalog', () => {
    const catalog: Catalog = {
      tables: new Set(),
      views: new Set(),
      macros: new Set(['fmt_bytes']),
      cellAliases: new Set(),
    };
    const stmt = parseSql('SELECT fmt_bytes(size) FROM t', catalog);
    expect(stmt.macroRefs).toEqual(['fmt_bytes']);
  });

  it('does not extract function calls that are not in macros catalog', () => {
    const catalog: Catalog = {
      tables: new Set(),
      views: new Set(),
      macros: new Set(),
      cellAliases: new Set(),
    };
    const stmt = parseSql('SELECT count(*) FROM t', catalog);
    expect(stmt.macroRefs).toEqual([]);
  });
});
```

- [ ] Run:
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- sqlParser 2>&1 | tail -10
```
Expected: many failing tests across alias/sideEffects/macros groups.

---

## Task 7: Failing tests — identifierResolver (all 5 kinds)

- [ ] Create `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/parser/identifierResolver.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { resolveReferences } from '../../services/parser/identifierResolver';
import type { Catalog, SqlReference } from '../../services/parser/types';

function mkCatalog(partial: Partial<Catalog>): Catalog {
  return {
    tables: partial.tables ?? new Set(),
    views: partial.views ?? new Set(),
    macros: partial.macros ?? new Set(),
    cellAliases: partial.cellAliases ?? new Set(),
  };
}

const refs = (names: string[]): SqlReference[] =>
  names.map((n) => ({ name: n, resolvedTo: 'variable' as const }));

describe('resolveReferences — kinds', () => {
  it('resolves table reference', () => {
    const catalog = mkCatalog({ tables: new Set(['gc_pauses']) });
    expect(resolveReferences(refs(['gc_pauses']), catalog)).toEqual([
      { name: 'gc_pauses', kind: 'variable' },
    ]);
  });

  it('resolves cellAlias (cross-cell-view) reference as alias', () => {
    const catalog = mkCatalog({ cellAliases: new Set(['gc_overview']) });
    expect(resolveReferences(refs(['gc_overview']), catalog)).toEqual([
      { name: 'gc_overview', kind: 'alias' },
    ]);
  });

  it('resolves macro reference', () => {
    const catalog = mkCatalog({ macros: new Set(['fmt_bytes']) });
    expect(resolveReferences(refs(['fmt_bytes']), catalog)).toEqual([
      { name: 'fmt_bytes', kind: 'macro' },
    ]);
  });

  it('case-insensitive lookup, case-preserved output', () => {
    const catalog = mkCatalog({ tables: new Set(['GC_Pauses']) });
    const result = resolveReferences(refs(['gc_pauses']), catalog);
    expect(result[0].name).toBe('gc_pauses');
    expect(result[0].kind).toBe('variable');
  });

  it('precedence: table beats cellAlias beats macro', () => {
    const catalog = mkCatalog({
      tables: new Set(['x']),
      cellAliases: new Set(['x']),
      macros: new Set(['x']),
    });
    expect(resolveReferences(refs(['x']), catalog)[0].kind).toBe('variable');
  });

  it('precedence: cellAlias beats macro when no table match', () => {
    const catalog = mkCatalog({
      cellAliases: new Set(['x']),
      macros: new Set(['x']),
    });
    expect(resolveReferences(refs(['x']), catalog)[0].kind).toBe('alias');
  });

  it('unknown name keeps original resolvedTo (variable default)', () => {
    const catalog = mkCatalog({});
    const result = resolveReferences(refs(['nope']), catalog);
    expect(result).toEqual([{ name: 'nope', kind: 'variable' }]);
  });

  it('resolves views as variable kind (treated like tables)', () => {
    const catalog = mkCatalog({ views: new Set(['v1']) });
    expect(resolveReferences(refs(['v1']), catalog)[0].kind).toBe('variable');
  });
});
```

- [ ] Run — fails because `identifierResolver.ts` does not exist:
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- identifierResolver 2>&1 | tail -10
```
Expected: error mentioning `Cannot find module` / `Failed to resolve import`.

---

## Task 8: Full implementation of `parseSql` and `resolveReferences`

- [ ] Overwrite `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/sqlParser.ts` with the complete implementation:

```typescript
import type { Catalog, SqlReference, SqlStatement, VarRef } from './types';

// Live-var field names that trigger live scope when used as $alias.<field>
const LIVE_VAR_FIELDS = new Set(['brush', 'hover', 'zoom', 'selection', 'scroll']);

// SQL keywords that should never be treated as table refs after FROM/JOIN
const SQL_NOISE = new Set([
  'select',
  'where',
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'on',
  'as',
  'and',
  'or',
  'not',
  'in',
  'is',
  'null',
  'true',
  'false',
  'union',
  'intersect',
  'except',
  'window',
  'qualify',
  'using',
  'lateral',
  'left',
  'right',
  'inner',
  'outer',
  'full',
  'cross',
  'natural',
  'join',
]);

interface MaskedSql {
  // Source with string-literal contents replaced by spaces (same length).
  // FROM/JOIN, $-var, side-effect, alias directive scanning all run on this string,
  // because lengths and offsets remain identical to the original input.
  masked: string;
  // For each char index in the original, true if it was inside a string literal.
  inString: boolean[];
}

/**
 * Walks the source and produces a string of identical length where every
 * character inside a string literal (single-quote, double-quote, dollar-quote)
 * is replaced with a space. This lets us run simple regex passes for FROM/JOIN
 * and $-vars without false matches inside literals.
 */
function maskStringLiterals(source: string): MaskedSql {
  const out: string[] = new Array(source.length);
  const inString: boolean[] = new Array(source.length).fill(false);

  type State = 'normal' | 'single' | 'double' | 'dollar';
  let state: State = 'normal';
  let dollarTag = ''; // for $tag$...$tag$; empty means $$...$$

  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === 'normal') {
      if (ch === "'") {
        state = 'single';
        out[i] = ch; // delimiter visible
        i += 1;
        continue;
      }
      if (ch === '"') {
        state = 'double';
        out[i] = ch;
        i += 1;
        continue;
      }
      if (ch === '$') {
        // dollar-quoted string: $tag$ ... $tag$  or $$ ... $$
        // tag = optional [A-Za-z_][A-Za-z0-9_]*
        const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(i));
        if (m) {
          dollarTag = m[1] ?? '';
          state = 'dollar';
          for (let k = 0; k < m[0].length; k += 1) {
            out[i + k] = source[i + k]; // delimiter chars visible
          }
          i += m[0].length;
          continue;
        }
        out[i] = ch;
        i += 1;
        continue;
      }
      out[i] = ch;
      i += 1;
      continue;
    }

    if (state === 'single') {
      // doubled '' is an escaped quote inside the literal
      if (ch === "'" && next === "'") {
        inString[i] = true;
        inString[i + 1] = true;
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        continue;
      }
      if (ch === "'") {
        out[i] = ch; // closing quote visible
        state = 'normal';
        i += 1;
        continue;
      }
      inString[i] = true;
      out[i] = ' ';
      i += 1;
      continue;
    }

    if (state === 'double') {
      if (ch === '"' && next === '"') {
        inString[i] = true;
        inString[i + 1] = true;
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        continue;
      }
      if (ch === '"') {
        out[i] = ch;
        state = 'normal';
        i += 1;
        continue;
      }
      inString[i] = true;
      out[i] = ' ';
      i += 1;
      continue;
    }

    // state === 'dollar'
    if (ch === '$') {
      const close = dollarTag === '' ? '$$' : `$${dollarTag}$`;
      if (source.startsWith(close, i)) {
        for (let k = 0; k < close.length; k += 1) {
          out[i + k] = source[i + k];
        }
        i += close.length;
        state = 'normal';
        dollarTag = '';
        continue;
      }
    }
    inString[i] = true;
    out[i] = ' ';
    i += 1;
  }

  return { masked: out.join(''), inString };
}

/**
 * Tokenize a single FROM/JOIN target. Returns the table name (possibly
 * schema.qualified, possibly "quoted with spaces") and the consumed length.
 * Returns null if the token is a subquery `(` or otherwise not a table name.
 */
function readTableToken(s: string, start: number): { name: string; end: number } | null {
  let i = start;
  while (i < s.length && /\s/.test(s[i])) i += 1;
  if (i >= s.length) return null;

  // Subquery — not an outer table reference
  if (s[i] === '(') return null;

  // Quoted identifier "..."
  if (s[i] === '"') {
    const close = s.indexOf('"', i + 1);
    if (close === -1) return null;
    return { name: s.slice(i + 1, close), end: close + 1 };
  }

  // Unquoted: [A-Za-z_][A-Za-z0-9_]*  optionally chained with '.'
  const m = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(s.slice(i));
  if (!m) return null;
  const name = m[0];
  if (SQL_NOISE.has(name.toLowerCase())) return null;
  return { name, end: i + m[0].length };
}

function extractReferences(masked: string): SqlReference[] {
  const refs: SqlReference[] = [];
  const seen = new Set<string>();

  // Match FROM and any *JOIN keyword. Followed by one or more comma-separated table tokens.
  // We do a sweep over the masked string.
  const kwRe = /\b(FROM|JOIN)\b/gi;
  let km: RegExpExecArray | null;
  while ((km = kwRe.exec(masked)) !== null) {
    let pos = km.index + km[0].length;
    // Consume one table, then optionally `, table, table` repeated.
    // Only the FIRST table after JOIN is part of the join list (comma-separated tables
    // after JOIN are unusual, but we still accept them for FROM at least).
    // Read tokens until we either fail or hit something that isn't a comma.
    // Accept one or more tokens separated by commas.
    // Skip optional alias: `t AS x` or `t x` — we don't capture aliases.
    let first = true;
    while (true) {
      const tok = readTableToken(masked, pos);
      if (!tok) break;
      const key = tok.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ name: tok.name, resolvedTo: 'variable' });
      }
      pos = tok.end;
      // Skip whitespace then optional alias
      while (pos < masked.length && /\s/.test(masked[pos])) pos += 1;
      // Optional `AS alias`
      if (/^as\s/i.test(masked.slice(pos))) {
        pos += 3;
        while (pos < masked.length && /\s/.test(masked[pos])) pos += 1;
        const am = /^[A-Za-z_][A-Za-z0-9_]*/.exec(masked.slice(pos));
        if (am) pos += am[0].length;
      } else {
        // Bare alias?
        const am = /^[A-Za-z_][A-Za-z0-9_]*/.exec(masked.slice(pos));
        if (am && !SQL_NOISE.has(am[0].toLowerCase())) {
          pos += am[0].length;
        }
      }
      while (pos < masked.length && /\s/.test(masked[pos])) pos += 1;
      if (masked[pos] !== ',') break;
      pos += 1;
      first = false;
    }
  }

  return refs;
}

function extractVarRefs(masked: string): VarRef[] {
  const out: VarRef[] = [];
  // $$name | $!name | $name(.field)?
  const re = /\$(\$|!)?([A-Za-z_][A-Za-z0-9_]*)(\.([A-Za-z_][A-Za-z0-9_]*))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const sigil = m[1]; // '$' | '!' | undefined
    const head = m[2];
    const field = m[4]; // may be undefined

    if (sigil === '$') {
      out.push({ name: head, scope: 'global', path: [], renderOnly: false });
      continue;
    }
    if (sigil === '!') {
      out.push({ name: head, scope: 'live', path: [], renderOnly: false });
      continue;
    }
    // plain $head or $head.field
    if (field) {
      const isLive = LIVE_VAR_FIELDS.has(field);
      out.push({
        name: `${head}.${field}`,
        scope: isLive ? 'live' : 'cell',
        path: [field],
        renderOnly: false,
      });
    } else {
      out.push({ name: head, scope: 'cell', path: [], renderOnly: false });
    }
  }
  return out;
}

function extractAliasDirective(source: string): string | null {
  // First non-blank line only.
  const lines = source.split('\n');
  for (const line of lines) {
    if (line.trim() === '') continue;
    const m = /^\s*--\s*@\s*([a-z][a-z0-9_]*)/.exec(line);
    return m ? m[1] : null;
  }
  return null;
}

function detectSideEffects(masked: string): boolean {
  return /\b(INSERT|UPDATE|DELETE|CREATE|DROP|COPY)\b/i.test(masked);
}

function extractMacroRefs(masked: string, catalog: Catalog): string[] {
  if (catalog.macros.size === 0) return [];
  // Build a case-insensitive lookup
  const lower = new Set<string>();
  for (const m of catalog.macros) lower.add(m.toLowerCase());

  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const name = m[1];
    if (lower.has(name.toLowerCase()) && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out;
}

export function parseSql(source: string, catalog: Catalog): SqlStatement {
  const { masked } = maskStringLiterals(source);
  const references = extractReferences(masked);
  const varRefs = extractVarRefs(masked);
  const macroRefs = extractMacroRefs(masked, catalog);
  const registeredAlias = extractAliasDirective(source);
  const hasSideEffects = detectSideEffects(masked);
  return { references, varRefs, macroRefs, registeredAlias, hasSideEffects };
}
```

- [ ] Create `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/identifierResolver.ts`:

```typescript
import type { Catalog, ResolvedReference, SqlReference } from './types';

function lowerSet(s: Set<string>): Map<string, string> {
  // Map lowercased -> first canonical (case-preserved) occurrence
  const m = new Map<string, string>();
  for (const v of s) {
    const k = v.toLowerCase();
    if (!m.has(k)) m.set(k, v);
  }
  return m;
}

export function resolveReferences(
  refs: SqlReference[],
  catalog: Catalog,
): ResolvedReference[] {
  const tables = lowerSet(catalog.tables);
  const views = lowerSet(catalog.views);
  const cellAliases = lowerSet(catalog.cellAliases);
  const macros = lowerSet(catalog.macros);

  return refs.map((r) => {
    const k = r.name.toLowerCase();
    // Precedence: tables/views (both -> 'variable') > cellAliases ('alias') > macros ('macro')
    if (tables.has(k) || views.has(k)) {
      return { name: r.name, kind: 'variable' as const };
    }
    if (cellAliases.has(k)) {
      return { name: r.name, kind: 'alias' as const };
    }
    if (macros.has(k)) {
      return { name: r.name, kind: 'macro' as const };
    }
    return { name: r.name, kind: 'variable' as const };
  });
}
```

- [ ] Run all parser tests:
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- parser/sqlParser parser/identifierResolver 2>&1 | tail -25
```
Expected: all unit tests pass. Output includes a line like `Test Files  2 passed (2)` and `Tests  50+ passed`.

- [ ] If any test fails, fix the implementation (NOT the test) and re-run until green.

---

## Task 9: Property tests with fast-check

- [ ] Confirm fast-check is installed:
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && node -e "console.log(require('fast-check/package.json').version)"
```
Expected: a version string starting with `3.` (e.g. `3.22.0`). If the module is not found, install:
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm install --save-dev fast-check@^3.22.0
```

- [ ] Create `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/parser/sqlParser.property.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseSql } from '../../services/parser/sqlParser';
import type { Catalog } from '../../services/parser/types';

const emptyCatalog: Catalog = {
  tables: new Set(),
  views: new Set(),
  macros: new Set(),
  cellAliases: new Set(),
};

// Identifier arbitrary: [a-z_][a-z0-9_]{0,15}
const identifier = fc
  .tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')),
    fc.stringMatching(/^[a-z0-9_]{0,15}$/),
  )
  .map(([head, tail]) => head + tail);

// Innocuous SQL chunk that contains no $ and no quote characters.
// Lets us splat var refs into safe positions.
const safeChunk = fc
  .stringMatching(/^[a-zA-Z0-9_ ,=()+\-*/<>\n]{0,30}$/)
  .filter((s) => !s.includes('$') && !s.includes("'") && !s.includes('"'));

describe('parseSql property — $x tokens outside strings appear in varRefs', () => {
  it('every $name in safe positions is extracted as cell-scope', () => {
    fc.assert(
      fc.property(identifier, safeChunk, safeChunk, (name, before, after) => {
        const sql = `${before} $${name} ${after}`;
        const stmt = parseSql(sql, emptyCatalog);
        // At minimum, our $name must show up; extra refs from `before`/`after` are not possible
        // because we filtered out `$`.
        return (
          stmt.varRefs.length === 1 &&
          stmt.varRefs[0].name === name &&
          stmt.varRefs[0].scope === 'cell' &&
          stmt.varRefs[0].path.length === 0
        );
      }),
      { numRuns: 1000 },
    );
  });
});

describe('parseSql property — $x tokens only inside strings are NOT extracted', () => {
  it('a $name fully wrapped in single-quoted literal yields empty varRefs', () => {
    fc.assert(
      fc.property(identifier, safeChunk, safeChunk, (name, before, after) => {
        // Note: `before`/`after` may NOT contain $, ', or " (filtered above).
        const sql = `${before} '$${name}' ${after}`;
        const stmt = parseSql(sql, emptyCatalog);
        return stmt.varRefs.length === 0;
      }),
      { numRuns: 1000 },
    );
  });
});

describe('parseSql property — string-literal masking preserves length', () => {
  it('parseSql does not throw on arbitrary safe-ish SQL', () => {
    fc.assert(
      fc.property(safeChunk, (sql) => {
        const stmt = parseSql(sql, emptyCatalog);
        expect(stmt).toBeDefined();
        return Array.isArray(stmt.references) && Array.isArray(stmt.varRefs);
      }),
      { numRuns: 200 },
    );
  });
});
```

- [ ] Run property tests:
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- sqlParser.property 2>&1 | tail -15
```
Expected: all 3 property-test blocks pass. Output includes `Test Files  1 passed (1)` and `Tests  3 passed`. Each fc.property() runs its declared `numRuns` (1000 / 1000 / 200) under the hood.

- [ ] If a property fails, fast-check will print the shrunk counterexample. Fix the parser (NOT the property), and re-run.

---

## Task 10: Gate + commit

- [ ] Run full parser test suite:
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- parser 2>&1 | tail -15
```
Expected: all parser test files green. Look for `Test Files  4 passed` (sqlParser, sqlParser.property, identifierResolver, and the pre-existing notebookParser tests from M-A1).

- [ ] Run project typecheck:
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run typecheck 2>&1 | tail -10
```
Expected: exit code 0, no errors printed.

- [ ] Confirm there are no stray TODOs or `// ...` placeholders in the new files:
```bash
grep -nE "TODO|FIXME|\.\.\." /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/sqlParser.ts /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/identifierResolver.ts
```
Expected: no output (exit code 1 from grep is fine).

- [ ] Stage and commit:
```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add frontend-v2/src/services/parser/sqlParser.ts frontend-v2/src/services/parser/identifierResolver.ts frontend-v2/src/services/parser/types.ts frontend-v2/src/__tests__/parser/sqlParser.test.ts frontend-v2/src/__tests__/parser/sqlParser.property.test.ts frontend-v2/src/__tests__/parser/identifierResolver.test.ts
```

- [ ] Verify staged file list:
```bash
cd /Users/i560383_1/code/experiments/jfr-query && git diff --cached --name-only
```
Expected output (6 files):
```
frontend-v2/src/__tests__/parser/identifierResolver.test.ts
frontend-v2/src/__tests__/parser/sqlParser.property.test.ts
frontend-v2/src/__tests__/parser/sqlParser.test.ts
frontend-v2/src/services/parser/identifierResolver.ts
frontend-v2/src/services/parser/sqlParser.ts
frontend-v2/src/services/parser/types.ts
```

- [ ] Commit:
```bash
cd /Users/i560383_1/code/experiments/jfr-query && git commit -m "feat(v2): M-A2 SQL parser + identifier resolver + property tests"
```
Expected: commit succeeds, summary shows 6 files changed.

- [ ] Verify final state:
```bash
cd /Users/i560383_1/code/experiments/jfr-query && git log -1 --stat
```
Expected: top commit is the M-A2 commit, with the 6 files listed.

---

## Done criteria

- All ten tasks checked off.
- `npm run test -- parser` green (unit + property + identifierResolver).
- `npm run typecheck` exit 0.
- One commit recorded: `feat(v2): M-A2 SQL parser + identifier resolver + property tests`.
- No placeholders, no TODOs, no skipped tests in the new files.
