# JFR Notebook redesign — interfaces

Engineer-facing companion to `REDESIGN_PLAN.md`. The plan is the *what and why*; this is the *how*. Every type, contract, and grammar that phase A needs to start coding lives here.

When the two documents conflict, the plan wins for intent — but contradictions should be filed as issues against this doc and reconciled, not silently chosen between.

---

## 1 · AST types

The parser is the single chokepoint between markdown source and every downstream consumer (renderer, formatter, dep-graph, executor). Both DSL forms (UPPERCASE classic and lowercase sugar) produce the same AST.

```ts
// notebook.ts — top-level types
export type NotebookVersion = 1;

export interface Notebook {
  version: NotebookVersion;
  frontmatter: NotebookFrontmatter;
  cells: Cell[];
}

export interface NotebookFrontmatter {
  vars?: Record<string, JsonValue>;       // initial $x values
  freeze_live?: string[];                  // $!vars to persist across sessions
  format?: { onSave?: boolean };
  // unknown keys preserved verbatim
  [key: string]: unknown;
}

export interface Cell {
  alias: string;                           // stable id; #N is display only
  displayIndex: number;                    // 1-based, DOM order
  frontmatter: CellFrontmatter;
  blocks: CellBlock[];                     // ordered: yaml? → sql? → plot? → prose
  // diagnostics attached during parse, not part of source
  diagnostics?: Diagnostic[];
}

export interface CellFrontmatter {
  pinned?: boolean;
  hidden?: boolean;
  autorun?: boolean;
  deps?: string[];                         // explicit cell aliases this depends on
  style?: 'classic' | 'sugar';             // formatter output preference
  last_ai_prompt?: string;                 // §7 provenance
  materialize?: boolean;                   // §4.1 cache hint for hot views
  record_interactions?: boolean;           // §4.4 gesture persistence
  [key: string]: unknown;
}

export type CellBlock = SqlBlock | PlotBlock | ViewBlock | ProseBlock;

export interface SqlBlock {
  kind: 'sql';
  source: string;                          // raw, with comments
  ast: SqlStatement;                       // parsed DuckDB SQL
  registeredAlias?: string;                // from `-- @ alias` comment
}

export interface PlotBlock {
  kind: 'plot';
  source: string;
  form: 'classic' | 'sugar';               // detected during parse
  config: PlotNode;
}

export interface ViewBlock {
  kind: 'view';
  name: string;
  source: string;                          // SQL body
  ast: SqlStatement;
}

export interface ProseBlock {
  kind: 'prose';
  source: string;
}
```

### 1.1 Plot AST

The plot DSL parses to a tree of `PlotNode`. Classic UPPERCASE and lowercase sugar produce identical trees.

```ts
export type PlotNode =
  | PanelNode
  | ContainerNode
  | OverlayNode;

export interface PanelNode {
  kind: 'panel';
  plotType: PlotType;                      // 'line' | 'bar' | 'scatter' | 'histogram' | ...
  config: Record<string, PlotValue>;       // x, y, color, etc.
  clauses: PanelClauses;
}

export interface ContainerNode {
  kind: 'row' | 'col';
  children: PlotNode[];
  clauses: ContainerClauses;
}

export interface OverlayNode {
  kind: 'overlay';                         // `a + b` shared-axis composition
  children: PlotNode[];                    // length >= 2
  clauses: PanelClauses;
}

export type PlotType =
  | 'line' | 'bar' | 'scatter' | 'histogram'
  | 'boxplot' | 'heatmap' | 'pie' | 'flamegraph'
  | 'table';

export interface PanelClauses {
  title?: string;
  width?: Length;                          // '100%', '240px', etc.
  height?: Length;
  zoom?: number;
  linkX?: LinkSpec;
  linkY?: LinkSpec;
  brush?: BrushSpec;                       // §4.1 progressive | live
  on?: (number | string)[];                // §4 cell #3 multi-query
  highlight?: VarRef;                      // defaults to $!hover
}

export interface ContainerClauses {
  title?: string;
  width?: Length;
  height?: Length;
}

export interface LinkSpec {
  variable: VarRef;                        // $!zoom, $!view, or user-named $var
  master: boolean;
  clamp: boolean;
  scope: 'notebook' | 'cell' | { group: string };
}

export interface BrushSpec {
  mode: 'live' | 'progressive';
  finalQuery?: string;                     // alias of a SQL cell to re-run on release
}

// PlotValue is anything that can appear on the RHS of a key
export type PlotValue =
  | string | number | boolean | null
  | PlotValue[]
  | { [k: string]: PlotValue }
  | VarRef;

export interface VarRef {
  kind: 'var';
  name: string;
  scope: 'global' | 'cell' | 'live';       // $x | $$x | $!x
  path?: string[];                         // for $!brush.x0 → ['x0']
}
```

### 1.2 SQL AST

Phase A uses an existing DuckDB SQL parser (the JS port of DuckDB's own grammar, exposed via `duckdb-sql-tools`). We do not write our own.

The parser is a black box for our purposes; we consume two views of its output:

```ts
export interface SqlStatement {
  raw: string;
  kind: 'select' | 'with-select' | 'mutation' | 'unknown';
  references: SqlReference[];              // FROM / JOIN targets
  varRefs: VarRef[];                       // $vars used in SQL
  hasSideEffects: boolean;                 // INSERT/UPDATE/DELETE/CREATE/DROP/COPY
}

export interface SqlReference {
  alias: string;                           // table/view name as written
  resolvedTo?: 'jfr-table' | 'cross-cell-view' | 'unknown';
}
```

**Invariant:** `references[i].alias` is exactly what appears in the source, case-preserved. Resolution against the JFR schema and cross-cell views happens in the dep-graph layer, not the parser.

---

## 2 · Fence grammars

Three fences exist in the new format. Two are unchanged from today; one is new.

```
sql-fence    = "```sql" newline sql-body "```"
plot-fence   = "```plot" newline plot-body "```"
view-fence   = "```view" SP view-name newline sql-body "```"   ; NEW

view-name    = identifier                    ; [a-zA-Z_][a-zA-Z0-9_]*
sql-body     = arbitrary DuckDB SQL, possibly preceded by `-- @ alias` line
plot-body    = either classic-plot or sugar-plot
```

### 2.1 Classic plot grammar (UPPERCASE, existing)

```
classic-plot      = [ let-decl ]* plot-stmt
let-decl          = "LET" SP var-name "=" SP literal newline
plot-stmt         = PLOT-TYPE "(" config-pairs ")" clauses

PLOT-TYPE         = "LINE_CHART" | "BAR_CHART" | "SCATTER_PLOT"
                  | "HISTOGRAM" | "BOX_PLOT" | "HEATMAP"
                  | "PIE_CHART" | "FLAMEGRAPH" | "TABLE"

config-pairs      = config-pair ( "," SP* config-pair )*
config-pair       = key ":" SP value

clauses           = ( clause newline )*
clause            = "TITLE" SP string
                  | "WIDTH" SP length
                  | "HEIGHT" SP length
                  | "ZOOM" SP number
                  | "LINK_X" "(" var-ref "," SP var-ref ( "," SP "clamp" )? ")"
                  | "ON" SP "[" cell-ref ( "," SP cell-ref )* "]"
```

### 2.2 Sugar plot grammar (lowercase, new)

```
sugar-plot        = [ let-decl ]* sugar-tree
sugar-tree        = panel | container | overlay

panel             = plot-name "{" SP* config-pairs SP* "}" clause-tail
container         = ("row" | "col") "{" sugar-tree-list "}" clause-tail
overlay           = sugar-tree ( "+" sugar-tree )+ clause-tail   ; left-associative
sugar-tree-list   = sugar-tree ( separator sugar-tree )*
separator         = ";" | newline newline

clause-tail       = ( "|" SP clause-kv )*
clause-kv         = "title:" SP string
                  | "width:" SP length
                  | "height:" SP length
                  | "zoom:" SP number
                  | "link-x:" SP link-spec
                  | "link-y:" SP link-spec
                  | "on:" SP "[" cell-ref ( "," cell-ref )* "]"
                  | "brush:" SP "{" brush-pairs "}"
                  | "highlight:" SP var-ref

plot-name         = "line" | "bar" | "scatter" | "histogram"
                  | "boxplot" | "heatmap" | "pie" | "flamegraph" | "table"

link-spec         = var-ref ( SP "master" )? ( SP "clamp" )? ( SP "scope=" scope )?
scope             = "notebook" | "cell" | "group=" identifier
brush-pairs       = brush-pair ( "," brush-pair )*
brush-pair        = "mode:" SP ("live" | "progressive")
                  | "final-query:" SP identifier
```

### 2.3 Shared lexemes

```
identifier        = [a-zA-Z_][a-zA-Z0-9_]*
var-ref           = "$" "!"? "$"? identifier ( "." identifier )*
                  ;     ^^^^   ^^^^
                  ;     live   cell-local
cell-ref          = number | identifier         ; #N or alias
literal           = number | string | array | object | var-ref
length            = number ("px" | "%" | "em")
```

### 2.4 The `-- @ alias` directive (inside SQL fences)

```
alias-directive   = "--" SP* "@" SP+ identifier newline
                  ; MUST be the first non-whitespace line of the SQL body
                  ; DuckDB ignores it as a comment; the frontend regexes it back out
                  ; before submitting to the engine
```

---

## 3 · Formatter contract

```ts
export interface FormatterInput {
  source: string;                          // the raw .md file
  cellStyles?: Record<string, 'classic' | 'sugar'>;  // overrides from frontmatter
}

export interface FormatterOutput {
  source: string;                          // canonical .md
  changed: boolean;                        // false if input was already canonical
  changedCells: string[];                  // aliases of cells that diffed
  diagnostics: Diagnostic[];               // syntax errors etc. (non-fatal — see below)
}

export interface Diagnostic {
  cell: string;                            // alias
  block: 'sql' | 'plot' | 'frontmatter' | 'view';
  severity: 'error' | 'warning';
  message: string;
  range?: { start: number; end: number };  // byte offsets in cell source
}

export function format(input: FormatterInput): FormatterOutput;
```

### 3.1 Invariants

1. **Idempotency.** `format(format(x).source) === format(x).source` byte-for-byte. CI runs a property test on every PR.
2. **Error-tolerance.** A cell with a SQL parse error formats its plot block and markdown structure anyway. The cell's source is preserved unchanged for the failing block. Diagnostics surface the error; the formatter does NOT throw.
3. **AST-roundtrip.** For valid input, `parse(format(input).source).ast === parse(input).ast` (structural equality). Comments and whitespace can change; the AST cannot.
4. **No semantic rewrites.** See §8b.5 of the plan. The formatter never changes what a cell *does*.

### 3.2 Canonical output rules

Hard-coded; no per-rule configuration. Documented in §8b.1–8b.3 of the plan; reproduced as enforcement points here:

- SQL keywords UPPERCASE.
- Two-space indent inside subqueries and `WITH ... AS ( ... )`.
- `-- @ alias` pinned to line 1 of the SQL body.
- Plot DSL key order: `data, x, y, lineY, color, size, category, value, bins, ...` (full order: `plot.ts:KEY_ORDER`).
- Cell heading: `### #N <alias>` (three hashes).
- Fence order within cell: `yaml` → `sql` → `plot` → `prose`.
- Exactly one blank line between cells; file ends with `\n`.

---

## 4 · Dep-graph types

The dep graph is computed from `Notebook` by a pure function. The renderer (cytoscape.js with dagre layout — see §6c.7 of the plan) consumes the output.

```ts
export interface DepGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: Cycle[];                         // empty array if acyclic
}

export type GraphNode =
  | CellNode
  | VarNode
  | LiveVarNode;

export interface CellNode {
  kind: 'cell';
  alias: string;
  displayIndex: number;
  status: 'ok' | 'error' | 'running' | 'stale' | 'idle';
  lastRunMs?: number;
  aiAuthored?: boolean;                    // §6b.2 🤖 glyph
}

export interface VarNode {
  kind: 'var';
  name: string;
  scope: 'global' | 'cell';
  currentValue?: JsonValue;
}

export interface LiveVarNode {
  kind: 'live-var';
  name: string;                            // 'brush', 'zoom', 'hover', ...
  currentValue?: JsonValue;
  haloUntilMs?: number;                    // §6c.7 1s static halo after change
  producer?: string;                       // master cell alias if any
}

export type GraphEdge =
  | DataEdge
  | VarEdge
  | LiveVarEdge
  | AxisLinkEdge
  | PromptEdge;

export interface DataEdge {
  kind: 'data';                            // cyan solid
  from: string;                            // source cell alias
  to: string;                              // consumer cell alias
  alias: string;                           // the view name
}

export interface VarEdge {
  kind: 'var';                             // gray dashed
  varName: string;
  scope: 'global' | 'cell';
  from: string;                            // var node id
  to: string;                              // cell alias
  renderOnly: boolean;                     // §6b.3: var in plot config, no SQL re-run
}

export interface LiveVarEdge {
  kind: 'live-var';                        // thick gray dashed
  varName: string;
  from: string;                            // live-var node id
  to: string;                              // cell alias
  direction: 'read' | 'write';             // brush master writes; consumers read
}

export interface AxisLinkEdge {
  kind: 'axis-link';                       // orange thin
  variable: string;                        // usually 'zoom'
  from: string;                            // panel A
  to: string;                              // panel B
  axis: 'x' | 'y' | 'xy';
}

export interface PromptEdge {
  kind: 'prompt';                          // purple dotted
  from: string;                            // referenced cell alias
  to: string;                              // generated cell alias
  prompt: string;                          // for hover provenance
}

export interface Cycle {
  edges: GraphEdge[];                      // in cycle order
  introducedBy: 'static' | 'live';         // static = parse-time, live = runtime fence
}

export function computeDepGraph(notebook: Notebook, runtime: RuntimeState): DepGraph;

export interface RuntimeState {
  cellStatuses: Record<string, CellNode['status']>;
  cellLastRunMs: Record<string, number>;
  varValues: Record<string, JsonValue>;     // global vars
  liveVars: Record<string, LiveVarNode>;    // $! vars with current state
  cycleBreaks: Cycle[];                     // live cycles detected at runtime
}
```

### 4.1 Pure traversal

`computeDepGraph` is **pure**: same `(notebook, runtime)` produces the same graph. No DOM, no animations, no layout. The renderer is responsible for layout and motion; this function is responsible for *what edges exist*.

```ts
// pseudo-implementation
function computeDepGraph(nb: Notebook, rt: RuntimeState): DepGraph {
  const nodes = [...nb.cells.map(toCellNode), ...collectVarNodes(nb), ...collectLiveVarNodes(rt)];
  const edges = [
    ...collectDataEdges(nb),         // FROM alias
    ...collectVarEdges(nb),          // $var in SQL or plot
    ...collectLiveVarEdges(nb, rt),  // $!var in SQL or plot
    ...collectAxisLinkEdges(nb),     // link-x, link-y between panels
    ...collectPromptEdges(nb),       // from last_ai_prompt + @cell chips
  ];
  const cycles = [...detectStaticCycles(nodes, edges), ...rt.cycleBreaks];
  return { nodes, edges, cycles };
}
```

---

## 5 · Runtime contracts (Phase E)

The live-variable runtime is the heaviest single component. Its contract is small.

```ts
export interface LiveVarRuntime {
  read(name: string): JsonValue | undefined;
  write(name: string, value: JsonValue, source: { cell: string; gesture?: string }): void;
  subscribe(name: string, onChange: (value: JsonValue) => void): Unsubscribe;
  pause(): void;                           // §6c.6 "pause live coupling"
  resume(): void;
  snapshot(): Record<string, JsonValue>;   // §4.5 shareable URL encoding
  restore(snapshot: Record<string, JsonValue>): void;
}

export type Unsubscribe = () => void;
```

### 5.1 Cancellation

Every SQL run triggered by a live-var change carries an `AbortSignal` keyed to `(cell, varVersion)`:

```ts
export interface SqlRunRequest {
  cell: string;
  sql: string;                             // post-substitution
  signal: AbortSignal;
  triggeredBy: { kind: 'manual' | 'live-var'; varName?: string };
}
```

The executor (which runs in the Web Worker — see §12 step 0 of the plan) honours `signal.aborted` and calls `cancelPendingQuery()` on the DuckDB connection. The UI shows a `▣ cancelled` pill on the cell head for ~200ms when a cancellation lands.

### 5.2 Debounce policy

Producer-side debouncing uses a leading-edge RAF tick (default 10ms) with per-variable overrides from frontmatter:

```yaml
live: { $!brush: { debounce: 30 } }
```

The first write of a gesture fires immediately. Subsequent writes within the debounce window coalesce. Gesture release (mouseup) always flushes.

---

## 6 · Test surface

For each contract above, the minimum CI test set:

| Contract | Tests |
|---|---|
| AST `parse(format(x)) === parse(x)` | property test, 200+ cases from existing corpus |
| Formatter idempotency | property test on full corpus |
| Formatter error-tolerance | each known-broken cell type roundtrips |
| Dep-graph purity | snapshot tests on 12 representative notebooks |
| Dep-graph cycles | hand-crafted cyclic notebook, expected `cycles[]` |
| Live-var cancellation | mock executor, 100 rapid writes, exactly one query completes |
| Live-var pause/resume | writes during pause stay buffered, fire on resume? **No** — pause freezes the *consumer-visible* value, writes still update internal state |
| Migration | every pre-v1 fixture loads + saves + diffs only on canonical normalization |

---

## 7 · Open questions

Items the plan referenced but this interfaces doc has not yet specced. Each blocks some phase.

1. **`PlotValue` for `xRefLines`, `xDomain`** — currently `PlotValue[]` allows nesting; specific shape (`{value: number, label?: string}` for refLines) is not enforced. Needs a discriminated union per panel type. Blocks phase C.
2. **`SqlStatement.varRefs` for variables inside string literals** — `WHERE name = '$placeholder'`: is that a var ref or a literal? Current answer: literal. Spec needs to commit. Blocks phase A.
3. **`computeDepGraph` complexity bound** — on a 100-cell notebook with 30 vars, what's the upper bound on edges? Needs a worst-case + a benchmark. Blocks phase B (graph performance).
4. **Worker boundary serialization** — `JsonValue` is too loose; `BigInt` and `Date` from DuckDB need a spec'd wire format. Blocks phase A step 0.
5. **Plot AST diff for the formatter** — round-tripping classic ↔ sugar produces semantically-equivalent ASTs but textually different output. The "did this change?" check in `FormatterOutput.changed` needs a structural comparator. Blocks phase C step 9.

Each is small (1–2 days of spec work) but each needs to be answered before its blocked phase ships.

---

*— end of interfaces doc —*
