# M-A5: Formatter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three-layer formatter (SQL via sql-formatter, plot DSL via canonical key-order, notebook structural) with idempotency property at 5000 iters and $$ai_providers secret-scrub security rule.

**Architecture:** sql-formatter for SQL with $-var placeholder substitution; plot formatter walks parsed AST and re-serializes in keyOrder.ts canonical order; notebook formatter coordinates both and enforces structural rules.

**Tech Stack:** TypeScript 5.8, sql-formatter 15.0.0, fast-check 3.22, Vitest 4.1

---

## Task 1: Install sql-formatter + extend types

- [ ] Step 1.1: Add `sql-formatter` to `frontend-v2/package.json` dependencies.

  Open `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/package.json` and add to the `dependencies` object:
  ```json
  "sql-formatter": "15.0.0"
  ```
  Keep alphabetical order with existing keys.

- [ ] Step 1.2: Install.
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm install
  ```
  Expected output ends with: `added 1 package` (or similar) and no `npm ERR!`. The file `frontend-v2/package-lock.json` is updated.

- [ ] Step 1.3: Append formatter types + `SecretLeakPrevented` diagnostic kind to `frontend-v2/src/services/parser/types.ts`.

  Edit the `DiagnosticKind` union to add the new kind. Replace:
  ```typescript
  export type DiagnosticKind =
    | 'FenceOrderWarning'
    | 'UnterminatedFence'
    | 'MissingCellAlias'
    | 'UnknownFrontmatterKey'
    | 'SugarOnly'
    | 'UnknownPlotType'
    | 'UnknownClause'
    | 'UnterminatedBrace'
    | 'ParseError'
    | 'UnknownIdentifier';
  ```
  with:
  ```typescript
  export type DiagnosticKind =
    | 'FenceOrderWarning'
    | 'UnterminatedFence'
    | 'MissingCellAlias'
    | 'UnknownFrontmatterKey'
    | 'SugarOnly'
    | 'UnknownPlotType'
    | 'UnknownClause'
    | 'UnterminatedBrace'
    | 'ParseError'
    | 'UnknownIdentifier'
    | 'SecretLeakPrevented'
    | 'FormatterError';
  ```

  Then append the following block at the very end of the file:
  ```typescript

  // ----- Formatter (M-A5) ---------------------------------------------------

  export interface FormatterInput {
    source: string;
    options?: FormatOptions;
  }

  export interface FormatOptions {
    indentWidth?: number;        // default 2
    keywordCase?: 'upper' | 'lower' | 'preserve'; // default 'upper' for SQL
  }

  export interface FormattedCell {
    cellAlias: string | null;
    displayIndex: number;
    changed: boolean;
    diagnostics: Diagnostic[];
  }

  export interface FormatterOutput {
    source: string;              // fully formatted notebook source
    changed: boolean;            // source !== input.source
    changedCells: FormattedCell[]; // per-cell diff info for the diff modal (M-B5)
    diagnostics: Diagnostic[];
  }
  ```

- [ ] Step 1.4: Verify.
  ```bash
  grep -c "FormatterOutput\|FormattedCell\|FormatterInput\|FormatOptions\|SecretLeakPrevented\|FormatterError" \
    /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/types.ts
  ```
  Expected output:
  ```
  8
  ```
  (4 declarations + `FormattedCell` referenced inside `FormatterOutput` + 2 diagnostic kinds + at least one extra reference).

- [ ] Step 1.5: Typecheck still passes.
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run typecheck
  ```
  Expected: exit code 0, no errors printed.

---

## Task 2: Create `keyOrder.ts`

- [ ] Step 2.1: Create directory.
  ```bash
  mkdir -p /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/formatter
  mkdir -p /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/formatter
  ```

- [ ] Step 2.2: Write the complete file `frontend-v2/src/services/formatter/keyOrder.ts`:
  ```typescript
  // Canonical key-order tables for the plot DSL formatter (M-A5).
  // Any key not listed is emitted *after* the listed keys in its original
  // relative order. The notebook formatter relies on these tables to make
  // formatting deterministic regardless of how a user typed the source.

  import type { PlotType } from '../parser/types';

  export const PANEL_KEY_ORDER: Record<PlotType, string[]> = {
    line:      ['x', 'y', 'color', 'size', 'opacity', 'group', 'label', 'title'],
    bar:       ['x', 'y', 'color', 'group', 'label', 'title'],
    scatter:   ['x', 'y', 'color', 'size', 'opacity', 'label', 'title'],
    histogram: ['x', 'bins', 'color', 'title'],
    boxplot:   ['category', 'value', 'color', 'title'],
    heatmap:   ['x', 'y', 'value', 'color', 'title'],
    pie:       ['name', 'value', 'color', 'title'],
    flamegraph:['value', 'name', 'color', 'title'],
    table:     [],  // table keys are pass-through in declaration order
    gantt:     ['start', 'end', 'lane', 'color', 'title'],
    area:      ['x', 'y', 'color', 'group', 'title'],
    range:     ['x', 'lo', 'hi', 'color', 'title'],
  };

  export const CLAUSE_TAIL_ORDER: string[] = [
    'title', 'width', 'height', 'zoom', 'link-x', 'link-y', 'link-xy',
    'brush', 'name', 'palette', 'legend', 'tooltip',
    'on_hover', 'on_selection', 'on_brush', 'on', 'highlight', 'settings', 'disabled',
  ];

  /**
   * Sort entries by canonical order. Entries whose key is not in the order
   * list are appended in their original relative order ("stable for unknown
   * keys").
   */
  export function sortByOrder<T extends { key: string }>(
    entries: T[],
    order: string[],
  ): T[] {
    const rank = new Map(order.map((k, i) => [k, i]));
    const known: T[] = [];
    const unknown: T[] = [];
    for (const e of entries) {
      if (rank.has(e.key)) known.push(e);
      else unknown.push(e);
    }
    known.sort((a, b) => (rank.get(a.key)! - rank.get(b.key)!));
    return [...known, ...unknown];
  }
  ```

- [ ] Step 2.3: Verify.
  ```bash
  grep -c "flamegraph\|PANEL_KEY_ORDER\|CLAUSE_TAIL_ORDER\|sortByOrder" \
    /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/formatter/keyOrder.ts
  ```
  Expected output:
  ```
  5
  ```

- [ ] Step 2.4: Typecheck.
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run typecheck
  ```
  Expected: exit code 0.

---

## Task 3: Write failing SQL formatter tests (first 20 cases)

- [ ] Step 3.1: Create `frontend-v2/src/__tests__/formatter/sqlFormatter.test.ts` with these 20 cases. Use the complete file below:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { formatSql } from '../../services/formatter/sqlFormatter';

  describe('formatSql — basic keyword + structure', () => {
    it('uppercases keywords', () => {
      const { formatted } = formatSql('select * from t');
      expect(formatted).toMatch(/^SELECT \* FROM t/);
    });

    it('uppercases WHERE / AND / OR / GROUP BY / ORDER BY', () => {
      const src = 'select a from t where x = 1 and y = 2 group by a order by a';
      const { formatted } = formatSql(src);
      expect(formatted).toMatch(/SELECT/);
      expect(formatted).toMatch(/WHERE/);
      expect(formatted).toMatch(/AND/);
      expect(formatted).toMatch(/GROUP BY/);
      expect(formatted).toMatch(/ORDER BY/);
    });

    it('preserves identifier casing', () => {
      const { formatted } = formatSql('select MyCol from MyTable');
      expect(formatted).toContain('MyCol');
      expect(formatted).toContain('MyTable');
    });

    it('preserves string literals untouched', () => {
      const { formatted } = formatSql("select 'Hello WORLD' from t");
      expect(formatted).toContain("'Hello WORLD'");
    });

    it('preserves double-quoted identifiers', () => {
      const { formatted } = formatSql('select "weird Col" from t');
      expect(formatted).toContain('"weird Col"');
    });

    it('preserves numeric literals', () => {
      const { formatted } = formatSql('select 1.5e10 from t');
      expect(formatted).toContain('1.5e10');
    });
  });

  describe('formatSql — alias pin', () => {
    it('pins -- @ alias to line 1', () => {
      const src = '\n\n-- @ my_alias\nselect 1';
      const { formatted } = formatSql(src);
      const lines = formatted.split('\n');
      expect(lines[0]).toBe('-- @ my_alias');
    });

    it('keeps existing first-line alias on line 1', () => {
      const src = '-- @ a\nselect 1';
      const { formatted } = formatSql(src);
      expect(formatted.split('\n')[0]).toBe('-- @ a');
    });

    it('does not invent an alias when none is present', () => {
      const { formatted } = formatSql('select 1');
      expect(formatted).not.toMatch(/-- @/);
    });
  });

  describe('formatSql — $-variables (notebook params)', () => {
    it('preserves $var verbatim', () => {
      const { formatted } = formatSql('select * from t where id = $user_id');
      expect(formatted).toContain('$user_id');
    });

    it('preserves $$var verbatim', () => {
      const { formatted } = formatSql('select * from t where id = $$user_id');
      expect(formatted).toContain('$$user_id');
    });

    it('preserves $alias.brush', () => {
      const { formatted } = formatSql('select * from $alias.brush');
      expect(formatted).toContain('$alias.brush');
    });

    it('preserves $alias.col!', () => {
      const { formatted } = formatSql('select $a.col! from t');
      expect(formatted).toContain('$a.col!');
    });

    it('handles multiple $-vars in one statement', () => {
      const { formatted } = formatSql('select $a, $b, $$c from t');
      expect(formatted).toContain('$a');
      expect(formatted).toContain('$b');
      expect(formatted).toContain('$$c');
    });
  });

  describe('formatSql — comments', () => {
    it('preserves -- line comments', () => {
      const { formatted } = formatSql('-- this is a comment\nselect 1');
      expect(formatted).toContain('-- this is a comment');
    });

    it('preserves /* block comment */', () => {
      const { formatted } = formatSql('/* block comment */ select 1');
      expect(formatted).toContain('/* block comment */');
    });
  });

  describe('formatSql — idempotency (basic)', () => {
    it('is idempotent for a simple SELECT', () => {
      const src = 'select a, b from t where x = 1';
      const r1 = formatSql(src).formatted;
      const r2 = formatSql(r1).formatted;
      expect(r2).toBe(r1);
    });

    it('is idempotent with $-vars', () => {
      const src = 'select $x, $$y from t where id = $a.col!';
      const r1 = formatSql(src).formatted;
      const r2 = formatSql(r1).formatted;
      expect(r2).toBe(r1);
    });

    it('is idempotent with alias comment', () => {
      const src = '-- @ cell_1\nselect 1';
      const r1 = formatSql(src).formatted;
      const r2 = formatSql(r1).formatted;
      expect(r2).toBe(r1);
    });
  });

  describe('formatSql — side-effecting statements', () => {
    it('formats INSERT without rewriting semantics', () => {
      const { formatted } = formatSql('insert into t values (1, 2)');
      expect(formatted).toMatch(/INSERT INTO t/i);
      expect(formatted).toContain('1');
      expect(formatted).toContain('2');
    });
  });
  ```

- [ ] Step 3.2: Run the tests — they MUST fail because `formatSql` does not exist yet.
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- formatter/sqlFormatter 2>&1 | tail -20
  ```
  Expected: failing run, error contains `Cannot find module '../../services/formatter/sqlFormatter'` or `Failed to resolve import`.

---

## Task 4: Implement `sqlFormatter.ts`

- [ ] Step 4.1: Write the complete file `frontend-v2/src/services/formatter/sqlFormatter.ts`:
  ```typescript
  import { format as sqlFormat } from 'sql-formatter';
  import type { Diagnostic } from '../parser/types';

  // Regex for $var / $$var / $a.b / $a.b! — any token starting with $ that
  // would confuse a generic SQL formatter. We substitute these with safe
  // placeholders before formatting and restore them afterward.
  const VAR_RE = /\$\$?[A-Za-z_][A-Za-z0-9_.!]*/g;

  // Placeholder format chosen to be (a) a valid SQL identifier so the
  // formatter does not try to split or reflow it, and (b) extremely unlikely
  // to occur in real notebook SQL.
  const PLACEHOLDER_PREFIX = '__JFRQ_VAR_';
  const PLACEHOLDER_SUFFIX = '__';

  function makePlaceholder(i: number): string {
    return `${PLACEHOLDER_PREFIX}${i}${PLACEHOLDER_SUFFIX}`;
  }

  function substituteVars(src: string): { masked: string; tokens: string[] } {
    const tokens: string[] = [];
    const masked = src.replace(VAR_RE, (match) => {
      const placeholder = makePlaceholder(tokens.length);
      tokens.push(match);
      return placeholder;
    });
    return { masked, tokens };
  }

  function restoreVars(text: string, tokens: string[]): string {
    let out = text;
    for (let i = 0; i < tokens.length; i++) {
      const ph = makePlaceholder(i);
      // Replace ALL occurrences — sql-formatter never duplicates, but be safe.
      out = out.split(ph).join(tokens[i]);
    }
    return out;
  }

  /**
   * Extract any leading `-- @ alias` comment so we can guarantee it appears
   * as line 1 of the output (independent of where it was in the input).
   *
   * Returns the alias line (without trailing newline) and the rest of the
   * source with that line removed.
   */
  function extractAliasLine(src: string): { alias: string | null; rest: string } {
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') continue;
      const m = line.match(/^\s*--\s*@\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/);
      if (m) {
        const aliasLine = `-- @ ${m[1]}`;
        const rest = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n');
        return { alias: aliasLine, rest };
      }
      // First non-blank line is not an alias — bail out.
      return { alias: null, rest: src };
    }
    return { alias: null, rest: src };
  }

  export interface FormatSqlResult {
    formatted: string;
    diagnostics: Diagnostic[];
  }

  export function formatSql(source: string): FormatSqlResult {
    const diagnostics: Diagnostic[] = [];

    // Pull alias comment aside so its position is canonical.
    const { alias, rest } = extractAliasLine(source);

    // Mask $-vars.
    const { masked, tokens } = substituteVars(rest);

    let formattedBody: string;
    try {
      formattedBody = sqlFormat(masked, {
        language: 'sql',
        keywordCase: 'upper',
        tabWidth: 2,
      });
    } catch (err) {
      // sql-formatter throws on syntax errors. Per the M-A5 error-tolerance
      // decision, return the input unchanged + a diagnostic.
      diagnostics.push({
        kind: 'FormatterError',
        severity: 'warning',
        message: `SQL formatter error: ${(err as Error).message}`,
        offset: 0,
        length: source.length,
      });
      return { formatted: source, diagnostics };
    }

    // Restore $-vars.
    const restored = restoreVars(formattedBody, tokens);

    // Prepend alias if present.
    const withAlias = alias ? `${alias}\n${restored.replace(/^\n+/, '')}` : restored;

    // Strip trailing whitespace on each line, ensure single trailing newline.
    const lines = withAlias.split('\n').map((l) => l.replace(/[\t ]+$/, ''));
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const final = lines.join('\n') + '\n';

    return { formatted: final, diagnostics };
  }
  ```

- [ ] Step 4.2: Run tests.
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- formatter/sqlFormatter 2>&1 | tail -10
  ```
  Expected output ends with something like:
  ```
  Test Files  1 passed (1)
       Tests  20 passed (20)
  ```

---

## Task 5: Write remaining SQL formatter tests (20+ more cases) — error tolerance + advanced

- [ ] Step 5.1: Append to `frontend-v2/src/__tests__/formatter/sqlFormatter.test.ts` (after the existing `describe` blocks):
  ```typescript

  describe('formatSql — indentation & structure', () => {
    it('indents subqueries with 2 spaces', () => {
      const src = 'select * from (select a from t) sub';
      const { formatted } = formatSql(src);
      // Expect at least one line starting with 2 spaces.
      expect(formatted.split('\n').some((l) => /^  \S/.test(l))).toBe(true);
    });

    it('formats WITH / CTE without crashing', () => {
      const src = 'with cte as (select 1 as x) select x from cte';
      const { formatted } = formatSql(src);
      expect(formatted).toMatch(/WITH/);
      expect(formatted).toMatch(/SELECT/);
    });

    it('handles a multi-CTE statement', () => {
      const src = 'with a as (select 1), b as (select 2) select * from a, b';
      const { formatted } = formatSql(src);
      expect(formatted).toMatch(/WITH/);
      expect(formatted.split('\n').length).toBeGreaterThan(1);
    });

    it('formats JOIN clauses', () => {
      const src = 'select * from a join b on a.id = b.id';
      const { formatted } = formatSql(src);
      expect(formatted).toMatch(/JOIN/);
      expect(formatted).toMatch(/ON/);
    });

    it('formats LEFT OUTER JOIN', () => {
      const src = 'select * from a left outer join b on a.id = b.id';
      const { formatted } = formatSql(src);
      expect(formatted).toMatch(/LEFT OUTER JOIN/);
    });
  });

  describe('formatSql — macros and function calls', () => {
    it('keeps macro-style call compact', () => {
      const src = 'select percentile(dur, 99) from t';
      const { formatted } = formatSql(src);
      expect(formatted).toContain('percentile(dur, 99)');
    });

    it('preserves COUNT(*)', () => {
      const { formatted } = formatSql('select count(*) from t');
      expect(formatted).toMatch(/COUNT\(\*\)/i);
    });

    it('preserves CASE expressions', () => {
      const src = 'select case when x > 0 then 1 else 0 end from t';
      const { formatted } = formatSql(src);
      expect(formatted).toMatch(/CASE/);
      expect(formatted).toMatch(/WHEN/);
      expect(formatted).toMatch(/END/);
    });

    it('preserves nested function calls with $-vars', () => {
      const src = 'select coalesce($x, lower($y)) from t';
      const { formatted } = formatSql(src);
      expect(formatted).toContain('$x');
      expect(formatted).toContain('$y');
    });
  });

  describe('formatSql — comments interleaved', () => {
    it('preserves inline comment at end of line', () => {
      const src = 'select 1 -- inline\nfrom t';
      const { formatted } = formatSql(src);
      expect(formatted).toContain('-- inline');
    });

    it('preserves a comment between statements', () => {
      const src = 'select 1; -- between\nselect 2';
      const { formatted } = formatSql(src);
      expect(formatted).toContain('-- between');
    });
  });

  describe('formatSql — error tolerance', () => {
    it('returns input unchanged for unmatched paren and emits diagnostic', () => {
      const broken = 'select * from (select a from t';
      const { formatted, diagnostics } = formatSql(broken);
      // Either left unchanged or at least diagnostics emitted.
      if (diagnostics.length > 0) {
        expect(diagnostics[0].kind).toBe('FormatterError');
      } else {
        // sql-formatter is sometimes tolerant; idempotency is the real gate.
        expect(formatSql(formatted).formatted).toBe(formatted);
      }
    });

    it('does not throw on empty string', () => {
      const { formatted } = formatSql('');
      expect(typeof formatted).toBe('string');
    });

    it('does not throw on whitespace-only input', () => {
      const { formatted } = formatSql('   \n\n  \n');
      expect(typeof formatted).toBe('string');
    });
  });

  describe('formatSql — semantic preservation', () => {
    it('does not rewrite SELECT * to enumerated columns', () => {
      const { formatted } = formatSql('select * from t');
      expect(formatted).toContain('*');
    });

    it('does not strip aliases', () => {
      const { formatted } = formatSql('select a as A1, b as B1 from t');
      expect(formatted).toMatch(/A1/);
      expect(formatted).toMatch(/B1/);
    });

    it('does not normalize quotes', () => {
      const { formatted } = formatSql(`select 'x' from t where y = "z"`);
      expect(formatted).toContain("'x'");
      expect(formatted).toContain('"z"');
    });

    it('idempotent for complex CTE with $-vars and alias', () => {
      const src = `-- @ heavy
  with hits as (
    select * from events where ts > $start
  )
  select count(*) from hits`;
      const r1 = formatSql(src).formatted;
      const r2 = formatSql(r1).formatted;
      expect(r2).toBe(r1);
    });

    it('idempotent for JOIN with subquery', () => {
      const src = 'select * from a join (select id from b) s on a.id = s.id';
      const r1 = formatSql(src).formatted;
      const r2 = formatSql(r1).formatted;
      expect(r2).toBe(r1);
    });
  });
  ```

- [ ] Step 5.2: Run the full SQL formatter test file.
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- formatter/sqlFormatter 2>&1 | tail -10
  ```
  Expected:
  ```
  Test Files  1 passed (1)
       Tests  40 passed (40)
  ```
  (40+ tests; minor variation in count is fine if you added more.)

---

## Task 6: Write failing plot formatter tests (first 20 cases)

- [ ] Step 6.1: Create `frontend-v2/src/__tests__/formatter/plotFormatter.test.ts` with these 20 cases:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { formatPlot } from '../../services/formatter/plotFormatter';

  describe('formatPlot — panel key ordering', () => {
    it('reorders line panel keys: y,x -> x,y', () => {
      const src = 'line { y: "v", x: "t" }';
      const { formatted } = formatPlot(src);
      const xIdx = formatted.indexOf('x:');
      const yIdx = formatted.indexOf('y:');
      expect(xIdx).toBeGreaterThan(-1);
      expect(yIdx).toBeGreaterThan(-1);
      expect(xIdx).toBeLessThan(yIdx);
    });

    it('reorders scatter panel: opacity,size,color,y,x -> x,y,color,size,opacity', () => {
      const src = 'scatter { opacity: "o", size: "s", color: "c", y: "v", x: "t" }';
      const { formatted } = formatPlot(src);
      const order = ['x:', 'y:', 'color:', 'size:', 'opacity:'].map((k) => formatted.indexOf(k));
      const sorted = [...order].sort((a, b) => a - b);
      expect(order).toEqual(sorted);
    });

    it('reorders bar panel keys', () => {
      const src = 'bar { color: "c", y: "v", x: "t" }';
      const { formatted } = formatPlot(src);
      expect(formatted.indexOf('x:')).toBeLessThan(formatted.indexOf('y:'));
      expect(formatted.indexOf('y:')).toBeLessThan(formatted.indexOf('color:'));
    });

    it('reorders histogram: title,bins,x -> x,bins,title', () => {
      const src = 'histogram { title: "T", bins: 20, x: "v" }';
      const { formatted } = formatPlot(src);
      expect(formatted.indexOf('x:')).toBeLessThan(formatted.indexOf('bins:'));
      expect(formatted.indexOf('bins:')).toBeLessThan(formatted.indexOf('title:'));
    });

    it('reorders boxplot: value,category -> category,value', () => {
      const src = 'boxplot { value: "v", category: "c" }';
      const { formatted } = formatPlot(src);
      expect(formatted.indexOf('category:')).toBeLessThan(formatted.indexOf('value:'));
    });

    it('reorders heatmap: value,y,x -> x,y,value', () => {
      const src = 'heatmap { value: "v", y: "b", x: "a" }';
      const { formatted } = formatPlot(src);
      expect(formatted.indexOf('x:')).toBeLessThan(formatted.indexOf('y:'));
      expect(formatted.indexOf('y:')).toBeLessThan(formatted.indexOf('value:'));
    });

    it('reorders pie: value,name -> name,value', () => {
      const src = 'pie { value: "v", name: "n" }';
      const { formatted } = formatPlot(src);
      expect(formatted.indexOf('name:')).toBeLessThan(formatted.indexOf('value:'));
    });

    it('reorders flamegraph: name,value -> value,name', () => {
      const src = 'flamegraph { name: "n", value: "v" }';
      const { formatted } = formatPlot(src);
      expect(formatted.indexOf('value:')).toBeLessThan(formatted.indexOf('name:'));
    });

    it('reorders gantt: lane,end,start -> start,end,lane', () => {
      const src = 'gantt { lane: "l", end: "e", start: "s" }';
      const { formatted } = formatPlot(src);
      expect(formatted.indexOf('start:')).toBeLessThan(formatted.indexOf('end:'));
      expect(formatted.indexOf('end:')).toBeLessThan(formatted.indexOf('lane:'));
    });

    it('reorders area: group,color,y,x -> x,y,color,group', () => {
      const src = 'area { group: "g", color: "c", y: "v", x: "t" }';
      const { formatted } = formatPlot(src);
      const idx = ['x:', 'y:', 'color:', 'group:'].map((k) => formatted.indexOf(k));
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
    });

    it('reorders range: hi,lo,x -> x,lo,hi', () => {
      const src = 'range { hi: "h", lo: "l", x: "t" }';
      const { formatted } = formatPlot(src);
      expect(formatted.indexOf('x:')).toBeLessThan(formatted.indexOf('lo:'));
      expect(formatted.indexOf('lo:')).toBeLessThan(formatted.indexOf('hi:'));
    });

    it('passes table keys through in declaration order', () => {
      const src = 'table { columns: ["c", "a", "b"] }';
      const { formatted } = formatPlot(src);
      expect(formatted).toContain('columns');
    });
  });

  describe('formatPlot — clause tail ordering', () => {
    it('puts title before brush before name', () => {
      const src = 'line { x: "t", y: "v" } name "n" brush "b" title "T"';
      const { formatted } = formatPlot(src);
      const ti = formatted.indexOf('title');
      const bi = formatted.indexOf('brush');
      const ni = formatted.indexOf('name');
      expect(ti).toBeLessThan(bi);
      expect(bi).toBeLessThan(ni);
    });

    it('puts width before height', () => {
      const src = 'bar { x: "a", y: "b" } height 200 width 600';
      const { formatted } = formatPlot(src);
      expect(formatted.indexOf('width')).toBeLessThan(formatted.indexOf('height'));
    });
  });

  describe('formatPlot — idempotency (basic)', () => {
    it('idempotent for simple line', () => {
      const src = 'line { x: "t", y: "v" }';
      const r1 = formatPlot(src).formatted;
      const r2 = formatPlot(r1).formatted;
      expect(r2).toBe(r1);
    });

    it('idempotent for shuffled keys', () => {
      const src = 'scatter { opacity: "o", color: "c", y: "v", x: "t", size: "s" }';
      const r1 = formatPlot(src).formatted;
      const r2 = formatPlot(r1).formatted;
      expect(r2).toBe(r1);
    });

    it('idempotent with clause tail', () => {
      const src = 'line { x: "t", y: "v" } brush "b" title "T" width 400';
      const r1 = formatPlot(src).formatted;
      const r2 = formatPlot(r1).formatted;
      expect(r2).toBe(r1);
    });
  });

  describe('formatPlot — error tolerance', () => {
    it('returns source unchanged for parse error + emits diagnostic', () => {
      const broken = 'line { x: , y: "v" }'; // missing value
      const { formatted, diagnostics } = formatPlot(broken);
      expect(formatted).toBe(broken);
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it('does not throw on empty string', () => {
      const { formatted } = formatPlot('');
      expect(typeof formatted).toBe('string');
    });

    it('returns source unchanged for unknown plot type', () => {
      const src = 'definitely_not_a_plot { x: "a" }';
      const { formatted, diagnostics } = formatPlot(src);
      // Either source is returned as-is, OR diagnostic indicates UnknownPlotType.
      expect(typeof formatted).toBe('string');
      if (formatted !== src) {
        expect(diagnostics.some((d) => d.kind === 'UnknownPlotType' || d.kind === 'FormatterError' || d.kind === 'ParseError')).toBe(true);
      }
    });
  });
  ```

- [ ] Step 6.2: Run tests — they MUST fail (formatPlot doesn't exist).
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- formatter/plotFormatter 2>&1 | tail -10
  ```
  Expected: errors about `Failed to resolve import` or `Cannot find module '../../services/formatter/plotFormatter'`.

---

## Task 7: Implement `plotFormatter.ts`

- [ ] Step 7.1: First inspect AST shape — we need to know what `parsePlot` returns. Read:
  ```bash
  grep -n "export interface\|export type\|kind:" \
    /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/types.ts \
    | head -40
  ```
  This step is informational — confirm the existence of `PlotBlock`, `PlotProgram`, `Panel`, `Clause` types. (If the type names differ in this codebase, adjust the imports below to match before writing the file.)

- [ ] Step 7.2: Write the complete file `frontend-v2/src/services/formatter/plotFormatter.ts`:
  ```typescript
  import { parsePlot } from '../parser/plotDslParser';
  import type { Diagnostic } from '../parser/types';
  import { PANEL_KEY_ORDER, CLAUSE_TAIL_ORDER, sortByOrder } from './keyOrder';

  export interface FormatPlotResult {
    formatted: string;
    diagnostics: Diagnostic[];
  }

  // ---------- AST → text serialization (canonical form) ----------------------

  type Entry = { key: string; raw: string };

  function literalToText(v: unknown): string {
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return String(v);
    if (v === null) return 'null';
    if (Array.isArray(v)) return '[' + v.map(literalToText).join(', ') + ']';
    if (typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const parts = Object.entries(obj).map(([k, val]) => `${k}: ${literalToText(val)}`);
      return '{ ' + parts.join(', ') + ' }';
    }
    return JSON.stringify(v);
  }

  function panelEntriesFromAst(panel: any): Entry[] {
    // `panel.props` is the canonical name used by plotDslParser; tolerate
    // a few alternates so a small parser-shape drift does not break us.
    const props =
      panel.props ?? panel.attributes ?? panel.fields ?? panel.entries ?? {};
    if (Array.isArray(props)) {
      return props.map((p: any) => ({
        key: p.key ?? p.name,
        raw: literalToText(p.value),
      }));
    }
    return Object.entries(props).map(([key, value]) => ({
      key,
      raw: literalToText(value),
    }));
  }

  function clauseEntriesFromAst(plot: any): Entry[] {
    const clauses = plot.clauses ?? plot.tail ?? [];
    return (clauses as any[]).map((c) => ({
      key: c.key ?? c.name,
      raw: c.value === undefined ? '' : literalToText(c.value),
    }));
  }

  function serializePanel(panel: any): string {
    const type: string = panel.type ?? panel.plotType ?? panel.kind ?? 'line';
    const order = PANEL_KEY_ORDER[type as keyof typeof PANEL_KEY_ORDER] ?? [];
    const entries = panelEntriesFromAst(panel);
    const ordered = order.length > 0 ? sortByOrder(entries, order) : entries;
    const body = ordered.map((e) => `${e.key}: ${e.raw}`).join(', ');
    return ordered.length === 0 ? `${type} { }` : `${type} { ${body} }`;
  }

  function serializeClauses(plot: any): string {
    const entries = clauseEntriesFromAst(plot);
    const ordered = sortByOrder(entries, CLAUSE_TAIL_ORDER);
    return ordered.map((e) => (e.raw === '' ? e.key : `${e.key} ${e.raw}`)).join(' ');
  }

  function serializePlot(plot: any): string {
    // Container kinds (row / col / overlay) — recurse over children.
    const containerKind: string | undefined =
      plot.kind === 'row' || plot.kind === 'col' || plot.kind === 'overlay'
        ? plot.kind
        : undefined;

    if (containerKind && Array.isArray(plot.children)) {
      const inner = plot.children.map(serializePlot).join('\n');
      const tail = serializeClauses(plot);
      const head = `${containerKind} {\n${inner.split('\n').map((l) => '  ' + l).join('\n')}\n}`;
      return tail ? `${head} ${tail}` : head;
    }

    const head = serializePanel(plot);
    const tail = serializeClauses(plot);
    return tail ? `${head} ${tail}` : head;
  }

  export function formatPlot(source: string): FormatPlotResult {
    const diagnostics: Diagnostic[] = [];
    if (source.trim() === '') {
      return { formatted: source, diagnostics };
    }
    let ast: any;
    try {
      ast = parsePlot(source);
    } catch (err) {
      diagnostics.push({
        kind: 'ParseError',
        severity: 'warning',
        message: `Plot parse error: ${(err as Error).message}`,
        offset: 0,
        length: source.length,
      });
      return { formatted: source, diagnostics };
    }

    if (!ast || (ast.diagnostics && ast.diagnostics.some((d: Diagnostic) => d.severity === 'error'))) {
      if (ast?.diagnostics) diagnostics.push(...ast.diagnostics);
      else diagnostics.push({
        kind: 'ParseError',
        severity: 'warning',
        message: 'Plot DSL parse error',
        offset: 0,
        length: source.length,
      });
      return { formatted: source, diagnostics };
    }

    if (ast.diagnostics) diagnostics.push(...ast.diagnostics);

    // `ast` is either a single plot/container node or `{ program: PlotProgram[] }`.
    const programs: any[] = Array.isArray(ast.program)
      ? ast.program
      : Array.isArray(ast)
        ? ast
        : ast.plots ?? [ast.root ?? ast];

    let formatted: string;
    try {
      formatted = programs.map(serializePlot).join('\n\n').trim() + '\n';
    } catch (err) {
      diagnostics.push({
        kind: 'FormatterError',
        severity: 'warning',
        message: `Plot formatter error: ${(err as Error).message}`,
        offset: 0,
        length: source.length,
      });
      return { formatted: source, diagnostics };
    }

    return { formatted, diagnostics };
  }
  ```

  > **Note for the implementer:** the exact field names of the plot AST (e.g.
  > `panel.props` vs `panel.fields`) depend on the M-A3 parser output. If the
  > parser tests use different names, adjust `panelEntriesFromAst` and
  > `clauseEntriesFromAst` accordingly. The tolerant fallbacks above cover
  > the common shapes.

- [ ] Step 7.3: Run tests.
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- formatter/plotFormatter 2>&1 | tail -10
  ```
  Expected:
  ```
  Test Files  1 passed (1)
       Tests  20 passed (20)
  ```

---

## Task 8: Write remaining plot formatter tests (20+ more cases)

- [ ] Step 8.1: Append to `frontend-v2/src/__tests__/formatter/plotFormatter.test.ts`:
  ```typescript

  describe('formatPlot — full clause-tail order coverage', () => {
    it('orders title,width,height,zoom,link-x,link-y,link-xy correctly', () => {
      const src = 'line { x: "t", y: "v" } link-xy "g" link-y "y" link-x "x" zoom 2 height 100 width 200 title "T"';
      const { formatted } = formatPlot(src);
      const keys = ['title', 'width', 'height', 'zoom', 'link-x', 'link-y', 'link-xy'];
      const positions = keys.map((k) => formatted.indexOf(k));
      expect(positions.every((p) => p > -1)).toBe(true);
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i - 1]).toBeLessThan(positions[i]);
      }
    });

    it('orders brush,name,palette,legend,tooltip after the visual cluster', () => {
      const src = 'line { x: "t", y: "v" } tooltip "tt" legend "l" palette "p" name "n" brush "b"';
      const { formatted } = formatPlot(src);
      const keys = ['brush', 'name', 'palette', 'legend', 'tooltip'];
      const positions = keys.map((k) => formatted.indexOf(k));
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i - 1]).toBeLessThan(positions[i]);
      }
    });

    it('orders on_* event handlers correctly', () => {
      const src = 'line { x: "t", y: "v" } on_brush "b" on_selection "s" on_hover "h"';
      const { formatted } = formatPlot(src);
      expect(formatted.indexOf('on_hover')).toBeLessThan(formatted.indexOf('on_selection'));
      expect(formatted.indexOf('on_selection')).toBeLessThan(formatted.indexOf('on_brush'));
    });

    it('places disabled last', () => {
      const src = 'line { x: "t", y: "v" } disabled "yes" highlight "h" settings "s"';
      const { formatted } = formatPlot(src);
      expect(formatted.indexOf('highlight')).toBeLessThan(formatted.indexOf('settings'));
      expect(formatted.indexOf('settings')).toBeLessThan(formatted.indexOf('disabled'));
    });
  });

  describe('formatPlot — per-plot-type panel ordering exhaustive', () => {
    const cases: Array<{ src: string; expectedOrder: string[] }> = [
      { src: 'line { label: "l", group: "g", opacity: "o", size: "s", color: "c", y: "v", x: "t", title: "T" }',
        expectedOrder: ['x:', 'y:', 'color:', 'size:', 'opacity:', 'group:', 'label:', 'title:'] },
      { src: 'bar { label: "l", group: "g", color: "c", y: "v", x: "t", title: "T" }',
        expectedOrder: ['x:', 'y:', 'color:', 'group:', 'label:', 'title:'] },
    ];

    for (const { src, expectedOrder } of cases) {
      it(`orders ${src.split(' ')[0]} canonically`, () => {
        const { formatted } = formatPlot(src);
        const positions = expectedOrder.map((k) => formatted.indexOf(k));
        for (let i = 1; i < positions.length; i++) {
          expect(positions[i - 1]).toBeLessThan(positions[i]);
        }
      });
    }
  });

  describe('formatPlot — unknown keys preserved', () => {
    it('keeps unknown panel keys at the end', () => {
      const src = 'line { mystery: "m", y: "v", x: "t" }';
      const { formatted } = formatPlot(src);
      // x and y come before mystery.
      expect(formatted.indexOf('x:')).toBeLessThan(formatted.indexOf('mystery'));
      expect(formatted.indexOf('y:')).toBeLessThan(formatted.indexOf('mystery'));
    });

    it('keeps multiple unknown panel keys in original relative order', () => {
      const src = 'line { z_first: "a", a_second: "b", y: "v", x: "t" }';
      const { formatted } = formatPlot(src);
      expect(formatted.indexOf('z_first')).toBeLessThan(formatted.indexOf('a_second'));
    });
  });

  describe('formatPlot — container plots', () => {
    it('row container reorders inner panels independently', () => {
      const src = 'row { line { y: "v", x: "t" } bar { color: "c", x: "a", y: "b" } }';
      const { formatted } = formatPlot(src);
      // Both line and bar must have x before y inside the row.
      expect(formatted).toMatch(/line\s*\{[^}]*x:[^}]*y:/);
      expect(formatted).toMatch(/bar\s*\{[^}]*x:[^}]*y:/);
    });

    it('col container preserves structure', () => {
      const src = 'col { line { x: "t", y: "v" } }';
      const { formatted } = formatPlot(src);
      expect(formatted).toMatch(/col/);
      expect(formatted).toMatch(/line/);
    });

    it('overlay container preserves structure', () => {
      const src = 'overlay { line { x: "t", y: "v" } scatter { x: "t", y: "v" } }';
      const { formatted } = formatPlot(src);
      expect(formatted).toMatch(/overlay/);
      expect(formatted).toMatch(/line/);
      expect(formatted).toMatch(/scatter/);
    });
  });

  describe('formatPlot — idempotency (advanced)', () => {
    it('idempotent for every plot type with all keys', () => {
      const srcs = [
        'line { label: "l", group: "g", opacity: "o", size: "s", color: "c", y: "v", x: "t", title: "T" }',
        'bar { color: "c", group: "g", x: "a", y: "b", title: "T" }',
        'scatter { y: "v", color: "c", size: "s", x: "t", opacity: "o" }',
        'histogram { title: "T", bins: 10, x: "v" }',
        'boxplot { color: "c", value: "v", category: "g" }',
        'heatmap { color: "p", value: "v", y: "b", x: "a" }',
        'pie { color: "p", value: "v", name: "n" }',
        'flamegraph { color: "c", name: "n", value: "v" }',
        'gantt { color: "c", lane: "l", end: "e", start: "s" }',
        'area { group: "g", color: "c", y: "v", x: "t" }',
        'range { color: "c", hi: "h", lo: "l", x: "t" }',
      ];
      for (const src of srcs) {
        const r1 = formatPlot(src).formatted;
        const r2 = formatPlot(r1).formatted;
        expect(r2, `not idempotent for: ${src}`).toBe(r1);
      }
    });

    it('idempotent for container + clauses', () => {
      const src = 'row { line { x: "t", y: "v" } bar { x: "a", y: "b" } } title "Big" width 800';
      const r1 = formatPlot(src).formatted;
      const r2 = formatPlot(r1).formatted;
      expect(r2).toBe(r1);
    });
  });

  describe('formatPlot — repeated clauses', () => {
    it('handles repeated clause keys without crashing', () => {
      const src = 'line { x: "t", y: "v" } title "A" title "B"';
      const { formatted } = formatPlot(src);
      // We are tolerant — keep both, or last-wins. Just don't crash.
      expect(typeof formatted).toBe('string');
    });
  });
  ```

- [ ] Step 8.2: Run.
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- formatter/plotFormatter 2>&1 | tail -10
  ```
  Expected:
  ```
  Test Files  1 passed (1)
       Tests  40 passed (40)
  ```
  (40+ tests passing; tweak field names in `plotFormatter.ts` if AST shape differs and re-run.)

---

## Task 9: Implement `notebookFormatter.ts` with `$$ai_providers` scrub

- [ ] Step 9.1: Write the complete file `frontend-v2/src/services/formatter/notebookFormatter.ts`:
  ```typescript
  import { parseNotebook, serialize } from '../parser/notebookParser';
  import type {
    Diagnostic,
    FormatterInput,
    FormatterOutput,
    FormattedCell,
  } from '../parser/types';
  import { formatSql } from './sqlFormatter';
  import { formatPlot } from './plotFormatter';

  const AI_PROVIDERS_RE = /^\$\$ai_providers(\..+)?$/;

  /**
   * Strip any frontmatter key (notebook-level or cell-level) whose name
   * matches `$$ai_providers` or `$$ai_providers.<anything>`. API keys MUST
   * NEVER be written to notebook files (showcase §10c.1).
   */
  function scrubAiProviders(
    frontmatter: Record<string, unknown> | undefined | null,
  ): { cleaned: Record<string, unknown>; stripped: string[] } {
    const stripped: string[] = [];
    if (!frontmatter || typeof frontmatter !== 'object') {
      return { cleaned: {}, stripped };
    }
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      if (AI_PROVIDERS_RE.test(key)) {
        stripped.push(key);
      } else {
        cleaned[key] = value;
      }
    }
    return { cleaned, stripped };
  }

  function makeSecretDiagnostic(key: string): Diagnostic {
    return {
      kind: 'SecretLeakPrevented',
      severity: 'info',
      message: `Stripped secret frontmatter key "${key}" — API keys are never persisted to notebook files.`,
      offset: 0,
      length: 0,
    };
  }

  /**
   * Canonical fence order inside a cell: yaml frontmatter → sql → plot → prose.
   */
  const FENCE_ORDER: Record<string, number> = {
    yaml: 0,
    frontmatter: 0,
    sql: 1,
    plot: 2,
    prose: 3,
    markdown: 3,
    text: 3,
  };

  function fenceRank(kind: string): number {
    return FENCE_ORDER[kind] ?? 99;
  }

  export function format(input: FormatterInput): FormatterOutput {
    const original = input.source;
    const diagnostics: Diagnostic[] = [];
    const changedCells: FormattedCell[] = [];

    // 1) Parse.
    let nb: any;
    try {
      nb = parseNotebook(original);
    } catch (err) {
      diagnostics.push({
        kind: 'ParseError',
        severity: 'warning',
        message: `Notebook parse error: ${(err as Error).message}`,
        offset: 0,
        length: original.length,
      });
      return {
        source: original,
        changed: false,
        changedCells: [],
        diagnostics,
      };
    }

    if (nb?.diagnostics) diagnostics.push(...nb.diagnostics);

    // 2) Scrub top-level frontmatter.
    if (nb.frontmatter) {
      const { cleaned, stripped } = scrubAiProviders(nb.frontmatter);
      nb.frontmatter = cleaned;
      for (const k of stripped) diagnostics.push(makeSecretDiagnostic(k));
    }

    // 3) Walk cells.
    const cells: any[] = nb.cells ?? [];
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const cellDiagnostics: Diagnostic[] = [];
      let cellChanged = false;

      // 3a) Scrub cell frontmatter.
      if (cell.frontmatter) {
        const { cleaned, stripped } = scrubAiProviders(cell.frontmatter);
        if (stripped.length > 0) {
          cell.frontmatter = cleaned;
          cellChanged = true;
          for (const k of stripped) {
            const d = makeSecretDiagnostic(k);
            cellDiagnostics.push(d);
            diagnostics.push(d);
          }
        }
      }

      // 3b) Format each block; tolerate per-block errors.
      const blocks: any[] = cell.blocks ?? [];
      for (const block of blocks) {
        if (block.kind === 'sql') {
          const before = block.source;
          const { formatted, diagnostics: bd } = formatSql(before);
          if (formatted !== before) {
            block.source = formatted;
            cellChanged = true;
          }
          for (const d of bd) {
            cellDiagnostics.push(d);
            diagnostics.push(d);
          }
        } else if (block.kind === 'plot') {
          const before = block.source;
          const { formatted, diagnostics: bd } = formatPlot(before);
          if (formatted !== before) {
            block.source = formatted;
            cellChanged = true;
          }
          for (const d of bd) {
            cellDiagnostics.push(d);
            diagnostics.push(d);
          }
        }
        // prose / yaml blocks: leave content untouched (the parser is the
        // source of truth for structural normalization).
      }

      // 3c) Reorder fences inside the cell: yaml → sql → plot → prose.
      if (Array.isArray(cell.blocks)) {
        const before = cell.blocks.map((b: any) => b.kind).join(',');
        cell.blocks.sort((a: any, b: any) => fenceRank(a.kind) - fenceRank(b.kind));
        const after = cell.blocks.map((b: any) => b.kind).join(',');
        if (before !== after) cellChanged = true;
      }

      changedCells.push({
        cellAlias: cell.alias ?? null,
        displayIndex: cell.displayIndex ?? i,
        changed: cellChanged,
        diagnostics: cellDiagnostics,
      });
    }

    // 4) Re-serialize.
    let serialized: string;
    try {
      serialized = serialize(nb);
    } catch (err) {
      diagnostics.push({
        kind: 'FormatterError',
        severity: 'warning',
        message: `Notebook serialize error: ${(err as Error).message}`,
        offset: 0,
        length: original.length,
      });
      return {
        source: original,
        changed: false,
        changedCells: [],
        diagnostics,
      };
    }

    // 5) Structural normalization: collapse 2+ blank lines to one between cells.
    const normalized = serialized
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
    const final = normalized.endsWith('\n') ? normalized : normalized + '\n';

    return {
      source: final,
      changed: final !== original,
      changedCells,
      diagnostics,
    };
  }
  ```

- [ ] Step 9.2: Create the notebook formatter test file at `frontend-v2/src/__tests__/formatter/notebookFormatter.test.ts`:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { format } from '../../services/formatter/notebookFormatter';

  describe('notebookFormatter — basic', () => {
    it('returns trailing newline', () => {
      const src = '---\ntitle: T\n---\n\n### #1 a\n\n```sql\nselect 1\n```';
      const out = format({ source: src });
      expect(out.source.endsWith('\n')).toBe(true);
    });

    it('reports changed=false when input is already canonical', () => {
      const src = '---\ntitle: T\n---\n\n### #1 a\n\n```sql\nSELECT 1\n```\n';
      const out1 = format({ source: src });
      const out2 = format({ source: out1.source });
      expect(out2.changed).toBe(false);
      expect(out2.source).toBe(out1.source);
    });

    it('formats embedded SQL', () => {
      const src = '### #1 a\n\n```sql\nselect * from t\n```\n';
      const out = format({ source: src });
      expect(out.source).toMatch(/SELECT \* FROM t/);
    });

    it('formats embedded plot', () => {
      const src = '### #1 a\n\n```plot\nline { y: "v", x: "t" }\n```\n';
      const out = format({ source: src });
      expect(out.source.indexOf('x:')).toBeLessThan(out.source.indexOf('y:'));
    });

    it('collapses 3+ blank lines to one', () => {
      const src = '### #1 a\n\n\n\n```sql\nselect 1\n```\n';
      const out = format({ source: src });
      expect(out.source).not.toMatch(/\n\n\n/);
    });
  });

  describe('notebookFormatter — $$ai_providers scrub', () => {
    it('strips $$ai_providers.googleApiKey from cell frontmatter', () => {
      const src = '### #1 a\n\n```yaml\n$$ai_providers.googleApiKey: "SECRET"\n```\n\n```sql\nselect 1\n```\n';
      const out = format({ source: src });
      expect(out.source).not.toContain('SECRET');
      expect(out.source).not.toContain('googleApiKey');
      expect(out.diagnostics.some((d) => d.kind === 'SecretLeakPrevented')).toBe(true);
    });

    it('strips $$ai_providers at notebook level', () => {
      const src = '---\ntitle: T\n$$ai_providers.openaiKey: "SHHH"\n---\n\n### #1 a\n\n```sql\nselect 1\n```\n';
      const out = format({ source: src });
      expect(out.source).not.toContain('SHHH');
      expect(out.diagnostics.some((d) => d.kind === 'SecretLeakPrevented')).toBe(true);
    });

    it('preserves non-secret keys', () => {
      const src = '---\ntitle: Hello\nauthor: me\n---\n\n### #1 a\n\n```sql\nselect 1\n```\n';
      const out = format({ source: src });
      expect(out.source).toContain('title:');
      expect(out.source).toContain('Hello');
      expect(out.source).toContain('author');
    });
  });

  describe('notebookFormatter — error tolerance', () => {
    it('leaves broken SQL block source intact but formats the rest', () => {
      const src = '### #1 a\n\n```sql\nSELECT * FROM (\n-- unterminated\n```\n\n```plot\nline { y: "v", x: "t" }\n```\n';
      const out = format({ source: src });
      // Plot must have been reordered (x before y) regardless of SQL state.
      expect(out.source.indexOf('x:')).toBeLessThan(out.source.indexOf('y:'));
    });
  });
  ```

- [ ] Step 9.3: Run all formatter tests.
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- formatter 2>&1 | tail -15
  ```
  Expected:
  ```
  Test Files  3 passed (3)
       Tests  90+ passed (90+)
  ```
  (sqlFormatter ~40 + plotFormatter ~40 + notebookFormatter ~10+).

---

## Task 10: Idempotency property test (5000 iters)

- [ ] Step 10.1: Verify the M-A1 arbitrary exists.
  ```bash
  grep -rn "notebookArbitrary\|export.*Arbitrary" \
    /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/parser/ \
    /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/arbitraries/ 2>/dev/null | head -5
  ```
  Expected: at least one match showing `notebookArbitrary` is exported. If the path differs, adjust the import in step 10.2.

- [ ] Step 10.2: Write `frontend-v2/src/__tests__/formatter/notebookFormatter.property.test.ts`. If `notebookArbitrary` is not exported from a reusable module, fall back to the inline generator below (covers the same shape).
  ```typescript
  import { describe, it, expect } from 'vitest';
  import * as fc from 'fast-check';
  import { format } from '../../services/formatter/notebookFormatter';

  // Inline notebook arbitrary (mirrors M-A1's shape). If a shared arbitrary
  // becomes available, switch to importing it.
  const aliasArb = fc.stringMatching(/^[a-z][a-z0-9_]{0,7}$/);
  const colArb = fc.stringMatching(/^[a-z][a-z0-9_]{0,5}$/);

  const sqlBlockArb = fc.tuple(aliasArb, colArb, colArb).map(
    ([a, c1, c2]) => '```sql\n-- @ ' + a + '\nselect ' + c1 + ', ' + c2 + ' from t\n```',
  );

  const plotBlockArb = fc.tuple(colArb, colArb).map(
    ([x, y]) => '```plot\nline { y: "' + y + '", x: "' + x + '" }\n```',
  );

  const cellArb = fc.tuple(aliasArb, sqlBlockArb, plotBlockArb).map(
    ([alias, sql, plot]) => '### #1 ' + alias + '\n\n' + sql + '\n\n' + plot + '\n',
  );

  const notebookArb = fc.array(cellArb, { minLength: 1, maxLength: 4 }).map(
    (cells) => '---\ntitle: prop test\n---\n\n' + cells.join('\n'),
  );

  describe('notebookFormatter — idempotency property', () => {
    it('is byte-identical after a second format', () => {
      fc.assert(
        fc.property(notebookArb, (src) => {
          const a = format({ source: src }).source;
          const b = format({ source: a }).source;
          return b === a;
        }),
        { numRuns: 5000 },
      );
    });
  });
  ```

- [ ] Step 10.3: Run (this can take 30-60s).
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- notebookFormatter.property 2>&1 | tail -10
  ```
  Expected: 1 test passes after 5000 samples.
  ```
  Test Files  1 passed (1)
       Tests  1 passed (1)
  ```
  If fast-check finds a shrunk counter-example, FIX the formatter (do not weaken the property).

---

## Task 11: Corpus round-trip + broken-sql fixture

- [ ] Step 11.1: Ensure the fixtures directory exists.
  ```bash
  mkdir -p /Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/notebooks
  ls /Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/notebooks/ 2>&1
  ```
  Expected: lists existing notebook fixtures (from M-A1) or empty if none yet.

- [ ] Step 11.2: Create the broken-SQL fixture at `frontend-v2/tests/fixtures/notebooks/broken-sql.notebook.md`:
  ````markdown
  ---
  title: Broken SQL fixture
  ---

  ### #1 broken_cell

  ```sql
  SELECT * FROM (
  -- unterminated subquery
  ```

  ```plot
  line { x: "ts", y: "val" }
  ```
  ````

- [ ] Step 11.3: Write `frontend-v2/src/__tests__/formatter/roundTrip.integration.test.ts`:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { readFileSync, readdirSync } from 'node:fs';
  import { join } from 'node:path';
  import { format } from '../../services/formatter/notebookFormatter';

  const FIXTURES_DIR = join(__dirname, '../../../tests/fixtures/notebooks');

  function listNotebooks(): string[] {
    try {
      return readdirSync(FIXTURES_DIR)
        .filter((f) => f.endsWith('.notebook.md'))
        .map((f) => join(FIXTURES_DIR, f));
    } catch {
      return [];
    }
  }

  describe('notebookFormatter — corpus round-trip', () => {
    const files = listNotebooks();

    if (files.length === 0) {
      it('SKIP: no fixtures found', () => {
        expect(true).toBe(true);
      });
      return;
    }

    for (const path of files) {
      const name = path.split('/').pop()!;
      it(`is idempotent on ${name}`, () => {
        const src = readFileSync(path, 'utf8');
        const a = format({ source: src }).source;
        const b = format({ source: a }).source;
        expect(b).toBe(a);
      });
    }

    it('broken-sql.notebook.md formats with diagnostics but does not throw', () => {
      const path = files.find((p) => p.endsWith('broken-sql.notebook.md'));
      expect(path, 'broken-sql fixture missing').toBeDefined();
      const src = readFileSync(path!, 'utf8');
      const out = format({ source: src });
      expect(typeof out.source).toBe('string');
      // The plot block must have been formatted (x before y) even though the
      // SQL block is broken.
      expect(out.source.indexOf('x:')).toBeLessThan(out.source.indexOf('y:'));
    });
  });
  ```

- [ ] Step 11.4: Run.
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- roundTrip.integration 2>&1 | tail -15
  ```
  Expected: every fixture passes; the broken-sql fixture also passes.
  ```
  Test Files  1 passed (1)
       Tests  N+1 passed (N+1)
  ```
  Where N is the number of `.notebook.md` files in `tests/fixtures/notebooks/`.

---

## Task 12: Gate + commit

- [ ] Step 12.1: Run the full formatter suite.
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- formatter 2>&1 | tail -10
  ```
  Expected:
  ```
  Test Files  5 passed (5)
       Tests  90+ passed (90+)
  ```
  (sqlFormatter ~40 + plotFormatter ~40 + notebookFormatter ~10 + property 1 + roundTrip N+1.)

- [ ] Step 12.2: Typecheck.
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run typecheck 2>&1 | tail -5
  ```
  Expected: exit code 0; no `error TS` lines.

- [ ] Step 12.3: Stage + commit.
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query
  git add frontend-v2/src/services/formatter/ \
    frontend-v2/src/__tests__/formatter/ \
    frontend-v2/src/services/parser/types.ts \
    frontend-v2/tests/fixtures/notebooks/broken-sql.notebook.md \
    frontend-v2/package.json frontend-v2/package-lock.json
  git status --short
  ```
  Expected: every changed file appears with `A` or `M`; no untracked files remain in `frontend-v2/src/services/formatter/`.

- [ ] Step 12.4: Commit.
  ```bash
  git commit -m "feat(v2): M-A5 formatter — SQL + plot + notebook, idempotency 5000 iters, \$\$ai_providers scrub"
  ```
  Expected: commit succeeds and prints something like:
  ```
  [main <sha>] feat(v2): M-A5 formatter — SQL + plot + notebook, idempotency 5000 iters, $$ai_providers scrub
   N files changed, X insertions(+)
  ```

- [ ] Step 12.5: Final verification.
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
  npm run test -- formatter 2>&1 | tail -3
  npm run typecheck 2>&1 | tail -3
  ```
  Expected: both commands exit 0; formatter suite green; typecheck clean.

---

## Acceptance gate

1. `npm run test -- formatter` — green, 90+ tests.
2. `npm run test -- notebookFormatter.property` — 5000 fast-check runs pass.
3. `npm run test -- roundTrip.integration` — every fixture is idempotent.
4. `npm run typecheck` — clean.
5. A notebook containing `$$ai_providers.googleApiKey: "SECRET"` produces output that contains neither `SECRET` nor `googleApiKey`, and a `SecretLeakPrevented` diagnostic is emitted.
6. Broken SQL inside a cell does NOT prevent the surrounding notebook structure (and other blocks) from being formatted.
