# M-A3: Plot DSL Sugar Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lezer grammar + parser covering 12 plot types, 3 composers (row/col/overlay), full clause tail, UPPERCASE rejection with rewrite suggestion. Property test at 1000 iters.

**Architecture:** Lezer LRParser (generated from `src/dsl/plotSugar.grammar`); `parsePlot` walks CST to produce PlotNode; UPPERCASE guard short-circuits before Lezer parse.

**Tech Stack:** TypeScript 5.8, @lezer/generator 1.7.1, @lezer/common, @lezer/lr, fast-check 3.22, Vitest 4.1

---

## Pre-resolved Decisions (encode verbatim)

**DECISION (Opus-resolved): Lezer grammar is mandatory.** Phase B's CodeMirror editor reuses the same grammar for syntax highlighting. A hand-rolled parser is not acceptable. If the grammar generator fails, escalate — do not substitute a regex parser.

**DECISION (Opus-resolved): UPPERCASE guard runs before Lezer parse.** If `src.trimStart()` matches `/^[A-Z_]+\s*\(/`, map to lowercase suggestion via this table and return a SugarOnly error without invoking the Lezer parser:
```
LINE_CHART→line, BAR_CHART→bar, SCATTER_CHART→scatter, HISTOGRAM→histogram,
BOXPLOT→boxplot, HEATMAP→heatmap, PIE_CHART→pie, FLAMEGRAPH→flamegraph,
TABLE→table, GANTT→gantt, AREA_CHART→area, RANGE_CHART→range
```
Diagnostic: `{ kind: 'SugarOnly', severity: 'error', message: 'Classic UPPERCASE syntax is not supported. Use sugar: <suggestion>', offset: 0, length: src.length }`

**DECISION (Opus-resolved): @lezer/generator install.** Add `"@lezer/generator": "1.7.1"` to devDependencies. Add npm script `"grammar": "lezer-generator src/dsl/plotSugar.grammar -o src/services/parser/plotDslGrammar.ts"`. Run `npm install` then `npm run grammar` to generate. Commit the generated file.

---

## Task 1: Append plot AST types to `types.ts`

- [ ] Open `frontend-v2/src/services/parser/types.ts` and append the following block at the end of the file (do not replace existing exports for Notebook, Cell, SqlStatement, VarRef):

```typescript
export type PlotType =
  | 'line'
  | 'bar'
  | 'scatter'
  | 'histogram'
  | 'boxplot'
  | 'heatmap'
  | 'pie'
  | 'flamegraph'
  | 'table'
  | 'gantt'
  | 'area'
  | 'range';

export type PlotValue = string | number | boolean | VarRef | PlotValue[];

export interface PanelClauses {
  title?: PlotValue;
  width?: PlotValue;
  height?: PlotValue;
  name?: string;
  settings?: Record<string, PlotValue>;
  disabled?: boolean;
  on_hover?: string;
  on_selection?: string;
  on_brush?: string;
  zoom?: { variable: string };
  brush?: { mode: 'live' | 'progressive' | 'static'; variable?: string };
  highlight?: string;
  palette?: string;
  legend?: boolean | string;
  tooltip?: boolean | string;
  on?: string;
}

export interface ContainerClauses {
  title?: PlotValue;
  width?: PlotValue;
  height?: PlotValue;
  name?: string;
  'link-x'?: { variable: string };
  'link-y'?: { variable: string };
  'link-xy'?: { variable: string };
}

export interface PanelNode {
  kind: 'panel';
  plotType: PlotType;
  config: Record<string, PlotValue>;
  clauses: PanelClauses;
}

export interface ContainerNode {
  kind: 'container';
  direction: 'row' | 'col';
  children: PlotNode[];
  clauses: ContainerClauses;
}

export interface OverlayNode {
  kind: 'overlay';
  layers: PlotNode[];
  clauses: PanelClauses;
}

export type PlotNode = PanelNode | ContainerNode | OverlayNode;
```

- [ ] Verify: run

```bash
grep "PlotNode" /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/types.ts
```

Expected output (at minimum):
```
export type PlotNode = PanelNode | ContainerNode | OverlayNode;
```

---

## Task 2: Install `@lezer/generator` and add grammar script

- [ ] Open `frontend-v2/package.json`. In `devDependencies`, add the entry `"@lezer/generator": "1.7.1"`. In `scripts`, add the entry `"grammar": "lezer-generator src/dsl/plotSugar.grammar -o src/services/parser/plotDslGrammar.ts"`.

- [ ] Run:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm install
```

Expected: exit code 0; `node_modules/@lezer/generator` exists.

- [ ] Verify:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx lezer-generator --version
```

Expected: a version string (e.g. `1.7.1`) on stdout, exit 0.

---

## Task 3: Write the Lezer grammar

- [ ] Create directory if needed:

```bash
mkdir -p /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/dsl
```

- [ ] Create `frontend-v2/src/dsl/plotSugar.grammar` with exactly this content:

```
@top Plot { tree }

@skip { space | LineComment }

tree { panel | container | overlay }

overlay { overlayBase (Plus tree)+ clauseTail }
overlayBase { panel | container }

container { (row | col) "{" treelist "}" clauseTail }
treelist { tree (sep tree)* }
sep { ";" | Newline }

panel { PlotName "{" configPairs "}" clauseTail }

configPairs { configPair* }
configPair { Identifier Colon value }

clauseTail { (Pipe clauseKv)* }
clauseKv { clauseKey Colon value }

value {
  StringLiteral |
  Number |
  Bool |
  varRef |
  "[" (value ("," value)*)? "]"
}

varRef { Dollar Identifier (Dot Identifier)* }

PlotName { @specialize[@name=PlotName]<Identifier,
  "line" | "bar" | "scatter" | "histogram" | "boxplot" |
  "heatmap" | "pie" | "flamegraph" | "table" | "gantt" |
  "area" | "range"> }

clauseKey { @specialize[@name=clauseKey]<Identifier,
  "title" | "width" | "height" | "link-x" | "link-y" | "link-xy" |
  "name" | "settings" | "disabled" | "on_hover" | "on_selection" |
  "on_brush" | "zoom" | "brush" | "highlight" | "palette" |
  "legend" | "tooltip" | "on"> }

row { @specialize[@name=row]<Identifier, "row"> }
col { @specialize[@name=col]<Identifier, "col"> }

@tokens {
  Identifier { $[a-zA-Z_\-] $[a-zA-Z0-9_\-]* }
  Dollar { "$" }
  Dot { "." }
  Pipe { "|" }
  Plus { "+" }
  Colon { ":" }
  Newline { "\n" }
  Number { $[0-9]+ ("." $[0-9]+)? }
  Bool { "true" | "false" }
  StringLiteral { '"' (!["\\] | "\\" _)* '"' | "'" (!['\\] | "\\" _)* "'" }
  LineComment { "//" ![\n]* }
  space { $[ \t\r]+ }
}
```

- [ ] Verify:

```bash
ls -l /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/dsl/plotSugar.grammar
```

Expected: file exists, non-zero size.

---

## Task 4: Generate the parser

- [ ] Run:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run grammar
```

Expected: exit 0; `frontend-v2/src/services/parser/plotDslGrammar.ts` is created.

- [ ] Verify:

```bash
grep "export" /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/plotDslGrammar.ts | head -3
```

Expected: 1-3 lines containing `export const parser` (or similar exported symbols from the lezer-generator output).

- [ ] NOTE: If `npm run grammar` errors with conflicts:
  - Overlay ambiguity: ensure `overlayBase` is separate from `tree` to avoid left-recursion (already done above; do not collapse).
  - Tokenizer conflicts: confirm `Identifier` matches before `@specialize` fires (lezer handles this automatically when `@specialize` is used as shown).
  - Fix the grammar file and re-run `npm run grammar`. Do not substitute a hand-rolled parser — escalate to the user if generation cannot succeed.

---

## Task 5: Write failing tests — 12 plot types (minimal form)

- [ ] Create directory if needed:

```bash
mkdir -p /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/parser
```

- [ ] Create `frontend-v2/src/__tests__/parser/plotDslParser.test.ts` with this content:

```typescript
import { describe, it, expect } from 'vitest';
import { parsePlot } from '../../services/parser/plotDslParser';

describe('plotDslParser — 12 plot types', () => {
  const cases: [string, string][] = [
    ['line', 'line { x: "t", y: "v" }'],
    ['bar', 'bar { x: "cat", y: "count" }'],
    ['scatter', 'scatter { x: "a", y: "b" }'],
    ['histogram', 'histogram { x: "dur" }'],
    ['boxplot', 'boxplot { x: "cat", y: "val" }'],
    ['heatmap', 'heatmap { x: "ts", y: "thread", value: "cpu" }'],
    ['pie', 'pie { name: "cat", value: "count" }'],
    ['flamegraph', 'flamegraph { value: "dur", name: "frame" }'],
    ['table', 'table { }'],
    ['gantt', 'gantt { start: "startTime", end: "endTime", lane: "thread" }'],
    ['area', 'area { x: "ts", y: "val" }'],
    ['range', 'range { x: "ts", lo: "min", hi: "max" }'],
  ];

  it.each(cases)('%s: parses to panel node with correct plotType', (plotType, src) => {
    const { node, diagnostics } = parsePlot(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(node?.kind).toBe('panel');
    expect((node as any)?.plotType).toBe(plotType);
  });
});
```

- [ ] Run:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- plotDslParser
```

Expected: FAIL — module `../../services/parser/plotDslParser` not found (parsePlot does not exist yet). This is the expected RED state.

---

## Task 6: Write failing tests — composers (row, col, overlay)

- [ ] Append to `frontend-v2/src/__tests__/parser/plotDslParser.test.ts`:

```typescript
describe('composers', () => {
  it('row container with two children separated by `;`', () => {
    const { node, diagnostics } = parsePlot(
      'row { line { x: "t", y: "v" }; bar { x: "c", y: "n" } }',
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(node?.kind).toBe('container');
    expect((node as any).direction).toBe('row');
    expect((node as any).children).toHaveLength(2);
    expect((node as any).children[0].plotType).toBe('line');
    expect((node as any).children[1].plotType).toBe('bar');
  });

  it('col container with a single child', () => {
    const { node, diagnostics } = parsePlot('col { line { x: "t", y: "v" } }');
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(node?.kind).toBe('container');
    expect((node as any).direction).toBe('col');
    expect((node as any).children).toHaveLength(1);
  });

  it('overlay using `+` produces overlay node with two layers', () => {
    const { node, diagnostics } = parsePlot(
      'line { x: "t", y: "v" } + bar { x: "t", y: "n" }',
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(node?.kind).toBe('overlay');
    expect((node as any).layers).toHaveLength(2);
    expect((node as any).layers[0].plotType).toBe('line');
    expect((node as any).layers[1].plotType).toBe('bar');
  });

  it('nested row containing col produces a tree of containers', () => {
    const { node, diagnostics } = parsePlot(
      'row { col { line { x: "t", y: "v" } }; bar { x: "c", y: "n" } }',
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(node?.kind).toBe('container');
    expect((node as any).direction).toBe('row');
    expect((node as any).children[0].kind).toBe('container');
    expect((node as any).children[0].direction).toBe('col');
    expect((node as any).children[1].kind).toBe('panel');
  });
});
```

- [ ] Run:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- plotDslParser
```

Expected: FAIL (module still missing). RED.

---

## Task 7: Write failing tests — clause tail

- [ ] Append to `frontend-v2/src/__tests__/parser/plotDslParser.test.ts`:

```typescript
describe('clause tail', () => {
  it('title clause', () => {
    const { node } = parsePlot('line { x: "t", y: "v" } | title: "CPU"');
    expect((node as any).clauses.title).toBe('CPU');
  });
  it('width clause', () => {
    const { node } = parsePlot('line { x: "t", y: "v" } | width: 400');
    expect((node as any).clauses.width).toBe(400);
  });
  it('height clause', () => {
    const { node } = parsePlot('line { x: "t", y: "v" } | height: 300');
    expect((node as any).clauses.height).toBe(300);
  });
  it('name clause', () => {
    const { node } = parsePlot('line { x: "t", y: "v" } | name: "p1"');
    expect((node as any).clauses.name).toBe('p1');
  });
  it('brush clause string-form', () => {
    const { node } = parsePlot('line { x: "t", y: "v" } | brush: "live"');
    expect((node as any).clauses.brush).toBeDefined();
  });
  it('zoom clause via varRef', () => {
    const { node } = parsePlot('line { x: "t", y: "v" } | zoom: $zoomVar');
    expect((node as any).clauses.zoom).toBeDefined();
  });
  it('on_hover clause', () => {
    const { node } = parsePlot('line { x: "t", y: "v" } | on_hover: "h1"');
    expect((node as any).clauses.on_hover).toBe('h1');
  });
  it('on_brush clause', () => {
    const { node } = parsePlot('line { x: "t", y: "v" } | on_brush: "b1"');
    expect((node as any).clauses.on_brush).toBe('b1');
  });
  it('on_selection clause', () => {
    const { node } = parsePlot('line { x: "t", y: "v" } | on_selection: "s1"');
    expect((node as any).clauses.on_selection).toBe('s1');
  });
  it('link-x clause on container', () => {
    const { node } = parsePlot('row { line { x: "t", y: "v" } } | link-x: $cursor');
    expect((node as any).clauses['link-x']).toBeDefined();
  });
  it('link-y clause on container', () => {
    const { node } = parsePlot('row { line { x: "t", y: "v" } } | link-y: $cursor');
    expect((node as any).clauses['link-y']).toBeDefined();
  });
  it('link-xy clause on container', () => {
    const { node } = parsePlot('row { line { x: "t", y: "v" } } | link-xy: $cursor');
    expect((node as any).clauses['link-xy']).toBeDefined();
  });
  it('palette clause', () => {
    const { node } = parsePlot('line { x: "t", y: "v" } | palette: "viridis"');
    expect((node as any).clauses.palette).toBe('viridis');
  });
  it('legend clause boolean', () => {
    const { node } = parsePlot('line { x: "t", y: "v" } | legend: true');
    expect((node as any).clauses.legend).toBe(true);
  });
  it('tooltip clause boolean', () => {
    const { node } = parsePlot('line { x: "t", y: "v" } | tooltip: false');
    expect((node as any).clauses.tooltip).toBe(false);
  });
});
```

- [ ] Run:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- plotDslParser
```

Expected: FAIL (still RED).

---

## Task 8: Write failing tests — UPPERCASE rejection and errors

- [ ] Append to `frontend-v2/src/__tests__/parser/plotDslParser.test.ts`:

```typescript
describe('UPPERCASE rejection', () => {
  const cases: [string, string][] = [
    ['LINE_CHART(x="t", y="v")', 'line'],
    ['BAR_CHART(x="t", y="v")', 'bar'],
    ['SCATTER_CHART(x="t", y="v")', 'scatter'],
    ['HISTOGRAM(x="dur")', 'histogram'],
    ['BOXPLOT(x="c", y="v")', 'boxplot'],
    ['HEATMAP(x="t", y="th", value="c")', 'heatmap'],
    ['PIE_CHART(name="c", value="n")', 'pie'],
    ['FLAMEGRAPH(value="d")', 'flamegraph'],
    ['TABLE()', 'table'],
    ['GANTT(start="s", end="e")', 'gantt'],
    ['AREA_CHART(x="t", y="v")', 'area'],
    ['RANGE_CHART(x="t", lo="a", hi="b")', 'range'],
  ];

  it.each(cases)('%s emits SugarOnly diagnostic suggesting %s', (src, suggestion) => {
    const { node, diagnostics } = parsePlot(src);
    expect(node).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].kind).toBe('SugarOnly');
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].message).toContain(suggestion);
    expect(diagnostics[0].offset).toBe(0);
    expect(diagnostics[0].length).toBe(src.length);
  });
});

describe('error cases', () => {
  it('unknown plot name emits UnknownPlotType', () => {
    const { node, diagnostics } = parsePlot('wibble { x: "t" }');
    expect(node).toBeNull();
    expect(diagnostics.some((d) => d.kind === 'UnknownPlotType')).toBe(true);
  });

  it('unknown clause key emits UnknownClause warning', () => {
    const { diagnostics } = parsePlot('line { x: "t", y: "v" } | frobnicate: 1');
    expect(
      diagnostics.some((d) => d.kind === 'UnknownClause' && d.severity === 'warning'),
    ).toBe(true);
  });

  it('unterminated brace emits UnterminatedBrace error', () => {
    const { node, diagnostics } = parsePlot('line { x: "t", y: "v"');
    expect(node).toBeNull();
    expect(diagnostics.some((d) => d.kind === 'UnterminatedBrace' && d.severity === 'error')).toBe(
      true,
    );
  });
});
```

- [ ] Run:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- plotDslParser
```

Expected: FAIL (parsePlot still missing). RED — total test count now ~50+.

---

## Task 9: Add DiagnosticKind additions

- [ ] Open `frontend-v2/src/services/parser/types.ts`. Locate the existing `DiagnosticKind` union (added in M-A1/M-A2). Add the four new kinds to it:

Replace the existing `DiagnosticKind` line by adding the four new kinds. If it currently reads:

```typescript
export type DiagnosticKind = 'ParseError' | 'UnknownIdentifier' | /* existing kinds */ string;
```

Update to include (without removing existing kinds):

```typescript
export type DiagnosticKind =
  | 'ParseError'
  | 'UnknownIdentifier'
  // existing kinds preserved
  | 'SugarOnly'
  | 'UnknownPlotType'
  | 'UnknownClause'
  | 'UnterminatedBrace';
```

If the existing union is structured differently (e.g. uses inline string literals), insert the four new literals (`'SugarOnly'`, `'UnknownPlotType'`, `'UnknownClause'`, `'UnterminatedBrace'`) without removing any current members.

- [ ] Verify:

```bash
grep -E "SugarOnly|UnknownPlotType|UnknownClause|UnterminatedBrace" /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/services/parser/types.ts
```

Expected: all four identifiers appear.

---

## Task 10: Implement `parsePlot`

- [ ] Create `frontend-v2/src/services/parser/plotDslParser.ts` with this complete content:

```typescript
import { parser as lezerParser } from './plotDslGrammar';
import type { SyntaxNode, Tree } from '@lezer/common';
import type {
  Diagnostic,
  PlotNode,
  PanelNode,
  ContainerNode,
  OverlayNode,
  PlotType,
  PlotValue,
  PanelClauses,
  ContainerClauses,
  VarRef,
} from './types';

const PLOT_TYPES: ReadonlySet<PlotType> = new Set([
  'line',
  'bar',
  'scatter',
  'histogram',
  'boxplot',
  'heatmap',
  'pie',
  'flamegraph',
  'table',
  'gantt',
  'area',
  'range',
]);

const PANEL_CLAUSE_KEYS: ReadonlySet<string> = new Set([
  'title',
  'width',
  'height',
  'name',
  'settings',
  'disabled',
  'on_hover',
  'on_selection',
  'on_brush',
  'zoom',
  'brush',
  'highlight',
  'palette',
  'legend',
  'tooltip',
  'on',
]);

const CONTAINER_CLAUSE_KEYS: ReadonlySet<string> = new Set([
  'title',
  'width',
  'height',
  'name',
  'link-x',
  'link-y',
  'link-xy',
]);

const UPPERCASE_MAP: Record<string, PlotType> = {
  LINE_CHART: 'line',
  BAR_CHART: 'bar',
  SCATTER_CHART: 'scatter',
  HISTOGRAM: 'histogram',
  BOXPLOT: 'boxplot',
  HEATMAP: 'heatmap',
  PIE_CHART: 'pie',
  FLAMEGRAPH: 'flamegraph',
  TABLE: 'table',
  GANTT: 'gantt',
  AREA_CHART: 'area',
  RANGE_CHART: 'range',
};

export interface ParsePlotResult {
  node: PlotNode | null;
  diagnostics: Diagnostic[];
}

export function parsePlot(src: string): ParsePlotResult {
  const diagnostics: Diagnostic[] = [];

  // UPPERCASE guard — short-circuit before Lezer parse
  const trimmed = src.trimStart();
  const m = /^([A-Z_]+)\s*\(/.exec(trimmed);
  if (m) {
    const name = m[1];
    const suggestion = UPPERCASE_MAP[name];
    const message = suggestion
      ? `Classic UPPERCASE syntax is not supported. Use sugar: ${suggestion}`
      : `Classic UPPERCASE syntax is not supported. Use sugar: <lowercase plot name>`;
    diagnostics.push({
      kind: 'SugarOnly',
      severity: 'error',
      message,
      offset: 0,
      length: src.length,
    });
    return { node: null, diagnostics };
  }

  // Lezer parse
  const tree: Tree = lezerParser.parse(src);

  // Detect unterminated brace via tree error nodes near end of source
  let hasFatalParseError = false;
  tree.iterate({
    enter(n) {
      if (n.type.isError) {
        // Heuristic: if the error is at/after the last `{` and no matching `}` exists, treat as UnterminatedBrace
        const lastOpen = src.lastIndexOf('{');
        const lastClose = src.lastIndexOf('}');
        if (lastOpen > lastClose) {
          diagnostics.push({
            kind: 'UnterminatedBrace',
            severity: 'error',
            message: 'Unterminated `{` — missing matching `}`.',
            offset: lastOpen,
            length: src.length - lastOpen,
          });
          hasFatalParseError = true;
          return false;
        }
        diagnostics.push({
          kind: 'ParseError',
          severity: 'error',
          message: 'Parse error',
          offset: n.from,
          length: Math.max(1, n.to - n.from),
        });
        hasFatalParseError = true;
        return false;
      }
      return undefined;
    },
  });

  if (hasFatalParseError) {
    return { node: null, diagnostics };
  }

  const top = tree.topNode; // Plot
  const treeNode = firstChild(top, 'tree') ?? top.firstChild;
  if (!treeNode) {
    return { node: null, diagnostics };
  }

  const node = buildTree(treeNode, src, diagnostics);
  return { node, diagnostics };
}

// ---------- CST → AST ----------

function buildTree(
  n: SyntaxNode,
  src: string,
  diagnostics: Diagnostic[],
): PlotNode | null {
  const inner = firstNonSkip(n);
  if (!inner) return null;
  switch (inner.name) {
    case 'panel':
      return buildPanel(inner, src, diagnostics);
    case 'container':
      return buildContainer(inner, src, diagnostics);
    case 'overlay':
      return buildOverlay(inner, src, diagnostics);
    default:
      return null;
  }
}

function buildPanel(
  n: SyntaxNode,
  src: string,
  diagnostics: Diagnostic[],
): PanelNode | null {
  const nameNode = firstChild(n, 'PlotName');
  if (!nameNode) return null;
  const plotTypeRaw = text(nameNode, src);
  if (!PLOT_TYPES.has(plotTypeRaw as PlotType)) {
    diagnostics.push({
      kind: 'UnknownPlotType',
      severity: 'error',
      message: `Unknown plot type: ${plotTypeRaw}`,
      offset: nameNode.from,
      length: nameNode.to - nameNode.from,
    });
    return null;
  }
  const plotType = plotTypeRaw as PlotType;

  const config: Record<string, PlotValue> = {};
  const pairs = firstChild(n, 'configPairs');
  if (pairs) {
    for (let c = pairs.firstChild; c; c = c.nextSibling) {
      if (c.name !== 'configPair') continue;
      const ident = firstChild(c, 'Identifier');
      const valNode = firstChild(c, 'value');
      if (!ident || !valNode) continue;
      const key = text(ident, src);
      const v = parseValue(valNode, src);
      if (v !== undefined) config[key] = v;
    }
  }

  const clauses = parsePanelClauses(n, src, diagnostics);

  return { kind: 'panel', plotType, config, clauses };
}

function buildContainer(
  n: SyntaxNode,
  src: string,
  diagnostics: Diagnostic[],
): ContainerNode | null {
  const rowNode = firstChild(n, 'row');
  const colNode = firstChild(n, 'col');
  const dirNode = rowNode ?? colNode;
  if (!dirNode) return null;
  const direction = dirNode.name === 'row' ? 'row' : 'col';

  const children: PlotNode[] = [];
  const list = firstChild(n, 'treelist');
  if (list) {
    for (let c = list.firstChild; c; c = c.nextSibling) {
      if (c.name === 'tree') {
        const built = buildTree(c, src, diagnostics);
        if (built) children.push(built);
      }
    }
  }

  const clauses = parseContainerClauses(n, src, diagnostics);
  return { kind: 'container', direction, children, clauses };
}

function buildOverlay(
  n: SyntaxNode,
  src: string,
  diagnostics: Diagnostic[],
): OverlayNode | null {
  const layers: PlotNode[] = [];

  const base = firstChild(n, 'overlayBase');
  if (base) {
    const inner = firstNonSkip(base);
    if (inner?.name === 'panel') {
      const p = buildPanel(inner, src, diagnostics);
      if (p) layers.push(p);
    } else if (inner?.name === 'container') {
      const c = buildContainer(inner, src, diagnostics);
      if (c) layers.push(c);
    }
  }

  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.name === 'tree') {
      const built = buildTree(c, src, diagnostics);
      if (built) layers.push(built);
    }
  }

  const clauses = parsePanelClauses(n, src, diagnostics);
  return { kind: 'overlay', layers, clauses };
}

// ---------- clause tail parsing ----------

function parsePanelClauses(
  parent: SyntaxNode,
  src: string,
  diagnostics: Diagnostic[],
): PanelClauses {
  const out: PanelClauses = {};
  const tail = firstChild(parent, 'clauseTail');
  if (!tail) return out;

  for (let kv = tail.firstChild; kv; kv = kv.nextSibling) {
    if (kv.name !== 'clauseKv') continue;
    const keyNode = firstChild(kv, 'clauseKey');
    const valNode = firstChild(kv, 'value');
    if (!keyNode || !valNode) continue;
    const key = text(keyNode, src);
    const v = parseValue(valNode, src);

    if (!PANEL_CLAUSE_KEYS.has(key)) {
      diagnostics.push({
        kind: 'UnknownClause',
        severity: 'warning',
        message: `Unknown clause: ${key}`,
        offset: keyNode.from,
        length: keyNode.to - keyNode.from,
      });
      continue;
    }

    switch (key) {
      case 'title':
      case 'width':
      case 'height':
      case 'highlight':
      case 'palette':
      case 'on_hover':
      case 'on_selection':
      case 'on_brush':
      case 'on':
        (out as Record<string, unknown>)[key] = v;
        break;
      case 'name':
        if (typeof v === 'string') out.name = v;
        break;
      case 'disabled':
        if (typeof v === 'boolean') out.disabled = v;
        break;
      case 'legend':
      case 'tooltip':
        if (typeof v === 'boolean' || typeof v === 'string') {
          (out as Record<string, unknown>)[key] = v;
        }
        break;
      case 'zoom':
        if (isVarRef(v)) out.zoom = { variable: v.name };
        break;
      case 'brush':
        if (typeof v === 'string') {
          out.brush = { mode: (v as 'live' | 'progressive' | 'static') ?? 'live' };
        } else if (isVarRef(v)) {
          out.brush = { mode: 'live', variable: v.name };
        }
        break;
      default:
        break;
    }
  }

  return out;
}

function parseContainerClauses(
  parent: SyntaxNode,
  src: string,
  diagnostics: Diagnostic[],
): ContainerClauses {
  const out: ContainerClauses = {};
  const tail = firstChild(parent, 'clauseTail');
  if (!tail) return out;

  for (let kv = tail.firstChild; kv; kv = kv.nextSibling) {
    if (kv.name !== 'clauseKv') continue;
    const keyNode = firstChild(kv, 'clauseKey');
    const valNode = firstChild(kv, 'value');
    if (!keyNode || !valNode) continue;
    const key = text(keyNode, src);
    const v = parseValue(valNode, src);

    if (!CONTAINER_CLAUSE_KEYS.has(key)) {
      diagnostics.push({
        kind: 'UnknownClause',
        severity: 'warning',
        message: `Unknown clause: ${key}`,
        offset: keyNode.from,
        length: keyNode.to - keyNode.from,
      });
      continue;
    }

    switch (key) {
      case 'title':
      case 'width':
      case 'height':
        (out as Record<string, unknown>)[key] = v;
        break;
      case 'name':
        if (typeof v === 'string') out.name = v;
        break;
      case 'link-x':
      case 'link-y':
      case 'link-xy':
        if (isVarRef(v)) {
          (out as Record<string, unknown>)[key] = { variable: v.name };
        }
        break;
      default:
        break;
    }
  }

  return out;
}

// ---------- value parser ----------

function parseValue(n: SyntaxNode, src: string): PlotValue | undefined {
  const inner = firstNonSkip(n);
  if (!inner) return undefined;
  switch (inner.name) {
    case 'StringLiteral': {
      const raw = text(inner, src);
      return raw.slice(1, -1).replace(/\\(.)/g, '$1');
    }
    case 'Number':
      return Number(text(inner, src));
    case 'Bool':
      return text(inner, src) === 'true';
    case 'varRef': {
      const idents: string[] = [];
      for (let c = inner.firstChild; c; c = c.nextSibling) {
        if (c.name === 'Identifier') idents.push(text(c, src));
      }
      const v: VarRef = {
        kind: 'varRef',
        name: idents[0] ?? '',
        path: idents.slice(1),
      } as unknown as VarRef;
      return v as unknown as PlotValue;
    }
    default: {
      // array literal
      const items: PlotValue[] = [];
      for (let c = inner.firstChild; c; c = c.nextSibling) {
        if (c.name === 'value') {
          const v = parseValue(c, src);
          if (v !== undefined) items.push(v);
        }
      }
      return items;
    }
  }
}

// ---------- helpers ----------

function firstChild(n: SyntaxNode, name: string): SyntaxNode | null {
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.name === name) return c;
  }
  return null;
}

function firstNonSkip(n: SyntaxNode): SyntaxNode | null {
  return n.firstChild;
}

function text(n: SyntaxNode, src: string): string {
  return src.slice(n.from, n.to);
}

function isVarRef(v: PlotValue | undefined): v is VarRef {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    (v as { kind?: string }).kind === 'varRef'
  );
}
```

- [ ] Run:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- parser/plotDslParser
```

Expected: all unit tests in `plotDslParser.test.ts` pass (12 plot-type cases + 4 composer cases + 15 clause-tail cases + 12 UPPERCASE cases + 3 error cases ≈ 46 cases, well above the 80+ once `it.each` rows are counted by vitest). Exit code 0.

- [ ] Run typecheck:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run typecheck
```

Expected: exit code 0, no TypeScript errors.

---

## Task 11: Expand the unit suite to 80+ assertions

- [ ] Append additional table-driven cases to `frontend-v2/src/__tests__/parser/plotDslParser.test.ts` so the suite reports ≥ 80 individual test cases. Add these blocks:

```typescript
describe('config values — primitives', () => {
  it('string values', () => {
    const { node } = parsePlot('line { x: "ts", y: "val" }');
    expect((node as any).config.x).toBe('ts');
    expect((node as any).config.y).toBe('val');
  });
  it('number values', () => {
    const { node } = parsePlot('histogram { x: "v", bins: 30 }');
    expect((node as any).config.bins).toBe(30);
  });
  it('decimal number values', () => {
    const { node } = parsePlot('line { x: "t", y: "v", opacity: 0.5 }');
    expect((node as any).config.opacity).toBe(0.5);
  });
  it('boolean true value', () => {
    const { node } = parsePlot('line { x: "t", y: "v", stacked: true }');
    expect((node as any).config.stacked).toBe(true);
  });
  it('boolean false value', () => {
    const { node } = parsePlot('line { x: "t", y: "v", stacked: false }');
    expect((node as any).config.stacked).toBe(false);
  });
  it('var ref value', () => {
    const { node } = parsePlot('line { x: "t", y: "v", color: $palette }');
    expect((node as any).config.color).toBeDefined();
  });
  it('var ref with path', () => {
    const { node } = parsePlot('line { x: "t", y: "v", color: $palette.primary }');
    expect((node as any).config.color).toBeDefined();
  });
  it('array literal value', () => {
    const { node } = parsePlot('line { x: "t", y: "v", series: ["a", "b", "c"] }');
    expect(Array.isArray((node as any).config.series)).toBe(true);
    expect((node as any).config.series).toHaveLength(3);
  });
  it('empty array literal', () => {
    const { node } = parsePlot('line { x: "t", y: "v", series: [] }');
    expect(Array.isArray((node as any).config.series)).toBe(true);
    expect((node as any).config.series).toHaveLength(0);
  });
});

describe('whitespace and comments', () => {
  it('leading whitespace', () => {
    const { node, diagnostics } = parsePlot('   line { x: "t", y: "v" }');
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(node?.kind).toBe('panel');
  });
  it('trailing whitespace', () => {
    const { node, diagnostics } = parsePlot('line { x: "t", y: "v" }   ');
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(node?.kind).toBe('panel');
  });
  it('multi-line input', () => {
    const { node, diagnostics } = parsePlot('line {\n  x: "t",\n  y: "v"\n}');
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(node?.kind).toBe('panel');
  });
  it('line comment', () => {
    const { node, diagnostics } = parsePlot('// header\nline { x: "t", y: "v" }');
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(node?.kind).toBe('panel');
  });
});

describe('multiple clauses on one panel', () => {
  it('three clauses chained', () => {
    const { node } = parsePlot(
      'line { x: "t", y: "v" } | title: "T" | width: 400 | height: 300',
    );
    expect((node as any).clauses.title).toBe('T');
    expect((node as any).clauses.width).toBe(400);
    expect((node as any).clauses.height).toBe(300);
  });
  it('clauses on container', () => {
    const { node } = parsePlot('row { line { x: "t", y: "v" } } | title: "Row"');
    expect((node as any).clauses.title).toBe('Row');
  });
  it('clauses on overlay', () => {
    const { node } = parsePlot(
      'line { x: "t", y: "v" } + bar { x: "t", y: "n" } | title: "Overlay"',
    );
    expect((node as any).clauses.title).toBe('Overlay');
  });
});

describe('round-trip determinism', () => {
  it('parsing same input twice gives equal AST', () => {
    const src = 'row { line { x: "t", y: "v" }; bar { x: "c", y: "n" } } | title: "T"';
    const a = parsePlot(src);
    const b = parsePlot(src);
    expect(JSON.stringify(a.node)).toBe(JSON.stringify(b.node));
  });
});
```

- [ ] Run:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- parser/plotDslParser
```

Expected: ≥ 80 test cases pass. Exit code 0.

---

## Task 12: Property test (1000 iterations with fast-check)

- [ ] Confirm fast-check is installed:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && node -e "require('fast-check')" && echo OK
```

Expected: `OK`. If module is missing, install with `npm install --save-dev fast-check@3.22.0`.

- [ ] Create `frontend-v2/src/__tests__/parser/plotDslParser.property.test.ts` with this complete content:

```typescript
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parsePlot } from '../../services/parser/plotDslParser';

const PLOT_TYPES = [
  'line',
  'bar',
  'scatter',
  'histogram',
  'boxplot',
  'heatmap',
  'pie',
  'flamegraph',
  'table',
  'gantt',
  'area',
  'range',
] as const;

const CLAUSE_KEYS = [
  'title',
  'width',
  'height',
  'name',
  'palette',
  'legend',
  'tooltip',
] as const;

const identifier = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,8}$/)
  .filter((s) => !PLOT_TYPES.includes(s as (typeof PLOT_TYPES)[number]))
  .filter((s) => s !== 'row' && s !== 'col');

const stringLit = fc
  .string({ minLength: 1, maxLength: 8 })
  .map((s) => `"${s.replace(/["\\]/g, '')}"`);

const numberLit = fc.integer({ min: 0, max: 1000 }).map(String);

const boolLit = fc.boolean().map(String);

const value = fc.oneof(stringLit, numberLit, boolLit);

const configPair = fc.tuple(identifier, value).map(([k, v]) => `${k}: ${v}`);

const configPairs = fc.array(configPair, { minLength: 0, maxLength: 4 }).map((arr) => arr.join(', '));

const plotType = fc.constantFrom(...PLOT_TYPES);

const clauseKv = fc.tuple(fc.constantFrom(...CLAUSE_KEYS), stringLit).map(([k, v]) => `${k}: ${v}`);

const clauseTail = fc
  .array(clauseKv, { minLength: 0, maxLength: 3 })
  .map((arr) => (arr.length ? ' | ' + arr.join(' | ') : ''));

const panelGen = fc
  .tuple(plotType, configPairs, clauseTail)
  .map(([pt, cfg, tail]) => `${pt} { ${cfg} }${tail}`);

const containerGen = fc
  .tuple(fc.constantFrom('row', 'col'), fc.array(panelGen, { minLength: 1, maxLength: 3 }), clauseTail)
  .map(([dir, children, tail]) => `${dir} { ${children.join('; ')} }${tail}`);

const overlayGen = fc
  .array(panelGen, { minLength: 2, maxLength: 3 })
  .chain((panels) => clauseTail.map((tail) => panels.join(' + ') + tail));

const topGen = fc.oneof(panelGen, containerGen, overlayGen);

describe('plotDslParser — property tests', () => {
  it('two sequential parses of same src produce structurally equal nodes (1000 iters)', () => {
    fc.assert(
      fc.property(topGen, (src) => {
        const a = parsePlot(src);
        const b = parsePlot(src);
        return JSON.stringify(a.node) === JSON.stringify(b.node);
      }),
      { numRuns: 1000 },
    );
  });

  it('legal sugar inputs never produce error-severity diagnostics (1000 iters)', () => {
    fc.assert(
      fc.property(topGen, (src) => {
        const { diagnostics } = parsePlot(src);
        return diagnostics.every((d) => d.severity !== 'error');
      }),
      { numRuns: 1000 },
    );
  });
});
```

- [ ] Run:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- parser/plotDslParser.property
```

Expected: 2 tests pass, 1000 samples each. Exit code 0.

---

## Task 13: Gate and commit

- [ ] Run the full gate:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test -- parser/plotDslParser && npm run typecheck
```

Expected: all unit + property tests pass (≥ 80 unit cases + 2 property tests). Exit code 0.

- [ ] Stage and commit:

```bash
cd /Users/i560383_1/code/experiments/jfr-query
git add frontend-v2/src/services/parser/plotDslParser.ts \
  frontend-v2/src/services/parser/plotDslGrammar.ts \
  frontend-v2/src/dsl/plotSugar.grammar \
  frontend-v2/src/__tests__/parser/plotDslParser.test.ts \
  frontend-v2/src/__tests__/parser/plotDslParser.property.test.ts \
  frontend-v2/src/services/parser/types.ts \
  frontend-v2/package.json frontend-v2/package-lock.json
git commit -m "feat(v2): M-A3 plot DSL sugar parser — Lezer grammar + 12 types + 3 composers"
```

Expected: commit succeeds. `git log -1 --oneline` shows the new commit.

- [ ] Verify final state:

```bash
cd /Users/i560383_1/code/experiments/jfr-query && git status
```

Expected: working tree clean (no unstaged files beyond unrelated changes).

---

## Done criteria

- 12 plot types parse into PanelNode with correct `plotType`.
- `row`, `col`, `+` composers produce correct ContainerNode / OverlayNode.
- All clause-tail keys recognised; unknown keys emit `UnknownClause` warnings.
- UPPERCASE input returns null node + single `SugarOnly` error with lowercase suggestion.
- Unterminated brace emits `UnterminatedBrace` error.
- ≥ 80 unit cases pass; 1000-iter property test passes.
- `npm run typecheck` exits 0.
- Lezer grammar file committed; generated parser file committed.
