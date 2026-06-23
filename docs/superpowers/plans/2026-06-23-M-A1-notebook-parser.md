# M-A1: Notebook Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `parseNotebook` + `serialize` with byte-exact round-trip for all legal `.notebook.md` inputs; property test at 1000 iterations.

**Architecture:** Line-by-line state-machine parser; no regex-only approach; serialize reconstructs verbatim. Fast-check property test as a regression harness.

**Tech Stack:** TypeScript 5.8, fast-check 3.22, Vitest 4.1

---

## Conventions

- **Working directory for every shell step:** `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/`. Each `cd` is shown explicitly.
- **Repo root:** `/Users/i560383_1/code/experiments/jfr-query/`.
- **Module spec:** ESM. Vitest 4 + TS 5.8. Path alias `@/services/*` → `src/services/*` (already wired in `tsconfig.app.json`).
- **No new runtime deps.** `fast-check@3.22.0` is already a devDependency. No `js-yaml`: the parser stores YAML blocks verbatim and decodes a small subset (flat `key: scalar` and `key: [a, b]`) by hand. This is sufficient for the M-A1 scope; richer YAML lands in later milestones if needed.
- **Round-trip is the load-bearing invariant.** Every cell, every byte. Never throw — diagnostics only.

---

## Task 1 — Define AST types

- [x] Create `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/types.ts` with the exact contents below.

```typescript
// frontend-v2/src/services/parser/types.ts
// AST types for the .notebook.md parser. Canonical shapes per the v2 redesign.

export type NotebookVersion = '2.0';

export interface NotebookFrontmatter {
  version?: NotebookVersion;
  title?: string;
  description?: string;
  variables?: Record<string, string>;
  // Unknown keys are preserved verbatim by the parser/serializer.
  [key: string]: unknown;
}

export interface CellFrontmatter {
  pinned?: boolean;
  hidden?: boolean;
  autorun?: boolean;
  deps?: string[];
  style?: string;
  last_ai_prompt?: string;
  materialize?: boolean;
  record_interactions?: boolean;
  [key: string]: unknown;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type DiagnosticKind =
  | 'FenceOrderWarning'
  | 'UnterminatedFence'
  | 'MissingCellAlias'
  | 'UnknownFrontmatterKey';

export interface Diagnostic {
  kind: DiagnosticKind;
  severity: DiagnosticSeverity;
  message: string;
  offset: number; // byte offset in the source string
  length: number;
}

export interface SqlBlock {
  kind: 'sql';
  source: string; // raw text between the fences, including trailing newline
}

export interface PlotBlock {
  kind: 'plot';
  source: string;
}

export interface ViewBlock {
  kind: 'view';
  name: string;
  source: string;
}

export interface MacroBlock {
  kind: 'macro';
  name: string;
  source: string;
}

export interface ProseBlock {
  kind: 'prose';
  source: string;
}

export type CellBlock = SqlBlock | PlotBlock | ViewBlock | MacroBlock | ProseBlock;

export interface Cell {
  displayIndex: number;          // N from the `### #N <alias>` heading
  alias: string | null;          // null only when the heading omitted the alias token
  frontmatter: CellFrontmatter;  // possibly empty
  blocks: CellBlock[];
  _raw?: string;                 // verbatim source span — used for illegal cells we cannot reconstruct
}

export interface Notebook {
  frontmatter: NotebookFrontmatter;
  cells: Cell[];
}
```

- [x] Verify file exists and parses by running:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx tsc --noEmit src/services/parser/types.ts
```

Expected output: no output (exit 0).

---

## Task 2 — Failing test: empty notebook

- [x] Create `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/parser/notebookParser.test.ts` with this initial content:

```typescript
// frontend-v2/src/__tests__/parser/notebookParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseNotebook, serialize } from '@/services/parser/notebookParser';

describe('parseNotebook — empty input', () => {
  it('returns empty notebook with no diagnostics', () => {
    const result = parseNotebook('');
    expect(result.notebook).toEqual({ frontmatter: {}, cells: [] });
    expect(result.diagnostics).toEqual([]);
  });

  it('serialize(parseNotebook("").notebook) === ""', () => {
    const { notebook } = parseNotebook('');
    expect(serialize(notebook)).toBe('');
  });
});
```

- [x] Run the test and confirm it fails because the module does not exist:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- notebookParser
```

Expected output (key lines):
```
FAIL  src/__tests__/parser/notebookParser.test.ts
Error: Failed to resolve import "@/services/parser/notebookParser"
Test Files  1 failed (1)
     Tests  no tests
```

- [x] Create the parser module skeleton at `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/notebookParser.ts`:

```typescript
// frontend-v2/src/services/parser/notebookParser.ts
import type { Notebook, Diagnostic } from './types';

export interface ParseResult {
  notebook: Notebook;
  diagnostics: Diagnostic[];
}

export function parseNotebook(_src: string): ParseResult {
  return { notebook: { frontmatter: {}, cells: [] }, diagnostics: [] };
}

export function serialize(_notebook: Notebook): string {
  return '';
}
```

- [x] Re-run and confirm both tests pass:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- notebookParser
```

Expected output (key lines):
```
 ✓ src/__tests__/parser/notebookParser.test.ts (2)
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

---

## Task 3 — Failing test: notebook frontmatter

- [x] Append the following `describe` block to `src/__tests__/parser/notebookParser.test.ts` (place it at end of file, before final newline):

```typescript
describe('parseNotebook — notebook frontmatter', () => {
  it('captures title from leading YAML block', () => {
    const src = '---\ntitle: Foo\n---\n';
    const { notebook, diagnostics } = parseNotebook(src);
    expect(notebook.frontmatter.title).toBe('Foo');
    expect(notebook.cells).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it('captures description and unknown keys verbatim', () => {
    const src = '---\ntitle: Foo\ndescription: A demo notebook\ncustom_flag: yes\n---\n';
    const { notebook } = parseNotebook(src);
    expect(notebook.frontmatter.title).toBe('Foo');
    expect(notebook.frontmatter.description).toBe('A demo notebook');
    // Unknown keys are preserved as string (verbatim policy).
    expect(notebook.frontmatter.custom_flag).toBe('yes');
  });

  it('round-trips frontmatter-only source byte-for-byte', () => {
    const src = '---\ntitle: Foo\ndescription: bar\n---\n';
    const { notebook } = parseNotebook(src);
    expect(serialize(notebook)).toBe(src);
  });
});
```

- [x] Run and confirm these three tests fail (existing two still pass):

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- notebookParser
```

Expected output (key lines):
```
 ❯ parseNotebook — notebook frontmatter (3)
   × captures title from leading YAML block
   × captures description and unknown keys verbatim
   × round-trips frontmatter-only source byte-for-byte
 Test Files  1 failed (1)
      Tests  3 failed | 2 passed (5)
```

---

## Task 4 — Failing tests: single SQL cell

- [x] Append to `src/__tests__/parser/notebookParser.test.ts`:

```typescript
describe('parseNotebook — single SQL cell', () => {
  it('parses one SQL cell with alias and displayIndex', () => {
    const src = '### #1 my_cell\n```sql\nSELECT 1\n```\n';
    const { notebook, diagnostics } = parseNotebook(src);
    expect(diagnostics).toEqual([]);
    expect(notebook.cells).toHaveLength(1);
    expect(notebook.cells[0].displayIndex).toBe(1);
    expect(notebook.cells[0].alias).toBe('my_cell');
    expect(notebook.cells[0].blocks).toHaveLength(1);
    expect(notebook.cells[0].blocks[0]).toEqual({ kind: 'sql', source: 'SELECT 1\n' });
  });

  it('round-trips a single SQL cell byte-for-byte', () => {
    const src = '### #1 my_cell\n```sql\nSELECT 1\n```\n';
    const { notebook } = parseNotebook(src);
    expect(serialize(notebook)).toBe(src);
  });
});
```

- [x] Confirm both new tests fail:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- notebookParser
```

Expected output (key lines):
```
 ❯ parseNotebook — single SQL cell (2)
   × parses one SQL cell with alias and displayIndex
   × round-trips a single SQL cell byte-for-byte
      Tests  5 failed | 2 passed (7)
```

---

## Task 5 — Failing tests: all five fence kinds

- [x] Append to `src/__tests__/parser/notebookParser.test.ts`:

```typescript
describe('parseNotebook — all five fence kinds', () => {
  it('parses a sql fence', () => {
    const src = '### #1 a\n```sql\nSELECT 1\n```\n';
    const { notebook } = parseNotebook(src);
    expect(notebook.cells[0].blocks[0]).toEqual({ kind: 'sql', source: 'SELECT 1\n' });
  });

  it('parses a plot fence', () => {
    const src = '### #1 a\n```plot\nline { x: t; y: v }\n```\n';
    const { notebook } = parseNotebook(src);
    expect(notebook.cells[0].blocks[0]).toEqual({ kind: 'plot', source: 'line { x: t; y: v }\n' });
  });

  it('parses a view fence with name capture', () => {
    const src = '### #1 a\n```view my_view\nSELECT * FROM t\n```\n';
    const { notebook } = parseNotebook(src);
    expect(notebook.cells[0].blocks[0]).toEqual({
      kind: 'view',
      name: 'my_view',
      source: 'SELECT * FROM t\n',
    });
  });

  it('parses a macro fence with name capture', () => {
    const src = '### #1 a\n```macro pct\n(col, p) => quantile_cont(col, p / 100)\n```\n';
    const { notebook } = parseNotebook(src);
    expect(notebook.cells[0].blocks[0]).toEqual({
      kind: 'macro',
      name: 'pct',
      source: '(col, p) => quantile_cont(col, p / 100)\n',
    });
  });

  it('treats text outside known fences as a prose block', () => {
    const src = '### #1 a\nHello, this is prose.\nSecond line.\n';
    const { notebook } = parseNotebook(src);
    expect(notebook.cells[0].blocks).toHaveLength(1);
    expect(notebook.cells[0].blocks[0]).toEqual({
      kind: 'prose',
      source: 'Hello, this is prose.\nSecond line.\n',
    });
  });

  it('round-trips each fence kind byte-for-byte', () => {
    const sources = [
      '### #1 a\n```sql\nSELECT 1\n```\n',
      '### #1 a\n```plot\nline { x: t; y: v }\n```\n',
      '### #1 a\n```view my_view\nSELECT * FROM t\n```\n',
      '### #1 a\n```macro pct\n(col, p) => quantile_cont(col, p / 100)\n```\n',
      '### #1 a\nHello, this is prose.\nSecond line.\n',
    ];
    for (const src of sources) {
      const { notebook } = parseNotebook(src);
      expect(serialize(notebook)).toBe(src);
    }
  });
});
```

- [x] Confirm the six new tests fail:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- notebookParser
```

Expected output (key lines):
```
 ❯ parseNotebook — all five fence kinds (6)
   × parses a sql fence
   × parses a plot fence
   × parses a view fence with name capture
   × parses a macro fence with name capture
   × treats text outside known fences as a prose block
   × round-trips each fence kind byte-for-byte
      Tests  11 failed | 2 passed (13)
```

---

## Task 6 — Failing tests: cell frontmatter keys

- [x] Append to `src/__tests__/parser/notebookParser.test.ts`:

```typescript
describe('parseNotebook — cell frontmatter keys', () => {
  it('captures pinned/hidden/autorun/deps', () => {
    const src =
      '### #1 a\n' +
      '```yaml\n' +
      'pinned: true\n' +
      'hidden: false\n' +
      'autorun: true\n' +
      'deps: [other_cell]\n' +
      '```\n' +
      '```sql\n' +
      'SELECT 1\n' +
      '```\n';
    const { notebook, diagnostics } = parseNotebook(src);
    expect(diagnostics).toEqual([]);
    const fm = notebook.cells[0].frontmatter;
    expect(fm.pinned).toBe(true);
    expect(fm.hidden).toBe(false);
    expect(fm.autorun).toBe(true);
    expect(fm.deps).toEqual(['other_cell']);
  });

  it('round-trips a cell with frontmatter byte-for-byte', () => {
    const src =
      '### #1 a\n' +
      '```yaml\n' +
      'pinned: true\n' +
      'deps: [other_cell]\n' +
      '```\n' +
      '```sql\n' +
      'SELECT 1\n' +
      '```\n';
    const { notebook } = parseNotebook(src);
    expect(serialize(notebook)).toBe(src);
  });
});
```

- [x] Confirm both new tests fail:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- notebookParser
```

Expected output (key lines):
```
 ❯ parseNotebook — cell frontmatter keys (2)
   × captures pinned/hidden/autorun/deps
   × round-trips a cell with frontmatter byte-for-byte
      Tests  13 failed | 2 passed (15)
```

---

## Task 7 — Failing tests: error / edge cases (never throws)

- [x] Append to `src/__tests__/parser/notebookParser.test.ts`:

```typescript
describe('parseNotebook — error tolerance', () => {
  it('emits UnterminatedFence and never throws when fence is unclosed at EOF', () => {
    const src = '### #1 a\n```sql\nSELECT 1\n';
    let result!: ReturnType<typeof parseNotebook>;
    expect(() => {
      result = parseNotebook(src);
    }).not.toThrow();
    const kinds = result.diagnostics.map((d) => d.kind);
    expect(kinds).toContain('UnterminatedFence');
    // The remaining content becomes a prose block so nothing is lost.
    expect(result.notebook.cells[0].blocks.some((b) => b.kind === 'prose')).toBe(true);
  });

  it('two-hash heading (## #1 foo) is NOT a cell heading; emits a diagnostic', () => {
    const src = '## #1 foo\nhello\n';
    const { notebook, diagnostics } = parseNotebook(src);
    expect(notebook.cells).toEqual([]); // not a cell
    expect(diagnostics.some((d) => d.kind === 'FenceOrderWarning' || d.severity === 'warning')).toBe(
      true,
    );
  });

  it('four-hash heading (#### #1 foo) is NOT a cell heading; emits a diagnostic', () => {
    const src = '#### #1 foo\nhello\n';
    const { notebook, diagnostics } = parseNotebook(src);
    expect(notebook.cells).toEqual([]);
    expect(diagnostics.some((d) => d.severity === 'warning' || d.severity === 'info')).toBe(true);
  });

  it('cell heading with no alias produces alias === null and MissingCellAlias diagnostic', () => {
    const src = '### #1\n```sql\nSELECT 1\n```\n';
    const { notebook, diagnostics } = parseNotebook(src);
    expect(notebook.cells).toHaveLength(1);
    expect(notebook.cells[0].alias).toBe(null);
    expect(diagnostics.some((d) => d.kind === 'MissingCellAlias')).toBe(true);
  });

  it('out-of-order fences emit FenceOrderWarning but still parse', () => {
    const src =
      '### #1 a\n' +
      '```plot\n' +
      'line { x: t; y: v }\n' +
      '```\n' +
      '```sql\n' +
      'SELECT 1\n' +
      '```\n';
    const { notebook, diagnostics } = parseNotebook(src);
    expect(notebook.cells[0].blocks).toHaveLength(2);
    expect(diagnostics.some((d) => d.kind === 'FenceOrderWarning')).toBe(true);
  });
});
```

- [x] Confirm the five new tests fail:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- notebookParser
```

Expected output (key lines):
```
 ❯ parseNotebook — error tolerance (5)
      Tests  18 failed | 2 passed (20)
```

---

## Task 8 — Failing tests: serialize round-trip for hand-authored sources

- [x] Append to `src/__tests__/parser/notebookParser.test.ts`:

```typescript
describe('serialize — byte-exact round-trip', () => {
  const SAMPLES = [
    // plain: one SQL cell, no frontmatter
    '### #1 a\n```sql\nSELECT 1\n```\n',
    // with notebook + cell frontmatter
    '---\n' +
      'title: Demo\n' +
      'description: A small notebook\n' +
      '---\n' +
      '### #1 a\n' +
      '```yaml\n' +
      'pinned: true\n' +
      '```\n' +
      '```sql\n' +
      'SELECT 1\n' +
      '```\n',
    // multi-cell with blank lines between cells
    '### #1 a\n' +
      '```sql\n' +
      'SELECT 1\n' +
      '```\n' +
      '\n' +
      '### #2 b\n' +
      '```sql\n' +
      'SELECT 2 FROM a\n' +
      '```\n',
  ];

  it.each(SAMPLES)('round-trips sample byte-for-byte', (src) => {
    const { notebook } = parseNotebook(src);
    expect(serialize(notebook)).toBe(src);
  });
});
```

- [x] Confirm the three new tests fail:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- notebookParser
```

Expected output (key lines):
```
 ❯ serialize — byte-exact round-trip (3)
      Tests  21 failed | 2 passed (23)
```

---

## Task 9 — Implement `parseNotebook`

- [x] Replace the contents of `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/notebookParser.ts` with the full implementation below. This file also contains `serialize` (implemented in Task 10). For Task 9, paste the full file as a single edit — both `parseNotebook` and `serialize` ship together because the round-trip tests cannot pass otherwise.

```typescript
// frontend-v2/src/services/parser/notebookParser.ts
//
// Line-by-line state machine. The source is split on \n while remembering whether
// each original line ended with \r\n. We then walk top-down:
//
//   1. Optional notebook YAML frontmatter (--- ... ---)
//   2. Zero or more cells, each introduced by a "### #N <alias>" heading
//   3. Between cells, blank lines belong to the *preceding* cell's trailing
//      whitespace (so they round-trip).
//
// A cell body is a sequence of blocks: an optional yaml fence (treated as
// frontmatter, not a CellBlock), then zero or more fences (sql/plot/view/macro)
// and prose runs. Prose is any run of lines inside a cell that are not part of
// a known fence. Order is checked against [yaml, sql, plot, view*|macro*, prose]
// and a FenceOrderWarning is emitted on deviation — but parsing continues.

import type {
  Cell,
  CellBlock,
  CellFrontmatter,
  Diagnostic,
  Notebook,
  NotebookFrontmatter,
} from './types';

export interface ParseResult {
  notebook: Notebook;
  diagnostics: Diagnostic[];
}

// Round-trip needs the original line endings. We split into "logical" lines
// while recording a per-line ending suffix ("\n", "\r\n", or "" for the
// trailing line when there is no final newline).
interface SrcLine {
  text: string;   // line content WITHOUT the trailing newline
  end: string;    // "\n" | "\r\n" | "" (last line, no trailing newline)
  offset: number; // byte offset of `text[0]` in the original source
}

function splitLines(src: string): SrcLine[] {
  const out: SrcLine[] = [];
  let i = 0;
  let lineStart = 0;
  while (i < src.length) {
    const ch = src.charCodeAt(i);
    if (ch === 0x0a /* \n */) {
      out.push({ text: src.slice(lineStart, i), end: '\n', offset: lineStart });
      i += 1;
      lineStart = i;
    } else if (ch === 0x0d /* \r */ && src.charCodeAt(i + 1) === 0x0a) {
      out.push({ text: src.slice(lineStart, i), end: '\r\n', offset: lineStart });
      i += 2;
      lineStart = i;
    } else {
      i += 1;
    }
  }
  if (lineStart < src.length) {
    out.push({ text: src.slice(lineStart), end: '', offset: lineStart });
  }
  return out;
}

const CELL_HEADING_RE = /^### #(\d+)(?:\s+([a-z][a-z0-9_]*))?\s*$/;
const FENCE_OPEN_RE = /^```(sql|plot|yaml|view|macro)(?:\s+([A-Za-z_][A-Za-z0-9_]*))?\s*$/;
const FENCE_CLOSE_RE = /^```\s*$/;
const TWO_HASH_RE = /^## #\d+(?:\s+[a-z][a-z0-9_]*)?\s*$/;
const FOUR_HASH_RE = /^#### #\d+(?:\s+[a-z][a-z0-9_]*)?\s*$/;

// Expected fence order within a cell (yaml is consumed into frontmatter and not
// part of `blocks`, but its position is still validated).
type OrderKind = 'yaml' | 'sql' | 'plot' | 'view' | 'macro' | 'prose';
const ORDER_RANK: Record<OrderKind, number> = {
  yaml: 0,
  sql: 1,
  plot: 2,
  view: 3,
  macro: 3, // view+macro share a tier; either may precede the other
  prose: 4,
};

interface ParserState {
  lines: SrcLine[];
  idx: number;
  diagnostics: Diagnostic[];
  src: string;
}

function peek(state: ParserState): SrcLine | undefined {
  return state.lines[state.idx];
}

function advance(state: ParserState): SrcLine | undefined {
  return state.lines[state.idx++];
}

function pushDiag(
  state: ParserState,
  kind: Diagnostic['kind'],
  severity: Diagnostic['severity'],
  message: string,
  offset: number,
  length: number,
): void {
  state.diagnostics.push({ kind, severity, message, offset, length });
}

// -- YAML decoding (small subset) --------------------------------------------
//
// We support flat `key: scalar` lines and `key: [a, b, c]` inline arrays.
// Scalars: bare strings, true/false, integers. Everything else (including
// quoted strings) is preserved as a string. This is enough for the M-A1
// frontmatter contract; richer YAML is out of scope.

function decodeYaml(body: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const valueRaw = line.slice(colon + 1).trim();
    out[key] = decodeYamlScalar(valueRaw);
  }
  return out;
}

function decodeYamlScalar(s: string): unknown {
  if (s === '') return '';
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((p) => decodeYamlScalar(p.trim()));
  }
  // strip surrounding quotes if present
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// -- Top-level parser --------------------------------------------------------

export function parseNotebook(src: string): ParseResult {
  const state: ParserState = {
    lines: splitLines(src),
    idx: 0,
    diagnostics: [],
    src,
  };

  const frontmatter = parseNotebookFrontmatter(state);
  const cells: Cell[] = [];

  // Drop any stray non-cell preamble lines, with a diagnostic for ## / ####
  // pseudo-headings. (Anything else outside a cell is ignored at M-A1.)
  while (state.idx < state.lines.length) {
    const line = peek(state)!;
    if (CELL_HEADING_RE.test(line.text)) break;
    if (TWO_HASH_RE.test(line.text) || FOUR_HASH_RE.test(line.text)) {
      pushDiag(
        state,
        'FenceOrderWarning',
        'warning',
        'Cell headings must use exactly three hashes (### #N alias).',
        line.offset,
        line.text.length,
      );
    }
    advance(state);
  }

  while (state.idx < state.lines.length) {
    const cell = parseCell(state);
    if (cell) cells.push(cell);
    else break;
  }

  return { notebook: { frontmatter, cells }, diagnostics: state.diagnostics };
}

function parseNotebookFrontmatter(state: ParserState): NotebookFrontmatter {
  const first = peek(state);
  if (!first || first.text !== '---') return {};
  // Find the closing ---
  let j = state.idx + 1;
  while (j < state.lines.length && state.lines[j].text !== '---') j += 1;
  if (j >= state.lines.length) {
    // unterminated — treat as no frontmatter
    return {};
  }
  // collect raw between fences
  const bodyLines = state.lines.slice(state.idx + 1, j);
  const body = bodyLines.map((l) => l.text).join('\n');
  const decoded = decodeYaml(body) as NotebookFrontmatter;
  // advance past the closing ---
  state.idx = j + 1;
  // remember the raw body so serialize() can write it back verbatim
  Object.defineProperty(decoded, '__raw__', {
    value: { lines: bodyLines.map((l) => ({ text: l.text, end: l.end })), openEnd: first.end, closeEnd: state.lines[j].end },
    enumerable: false,
  });
  return decoded;
}

function parseCell(state: ParserState): Cell | null {
  const heading = peek(state);
  if (!heading) return null;

  const match = CELL_HEADING_RE.exec(heading.text);
  if (!match) {
    // skip lines that are not a heading; report two/four-hash pseudo-headings
    if (TWO_HASH_RE.test(heading.text) || FOUR_HASH_RE.test(heading.text)) {
      pushDiag(
        state,
        'FenceOrderWarning',
        'warning',
        'Cell headings must use exactly three hashes (### #N alias).',
        heading.offset,
        heading.text.length,
      );
    }
    advance(state);
    return null;
  }

  const displayIndex = Number(match[1]);
  const alias = match[2] ?? null;
  if (alias === null) {
    pushDiag(
      state,
      'MissingCellAlias',
      'warning',
      `Cell #${displayIndex} has no alias. Add a short snake_case name after the index.`,
      heading.offset,
      heading.text.length,
    );
  }
  // remember the heading's line ending so we can write it back verbatim
  const headingEnd = heading.end;
  advance(state);

  let frontmatter: CellFrontmatter = {};
  const blocks: CellBlock[] = [];
  // Track the trailing blank-line run after the cell so it round-trips.
  let trailingBlanks: SrcLine[] = [];

  let lastOrderRank = -1;

  // Accumulator for prose runs
  const proseRun: SrcLine[] = [];

  const flushProse = (): void => {
    if (proseRun.length === 0) return;
    const text = proseRun.map((l) => l.text + l.end).join('');
    blocks.push({ kind: 'prose', source: text });
    if (lastOrderRank > ORDER_RANK.prose) {
      pushDiag(
        state,
        'FenceOrderWarning',
        'info',
        'Prose appears before a fenced block in this cell.',
        proseRun[0].offset,
        text.length,
      );
    }
    lastOrderRank = Math.max(lastOrderRank, ORDER_RANK.prose);
    proseRun.length = 0;
  };

  while (state.idx < state.lines.length) {
    const line = state.lines[state.idx];

    // Next cell?
    if (CELL_HEADING_RE.test(line.text)) break;

    // Open fence?
    const fenceOpen = FENCE_OPEN_RE.exec(line.text);
    if (fenceOpen) {
      flushProse();
      const kind = fenceOpen[1] as 'sql' | 'plot' | 'yaml' | 'view' | 'macro';
      const name = fenceOpen[2];
      const openLine = line;
      advance(state);
      const bodyLines: SrcLine[] = [];
      let closed = false;
      while (state.idx < state.lines.length) {
        const inner = state.lines[state.idx];
        if (FENCE_CLOSE_RE.test(inner.text)) {
          closed = true;
          break;
        }
        if (CELL_HEADING_RE.test(inner.text)) {
          break;
        }
        bodyLines.push(inner);
        advance(state);
      }
      const bodyText = bodyLines.map((l) => l.text + l.end).join('');
      if (!closed) {
        pushDiag(
          state,
          'UnterminatedFence',
          'error',
          `Fence opened with \`\`\`${kind}${name ? ' ' + name : ''} was not closed before end of cell.`,
          openLine.offset,
          openLine.text.length,
        );
        // Demote the opener + body to a prose block so nothing is lost.
        const proseSource =
          openLine.text + openLine.end + bodyText;
        blocks.push({ kind: 'prose', source: proseSource });
        lastOrderRank = Math.max(lastOrderRank, ORDER_RANK.prose);
        continue;
      }
      const closeLine = state.lines[state.idx];
      advance(state); // consume close fence

      // Validate order
      const rank = ORDER_RANK[kind];
      if (rank < lastOrderRank) {
        pushDiag(
          state,
          'FenceOrderWarning',
          'warning',
          `Fence \`${kind}\` appears out of canonical order (yaml → sql → plot → view/macro → prose).`,
          openLine.offset,
          openLine.text.length,
        );
      }
      lastOrderRank = Math.max(lastOrderRank, rank);

      if (kind === 'yaml') {
        const flat = decodeYaml(bodyLines.map((l) => l.text).join('\n')) as CellFrontmatter;
        frontmatter = flat;
        Object.defineProperty(frontmatter, '__raw__', {
          value: {
            openLine: { text: openLine.text, end: openLine.end },
            bodyLines: bodyLines.map((l) => ({ text: l.text, end: l.end })),
            closeLine: { text: closeLine.text, end: closeLine.end },
          },
          enumerable: false,
        });
      } else if (kind === 'view' || kind === 'macro') {
        blocks.push({
          kind,
          name: name ?? '',
          source: bodyText,
          // squirrel away the exact fence-line endings for round-tripping
          // (non-enumerable so it doesn't leak into equality checks)
        } as CellBlock);
        Object.defineProperty(blocks[blocks.length - 1], '__raw__', {
          value: {
            openLine: { text: openLine.text, end: openLine.end },
            closeLine: { text: closeLine.text, end: closeLine.end },
          },
          enumerable: false,
        });
      } else {
        blocks.push({ kind, source: bodyText } as CellBlock);
        Object.defineProperty(blocks[blocks.length - 1], '__raw__', {
          value: {
            openLine: { text: openLine.text, end: openLine.end },
            closeLine: { text: closeLine.text, end: closeLine.end },
          },
          enumerable: false,
        });
      }
      continue;
    }

    // Blank line: if we have not yet emitted any block, it counts as prose;
    // otherwise we hold it pending and decide on flush whether it's trailing.
    if (line.text === '') {
      // Pull blank lines into the trailing-blanks buffer; if more content
      // follows in this cell, they were inter-block whitespace inside prose.
      trailingBlanks.push(line);
      advance(state);
      continue;
    }

    // Non-empty, non-fence, non-heading: prose. Flush any pending blank lines
    // into the current prose run first.
    if (trailingBlanks.length > 0) {
      for (const b of trailingBlanks) proseRun.push(b);
      trailingBlanks = [];
    }
    proseRun.push(line);
    advance(state);
  }

  flushProse();

  // Build the heading prefix verbatim so serialize() can recreate it.
  Object.defineProperty(
    blocks,
    '__cellMeta__',
    {
      value: {
        headingText: heading.text,
        headingEnd,
        trailingBlanks: trailingBlanks.map((l) => ({ text: l.text, end: l.end })),
      },
      enumerable: false,
    },
  );

  return { displayIndex, alias, frontmatter, blocks };
}

// -- Serializer --------------------------------------------------------------

export function serialize(notebook: Notebook): string {
  const parts: string[] = [];
  // Notebook frontmatter
  const fmRaw = (notebook.frontmatter as unknown as { __raw__?: NotebookFmRaw }).__raw__;
  if (fmRaw) {
    parts.push('---' + fmRaw.openEnd);
    for (const l of fmRaw.lines) parts.push(l.text + l.end);
    parts.push('---' + fmRaw.closeEnd);
  }

  for (const cell of notebook.cells) {
    const meta = (cell.blocks as unknown as { __cellMeta__?: CellMeta }).__cellMeta__;
    if (meta) {
      parts.push(meta.headingText + meta.headingEnd);
    } else {
      const aliasPart = cell.alias ? ' ' + cell.alias : '';
      parts.push(`### #${cell.displayIndex}${aliasPart}\n`);
    }
    // yaml frontmatter
    const cfmRaw = (cell.frontmatter as unknown as { __raw__?: CellFmRaw }).__raw__;
    if (cfmRaw) {
      parts.push(cfmRaw.openLine.text + cfmRaw.openLine.end);
      for (const l of cfmRaw.bodyLines) parts.push(l.text + l.end);
      parts.push(cfmRaw.closeLine.text + cfmRaw.closeLine.end);
    }
    for (const block of cell.blocks) {
      const braw = (block as unknown as { __raw__?: BlockRaw }).__raw__;
      if (block.kind === 'prose') {
        parts.push(block.source);
      } else if (braw) {
        parts.push(braw.openLine.text + braw.openLine.end);
        parts.push(block.source);
        parts.push(braw.closeLine.text + braw.closeLine.end);
      } else {
        // Fallback for AST-only construction (no parse provenance): synthesize
        // canonical fences. Not byte-exact but produces valid output.
        if (block.kind === 'view' || block.kind === 'macro') {
          parts.push('```' + block.kind + ' ' + block.name + '\n');
        } else {
          parts.push('```' + block.kind + '\n');
        }
        parts.push(block.source);
        parts.push('```\n');
      }
    }
    if (meta) {
      for (const b of meta.trailingBlanks) parts.push(b.text + b.end);
    }
  }

  return parts.join('');
}

// Internal provenance shapes used for round-tripping. These are attached as
// non-enumerable __raw__ / __cellMeta__ properties during parse.
interface LineEnd { text: string; end: string }
interface NotebookFmRaw { lines: LineEnd[]; openEnd: string; closeEnd: string }
interface CellFmRaw { openLine: LineEnd; bodyLines: LineEnd[]; closeLine: LineEnd }
interface BlockRaw { openLine: LineEnd; closeLine: LineEnd }
interface CellMeta { headingText: string; headingEnd: string; trailingBlanks: LineEnd[] }
```

- [x] Run the parser tests; they should now mostly pass:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- notebookParser
```

Expected output (key lines):
```
 ✓ src/__tests__/parser/notebookParser.test.ts (21)
 Test Files  1 passed (1)
      Tests  21 passed (21)
```

If any test still fails, the failing case is a real defect — fix it before moving on. Most likely culprits: a regex escape, an off-by-one on a blank line, or a `__raw__` field not being read by `serialize` for a path you missed.

---

## Task 10 — Confirm `serialize` round-trip on the three hand-authored samples

`serialize` was implemented in Task 9 together with `parseNotebook` because the round-trip tests cannot pass without both. This task simply verifies the property on the M-A1 corpus.

- [x] Run only the serialize describe block:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- notebookParser -t "byte-exact"
```

Expected output (key lines):
```
 ✓ serialize — byte-exact round-trip (3)
      Tests  3 passed (3)
```

---

## Task 11 — Five fixture files + round-trip test over fixtures

- [x] Create the fixtures directory:

```bash
mkdir -p /Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/notebooks
```

Expected output: nothing (directory created or already exists).

- [x] Create `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/notebooks/basic.notebook.md` with exactly this content (note: file MUST end with a single trailing newline):

```
### #1 cpu_samples
```sql
SELECT method, COUNT(*) AS n FROM samples GROUP BY method ORDER BY n DESC LIMIT 20
```
```

- [x] Create `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/notebooks/all-fences.notebook.md` with exactly this content:

```
### #1 demo
```yaml
pinned: true
```
```sql
SELECT t, v FROM source
```
```plot
line { x: t; y: v } | title: "Demo"
```
```view active_threads
SELECT * FROM threads WHERE state = 'RUNNABLE'
```
```macro pct
(col, p) => quantile_cont(col, p / 100)
```
Prose line one.
Prose line two.
```

- [x] Create `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/notebooks/multi-cell.notebook.md` with exactly this content:

```
### #1 src
```sql
SELECT * FROM events
```

### #2 hot
```sql
SELECT method, COUNT(*) AS n FROM src GROUP BY method
```

### #3 chart
```plot
bar { x: method; y: n } | title: "Hot methods"
```
```

- [x] Create `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/notebooks/with-frontmatter.notebook.md` with exactly this content:

```
---
version: 2.0
title: With frontmatter
description: Exercises every cell-frontmatter key.
---
### #1 everything
```yaml
pinned: true
hidden: false
autorun: true
deps: [other]
style: compact
last_ai_prompt: explain this cell
materialize: true
record_interactions: false
```
```sql
SELECT 1
```
```

- [x] Create `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/notebooks/edge-cases.notebook.md` with CRLF line endings. Generate it with this command (uses printf so it's reproducible without an editor):

```bash
printf '### #1 a\r\n```sql\r\n\r\n```\r\n### #2 b\r\n```sql\r\n-- comment only\r\n```\r\n\r\n\r\n' > /Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/notebooks/edge-cases.notebook.md
```

Expected output: nothing. Verify it's CRLF:

```bash
od -c /Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/notebooks/edge-cases.notebook.md | head -3
```

Expected output (key tokens): every line ends with `\r  \n` (carriage-return then newline).

- [x] Create `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/parser/notebookParser.fixtures.test.ts`:

```typescript
// frontend-v2/src/__tests__/parser/notebookParser.fixtures.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseNotebook, serialize } from '@/services/parser/notebookParser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../../../tests/fixtures/notebooks');

describe('parseNotebook — fixture corpus', () => {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.notebook.md'));

  it('found the expected 5 fixtures', () => {
    expect(files.sort()).toEqual(
      [
        'all-fences.notebook.md',
        'basic.notebook.md',
        'edge-cases.notebook.md',
        'multi-cell.notebook.md',
        'with-frontmatter.notebook.md',
      ].sort(),
    );
  });

  it.each(files)('round-trips %s byte-for-byte', (name) => {
    const src = readFileSync(resolve(FIXTURE_DIR, name), 'utf8');
    const { notebook, diagnostics } = parseNotebook(src);
    // The corpus must be legal (no error diagnostics).
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(serialize(notebook)).toBe(src);
  });
});
```

- [x] Run the fixture suite:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- notebookParser.fixtures
```

Expected output (key lines):
```
 ✓ src/__tests__/parser/notebookParser.fixtures.test.ts (6)
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

If any fixture fails to round-trip, the regression is in the parser/serializer pair — do not "fix" the fixture, fix the code.

---

## Task 12 — Property test (fast-check, 1000 iterations)

- [x] Create `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/parser/notebookParser.property.test.ts`:

```typescript
// frontend-v2/src/__tests__/parser/notebookParser.property.test.ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseNotebook, serialize } from '@/services/parser/notebookParser';

// --- arbitraries -----------------------------------------------------------

const alias = fc.stringMatching(/^[a-z][a-z0-9_]{0,15}$/);

const yamlScalar = fc.oneof(
  fc.constant('true'),
  fc.constant('false'),
  fc.integer({ min: 0, max: 1000 }).map(String),
  fc.stringMatching(/^[a-z][a-z0-9_]{0,20}$/),
);

const yamlEntry = fc.tuple(
  fc.constantFrom(
    'pinned',
    'hidden',
    'autorun',
    'style',
    'last_ai_prompt',
    'materialize',
    'record_interactions',
  ),
  yamlScalar,
);

const yamlBlock = fc.array(yamlEntry, { minLength: 0, maxLength: 4 }).map((entries) => {
  if (entries.length === 0) return '';
  const body = entries.map(([k, v]) => `${k}: ${v}`).join('\n');
  return '```yaml\n' + body + '\n```\n';
});

const sqlBlock = fc
  .stringMatching(/^[A-Z][A-Z ]{0,20}$/)
  .map((s) => '```sql\n' + s + '\n```\n');

const plotBlock = fc
  .stringMatching(/^[a-z][a-z _:;{}]{0,30}$/)
  .map((s) => '```plot\n' + s + '\n```\n');

const viewBlock = fc
  .tuple(alias, fc.stringMatching(/^[A-Z][A-Z ]{0,20}$/))
  .map(([name, body]) => '```view ' + name + '\n' + body + '\n```\n');

const macroBlock = fc
  .tuple(alias, fc.stringMatching(/^[a-z()=> ,]{1,30}$/))
  .map(([name, body]) => '```macro ' + name + '\n' + body + '\n```\n');

const proseBlock = fc
  .array(fc.stringMatching(/^[A-Za-z][A-Za-z0-9 .,]{0,40}$/), { minLength: 1, maxLength: 3 })
  .map((lines) => lines.join('\n') + '\n');

const cellSource = fc
  .tuple(
    fc.integer({ min: 1, max: 99 }),
    alias,
    yamlBlock,
    fc.option(sqlBlock, { nil: '' }),
    fc.option(plotBlock, { nil: '' }),
    fc.option(viewBlock, { nil: '' }),
    fc.option(macroBlock, { nil: '' }),
    fc.option(proseBlock, { nil: '' }),
  )
  .map(([n, a, y, sql, plot, view, macro, prose]) => {
    return `### #${n} ${a}\n` + y + (sql ?? '') + (plot ?? '') + (view ?? '') + (macro ?? '') + (prose ?? '');
  });

const notebookFm = fc.option(
  fc.array(
    fc.tuple(
      fc.constantFrom('title', 'description', 'version', 'extra_key'),
      fc.stringMatching(/^[A-Za-z][A-Za-z0-9 _]{0,20}$/),
    ),
    { minLength: 1, maxLength: 3 },
  ),
  { nil: undefined },
);

const notebookSource = fc
  .tuple(
    notebookFm,
    fc.array(cellSource, { minLength: 3, maxLength: 10 }),
  )
  .map(([fmEntries, cells]) => {
    const fm =
      fmEntries === undefined
        ? ''
        : '---\n' + fmEntries.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\n';
    // Insert a single blank line between cells to exercise blank-line preservation.
    return fm + cells.join('\n');
  });

// --- the property ----------------------------------------------------------

describe('parseNotebook — property: round-trip on generated sources', () => {
  it('serialize(parseNotebook(src).notebook) === src for 1000 random inputs', () => {
    fc.assert(
      fc.property(notebookSource, (src) => {
        const { notebook, diagnostics } = parseNotebook(src);
        // We generate only legal inputs, so there should be no error diagnostics.
        expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
        expect(serialize(notebook)).toBe(src);
      }),
      { numRuns: 1000 },
    );
  });
});
```

- [x] Run the property test:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- notebookParser.property
```

Expected output (key lines):
```
 ✓ src/__tests__/parser/notebookParser.property.test.ts (1)
   ✓ serialize(parseNotebook(src).notebook) === src for 1000 random inputs
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

If fast-check shrinks to a failing seed, the printed counter-example IS the bug. Add it as a permanent unit test in `notebookParser.test.ts` before fixing — that way the regression is locked in.

---

## Task 13 — Gate verification + commit

- [x] Run the full parser suite plus typecheck:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- parser/notebookParser && npm run typecheck
```

Expected output (key lines):
```
 Test Files  3 passed (3)
      Tests  28 passed (28)
```
(21 unit + 6 fixture + 1 property = 28. The typecheck step prints nothing on success.)

- [x] Stage and commit:

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git add frontend-v2/src/services/parser/ frontend-v2/src/__tests__/parser/ frontend-v2/tests/fixtures/notebooks/ && git commit -m "feat(v2): M-A1 notebook parser + round-trip property (1000 iters)"
```

Expected output (key lines):
```
[<branch> <sha>] feat(v2): M-A1 notebook parser + round-trip property (1000 iters)
 9 files changed, ... insertions(+)
 create mode 100644 frontend-v2/src/services/parser/types.ts
 create mode 100644 frontend-v2/src/services/parser/notebookParser.ts
 create mode 100644 frontend-v2/src/__tests__/parser/notebookParser.test.ts
 create mode 100644 frontend-v2/src/__tests__/parser/notebookParser.fixtures.test.ts
 create mode 100644 frontend-v2/src/__tests__/parser/notebookParser.property.test.ts
 create mode 100644 frontend-v2/tests/fixtures/notebooks/basic.notebook.md
 create mode 100644 frontend-v2/tests/fixtures/notebooks/all-fences.notebook.md
 create mode 100644 frontend-v2/tests/fixtures/notebooks/multi-cell.notebook.md
 create mode 100644 frontend-v2/tests/fixtures/notebooks/with-frontmatter.notebook.md
 create mode 100644 frontend-v2/tests/fixtures/notebooks/edge-cases.notebook.md
```

- [x] Confirm the working tree is clean:

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git status
```

Expected output (key lines):
```
nothing to commit, working tree clean
```

---

## Done criteria

- All 28 tests pass (21 unit + 6 fixture + 1 property at 1000 iterations).
- `npm run typecheck` is clean.
- `serialize(parseNotebook(src).notebook) === src` byte-for-byte for every fixture and every property-generated input.
- No new runtime dependencies were added; the parser is self-contained inside `src/services/parser/`.
- Commit is on the current branch with the message above; no follow-up edits.
