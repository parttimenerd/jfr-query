# JFR Notebook v2 — Implementation Plan

## Summary

This document is the source-of-truth implementation plan for the **greenfield v2 rewrite** of JFR Notebook. The UX specification is `/Users/i560383_1/code/experiments/jfr-sql-notebook/redesign-plan/showcase.html` (8815 lines, iter-1 through iter-18 converged). Every feature shown there ships in v1.0; v2 is not a subset. The type contracts are `/Users/i560383_1/code/experiments/jfr-sql-notebook/redesign-plan/REDESIGN_INTERFACES.md`.

Scope: a markdown-native JFR analysis notebook with reactive `$x` / `$$x` variables, a sugar-first plot DSL, dep-graph driven re-execution, a local-first agent surface with 10 MCP-style tools, plot composition (`row{}`, `col{}`, `+`), live coupling (brush/hover/zoom/selection/scroll), cross-cell aliasing, formatter-on-save, accessibility (per §10a.1), shareable URLs with optional sidecar, checkpoints, and redaction.

Approach: **greenfield**. v1 stays at `core/frontend/` (tag `v1-archive`); v2 lives at `frontend-v2/`. We **reuse** the DuckDB-WASM loader, the GraalVM JFR importer bundle (`jfr-importer.js[.wasm][.wat]`), the 12 reference plot renderers, and the package.json dep set — but we re-implement the parser, formatter, dep graph, runtime, agent, and UI shell from scratch against the new interfaces.

### Constraints (load-bearing — call these out in every milestone)

- **Sugar-only DSL.** Lowercase `line { ... } | title: "..."`. UPPERCASE `LINE_CHART(...)` is rejected at parse time with a `SugarOnly` diagnostic that includes a one-shot rewrite suggestion. The classic grammar in REDESIGN_INTERFACES.md §2.1 is for migration tooling only — never accepted by the live parser.
- **Dep-graph first.** Re-runs flow through the dep graph. No cell ever re-executes because of a side-effecting hook; the graph is the single source of truth for `who-depends-on-what`.
- **Cell-emit never auto-accepts.** When the agent proposes a cell (§7c), it renders as a diff with Accept / Edit prompt / Reject. There is no "auto-accept after N seconds." Atomic multi-cell flows accept or reject as one transaction.
- **COOP/COEP for SharedArrayBuffer.** Vite dev server and prod build serve `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` so DuckDB-WASM can use threads. Tested in M-A6.
- **Accessibility per §10a.1.** ARIA labels on all interactive elements; visible focus ring (2px outline, color-independent); keyboard nav (Tab/Shift+Tab/Enter/Space/Escape); contrast ≥4.5:1; respects `prefers-reduced-motion`; color is never the only signal. axe-core CI gate per milestone touching UI.

### How to use this plan

Each milestone (`M-Xx`) is a **self-contained agent prompt**. An implementing agent reads one milestone, reads the files the prompt names, writes the files the prompt names, runs the tests the prompt names, and verifies the gate the prompt names. No re-reading the full plan is required. Milestones chain (later milestones may depend on earlier ones — noted in `Blocked by:`). The coverage matrix at end-of-file tracks completion against showcase sections.

A milestone is **not complete** until:
1. All files listed under `Files:` exist.
2. All tests listed under `Tests:` exist and pass under `npm run test` (and `npm run test:e2e` / `npm run test:visual` / `npm run test:a11y` as applicable).
3. The verifiable `Gate:` criterion holds.
4. `npm run typecheck` and `npm run lint` are clean.

---

## Repository Layout

v1 (preserved, untouched, tagged `v1-archive`): `/Users/i560383_1/code/experiments/jfr-query/core/frontend/`.

v2 lives at `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/`:

```
frontend-v2/
  src/
    App.tsx
    index.tsx
    index.css                       # tailwind entry + CSS custom properties (theme tokens)
    components/
      Shell.tsx                     # top-level layout: topbar, sidebar, cell column, chat drawer
      Topbar.tsx                    # title, varbar, status pill, ⌘⇧E count, menu
      Sidebar.tsx                   # TABLES / VIEWS / MACROS / preview pane
      CellEditor.tsx                # CodeMirror 6 host, fence routing
      CellHeader.tsx                # head zone — chips, status, ⋯ menu
      CellMenu.tsx                  # ⋯ per-cell menu
      DepGraphOverlay.tsx           # Cytoscape modal, ⌘G
      IssuesPanel.tsx               # diagnostic list + quickfix menu (⌥↵)
      ActivityFeed.tsx              # ⌥A drawer — timeline, time-travel undo
      WelcomeCell.tsx               # empty-state cell
      KeyboardMap.tsx               # ⌘⇧K modal
      plots/
        LineChart.tsx               # line
        BarChart.tsx                # bar
        ScatterPlot.tsx             # scatter
        Histogram.tsx               # histogram
        BoxPlot.tsx                 # boxplot
        Heatmap.tsx                 # heatmap
        Pie.tsx                     # pie
        Flamegraph.tsx              # flamegraph
        ResultTable.tsx             # table
        GanttChart.tsx              # gantt
        AreaChart.tsx               # area
        RangePlot.tsx               # range
        PlotContainer.tsx           # row{} / col{}
        OverlayCompose.tsx          # a + b
        PlotStates.tsx              # idle / loading / rendered / error / empty
      agent/
        ChatPanel.tsx               # docked drawer + maximize overlay
        InlineChat.tsx              # cursor-overlay Copilot-style
        ToolCall.tsx                # tool invocation row in transcript
        CellEmitProposal.tsx        # diff + Accept/Reject + atomic group
        ContextInspector.tsx        # what the model "sees" (when maximized)
      sidebar/
        TablesPanel.tsx
        ViewsPanel.tsx
        MacrosPanel.tsx
        PreviewPane.tsx             # editable SQL + sortable/filterable grid
      palette/
        CommandPalette.tsx          # ⌘K (kinds: cells, vars, macros, views, docs)
        SlashMenu.tsx               # in-cell / prefix
      docs/
        DocsModal.tsx               # ⌘⇧/ — searchable docs (§1d)
    hooks/
      useNotebook.ts                # source ↔ AST ↔ render
      useDepGraph.ts                # subscribe to computed graph
      useLiveVar.ts                 # $x read/write/subscribe
      useGlobalVar.ts               # $$x cross-notebook
      useDuckDB.ts                  # worker-backed query handle
      useKeyboardShortcut.ts
      useReducedMotion.ts
      useAxeAudit.ts                # dev-only a11y monitor
    context/
      NotebookContext.tsx
      SettingsContext.tsx           # theme, units, locale
      DuckDBContext.tsx             # worker handle + status
      AgentContext.tsx              # session, transcript, tool registry binding
      LiveVarContext.tsx
    services/
      parser/
        notebookParser.ts           # md → Notebook AST + diagnostics
        sqlParser.ts                # SQL refs + var refs + alias resolver
        identifierResolver.ts
        plotDslParser.ts            # sugar-only PlotNode AST
        plotDslGrammar.ts           # Lezer grammar
        validator.ts                # cross-block validation
        types.ts                    # re-exports REDESIGN_INTERFACES types
      formatter/
        sqlFormatter.ts
        plotFormatter.ts
        notebookFormatter.ts
        keyOrder.ts                 # canonical key order tables
      depGraph/
        DepGraph.ts                 # pure compute(nodes, edges, cycles)
        edgeBuilder.ts              # 5 edge kinds
        cycleDetection.ts           # Tarjan SCC
      liveVar/
        liveVarRuntime.ts           # read/write/subscribe/pause/resume/snapshot
        liveVarTypes.ts             # LiveRangeValue, LiveHoverValue, LiveZoomValue
        debounce.ts                 # leading-edge RAF + per-var override
      agent/
        agentService.ts             # session, transcript, dispatch
        toolRegistry.ts             # 10 MCP tools
        cellEmitParser.ts           # parse model output → CellEmit proposal
        promptGrammar.ts            # EBNF tokenizer + 7 verbs + 5 targets
        localModel.ts               # HuggingFace transformers fallback
      duckdb/
        worker.ts                   # Web Worker entry (DuckDB-WASM + AbortSignal)
        client.ts                   # main-thread client (postMessage wrapper)
        protocol.ts                 # message types
      jfr/
        jfrLoader.ts                # GraalVM jfr-importer.js bridge (worker side)
        progressTracker.ts          # progress events for §0c.2
      share/
        urlEncoder.ts               # encode live state to URL, size cap, sidecar
        urlDecoder.ts
        sidecarStore.ts             # OPFS-backed overflow storage
      checkpoint/
        checkpointStore.ts          # auto+manual snapshots
      redaction/
        redactionPolicy.ts          # PII rules, column masks
    utils/
      duckdbWasmLoader.ts           # COPIED from v1 (jsDelivr bundle init)
      jfrToWasmLoader.ts            # COPIED from v1 (script-injection bridge)
      plotUtils.ts
      urlSharing.ts
      a11y.ts                       # focus trap, aria helpers
      time.ts                       # locale-aware formatting (§1b.7)
      arrowJson.ts                  # BigInt/Date wire format (Q4 from interfaces)
    __tests__/
      parser/
      formatter/
      depGraph/
      liveVar/
      agent/
      duckdb/
      jfr/
      plots/
      a11y/
      share/
  tests/
    e2e/                            # Playwright specs (one per showcase §-section)
    visual/                         # plot snapshot tests
    fixtures/                       # .notebook.md fixtures, sample .jfr files
  public/
    jfr-importer.js                 # COPIED from v1 wasm bundle
    jfr-importer.wasm
    jfr-importer.wat
  vite.config.ts                    # COOP/COEP headers, optimizeDeps excludes
  vitest.config.ts                  # worker-aware test env
  playwright.config.ts
  tsconfig.json
  package.json
```

v1 stays at `core/frontend/` and is **read-only** during v2 development. Tag `v1-archive` is cut before v2 work begins. v2 ships as `frontend-v2/`; once shipped, `core/frontend/` may be removed in a follow-up.

---

## Reuse Manifest

Every file listed below is brought over from v1 with the explicit changes noted. Anything not in this table is **new** in v2.

| v1 source | v2 target | Change |
|---|---|---|
| `core/frontend/utils/duckdbWasmLoader.ts` | `frontend-v2/src/utils/duckdbWasmLoader.ts` | Copy-as-is. Worker wrapping moves to `services/duckdb/worker.ts`; this file remains the bundle-selection helper. |
| `core/frontend/utils/jfrToWasmLoader.ts` | `frontend-v2/src/utils/jfrToWasmLoader.ts` | Adapt: instead of injecting `<script>` into `document.head`, the worker imports the script via `importScripts('/jfr-importer.js')`. Built-in macros / views SQL execution stays main-thread (M-A7 wires it through the worker protocol). |
| `core/frontend/public/wasm/jfr-importer.js` | `frontend-v2/public/jfr-importer.js` | Copy-as-is (GraalVM-compiled). Path is flattened — no `/wasm/` prefix. |
| `core/frontend/public/wasm/jfr-importer.wasm` | `frontend-v2/public/jfr-importer.wasm` | Copy-as-is. |
| `core/frontend/public/wasm/jfr-importer.wat` | `frontend-v2/public/jfr-importer.wat` | Copy-as-is (debug aid). |
| `core/frontend/components/plots/LineChartPlot.tsx` | `frontend-v2/src/components/plots/LineChart.tsx` | Rewrite prop interface to `PlotNodeProps` (PanelNode + data + live-var bindings); keep Recharts rendering body. |
| `core/frontend/components/plots/BarChartPlot.tsx` | `frontend-v2/src/components/plots/BarChart.tsx` | Same prop-interface rewrite. |
| `core/frontend/components/plots/ScatterPlot.tsx` | `frontend-v2/src/components/plots/ScatterPlot.tsx` | Same. |
| `core/frontend/components/plots/HistogramPlot.tsx` | `frontend-v2/src/components/plots/Histogram.tsx` | Same. |
| `core/frontend/components/plots/BoxPlot.tsx` | `frontend-v2/src/components/plots/BoxPlot.tsx` | Same. |
| `core/frontend/components/plots/HeatmapPlot.tsx` | `frontend-v2/src/components/plots/Heatmap.tsx` | Same. |
| `core/frontend/components/plots/PieChart.tsx` | `frontend-v2/src/components/plots/Pie.tsx` | Same. |
| `core/frontend/components/plots/FlamegraphPlot.tsx` | `frontend-v2/src/components/plots/Flamegraph.tsx` | Same; add categorical hover producer (§IT15.2). |
| `core/frontend/components/plots/TablePlot.tsx` | `frontend-v2/src/components/plots/ResultTable.tsx` | Same; add selection producer (§5). |
| `core/frontend/components/plots/GanttPlot.tsx` | `frontend-v2/src/components/plots/GanttChart.tsx` | Same. |
| `core/frontend/components/plots/AreaPlot.tsx` | `frontend-v2/src/components/plots/AreaChart.tsx` | Same. |
| `core/frontend/components/plots/RangePlot.tsx` | `frontend-v2/src/components/plots/RangePlot.tsx` | Same. |
| `core/frontend/package.json` | `frontend-v2/package.json` | Re-author. Inherit dep versions; add `playwright/test`, `fast-check`, `axe-core`, `@axe-core/playwright`, `sql-formatter`, `cytoscape`, `cytoscape-dagre`. |
| `core/frontend/vite.config.ts` | `frontend-v2/vite.config.ts` | Re-author. Add COOP=same-origin + COEP=require-corp headers in `server.headers` and `preview.headers`; `optimizeDeps.exclude = ['@duckdb/duckdb-wasm']`; worker format `'es'`. |
| `core/frontend/data/builtinSql.ts` | `frontend-v2/src/services/jfr/builtinSql.ts` | Copy-as-is (BUILTIN_MACROS_SQL, BUILTIN_VIEWS_SQL). |
| `/Users/i560383_1/code/experiments/jfr-sql-notebook/services/ai/IAiProvider.ts` | `frontend-v2/src/services/ai/IAiProvider.ts` | **Port verbatim** as the canonical AI provider interface (`getAgentResponse`, `getInlineSuggestion`, `getCodeFormat`, `getSuggestPlot`, `getPlotFixSuggestion`, `verifyCredentials`, static `getMetadata()`). Plus the `ProviderMetadata`, `AIResponse`, `AIInlineResponse`, `AIPlotFixResponse`, `AiProviderType` types. Adjust imports only — interface stays byte-identical. |
| `/Users/i560383_1/code/experiments/jfr-sql-notebook/services/ai/GeminiProvider.ts` | `frontend-v2/src/services/ai/GeminiProvider.ts` | Port verbatim. Implements `IAiProvider` against `@google/genai`'s `GoogleGenAI` client. Ships in v2 as a default external-LLM backend. |
| `/Users/i560383_1/code/experiments/jfr-sql-notebook/services/ai/OpenAiProvider.ts` | `frontend-v2/src/services/ai/OpenAiProvider.ts` | Port verbatim. Implements `IAiProvider` via direct fetch against `https://api.openai.com/v1/chat/completions` (no SDK). Ships in v2 as a default external-LLM backend. |
| `/Users/i560383_1/code/experiments/jfr-sql-notebook/services/ai/GardenerProvider.ts` | `frontend-v2/src/services/ai/GardenerProvider.ts` | Port verbatim. SAP-internal multi-provider gateway; direct fetch. Implements `IAiProvider`. Ships in v2 as the third default external-LLM backend. |
| `/Users/i560383_1/code/experiments/jfr-sql-notebook/services/AiService.ts` | `frontend-v2/src/services/ai/providerRegistry.ts` | Port the `providerRegistry` (id → constructor) + `providerMetadataRegistry` (id → display metadata) + `getEffectiveApiKey(provider, settings)` env-or-settings fallback logic. Keep v1's three-key fallback chain: settings key → `process.env.<PROVIDER>_API_KEY` → empty. |

**v2's M-D2 tool registry is layered ON TOP of `IAiProvider` — the provider returns text/JSON, the tool registry routes tool-call JSON. No replacement of the contract.** The ported interface is the single seam between the agent surface (Phase D) and the underlying LLM backend; M-D2 dispatches tool calls *after* the provider returns; M-D7 retries/failovers *between* provider calls; the provider itself stays a thin transport.

Everything else (parser, formatter, dep graph, runtime, UI shell, agent UI surface, sidebar, palette, docs modal, plot composition, dep-graph overlay, issues panel, activity feed, varbar, live-var runtime, sharing, checkpoints, redaction) is **net new**.

---

## Stack & Tooling

### Runtime dependencies

| Package | Version | Why |
|---|---|---|
| `react` | `^19.2.0` | UI |
| `react-dom` | `^19.2.0` | UI |
| `@duckdb/duckdb-wasm` | `^1.29.0` | SQL engine in worker |
| `apache-arrow` | `^17.0.0` | DuckDB result rows |
| `@codemirror/state` | `^6.5.0` | Editor state |
| `@codemirror/view` | `^6.43.0` | Editor view |
| `@codemirror/lang-sql` | `^6.10.0` | SQL lang |
| `@codemirror/lang-markdown` | `^6.3.0` | Markdown lang |
| `@codemirror/autocomplete` | `^6.18.0` | Slash menu, autocomplete |
| `@codemirror/lint` | `^6.8.0` | Inline diagnostics |
| `@codemirror/commands`, `/language`, `/search` | latest from v1 | Editor commands |
| `@lezer/common`, `/lr`, `/highlight`, `/generator` | latest from v1 | Plot DSL grammar |
| `recharts` | `^3.2.1` | Plot rendering body — covers 10/12 plot types (line, bar, scatter, area, histogram, pie, boxplot, heatmap, range, table). Flamegraph and gantt use raw D3 (see below). Overlay composer (`a + b`) syncs shared axes via controlled `domain` props, which works across Recharts and D3 renderers. |
| `d3-scale` | `^4.0.0` | Time + band scales for flamegraph and gantt; declare directly — do not rely on recharts transitive dep (NEW) |
| `d3-shape` | `^3.0.0` | Partition layout + area generators; `stackOffsetWiggle` for streamgraph mode in M-C5 (NEW) |
| `d3-hierarchy` | `^3.0.0` | Flamegraph partition layout (NEW) |
| `d3-time` | `^3.0.0` | Gantt time axis formatting (NEW) |
| `d3-brush` | `^3.0.0` | Brush gesture → `$alias.brush` live-var write (Phase E, M-E1) (NEW) |
| `d3-zoom` | `^3.0.0` | Zoom gesture → `$alias.zoom` live-var write (Phase E, M-E1) (NEW) |
| `cytoscape` | `^3.30.0` | Dep-graph overlay (NEW) |
| `cytoscape-dagre` | `^2.5.0` | Layered layout (NEW) |
| `onnxruntime-web` | `^1.18.0` | **Local-first `plotForSql` inference** — runs the showcase-specified ~25M parameter ONNX model (showcase §7a.10.4) in a Web Worker with the WASM (CPU) backend; no GPU dependency. Replaces the previously-considered `@huggingface/transformers` path (which was evaluated and rejected in favor of the showcase-specified ONNX model). |
| `@google/genai` | `^1.22.0` | Gemini provider (ported from v1 `services/ai/GeminiProvider.ts`). OpenAI and Gardener providers ship with **bare `fetch`** — no SDK — matching v1. |
| `react-markdown` | `^10.1.0` | Prose rendering |
| `react-dropzone` | `^14.3.8` | .jfr ingest UI |
| `sql-formatter` | `^15.0.0` | SQL canonicalization (NEW) |

### Dev dependencies

| Package | Version | Why |
|---|---|---|
| `vite` | `^6.2.0` | Bundler |
| `@vitejs/plugin-react` | `^5.0.0` | React |
| `@tailwindcss/vite` | `^4.3.1` | Tailwind v4 |
| `tailwindcss` | `^4.3.1` | Styling |
| `typescript` | `~5.8.2` | Types |
| `vitest` | `^4.1.9` | Unit + integration |
| `@vitest/ui` | `^4.1.9` | Test UI |
| `fast-check` | `^3.22.0` | Property tests (NEW) |
| `playwright` | `^1.61.0` | E2E |
| `@playwright/test` | `^1.61.0` | E2E runner (NEW) |
| `axe-core` | `^4.10.0` | A11y (NEW) |
| `@axe-core/playwright` | `^4.10.0` | A11y in E2E (NEW) |
| `@adobe/leonardo-contrast-colors` | `^1.0.0` | Pre-commit OKLCH-aware contrast check on `--chart-*`/`--bg-*`/`--fg-*` tokens; PR gate fails on any token < 3:1 against `--bg-base` (NEW) |
| `colorblind` | `^0.1.9` | Deuteranopia/protanopia/tritanopia matrix simulation for heatmap palette screenshots in M-C3 (NEW) |
| `@types/cytoscape` | `^3.x` | Types for cytoscape (NEW) |
| `@types/node` | `^22.14.0` | Node types |

### Chart library strategy

The 12 plot types are implemented with a **hybrid Recharts + D3** approach:

- **Recharts** handles 10/12 types: line, bar, scatter, area, histogram, pie, boxplot, heatmap, range, table. V1's chart bodies port directly; the only change per type is the prop adapter (`PanelNode` → series array).
- **Raw D3** handles the two custom types that no off-the-shelf component covers well:
  - **Flamegraph** — `d3-hierarchy` partition layout, recursive SVG `<rect>` render, zoom-on-click. Ported from v1.
  - **Gantt** — `d3-scale` (time + band), SVG `<rect>` per interval, lane packing. New in v2.
- **D3 brush/zoom** (Phase E) wrap any SVG plot surface to produce `$alias.brush` and `$alias.zoom` live-vars; these are gesture-layer wrappers, not replacements for the rendering library.
- **Overlay composer seam** (`a + b`): axis domain reconciliation is done by passing computed `[min, max]` domain props into each renderer's `XAxis`/`YAxis`. This works identically for Recharts and D3 renderers since both accept controlled domain props.

Do **not** add Visx, Nivo, Plotly, or ECharts — the hybrid approach covers all requirements without the bundle cost or divergent API surface.

### Vite config notes

- `server.headers` and `preview.headers`: `'Cross-Origin-Opener-Policy': 'same-origin'`, `'Cross-Origin-Embedder-Policy': 'require-corp'`, `'Cross-Origin-Resource-Policy': 'cross-origin'`. Required so `SharedArrayBuffer` is exposed for DuckDB-WASM threading.
- `optimizeDeps.exclude: ['@duckdb/duckdb-wasm']` — the package self-hosts its worker; pre-bundling breaks it.
- `worker.format: 'es'` so our worker can `import` directly.
- `define`: pass `__APP_VERSION__` for the welcome cell, `__BUILD_TIME__` for the activity feed.
- Optional `/api` proxy: dev-only, points to the legacy jfr-query server when env var `VITE_API_URL` is set (v2 is browser-first; the server path is a fallback).

### Commands

```
npm install
npm run dev               # Vite dev server with COOP/COEP
npm run build             # production bundle
npm run preview           # serve built output with COOP/COEP
npm run typecheck         # tsc --noEmit
npm run lint              # eslint
npm run test              # vitest run (unit + property + integration)
npm run test:watch        # vitest
npm run test:ui           # @vitest/ui
npm run test:e2e          # playwright test
npm run test:visual       # playwright test --grep @visual
npm run test:a11y         # playwright test --grep @a11y
npm run test:perf         # vitest bench (Vitest's built-in benchmarking; picks up src/**/*.bench.ts)
```

> **Note on integration tests**: there is no top-level `test:integration` script. Integration tests live in `**/integration/*.test.ts` and are run as a path filter under the regular `npm run test` command, e.g. `vitest run --testPathPattern integration` or `npm run test -- integration/`. Any acceptance line referencing `npm run test:integration -- <subpath>` is shorthand for `npm run test -- integration/<subpath>`.

---

## Testing Strategy

A milestone is not "done" without its named tests. CI runs all five categories on every PR.

### Test taxonomy

- **Unit (Vitest)** — pure functions, parsers, formatters, dep-graph builders, live-var runtime, utility functions. Test files: `src/__tests__/<area>/*.test.ts`. Coverage target: **80%+ line, 90%+ for parser/formatter/depGraph** (these are the load-bearing core). Run with `npm run test`.
- **Property (fast-check)** — invariants over generated inputs. Test files: `src/__tests__/<area>/*.property.test.ts`. Each property runs **1000+ iterations** unless noted (idempotency runs **5000+**). Properties: parser round-trip, formatter idempotency, dep-graph acyclic-on-acyclic-input, dep-graph deterministic, live-var monotonic write ordering, share-URL encode/decode bijection.
- **Integration (Vitest + real DuckDB-WASM in worker)** — boots a real worker, registers a real fixture .jfr file, executes real queries. Test files: `src/__tests__/integration/*.test.ts`. Verifies: query exec, JFR loading, cross-cell aliasing, live-var propagation through SQL, cell-emit acceptance commits AST, formatter-on-save with real notebook fixture.
- **E2E (Playwright)** — one spec file per showcase `§`-section under `tests/e2e/`. Verifies: full user flows, every error state catalogued in §6b, loading states (skeleton, spinner, progress bar), empty states (welcome, no-results, no-rows), keyboard navigation (Tab, Shift+Tab, Enter, Escape, ⌘K, ⌘G, ⌘⇧M, ⌘⇧K, ⌥A, ⌥H, ⌘⇧F, ⌘⏎, ⌘⇧⏎, ⌘\).
- **Visual regression (Playwright snapshots)** — under `tests/visual/`. **12 plot types × 5 states** (idle, loading, rendered, error, empty) = 60 baseline screenshots. Plus 3 composer screenshots (row{}, col{}, +) and the 5 dep-graph node/edge styles. Tag `@visual`. Snapshots committed to repo; diff threshold 0.5%.
- **A11y (axe-core)** — `tests/e2e/*.a11y.spec.ts` tagged `@a11y`. Asserts: WCAG 2.1 AA on every authored surface, focus trap on every modal, `prefers-reduced-motion` honored, color is never the only signal (e.g. issue severity also encoded as glyph). Run on every PR via `npm run test:a11y`.
- **Perf budgets (Playwright + custom probe)** — assert per §8a: cold-start ≤ 2s, first query warm ≤ 500ms, result render ≤ 100ms for 10k rows, formatter ≤ 50ms for the canonical 50-cell fixture, dep-graph compute ≤ 30ms for a 100-cell / 30-var notebook, live-var brush propagation ≤ 50ms p95 from gesture to consumer render-start.

### File layout

```
src/__tests__/
  parser/notebookParser.test.ts
  parser/notebookParser.property.test.ts
  parser/sqlParser.test.ts
  parser/plotDslParser.test.ts
  parser/plotDslParser.property.test.ts
  formatter/sqlFormatter.test.ts
  formatter/plotFormatter.test.ts
  formatter/notebookFormatter.property.test.ts
  depGraph/edgeBuilder.test.ts
  depGraph/cycleDetection.test.ts
  depGraph/DepGraph.property.test.ts
  duckdb/worker.test.ts
  duckdb/cancellation.test.ts
  jfr/jfrLoader.test.ts
  integration/queryRoundTrip.test.ts
  ...
tests/
  e2e/
    01-shell-and-ingest.spec.ts
    02-vars-and-sigils.spec.ts
    03-plot-dsl.spec.ts
    04-cross-cell.spec.ts
    05-live-coupling.spec.ts
    06-issues.spec.ts
    07-agent.spec.ts
    08-formatter.spec.ts
    10-share-a11y.spec.ts
    ...
  visual/
    plots.spec.ts
    depGraph.spec.ts
  fixtures/
    notebooks/canonical-50-cells.notebook.md
    notebooks/iter14-in-brush.notebook.md
    jfr/sample-small.jfr
    jfr/sample-large.jfr
```

### Rule: tests block ship

A milestone PR cannot land until:
1. All named test files exist.
2. `npm run test`, `npm run test:e2e`, `npm run test:visual`, `npm run test:a11y` are all green.
3. The milestone's `Gate:` is verifiable by a CI step (i.e., not "looks right to me").

---

## Phase A — Foundations

Phase A delivers the non-UI core: a parser that round-trips byte-for-byte, an identifier resolver, a sugar-only plot DSL parser, a five-edge-kind dep graph, an idempotent formatter, a DuckDB-WASM Web Worker with `AbortSignal`-driven cancellation, and a JFR loader inside that worker. Showcase refs: §0d (persistence), §2 (sigils — types only, no UI yet), §3 (DSL — types only), §3d (macro fence), §4 (cross-cell — graph only), §8 (formatter), §8a (performance baseline), §9 (cheatsheet — grammar conformance). No user-visible UI ships in Phase A; everything is verified by unit, property, and integration tests.

---

### M-A0: Scaffold `frontend-v2/` — project bootstrap, build config, test runners, fixtures

**What**: Create the empty `frontend-v2/` project that every later milestone builds inside. Initialize `package.json` with the dep set from "Stack & Tooling" pinned to exact versions; wire `vite.config.ts` with COOP=same-origin / COEP=require-corp headers (load-bearing for SharedArrayBuffer + DuckDB-WASM); configure `vitest.config.ts` with worker + jsdom env; commit `playwright.config.ts` (Chromium baseline, dark + light theme projects); configure Tailwind v4 (CSS-first; configuration lives in `src/styles/tokens.css` inside `@theme { … }`. Do NOT create `tailwind.config.js`); emit `tsconfig.json` with strict mode + path aliases (`@/services/*`, `@/components/*`); write a minimal `index.html` shell + `src/main.tsx` that mounts `<App />` (placeholder `<div>v2</div>`). Commit `tests/fixtures/jfr/sample-small.jfr` (≤200KB) and `sample-large.jfr` (≤10MB) by copying from the v1 fixture directory (path resolved in Step 1 above). Add npm scripts: `dev`, `build`, `preview`, `test`, `test:watch`, `test:ui`, `test:e2e`, `test:visual`, `test:a11y`, `test:perf` (Vitest bench), `lint`, `format`, `typecheck`. Final state: `cd frontend-v2 && npm install && npm run test && npm run typecheck && npm run build` all succeed with zero implementation code.

> **Tailwind v4 note**: Tailwind v4 is CSS-first; configuration lives in `src/styles/tokens.css` inside `@theme { … }`. Do NOT create `tailwind.config.js`. The Vite plugin (`@tailwindcss/vite`) reads the CSS directly. If you find yourself reaching for a JS config, you are following v3 patterns; re-read the v4 migration guide.

**Showcase**: §0 (architecture intro — Vite + Vitest + Playwright stack), §10c.1 ($$ai_providers persistence layer requires localStorage, which COOP/COEP affects), §12.x (perf budgets requiring SharedArrayBuffer).

**Files**:
- `frontend-v2/package.json` (create) — deps pinned from "Stack & Tooling" table.
- `frontend-v2/vite.config.ts` (create) — `server.headers` COOP/COEP, `optimizeDeps.exclude` for `@duckdb/duckdb-wasm`, worker plugin.
- `frontend-v2/vitest.config.ts` (create) — jsdom env, worker mock, alias from tsconfig.
- `frontend-v2/playwright.config.ts` (create) — Chromium baseline; two projects (`dark`, `light`) with corresponding `prefers-color-scheme` emulation; `webServer` starts `npm run preview`.
- `frontend-v2/src/theme/tokens.css` (create) — Tailwind v4 `@theme { … }` block declaring design tokens (color, spacing, font, radius scales); imported by `src/main.tsx` so the Vite plugin picks it up. Tailwind v4 is CSS-first; configuration lives in `src/styles/tokens.css` inside `@theme { … }`. Do NOT create `tailwind.config.js`. Design Polish milestones later expand the token set inside this same file.
- `frontend-v2/tsconfig.json` (create) — strict mode, `moduleResolution: "bundler"`, path aliases.
- `frontend-v2/index.html` (create) — minimal shell with `<div id="root">` and `<script type="module" src="/src/main.tsx">`.
- `frontend-v2/src/main.tsx` (create) — mounts `<App />` placeholder.
- `frontend-v2/src/App.tsx` (create) — temporary `<div>v2</div>`.
- `frontend-v2/tests/fixtures/jfr/sample-small.jfr` (commit binary — copied from v1).
- `frontend-v2/tests/fixtures/jfr/sample-large.jfr` (commit binary — copied from v1).
- `frontend-v2/tests/fixtures/jfr/README.md` (create) — documents fixture provenance and regeneration steps.
- `frontend-v2/.gitignore`, `frontend-v2/.eslintrc.cjs`, `frontend-v2/.prettierrc` (create).

**Tests**: smoke
- `npm install` exits 0.
- `npm run typecheck` exits 0 (empty source set is trivially typechecked).
- `npm run test` exits 0 with zero tests collected.
- `npm run build` produces `dist/` with `index.html` + hashed JS chunk.
- `npm run preview` serves on a port and `curl -I` shows the COOP/COEP headers in the response.
- `npm run test:e2e` exits 0 with zero specs.
- Fixture files exist and are non-empty: `test -s frontend-v2/tests/fixtures/jfr/sample-small.jfr`.

**Gate**: `frontend-v2/` exists with all config files; `npm install && npm run test && npm run typecheck && npm run build` all succeed; COOP/COEP headers verified via `npm run preview` curl; both JFR fixtures committed.

**Blocked by**: nothing.

> **Agent prompt (M-A0):**
>
> Create the `frontend-v2/` directory under the repo root and bootstrap it as a Vite 6 + React 19 + TypeScript 5.8 project. Read the "Stack & Tooling" section of this plan (above) for exact dep versions — pin every dep, no `^` ranges. Read showcase.html §0 for project conventions. The COOP=same-origin / COEP=require-corp headers in `vite.config.ts` are **load-bearing** for SharedArrayBuffer (DuckDB-WASM needs it); verify with `curl -I http://localhost:4173` after `npm run preview`.
>
> `vitest.config.ts`: jsdom env, `setupFiles: ['./vitest.setup.ts']`, alias array from `tsconfig.json` paths, `test.include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}']`. Add `test.benchmark.include: ['src/**/*.bench.ts']` for the `test:perf` script (Vitest bench mode — `vitest bench`).
>
> `playwright.config.ts`: two projects, `dark` and `light`, sharing the same Chromium baseline but emulating `prefers-color-scheme`. `webServer.command = 'npm run preview'`. `expect.toHaveScreenshot.maxDiffPixelRatio: 0.001` (matches the Design Polish 0.1% tolerance).
>
> **JFR fixtures**: copy `sample-small.jfr` and `sample-large.jfr` from the v1 source directory (verified above to be at `/Users/i560383_1/code/experiments/jfr-query/core/jfr_files/`; only `default.jfr` (6MB) fits the ≤10MB cap and should be used as `sample-large.jfr`; for `sample-small.jfr`, derive a ≤200KB recording by truncating `default.jfr` with the GraalVM `jfr-importer` or by re-recording a 1-second profile if the truncation path is unsafe — document the chosen method in the fixture README). Commit both at `frontend-v2/tests/fixtures/jfr/`. Add a `README.md` documenting: origin (v1 path `core/jfr_files/default.jfr`), size, recording duration, event count, regeneration command, and a note that fixtures are committed binaries because the project must run offline.
>
> `tsconfig.json` path aliases: `@/services/*`, `@/components/*`, `@/context/*`, `@/hooks/*`, `@/utils/*`, `@/copy/*`. These match the file-tree layout in the "Repository Layout" section.
>
> `package.json` scripts:
> ```json
> {
>   "dev": "vite",
>   "build": "tsc -b && vite build",
>   "preview": "vite preview --port 4173",
>   "test": "vitest run",
>   "test:watch": "vitest",
>   "test:ui": "vitest --ui",
>   "test:e2e": "playwright test",
>   "test:visual": "playwright test --project=dark --project=light --grep @visual",
>   "test:a11y": "vitest run --grep '@a11y'",
>   "test:perf": "vitest bench",
>   "lint": "eslint src tests",
>   "format": "prettier --write src tests",
>   "typecheck": "tsc -b --noEmit"
> }
> ```
>
> Tests: see Gate list. The curl check of COOP/COEP headers is the single most important verification — if those headers don't land, DuckDB-WASM (M-A6) will crash later with a cryptic SharedArrayBuffer error.
>
> Acceptance: `cd frontend-v2 && npm install && npm run typecheck && npm run test && npm run build && npm run preview` succeed; `curl -I http://localhost:4173` shows both `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`; `test -s tests/fixtures/jfr/sample-small.jfr && test -s tests/fixtures/jfr/sample-large.jfr` both pass.

---

### M-A1: Notebook markdown parser + round-trip property

**What**: Parse `.notebook.md` source into a `Notebook` AST per REDESIGN_INTERFACES.md §1 (Notebook, Cell, CellBlock union of SqlBlock | PlotBlock | ViewBlock | MacroBlock | ProseBlock, Frontmatter). Support YAML frontmatter at the notebook and per-cell level; the four fence kinds (`` ```sql ``, `` ```plot ``, `` ```view <name> ``, `` ```macro <name> ``); prose blocks (everything outside fences inside a cell); cell delimiters (`### #N <alias>` headings — three hashes). The `serialize(notebook)` function returns source **byte-identical** to its input for legal inputs.

**Showcase**: §0d (persistence model), §3d (macro fence), §3c (prose cells), §0a.1 (cell anatomy — head and body zones).

**Files**:
- `frontend-v2/src/services/parser/notebookParser.ts` (create) — `parseNotebook(src) → { notebook, diagnostics }` and `serialize(notebook) → string`.
- `frontend-v2/src/services/parser/types.ts` (create) — re-export REDESIGN_INTERFACES types: Notebook, NotebookVersion, NotebookFrontmatter, Cell, CellFrontmatter, CellBlock, SqlBlock, PlotBlock, ViewBlock, MacroBlock, ProseBlock, Diagnostic, DiagnosticKind.
- `frontend-v2/src/__tests__/parser/notebookParser.test.ts` (create) — 60+ unit cases.
- `frontend-v2/src/__tests__/parser/notebookParser.property.test.ts` (create) — round-trip property.
- `frontend-v2/tests/fixtures/notebooks/*.notebook.md` (create at least 5 hand-authored fixtures covering every fence kind).

**Interfaces**: Notebook, Cell, CellBlock, SqlBlock, PlotBlock, ViewBlock, MacroBlock, ProseBlock, NotebookFrontmatter, CellFrontmatter, Diagnostic.

**Tests**: unit | property
- `notebookParser.test.ts`: 60+ cases covering (a) empty notebook, (b) frontmatter-only, (c) one cell each of every fence kind, (d) multi-fence cells (yaml → sql → plot → prose, fence order from REDESIGN_INTERFACES.md §3.2), (e) cell with no alias (display index only), (f) cells with `pinned`, `hidden`, `autorun`, `deps`, `style`, `last_ai_prompt`, `materialize`, `record_interactions` frontmatter keys, (g) view fence with name capture, (h) macro fence with name capture, (i) UTF-8 content including non-ASCII identifiers in prose, (j) trailing newline preservation, (k) Windows CRLF normalization (must round-trip to CRLF if input was CRLF), (l) blank-line preservation, (m) edge cases: empty SQL fence, empty plot fence, comment-only SQL.
- `notebookParser.property.test.ts`: generator produces random legal notebooks; assert `serialize(parseNotebook(src).notebook) === src` for **1000 iterations**. Generator covers all block kinds, random alias names, random key orders in frontmatter.

**Gate**: round-trip property passes 1000 iterations; all 60+ unit tests pass; type-check clean; `parseNotebook` never throws (errors surface as `Diagnostic[]`).

**Blocked by**: M-A0 (scaffold).

> **Agent prompt (M-A1):**
>
> Read REDESIGN_INTERFACES.md §1 (AST types) and §2 (fence grammars) first. Read showcase.html §0d (persistence — what the file looks like on disk), §3d (macro fence introduces a new fence kind `` ```macro <name> ``), §3c (prose cells), and §0a.1 (cell anatomy — five-zone structure: head + frontmatter/sql/plot/prose body). For reference (not for copying), skim v1's notebook parsing in `core/frontend/` — but the new parser is greenfield.
>
> Implement `parseNotebook(src: string): { notebook: Notebook; diagnostics: Diagnostic[] }` and `serialize(notebook: Notebook): string` in `frontend-v2/src/services/parser/notebookParser.ts`. Re-export the AST types from `frontend-v2/src/services/parser/types.ts` so downstream code imports from one place.
>
> Lex the source into: (1) YAML frontmatter block (between `---` lines at the top), (2) cell headings (`### #N <alias>` — three hashes only, two or four are diagnostics), (3) fenced code blocks identified by their info-string (`sql`, `plot`, `view <name>`, `macro <name>`), (4) prose (everything else inside a cell). Within a cell, the fence order is `yaml? → sql? → plot? → prose?` per REDESIGN_INTERFACES.md §3.2; out-of-order fences are accepted but a warning diagnostic is emitted (the formatter will fix on save in M-A5).
>
> Round-trip is the hard requirement. `serialize(parseNotebook(src).notebook) === src` byte-for-byte for legal inputs. Preserve: leading/trailing whitespace on each line, blank lines between cells, CRLF vs LF, trailing-newline presence, unknown frontmatter keys (verbatim per REDESIGN_INTERFACES.md §1 NotebookFrontmatter). For illegal inputs (cell with no alias and no auto-assigned displayIndex, fence not closed before EOF), emit a diagnostic and preserve the source span in the cell unchanged.
>
> Property test: generator from `fast-check` producing random legal sources (3–10 cells, mix of fence kinds, random aliases from `[a-z][a-z0-9_]{0,15}`, random YAML keys). Assert byte-equality for **1000 iterations**. Unit tests: 60+ hand-authored cases as listed in Tests above. Create at least 5 hand-authored fixtures in `tests/fixtures/notebooks/` (basic, all-fences, multi-cell-cross-ref, with-frontmatter, edge-cases).
>
> Acceptance: `npm run test -- parser/notebookParser` passes; `npm run typecheck` clean; the property test fails fast on any byte-diff (do not let it silently shrink to passing inputs).

---

### M-A2: SQL parser + identifier resolution

**What**: Parse SQL bodies inside SqlBlock and ViewBlock; populate `SqlStatement.references[]` (FROM/JOIN targets, case-preserved), `varRefs[]` (every `$x` and `$$x` outside string literals), macro-call sites, and `hasSideEffects` (true for INSERT/UPDATE/DELETE/CREATE/DROP/COPY). Resolve each `SqlReference.alias` to one of `'jfr-table' | 'cross-cell-view' | 'macro' | 'unknown'` against the known catalog. Detect the `-- @ <alias>` directive on line 1 of the SQL body and capture `registeredAlias`.

**Showcase**: §2 (two-sigil system — `$x` cell-scoped, `$$x` global), §4 (cross-cell wiring — `FROM <alias>`), §9.5 (cross-cell syntax in cheatsheet), §9.6 (live-var operators — `IN $alias.brush` recognized as live-var reference for dep-graph wiring), §3d (macro fence — `MacroBlock` defines a macro symbol consumed by SQL).

**Files**:
- `frontend-v2/src/services/parser/sqlParser.ts` (create) — `parseSql(source, catalog) → SqlStatement`.
- `frontend-v2/src/services/parser/identifierResolver.ts` (create) — `resolveReferences(refs, catalog) → ResolvedReference[]`.
- `frontend-v2/src/__tests__/parser/sqlParser.test.ts` (create) — 50+ unit cases.
- `frontend-v2/src/__tests__/parser/sqlParser.property.test.ts` (create) — property: every `$x` token outside a string literal is in `varRefs`.

**Interfaces**: SqlBlock, SqlStatement, SqlReference, VarRef, Reference, ReferenceKind = `'alias' | 'variable' | 'global-var' | 'macro' | 'live-var'`.

**Tests**: unit | property
- `sqlParser.test.ts`: 50+ cases covering (a) plain SELECT with table ref, (b) JOIN with multiple FROM aliases, (c) CTE (WITH ... AS), (d) subquery in FROM, (e) `$x` variable reference, (f) `$$x` global reference, (g) `$alias.brush`, `$alias.hover`, `$alias.zoom`, `$alias.selection`, `$alias.scroll` live-var dotted references, (h) `IN $alias.brush` operator, (i) macro call `percentile(dur, 99)`, (j) `-- @ <alias>` directive on line 1 (captured) vs deeper in body (ignored), (k) variables inside string literals (NOT a var ref — committed answer per REDESIGN_INTERFACES.md §7 Q2), (l) `$` inside identifier (escaped, not a ref), (m) nested macro calls, (n) FROM (subquery) — no outer ref but inner refs captured, (o) INSERT / UPDATE / DELETE / CREATE / DROP / COPY → `hasSideEffects: true`, (p) case preservation for refs, (q) unknown identifier → `resolvedTo: 'unknown'`.
- `sqlParser.property.test.ts`: 1000 iterations of "any `$x` appearing outside string literal lexer state is in `varRefs`" and the dual: "no `$x` from a string literal is in `varRefs`."

**Gate**: 50+ unit tests pass; property test passes 1000 iterations; resolver returns one of 5 ReferenceKinds for every reference; `hasSideEffects` correctly flags all six mutation kinds.

**Blocked by**: M-A0 (scaffold), M-A1 (uses Notebook types).

> **Agent prompt (M-A2):**
>
> Read REDESIGN_INTERFACES.md §1.2 (SqlStatement, SqlReference), §2.3 (var-ref lexeme), §2.4 (alias directive), §7 Q2 (variables inside string literals are literals, NOT refs — this is the committed answer). Read showcase.html §2 (two sigils — `$x` cell-scoped, `$$x` global, `$alias.<live-var>` live-coupling), §4 (cross-cell `FROM <alias>`), §9.5–§9.6 (cheatsheet for cross-cell + live-var operators).
>
> Use `@codemirror/lang-sql` as the lex layer (it already knows DuckDB's string-literal vs identifier states). Walk the token stream; for each token, classify: (a) `FROM`/`JOIN` keyword → next identifier token is a `SqlReference`; (b) `$identifier(.identifier)*` outside any string-literal state → `VarRef`; (c) bare identifier followed by `(` → potential macro call. The `-- @ <alias>` directive is a line-comment regex applied to the body before tokenization; capture only if it's the first non-whitespace line.
>
> `identifierResolver.ts` takes the parsed refs and a `Catalog = { tables: Set<string>; views: Set<string>; macros: Set<string>; cellAliases: Set<string> }` and returns each ref tagged with `ReferenceKind`. Resolution precedence: jfr-table → cross-cell-view → macro. Case-preserve aliases in the AST but case-insensitive match against the catalog.
>
> Edge cases the tests must cover: (1) `WHERE name = '$placeholder'` → NOT a var ref. (2) `WHERE name = '$' || x` → NOT a var ref. (3) `dollar$id` → NOT a var ref. (4) `$alias.brush` → live-var ref with `path: ['brush']`. (5) `$$global_range` → global var ref. (6) `WITH t AS (SELECT * FROM gc_pauses) SELECT * FROM t` → references = [gc_pauses, t] but `t` resolves locally (not jfr-table). (7) `INSERT INTO foo VALUES (1)` → `hasSideEffects: true`. (8) Nested macros: `outer(inner(x))` — both macro names captured.
>
> Tests: 50+ unit cases enumerated under Tests above; property test that lexer-state separation holds for 1000 generated SQLs. Implement the property test by generating SQL with random `$x` tokens both inside and outside string literals, then asserting the partition matches the lexer-state.
>
> Acceptance: `npm run test -- parser/sqlParser` passes; all 5 `ReferenceKind` values appear in tests; `hasSideEffects` test matrix covers all 6 mutation verbs.

---

### M-A3: Plot DSL sugar parser (12 types + 3 composers + clause tail)

**What**: Parse the lowercase sugar grammar from REDESIGN_INTERFACES.md §2.2 into a `PlotNode` tree (PanelNode | ContainerNode | OverlayNode). Support **all 12 plot types**: line, bar, scatter, histogram, boxplot, heatmap, pie, flamegraph, table, gantt, area, range. Support **3 composers**: `row { ... }`, `col { ... }`, `a + b` (overlay, left-associative). Support the **clause tail** `| key: value | ...` with these clause keys: `title`, `width`, `height`, `link-x`, `link-y`, `link-xy`, `name`, `settings`, `disabled`, `on_hover`, `on_selection`, `on_brush`, `zoom`, `brush`, `highlight`, `palette`, `legend`, `tooltip`, `on`. **Reject UPPERCASE classic forms** — specifically the 12 canonical names `LINE_CHART(...)`, `BAR_CHART(...)`, `SCATTER_CHART(...)`, `HISTOGRAM(...)`, `BOXPLOT(...)`, `HEATMAP(...)`, `PIE_CHART(...)`, `FLAMEGRAPH(...)`, `TABLE(...)`, `GANTT(...)`, `AREA_CHART(...)`, `RANGE_CHART(...)` — with a `SugarOnly` diagnostic that includes the lowercase rewrite suggestion.

**Showcase**: §3 (plot DSL — sugar-first), §3a (the 12 plot types with examples for each), §3a.1 (line chart anatomy), §9.2 (12 plot type cheatsheet), §9.3 (composer cheatsheet), §9.4 (clause tail cheatsheet).

**Files**:
- `frontend-v2/src/services/parser/plotDslParser.ts` (create) — `parsePlot(src) → { node: PlotNode | null; diagnostics: Diagnostic[] }`.
- `frontend-v2/src/dsl/plotSugar.grammar` (create) — Lezer grammar source.
- `frontend-v2/src/services/parser/plotDslGrammar.ts` (create) — generated Lezer parser exported as a CodeMirror `LRParser` for Phase B reuse. Hand-rolled recursive descent is NOT an acceptable substitute.
- `frontend-v2/src/__tests__/parser/plotDslParser.test.ts` (create) — 80+ unit cases.
- `frontend-v2/src/__tests__/parser/plotDslParser.property.test.ts` (create) — property: parse→serialize idempotent on AST.

**Interfaces**: PlotNode, PanelNode, ContainerNode, OverlayNode, PlotType, PanelClauses, ContainerClauses, LinkSpec, BrushSpec, PlotValue, VarRef.

**Tests**: unit | property
- `plotDslParser.test.ts`: 80+ cases. For each of the 12 plot types: minimal form (`line { x: "t", y: "v" }`), full form with all clauses, with var refs in values, with live-var refs (`y: $!hover`). For composers: `row { line {...}; bar {...} }` with `;` separator, `col {...}` with newline separator, `a + b` with shared axes, nested `row { col { ... }; line {...} }`. For clause tail: each clause key exercised, order independence (clauses in any order still produce same AST), repeated clauses (last wins + diagnostic). Error cases: `LINE_CHART(...)` → `SugarOnly` diagnostic with suggested rewrite, `BAR_CHART(...)` → same, unknown plot name `wibble { ... }` → `UnknownPlotType` diagnostic, unknown clause `| frobnicate: 1` → `UnknownClause` warning, missing `}` → `UnterminatedBrace` error, missing fence body → empty PlotNode.
- `plotDslParser.property.test.ts`: 1000 iterations of generator producing random legal sugar inputs (with depth ≤4 for composers); assert `parsePlot(parsePlot(src).serialized).node` structurally equals first parse.

**Gate**: all 12 plot types parse to a `PanelNode` with `kind: 'panel'` and correct `plotType`; all 3 composers parse to the right node kind; every clause key in the supported list parses to the right field on PanelClauses/ContainerClauses; UPPERCASE classic forms emit `SugarOnly` diagnostic with a suggested rewrite; property test passes 1000 iterations.

**Blocked by**: M-A0 (scaffold), M-A1 (uses Cell types and Diagnostic).

> **Agent prompt (M-A3):**
>
> Read REDESIGN_INTERFACES.md §1.1 (PlotNode tree), §2.2 (sugar plot grammar — this is your spec), §2.3 (shared lexemes — `var-ref`, `cell-ref`, `literal`, `length`). Read showcase.html §3 (plot DSL intent — sugar-first), §3a (one subsection per plot type — get the canonical example for each of: line, bar, scatter, histogram, boxplot, heatmap, pie, flamegraph, table, gantt, area, range), §9.2 (12 plot-type cheatsheet), §9.3 (composer cheatsheet), §9.4 (clause tail cheatsheet — full canonical clause order: title → width → height → link-x → link-y → brush → name → palette → legend → tooltip).
>
> Implement `parsePlot(src: string): { node: PlotNode | null; diagnostics: Diagnostic[] }` in `frontend-v2/src/services/parser/plotDslParser.ts`. **M-A3 ships a Lezer grammar (`src/dsl/plotSugar.grammar`) plus the generated parser** since Phase B's editor reuses the same grammar for syntax highlighting and autocomplete. **A hand-rolled recursive-descent parser is NOT acceptable** — if the agent cannot complete the Lezer grammar within the time budget, M-A3 is blocked and must be escalated rather than papered over with a temporary parser. Lezer's grammar generator is mature enough for this surface area; the canonical reference is showcase §3.x and the existing Lezer SQL grammar shipped by `@lezer/sql`. Do not leave a "migrate to Lezer later" TODO; that path produces hidden migration debt that breaks the Phase B editor integration.
>
> The grammar accepts: `let-decl* sugar-tree`. `sugar-tree = panel | container | overlay`. `panel = plot-name "{" config-pairs "}" clause-tail`. `container = ("row" | "col") "{" sugar-tree-list "}" clause-tail`. `overlay = sugar-tree ("+" sugar-tree)+ clause-tail` (left-associative). `sugar-tree-list` separated by `;` or double-newline. `clause-tail = ("|" clause-kv)*`. Twelve plot names are exactly: `line bar scatter histogram boxplot heatmap pie flamegraph table gantt area range`. Clause keys: `title width height zoom link-x link-y link-xy name settings disabled on_hover on_selection on_brush brush highlight palette legend tooltip on`.
>
> **Sugar-only rejection**: detect classic UPPERCASE forms by scanning the leading token. If it matches `/^[A-Z_]+\s*\(/` (e.g. `LINE_CHART(`, `BAR_CHART(`), emit `Diagnostic` of kind `'SugarOnly'` with `severity: 'error'`, a precise byte range, and a `suggestion` field containing the lowercase rewrite (e.g. `LINE_CHART(x="t", y="v")` → `line { x: "t", y: "v" }`). Do **not** parse classic forms — they belong to migration tooling only.
>
> Tests: 80+ unit cases covering every plot type minimally + with each clause; every composer flat + nested; UPPERCASE rejection with suggestion text validation; clause order independence; unknown plot name; unknown clause name (warning, not error). Property test: 1000 random legal sugar trees, parse→serialize→parse equals first parse structurally.
>
> Acceptance: `npm run test -- parser/plotDslParser` passes; property at 1000+ iters; `npm run typecheck` clean.

---

### M-A4: Dep graph builder (5 edge types + cycle detection)

**What**: Implement `computeDepGraph(notebook, runtime) → DepGraph` per REDESIGN_INTERFACES.md §4. **Pure function** (same input → same output, no DOM, no animations). Build node sets (CellNode, VarNode, LiveVarNode) and edge sets covering all 5 edge kinds: `data` (cyan, cross-cell `FROM alias`), `var` (gray-dashed, `$x` in SQL or plot), `live-var` (thick gray-dashed, `$!x` or `$alias.<live-var>` in SQL or plot), `axis-link` (orange, `link-x`/`link-y`/`link-xy` between panels), `prompt` (purple-dotted, from `last_ai_prompt` provenance + `@cell` chips). Detect static cycles via Tarjan SCC; pass runtime live-cycle breaks through into the output unchanged.

**Showcase**: §0a (the graph node sketch in the topbar diagram), §0a.1 (cell anatomy — head shows live-coupling status which maps to live-var edges), §4 (cross-cell wiring — data edges), §5 (live coupling — live-var edges), §5a (chains — multi-hop edge traversal), §6c.7 (the dep-graph overlay rendering — this milestone produces the model the overlay consumes; the renderer ships in Phase B M-B4).

**Files**:
- `frontend-v2/src/services/depGraph/DepGraph.ts` (create) — `computeDepGraph(notebook, runtime) → DepGraph`.
- `frontend-v2/src/services/depGraph/edgeBuilder.ts` (create) — five `collect*Edges` functions matching REDESIGN_INTERFACES.md §4.1 pseudo-code.
- `frontend-v2/src/services/depGraph/cycleDetection.ts` (create) — Tarjan SCC + `detectStaticCycles`.
- `frontend-v2/src/__tests__/depGraph/edgeBuilder.test.ts` (create) — 40+ cases.
- `frontend-v2/src/__tests__/depGraph/cycleDetection.test.ts` (create) — 15+ adversarial cases.
- `frontend-v2/src/__tests__/depGraph/DepGraph.property.test.ts` (create) — properties.

**Interfaces**: DepGraph, GraphNode (CellNode | VarNode | LiveVarNode), GraphEdge (DataEdge | VarEdge | LiveVarEdge | AxisLinkEdge | PromptEdge), Cycle, RuntimeState.

**Tests**: unit | property
- `edgeBuilder.test.ts`: 40+ cases. (a) one cell, no edges; (b) two cells with `FROM <alias>` → one DataEdge; (c) `$x` in SQL → VarEdge with `renderOnly: false`; (d) `$x` in plot config (not in SQL) → VarEdge with `renderOnly: true`; (e) `$alias.brush` → LiveVarEdge `direction: 'read'`; (f) plot panel with `brush: { mode: 'live' }` → LiveVarEdge `direction: 'write'` from cell to live-var node; (g) two plot panels with `link-x: $!zoom master` and `link-x: $!zoom clamp` → AxisLinkEdge with `axis: 'x'`; (h) cell with `last_ai_prompt` referencing another cell → PromptEdge; (i) `$$global` in SQL → VarEdge with `scope: 'global'`; (j) materialize hint on cell — must NOT create extra edges; (k) hidden cell — still in graph; (l) ordering invariance: edges are deterministically sorted (by edge kind then by from/to alias) so output is stable across runs; (m) each of the 5 edge kinds round-trips through JSON serialization without loss (for snapshot tests).
- `cycleDetection.test.ts`: 15+ adversarial cases — direct A→B→A; longer A→B→C→A; two cycles sharing a node; self-loop (`#1` references its own alias) → cycle of length 1; cycles introduced only when a live edge is added (`introducedBy: 'live'` flag); no false positives on a long acyclic chain (50 cells); SCC of size 1 (non-cyclic node) NOT reported as a cycle.
- `DepGraph.property.test.ts`: 1000 iterations. Property 1 (determinism): same `(notebook, runtime)` → byte-identical JSON of the returned DepGraph (after canonical sort). Property 2 (purity): no global state mutated. Property 3 (acyclic-on-acyclic-input): generator produces forward-only references, asserts `cycles.length === 0`. Property 4 (every edge endpoint exists in `nodes`): no dangling edges.

**Gate**: every edge kind appears in tests; cycle detection passes all 15 adversarial cases; property tests at 1000 iters; `computeDepGraph` performance on the 100-cell / 30-var fixture under 30ms p95.

**Blocked by**: M-A0 (scaffold), M-A1 (Notebook types), M-A2 (SQL references), M-A3 (plot AST clauses contribute axis-link / brush / highlight var refs).

> **Agent prompt (M-A4):**
>
> Read REDESIGN_INTERFACES.md §4 (DepGraph + GraphEdge taxonomy) completely. Read showcase.html §0a (graph node sketch), §4 (data edges from `FROM alias`), §5 (live-var edges + axis-link edges from `link-x`/`link-y`), §5a (chains — multi-hop liveness; this milestone only produces the model, traversal happens at runtime in Phase E), §6c.7 (visual style the renderer in M-B4 will apply — orange for axis-link, cyan for data, green for live-var, gray for cell-order; this is rendering, not graph computation).
>
> Implement `computeDepGraph(notebook: Notebook, runtime: RuntimeState): DepGraph` in `frontend-v2/src/services/depGraph/DepGraph.ts`. Match REDESIGN_INTERFACES.md §4.1 pseudo-code structure: collect nodes (`toCellNode` for each cell, `collectVarNodes` from all SQL+plot var refs, `collectLiveVarNodes` from runtime + plot-write sites) then collect edges (`collectDataEdges`, `collectVarEdges`, `collectLiveVarEdges`, `collectAxisLinkEdges`, `collectPromptEdges`) then `detectStaticCycles` + concat runtime cycle breaks.
>
> **Purity is load-bearing.** Same inputs → same outputs. Sort node list and edge list canonically before returning (by kind, then by alias / from / to / varName) so tests can do byte-equality on JSON. Do not touch the DOM. Do not import from `react`, `recharts`, `cytoscape`. The renderer in M-B4 imports this module, not vice versa.
>
> Edge construction rules (from REDESIGN_INTERFACES.md and showcase):
> - DataEdge: for each SqlBlock with `SqlReference.resolvedTo === 'cross-cell-view'`, edge from producer cell alias to consumer cell alias, `alias` field = the view name.
> - VarEdge: for every `VarRef` in SqlBlock or PlotBlock config with `scope: 'global' | 'cell'`. `renderOnly: true` if and only if the only occurrence is in plot config, never in SQL.
> - LiveVarEdge: for every VarRef with `scope: 'live'` (`$!x`) or for every `$alias.<live-var>` reference. `direction: 'read'` for consumers, `'write'` for the master cell that owns the live-var. Brush master is the cell whose plot panel declares `brush: { mode: 'live' | 'progressive' }`.
> - AxisLinkEdge: when two PanelNodes share a `linkX.variable` or `linkY.variable`, emit edges in both directions (or one with `axis: 'xy'` if both linked) with `axis: 'x' | 'y' | 'xy'`.
> - PromptEdge: from each cell's `frontmatter.last_ai_prompt` (parse the `@<cell>` chips listed inside) to the cell. `prompt` field carries the prompt string for hover provenance.
>
> Cycle detection: Tarjan SCC over the directed edge set (treat edges as `from → to` regardless of kind). For each SCC of size ≥2 or single-node-with-self-loop, emit `Cycle { edges, introducedBy: 'static' }`. Then `cycles = [...static, ...runtime.cycleBreaks]`.
>
> Tests: 40+ edge-builder cases (one per edge-kind permutation), 15+ cycle cases (direct, transitive, sharing nodes, self-loop, false-positive avoidance on a 50-cell forward chain), property tests for determinism (1000 iters: hash of returned DepGraph stable across runs) + purity (no globals touched) + acyclicity on forward-only fixtures + no dangling edges. Bench: assert <30ms p95 over 100 runs on a 100-cell / 30-var fixture (build the fixture in `tests/fixtures/notebooks/perf-100cells.notebook.md`).
>
> Acceptance: `npm run test -- depGraph` passes; bench runs as part of `npm run test:perf` (or as a Vitest bench with `bench()`).

---

### M-A5: Formatter (SQL + plot DSL + markdown structure, idempotency)

**What**: Implement the formatter per REDESIGN_INTERFACES.md §3. Three sub-formatters: SQL (via `sql-formatter` with DuckDB dialect, plus our specific rules: UPPERCASE keywords, 2-space subquery indent, `-- @ alias` pinned to line 1), plot DSL (canonical key order per showcase §8 — `x → y → color → size → opacity → ...` for line/scatter; `x → y → bins` for histogram; `category → value` for boxplot/pie; clause tail order `title → width → height → link-x → link-y → brush → name → palette → legend → tooltip`), and notebook structural (fence order `yaml → sql → plot → prose`; cell heading `### #N <alias>`; exactly one blank line between cells; file ends in `\n`). **Idempotency property**: `format(format(x).source) === format(x).source` byte-for-byte. **Error tolerance**: a cell with a broken SQL block still formats its plot block and markdown structure; preserve the broken span unchanged and surface a diagnostic. **No semantic rewrites** per REDESIGN_INTERFACES.md §3.1.4.

**Showcase**: §8 (the canonical shape with before/after examples), §8.4 (format-on-save diff modal — the milestone produces the engine; the diff UI ships in Phase B M-B5 alongside the issues panel), §8.5 (round-trip CI — 187 fixtures, all clean).

**Files**:
- `frontend-v2/src/services/formatter/sqlFormatter.ts` (create) — SQL block formatter.
- `frontend-v2/src/services/formatter/plotFormatter.ts` (create) — plot DSL formatter.
- `frontend-v2/src/services/formatter/notebookFormatter.ts` (create) — top-level `format(input) → FormatterOutput`.
- `frontend-v2/src/services/formatter/keyOrder.ts` (create) — per-plot-type key order tables (canonical, exported as `const`).
- `frontend-v2/src/__tests__/formatter/sqlFormatter.test.ts` (create) — 40+ cases.
- `frontend-v2/src/__tests__/formatter/plotFormatter.test.ts` (create) — 40+ cases (every plot type × clause permutations).
- `frontend-v2/src/__tests__/formatter/notebookFormatter.property.test.ts` (create) — idempotency property at 5000 iters.
- `frontend-v2/src/__tests__/formatter/roundTrip.integration.test.ts` (create) — corpus round-trip against all `tests/fixtures/notebooks/*.notebook.md`.

**Interfaces**: FormatterInput, FormatterOutput, FormatOptions, FormatResult, Diagnostic.

**Tests**: unit | property | integration
- `sqlFormatter.test.ts`: 40+ cases. (a) keywords uppercased; (b) 2-space subquery indent; (c) `-- @ alias` directive pinned line 1; (d) `WITH ... AS ( ... )` indented; (e) `$var` preserved verbatim; (f) `$alias.brush` preserved; (g) inline comments preserved on their own lines; (h) block comments `/* ... */` preserved verbatim including whitespace; (i) string literals untouched (case, whitespace, all preserved); (j) macro calls `percentile(dur, 99)` formatted with one space after comma; (k) idempotent on each of (a)–(j) when re-formatted; (l) error tolerance: SQL with unmatched paren returns input unchanged + diagnostic; (m) no semantic rewrites: variable names, table aliases, column orders all preserved.
- `plotFormatter.test.ts`: 40+ cases — for each of the 12 plot types, assert canonical key order applied (input in any order produces same output); clause tail re-ordered; idempotency for each.
- `notebookFormatter.property.test.ts`: **5000 iterations** of generator-produced legal notebooks; assert `format(format(x).source).source === format(x).source` byte-equality.
- `roundTrip.integration.test.ts`: every fixture in `tests/fixtures/notebooks/` round-trips clean (format → reload → format → diff is empty).

**Gate**: idempotency property passes **5000 iterations**; all 12 plot types format to canonical key order; SQL formatter respects all rules; error tolerance verified (broken-block fixture); 100% of fixtures round-trip with zero byte diff.

**Blocked by**: M-A0 (scaffold), M-A1 (Notebook types), M-A2 (SQL parser to detect var refs we must preserve), M-A3 (plot AST + clauses).

> **Agent prompt (M-A5):**
>
> Read REDESIGN_INTERFACES.md §3 (formatter contract) completely — invariants §3.1, output rules §3.2 are the spec. Read showcase.html §8 (before/after examples, key-order rules, callout on what the formatter deliberately does NOT do per plan §8b.5), §8.4 (diff UX — informs the data shape `FormatterOutput.changedCells` for the modal in Phase B), §8.5 (round-trip CI — drives the corpus test in `roundTrip.integration.test.ts`).
>
> Implement three modules:
> 1. `sqlFormatter.ts`: use `sql-formatter` (npm) with config `{ language: 'duckdb', keywordCase: 'upper', tabWidth: 2 }` as the base; post-process to (a) keep `$x`, `$$x`, `$alias.brush` verbatim (the SQL formatter may otherwise mangle `$` tokens — pre-substitute with placeholders, run formatter, substitute back); (b) ensure `-- @ alias` is on line 1; (c) preserve all comments byte-for-byte (do not let `sql-formatter` strip them).
> 2. `plotFormatter.ts`: parse via M-A3 `parsePlot`; if `node` is null (parse error), return source unchanged + diagnostic. Else re-serialize from AST in canonical key order (table in `keyOrder.ts`); canonical clause-tail order: title, width, height, zoom, link-x, link-y, link-xy, brush, name, palette, legend, tooltip, on_hover, on_selection, on_brush, on, highlight, settings, disabled.
> 3. `notebookFormatter.ts`: parse via M-A1 `parseNotebook`; per cell, format its SqlBlock (call sqlFormatter), PlotBlock (call plotFormatter), ViewBlock SQL body (sqlFormatter); reorder fences within each cell to `yaml → sql → plot → prose`; normalize cell separators (collapse runs of blank lines to exactly one); ensure trailing newline. Re-serialize via M-A1 `serialize`. Set `changed: source !== input.source` and populate `changedCells` per per-cell diff.
>
> **`$$ai_providers` scrub rule** (load-bearing security constraint per showcase §10c.1): when serializing a notebook to `.md`, drop any frontmatter key matching the pattern `^\$\$ai_providers(\..+)?$` before write. API keys, endpoint URLs, and per-provider settings live exclusively in the `$$ai_providers` workspace global (the M-D0 `aiProvidersStore`) — they **MUST NEVER** be written into notebook files. Implement this in `notebookFormatter.ts` as a frontmatter-scrub pass that runs before serialization for both notebook-level and cell-level frontmatter. A dedicated test asserts that a notebook with `$$ai_providers` keys referenced in frontmatter has them stripped on save (round-trip fixture: input contains the keys, output does not). M-D0 builds on this rule but does not need to modify M-A5 — the rule is owned here.
>
> **Idempotency is the load-bearing test.** Run a property test with 5000 random legal sources from your M-A1 generator, asserting `format(format(x).source).source === format(x).source`. **Error tolerance**: a cell with a SQL parse error must still have its plot block and markdown structure formatted; the failing block's source is preserved unchanged; a Diagnostic is emitted. Build a fixture `tests/fixtures/notebooks/broken-sql.notebook.md` that exercises this path.
>
> **No semantic rewrites.** Do not rename `$alias.brush` → `$alias_brush`. Do not auto-inject `name:` on panels. Do not reorder cells. Do not insert `-- @ alias` comments where missing. Test the property explicitly: variable names and panel names round-trip.
>
> Tests: 40+ SQL cases, 40+ plot cases, idempotency at 5000 iters, corpus round-trip on every fixture in `tests/fixtures/notebooks/`. Bench: format the canonical 50-cell fixture in <50ms p95.
>
> Acceptance: `npm run test -- formatter` passes; property test at 5000 iters; corpus round-trip green; `npm run typecheck` clean.

---

### M-A6: DuckDB-WASM Web Worker + AbortSignal cancellation

**What**: Stand up DuckDB-WASM inside a Web Worker. Expose a typed `client.ts` on the main thread with `query(sql, signal) → AsyncIterable<RecordBatch>`, `prepare(sql)`, `cancel(id)`, `loadFile(name, bytes)`, `shutdown()`. Wire `AbortSignal` end-to-end: aborting the signal mid-query calls `cancelPendingQuery()` on the worker side **within 100ms**. Verify SharedArrayBuffer is available (COOP/COEP wired in Vite config) and DuckDB runs in threaded mode. The worker's BigInt/Date values are normalized to a wire format documented in `arrowJson.ts` (per REDESIGN_INTERFACES.md §7 Q4).

**Showcase**: §8a (performance — caches, materialization, push-down, cancellation), §8a.5 (cascading cancellation — when a brush gesture supersedes its predecessor, the previous query is aborted before the next launches), §8a.10 (long-running query UX — progress + cancel affordance).

**Files**:
- `frontend-v2/src/services/duckdb/worker.ts` (create) — Worker entry; imports `@duckdb/duckdb-wasm`; postMessage protocol handler.
- `frontend-v2/src/services/duckdb/client.ts` (create) — main-thread `DuckDBClient` class (promise-keyed inflight map, AbortSignal hookup).
- `frontend-v2/src/services/duckdb/protocol.ts` (create) — message types (`InitRequest`, `QueryRequest`, `CancelRequest`, `QueryRow`, `QueryEnd`, `QueryError`, `ProgressEvent`).
- `frontend-v2/src/utils/duckdbWasmLoader.ts` (copy from v1) — bundle selection; the worker calls `initDuckDBWasm()`.
- `frontend-v2/src/utils/arrowJson.ts` (create) — `serializeValue(v) → JsonValue` handling BigInt → string with marker, Date → ISO, decimals.
- `frontend-v2/src/__tests__/duckdb/worker.test.ts` (create) — boot + simple query.
- `frontend-v2/src/__tests__/duckdb/cancellation.test.ts` (create) — abort mid-query, time-to-cancel.
- `frontend-v2/src/__tests__/integration/queryRoundTrip.test.ts` (create) — real DuckDB in worker, real query, real Arrow result.

**Interfaces**: SqlRunRequest (from REDESIGN_INTERFACES.md §5.1), plus protocol types.

**Tests**: unit | integration
- `worker.test.ts`: boot worker, init DuckDB, run `SELECT 42 AS x` end-to-end, get one Arrow row; assert cold-start ≤ 2s (warm: ≤ 100ms).
- `cancellation.test.ts`: launch a slow query (`SELECT count(*) FROM range(100000000)`); abort the signal; assert the inflight promise rejects with `AbortError`; assert worker confirms cancellation within **100ms** (measure with `performance.now()`); assert subsequent queries on same connection still work.
- `queryRoundTrip.test.ts`: register a small fixture .parquet or CSV file; SELECT it; assert BigInt → string serialization and Date → ISO; multiple concurrent queries (each with its own signal) interleave correctly.

**Gate**: cold-start ≤ 2s (CI may relax to ≤ 5s on Linux runners); warm query ≤ 500ms; AbortSignal cancels within 100ms p95; BigInt and Date are serialized per `arrowJson.ts`; COOP/COEP headers verified by an E2E that asserts `crossOriginIsolated === true`.

**Blocked by**: M-A0 (scaffold) (independent of parser milestones M-A1..M-A5).

> **Agent prompt (M-A6):**
>
> Read REDESIGN_INTERFACES.md §5.1 (SqlRunRequest with AbortSignal), §5.2 (debounce policy — not in this milestone but informs the cancel-then-relaunch pattern), §7 Q4 (worker boundary serialization — BigInt/Date wire format must be specced). Read showcase.html §8a (performance overview), §8a.5 (cascading cancellation — describes user gesture flows that drive cancel timing), §8a.10 (long-running query UX). Read v1's `core/frontend/utils/duckdbWasmLoader.ts` (55 lines) — copy this file as-is into `frontend-v2/src/utils/duckdbWasmLoader.ts`. The pattern: `duckdb.getJsDelivrBundles()` → `selectBundle` → `URL.createObjectURL(new Blob([importScripts(...)]))` → `new Worker(workerUrl)` → `new AsyncDuckDB(logger, worker)` → `db.instantiate(bundle.mainModule, bundle.pthreadWorker)`.
>
> **In v2, the entire DuckDB lifecycle moves inside our own worker.** Write `worker.ts` (entry: `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` from `client.ts`). The worker imports `@duckdb/duckdb-wasm` directly and our `duckdbWasmLoader` helper; it calls `initDuckDBWasm()` on boot. The worker accepts `postMessage`s typed via `protocol.ts`. The full request set is: `InitRequest`, `QueryRequest { id, sql, params }`, `CancelRequest { id }`, `RegisterFileRequest { id, name, buffer }`, `DropFileRequest { id, name }`, `DescribeRequest { id, tableName }`. It responds with the full response set: `InitReady`, `QueryRow { id, batch }`, `QueryEnd { id, rowCount }`, `QueryError { id, message, code }`, `Progress { id, processedRows }`, `RegisterFileAck { id }`, `DropFileAck { id }`, `DescribeResult { id, columns }`.
>
> **Cancellation**: each query in flight is tracked by `id`. On `CancelRequest { id }`, call `connection.cancelPendingQuery()` (DuckDB-WASM exposes this on `AsyncDuckDBConnection`); confirm with a `QueryError { id, code: 'aborted' }` response. The main-thread `client.ts` wires this: `query(sql, signal)` listens to `signal.addEventListener('abort')` and posts `CancelRequest`. The inflight promise rejects with `new DOMException('aborted', 'AbortError')` on confirmation. Measure: from `signal.abort()` call to promise rejection, must be ≤ 100ms p95.
>
> **BigInt/Date wire format** in `arrowJson.ts`: BigInt → `{ __bigint: "<decimal string>" }`; Date / Timestamp → `{ __ts: "<ISO string>" }`; Decimal → `{ __dec: "<string>", scale: number }`. Provide `deserializeValue(v) → unknown` for the inverse used by integration tests.
>
> **COOP/COEP verification**: write a small dev-time assertion `if (!crossOriginIsolated) console.error('COOP/COEP not enabled — DuckDB threads disabled')`. An E2E in M-B1 will assert this in browser context.
>
> Tests: `worker.test.ts` boots and runs `SELECT 42`. `cancellation.test.ts` measures abort-to-confirm latency. `queryRoundTrip.test.ts` runs a real query against a real registered file. Bench: cold-start in `vitest bench`.
>
> Acceptance: `npm run test -- duckdb` and `npm run test -- integration/queryRoundTrip` pass; bench publishes cold-start + warm-query timings.

---

### M-A7: JFR loader in worker (GraalVM jfr-importer.js)

**What**: Load a `.jfr` file end-to-end inside the DuckDB worker. The GraalVM-compiled `jfr-importer.js` (already in `frontend-v2/public/`) attaches a global `JFRImporter` whose `importJfrIntoDuckDB(bytes, conn)` method materializes all JFR tables into the worker's DuckDB connection. After import, run `BUILTIN_MACROS_SQL` and `BUILTIN_VIEWS_SQL` against the same connection. Surface progress events (`Progress { phase, percent, message }`) and error events for the four §0c.4 failure modes (file too large, malformed, unsupported event types, OOM).

**Showcase**: §0c (JFR ingest UX), §0c.2 (progress bar with phase labels: parsing → materializing → registering macros → ready), §0c.4 (failure modes — file too large, malformed, unsupported event types, OOM).

**Files**:
- `frontend-v2/src/services/jfr/jfrLoader.ts` (create) — worker-side loader, called from `worker.ts` in response to a `LoadJfrRequest`.
- `frontend-v2/src/services/jfr/progressTracker.ts` (create) — phase enum, percent estimator, event emitter.
- `frontend-v2/src/services/jfr/builtinSql.ts` (copy from v1 `core/frontend/data/builtinSql.ts`) — `BUILTIN_MACROS_SQL`, `BUILTIN_VIEWS_SQL`.
- `frontend-v2/public/jfr-importer.js` (copy from v1 `core/frontend/public/wasm/jfr-importer.js`).
- `frontend-v2/public/jfr-importer.wasm` (copy from v1).
- `frontend-v2/public/jfr-importer.wat` (copy from v1).
- `frontend-v2/src/__tests__/jfr/jfrLoader.test.ts` (create) — unit (script-load idempotency).
- `frontend-v2/src/__tests__/integration/jfrLoad.integration.test.ts` (create) — real JFR load + queries.
- `frontend-v2/tests/fixtures/jfr/sample-small.jfr` (already committed by M-A0; this milestone just consumes it).

**Interfaces**: LoadJfrRequest, LoadJfrProgress, LoadJfrComplete, LoadJfrError, JfrFailureMode = `'too_large' | 'malformed' | 'unsupported_events' | 'oom'`.

**Tests**: unit | integration
- `jfrLoader.test.ts`: script-load is idempotent (calling `loadJfrImporterScript()` twice doesn't re-inject); the global `JFRImporter` is bound after load; the loader rejects with a clear error if the script fails to load.
- `jfrLoad.integration.test.ts`: load `sample-small.jfr` into a real worker; assert progress events fire in order (parsing → materializing → registering → ready); assert the `gc_pauses` table exists post-load; assert built-in macros (`percentile`, `ms_between`) are registered; assert built-in views are queryable; deliberately load a malformed file → assert `LoadJfrError { mode: 'malformed' }`.

**Gate**: real `sample-small.jfr` loads end-to-end inside the worker; progress events fire; failure-mode taxonomy verified by at least the `malformed` and `too_large` cases (synthesize too-large by setting a size cap in the loader; the other two can be stubbed with TODO tests for Phase D's real coverage).

**Blocked by**: M-A0 (scaffold, fixtures), M-A6 (needs the worker + protocol).

> **Agent prompt (M-A7):**
>
> Read showcase.html §0c (JFR ingest UX overview), §0c.2 (progress UI — informs the event shape your loader emits), §0c.4 (four failure modes — your loader must classify errors into these buckets). Read v1's `core/frontend/utils/jfrToWasmLoader.ts` (82 lines) for the integration pattern; in v1 it lives on the main thread and injects a `<script>` tag. **In v2 it moves into the worker.** The worker uses `importScripts('/jfr-importer.js')` (classic worker) or a dynamic `import('/jfr-importer.js')` if running as a module worker — pick whichever the GraalVM bundle supports (likely classic `importScripts`).
>
> Implement `frontend-v2/src/services/jfr/jfrLoader.ts` exposing `loadJfrIntoWorker(bytes: Uint8Array, conn: AsyncDuckDBConnection, onProgress: (p: LoadJfrProgress) => void): Promise<void>`. Steps: (1) ensure `JFRImporter` global is loaded (cache the promise to ensure idempotency); (2) emit `Progress { phase: 'parsing', percent: 0 }`; (3) call `JFRImporter.importJfrIntoDuckDB(bytes, conn)` inside a `setTimeout(0)` so the worker can repaint progress; (4) iterate `BUILTIN_MACROS_SQL` from `builtinSql.ts` and run each via `conn.query`; (5) iterate `BUILTIN_VIEWS_SQL`; (6) emit `Progress { phase: 'ready', percent: 100 }`.
>
> Wire `worker.ts` (from M-A6) to accept `LoadJfrRequest { id, fileName, bytes }` and call `jfrLoader.loadJfrIntoWorker(...)`, forwarding progress events back via postMessage as `LoadJfrProgress { id, phase, percent, message }`. On error, classify per `JfrFailureMode`: `RangeError` / `OOM` → `oom`; importer throw with `Malformed` in message → `malformed`; user-provided cap exceeded → `too_large`; unknown → `unsupported_events`. Surface as `LoadJfrError { id, mode, message }`.
>
> Copy the three WASM bundle files (`jfr-importer.js`, `.wasm`, `.wat`) from `core/frontend/public/wasm/` into `frontend-v2/public/` (flatten — no `wasm/` prefix). Update any path references accordingly.
>
> Tests: unit test that `loadJfrImporterScript` is idempotent and errors clearly on script-load failure. Integration: load `tests/fixtures/jfr/sample-small.jfr` — test fixtures live at `frontend-v2/tests/fixtures/jfr/sample-small.jfr` and `sample-large.jfr`, committed by M-A0. Assert phases fire in order; assert tables/macros/views exist post-load; deliberately corrupt a copy and assert `mode: 'malformed'`.
>
> Acceptance: `npm run test -- jfr` and `npm run test -- integration/jfrLoad` pass; the failure-mode taxonomy is enumerated with at least 2/4 modes test-covered (the others stubbed with TODO + tracked issue).

---

## Phase B — Visibility

Phase B is the first user-visible payoff: a real running app you can open, type into, and navigate. It builds the shell (App.tsx, theme tokens, OPFS autosave, error boundary), the sidebar with three nav panels (TABLES/VIEWS/MACROS) + live preview pane, the dep-graph overlay (⌘G, Cytoscape, 5 edge types), the issues panel with diagnostic rendering and ⌥↵ quickfix menu, the welcome cell with first-run spotlight + glyph legend, the command palette (⌘P) with all 14 result kinds, three-grain undo + ⌥A activity feed with time travel, find-across-cells (⌘⇧F), and the docs modal (?). At the end of Phase B you have an empty-but-navigable notebook that loads/saves to OPFS, renders no real cells yet (those land in Phase C), but lets you tour every chrome surface with keyboard and screen reader. Every milestone here is gated by the accessibility constraint in §10a.1.

---

### M-B1: Shell skeleton, theme, OPFS persistence, error boundary

**What**: The root `App.tsx`, a top-level `Shell.tsx` (topbar + sidebar slot + cell column slot + drawer slot), `NotebookContext` + `SettingsContext`, dark/light theme implemented as CSS custom properties on `:root[data-theme="dark|light"]` (no Tailwind dark-mode plugin gymnastics), OPFS-backed persistence per §0d.2 (autosave debounced 500ms after edits; load on mount; conflict-resilient writes via temp-file + rename), and a React error boundary that catches crashes anywhere in the cell column and renders a fallback panel with "reload" + "report issue" actions. Settings (theme, units, locale) round-trip through OPFS at a separate key. The disk adapter abstracts OPFS behind a `Storage` interface so tests can substitute an in-memory backend.

**Showcase**: §0a (overall surface layout — the milestone produces the empty chrome onto which Phase C will hang real cells), §0d.1 (autosave model), §0d.2 (OPFS scheme), §0d.3 (conflict handling), §1b.5 (theme switcher in topbar menu).

**Files**:
- `frontend-v2/src/App.tsx` (create) — root component, wires contexts + Shell.
- `frontend-v2/src/components/Shell.tsx` (create) — grid layout (topbar / sidebar / cell column / drawer slots).
- `frontend-v2/src/components/ErrorBoundary.tsx` (create) — class component, catches via `componentDidCatch`, renders fallback UI.
- `frontend-v2/src/context/NotebookContext.tsx` (create) — provider + `useNotebook()` hook.
- `frontend-v2/src/context/SettingsContext.tsx` (create) — theme, units, locale; persisted to OPFS at `settings.json`.
- `frontend-v2/src/services/persistence/opfsStore.ts` (create) — `loadNotebook(path) → Notebook`, `saveNotebook(path, n) → void`, autosave via temp-file + rename.
- `frontend-v2/src/services/persistence/diskAdapter.ts` (create) — `Storage` interface (OPFS impl + in-memory test impl).
- `frontend-v2/src/__tests__/persistence/opfsStore.test.ts` (create).

**Interfaces**: Notebook, NotebookFrontmatter (from M-A1).

**Tests**: unit | integration | a11y | e2e
- `opfsStore.test.ts`: round-trip a notebook through OPFS; assert byte-equality after save→load; assert temp-file + rename on save (no partial writes visible to a concurrent reader); assert load on missing file returns an empty `Notebook` not an error.
- a11y: axe-core scan on the empty Shell asserts ARIA roles on regions (`role="banner"` for topbar, `role="complementary"` for sidebar, `role="main"` for cell column, `role="region"` aria-label="chat" for drawer); visible focus ring 2px outline; contrast pass.
- e2e (playwright): boot the app, toggle theme via topbar menu, reload, assert theme persisted; trigger a crash in a debug-only "throw" button, assert error boundary catches and renders fallback with "reload" button that recovers.

**Gate**: notebook round-trips through OPFS (save→load byte-equal); theme toggle persists across reloads; any cell-column crash caught by error boundary (recovery path verified); axe-core clean on empty Shell.

**Blocked by**: M-A1, M-A5.

> **Agent prompt (M-B1):**
>
> Read showcase.html §0a (the full-app diagram — your Shell.tsx renders this five-region grid as empty slots; Phase C will populate the cell column, Phase D the drawer), §0d.1–§0d.3 (autosave model, OPFS scheme, conflict handling — your `opfsStore.ts` implements this), §1b.5 (theme switcher placement in topbar). Read REDESIGN_INTERFACES.md §1 for `Notebook` + `NotebookFrontmatter` shape — your contexts hold this.
>
> Implement `App.tsx` to wrap children in `<SettingsContext.Provider>` → `<NotebookContext.Provider>` → `<ErrorBoundary>` → `<Shell>`. Implement `Shell.tsx` as a CSS grid: `grid-template-areas: "topbar topbar topbar" "sidebar main drawer"`; topbar = 34px, sidebar = 240px (resizable later), drawer = 280px (collapsible later). Give each region a semantic role + `aria-label`. Implement `opfsStore.ts` with: (1) `navigator.storage.getDirectory()` for the root, (2) `saveNotebook(path, n)` writes `${path}.tmp` then renames to `path` (use `FileSystemFileHandle.move` if available; otherwise write + delete-old + rename via two-step copy), (3) `loadNotebook(path)` returns `parseNotebook(text)` from M-A1, or an empty notebook if missing. Debounce autosave at 500ms — call `saveNotebook` from a `useEffect` on `notebook` change.
>
> Implement `SettingsContext` to load `settings.json` from OPFS on mount and persist on change. Theme is `'dark' | 'light' | 'system'` — apply via `document.documentElement.setAttribute('data-theme', resolved)`. CSS custom properties live in `index.css` and switch on the `[data-theme="..."]` attribute selector — never read `prefers-color-scheme` at component level. Implement `ErrorBoundary` as a class component with `static getDerivedStateFromError` + `componentDidCatch`; fallback UI: heading "Something broke", error message, "reload" button (calls `location.reload()`), "report issue" link (mailto or GitHub URL — leave a TODO if no URL available yet).
>
> Tests: `opfsStore.test.ts` (use the in-memory `Storage` impl) covers round-trip, missing-file load, autosave debounce. a11y test runs axe-core against an `<App />` rendered with no notebook. Playwright e2e covers theme toggle persistence + error boundary recovery (you may need a hidden debug-only `<button onClick={() => { throw new Error('test') }}>` rendered only when `?debug=1`).
>
> Acceptance: `npm run test -- persistence/opfsStore`, `npm run test:a11y`, `npm run test:e2e -- shell` all pass; `npm run typecheck` + `npm run lint` clean.

---

### M-B2: Sidebar layout + TABLES/VIEWS/MACROS nav panels (placeholders)

**What**: The left sidebar component with a vertical stack of three collapsible nav panels (TABLES, VIEWS, MACROS), each with its own search input (`⌕`) that filters the panel's list, and a SAVED + TEMP sub-grouping per panel (saved items pinned to top, temp items below a divider). Item content is **placeholder** in this milestone — real catalog data flows in once Phase C wires DuckDB into the UI; here the panels accept a stub `items` prop and render with mock data in stories/tests. Per-panel collapse state persists to OPFS settings. Tab/Shift+Tab moves between panel headers, Enter expands/collapses, arrow keys navigate items within an expanded panel.

**Showcase**: §0b (sidebar overview), §0b.1 (three nav panels — TABLES/VIEWS/MACROS layout), §0b.3 (why this shape — every catalog object in one place; click-to-expand reveals columns or source).

**Files**:
- `frontend-v2/src/components/sidebar/Sidebar.tsx` (create) — vertical stack + drag-resize splitter (resize handle stubbed; real splitter in M-B3).
- `frontend-v2/src/components/sidebar/NavPanel.tsx` (create) — reusable collapsible panel with header, search, item list.
- `frontend-v2/src/components/sidebar/TablesPanel.tsx` (create).
- `frontend-v2/src/components/sidebar/ViewsPanel.tsx` (create).
- `frontend-v2/src/components/sidebar/MacrosPanel.tsx` (create).
- `frontend-v2/src/components/sidebar/SavedTempPanel.tsx` (create) — sub-section grouping with divider.
- `frontend-v2/src/__tests__/sidebar/sidebar.test.tsx` (create).

**Tests**: unit | a11y | e2e
- `sidebar.test.tsx`: render with 7 mock tables, 2 views, 2 macros; assert all three panels render; type into TABLES search → list narrows; collapse panel → items hidden; toggle SAVED/TEMP divider visible only when both groups have items.
- a11y: axe-core; assert `role="tree"` on each panel's item list, `role="treeitem"` per item, `aria-expanded` on the panel header; assert visible focus ring travels Tab → Tab → Tab through the three panel headers.
- e2e: collapse TABLES panel, reload, assert collapse persisted (reads from SettingsContext).

**Gate**: keyboard navigable end-to-end (Tab through headers, Arrow keys through items); ARIA tree roles present; per-panel collapse persists; axe-core clean.

**Blocked by**: M-B1.

> **Agent prompt (M-B2):**
>
> Read showcase.html §0b through §0b.3 carefully — pay attention to the visual arrangement: TABLES at top with row-count tooltips, VIEWS in the middle with `#N` cell-origin chips, MACROS at the bottom with `ƒ` glyphs. You are building the empty shells; data binding lands in M-B3 + Phase C. Read REDESIGN_INTERFACES.md for any types your stubs accept (no new types needed — define a local `SidebarItem` interface with `name`, `kind`, `meta?` and a panel-specific union).
>
> Implement `NavPanel.tsx` as the reusable widget: props `{ title, items, isCollapsed, onToggle, searchValue, onSearchChange, renderItem }`. Header row: chevron (▾ / ▸) + uppercase title + item count + ⌕ search icon that expands an inline input. Body: filtered list. Empty state: muted "no matches". Each `TablesPanel` / `ViewsPanel` / `MacrosPanel` is a thin wrapper that supplies `renderItem` and accepts a typed `items` prop. `SavedTempPanel` renders two sub-sections separated by a 1px divider when both contain items, just SAVED otherwise — TEMP grouping appears when items have `tempUntil?: number` in the future.
>
> Wire `Sidebar.tsx` to mount the three panels in a vertical flex column. Pull `collapsedPanels` from `SettingsContext` and persist on toggle. Add the splitter stub (a 6px-wide drag handle on the right edge; do not implement drag yet — leave a TODO referencing M-B3). Keyboard: Tab moves between panel headers, Enter/Space toggles collapse, ArrowDown into expanded item list moves through items, ArrowUp returns to header, Home/End jump to first/last item.
>
> Tests: render `Sidebar` with the in-memory `SettingsContext`, verify collapse persists; render with mock 7-table / 2-view / 2-macro fixture, type "alloc" into TABLES search, assert only `allocations` row visible. a11y test asserts `role="tree"`, `role="treeitem"`, and `aria-expanded` per the WAI-ARIA tree pattern. Playwright e2e verifies collapse-state survives reload.
>
> Acceptance: `npm run test -- sidebar`, `npm run test:a11y -- sidebar`, `npm run test:e2e -- sidebar` all pass.

---

### M-B3: Sidebar preview pane (live result preview, sort, per-column filter, save-as-cell)

**What**: The bottom half of the sidebar — a preview pane that activates when a user clicks an item in any of the three nav panels. It runs the appropriate query (e.g., `SELECT * FROM gc_pauses LIMIT 200` for a table click, the view's body for a view click, a macro-doc preview for macros) against the DuckDB worker from M-A6 and renders results in a sortable grid with a per-column filter row above the data and an editable SQL line above the grid (one-off rewrites). A **"save as cell"** button promotes the current SQL + filter state into a new SQL cell appended to the notebook (with appropriate alias and `displayIndex`). Also implements the vertical splitter from M-B2 — drag to resize the boundary between the nav-panel stack and the preview pane.

**Showcase**: §0b.2 (preview pane — sortable grid + per-column filter + editable SQL line + save-as-cell), §0b.3 (why it lives in the sidebar — most "let me just look" interactions happen here and only the useful ones get promoted to real cells).

**Files**:
- `frontend-v2/src/components/sidebar/PreviewPane.tsx` (create) — the live preview surface.
- `frontend-v2/src/components/sidebar/PreviewSort.tsx` (create) — sort indicator + click-to-cycle on grid headers (asc → desc → none).
- `frontend-v2/src/components/sidebar/PreviewFilter.tsx` (create) — per-column filter input row (text contains, numeric `>10` / `≥`, timestamp `≥12:30`).
- `frontend-v2/src/__tests__/sidebar/preview.test.tsx` (create).

**Tests**: unit | integration | a11y
- `preview.test.tsx`: click a mock TABLES item → assert query fires against the worker (use the real DuckDB worker from M-A6 with a fixture in-memory DB seeded with `gc_pauses`); assert grid renders 200 rows; click a column header → assert sort cycles asc → desc → none; type `>10` in a numeric filter → assert grid narrows; click "save as cell" → assert `notebook.cells.length` increased by 1 with a SQL cell whose source contains the current preview SQL + WHERE clauses derived from active filters.
- a11y: axe-core; grid uses `role="grid"`, headers `role="columnheader"` with `aria-sort`, filter inputs labeled; Tab travels header → filter → first cell; Enter on header cycles sort.
- integration: end-to-end preview against a real DuckDB worker with a real `.jfr` fixture loaded via the M-A7 path.

**Gate**: previews render real DuckDB query output via the worker; sort cycles asc/desc/none; per-column filter narrows rows; "save as cell" creates a well-formed SQL cell that round-trips through M-A5's formatter; ARIA grid roles present.

**Blocked by**: M-B2, M-A6.

> **Agent prompt (M-B3):**
>
> Read showcase.html §0b.2 (the preview-pane mock — note the editable SQL line at the top, the column headers with sort glyphs ▾/▴, the filter row directly below the headers showing `≥12:30`, `>10`, `~Alloc` style chips, the data rows, the row count at the bottom, and the three action buttons: "save as cell", download `⬇`, clear `⌧`). Read §0b.3 (rationale — why preview lives here, not in a separate panel). Read M-A6's `client.ts` API: `getDuckDBClient().query(sql) → Promise<RowSet>`.
>
> Implement `PreviewPane.tsx` with state `{ sql, results, sort, filters }`. On `setSelectedItem(item)` from the parent Sidebar (lifted state), build a default SQL: `SELECT * FROM ${item.name} LIMIT 200` for tables; the view body for views; for macros, render docs (no grid — show signature + description). The editable SQL line is a single-line CodeMirror or simple textarea — Enter re-runs. Sort is encoded in the SQL via `ORDER BY ${col} ${dir}` re-built on each cycle. Filters compose to additional `WHERE` clauses (string `~foo` → `LIKE '%foo%'`, numeric `>10` → `> 10`, ts `≥12:30` → `>= timestamp '...'`). Re-query on filter change with a 200ms debounce.
>
> "Save as cell": build a `SqlBlock` with the composed SQL (including ORDER BY + WHERE), assign a fresh alias (`adhoc_${n}`), append to `notebook.cells`, and dispatch via `NotebookContext`. The cell appears at the bottom of the cell column. Pipe the formatter from M-A5 before insertion so the SQL is canonical.
>
> Implement the vertical splitter promised in M-B2: a 6px draggable handle at the boundary between the nav-panel stack and the preview pane. Persist the split ratio to `SettingsContext`. Apply `cursor: row-resize` on hover. Respect a minimum height for each half (40px nav stack, 80px preview pane).
>
> Tests: unit tests use a fixture in-memory DuckDB with `gc_pauses` seeded from a CSV in `tests/fixtures/`; integration test loads `sample-small.jfr` via the M-A7 path and previews `gc_pauses`. axe-core asserts grid roles + aria-sort.
>
> Acceptance: `npm run test -- sidebar/preview`, `npm run test -- integration/previewPane`, `npm run test:a11y -- preview` pass.

---

### M-B4: Dep graph overlay (Cytoscape.js, ⌘G modal, 5 edge types)

**What**: A modal opened by ⌘G that visualizes the current `DepGraph` (from M-A4) as an interactive graph using **cytoscape.js** + **cytoscape-dagre** for hierarchical layout. Renders all 5 edge kinds — `data`, `var`, `live-var`, `axis-link`, `prompt` — with distinct **stroke patterns** (solid / dashed / thick-dashed / orange-solid / purple-dotted), not relying on color alone (§10a.1). Nodes use shape encoding too (round for cells, square for vars, diamond for live-vars). Hovering an edge shows a tooltip with the edge's metadata (alias / varName / direction). Modal traps focus, Escape closes, fits the graph to the viewport on open, supports pan + zoom via wheel + drag.

**Showcase**: §0a (the graph node placement and topbar indicator), §5 (live coupling — this is the surface that makes the coupling legible), §5a.6 (5-hop chain view — the overlay scales to long chains), §6b.6 (errors spanning cells — error nodes highlighted in the graph), §6c.7 (the rendered graph style — edge colors and patterns).

**Files**:
- `frontend-v2/src/components/depGraph/DepGraphOverlay.tsx` (create) — modal shell + ⌘G shortcut + focus trap.
- `frontend-v2/src/components/depGraph/CytoscapeAdapter.tsx` (create) — wraps cytoscape.js, manages mount/unmount, converts DepGraph → cytoscape elements.
- `frontend-v2/src/components/depGraph/EdgeRenderer.tsx` (create) — per-edge-kind style spec (stroke pattern + color + width + arrow).
- `frontend-v2/src/components/depGraph/NodeRenderer.tsx` (create) — per-node-kind shape spec.
- `frontend-v2/src/__tests__/depGraph/overlay.test.tsx` (create).
- `package.json`: add `cytoscape@^3.30.x` and `cytoscape-dagre@^2.x` to dependencies.

**Interfaces**: DepGraph, DepNode (CellNode | VarNode | LiveVarNode), DepEdge (DataEdge | VarEdge | LiveVarEdge | AxisLinkEdge | PromptEdge) — all from M-A4.

**Tests**: unit | visual | a11y
- `overlay.test.tsx`: mount with a fixture DepGraph containing one of each edge kind; assert the cytoscape graph has 5 edges, each with the expected style class; press Escape → modal closes; press ⌘G again → reopens. Mock `cytoscape` in unit tests; use real cytoscape in visual snapshot tests.
- visual: Playwright screenshot of the overlay against the standard 4-cell fixture; assert pixel-stable.
- a11y: focus trap inside modal verified; aria-label on each edge ("data edge from #1 to #2 via alias `gc_overview`"); the modal element has `role="dialog" aria-modal="true"`; reduced-motion disables auto-layout animation.

**Gate**: all 5 edge kinds visually distinguishable by stroke pattern (not just color — verified by greyscale screenshot diff); keyboard navigable (Tab steps through edges with aria-label readouts); modal traps focus; opens via ⌘G; closes via Escape.

**Blocked by**: M-A4.

> **Agent prompt (M-B4):**
>
> Read REDESIGN_INTERFACES.md §4 for the `DepGraph` shape your overlay consumes. Read showcase.html §6c.7 for the canonical edge styling (data = cyan solid, var = gray dashed, live-var = thick gray dashed, axis-link = orange solid, prompt = purple dotted) — **but** per §10a.1 color is never the only signal, so pair each color with a stroke pattern. Read §5 (live coupling) and §5a.6 (5-hop chains) for layout expectations on dense graphs.
>
> Install cytoscape: `npm i cytoscape cytoscape-dagre` and `npm i -D @types/cytoscape`. Implement `CytoscapeAdapter.tsx` as a function component that takes `graph: DepGraph` and renders a div which it then `useEffect`-mounts a cytoscape instance into. Convert nodes: cell → `{ data: { id: alias, label: `#${displayIndex} ${alias}`, kind: 'cell' }, classes: 'cell' }`; var → square shape with `$x` label; live-var → diamond shape with `$!x` label. Convert edges: each kind maps to a style class (`data`, `var`, `live-var`, `axis-link`, `prompt`); apply `line-style: solid|dashed|dotted` + a `line-dash-pattern` for distinguishability. Use `dagre` layout with `rankDir: 'LR'`, `rankSep: 100`, `nodeSep: 40`.
>
> Implement `DepGraphOverlay.tsx` as a portal-mounted modal: `role="dialog"`, `aria-modal="true"`, `aria-label="dependency graph"`. Wire ⌘G via a global shortcut handler (use the keyboard map service from M-B6 — leave a temporary local handler if M-B6 lands later, and replace once available). Trap focus with a roving tabindex; Tab cycles through edges; pressing Enter on an edge logs its metadata to an announcement live region (`aria-live="polite"`). Escape closes. Respect `prefers-reduced-motion`: disable cytoscape's animated layout.
>
> Tests: unit test mocks cytoscape and asserts the element conversion (1 fixture DepGraph → expected element list). Visual snapshot test mounts the real overlay against a 4-cell fixture and compares a Playwright screenshot. a11y test asserts focus trap and edge aria-labels; greyscale screenshot diff verifies edges remain distinguishable without color.
>
> Acceptance: `npm run test -- depGraph/overlay`, `npm run test:visual -- depGraph`, `npm run test:a11y -- depGraph` pass.

---

### M-B5: Issues panel + diagnostic rendering + quickfix ⌥↵ menu

**What**: A right-edge fan-out panel that lists all `Diagnostic` records currently attached to the notebook (parser errors from M-A1/A2/A3, formatter diagnostics from M-A5, dep-graph cycle warnings from M-A4, plus stubs for runtime errors landing in Phase D). Each diagnostic row shows severity glyph, kind, message, and source location (cell `#N` + line). Clicking a row scrolls the cell column to the offending location and highlights the source span. Pressing ⌥↵ in an editor near a diagnostic opens a **quickfix menu** with the diagnostic's `suggestions[]` array — selecting one applies the suggested edit. New errors are announced via `aria-live="polite"`. Renders all six diagnostic sub-kinds called out in §6: `SugarOnly`, `UnknownPlotType`, `UnknownClause`, `UnterminatedBrace`, `BrushProducerUnnamed`, `CycleIntroduced`. The "fix with agent" path is a stubbed action that lands in Phase D (M-Dx) — for now it renders a disabled-with-tooltip option.

**Showcase**: §6 (issues panel — taxonomy + render style), §6 sub-kinds (six diagnostic kinds), §6b (error recovery flow), §6b.2 (error band visualization in-cell), §6b.3 (quickfix menu), §6b.4 ("fix with agent" path — Phase D).

**Files**:
- `frontend-v2/src/components/issues/IssuesPanel.tsx` (create).
- `frontend-v2/src/components/issues/DiagnosticRow.tsx` (create) — one row per diagnostic with severity glyph + click-to-jump.
- `frontend-v2/src/components/issues/QuickfixMenu.tsx` (create) — ⌥↵ menu, list of suggestions, Enter applies.
- `frontend-v2/src/services/diagnostics/diagnosticRegistry.ts` (create) — aggregates diagnostics from every source (parsers, formatter, dep-graph) into one live list.
- `frontend-v2/src/services/diagnostics/quickfixRegistry.ts` (create) — maps `DiagnosticKind` → array of `Quickfix`s (each with `label`, `apply(notebook) → notebook`).
- `frontend-v2/src/__tests__/issues/issuesPanel.test.tsx` (create).
- `frontend-v2/src/__tests__/issues/quickfix.test.ts` (create).

**Interfaces**: Diagnostic, DiagnosticKind, Quickfix (from M-A1; extend `Quickfix` here if it doesn't yet exist — add to REDESIGN_INTERFACES.md if so).

**Tests**: unit | a11y | e2e
- `issuesPanel.test.tsx`: render with fixture of 6 diagnostics (one of each kind); assert 6 rows; click a row → assert `scrollIntoView` called on the right cell DOM; trigger a fresh diagnostic via the registry → assert the new row is announced via the aria-live region.
- `quickfix.test.ts`: for each of the 6 kinds, assert the registry returns ≥1 quickfix; for `SugarOnly`, apply the quickfix → assert the cell's SQL/plot source now contains the lowercase sugar form; for `UnterminatedBrace`, apply the quickfix → assert a `}` was inserted at the diagnostic's range end.
- a11y: panel has `role="region" aria-label="issues"`; each row is `role="button"`; ⌥↵ menu is `role="menu"` with `role="menuitem"` per suggestion; Escape closes the menu; focus returns to the source editor.
- e2e: type `LINE_CHART(x="t")` into a cell, observe the SugarOnly diagnostic appear, press ⌥↵, accept the rewrite, assert the source mutates to `line { x: "t" }`.

**Gate**: all 6 diagnostic sub-kinds render with the correct glyph + message; ⌥↵ opens a quickfix menu populated with relevant suggestions; new errors announced via aria-live; clicking a row jumps to source; "fix with agent" rendered as disabled (Phase D will enable).

**Blocked by**: M-B1.

> **Agent prompt (M-B5):**
>
> Read showcase.html §6 (issues panel structure — right-edge fan panel, fixed width 280px, lists all diagnostics with severity glyph + cell origin + message), §6 sub-kinds (the six canonical kinds — make sure your registry covers each), §6b through §6b.4 (recovery flow, error band, quickfix menu, "fix with agent"). Read REDESIGN_INTERFACES.md for the `Diagnostic` interface (kind, severity, range, message, suggestions?).
>
> Implement `diagnosticRegistry.ts` as an observable registry — components subscribe to it for changes. Sources push diagnostics with a source tag (`'parser:sql'`, `'parser:plot'`, `'formatter'`, `'depGraph'`, `'runtime'` (stub for Phase D)). The registry deduplicates by `(source, cellAlias, range, kind)` and orders by severity (error before warning before info), then by displayIndex.
>
> Implement `quickfixRegistry.ts` as a `Map<DiagnosticKind, QuickfixFactory[]>` where each factory takes a `Diagnostic` + current `Notebook` and returns a `Quickfix[]`. For the six kinds: SugarOnly → "Rewrite as sugar form" (uses the suggestion from the parser); UnknownPlotType → "Replace with `line`" (or "Replace with `bar`", best-guess by closest valid plot name); UnknownClause → "Remove unknown clause" + "Did you mean `title`?" (Levenshtein on the clause-name list); UnterminatedBrace → "Insert missing `}`"; BrushProducerUnnamed → "Add `name: \"<alias>\"` to producer panel"; CycleIntroduced → "Break cycle by demoting live edge" (rewrites `$!x` → `$x`).
>
> Implement `IssuesPanel.tsx` to subscribe to the registry and render `DiagnosticRow`s. The panel is collapsible (toggle via topbar ⚠ count from §0a); persist collapse to SettingsContext. Click row → `cellElement.scrollIntoView({ block: 'center' })` + flash an outline on the source span (use a transient CSS class with `animation: flash 800ms`). Implement `QuickfixMenu.tsx` as a contextual menu (positioned near the cursor); ⌥↵ in a CodeMirror editor opens it; arrow keys navigate; Enter applies; Escape closes and restores focus.
>
> "Fix with agent" is a stub menu item present in every quickfix list (rendered last, disabled, with title="Available in Phase D"). Track this in TODO comments referencing the Phase D agent milestone.
>
> Tests: unit test each quickfix on a minimal Notebook fixture, asserting the post-fix source. a11y test asserts roles + aria-live announcement on new diagnostic. Playwright e2e: full SugarOnly → ⌥↵ → accept → source rewritten path.
>
> Acceptance: `npm run test -- issues`, `npm run test:a11y -- issues`, `npm run test:e2e -- diagnostics` pass.

---

### M-B6: Welcome cell + glyph legend + command palette ⌘P

**What**: Three closely related onboarding/navigation surfaces. **Welcome cell**: an empty-state cell rendered when `notebook.cells.length === 0`, with a first-run spotlight carousel (4 slides: "load a JFR", "ask the agent", "brush a chart", "share a URL") and a "create blank cell" CTA. **Glyph legend modal**: a ? key or topbar entry that opens a modal listing every symbol used in the UI (chip glyphs `▼ ▲ 🔗 🤖 ƒ`, edge-kind swatches, status glyphs `●`, etc.) with a short description per row. **Command palette ⌘P**: the central navigation surface — opens a fuzzy-rankable list with **14 result kinds** (commands, cells, vars, snippets, prompts, settings, tables, views, macros, files, recent, `⇧` keyboard shortcuts, content search `/`, ask-AI fallback row), `k:` prefix scoping (e.g. `k:cells gc` only matches cell aliases), `/` switches the entire palette to content search mode, a preview pane on the right showing the currently-highlighted result's content, and an "Ask AI this question" fallback row that converts an unmatched query into an agent prompt (which dispatches via Phase D's agent path — stub for now).

**Showcase**: §1a.1 (welcome cell), §1a.2 (first-run spotlight carousel), §1a.7 (glyph legend), §1c (command palette overview), §1c.1 (result kinds — all 14), §1c.2 (scoping prefixes `k:`), §1c.3 (fuzzy ranking), §1c.4 (preview pane), §1c.5 (content search via `/`), §1c.6 (ask-AI fallback), §1c.8 (custom commands extension point).

**Files**:
- `frontend-v2/src/components/welcome/WelcomeCell.tsx` (create).
- `frontend-v2/src/components/welcome/SpotlightCarousel.tsx` (create) — 4-slide first-run intro, dismiss persists to SettingsContext.
- `frontend-v2/src/components/welcome/GlyphLegend.tsx` (create) — modal listing every glyph.
- `frontend-v2/src/components/palette/CommandPalette.tsx` (create).
- `frontend-v2/src/components/palette/ResultRow.tsx` (create) — per-result-kind row renderer.
- `frontend-v2/src/components/palette/PreviewPane.tsx` (create) — right-side preview of the highlighted result.
- `frontend-v2/src/services/palette/commandRegistry.ts` (create) — `registerCommand({ id, title, run })` API for kinds 1–13.
- `frontend-v2/src/services/palette/resultProviders.ts` (create) — per-kind providers that produce `Result[]` from the current notebook + catalog.
- `frontend-v2/src/services/palette/fuzzyRank.ts` (create) — implement subsequence + bonus-based ranking (no external dep; ~80 lines).
- `frontend-v2/src/__tests__/palette/commandPalette.test.tsx` (create).
- `frontend-v2/src/__tests__/palette/fuzzyRank.test.ts` (create).

**Tests**: unit | a11y | e2e
- `commandPalette.test.tsx`: open palette via ⌘P, type "gc" → assert results across multiple kinds (cells named gc_*, tables named gc_pauses, vars named $gc_*, snippets matching gc); type `k:cells gc` → assert only cells returned; type `/SELECT` → content search mode, assert cells containing SELECT highlighted; type a nonsense query → assert "Ask AI: '<query>'" fallback row appears; Enter on a cell result → palette closes and cell scrolled into view.
- `fuzzyRank.test.ts`: assert subsequence matching ("gcov" matches "gc_overview"); assert prefix bonus ("gc" matches "gc_overview" higher than "long_gc_pauses"); assert word-boundary bonus; assert deterministic ordering on ties.
- a11y: palette has `role="combobox"` + `role="listbox"`; results have `aria-selected`; Tab/arrows move selection; Esc closes and restores focus; glyph legend modal traps focus and has explanatory text for every glyph (screen-reader friendly).
- e2e: cold-boot the app, see welcome cell + spotlight; dismiss spotlight, reload, assert spotlight not shown; open palette, run "create blank cell" command, assert new cell appears.

**Gate**: ⌘P opens palette; all 14 result kinds backed by a provider (even if some return empty arrays for now — e.g., `prompts` from agent context is stubbed); `k:` prefix filters; `/` switches to content search; fuzzy ranking produces sensible ordering; ask-AI fallback row renders for unmatched queries; full keyboard flow; glyph legend lists every UI symbol; welcome cell renders on empty notebook; spotlight dismissable.

**Blocked by**: M-B1.

> **Agent prompt (M-B6):**
>
> Read showcase.html §1a.1, §1a.2, §1a.7 for the welcome cell + spotlight + glyph legend specs. Read §1c through §1c.8 carefully — this is the navigation backbone of the app and the 14 result kinds matter. Read §1c.1 specifically for the kind taxonomy: (1) commands, (2) cells, (3) vars, (4) snippets, (5) prompts, (6) settings, (7) tables, (8) views, (9) macros, (10) files, (11) recent, (12) ⇧ keyboard shortcuts, (13) content search `/`, (14) ask-AI fallback. Read §1c.8 for the custom-commands extension hook.
>
> Implement `commandRegistry.ts` as a global registry: `registerCommand({ id, title, hint, run })`. Seed it with built-in commands: "Create blank cell", "Toggle theme", "Open dep graph (⌘G)", "Open docs (?)", "Open keyboard map (⌘⇧K)", "Format notebook", "Open issues panel", "Open activity feed (⌥A)". Implement `resultProviders.ts` as 14 functions, each returning `Result[]` for a given query string + notebook context. Most providers are simple Array.filter; `tables`/`views`/`macros` read from the DuckDB catalog (use a placeholder catalog hook for now — wire to real DuckDB in Phase C); `recent` reads from SettingsContext; `⇧` shortcuts pulls from a keyboard-map registry; `content search /` greps cell sources; ask-AI is a synthetic provider that always returns one row when the query is non-empty and unmatched elsewhere.
>
> Implement `fuzzyRank.ts` — subsequence match returns a score (matched-positions, prefix bonus +50, word-boundary bonus +20, consecutive bonus +10/char). Reject non-subsequence matches (return -Infinity). Stable sort by (score desc, then result-kind priority, then alphabetical).
>
> Implement `CommandPalette.tsx` as a portal-mounted overlay: 600px wide, vertically centered, with a search input at top, the result list in the middle, and a 280px preview pane on the right. Parse `k:<kind>` prefix to filter providers; parse leading `/` to switch to content-search mode. Arrow keys move selection; Enter runs the result's action; Esc closes and restores focus. The preview pane shows result kind-specific content (cell source for cells, snippet text for snippets, command hint for commands, var value for vars, prompt body for prompts, setting description for settings, table schema for tables, view definition for views, macro source for macros, file path for files, recent timestamp for recent, shortcut chord for shortcuts).
>
> Implement `WelcomeCell.tsx` as the empty-state UI when `cells.length === 0`. The `SpotlightCarousel` is a controlled 4-slide tour; dismiss persists `welcomeDismissed: true` in SettingsContext. `GlyphLegend.tsx` is a static modal listing every glyph (compile from showcase §1a.7) with `role="dialog"` and a per-glyph description.
>
> Tests: see Gate list. Make sure the 14 result kinds are explicitly enumerated in a `commandPalette.test.tsx` table-driven test.
>
> Acceptance: `npm run test -- palette`, `npm run test -- welcome`, `npm run test:a11y -- palette`, `npm run test:e2e -- palette` all pass.

---

### M-B7: Three-grain undo + activity feed ⌥A + time travel

**What**: An undo stack with **three distinct grains** — (a) text edits within a single fence, (b) cell operations (add/remove/move/rename), (c) live-var changes (brush/hover/zoom/selection). ⌘Z honors the user's most recent grain first then falls back through grains. ⇧⌘Z redoes. A **grain coalescer** merges consecutive text edits within 700ms into one undo step. An **activity feed** drawer opens with ⌥A and shows a chronological log of all events (runs, edits, var changes, agent actions, errors) with filter chips (`runs` / `edits` / `vars` / `agent` / `errors`); clicking any row offers "restore state at this moment" — **time travel** that creates a new auto-checkpoint per §10b before applying. Activity log is a ring buffer capped at 1000 events to bound memory.

**Showcase**: §1a.4 (undo three grains overview), §1a.5 (activity feed entry point), §10a.2 (activity feed detail — timestamped rows + filter chips + provenance icons), §10a.3 (time travel + auto-checkpoint), §10a.4 (privacy + size — ring buffer, no full diffs stored, only event metadata).

**Files**:
- `frontend-v2/src/services/undo/undoStack.ts` (create) — three-grain stack + push/pop semantics.
- `frontend-v2/src/services/undo/grainCoalescer.ts` (create) — 700ms-debounce coalescing for text grains.
- `frontend-v2/src/services/activity/activityLog.ts` (create) — ring buffer + subscribe API.
- `frontend-v2/src/components/feed/ActivityFeed.tsx` (create) — drawer + filter chips + row list.
- `frontend-v2/src/components/feed/ActivityRow.tsx` (create) — one row per event with timestamp, kind glyph, summary, "restore" action.
- `frontend-v2/src/components/feed/FilterChips.tsx` (create) — runs/edits/vars/agent/errors chips with multi-select.
- `frontend-v2/src/__tests__/undo/undoStack.test.ts` (create).
- `frontend-v2/src/__tests__/activity/activityLog.test.ts` (create).

**Tests**: unit | a11y | e2e
- `undoStack.test.ts`: push three text edits within 700ms → assert they coalesce to one entry; push a cell op between two text edits → assert grain boundary respected (no cross-grain coalesce); ⌘Z pops one grain at a time; ⇧⌘Z re-applies in reverse order; mixing live-var changes with text edits → assert grains stay separable.
- `activityLog.test.ts`: push 1500 events → assert log length === 1000 (oldest evicted); subscribe handler called once per push; restore from event at index 500 → assert returned `Notebook` matches the snapshot captured at that point.
- a11y: feed drawer has `role="region"`; rows are `role="button"` with descriptive `aria-label`; filter chips are `role="checkbox"` with `aria-checked`; new events announced via `aria-live="polite"` (low frequency — coalesced over 2s to avoid spam).
- e2e: edit a cell, observe entry in feed; click "restore" → assert cell reverts + new checkpoint created.

**Gate**: three undo grains preserved with ⌘Z across mixed edit/op/var streams; ⌥A opens feed; filter chips function; ring buffer caps at 1000 events; time-travel restore creates a new auto-checkpoint before applying (per §10b); no full source diffs stored in the log (only event metadata, per §10a.4 privacy).

**Blocked by**: M-B1.

> **Agent prompt (M-B7):**
>
> Read showcase.html §1a.4 (undo three grains rationale — text edits, cell ops, live-var changes all undo independently so the user doesn't lose unrelated work), §1a.5 (entry point), §10a.2 (activity feed structure — timestamp, kind glyph, summary, filter chips), §10a.3 (time travel — restore creates new auto-checkpoint, doesn't overwrite history), §10a.4 (privacy — store event metadata only, never full source diffs).
>
> Implement `undoStack.ts` as three stacks (`textStack`, `cellOpStack`, `liveVarStack`) plus a unified `recentGrainsOrder` queue that tracks which grain saw the most recent push. `undo()` pops from the head of `recentGrainsOrder`. Each entry stores: `{ grain, timestamp, before: snapshot, after: snapshot, summary }`. Snapshots are lightweight (cell-source string for text grain, op record for cell ops, var name + value for live-var grain). Implement `grainCoalescer.ts` as a 700ms debounce per cell + grain — consecutive text-edit pushes for the same cell within 700ms collapse into one entry (merging `after` snapshot, keeping the original `before`).
>
> Implement `activityLog.ts` as a fixed-size ring buffer (1000 entries). Public API: `push(event: ActivityEvent)`, `subscribe(handler)`, `getAll() → ActivityEvent[]`, `restoreAt(index) → Notebook`. Each event: `{ timestamp, kind: 'run' | 'edit' | 'var' | 'agent' | 'errors', summary, sourceRef }`. `restoreAt(index)` is implemented by replaying inverse operations from the most recent auto-checkpoint forward up to `index` — auto-checkpoints come from §10b and live in `CheckpointStore` (stub for Phase D; for now, use the most recent OPFS save as the only checkpoint).
>
> Wire the activity log to receive events from: M-B1 (saves), M-A5 (formatter applied), M-B5 (diagnostics raised), undo/redo themselves, plus stubs for runs (Phase C) and agent (Phase D). Each event has a kind that maps to a filter chip.
>
> Implement `ActivityFeed.tsx` as a right-edge drawer (separate from chat drawer slot; share the slot or stack — leave a TODO noting the layout decision). `FilterChips.tsx` is a horizontal multi-select bar at the top. Each `ActivityRow` shows kind glyph + timestamp + summary + "restore" button. Clicking restore triggers `restoreAt(index)` and writes a fresh auto-checkpoint per §10b.
>
> Tests: see Gate list. Property test for coalescer: 10000 random push sequences, assert no entry crosses grain boundary and 700ms-window text pushes always merge.
>
> Acceptance: `npm run test -- undo`, `npm run test -- activity`, `npm run test:a11y -- activity` all pass.

---

### M-B8: Find across cells ⌘⇧F + docs modal ?

**What**: Two final navigation surfaces. **Find across cells** (⌘⇧F): a modal with a search field, regex toggle, "match case" toggle, "whole word" toggle, and a flat result list — each row shows cell `#N` + line + a context snippet. Click → jump to source. Supports "Replace" mode (single + replace-all) gated behind a confirm dialog because replace cuts across cells. **Docs modal** (?): an in-app docs reader with a left-rail topic list (plot DSL, sigil system, keyboard map, agent tools, frontmatter, sidebar — pulled from a `docsRegistry`), a search field across all topic content, and a `#docs/<topic>` URL deep-link scheme. Both modals trap focus, have ARIA dialog roles, and respect `prefers-reduced-motion`.

**Showcase**: §1b.2 (find across cells — modal layout, regex toggle, replace flow), §1d (docs modal overview), §1d.1 (entry points: ?, ⌘⇧/, topbar menu), §1d.2 (layout — left rail + content + search bar), §1d.3 (topic catalog), §1d.4 (search across topics), §1d.5 (deep-link `#docs/<topic>`), §1d.6 (why a modal not a separate route).

**Files**:
- `frontend-v2/src/components/find/FindAcrossCells.tsx` (create).
- `frontend-v2/src/components/find/FindResultRow.tsx` (create).
- `frontend-v2/src/components/docs/DocsModal.tsx` (create).
- `frontend-v2/src/components/docs/DocsSidebar.tsx` (create) — topic list.
- `frontend-v2/src/components/docs/TopicRenderer.tsx` (create) — renders markdown topic body.
- `frontend-v2/src/services/docs/docsRegistry.ts` (create) — topic metadata + body resolver.
- `frontend-v2/src/services/docs/searchIndex.ts` (create) — Lunr-style minimal in-memory full-text index over topic bodies.
- `frontend-v2/src/__tests__/find/findAcrossCells.test.tsx` (create).
- `frontend-v2/src/__tests__/docs/docsRegistry.test.ts` (create).

**Tests**: unit | a11y | e2e
- `findAcrossCells.test.tsx`: search "SELECT" across 4-cell fixture → assert N hits across multiple cells; toggle regex, search `gc_.+` → assert matches captured; "Replace all" with confirm → assert sources mutated and a single coalesced undo entry created.
- `docsRegistry.test.ts`: seed 4 stub topics (plot-dsl, sigils, keyboard-map, agent-tools); search "brush" → assert topics containing the word ranked sensibly; navigate via `location.hash = '#docs/sigils'` → assert the modal opens to that topic.
- a11y: both modals have `role="dialog" aria-modal="true"` and labeled headings; focus traps verified; topic list is `role="tree"` with `role="treeitem"`; result list is `role="listbox"` with `role="option"`.
- e2e: open find via ⌘⇧F, search "gc_overview", click first result → cell scrolled into view + source span highlighted; open docs via `?`, type "plot" in search → topics filter, click "Plot DSL" → topic renders; share `#docs/plot-dsl` URL → recipient sees same view on load.

**Gate**: ⌘⇧F opens find modal, finds across all cells with regex toggle; replace-all gated by confirm; ? opens docs modal; topics populated from `docsRegistry` (seeded with at least: plot-dsl, sigil-system, keyboard-map, agent-tools); search across topics works; `#docs/<topic>` deep link opens the modal to that topic on load; both modals fully accessible.

**Blocked by**: M-B6.

> **Agent prompt (M-B8):**
>
> Read showcase.html §1b.2 (find-across-cells layout — search field at top, toggles row, result list with cell origin + context snippet, optional replace UI), §1d through §1d.6 (docs modal structure, entry points, deep-link format, why it's a modal not a route — the answer is preservation of notebook context). Read M-B6 to understand the `?` shortcut binding (you'll register it in the keyboard-map service).
>
> Implement `FindAcrossCells.tsx`: top row = search input + regex / case / whole-word toggles + result count + replace toggle; body = flat result list grouped by cell. Each result has `{ cellAlias, line, col, snippet, matchRange }`. Implement search as a linear scan over `cell.blocks[*].source` strings (fine up to several thousand cells; if perf matters later we can add a precomputed index). Regex mode compiles the input with `new RegExp(src, flags)` and rejects invalid input with a non-blocking inline error. Click result → dispatch a `revealCell({ alias, line })` action consumed by the cell column (placeholder dispatch for now — wire to real cells in Phase C).
>
> Replace flow: when replace mode active, show a "Replace" + "Replace all" button. "Replace all" opens a confirm dialog ("Replace N matches across M cells?"); on confirm, apply edits via a single transaction so undo collapses to one entry (use M-B7's `undoStack.push` with `grain: 'cellOp'`).
>
> Implement `docsRegistry.ts` as a `Map<topicId, TopicMeta>` plus a `loadBody(topicId) → Promise<string>` function that resolves topic bodies from markdown files under `frontend-v2/src/docs/topics/*.md`. Seed at least: `plot-dsl.md` (covers all 12 plot types + composers + clause tail — extract from showcase §3a + §9), `sigil-system.md` (covers `$`, `$$`, `$!`, `$alias.<live>`), `keyboard-map.md` (every shortcut — pull from the keyboard-map service in M-B6), `agent-tools.md` (placeholder — Phase D will flesh out). Bodies are static markdown rendered with the same renderer your prose blocks will use in Phase C (you can use `react-markdown` or a smaller equivalent; pick now and document).
>
> `searchIndex.ts`: build a tiny inverted index — tokenize topic bodies by `/\s+/`, lowercase, dedupe per topic. Search returns topics ranked by `(matched tokens count, then prefix-bonus, then title-match bonus)`. Wire it into the docs modal's search field.
>
> Deep link: on app boot, parse `location.hash`; if it matches `^#docs/(.+)`, open the docs modal on that topic. When the user navigates within the modal, update `location.hash` so the URL is shareable.
>
> Tests: unit + a11y as per Gate. e2e covers full find flow + docs flow + deep-link load.
>
> Acceptance: `npm run test -- find`, `npm run test -- docs`, `npm run test:a11y -- find`, `npm run test:a11y -- docs`, `npm run test:e2e -- find`, `npm run test:e2e -- docs` all pass.

---

## Phase C — DSL & Dashboards

Phase C lights up the visual half of the notebook. It builds on Phase A's sugar parser (the `PlotNode` AST from M-A3) and Phase B's editor shell (cell column, issues panel, sidebar slots) to ship the runtime that **actually renders plots**. The work proceeds in seven beats: a renderer base + 5-state machine (M-C1), four batches of three plot types each — line/bar/scatter (M-C2), histogram/boxplot/heatmap (M-C3), pie/flamegraph/table (M-C4), gantt/area/range (M-C5) — composition operators `row{}` / `col{}` / `+` (M-C6), the clause-tail processor that turns parsed clauses into visual + lifecycle effects (M-C7), the full result-table interaction surface (M-C8), prose cells with embedded refs + report mode + HTML/PDF export (M-C9), and finally macros + slash menu (M-C10). Live-coupling clauses are **stub-registered** here; the runtime that pumps brush / hover / zoom / selection values into `$!` lives in Phase E. By end of Phase C the user can author a multi-cell, multi-plot dashboard, see it render against in-memory data, and export it to a self-contained HTML report — even before agents and live coupling come online.

---

### M-C1: Plot renderer base + 5-state machine (idle / loading / rendered / error / empty)

**What**: A `PlotRenderer` wrapper component that drives the five plot lifecycle states from showcase §3b.1 — `idle` (cell not yet executed), `loading` (executing or fetching), `rendered` (data arrived, chart drawn), `error` (execution or render failure with diagnostic surface), `empty` (zero rows / all-null y). The wrapper also provides shared infrastructure consumed by every concrete plot renderer: a **legend** (§3b.2 — click-to-toggle series, keyboard reachable), a **hover tooltip** (§3b.3 — pointer + keyboard equivalent), **pinnable annotations** (§3b.4 — click pins a label; persisted in PlotState until cell re-runs), **on-canvas controls** (§3b.5 — zoom reset, fullscreen, copy image), and a **share / copy / fullscreen modal** (§3b.6 — copy plot as PNG to clipboard, copy as SVG, share via URL hash). The state machine itself is a pure reducer so the renderer is testable without a DOM.

**Showcase**: §3b.1 (five states), §3b.2 (legend), §3b.3 (tooltip — pointer + keyboard), §3b.4 (pinnable annotations), §3b.5 (on-canvas controls), §3b.6 (share / copy / fullscreen), §3b.7 (rationale — why every plot looks and behaves the same shell-wise).

**Files**:
- `frontend-v2/src/components/plots/PlotRenderer.tsx` (create) — top-level wrapper consumed by every concrete plot renderer.
- `frontend-v2/src/components/plots/PlotStateMachine.ts` (create) — pure reducer `(state, event) → state` over the 5 states + transition guards.
- `frontend-v2/src/components/plots/PlotLegend.tsx` (create) — series toggle list with keyboard support.
- `frontend-v2/src/components/plots/PlotTooltip.tsx` (create) — positioned tooltip + keyboard variant (`tabindex=0` overlay).
- `frontend-v2/src/components/plots/PlotAnnotations.tsx` (create) — click-to-pin labels, survive re-render.
- `frontend-v2/src/components/plots/PlotControls.tsx` (create) — on-canvas control bar (zoom reset, fullscreen, copy).
- `frontend-v2/src/components/plots/PlotShareModal.tsx` (create) — share / copy-as-PNG / copy-as-SVG / URL-hash modal.
- `frontend-v2/src/__tests__/plots/renderer.test.tsx` (create).
- `frontend-v2/src/__tests__/plots/stateMachine.test.ts` (create).

**Interfaces**: PlotNode, PlotRenderState, AnnotationPin.

**Tests**: unit | visual | a11y | e2e
- `stateMachine.test.ts`: exhaustively enumerate every legal transition (`idle → loading`, `loading → rendered`, `loading → error`, `loading → empty`, `rendered → loading` on re-run, `error → loading` on retry); assert illegal transitions throw or no-op with diagnostic; assert reducer is pure (same input → same output, no mutation of input state).
- `renderer.test.tsx`: render in each of the 5 states → assert distinct visual markers (skeleton in `loading`, error banner in `error`, "no rows" affordance in `empty`); legend click toggles series → assert hidden series disappears; tooltip on hover → assert content reads from data; pin annotation → re-render with new data → assert pin persists at same data-coord; control bar buttons keyboard-reachable; share modal opens, "copy PNG" writes to clipboard (mock `navigator.clipboard.write`).
- a11y: PlotRenderer root has `role="figure"` with `aria-label` derived from `node.title`; legend items are `role="checkbox"` with `aria-checked`; tooltip is `role="tooltip"` with `aria-describedby` wiring; controls are buttons with descriptive labels; respects `prefers-reduced-motion` (no transitions).
- e2e: full lifecycle on a real plot fixture — cell runs, plot transitions `loading → rendered`, user pins annotation, user re-runs cell, annotation still there.

**Gate**: all five states distinct and reachable through the state machine; legend toggles series; tooltip on hover with keyboard equivalent (Tab into chart → arrow keys move focus across data points); annotations pinnable and survive a re-render; on-canvas controls (zoom reset, fullscreen) keyboard-accessible; share modal renders and "copy PNG" writes a `image/png` blob to the clipboard; axe-core clean.

**Blocked by**: M-A3 (PlotNode AST).

> **Agent prompt (M-C1):**
>
> Read REDESIGN_INTERFACES.md §1.1 (PlotNode tree) so you know what props your renderer receives. Read showcase.html §3b.1 through §3b.7 in detail — every plot in this app routes through this wrapper, so getting it right is load-bearing for the rest of Phase C. The five states are `idle | loading | rendered | error | empty`; transitions are driven by events from the runtime (Phase E) but for now you accept a `state` prop directly so the wrapper is testable in isolation.
>
> Implement `PlotStateMachine.ts` as a pure reducer: `reduce(state: PlotRenderState, event: PlotEvent): PlotRenderState`. Events: `'run'` (any → loading), `'data'` (loading → rendered | empty depending on row count), `'fail'` (loading → error), `'reset'` (any → idle), `'retry'` (error → loading). Illegal transitions emit a diagnostic and return the input state unchanged. No side effects, no DOM.
>
> Implement `PlotRenderer.tsx` as a wrapper that renders state-specific shells: skeleton in `loading`, error banner with retry button in `error`, "no rows" affordance in `empty`, the chart (passed as `children`) in `rendered`. Above the chart, mount `PlotLegend` (left or top depending on `node.legend` clause; default top); below or as an overlay, mount `PlotTooltip` and `PlotAnnotations` and `PlotControls`. The wrapper exposes a `PlotContext` for concrete renderers to register their series and hover handlers.
>
> Implement `PlotLegend.tsx` with one row per series; click toggles `hidden` flag in local state and notifies the wrapper. Keyboard reachable (Tab) with Space / Enter to toggle. `PlotTooltip.tsx` positions itself near the cursor (pointer) or near the focused data point (keyboard); content rendered from a callback the concrete renderer supplies. `PlotAnnotations.tsx` stores a list of `AnnotationPin { x, y, label, color }` in component state; persists across re-renders as long as the cell hasn't been re-executed (clear on `'reset'` event). `PlotControls.tsx` is a small toolbar with zoom-reset / fullscreen / copy buttons; fullscreen uses the Fullscreen API; copy delegates to `PlotShareModal`.
>
> `PlotShareModal.tsx`: copy-as-PNG (rasterize via `canvas.toBlob('image/png')`), copy-as-SVG (clone the SVG node and `clipboard.write` it as `image/svg+xml`), share-via-URL (build a `#plot/<cellId>/<plotName>` hash and copy to clipboard). The share-via-URL deep link is consumed by M-B8's docs/find modal infra in spirit but lives at the plot level here.
>
> Tests: see Gate list. Visual snapshots capture each state in light + dark theme. a11y: axe-core against the rendered output in each state.
>
> Acceptance: `npm run test -- plots/renderer`, `npm run test -- plots/stateMachine`, `npm run test:a11y -- plots`, `npm run test:e2e -- plots` all pass.

---

### M-C2: Line + bar + scatter renderers (3 types, adapted from v1)

**What**: Adapt v1's three workhorse renderers — `LineChartPlot.tsx`, `BarChartPlot.ts`, `ScatterPlot.tsx` from `core/frontend/components/plots/` — to consume the new `PanelNode` prop interface from the sugar parser instead of the v1 UPPERCASE config object. The chart bodies (recharts / D3 implementations) carry over largely intact; what changes is the prop adapter at the top: read `node.config` (x / y / color / size / opacity / etc.), resolve `VarRef` values against a passed-in scope, and emit series. Each renderer mounts **inside** `PlotRenderer` from M-C1, so legend / tooltip / annotations come for free.

**Showcase**: §3a.1 (line chart anatomy + canonical clauses table), §3a.2 (bar chart — stacking, orientation, sorting), §3a.3 (scatter — color/size encoding, jitter for over-plotting).

**Files**:
- `frontend-v2/src/components/plots/LineChartPlot.tsx` (create — adapted from v1).
- `frontend-v2/src/components/plots/BarChartPlot.tsx` (create — adapted from v1's `.ts`).
- `frontend-v2/src/components/plots/ScatterPlot.tsx` (create — adapted from v1).
- `frontend-v2/src/__tests__/plots/line.test.tsx` (create).
- `frontend-v2/src/__tests__/plots/bar.test.tsx` (create).
- `frontend-v2/src/__tests__/plots/scatter.test.tsx` (create).
- `frontend-v2/src/__tests__/plots/__snapshots__/` (create) — visual snapshot fixtures.

**Interfaces**: PlotNode (panel variant with `plotType: 'line' | 'bar' | 'scatter'`).

**Tests**: unit | visual | a11y
- `line.test.tsx`: render minimal `line { x, y }` against fixture data → assert one polyline drawn; multi-series via `color: "series"` → assert N polylines + N legend entries; `y: $myvar` → assert var resolves through scope; null y values → assert gaps (not zero-fill); reduced-motion → assert no animation duration on path.
- `bar.test.tsx`: vertical default; `orientation: "horizontal"` flips axes; `stacked: true` → assert bars stack with shared baseline; sort by `value desc` → assert order; negative values render below baseline.
- `scatter.test.tsx`: minimal → dots at `(x, y)`; `size: "count"` → radius scales; `color: "category"` → palette assignment from M-C3's color-blind-safe set; high-cardinality `color` (>20 categories) → assert "too many" diagnostic and fallback to gradient palette.
- visual: 4 snapshots per renderer (minimal, with-color, with-size, with-multi-series) in both light and dark theme.
- a11y: each chart has `aria-label` summarizing data ("Line chart: 3 series, 120 points each"); legend rows are `role="checkbox"`; reduced-motion respected.

**Gate**: all three types render from sugar AST (no classic UPPERCASE path remains); visual snapshots stable across 3 consecutive runs; per-chart `aria-label` populated; `prefers-reduced-motion` disables enter / update animations; null values render as gaps not zeros.

**Blocked by**: M-C1.

> **Agent prompt (M-C2):**
>
> Read showcase.html §3a.1 / §3a.2 / §3a.3 — these give you the canonical example, the clause table, and the edge-cases (null handling, stacking, multi-series) for each of the three chart types. Open the v1 files `core/frontend/components/plots/LineChartPlot.tsx`, `BarChartPlot.ts`, `ScatterPlot.tsx` to harvest the existing recharts / D3 rendering bodies — they're battle-tested, and the goal of this milestone is **adapt, not rewrite**. What changes is the prop interface: v1 received a classic config object (`{ X: "t", Y: "v", COLOR: "series" }`); you receive a parsed `PanelNode` from M-A3 with `node.config` keyed lowercase plus a `clauses` tail.
>
> For each renderer, write a thin adapter function `panelToSeries(node: PanelNode, data: Row[], scope: VarScope): SeriesData[]` that resolves `VarRef` values (e.g. `y: $myvar` → lookup in scope) and returns the series array the existing chart body consumes. Mount the chart body inside `PlotRenderer` from M-C1 so legend / tooltip / annotations are inherited; do not re-implement those.
>
> `LineChartPlot.tsx`: support multi-series via the `color` config key; respect null y as gap (do not interpolate); honor `prefers-reduced-motion` by setting `animationDuration={0}` on the recharts `<Line>`; emit hover events via the wrapper's tooltip channel.
>
> `BarChartPlot.tsx`: support `orientation: "vertical" | "horizontal"`, `stacked: true` (recharts `stackId` on Bar), `sort: "value desc"` (sort domain client-side before render); negative values render correctly across the baseline.
>
> `ScatterPlot.tsx`: support `size` (radius scale) and `color` (categorical palette from `palette` clause or default color-blind-safe in M-C3); detect cardinality >20 in categorical `color` and emit `UnknownClause`-style diagnostic plus fall back to a sequential gradient.
>
> Tests: see Gate list. Visual snapshots committed to `__snapshots__/` and reviewed at PR time.
>
> Acceptance: `npm run test -- plots/line`, `npm run test -- plots/bar`, `npm run test -- plots/scatter`, `npm run test:visual -- plots`, `npm run test:a11y -- plots` all pass.

---

### M-C3: Histogram + boxplot + heatmap (3 types)

**What**: Three distribution / density renderers. **Histogram** with bin computation (Freedman-Diaconis by default, user-overridable via `bins:` config); **Boxplot** with quartile (Q1 / median / Q3) + whiskers (1.5×IQR or user-specified) + outlier dots; **Heatmap** with a color-blind-safe palette per showcase §10a.1 (default to viridis or a SAP-tuned diverging palette; never red→green). Each mounts inside `PlotRenderer` (M-C1) and inherits the shared shell.

**Showcase**: §3a.4 (histogram — bin algorithms, log-y, density vs count), §3a.5 (boxplot — quartile calc, whisker rule, outlier handling), §3a.6 (heatmap — palette, log-scale, NaN handling), §10a.1 (color-blind-safe palette mandate).

**Files**:
- `frontend-v2/src/components/plots/HistogramPlot.tsx` (create).
- `frontend-v2/src/components/plots/BoxPlot.tsx` (create — port v1 `BoxPlot.tsx`).
- `frontend-v2/src/components/plots/HeatmapPlot.tsx` (create — port v1 `HeatmapPlot.tsx`).
- `frontend-v2/src/__tests__/plots/histogram.test.tsx` (create).
- `frontend-v2/src/__tests__/plots/boxplot.test.tsx` (create).
- `frontend-v2/src/__tests__/plots/heatmap.test.tsx` (create).

**Tests**: unit | visual | a11y
- `histogram.test.tsx`: Freedman-Diaconis bin width matches reference impl on 4 fixture datasets (uniform, normal, exponential, bimodal); explicit `bins: 50` overrides FD; log-y scales correctly with zero-bin handling; density mode normalizes to area=1 within float tolerance.
- `boxplot.test.tsx`: Q1 / median / Q3 / whiskers / outlier count match scipy reference data on 3 fixture datasets; multi-group boxplot (one box per category) lays out correctly; whisker rule `1.5*IQR` default, `2*IQR` via clause; missing values excluded not zero-filled.
- `heatmap.test.tsx`: viridis palette default; user palette override; log-scale color mapping; NaN cells render with a distinct "no-data" pattern (diagonal hatch, not a color); cell hover shows row+col+value; palette emits WCAG-AA contrast against axis labels.
- visual: 3 snapshots per renderer; color-blind simulation (deuteranopia, protanopia, tritanopia) screenshots committed for review.
- a11y: chart `aria-label` summarizes data shape; for heatmap, each row+col axis labeled; reduced-motion respected.

**Gate**: histogram bin algorithm (FD default) correct against reference impl; boxplot Q1 / median / Q3 / whiskers correct against scipy reference data within 1e-9 float tolerance; heatmap palette WCAG-AA contrast and color-blind-friendly verified by simulation pass; NaN cells distinctly rendered.

**Blocked by**: M-C1.

> **Agent prompt (M-C3):**
>
> Read showcase.html §3a.4 / §3a.5 / §3a.6 for the per-type spec, and §10a.1 for the color-blind-safe palette mandate (red→green never allowed; viridis or a SAP-tuned diverging palette is the default). Port the v1 bodies of `BoxPlot.tsx` and `HeatmapPlot.tsx` from `core/frontend/components/plots/` — adapt the prop shape to the new PanelNode interface as you did in M-C2. `HistogramPlot.tsx` is largely new (v1 has no histogram).
>
> `HistogramPlot.tsx`: implement Freedman-Diaconis bin width as `2 * IQR * n^(-1/3)` with clamping; user can override via `bins: <n>` clause (uniform-width bins across data range). Support `density: true` (normalize so bin areas sum to 1) and `logY: true`. Emit one `<rect>` per bin; pass bin centers to the tooltip channel.
>
> `BoxPlot.tsx`: compute Q1 = 25th percentile, Q3 = 75th, IQR = Q3-Q1, whiskers extend to the furthest data point within `1.5 * IQR` of Q1/Q3 (clause-overridable to `2*IQR`); points outside whiskers are outliers (rendered as small circles). Multi-group: one box per `category` value, side-by-side along x.
>
> `HeatmapPlot.tsx`: default palette `viridis` (interpolate inferno / magma / cividis available via `palette:` clause); log-scale color mapping when `colorScale: "log"`; NaN cells render with diagonal hatch (use SVG pattern definition) and a distinct legend swatch. Each cell is keyboard-focusable; on focus, the tooltip channel reads "row X, col Y, value Z".
>
> Tests: see Gate list. Build fixture data via seeded RNG (`mulberry32`) so all comparisons are deterministic. Color-blind simulation can use the `colorblind` npm package or hand-rolled matrix multiplication; commit simulated screenshots to `__snapshots__/` for human review.
>
> Acceptance: `npm run test -- plots/histogram`, `npm run test -- plots/boxplot`, `npm run test -- plots/heatmap`, `npm run test:visual -- plots`, `npm run test:a11y -- plots` all pass.

---

### M-C4: Pie + flamegraph + table renderers (3 types)

**What**: Three more renderers, each with notable special-cases. **Pie**: auto-collapse small slices below a threshold (default 2%) into a single "other" wedge; keep individual slices visible only if they clear the threshold or are explicitly pinned; legend lists collapsed members under "other" on hover. **Flamegraph**: port v1's `FlameGraphPlot.tsx` (zoom on click, hover reads frame name + cumulative + self time); add a stub plumbing for writing the hovered frame into `$hover` (Phase E will pump the value through the runtime; here we just register the event). **Table**: a **basic** tabular renderer (column list, simple cell values, no pagination or sort here — full result table is M-C8). The plot-DSL table differs from M-C8's `ResultTable` in that it can be embedded inside a plot composition (e.g. `row { line {...}; table {...} }`).

**Showcase**: §3a.7 (pie — auto-collapse, "other" wedge, when to use vs bar), §3a.8 (flamegraph — zoom, hover provenance, $hover plumbing intent), §3a.9 (plot-DSL table — embedded in compositions, simple).

**Files**:
- `frontend-v2/src/components/plots/PieChartPlot.tsx` (create — port v1 `PieChartPlot.tsx`).
- `frontend-v2/src/components/plots/FlameGraphPlot.tsx` (create — port v1 `FlameGraphPlot.tsx`).
- `frontend-v2/src/components/plots/TablePlot.tsx` (create — port v1 `TablePlot.ts`, basic only).
- `frontend-v2/src/__tests__/plots/pie.test.tsx` (create).
- `frontend-v2/src/__tests__/plots/flame.test.tsx` (create).
- `frontend-v2/src/__tests__/plots/table.test.tsx` (create).

**Tests**: unit | visual | a11y | e2e
- `pie.test.tsx`: 5 slices >2% → 5 wedges; 3 slices <2% + 2 slices >2% → 3 wedges (the 3 small ones collapse to "other"); explicit `pin: ["x", "y"]` keeps named slices regardless of size; "other" legend hover lists collapsed names.
- `flame.test.tsx`: render a 4-level flamegraph fixture → assert lane heights and widths proportional to time; click frame → zoom in (subtree fills width); hover frame → tooltip with name + cumulative + self; keyboard nav (arrow keys) moves focus across siblings + parent / children; `$hover` write stub registered (verify via spy on the registration channel — actual runtime in Phase E).
- `table.test.tsx`: 3-column / 4-row fixture → assert all cells rendered; null values render as muted em-dash; long strings truncate with title attr; embedded in `row { line {...}; table {...} }` → assert side-by-side layout (via M-C6's composer).
- a11y: pie wedges have role="img" with aria-label; flamegraph is `role="tree"` with each frame a `role="treeitem"` and ARIA level matching depth; table is a proper `<table>` with `<thead>` / `<th scope="col">`.
- e2e: flamegraph zoom in → annotate via M-C1 pin → re-render with new data → assert pin persists at the same frame.

**Gate**: pie collapses small slices to "other" with hover-expandable legend; flamegraph zoom in / out works via mouse and keyboard; table renders columns correctly; flamegraph hover writes to `$hover` (stub registered — Phase E plumbing complete in M-E3); a11y clean.

**Blocked by**: M-C1.

> **Agent prompt (M-C4):**
>
> Read showcase.html §3a.7 / §3a.8 / §3a.9. Pie's distinguishing behavior is the auto-collapse-to-"other" rule (threshold 2% default, clause-overridable); flamegraph's is the zoom + the `$hover` write side-effect (this is the only plot in v2 that **writes** a live-var by default — and it's a *stub* write at this milestone, with Phase E delivering the runtime that propagates the value).
>
> Port v1's `PieChartPlot.tsx` from `core/frontend/components/plots/`. Adapt to PanelNode props. Implement collapse: sum all slices below the threshold (`smallThreshold: 0.02` default, clause-overridable), render their sum as a single "other" wedge with a muted color, but keep their names in a sub-list shown when the legend "other" row is hovered or focused. Explicit `pin: ["A", "B"]` clause forces named slices to render individually even if below threshold.
>
> Port v1's `FlameGraphPlot.tsx`. Keep the recursive layout (each frame's width proportional to its cumulative time; children laid out left-to-right; depth grows downward). Implement zoom-on-click: clicking a frame sets it as the new root and re-lays out children to fill width. Hover writes `{ frame: name, cumulative, self }` to a `$hover` registration channel — for now, register the channel via `runtime.registerLiveWrite('$hover', plotId, plotNode.name)` (stub); leave a TODO referencing M-E3 for the actual propagation. Keyboard nav: arrow keys move focus across siblings + parent / children; Enter zooms to the focused frame; Escape resets zoom.
>
> Port v1's `TablePlot.ts` (note: v1 file ends `.ts` not `.tsx` — we re-export as `.tsx` here). This is the **embedded** table — used in plot compositions like `row { line; table }`. It renders rows + columns simply, with null → em-dash and truncation on long strings. No pagination, no sort, no find — those belong to M-C8's `ResultTable`. Keep this one minimal.
>
> Tests: see Gate list. The `$hover` stub assertion uses a spy on the runtime registration channel.
>
> Acceptance: `npm run test -- plots/pie`, `npm run test -- plots/flame`, `npm run test -- plots/table`, `npm run test:visual -- plots`, `npm run test:a11y -- plots` all pass.

---

### M-C5: Gantt + area + range renderers (3 types)

**What**: The last three plot types. **Gantt**: lanes (one per category) with intervals (`[start, end]` per row) rendered as horizontal bars; optional milestone diamonds at point-in-time events; useful for JFR thread / GC pause / lock visualization. **Area**: line-with-fill, with optional stacking (`stacked: true` stacks series with shared baseline; `streamgraph: true` centers the stack around zero). **Range**: min / max envelopes (one filled band per series) plus optional median line; used for percentile views like p10 / p50 / p90 latency.

**Showcase**: §3a.10 (gantt — lanes, milestone markers, when to use for JFR), §3a.11 (area — stacking + streamgraph mode), §3a.12 (range — min/max bands, median line overlay).

**Files**:
- `frontend-v2/src/components/plots/GanttPlot.tsx` (create).
- `frontend-v2/src/components/plots/AreaPlot.tsx` (create).
- `frontend-v2/src/components/plots/RangePlot.tsx` (create).
- `frontend-v2/src/__tests__/plots/gantt.test.tsx` (create).
- `frontend-v2/src/__tests__/plots/area.test.tsx` (create).
- `frontend-v2/src/__tests__/plots/range.test.tsx` (create).

**Tests**: unit | visual | a11y
- `gantt.test.tsx`: 3 lanes with 4 intervals each → assert lane order matches `lane:` config (stable sort); milestone diamonds rendered when `milestones:` config present; overlapping intervals within the same lane render side-by-side or stacked (configurable, default side-by-side); tooltip on bar shows start / end / duration.
- `area.test.tsx`: simple area = line with fill below; `stacked: true` → series stack with shared baseline, sum equals row-wise total of input; `streamgraph: true` → stack centers around zero; null values create gaps (no fill across).
- `range.test.tsx`: one band per series with `min` / `max` columns; optional `median:` adds a centerline; opacity defaults to 0.3 so overlapping bands remain visible; tooltip shows min / max / median at hovered x.
- visual: 3 snapshots per renderer in light + dark.
- a11y: each chart `aria-label` summarizes; gantt lanes navigable by arrow keys (Tab into chart, arrow keys move focus down lanes); area / range respect reduced-motion.

**Gate**: gantt lanes correctly ordered per `lane:` config with stable sort; area stack sums match row-wise input totals (float tolerance 1e-9); range bands render with proper opacity (0.3 default, overridable); milestone diamonds visible.

**Blocked by**: M-C1.

> **Agent prompt (M-C5):**
>
> Read showcase.html §3a.10 / §3a.11 / §3a.12. Gantt is the highest-value plot for JFR analysis (thread state per lane, GC pause per lane, lock-held intervals); area + range cover percentile / aggregate views.
>
> `GanttPlot.tsx`: lanes are categorical (one per distinct `lane:` value, sorted by first occurrence unless `laneOrder:` clause given). Each row contributes a horizontal bar from `start` to `end` in its lane. `milestones:` config (boolean or column name) renders diamond markers at point-in-time events. Overlapping intervals: default side-by-side packing (intervals that overlap in x split the lane vertically); `overlap: "stack"` clause forces them to stack instead. Tooltip on bar shows start / end / duration / row metadata.
>
> `AreaPlot.tsx`: implement as line-with-fill below; `stacked: true` uses recharts `stackId`; `streamgraph: true` offsets stack so the centerline is zero (use d3-shape's `stackOffsetWiggle`). Nulls create gaps (no fill across).
>
> `RangePlot.tsx`: render one filled band per series between `min:` and `max:` column values; default opacity 0.3 so multiple bands stay legible when overlapping; optional `median:` config adds a centerline rendered as a line of the same series color but full opacity. Tooltip shows min / max / median at hovered x.
>
> Tests: see Gate list. Visual snapshots committed.
>
> Acceptance: `npm run test -- plots/gantt`, `npm run test -- plots/area`, `npm run test -- plots/range`, `npm run test:visual -- plots`, `npm run test:a11y -- plots` all pass.

---

### M-C6: Composition operators (row{}, col{}, +) with nested layout engine

**What**: Implement the composer components that lay out nested `PlotNode` trees from the AST built in M-A3. `RowComposer` arranges children horizontally (flex-row, equal widths unless `width:` clauses override); `ColComposer` arranges vertically; `OverlayComposer` stacks two panels on the same canvas with shared axes (left-associative for `a + b + c`). Compositions can nest arbitrarily — `row { col { line; bar }; pie }` produces a 2-pane horizontal layout where the left pane is a 2-panel vertical stack. The dispatch lives in a single `Composer.tsx` entry point that switches on `node.kind`.

**Showcase**: §3 (composition overview), §3 closing paragraph on composers, §6.4 (canonical dashboard example: `row { col { line; bar }; pie }`).

**Files**:
- `frontend-v2/src/components/plots/Composer.tsx` (create) — dispatch on `node.kind`.
- `frontend-v2/src/components/plots/RowComposer.tsx` (create) — flex-row layout.
- `frontend-v2/src/components/plots/ColComposer.tsx` (create) — flex-col layout.
- `frontend-v2/src/components/plots/OverlayComposer.tsx` (create) — shared-axes overlay.
- `frontend-v2/src/__tests__/plots/composer.test.tsx` (create).

**Tests**: unit | visual
- `composer.test.tsx`: render `row { line; bar }` → assert two children laid out horizontally with equal widths; with `width:` clauses → assert widths respected proportionally; nested `row { col { row { line; bar }; pie }; scatter }` (3 levels) → assert correct DOM structure; `a + b` overlay → assert both children render in the same SVG with shared `xDomain` and `yDomain` (compute union of child domains); `a + b + c` parses left-associative → renders as `(a + b) + c` overlay tree.
- visual: 4 snapshots — minimal row, minimal col, deep nesting (3-level), overlay with two line series.

**Gate**: nested compositions (`row { col { row { ... } } }`) render with correct DOM structure; `+` operator shares x-axis when both children have time x; shared y-axis when both have numeric y of compatible scale; visual snapshots stable.

**Blocked by**: M-C1, M-A3.

> **Agent prompt (M-C6):**
>
> Read showcase.html §3 (the composition section near the start — explains `row`, `col`, `+` semantics) and §6.4 (the canonical dashboard sketch `row { col { line; bar }; pie }`). Read REDESIGN_INTERFACES.md §1.1 to refresh the `ContainerNode` and `OverlayNode` shapes from M-A3.
>
> Implement `Composer.tsx` as the single entry point: `function Composer({ node }: { node: PlotNode })` switches on `node.kind`: `'panel'` → render the concrete plot renderer (M-C2..M-C5); `'container'` with `direction: 'row'` → `RowComposer`; `'container'` with `direction: 'col'` → `ColComposer`; `'overlay'` → `OverlayComposer`. The Composer is recursive — children of a container are themselves PlotNodes routed back through `Composer`.
>
> `RowComposer.tsx`: flex-row with equal widths by default; if any child has a `width:` clause, distribute remaining space among siblings without explicit widths proportionally. Honor `gap:` clause for inter-pane spacing.
>
> `ColComposer.tsx`: flex-col, same logic but for `height:`.
>
> `OverlayComposer.tsx`: render both children inside the same `<PlotRenderer>` shell from M-C1; compute the union of x-domains and y-domains so axes align; series from both children are unioned into the legend; on hover, the tooltip shows values from both children at the same x.
>
> Tests: see Gate list. Visual snapshots committed.
>
> Acceptance: `npm run test -- plots/composer`, `npm run test:visual -- plots/composer` pass.

---

### M-C7: Clause tail processor (visual + coupling + lifecycle effects)

**What**: A `ClauseProcessor` that walks the parsed plot AST's clause tail and applies effects in three buckets. **Visual clauses** (`title`, `width`, `height`, `settings`) directly mutate the rendered output — applied at render time. **Live-coupling clauses** (`link-x`, `link-y`, `link-xy`, `on_hover`, `on_brush`, `on_selection`) register subscriptions / publications with the runtime — at this milestone we **stub-register** (call into a stub channel; the actual runtime pumping lives in Phase E). **Lifecycle clauses** (`name` for intra-cell addressing per REDESIGN_INTERFACES.md §IT15.3, `disabled` for skip-on-render) affect plot identity and execution flow.

**Showcase**: §3a.1 (line chart clause table — canonical clause list), §3.3 / §3.4 (clause tail anatomy), §5.6 (link-x / link-y / link-xy live coupling), §IT15.3 (`name:` for intra-cell addressing).

**Files**:
- `frontend-v2/src/components/plots/ClauseProcessor.ts` (create) — entry point + dispatch.
- `frontend-v2/src/components/plots/clauseEffects/visualClauses.ts` (create) — title / width / height / settings.
- `frontend-v2/src/components/plots/clauseEffects/coupleClauses.ts` (create) — link-x / link-y / link-xy / on_hover / on_brush / on_selection (stub registrations).
- `frontend-v2/src/components/plots/clauseEffects/lifecycleClauses.ts` (create) — name + disabled.
- `frontend-v2/src/__tests__/plots/clauses.test.ts` (create).

**Tests**: unit
- `clauses.test.ts`: all 12 supported clauses (from M-A3's parser) exercised at least once; `title: "Foo"` → assert renderer receives title prop; `link-x: $!zoom master` → assert stub registration call captured with role `master` on `$!zoom`; `link-x: $!zoom clamp` → stub call with role `clamp`; `on_hover: $myhover` → stub registration on hover channel; unknown clause `frobnicate: 1` (this should not have parsed past M-A3, but if it slips through) → diagnostic emitted via Phase B issues panel; `disabled: true` → renderer returns null (no render); `name: "primary"` → plot node's `name` field set for intra-cell ref.
- Property test: clause order independence — random shuffles of the same clause set produce identical effects.

**Gate**: all clauses from M-A3's supported list are processed by the right effect bucket; unknown clauses surface diagnostic to issues panel (M-B5); live-coupling clauses are stub-registered with the runtime channel; `disabled` shortcuts render; `name` is settable and survives serialization.

**Blocked by**: M-A3.

> **Agent prompt (M-C7):**
>
> Read REDESIGN_INTERFACES.md §1.1 (PanelClauses / ContainerClauses fields) and §IT15.3 (the `name:` clause for intra-cell addressing — e.g. `gantt {...} | name: "threads"` so prose can reference `@cell.threads`). Read showcase.html §3a.1 (the line chart clause table — the exhaustive canonical list), §3.3 / §3.4 (clause tail anatomy and ordering recommendation), §5.6 (link-x / link-y / link-xy live coupling — these create AxisLinkEdge in the dep graph from M-A4, and at runtime they push x/y zoom state into the live-var named by the clause).
>
> Implement `ClauseProcessor.ts` as a dispatcher. Signature: `processClauses(node: PanelNode | ContainerNode, ctx: ClauseContext): ProcessedNode` where ctx carries the runtime stub-registration handles. Three buckets:
>
> 1. **Visual clauses** (`visualClauses.ts`): `title`, `width`, `height`, `settings`. Pure prop mutation — return a new node with merged visual fields.
> 2. **Coupling clauses** (`coupleClauses.ts`): `link-x`, `link-y`, `link-xy`, `on_hover`, `on_brush`, `on_selection`. Each calls `ctx.runtime.registerLiveCoupling({ kind, varName, role, plotId })` — this is a stub at Phase C; the actual pump is implemented by M-E9 (link-x/y/xy), M-E3 (on_hover), M-E2 (on_brush), and M-E5 (on_selection). For `link-x: $!zoom master`, `kind='link-x'`, `varName='zoom'`, `role='master'`, `plotId=node.name ?? <synthesized>`. Roles supported: `master` (writes to the var), `clamp` (reads + clamps own view to the var's range), default = `clamp`.
> 3. **Lifecycle clauses** (`lifecycleClauses.ts`): `name` sets the addressable identifier; `disabled: true` causes render to short-circuit (return null from the renderer); these are processed before render so a disabled plot incurs no work.
>
> Order independence: process all clauses into a `ProcessedNode` object before applying any effects, so the order of clause appearance in source doesn't matter for the outcome. The only ordering that matters is the **stable serialization order** owned by the formatter in M-A5.
>
> Unknown clauses: they shouldn't reach you (M-A3's parser rejects them), but defensively emit a diagnostic via the issues channel and ignore the clause if one slips through.
>
> Tests: see Gate list. Stub registrations captured via a mock context.
>
> Acceptance: `npm run test -- plots/clauses` passes; property test for order independence at 1000 iters.

---

### M-C8: Result table — full interactions (sort, pagination, find ⌘F, copy/export, empty/error)

**What**: The rich result table for SQL cell outputs (distinct from M-C4's embedded plot-DSL table). Features per showcase §4a: sort by clicking column headers (multi-column sort with Shift+click); pagination for results >1000 rows (virtualized for performance up to 100k); in-result Find (⌘F when focused inside) with highlight; copy / export in four formats (CSV / JSON / SQL VALUES / Markdown); per §4a.2.3, "copy plot image to clipboard" affordance for plots embedded above the table; empty + error states per §4a.3 with helpful messaging.

**Showcase**: §4a (result tables — overview), §4a.1 (interaction surface — column sort, row select), §4a.2 (pagination), §4a.2.1 (in-result Find ⌘F), §4a.2.2 (copy / export — 4 formats), §4a.2.3 (copy plot image to clipboard), §4a.3 (empty / error states), §4a.4 (why this matters — rationale).

**Files**:
- `frontend-v2/src/components/results/ResultTable.tsx` (create) — main wrapper.
- `frontend-v2/src/components/results/ResultPagination.tsx` (create).
- `frontend-v2/src/components/results/ResultFind.tsx` (create).
- `frontend-v2/src/components/results/ResultExport.tsx` (create) — export menu.
- `frontend-v2/src/components/results/EmptyState.tsx` (create).
- `frontend-v2/src/components/results/ErrorState.tsx` (create).
- `frontend-v2/src/services/export/csvExport.ts` (create).
- `frontend-v2/src/services/export/jsonExport.ts` (create).
- `frontend-v2/src/services/export/sqlValuesExport.ts` (create).
- `frontend-v2/src/services/export/markdownExport.ts` (create).
- `frontend-v2/src/services/export/clipboardImage.ts` (create) — copy plot image to clipboard.
- `frontend-v2/src/__tests__/results/resultTable.test.tsx` (create).
- `frontend-v2/src/__tests__/results/exports.test.ts` (create).

**Tests**: unit | a11y | e2e
- `resultTable.test.tsx`: 100k-row fixture → virtualization renders only the visible window (~50 rows) but scroll-jump to row 50000 works; column header click toggles sort asc / desc / none; Shift+click adds secondary sort; pagination shows page N of M with prev/next; ⌘F when focused inside opens find bar, types "GC" → matching cells highlighted, Enter cycles through matches.
- `exports.test.ts`: CSV export — escape commas / quotes / newlines per RFC 4180; JSON export — preserve null / numeric / string types; SQL VALUES — output is paste-ready DuckDB; Markdown — pipe-table with alignment row; round-trip on a 4-column fixture for each format.
- a11y: result `<table>` with proper `<thead>` / `<th scope="col">` / `<caption>`; sort indicator has `aria-sort`; find input has `aria-label`; pagination has `aria-label="Page navigation"`; row selection (if added) is `role="row"` with `aria-selected`.
- e2e: run a 50k-row query, table renders within 200ms p95, pagination snappy, ⌘F highlights, "Export → CSV" downloads a valid file.

**Gate**: paginates 100k rows virtualized at smooth scroll (60fps target); ⌘F within result highlights and cycles matches; all 4 export formats produce valid output (verified by round-trip parse); empty / error states match §4a.3; column sort stable across re-renders; copy-plot-image puts a PNG blob on the clipboard.

**Blocked by**: M-A6 (DuckDB worker for the data source), M-C1 (plot renderer for the copy-image affordance).

> **Agent prompt (M-C8):**
>
> Read showcase.html §4a through §4a.4 — the entire result-table chapter. The features land into a single component (`ResultTable.tsx`) plus a service layer for exports. The table is **separate** from the plot-DSL table in M-C4 — that one is embeddable inside plot compositions and is minimal; this one is the full-featured SQL-result surface.
>
> Implement `ResultTable.tsx` using a virtualized list (recommend `@tanstack/react-virtual` or `react-window`) for the body so 100k rows render at 60fps. Header is sticky; clicking a header toggles sort `asc → desc → none`; Shift+click adds the column as a secondary sort key (multi-column sort, stable). Pagination is row-window-based — default page size 1000, configurable, with a `1000 / 5000 / All` selector; "All" disables pagination and lets the virtualization handle the full row count.
>
> `ResultFind.tsx`: ⌘F bound when the table or any descendant is focused; opens a find bar above the table; live-highlights matches; Enter / Shift+Enter cycles forward / back; Escape closes. Implementation: scan rows as the find query changes (cheap on virtualized rows — only those in the viewport need actual DOM highlighting; off-screen matches are counted for the "12 of 47" indicator).
>
> `ResultExport.tsx`: dropdown with four formats. Each export service is a pure function `Row[] → string`. CSV: RFC 4180 (quote fields containing `, " \n`, double internal quotes); JSON: array of objects, preserve types; SQL VALUES: emit `VALUES (...), (...), ...` paste-ready (use DuckDB-compatible literal syntax); Markdown: pipe-table with alignment row derived from column types (numeric → right, others → left).
>
> `clipboardImage.ts`: invoked from the plot-image affordance when a plot is rendered above the result; rasterize the plot's SVG via `canvas.toBlob('image/png')`, then `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`.
>
> `EmptyState.tsx` / `ErrorState.tsx`: per §4a.3. Empty state shows "No rows" + suggestions ("Loosen filters", "Check joins"); error state shows the SQL error + cell origin + "Open in editor" affordance.
>
> Tests: see Gate list. Round-trip parse on each export format (CSV → re-parse → assert same data).
>
> Acceptance: `npm run test -- results`, `npm run test -- exports`, `npm run test:a11y -- results`, `npm run test:e2e -- results` all pass.

---

### M-C9: Prose cells + Markdown + embedded refs + report mode + HTML/PDF export

**What**: Prose cells per showcase §3c — two shapes (prose block, prose with embedded `@cellId` refs). Markdown renderer (sanitized — no script execution); embedded refs resolve to live preview thumbnails of the referenced cell's plot output. **Report mode** toggle hides UI chrome (sidebar, issues panel, agent drawer, varbar, cell headers) so the notebook reads as a clean document. **HTML export** produces a self-contained `.html` file with plots inlined as SVG; **PDF export** uses print-css + headless browser (or `window.print()` with a tuned print stylesheet) to produce a paginated readable PDF.

**Showcase**: §3c (prose cells overview), §3c.1 (two shapes: pure prose vs prose-with-refs), §3c.2 (markdown rendering rules — sanitization, supported syntaxes), §3c.3 (embedded refs — `@cellId` and `@cell.plotName`), §3c.4 (report mode), §3c.5 (rationale), §1a.6 (export HTML / PDF affordance).

**Files**:
- `frontend-v2/src/components/prose/ProseCell.tsx` (create).
- `frontend-v2/src/components/prose/ProseEditor.tsx` (create) — CodeMirror prose mode + slash-menu integration.
- `frontend-v2/src/components/prose/MarkdownRenderer.tsx` (create).
- `frontend-v2/src/components/prose/EmbeddedRef.tsx` (create).
- `frontend-v2/src/components/report/ReportMode.tsx` (create).
- `frontend-v2/src/services/export/htmlExport.ts` (create).
- `frontend-v2/src/services/export/pdfExport.ts` (create).
- `frontend-v2/src/__tests__/prose/prose.test.tsx` (create).
- `frontend-v2/src/__tests__/prose/embedded.test.tsx` (create).
- `frontend-v2/src/__tests__/export/htmlExport.test.ts` (create).

**Tests**: unit | integration | a11y | e2e
- `prose.test.tsx`: render `# Heading\n\nText with *italic* and **bold**` → assert correct HTML; XSS attempt (`<script>alert(1)</script>`) → assert script tag stripped, text content preserved; pure-prose block (no embedded refs) renders fast.
- `embedded.test.tsx`: `@cell-2` resolves to a thumbnail of cell-2's plot output; `@cell-2.threads` resolves to the named plot inside cell-2 (§IT15.3 (implemented in M-E8) names); broken ref `@nonexistent` renders as a placeholder with diagnostic chip.
- `htmlExport.test.ts`: export a 3-cell notebook → produced `.html` opens standalone in a headless browser, plots render as inline SVG, no external network requests on load.
- a11y: prose has correct heading hierarchy (h1 → h2 → h3, no skipping); links have descriptive text; embedded refs have `aria-label` describing the referenced cell.
- e2e: enter report mode → assert chrome hidden; export HTML → assert downloaded file opens with all plots; export PDF → assert 1+ page produced.

**Gate**: prose renders Markdown safely (no XSS); `@cellId` embeds resolve to plot snapshots updated reactively when the source cell re-runs; report mode toggle hides sidebar / issues / agent / varbar / cell headers; HTML export is self-contained (open from disk with no network); PDF export is readable and paginated correctly.

**Blocked by**: M-B1 (cell store), M-C2..M-C5 (plot renderers for embeds).

> **Agent prompt (M-C9):**
>
> Read showcase.html §3c through §3c.5 in detail, plus §1a.6 for the export-HTML / export-PDF affordance and §1c (sidebar surfaces) so you know which chrome to hide in report mode.
>
> `MarkdownRenderer.tsx`: pick a renderer (`react-markdown` with `rehype-sanitize` is the safe default) and pin it. Configure the sanitizer to allow standard text formatting (headings, lists, emphasis, code, links, images) and to **strip** scripts, iframes, and event handlers. Code fences inside prose render with syntax highlighting via the same highlighter you'll wire in M-B3 (reuse, don't duplicate).
>
> `EmbeddedRef.tsx`: parse the embedded-ref syntax `@<cellAlias>` or `@<cellAlias>.<plotName>` (the §IT15.3 (implemented in M-E8) intra-cell name). On render, look up the referenced cell from the cell store (M-B1); render a thumbnail of the referenced plot's current rendered output. The thumbnail is reactive — when the source cell re-runs and the plot re-renders, the embedded thumbnail updates. Use a shared rendering pipeline (the same `<Composer>` from M-C6, just at reduced size) so the embed matches what the user sees in the source cell.
>
> `ProseCell.tsx`: a CellBlock of kind `prose`. Two shapes: pure prose (no embedded refs) and mixed (any number of `@<ref>` interleaved with prose). The editor (`ProseEditor.tsx`) is a CodeMirror prose mode with `/` slash-menu integration (M-C10 will register the slash-menu actions — for now expose the registration hook).
>
> `ReportMode.tsx`: a top-level toggle that sets a context flag; the Shell from M-B1 reads the flag and conditionally hides: Sidebar, ChatDrawer, IssuesPanel, Topbar (or replaces Topbar with a minimal report-mode header), CellHeader. The CellEditor stays but switches to read-only.
>
> `htmlExport.ts`: walk the notebook → for each cell, serialize the rendered output to a static fragment (plots become inline `<svg>` with embedded styles, prose becomes the sanitized HTML, result tables become static `<table>` with sticky-header style baked in). Wrap in a single HTML document with all CSS inlined and no external assets. Open it from disk — it must render correctly with zero network.
>
> `pdfExport.ts`: use `window.print()` with a tuned print stylesheet (page-break-inside: avoid on cells, page-break-before: always on first cell, page-break-after: avoid on headings, widows: 3, orphans: 3). If a headless browser is needed for higher fidelity, gate it behind a server-side opt-in. For Phase C, ship the print-css path; document the trade-off.
>
> Tests: see Gate list. e2e covers full report-mode toggle + export → headless-browser-open-the-exported-html flow.
>
> Acceptance: `npm run test -- prose`, `npm run test -- embedded`, `npm run test -- htmlExport`, `npm run test:a11y -- prose`, `npm run test:e2e -- export` all pass.

---

### M-C10: Macro fence + MACROS panel + slash menu (/ in SQL)

**What**: Parse `macro <name>` fences per showcase §3d — two kinds: **template** (a body of SQL with `${param}` placeholders) and **parameterized** (a body with typed parameter signature `macro foo(p1: text, p2: int)`). Maintain a registry of parsed macros keyed by name; expose them in the **MACROS sidebar panel** (filling in the placeholder slot from M-B2). The slash menu (`/` in SQL editor) opens an autocomplete listing macros + common SQL snippets; selecting expands the macro. Per §3d.6, a "promote selection to macro" affordance extracts the selected SQL into a new `macro` fence and replaces the selection with a macro invocation.

**Showcase**: §3d (macros overview), §3d.1 (entry point — macro fence anatomy), §3d.2 (two kinds: template + parameterized), §3d.3 (expansion semantics — substitution-first, no implicit SQL parsing), §3d.4 (recursion depth limit), §3d.5 (depth-overflow diagnostic), §3d.6 (promote-to-macro flow), §3d.7 (rationale), §1c.7 (slash menu relationship to macros), §6.6 (canonical promote-to-macro example).

**Files**:
- `frontend-v2/src/services/macros/macroRegistry.ts` (create) — registry + parsed macro store.
- `frontend-v2/src/services/macros/macroExpander.ts` (create) — recursive expansion with depth bound.
- `frontend-v2/src/services/macros/macroValidator.ts` (create) — parameter typecheck + reference resolution.
- `frontend-v2/src/components/sidebar/MacrosPanel.tsx` (replace placeholder from M-B2) — list of macros with hover preview + edit affordance.
- `frontend-v2/src/components/editor/SlashMenu.tsx` (create) — `/` autocomplete in SQL and prose editors.
- `frontend-v2/src/components/editor/PromoteToMacro.tsx` (create) — selection → new macro fence flow.
- `frontend-v2/src/__tests__/macros/macroExpander.test.ts` (create).
- `frontend-v2/src/__tests__/macros/macroValidator.test.ts` (create).
- `frontend-v2/src/__tests__/editor/slashMenu.test.tsx` (create).

**Interfaces**: MacroBlock (template | parameterized variants).

**Tests**: unit | integration | e2e
- `macroExpander.test.ts`: template `macro greet { SELECT 'hi' }` + invocation `${greet}` → expands inline; parameterized `macro filter_gc(min_ms: int) { WHERE duration > ${min_ms} }` + invocation `${filter_gc(100)}` → substitutes 100; recursion `macro a { ${b} }` + `macro b { ${a} }` → depth limit (16) reached → diagnostic emitted, expansion halts.
- `macroValidator.test.ts`: typecheck — `macro f(x: int)` invoked with `${f("string")}` → type error diagnostic; missing parameter → diagnostic; unknown macro reference → diagnostic.
- `slashMenu.test.tsx`: type `/` in SQL editor → menu opens with macros + snippets; type `/gre` → filters to `greet`; Enter → inserts `${greet}`; Escape → closes; promote-to-macro: select 3 lines of SQL → invoke command → new macro fence created, selection replaced with `${<newname>}`.
- e2e: define a macro in cell 1, invoke from cell 2, verify expanded SQL runs against the DuckDB worker.

**Gate**: macro fence parses both template + parameterized kinds; recursive expansion bounded at depth 16 with diagnostic on overflow per §3d.5; MACROS panel populated reactively when macros are defined / edited; `/` opens slash menu with macro completions and the closed set of standard SQL snippets (`SELECT`, `FROM`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`, `JOIN`, `LEFT JOIN`, `WITH`, `OVER`, `UNION`); "promote selection to macro" extracts SQL into a new macro fence with the original selection replaced by the macro invocation; existing references inside the selection are preserved.

**Blocked by**: M-A1 (cell parser for macro fence detection), M-A2 (SQL parser for substitution sites), M-B2 (sidebar placeholder to replace).

> **Agent prompt (M-C10):**
>
> Read showcase.html §3d through §3d.7 in full — this is the entire macro chapter. Read §1c.7 for how slash-menu integrates with macros, and §6.6 for the canonical "promote selection to macro" example. Read REDESIGN_INTERFACES.md for the `MacroBlock` type (`template` vs `parameterized` variants).
>
> `macroRegistry.ts`: a `Map<string, MacroBlock>` keyed by macro name. Watch the cell store (M-B1) so macros are re-parsed whenever a cell containing a `macro` fence changes. Expose a subscribe API so MacrosPanel can update reactively.
>
> `macroExpander.ts`: implement recursive expansion. `expand(sql: string, scope: MacroScope): { sql: string; diagnostics: Diagnostic[] }` — find every `${<macroRef>}` site, look it up in the registry, substitute. For parameterized macros, parse `${foo(arg1, arg2)}` invocation syntax and bind args to parameter names. **Depth bound: 16** — track recursion depth in a counter; if exceeded, emit `MacroDepthExceeded` diagnostic and halt expansion at that site (substitute with a comment placeholder so the rest of the SQL still tries to parse). Substitution is **textual** per §3d.3 — we do not re-parse the macro body as SQL at expansion time; SQL parsing happens once on the fully expanded text.
>
> `macroValidator.ts`: parameter typecheck (numeric / text / boolean) against invocation site; missing parameter, extra parameter, unknown macro reference each produce a distinct diagnostic kind. Diagnostics flow into the issues panel (M-B5).
>
> `MacrosPanel.tsx`: replace the placeholder shipped in M-B2's `Sidebar.tsx`. List all macros from the registry with name + parameter signature; hover shows body preview; click jumps to the macro's source cell + line.
>
> `SlashMenu.tsx`: CodeMirror keymap binding for `/` in SQL fences (and prose). Opens a popover with two sections: macros (from the registry) and SQL snippets (closed hard-coded list: `SELECT`, `FROM`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`, `JOIN`, `LEFT JOIN`, `WITH`, `OVER`, `UNION` — the same list enumerated in the Gate). Filterable by typing; Enter inserts; Escape closes. Live-updating as the user types more characters.
>
> `PromoteToMacro.tsx`: a command (registered in M-B6's command registry) that's enabled when there's a non-empty selection in an SQL editor. On invoke, prompt for a macro name, extract the selection into a new `macro <name> { ... }` fence (inserted into a "Macros" section of the notebook or as a new cell — pick one and document), and replace the original selection with `${<name>}`. Preserves any var refs inside the selection unchanged.
>
> Tests: see Gate list. e2e exercises the define-and-invoke flow end-to-end against the DuckDB worker from M-A6.
>
> Acceptance: `npm run test -- macros`, `npm run test -- slashMenu`, `npm run test:e2e -- macros` all pass.

---

## Phase D — AI Surface

Phase D delivers the local-first agent surface that sits alongside the notebook: a right-side docked **chat panel** (drawer + ⌘\ maximize overlay), **10 MCP-style tools** that let the model read schema / cells / docs and execute sandboxed SQL, a **cell-emit proposal mechanism** that renders model output as a diff with Accept / Reject (never auto-accept; atomic across multi-cell flows), a Copilot-style **inline chat** overlay (⌘K at cursor) sharing the same tool surface, a typed **prompt grammar** (EBNF; 7 verbs × 5 target kinds × `@resolver`) with three-tier autocomplete, a **local model** (HuggingFace transformers tiny, CPU) powering `plotForSql` inference and the 🪄 suggest-plot button, explicit **agent failure modes** (rate limits, timeouts, tool loops, provider failover, token budget, mid-stream interrupt, "what just happened?" panel), and a per-cell + per-session **audit log** written into frontmatter (`last_ai_prompt`, `last_ai_session`). Cell-emit never auto-accepts (load-bearing constraint from the front matter of this plan).

---

### M-D0: Port `IAiProvider` + three providers + `$$ai_providers` config

**What**: Port v1's battle-tested `IAiProvider` contract and its three implementations (Gemini, OpenAI, Gardener) verbatim into `frontend-v2/src/services/ai/`. Stand up the `providerRegistry` (id → constructor) + `providerMetadataRegistry` (id → display metadata) lookup pattern from v1's `AiService.ts`. Wire the **`$$ai_providers` workspace global** (per showcase §2.4 + §7b.7) as the persistence backbone for endpoint URLs, API keys, and per-provider model selections — these never enter the notebook file, only the workspace global. Implement `getEffectiveApiKey(provider, settings)` with the v1 fallback chain (settings → `process.env.<PROVIDER>_API_KEY`). All later D-milestones build on this foundation; M-D2's tool registry is layered ON TOP of `IAiProvider`, not in place of it.

**Showcase**: §2.4 (`$$ai_providers` workspace global — endpoints + keys + per-provider model selections live here, never in notebook files), §7 (AI surface intro — "External LLM via IAiProvider"), §7b.7 (external vs local — `IAiProvider` is the contract for the external path), §7b.8 (model selector — provider options + per-prompt switching), §6 (line 6396 — `IAiProvider` as the canonical external backend), §10c.1 (line 8123 — `$$ai_providers` stores endpoints + keys, never in notebook file).

**Files**:
- `frontend-v2/src/services/ai/IAiProvider.ts` (port from `/Users/i560383_1/code/experiments/jfr-sql-notebook/services/ai/IAiProvider.ts` verbatim) — interface + `ProviderMetadata`, `AIResponse`, `AIInlineResponse`, `AIPlotFixResponse`, `AiProviderType` types.
- `frontend-v2/src/services/ai/GeminiProvider.ts` (port from v1 verbatim).
- `frontend-v2/src/services/ai/OpenAiProvider.ts` (port from v1 verbatim).
- `frontend-v2/src/services/ai/GardenerProvider.ts` (port from v1 verbatim).
- `frontend-v2/src/services/ai/providerRegistry.ts` (create — extract `providerRegistry` + `providerMetadataRegistry` + `getEffectiveApiKey` from v1's `services/AiService.ts` lines 14–45).
- `frontend-v2/src/services/ai/aiProvidersStoreContract.ts` (create) — exports the `IAiProvidersStore` interface (the contract: `get(provider)`, `set(provider, config)`, `subscribe(cb)`, `getCostLedger(provider)`, `incrementSpend(provider, deltaUsd)`). **Stub→real handoff is owned by M-F4.** M-D0 ships the localStorage-backed stub against this contract; M-F4 swaps in the Dexie-backed real store implementing the same interface. No silent migration is allowed — the contract is the seam.
- `frontend-v2/src/services/ai/aiProvidersStore.ts` (create) — `$$ai_providers` workspace global accessor; reads endpoint URL + API key + active model id per `AiProviderType`; backed by F-phase `$$x` runtime (M-F1 / M-F2) but can ship before Phase F using a localStorage stub (interface-compatible with the F-phase `useLiveVar` hook). **This is the stub implementation of `IAiProvidersStore` from `aiProvidersStoreContract.ts`; M-F4 replaces this file's body with the Dexie-backed real store while preserving the exported interface byte-for-byte.**
- `frontend-v2/src/__tests__/ai/providerRegistry.test.ts` (create).
- `frontend-v2/src/__tests__/ai/aiProvidersStore.test.ts` (create).
- `frontend-v2/src/__tests__/ai/aiProvidersStoreContract.test.ts` (create) — contract test that exercises the `IAiProvidersStore` surface (CRUD + subscribe + cost-ledger increment + concurrent-write safety). Runs against the localStorage stub today; M-F4 wires it up against the Dexie-backed real store as part of its acceptance gate. Both implementations must pass an identical test suite — this is the seam that proves the stub→real swap is transparent to all consumers (M-D1, M-D5, ModelSelector, ProviderConfigDialog).
- `frontend-v2/src/__tests__/ai/providersImplementContract.test.ts` (create) — runtime smoke test that each ported provider satisfies `IAiProvider` against mocked fetches.

**Tests**: unit | integration | security
- Each ported provider satisfies the `IAiProvider` interface (compile check + a runtime smoke test with a mocked fetch).
- `providerRegistry.test.ts`: `providerRegistry.google === GeminiProvider`; `providerMetadataRegistry.google.id === 'google'`; `providerRegistry.openai === OpenAiProvider`; `providerRegistry.gardener === GardenerProvider`; unknown provider id returns `undefined`.
- `getEffectiveApiKey` fallback chain: settings key present → return it; absent + env var present → return env var; both absent → return empty string.
- `aiProvidersStore.test.ts`: setting `$$ai_providers.google.apiKey` persists across reload; switching `$$ai_providers.activeProvider` from `'google'` to `'openai'` notifies subscribers; reading an unconfigured provider returns `null` (caller surfaces the `ProviderConfigDialog`).
- **Security (load-bearing)**: an attempt to serialize `$$ai_providers` into a notebook file is rejected at the formatter level (M-A5 owns the scrub rule); the test verifies that saving a notebook with `$$ai_providers` referenced in frontmatter drops the keys before write. This is the showcase §10c.1 constraint — keys never enter notebook files.

**Gate**: all three ported providers implement `IAiProvider` and pass smoke tests against mocked responses; `providerRegistry` returns the right constructor for each `AiProviderType`; `$$ai_providers` workspace global stores endpoint + key + model per provider and is the **only** persistence site for keys (notebook files never contain keys, enforced by the M-A5 formatter scrub rule).

**Blocked by**: M-A5 (formatter — provides the `$$ai_providers` scrub rule that enforces "keys never enter notebook files"; M-D0 consumes this guarantee, it does not modify M-A5).

> **Agent prompt (M-D0):**
>
> Read `/Users/i560383_1/code/experiments/jfr-sql-notebook/services/ai/IAiProvider.ts` and the three provider implementations (`/Users/i560383_1/code/experiments/jfr-sql-notebook/services/ai/GeminiProvider.ts`, `/Users/i560383_1/code/experiments/jfr-sql-notebook/services/ai/OpenAiProvider.ts`, `/Users/i560383_1/code/experiments/jfr-sql-notebook/services/ai/GardenerProvider.ts`) in full. Read v1's `/Users/i560383_1/code/experiments/jfr-sql-notebook/services/AiService.ts` lines 14–45 for the `providerRegistry`, `providerMetadataRegistry`, and `getEffectiveApiKey` patterns. Read showcase.html §2.4 (workspace globals — `$$ai_providers` as the canonical store), §7b.7 (the external-LLM path uses `IAiProvider`), §7b.8 (the model selector switches providers per prompt), and §10c.1 (keys never enter notebook files).
>
> Port the four files verbatim into `frontend-v2/src/services/ai/`. Adjust imports (paths only — interfaces stay byte-identical). Extract the registries + `getEffectiveApiKey` into a new `providerRegistry.ts`. Implement `aiProvidersStore.ts` as a thin facade over the M-F1 localStorage bus (or a plain `localStorage` shim if Phase F hasn't landed yet — interface-compatible with `useLiveVar`). Persistence shape: `{ activeProvider: AiProviderType, google: { apiKey, basicModel, goodModel }, openai: { apiKey, basicModel, goodModel }, gardener: { apiKey, basicModel, goodModel } }`.
>
> API-key scrub on serialize is enforced by M-A5 (see formatter scrub rule). M-D0 can ship without modifying M-A5 — the rule already lives in the formatter and the load-bearing security constraint from showcase §10c.1 is owned there. `aiProvidersStore.ts` may optionally export a matcher predicate (regex `^\$\$ai_providers(\..+)?$`) for code reuse, but M-A5 is the canonical enforcement site.
>
> Tests: see the Gate list. The security test (serialization drops keys) is the highest-priority case — make it the first written and the first run in CI.
>
> Acceptance: `npm run test -- ai/providerRegistry`, `npm run test -- ai/aiProvidersStore`, `npm run test -- ai/providersImplementContract` all pass.

---

### M-D1: Chat panel UI — docked drawer + maximize overlay + transcript

**What**: The right-side docked chat drawer that hosts the agent conversation. ⌘\ toggles a maximize overlay that traps focus and covers the cell column for long sessions. The transcript renders four message kinds — user, model, tool-call (collapsible with input / output JSON), and cell-emit proposal (placeholder until M-D3) — and embeds interactive cells inline (a referenced plot is a live, scrollable, brushable preview, not a static image, per §7b.2). A **context inspector** drawer exposes exactly what the model saw on each turn (system prompt, tool schemas, conversation window, attached cells, redactions applied). A **model selector** picks the provider per prompt (Gemini, OpenAI, Gardener, Local) — each backed by an `IAiProvider` implementation from M-D0 except Local which is the M-D6 inference path. A **permission toggle** controls data-access scope (notebook-scope vs cell-scope, read-only vs read-write SQL) and persists per notebook. Endpoint URLs + API keys live in the **`$$ai_providers` workspace global** (M-D0), not in the notebook file; the notebook frontmatter stores only the chosen `agent.model` *id* (a stable string that resolves through `$$ai_providers`).

**Showcase**: §2.4 (`$$ai_providers` workspace global — backing store for the model selector's per-provider config), §7b (chat panel overview), §7b.1 (docked drawer + maximize), §7b.2 (transcript renders interactive cells, not images), §7b.3 (context inspector — what did the model see?), §7b.5 (permission surfaces), §7b.6 (cell-scope vs notebook-scope), §7b.7 (external LLM via `IAiProvider` vs local model), §7b.8 (model selector — provider options + per-prompt switching).

**Files**:
- `frontend-v2/src/components/agent/ChatPanel.tsx` (create) — drawer host + maximize state.
- `frontend-v2/src/components/agent/Transcript.tsx` (create) — virtualized message list.
- `frontend-v2/src/components/agent/MessageBubble.tsx` (create) — user / model bubble renderer.
- `frontend-v2/src/components/agent/ToolCallBubble.tsx` (create) — collapsible tool-call entry with input + output.
- `frontend-v2/src/components/agent/ContextInspector.tsx` (create) — drawer-in-drawer with the model's view.
- `frontend-v2/src/components/agent/ModelSelector.tsx` (create) — provider dropdown bound to the `$$ai_providers` workspace global (M-D0); four options (Gemini, OpenAI, Gardener, Local).
- `frontend-v2/src/components/agent/ProviderConfigDialog.tsx` (create) — the dialog opened from the `ModelSelector` when the chosen provider isn't configured in `$$ai_providers` (per showcase §7b.7 + §2.5 pill popover); collects endpoint URL + API key + `basicModel` / `goodModel` per provider and writes through `aiProvidersStore`.
- `frontend-v2/src/components/agent/PermissionToggle.tsx` (create) — scope + data-access toggle group.
- `frontend-v2/src/context/AgentContext.tsx` (create) — React context: session state, transcript, current model, permission scope.
- `frontend-v2/src/services/ai/IAiProvider.ts` (ported in M-D0) — consumed here for typing the model selector + per-turn dispatch.
- `frontend-v2/src/services/ai/GeminiProvider.ts` (ported in M-D0) — wired as the `'google'` option.
- `frontend-v2/src/services/ai/OpenAiProvider.ts` (ported in M-D0) — wired as the `'openai'` option.
- `frontend-v2/src/services/ai/GardenerProvider.ts` (ported in M-D0) — wired as the `'gardener'` option.
- `frontend-v2/src/services/ai/providerRegistry.ts` (ported in M-D0) — resolves the chosen `AiProviderType` to a constructor.
- `frontend-v2/src/__tests__/agent/chatPanel.test.tsx` (create).
- `frontend-v2/src/__tests__/agent/providerConfigDialog.test.tsx` (create).

**Tests**: unit | a11y | e2e
- `chatPanel.test.tsx`: ⌘\ opens drawer when closed and toggles to maximize when open; maximize overlay traps focus (Tab cycles within the overlay; Escape returns to drawer); transcript scrolls to bottom on new message; embedded cell reference in a message renders a live, scrollable preview (not a static image — assert it responds to brush events); model selector lists Gemini, OpenAI, Gardener, and "Local (M-D6)"; permission toggle persists across reloads (per-notebook key).
- `providerConfigDialog.test.tsx`: choosing an unconfigured provider opens the dialog; entering endpoint URL + API key + model writes through `aiProvidersStore` into `$$ai_providers`; the dialog never writes into notebook frontmatter (assert the M-A5 drop rule still fires); dismissing without saving leaves the active provider unchanged.
- a11y: drawer is `role="complementary" aria-label="Agent chat"`; maximize overlay is `role="dialog" aria-modal="true"` with a labeled close button; transcript is `role="log" aria-live="polite"`; context inspector announces "Showing model context for turn N"; focus ring 2px on all interactive controls per §10a.1.
- e2e: open notebook → press ⌘\ → drawer opens → type a message → assert it appears in the transcript → press ⌘\ again → maximize overlay opens → press Escape → returns to drawer; switch model in the selector → assert subsequent messages route to the new provider (mocked).

**Gate**: ⌘\ opens drawer and toggles to maximize overlay; maximize overlay traps focus and closes on Escape; transcript scrolls smoothly and renders embedded cells as live interactive previews; context inspector shows the exact model input (system prompt + tool schemas + window + attachments + redactions); model selector lists configured providers (Gemini, OpenAI, Gardener, Local) and resolves each through the M-D0 `providerRegistry`; `ProviderConfigDialog` opens for unconfigured providers and persists into `$$ai_providers` (M-D0) — never into notebook frontmatter; permission scope persists per-notebook across reloads.

**Blocked by**: M-D0 (the `IAiProvider` contract + `providerRegistry` + `$$ai_providers` workspace global — the model selector binds to all three), M-B1 (Shell + cell store to embed live cells in the transcript).

> **Agent prompt (M-D1):**
>
> Read showcase.html §7b in full — that is the entire chat-panel chapter, from §7b.1 through §7b.8. The transcript is **not** a chat log of strings; it embeds live, interactive cells (§7b.2 is load-bearing here — when the model references a plot, the user can brush / hover / zoom inside the transcript). The maximize overlay (⌘\) covers the cell column for long sessions; the drawer is the default surface. Read REDESIGN_INTERFACES.md for any `AgentSession` / `TranscriptEntry` / `ModelProvider` types defined upstream.
>
> Implement `ChatPanel.tsx` as a right-docked drawer (width ~420px, resizable later) with a maximize button and a ⌘\ keybinding bound through the M-B6 command registry. State lives in `AgentContext.tsx` — open / closed, drawer / maximize, current transcript, current model, permission scope. The maximize overlay is a `role="dialog" aria-modal="true"` portal that traps focus and renders the same `Transcript` + composer at full width.
>
> `Transcript.tsx`: virtualized message list (react-window or @tanstack/react-virtual). Each entry is one of: `user` (MessageBubble), `model` (MessageBubble), `tool-call` (ToolCallBubble — collapsible, JSON-pretty input + output), `cell-emit-proposal` (placeholder in M-D1; M-D3 replaces with `CellEmitProposal`). When the model references a cell (e.g. `@cell-3`), render an inline embedded preview using the same `<Composer>` from M-C6 — the embed must be a live, interactive component, not a static image.
>
> `ContextInspector.tsx`: a sub-drawer toggled from the panel header. Shows, for the selected turn, the literal system prompt, the JSON tool schemas (from M-D2's registry), the conversation window passed to the model, any attached cells, and a redaction summary if redaction (Phase E) is enabled.
>
> `ModelSelector.tsx`: dropdown bound to the `$$ai_providers` workspace global from M-D0 (via `aiProvidersStore`). Four options: **Gemini** (external, ported `GeminiProvider`), **OpenAI** (external, ported `OpenAiProvider`), **Gardener** (external, ported `GardenerProvider`), **Local** (M-D6 — the ~25M ONNX model; labeled "(local model)" with a small CPU icon). Persist the chosen provider id into `$$ai_providers.activeProvider`; persist the chosen model **id** (a stable string like `'gemini-1.5-flash'`) into the notebook frontmatter as `agent.model`. **Endpoint URLs and API keys never enter the notebook file** — they live exclusively in `$$ai_providers` (showcase §10c.1). If the selected provider is missing endpoint/key, render the `ProviderConfigDialog` (per showcase §7b.7 / §2.5 pill popover) and write through `aiProvidersStore` only. **Provider-config dialog** (showcase §2.5 / §7b.7, line 2293 — "✨ Ask AI" with no provider configured, and line 7092 — switching to a model whose provider isn't configured): when the chosen provider's `$$ai_providers[id]` entry is missing or has an empty `apiKey`, open `ProviderConfigDialog.tsx` (modal: endpoint, API key, default model id, per-provider data-access default, per-provider monthly cost-cap USD) **instead of** sending the turn. On Save, write to `$$ai_providers` via M-F2's store (workspace scope — keys never enter notebook frontmatter). The 🔌 affordance in the topbar (showcase line 2421) opens the same dialog directly.
>
> `PermissionToggle.tsx`: two paired toggles — (1) scope: notebook-wide vs cell-only (cell-only restricts the model to the active cell's context); (2) data access: read-only SQL vs read-write SQL (read-write requires explicit user opt-in per session). Persist per-notebook.
>
> Tests: see Gate list. Stub the model provider — actual provider wiring is M-D2 / M-D7 territory.
>
> Acceptance: `npm run test -- agent/chatPanel`, `npm run test:a11y -- agent/chatPanel`, `npm run test:e2e -- agent/chatPanel` all pass.

---

### M-D2: Tool registry + 10 MCP-style tools

**What**: Implement the 10 MCP-style JSON tool-use tools that the agent invokes through the model's tool-use API. The registry exposes each tool's JSON schema (name, description, input schema, output shape) to the model on every turn. The ten tools are: **schema** (list tables / columns / types), **describe** (describe a table's columns + sample row counts), **read_cell** (return a cell's source + metadata), **list_cells** (enumerate cells with their `produces:` capability list per IT15.6 — `brush`, `zoom`, `selection`, `hover`), **docs** (return showcase / interface docs relevant to a topic), **diagnose** (read current issues from the issues panel), **check_render** (verify a proposed plot DSL renders without error), **run_sql** (execute SQL in the DuckDB worker; read-only by default, write requires opt-in), **sample_table** (return a small random sample of a table), **get_live_var** (read the current value of `$x` / `$$x` per IT18). Each tool runs in a worker context with sandboxing (no DOM access, no fetch, no eval).

**Showcase**: §7 (ten MCP-style tools overview), §7c.1 (ten tools detail), §7c.2 (docs and diagnose earn their keep), §7c.3 (tool calls in transcript), §7c.4 (sandboxing run_sql), §7.1 (get_live_var argument shape — IT18).

**Files**:
- `frontend-v2/src/services/agent/toolRegistry.ts` (create) — registry + JSON schema export.
- `frontend-v2/src/services/agent/tools/schema.ts` (create).
- `frontend-v2/src/services/agent/tools/describe.ts` (create).
- `frontend-v2/src/services/agent/tools/readCell.ts` (create).
- `frontend-v2/src/services/agent/tools/listCells.ts` (create) — exposes `produces: ['brush','zoom','selection','hover']` per IT15.6.
- `frontend-v2/src/services/agent/tools/docs.ts` (create).
- `frontend-v2/src/services/agent/tools/diagnose.ts` (create).
- `frontend-v2/src/services/agent/tools/checkRender.ts` (create).
- `frontend-v2/src/services/agent/tools/runSql.ts` (create).
- `frontend-v2/src/services/agent/tools/sampleTable.ts` (create).
- `frontend-v2/src/services/agent/tools/getLiveVar.ts` (create).
- `frontend-v2/src/services/agent/toolSandbox.ts` (create) — worker-context sandbox guard.
- `frontend-v2/src/__tests__/agent/tools/schema.test.ts` (create).
- `frontend-v2/src/__tests__/agent/tools/listCells.test.ts` (create).
- `frontend-v2/src/__tests__/agent/tools/runSql.test.ts` (create).
- `frontend-v2/src/__tests__/agent/tools/registry.test.ts` (create).

**Tests**: unit | integration | e2e
- `registry.test.ts`: each tool exposes a valid JSON schema (parseable by an Ajv validator); registry returns all 10 tools by name; duplicate registration is rejected.
- `schema.test.ts` / `listCells.test.ts`: schema returns DuckDB tables loaded by M-A6; `list_cells` returns each cell with its `produces` capability list — the full taxonomy is the closed set `{'brush', 'hover', 'zoom', 'selection', 'scroll'}`; a `gantt` cell produces `['brush','hover']`, a `table` cell produces `['selection']`, a `line` cell produces `['brush','hover','zoom']`, per §IT15.6.
- `runSql.test.ts`: read-only SELECT runs and returns rows; an `INSERT` is rejected when the permission scope is read-only (assert distinct error code `WRITE_NOT_PERMITTED`); same `INSERT` runs when scope is read-write; pathologically large query times out at the configured ceiling.
- Sandbox test: a tool that attempts `document.body.innerHTML = ''` or `fetch(...)` from inside its handler is blocked by the sandbox (assert the sandbox throws before the side-effect runs).
- e2e: open chat → ask "what tables are loaded?" → assert the model issues a `schema` tool call → tool-call bubble appears in transcript → model responds with the table list.

**Gate**: each of the 10 tools exposes a valid JSON schema consumable by the provider's tool-use API; `run_sql` is sandboxed (read-only default, write requires explicit per-session opt-in surfaced in PermissionToggle from M-D1); `list_cells` returns `produces:` capability lists per IT15.6 §IT15.6; tool failures surface in the transcript with a retry affordance; tools cannot touch the DOM or open network sockets.

**Blocked by**: M-D0 (the tool registry dispatches `IAiProvider.getAgentResponse` output to tool handlers; the providers' tool-call JSON shape is set by their v1 implementations), M-A6 (DuckDB worker for `run_sql` / `sample_table` / `schema` / `describe`), M-D1 (transcript surface for tool-call bubbles).

> **Agent prompt (M-D2):**
>
> Read showcase.html §7 (the ten-tools overview), §7c.1 through §7c.4 (per-tool detail, transcript rendering, sandboxing), and §7.1 (the `get_live_var` argument shape introduced in iter-18 — note the `$x` vs `$$x` distinction). Read REDESIGN_INTERFACES.md for any `Tool` / `ToolSchema` / `ToolResult` types. Read the M-D0 ported `IAiProvider.ts` so you know the exact shape `getAgentResponse` returns — the tool registry is layered ON TOP of `IAiProvider`, not in place of it.
>
> **How the tool registry composes with `IAiProvider`**: each turn calls `provider.getAgentResponse(messages, toolSchemas)`. The provider returns text + tool-call JSON (the shape v1 already uses — see `GeminiProvider.ts` lines 51–87). The registry parses the tool-call JSON, dispatches each call to its handler, collects results, and feeds them back into the provider on the next turn via `getAgentResponse`. For providers that don't expose native tool-use (raw OpenAI/Gemini text mode is the fallback), the registry uses the existing `response_format: { type: "json_object" }` path with a structured "actions" schema (matches v1's `getAgentResponse` shape). Tool-use is provider-mediated — the registry never bypasses `IAiProvider`.
>
> `toolRegistry.ts`: a `Map<string, Tool>` with `register(tool)`, `get(name)`, `listSchemas()`. Each tool is `{ name, description, inputSchema, run(input, ctx) }`. `listSchemas()` returns the JSON-schema array passed to the provider on each turn.
>
> Implement one file per tool. **schema**: query DuckDB INFORMATION_SCHEMA → tables, columns, types. **describe**: pick one table → columns + count + 5 sample rows. **read_cell** / **list_cells**: read from the cell store (M-B1); `list_cells` includes the `produces:` array per IT15.6 (the cell type's capability list — `brush`, `zoom`, `selection`, `hover` — so the agent can target plots that publish what it needs). **docs**: in-memory index over the showcase + REDESIGN_INTERFACES — return passages relevant to a topic. **diagnose**: read from the issues panel (M-B5) and return current diagnostics. **check_render**: parse a proposed plot DSL through the parser (M-A3) and report parse / type errors without rendering. **run_sql**: route through M-A6's DuckDB worker; check the active permission scope (M-D1 PermissionToggle) before executing — read-only mode rejects INSERT / UPDATE / DELETE / CREATE / DROP with `WRITE_NOT_PERMITTED`. **sample_table**: `SELECT * FROM <t> USING SAMPLE 100`. **get_live_var**: read `$x` from the reactive var store (M-A4 / M-B7); accept `{ name: string, kind: 'live' | 'liveLive' }` per IT18.
>
> `toolSandbox.ts`: a thin wrapper around each tool's `run` that asserts the execution context has no `document`, no `window`, no `fetch`. Tools run inside the worker; the sandbox is belt-and-suspenders against accidental DOM imports.
>
> Tests: see Gate list. Each tool gets its own focused test plus a registry-level test for schema validity.
>
> Acceptance: `npm run test -- agent/tools`, `npm run test:e2e -- agent/tools` pass.

---

### M-D3: Cell-emit proposal mechanism (Accept / Reject, atomic multi-cell)

**What**: When the model proposes one or more cells (via a structured tool output or a `cell-emit:` block in its response), render the proposal in the transcript as a `CellEmitProposal` entry with a visual diff (proposed cell content vs current — for new cells the "current" side is empty). The user can **Accept** (applies atomically, single undo entry — `Cmd+Z` reverts all proposed cells together), **Reject** (discards the proposal; it stays in the transcript as history with a "rejected" marker), or **Edit prompt** (re-asks the model). Multi-cell proposals are atomic — all cells accept or all reject; there is no partial accept. A live preview of the proposed cell (plot rendered, SQL result) is shown in the transcript before accepting per §7c.8. **Critical: there is no auto-accept timer** (load-bearing constraint per the header of this plan and per §7c.6).

**Showcase**: §7 (cell-emit proposal mechanism overview), §7c.5 (what the LLM produces), §7c.6 (accept / reject mechanics — no auto-accept), §7c.7 (what an accepted cell carries — provenance), §7c.8 (live preview in transcript), §7c.9 (why "propose, don't write").

**Files**:
- `frontend-v2/src/components/agent/CellEmitProposal.tsx` (create) — the proposal entry component.
- `frontend-v2/src/components/agent/ProposalDiff.tsx` (create) — side-by-side or inline diff renderer.
- `frontend-v2/src/components/agent/AcceptRejectControls.tsx` (create) — button group + keyboard shortcuts.
- `frontend-v2/src/services/agent/cellEmitParser.ts` (create) — parse `cell-emit:` blocks from model output / tool result.
- `frontend-v2/src/services/agent/proposalApplier.ts` (create) — atomic apply to cell store with single undo entry.
- `frontend-v2/src/__tests__/agent/cellEmit.test.tsx` (create).

**Tests**: unit | integration | e2e
- `cellEmit.test.tsx`: a proposal is rendered with Accept / Reject buttons and a diff; Accept inserts the proposed cells into the cell store (M-B1) and the resulting state has exactly one undo entry covering all proposed cells; Reject leaves the cell store unchanged and the proposal entry remains in the transcript marked "rejected".
- **No-auto-accept regression test**: schedule a proposal, wait 30 seconds (with fake timers), assert it is **not** applied; only an explicit user click / keyboard activation accepts.
- Multi-cell atomicity: a 3-cell proposal where the 2nd cell would fail validation → assert none of the 3 cells are applied and a single diagnostic is shown.
- Live preview: a proposed `line { ... }` cell renders a live preview inside the transcript (use the M-C6 Composer at reduced size) before accept.
- e2e: ask the agent to "add a chart for GC durations" → proposal appears → click Accept → new cell appears at the bottom of the notebook → press ⌘Z → cell removed.

**Gate**: proposals never auto-applied (covered by the regression test); Accept produces exactly one undo entry covering the entire proposal; multi-cell proposals are all-or-nothing (the failure test above passes); live preview renders the proposed plot or SQL result inside the transcript; rejected proposals remain visible in the transcript as history (the agent's prior attempt is preserved for context).

**Blocked by**: M-D1 (transcript host), M-A1 (cell store for applying proposals).

> **Agent prompt (M-D3):**
>
> Read showcase.html §7c.5 through §7c.9 in full. §7c.6 is load-bearing: there is **no auto-accept timer**, no "auto-accept after N seconds" — every accept is an explicit user action. §7c.7 lists what an accepted cell carries with it (the `last_ai_prompt` provenance — M-D8 implements the write, but M-D3 stages the metadata on the proposal). §7c.8 specifies the live preview — the user sees the rendered plot before deciding.
>
> `cellEmitParser.ts`: parse the model's output for `cell-emit:` blocks (a structured fence — the agent emits one or more cells in a known format; pick the format that matches the rest of the codebase's cell serialization, likely the same fenced markdown the formatter from M-A5 produces). Output a `Proposal = { id, cells: ProposedCell[], prompt, model, tokens }`.
>
> `proposalApplier.ts`: apply a Proposal atomically. Wrap the cell-store mutation in a single transaction so undo reverts all cells together. If any cell fails parse / type / render check (use M-D2's `check_render`), reject the entire proposal and surface a diagnostic.
>
> `CellEmitProposal.tsx`: render a transcript entry with three regions — header (model name, token cost, proposal id), body (the diff for each proposed cell — use `ProposalDiff` which can be inline or side-by-side; for new cells the "before" is empty), and the controls (`AcceptRejectControls`). Below the diff, render a **live preview** of each proposed cell using the M-C6 `<Composer>` at reduced scale (or the result table at reduced height) — the preview is interactive (brush works) so the user can sanity-check before accepting.
>
> `AcceptRejectControls.tsx`: three buttons — Accept, Edit prompt, Reject. Keyboard shortcuts when focused inside the proposal: `A` accepts, `R` rejects, `E` re-asks. **No timer**. Reject changes the proposal entry's status to "rejected" but keeps it in the transcript as history.
>
> Tests: see Gate list. The no-auto-accept regression test must use fake timers and advance them 60 seconds; assert no side-effect on the cell store.
>
> Acceptance: `npm run test -- agent/cellEmit`, `npm run test:e2e -- agent/cellEmit` pass.

---

### M-D4: Inline chat — Copilot-style cursor overlay

**What**: ⌘K opens an inline chat overlay anchored to the cursor position in any cell editor (SQL, plot DSL, prose). The overlay accepts a prompt, shares the same `AgentContext` + tool surface (M-D2) as the chat drawer, and runs `check_render` automatically after any plot proposal per §7d.3. Multi-cell proposals coming back from an inline session remain **atomic** (same applier from M-D3) — see §7d.4. Every accepted inline-chat output writes provenance into the cell's frontmatter (`last_ai_prompt`) per §7d.5, and the inline chat is a thin overlay over the drawer's session (so transcripts are unified — the inline turn appears in the drawer transcript too).

**Showcase**: §7d (inline chat overview), §7d.1 (the overlay), §7d.2 (what's same / different vs the drawer), §7d.3 (check_render in the inline loop), §7d.4 (multi-cell proposals stay atomic), §7d.5 (frontmatter & provenance).

**Files**:
- `frontend-v2/src/components/agent/InlineChat.tsx` (create) — the overlay component.
- `frontend-v2/src/components/agent/InlineOverlay.tsx` (create) — the floating panel + cursor-anchor positioning.
- `frontend-v2/src/services/agent/inlineSession.ts` (create) — bridges inline turns into the shared AgentContext transcript.
- `frontend-v2/src/__tests__/agent/inlineChat.test.tsx` (create).

**Tests**: unit | a11y | e2e
- `inlineChat.test.tsx`: ⌘K with the cursor in a SQL cell opens the overlay anchored at the cursor; Escape dismisses; typing a prompt and pressing Enter sends it; the resulting model turn appears both in the inline overlay and in the drawer transcript (shared session).
- `check_render` auto-invocation: when the model proposes a plot, the inline session calls `check_render` (M-D2) before showing the Accept button; a parse failure short-circuits the proposal with a "model produced invalid plot — retry?" affordance.
- Multi-cell atomicity from inline: ask for "two plots side by side" → assert one Proposal with two cells → Accept inserts both atomically; Reject discards both.
- a11y: overlay is `role="dialog" aria-modal="true"`, focus traps inside, Escape returns focus to the cell editor.
- e2e: in a SQL cell, press ⌘K, ask "add a line chart for this query", accept the proposal, assert a new plot cell appears with `last_ai_prompt` in its frontmatter.

**Gate**: ⌘K opens the inline overlay at the cursor position; the overlay shares the same tool surface as the drawer (verified by enumerating tools available in each — they match); `check_render` is auto-invoked after every plot proposal in the inline loop; multi-cell proposals from inline chat are atomic (M-D3's applier); accepted inline outputs write `last_ai_prompt` to the affected cell's frontmatter (M-D8 does the actual write — M-D4 wires the call).

**Blocked by**: M-D1 (AgentContext + transcript), M-D2 (tool surface, especially `check_render`), M-D3 (proposal applier).

> **Agent prompt (M-D4):**
>
> Read showcase.html §7d through §7d.5 in full. §7d.2 spells out same / different vs the drawer: **same** tool surface, **same** session (the inline turn lands in the drawer transcript), **different** UI affordance (a floating overlay anchored to the cursor rather than a docked drawer). §7d.3 mandates that `check_render` runs after every plot proposal inside the inline loop — failures short-circuit before showing Accept.
>
> Register the ⌘K keybinding in M-B6's command registry, scoped to "when a cell editor is focused". `InlineOverlay.tsx` positions itself at the cursor using CodeMirror's `coordsAtPos` API; if the cursor is too close to the viewport edge, flip the overlay above the cursor instead of below. Focus the input on open; Escape dismisses and returns focus to the cell editor at the original cursor position.
>
> `inlineSession.ts`: build a turn against the same `AgentContext` session as the drawer. The inline session is **not** a separate session — every inline turn lands in the shared transcript so the user has one history. The only difference is which UI surface displayed the turn first.
>
> After the model returns a Proposal, call `check_render` (M-D2) on every plot cell in the proposal. If any fails, surface a "model produced invalid plot — retry?" banner with a one-click retry that re-sends the prompt with the error appended (a tight inner loop).
>
> Multi-cell proposals from the inline overlay use the same `proposalApplier` from M-D3 — they remain atomic. On Accept, before returning control to the editor, write `last_ai_prompt` into the affected cells' frontmatter (M-D8 owns the writer — call into it).
>
> Tests: see Gate list. The cursor-anchored positioning test should cover both the below-cursor and above-cursor (viewport-edge) cases.
>
> Acceptance: `npm run test -- agent/inlineChat`, `npm run test:a11y -- agent/inlineChat`, `npm run test:e2e -- agent/inlineChat` pass.

---

### M-D5: Prompt grammar — typed EBNF tokenizer + 7 verbs + 5 target kinds + @resolver

**What**: A typed prompt-input grammar per §7a. The lexer + parser implement the EBNF specified in showcase.html §7a: every prompt is a sequence of `verb? target? freeform-text?` with `@<token>` references interspersed. **Seven verbs**: `ask`, `explain`, `fix`, `optimize`, `translate`, `visualize`, `summarize` — the verb decides the mode (chat vs cell-emit vs explain-only). **Five target kinds**: `cell`, `schema`, `var`, `macro`, `plot` — each gets a distinct chip color in the input. **@-resolver**: `@cell-3` expands to the cell's content, `@schema` expands to the table list, `@$gcThreshold` to the live var, `@macros.foo` to a macro definition, `@plot.threads` to an intra-cell plot reference. Three-tier autocomplete: tier 1 — verb completion, tier 2 — target-kind completion (after a verb), tier 3 — identifier completion (after a target kind). Unresolved `@` references **block send** with a chip-level error.

**Showcase**: §7a (prompt language overview), §7a EBNF grammar, §7a seven verbs, §7a five target kinds, §7a resolver, §7a worked example, §7a three-tier autocomplete, §7a mode classification.

**Files**:
- `frontend-v2/src/services/promptGrammar/lexer.ts` (create) — token stream.
- `frontend-v2/src/services/promptGrammar/parser.ts` (create) — parse to typed AST.
- `frontend-v2/src/services/promptGrammar/resolver.ts` (create) — `@`-reference expansion against cell store / schema / var store / macro registry.
- `frontend-v2/src/services/promptGrammar/verbClassifier.ts` (create) — verb → mode mapping.
- `frontend-v2/src/components/agent/PromptInput.tsx` (create) — chip-rendering input.
- `frontend-v2/src/components/agent/PromptChip.tsx` (create) — colored chip per target kind.
- `frontend-v2/src/components/agent/PromptAutocomplete.tsx` (create) — three-tier popover.
- `frontend-v2/src/__tests__/promptGrammar/lexer.test.ts` (create).
- `frontend-v2/src/__tests__/promptGrammar/parser.test.ts` (create).
- `frontend-v2/src/__tests__/promptGrammar/resolver.test.ts` (create).
- `frontend-v2/src/__tests__/promptGrammar/autocomplete.test.tsx` (create).
- `frontend-v2/src/__tests__/promptGrammar/grammar.property.test.ts` (create) — property tests against EBNF.

**Tests**: unit | property | integration | e2e
- All 7 verbs detected and classified into the right mode (ask → chat, fix → cell-emit, explain → explain-only, optimize → cell-emit, translate → cell-emit, visualize → cell-emit, summarize → explain-only).
- All 5 target kinds chip-colored: `cell` (blue), `schema` (green), `var` (orange), `macro` (purple), `plot` (teal) — assert via component snapshot or aria attributes.
- `@` resolution: `@cell-3` resolves to cell-3's source; `@schema` resolves to the table list; `@$threshold` resolves to the live var; `@macros.filterGc` resolves to the macro body; `@plot.threads` resolves to the intra-cell plot ref (§IT15.3 (implemented in M-E8)).
- **Unresolved-@ regression test**: typing `@nonexistent` and pressing Enter → Send is blocked → chip shows error state → assert the model is **not** invoked.
- Three-tier autocomplete: typing in an empty input → suggest verbs; after a verb + space → suggest target kinds; after a target kind + space → suggest identifiers (cells / tables / vars / macros / plots).
- Property test (`grammar.property.test.ts`): generate 1000 random token sequences and assert acceptance matches the EBNF spec (an in-memory reference implementation of the grammar).

**Gate**: all 7 verbs detected and routed to the correct mode; all 5 target kinds chip-colored; `@`-resolution happens before send (regression test covers unresolved-@ blocking send); three-tier autocomplete works (verb → target → identifier); property test passes 1000 iters against the EBNF.

**Blocked by**: M-D1 (PromptInput lives inside ChatPanel).

> **Agent prompt (M-D5):**
>
> Read showcase.html §7a from top to bottom — the EBNF, the seven verbs, the five target kinds, the `@`-resolver, the worked example, the three-tier autocomplete, and the mode classification table are all there. The grammar is **typed**: target kinds restrict which identifiers can follow (you cannot `explain @plot.foo` if `foo` is a cell — the autocomplete prevents it; the resolver rejects it).
>
> `lexer.ts`: tokenize into `Verb | TargetKind | At | Identifier | Text`. Verbs are reserved words; target kinds are reserved words; `@` starts a reference (followed by `Identifier(.Identifier)?`); everything else is free text.
>
> `parser.ts`: build a typed AST `Prompt = { verb?: Verb, mentions: Mention[], freeText: string }` where `Mention = { kind: TargetKind, id: string, plot?: string }`. The parser must accept partial inputs (the user is mid-typing) without throwing — produce a partial AST + diagnostics list.
>
> `resolver.ts`: take the AST and resolve every Mention against the cell store (M-B1), schema (M-A6), live-var store (M-A4 / M-B7), macro registry (M-C10), and intra-cell plot names (§IT15.3 (implemented in M-E8)). Unresolved mentions are returned as a diagnostic; the send button is disabled while any unresolved mention exists.
>
> `verbClassifier.ts`: map verb → mode. `ask` → chat (no cell-emit expected); `explain` / `summarize` → explain-only (no cell-emit allowed); `fix` / `optimize` / `translate` / `visualize` → cell-emit allowed. The mode is passed to the model as part of the system prompt to bias its output shape.
>
> `PromptInput.tsx`: contenteditable or a token-aware textarea that renders chips for resolved mentions and red-bordered chips for unresolved ones. Each chip is keyboard-deletable.
>
> `PromptAutocomplete.tsx`: a popover anchored to the caret. Three tiers driven by the current AST state: empty → list verbs; verb without target → list target kinds; target kind without identifier → list identifiers of that kind.
>
> Tests: see Gate list. The property test against the EBNF should use fast-check or similar.
>
> Acceptance: `npm run test -- promptGrammar`, `npm run test:e2e -- promptGrammar` pass.

---

### M-D6: Local model + plotForSql inference + 🪄 suggest plot button

**What**: Load a **~25M parameter ONNX model** (per showcase §7a.10.4 — "Local ~25M ONNX") into a Web Worker via `onnxruntime-web` (WASM/CPU backend; no GPU dependency) at notebook load so plot suggestion works offline / without an external LLM call. Per §7a.10.4.3, a **rule-based floor** always runs first — a deterministic SQL-AST inspector that infers a sensible plot type from column types and SHAPE (one time column + one numeric → line; two numerics → scatter; one categorical + one numeric → bar). The local ONNX model **augments** the floor when confidence is borderline. `plotForSql(sql: string): PlotSuggestion[]` is the public API. A 🪄 **suggest plot** button next to every SQL cell calls `plotForSql` and routes the result into a cell-emit proposal (M-D3) so the user sees a diff with Accept / Reject. Slash-menu equivalents per §7a.10.5.4 — typing `/plot` in a SQL cell opens the same flow.

**The local ONNX model is NOT an `IAiProvider`** — it is a specialized inference path for `plotForSql` only. The full agent chat (M-D1 / M-D2 / M-D7) uses `IAiProvider` providers (Gemini / OpenAI / Gardener from M-D0) because a 25M-parameter model cannot drive multi-turn tool-use reliably. The Local option in the ModelSelector (M-D1) routes only the `plotForSql` and 🪄 suggest-plot affordances through this milestone.

**Showcase**: §7a (local model), §7a.10.4 (line 6396 + line 7027 — "Local ~25M ONNX" — the canonical model spec), §7a (plotForSql), §7a.10.4.3 (rule-based floor — always runs first), §7a (🪄 suggest plot button), §7a.10.5.4 (slash-menu equivalents), §7a (deep dives on the rule-based floor + model inference).

**Files**:
- `frontend-v2/src/services/localModel/modelLoader.ts` (create) — lazy-load the ~25M-parameter ONNX model via `onnxruntime-web`; cache the `.onnx` file in IndexedDB (or OPFS) so subsequent loads are warm.
- `frontend-v2/src/services/localModel/plotForSql.ts` (create) — orchestrator: rule-based floor + ONNX-model augmentation.
- `frontend-v2/src/services/localModel/ruleBased.ts` (create) — deterministic AST-driven plot suggestion.
- `frontend-v2/src/components/editor/SuggestPlotButton.tsx` (create) — 🪄 button + cell-emit integration.
- `frontend-v2/public/models/plot-for-sql-25m.onnx` (asset) — the bundled ONNX weights (~25M params; estimate ~50–100MB on disk depending on quantization; pick int8 quantized to keep load time under 2s warm).
- `frontend-v2/src/__tests__/localModel/ruleBased.test.ts` (create).
- `frontend-v2/src/__tests__/localModel/plotForSql.test.ts` (create).
- `frontend-v2/src/__tests__/localModel/suggestButton.test.tsx` (create).

**Tests**: unit | integration | e2e
- `ruleBased.test.ts`: SQL `SELECT ts, cpu FROM samples` → suggest `line` (time + numeric); `SELECT x, y FROM points` (both numeric) → suggest `scatter`; `SELECT gc_type, count(*) FROM events GROUP BY gc_type` → suggest `bar`; `SELECT a, b, c FROM t` (3 numerics) → suggest `scatter` with a color encoding for `c`; an empty result type-set falls back to `table`.
- `plotForSql.test.ts`: rule-based floor always runs; ONNX model augments only when the floor's top suggestion has confidence < 0.7; if the ONNX model fails to load (`onnxruntime-web` throws or the asset is missing), the floor's suggestion is returned unchanged (graceful degradation — verified by mocking the loader to throw).
- `suggestButton.test.tsx`: 🪄 button on a SQL cell calls `plotForSql` and produces a cell-emit proposal (M-D3); slash-menu `/plot` does the same.
- Performance: ONNX model loads in < 2 seconds after warm cache (IndexedDB hit); first call returns within 500ms for queries with < 5 columns.
- e2e: open a notebook with a SQL cell, click 🪄, accept the proposal, assert a plot cell appears next to the SQL cell.

**Gate**: ONNX model loads in under 2 seconds after warm cache; `plotForSql` returns reasonable suggestions for time-series, categorical, multi-metric, and pathological inputs; the rule-based floor always runs (verified by mocking `onnxruntime-web` to throw — floor still produces output); the 🪄 button is present on every SQL cell and routes through M-D3's cell-emit proposal flow.

**Blocked by**: M-D2 (tool surface for prompt context), M-D3 (proposal applier for the button's output).

> **Agent prompt (M-D6):**
>
> Read showcase.html §7a's local-model section, including the rule-based floor (§7a.10.4.3), the 🪄 suggest plot button, and the slash-menu equivalents (§7a.10.5.4). The order is **floor first, model augments** — the floor is deterministic and always runs; the ONNX model is only consulted when the floor's confidence is below a threshold (start at 0.7, tune later). The model spec is **`Local ~25M ONNX`** (showcase lines 6396 and 7027) — this is **not** a HuggingFace transformers model. Use `onnxruntime-web` with the WASM (CPU) backend; no GPU dependency.
>
> `modelLoader.ts`: lazy-load the `.onnx` file from `/models/plot-for-sql-25m.onnx`, instantiate via `onnxruntime-web`'s `InferenceSession.create`, and cache the raw bytes in IndexedDB so subsequent sessions hit warm cache. Load inside a Web Worker to keep the main thread responsive. Expose `getSession(): Promise<InferenceSession>` with a load-time progress event so the UI can show a tiny spinner.
>
> `ruleBased.ts`: parse the SQL with the project's SQL parser (M-A2). Inspect column types and the SELECT shape. Return an ordered list of `PlotSuggestion = { kind, encoding, confidence, why }`. Rules: 1 time + 1 numeric → `line`; 2 numeric → `scatter`; 1 categorical + 1 numeric → `bar`; 1 categorical + 1 time + 1 numeric → `line` faceted; 3+ numerics → `scatter` with color; empty / unsupported → `table`. Always include a `why` string for the audit log (M-D8).
>
> `plotForSql.ts`: orchestrate. Run the floor first; if `floor[0].confidence >= 0.7`, return the floor's output. Otherwise, run the ONNX session against a featurized prompt (SQL text + column types) and merge its suggestions with the floor (boost matching kinds, demote non-matching). If the model fails to load or throws, return the floor's output and log a non-fatal warning.
>
> `SuggestPlotButton.tsx`: render a 🪄 affordance in the SQL cell's CellHeader (M-B1's CellHeader). On click, call `plotForSql(cell.source)` and pipe the top suggestion into a `Proposal` consumed by M-D3 — the user accepts / rejects in the transcript. Slash-menu `/plot` registers a command in M-B6's registry that triggers the same flow.
>
> Tests: see Gate list. Force `onnxruntime-web` to throw in `plotForSql.test.ts` to verify graceful degradation.
>
> Acceptance: `npm run test -- localModel`, `npm run test:e2e -- localModel` pass.

---

### M-D7: Agent failure modes — rate limits, timeouts, loops, failover, token budget, cost cap

**What**: Make the agent surface resilient. A **turn-state machine** (`idle → sending → streaming → tool-use → idle | error`) per §7e.2 governs every turn. **Seven failure-mode handlers** per §7e.1: rate-limit (exponential backoff + retry), provider timeout (cancel + offer retry), tool-loop (same tool called 3+ times with same args → halt + diagnose), provider error (offer failover with **60-second unhealthy cool-off** per §7e.1 line 7271), token-budget exceeded (truncate window + warn), mid-stream interruption (clean cancel — no half-applied proposals), and **cost-cap exceeded** (refuse to send before burning tokens, surface a `kind: "cost-cap"` banner). **Tool-loop detection** per §7e.3 detects argument-identical re-invocations and halts. **Provider failover** per §7e.4 — second consecutive failure marks the provider unhealthy for 60s and offers the next configured provider (Gemini → OpenAI → Gardener → Local). **Token budget** per §7e.5 enforced per-turn; over-budget windows are pruned oldest-first (preserving system prompt + last user turn). **Cost cap** reads `$$ai_providers.<id>.costCapUsd` (M-F2) and halts before send if projected spend exceeds cap. **"What just happened?" panel** per §7e.7 surfaces an actionable diagnosis after any failure. **Refused vs failed tool calls** per §7e.8 are distinguished (refusal = permission denied; failure = tool threw); cost-cap halts are a third distinct outcome.

**Showcase**: §7e (failure modes overview), §7e.1 (six failure modes), §7e.2 (turn-state machine), §7e.3 (tool-loop detection), §7e.4 (provider failover), §7e.5 (token budget), §7e.6 (mid-stream interruption), §7e.7 (what just happened panel), §7e.8 (refused vs failed tool calls).

**Files**:
- `frontend-v2/src/services/agent/turnStateMachine.ts` (create) — explicit state machine.
- `frontend-v2/src/services/agent/loopDetector.ts` (create) — tool-loop detection.
- `frontend-v2/src/services/agent/providerFailover.ts` (create) — provider fallback policy.
- `frontend-v2/src/services/agent/tokenBudget.ts` (create) — per-turn budget + window pruning.
- `frontend-v2/src/services/agent/costCap.ts` (create) — pre-send cost projection + cap enforcement; reads `$$ai_providers.<id>.costCapUsd` from M-F2.
- `frontend-v2/src/components/agent/WhatJustHappenedPanel.tsx` (create) — actionable diagnosis surface.
- `frontend-v2/src/components/agent/FailureBanner.tsx` (create) — in-transcript banner per failure kind (rate-limit, timeout, tool-loop, provider-down, token-budget, mid-stream, cost-cap, refusal).
- `frontend-v2/src/__tests__/agent/failure/turnStateMachine.test.ts` (create).
- `frontend-v2/src/__tests__/agent/failure/loopDetector.test.ts` (create).
- `frontend-v2/src/__tests__/agent/failure/providerFailover.test.ts` (create).
- `frontend-v2/src/__tests__/agent/failure/tokenBudget.test.ts` (create).
- `frontend-v2/src/__tests__/agent/failure/costCap.test.ts` (create).
- `frontend-v2/src/__tests__/agent/failure/midStream.test.ts` (create).

**Tests**: unit | integration | e2e
- `turnStateMachine.test.ts`: every transition in §7e.2 covered; invalid transitions are rejected (e.g. you cannot go from `idle` to `streaming` without `sending`).
- `loopDetector.test.ts`: same tool name + identical input JSON called 3 times in a row → loop detected → turn halts with a `ToolLoop` error.
- `providerFailover.test.ts`: Gemini fails twice → `$$ai_providers.google.unhealthy_until_ts` set to `now + 60_000` → ModelSelector greys out Gemini with countdown tooltip → failover prompt shown → user accepts → next turn routes through OpenAI; after 60s the unhealthy flag clears on next-turn check (no timer needed); user's choice persists for the session unless reset.
- `tokenBudget.test.ts`: over-budget window pruned oldest-first; system prompt + last user turn are never pruned; user is warned in the transcript when a prune happens.
- `costCap.test.ts`: `$$ai_providers.google.costCapUsd = 5.00`, session running total = $4.85, projected turn cost $0.30 → turn halts before send with `kind: "cost-cap"` FailureBanner showing exact figures; banner offers "Raise cap" (opens ProviderConfigDialog), "Switch to local", "Abandon"; cost-cap halts log to audit with `outcome: 'cost-capped'`; tokens are NOT spent (mock provider never receives the request).
- `midStream.test.ts`: cancel mid-stream → no partial proposal applied; the in-flight tool call's result is discarded; the turn state returns to `idle`.
- Rate limit: provider returns 429 → backoff exponentially (200ms, 400ms, 800ms, ...) up to 4 attempts → on persistent 429, surface a FailureBanner.
- e2e: send a request, kill the network mid-stream, assert the transcript shows a "stream interrupted" banner with retry; click retry → completes cleanly.

**Gate**: turn-state machine transitions match §7e.2; rate-limit detected and retried with exponential backoff (max 4 attempts); tool loops detected (same tool, same args, 3+ calls → halt); provider failover works with **60s unhealthy cool-off** written to `$$ai_providers.<id>.unhealthy_until_ts`; token budget enforced per turn with oldest-first pruning; **cost cap halts pre-send** (never burns tokens — audit-logged as `cost-capped`); mid-stream cancel cleanly leaves no partial state; the "what just happened?" panel surfaces an actionable diagnosis after every failure mode; refusal, failure, and cost-cap halts are distinguished in the transcript with three icons + treatments per §7e.8.

**Blocked by**: M-D0 (provider failover policy needs the `providerRegistry` to enumerate fallback `IAiProvider` constructors and `$$ai_providers` to read the next-configured provider), M-D1 (transcript for banners and panel), M-D2 (tool registry for loop detection).

> **Agent prompt (M-D7):**
>
> Read showcase.html §7e from §7e.1 through §7e.8 in full. The six failure modes (§7e.1) and the turn-state machine (§7e.2) are the spine of this milestone — get those right and the rest is bookkeeping. §7e.3 specifies the tool-loop heuristic: same tool name + identical (canonical-JSON) arguments, ≥ 3 consecutive calls → halt the turn. §7e.4 governs failover: two consecutive provider failures of the same type trigger the failover prompt; failover is **opt-in per turn**, not automatic.
>
> `turnStateMachine.ts`: an XState-flavored explicit state machine (or hand-rolled — keep it small). States: `idle`, `sending`, `streaming`, `tool-use`, `error`. Events: `send`, `tokenReceived`, `toolCallStarted`, `toolCallResolved`, `complete`, `cancel`, `fail`. Every transition logs an entry to the audit log (M-D8).
>
> `loopDetector.ts`: maintain a per-turn ring buffer of the last N tool calls (N=4). If the last 3 entries match on `{name, canonicalJSON(input)}`, emit a `ToolLoop` error and halt the turn; surface a FailureBanner with a "this looks like a loop — here's what was repeated" diagnosis.
>
> `providerFailover.ts`: on the second consecutive failure of the active provider, mark that provider **unhealthy for 60 seconds** (per showcase §7e.1 line 7271 — write `unhealthy_until_ts = now + 60_000` into the `$$ai_providers.<id>.unhealthy_until_ts` slot from M-F2). During the cool-off, `ModelSelector` greys out the unhealthy provider with a tooltip showing remaining seconds; failover prompt offers the next configured provider (Gemini → OpenAI → Gardener → Local). After 60s the unhealthy flag clears automatically (lazy check on next turn — no timer). User's manual choice via ModelSelector takes effect at the **next turn** (in-flight turn completes on its original provider); the choice persists for the rest of the session unless reset.
>
> `tokenBudget.ts`: compute an estimated token count for the outgoing window (system + tools + history + current user turn). If over the per-turn budget (read from `$$ai_providers.<id>.tokenBudget` — default 32k for external models, 4k for local), prune oldest non-essential turns until under budget. Never prune the system prompt or the most recent user turn. Surface a transcript marker showing what was pruned.
>
> `costCap.ts`: read `$$ai_providers.<id>.costCapUsd` (from M-F2 — workspace-global per-provider). Before each turn, project the spend (input tokens × input-rate + estimated output tokens × output-rate) and add it to a session running total. If `runningTotal + projected > costCap`, halt the turn before sending; surface a FailureBanner with `kind: "cost-cap"` showing `spent: $X.XX · cap: $Y.YY · this turn would cost ~$Z.ZZ`. The banner offers three actions: raise the cap (opens ProviderConfigDialog focused on the cost-cap field), switch to local (Gemini/OpenAI/Gardener disabled until cap raised), or abandon turn. Cost-cap rejections are distinct from refusals (§7e.8) — they never reach the provider, so they don't burn tokens; audit-log them with `outcome: 'cost-capped'`.
>
> Mid-stream cancel: `cancel` event aborts any in-flight fetch (AbortController), discards partial output, returns the machine to `idle`, and never applies a partial proposal (M-D3's applier is transactional — half-streamed proposals never reach it).
>
> `WhatJustHappenedPanel.tsx`: triggered from any FailureBanner. Shows the turn's state-machine history, the last tool call (if any), the provider response (if any), and a list of suggested next actions ("Retry", "Switch provider", "Reduce window", "Inspect tool input"). §7e.7 specifies the shape — follow it.
>
> §7e.8: refusal vs failure. A refused tool call (permission denied — e.g. `run_sql` with a write in read-only scope) is a model-visible refusal with a distinct icon and treatment; a tool failure (the tool threw) is a different banner with a retry affordance.
>
> Tests: see Gate list. Each failure mode gets its own focused test; e2e covers the end-to-end mid-stream cancel.
>
> Acceptance: `npm run test -- agent/failure`, `npm run test:e2e -- agent/failure` pass.

---

### M-D8: Audit log — `last_ai_prompt` + `last_ai_session` round-trip

**What**: Provenance for every AI-touched cell and session. On every Proposal accept (from M-D3 or M-D4), write a structured `last_ai_prompt` block into the affected cell's frontmatter — including the full prompt text (with `@`-resolved expansions), the model name + version, token cost, and timestamp. At the session level, maintain a `last_ai_session` ledger per §7b.4 — an append-only log of turns (timestamp, model, prompt, tool calls, outcome) that persists in the notebook frontmatter so it survives reload. The `ContextInspector` (M-D1) reads the per-cell `last_ai_prompt` and per-session `last_ai_session` to render an `AuditLogViewer` filtered by cell.

**Showcase**: §7a (round-trip structured `last_ai_prompt`), §7b.4 (`last_ai_session` audit log), §7d.5 (frontmatter & provenance).

**Files**:
- `frontend-v2/src/services/agent/auditLog.ts` (create) — append-only session ledger + frontmatter writer.
- `frontend-v2/src/services/agent/provenanceWriter.ts` (create) — per-cell frontmatter merge.
- `frontend-v2/src/components/agent/AuditLogViewer.tsx` (create) — filter-by-cell viewer.
- `frontend-v2/src/__tests__/agent/audit/auditLog.test.ts` (create).
- `frontend-v2/src/__tests__/agent/audit/provenanceWriter.test.ts` (create).
- `frontend-v2/src/__tests__/agent/audit/roundTrip.test.ts` (create).

**Tests**: unit | integration
- `provenanceWriter.test.ts`: accepting a proposal merges `last_ai_prompt: { prompt, model, tokens, ts }` into the affected cell's frontmatter (preserving existing keys); a second accept on the same cell overwrites `last_ai_prompt` (latest wins) but the previous entry is still recorded in `last_ai_session`.
- `auditLog.test.ts`: the session ledger is append-only; each turn (success, failure, refusal — distinguished per M-D7) gets an entry; the ledger is serialized into notebook frontmatter on save and re-loaded intact on open.
- `roundTrip.test.ts`: write a notebook with N cells where K have `last_ai_prompt`, serialize via M-A5's formatter, parse via M-A1's parser, assert the structure round-trips byte-identical.
- AuditLogViewer: filter by cell → shows only that cell's history; clear filter → shows the full session ledger.

**Gate**: every accepted proposal writes `last_ai_prompt` to the affected cell's frontmatter (verified by an end-to-end test through M-D3 and M-D4); the per-session `last_ai_session` ledger persists across reloads (round-trip test passes byte-identical); `AuditLogViewer` renders both per-cell and per-session views and is reachable from the ContextInspector in M-D1.

**Blocked by**: M-D3 (proposal applier — the write hook lives where Accept fires), M-A1 (cell store and frontmatter formatter).

> **Agent prompt (M-D8):**
>
> Read showcase.html §7a (the round-trip structured `last_ai_prompt` block), §7b.4 (the `last_ai_session` ledger), and §7d.5 (frontmatter & provenance). The two records are different in scope: `last_ai_prompt` is **per cell** and holds the most recent prompt that produced the cell; `last_ai_session` is **per notebook** and is an append-only history of every turn.
>
> `provenanceWriter.ts`: `writeProvenance(cellId, prompt, model, tokens)` reads the cell's current frontmatter, merges `{ last_ai_prompt: { prompt, model, tokens, ts } }`, and writes back via M-A1's cell store. Wire this into M-D3's `proposalApplier` so every accept calls it; wire into M-D4's inline session so inline accepts call it too.
>
> `auditLog.ts`: an append-only buffer of `TurnLogEntry = { ts, model, prompt, toolCalls: [...], outcome: 'success' | 'failure' | 'refusal' }`. Serialize into notebook frontmatter (`agent.last_ai_session: [...]`) on save; restore on load. Cap the on-disk size at e.g. 200 entries (rolling window) to keep frontmatter manageable; archive older entries into a sidecar if the user opts in (Phase E territory — leave a hook).
>
> `AuditLogViewer.tsx`: rendered inside the ContextInspector (M-D1) as a tab. Default view: the full `last_ai_session` ledger, newest-first. Filter dropdown: "All cells" / "Cell N". Each entry expands to show the prompt, the tool calls (collapsed JSON), and the outcome with the M-D7 icon (success / failure / refusal).
>
> Tests: see Gate list. The round-trip test is the key one — it ensures the serialization survives the formatter (M-A5) and parser (M-A1) without drift.
>
> Acceptance: `npm run test -- agent/audit` passes.

---

## Phase E — Live Coupling

Phase E is the **flagship feature** that distinguishes this notebook from every other SQL/analysis surface. The `$x` reactive runtime ties cells together through five live-var kinds — **brush**, **hover**, **zoom**, **selection**, **scroll** — each produced by a gesture on one cell and consumed by SQL or DSL in another. The varbar surfaces all currently-bound `$x` and `$$x` values as pills with a pause-coupling button, and the `IN $alias.brush` operator drops live state directly into `WHERE` clauses. Phase E also delivers panel naming for multi-panel cells, `link-x` / `link-y` / `link-xy` axis-coordinated zoom, filter chains with saved filters and predicate push-down, shareable URLs that encode the full live state, HTML/PDF static export, recording-compare with a DIFF macro, checkpoints (auto + manual), and redaction (hash / mask) of PII columns across share / export / agent surfaces.

By the end of Phase E, a user can: brush a window on a CPU plot and watch every downstream chart re-filter in <1 frame; share a URL that reproduces their exact zoom + selection on a teammate's machine; export the notebook as a self-contained HTML report that respects column redaction; attach a baseline recording and run DIFF macros across both; and roll back to any checkpoint from the last hour of editing. All 15 milestones below are independently shippable and gated by verifiable tests.

---

### M-E1: Live-var runtime — reactive `$x` read/write

**What**: In-memory reactive store for `$x` / `$$x` values with subscriber notification, per-cell read tracking (so changes invalidate dependent cells through the M-A4 dep graph), and namespaced live-vars over the closed taxonomy `$alias.brush`, `$alias.hover`, `$alias.zoom`, `$alias.selection`, `$alias.scroll` (these five names are the entire live-var surface per §IT15.6). The store exposes `read(name) → value`, `write(name, value)`, `subscribe(name, fn)`, and an internal `usedBy(cellId) → string[]` index so the dep graph can recompute downstream cells when a live-var changes. Namespacing is by cell alias: `$a.brush` and `$b.brush` are independent values that never collide, and reads/writes always fully-qualify the name.

**Showcase**: §2 two-sigil variable system (`$x` reactive vs `$$x` global), §2 universal liveness (every `$x` is live; there is no static vs live distinction), §2 scoping by name (alias namespacing).

**Files**:
- `frontend-v2/src/services/liveVar/liveVarStore.ts` (create) — the reactive store + subscriber registry.
- `frontend-v2/src/services/liveVar/liveVarTypes.ts` (create) — `LiveVar`, `LiveVarKind` enum, value-shape unions.
- `frontend-v2/src/services/liveVar/subscriberRegistry.ts` (create) — per-name subscriber lists + notify-on-frame batching.
- `frontend-v2/src/hooks/useLiveVar.ts` (create) — React hook that subscribes a component to a named live-var and tracks the read for cell-level invalidation.
- `frontend-v2/src/__tests__/liveVar/store.test.ts` (create).
- `frontend-v2/src/__tests__/liveVar/store.property.test.ts` (create).

**Interfaces**: `LiveVar`, `LiveVarKind`, `LiveRangeValue`, `LiveHoverValue`, `LiveZoomValue`, `LiveSelectionValue`, `LiveScrollValue` (all from REDESIGN_INTERFACES.md).

**Tests**: unit | property | integration
- `store.test.ts`: write `$a.brush = {x: [0, 100]}` → `read('$a.brush')` returns the same value; subscribe → write fires the subscriber within one animation frame; unsubscribe stops notifications; `$a.brush` and `$b.brush` are independent.
- `store.property.test.ts`: fast-check property — for any sequence of writes to N namespaced vars, each subscriber sees only the writes for its own var; concurrent writes within a frame coalesce to a single notification per name.
- integration: a change to `$cell-3.brush` invalidates only cells whose `usedBy` index references `$cell-3.brush`, not unrelated cells (verified through M-A4's dep graph).

**Gate**: read/write reactive within frame; subscribers notified per name; property test passes 1000+ iterations; namespacing isolates (`$a.brush` ≠ `$b.brush`); useLiveVar tracks reads for downstream cell invalidation through the M-A4 dep graph.

**Blocked by**: M-A4 (dep graph — live-var reads register as edges in the graph).

> **Agent prompt (M-E1):**
>
> Read showcase.html §2 in full — the two-sigil variable system is the foundation of Phase E. `$x` is **reactive and live** (every change re-runs dependents); `$$x` is a **global constant** (set once, never re-runs). There is no static-vs-live mode switch; every `$x` is live by definition. Read REDESIGN_INTERFACES.md for the `LiveVar`, `LiveVarKind`, `LiveRangeValue`, `LiveHoverValue`, `LiveZoomValue`, `LiveSelectionValue`, and `LiveScrollValue` types.
>
> `liveVarStore.ts`: in-memory `Map<string, LiveVar>`. The key is the fully-qualified name (`'$a.brush'`, `'$b.hover'`, `'$c.zoom'`, `'$d.selection'`, `'$e.scroll'`) — never bare `'brush'`. Writes go through a frame-batched notifier (requestAnimationFrame) so a burst of writes within one frame coalesces into one subscriber notification per name.
>
> `subscriberRegistry.ts`: `Map<string, Set<(value) => void>>` keyed by fully-qualified name. The `useLiveVar` hook registers cleanup on unmount and also reports the read to a per-cell tracker so M-A4's dep graph can encode the dependency. When a live-var changes, the registry calls back into the dep graph to mark dependents stale.
>
> Tests: see Gate list. The property test is the key one — it catches subtle cross-namespace bleed.
>
> Acceptance: `npm run test -- liveVar/store`, `npm run test -- liveVar/store.property` pass.

---

### M-E2: Brush producer/consumer + `IN $alias.brush` operator

**What**: Brush gesture on line / scatter / area / heatmap plots writes a `LiveRangeValue` to `$cell.brush` (the producer half); SQL extends with a new `IN $alias.brush` operator (the consumer half) that expands at parse time to `WHERE col BETWEEN $alias.brush.x.lo AND $alias.brush.x.hi` (and y-axis form similarly). Iter-15 §IT15.1 introduces the axis-explicit form `$alias.brush.x` so multi-axis consumers can target a single axis. A `brushColumnMismatch` diagnostic emits a **soft warning** (not an error) when the consumer's filter column doesn't match the producer's brushed axis — the SQL still runs, but the user is nudged to confirm intent.

**Showcase**: §5 live coupling, §5.2 `IN $producer.live-var` operator, §9.6 live-var SQL operators.

**Files**:
- `frontend-v2/src/components/plots/gestures/BrushGesture.ts` (create) — D3-brush wrapper that emits LiveRangeValue.
- `frontend-v2/src/services/liveVar/brushProducer.ts` (create) — turns gesture events into store writes.
- `frontend-v2/src/services/parser/sqlInOperator.ts` (create) — extends the M-A2 SQL parser with `IN $alias.brush[.x|.y]`.
- `frontend-v2/src/services/diagnostics/brushColumnMismatch.ts` (create) — soft-warning emitter on column/axis mismatch.
- `frontend-v2/src/__tests__/liveVar/brush.test.ts` (create).
- `frontend-v2/src/__tests__/parser/inBrush.test.ts` (create).

**Tests**: unit | integration | e2e
- `brush.test.ts`: drag-brush on a line chart emits `LiveRangeValue { x: [t0, t1] }` to `$cell.brush`; releasing the brush keeps the value; clicking outside the brush clears it.
- `inBrush.test.ts`: parser accepts `WHERE ts IN $a.brush` and expands to `WHERE ts BETWEEN $a.brush.x.lo AND $a.brush.x.hi`; explicit `$a.brush.x` and `$a.brush.y` forms parse; misspelled `$a.brsh` errors with a Did-You-Mean diagnostic.
- `brushColumnMismatch`: producer brushes `ts` (x-axis) but consumer filters on `cpu_pct` → soft-warning emitted, not error, query still runs.
- e2e: open notebook with a line chart over `ts`, brush a 1-hour window, watch a downstream `SELECT * FROM jfr WHERE ts IN $line.brush` cell re-run with the brushed range.

**Gate**: brush gesture writes `$cell.brush` per drag; `IN $alias.brush` operator parses and runs against the brushed range; explicit `$a.brush.x` axis form parses; column-mismatch produces a soft warning (not error) — SQL still executes.

**Blocked by**: M-E1 (store), M-C2 (line/area/scatter renderers — needed to attach the brush gesture).

> **Agent prompt (M-E2):**
>
> Read showcase.html §5 (live coupling overview), §5.2 (the `IN $producer.live-var` operator — note the axis-explicit `$a.brush.x` form per iter-15 §IT15.1), and §9.6 (the full set of live-var SQL operators). The brush half is the producer; the SQL operator is the consumer; the two meet through M-E1's store.
>
> `BrushGesture.ts`: wrap d3-brush. Emit `{x: [lo, hi]}` or `{x: [lo, hi], y: [lo, hi]}` depending on plot type. Debounce at 16ms (one frame) so a rapid drag doesn't flood the store.
>
> `brushProducer.ts`: receives gesture events from BrushGesture, packages as `LiveRangeValue`, writes to `$<cellAlias>.brush` via M-E1's store. The cell alias comes from the cell's frontmatter `alias:` field; if absent, use the cell id.
>
> `sqlInOperator.ts`: extend M-A2's parser. When tokenizer sees `IN $alias.brush`, it rewrites to `BETWEEN $alias.brush.x.lo AND $alias.brush.x.hi` at parse time. Explicit `$alias.brush.x` / `.brush.y` selects the axis. The expanded form is then evaluated by DuckDB with parameter binding.
>
> `brushColumnMismatch.ts`: post-parse pass — if the filter column's name doesn't match the producer's x or y axis label (heuristic on column metadata), emit a `SoftWarning` to the issues panel (M-B5) with a "Did you mean…?" suggestion. The query still runs.
>
> Tests: see Gate list. The e2e test is the load-bearing one — it proves the producer/consumer loop closes.
>
> Acceptance: `npm run test -- liveVar/brush`, `npm run test -- parser/inBrush`, `npm run test:e2e -- liveVar/brush` pass.

---

### M-E3: Hover producer/consumer + categorical hover for pie/flamegraph

**What**: Hover semantics per iter-15 §IT15.2 — `mousemove` (debounced 30ms) writes the current point as `LiveHoverValue` to `$cell.hover`; `mouseleave` clears the value after a 300ms debounce so quick hops between adjacent plots don't flicker; the per-plot-type hover shape varies across the canonical 12 plot types (axes-tuple for line/scatter/area, axes-minus-y for bar/histogram, category-only for boxplot, both axes for heatmap, value+category for pie/flamegraph, full-row object for table, x+lane for gantt, x-only for range). The categorical form is critical for non-axial plots — a pie wedge writes `{ value, category: 'GC' }`, a flamegraph stack-frame writes `{ value, category: 'java.util.HashMap.get' }`.

**Showcase**: §5 live coupling, §5.3 hover semantics (per-plot-type shapes + debounce timings).

**Files**:
- `frontend-v2/src/components/plots/gestures/HoverGesture.ts` (create) — pointer-event wrapper with debounce.
- `frontend-v2/src/services/liveVar/hoverProducer.ts` (create) — packages hover events as LiveHoverValue.
- `frontend-v2/src/__tests__/liveVar/hover.test.ts` (create).

**Tests**: unit | integration | e2e
- `hover.test.ts`: mousemove on line chart debounces at 30ms (rapid moves coalesce to one write per frame); mouseleave triggers a 300ms timer that clears `$cell.hover` (cancelled if pointer re-enters within 300ms).
- per-plot shape (canonical 12 per showcase §IT15.2): line/scatter/area write `{ axes: { x: {column, value}, y: {column, value} } }`; bar/histogram write `{ axes: { x: {column, value: barCategory} } }` (no y — height is the aggregate); boxplot writes `{ axes: { category: {column, value: catName} } }`; heatmap writes `{ axes: { x, y } }`; pie/flamegraph write `{ value, category }` (no axis system); table writes `{ axes: {}, row: <object> }`; gantt writes `{ axes: { x: {column, value}, lane: {column, value} } }`; range writes `{ axes: { x: {column, value} } }`.
- integration: hover on pie wedge → downstream `WHERE category = $pie.hover.category` cell re-runs with the hovered category.
- e2e: hover sequence across two adjacent line charts → assert no flicker on the 300ms cooldown.

**Gate**: 30ms mousemove debounce; 300ms mouseleave clear-debounce; per-plot-type hover shape correct across the canonical 12 (line/scatter/area axes, bar/histogram axes-minus-y, boxplot category-only, heatmap x+y, pie/flamegraph value+category, table full row, gantt x+lane, range x-only); consuming `WHERE category = $pie.hover.category` works.

**Blocked by**: M-E1 (store), M-C2 (line/scatter/area), M-C3 (bar/pie), M-C4 (flamegraph).

> **Agent prompt (M-E3):**
>
> Read showcase.html §5 and §5.3 carefully — the per-plot-type hover shapes are load-bearing and tested per shape. Iter-15 §IT15.2 defines the 30ms mousemove debounce and the 300ms mouseleave debounce — these are exact, not approximate.
>
> `HoverGesture.ts`: wire `pointermove` and `pointerleave` listeners on each plot's interactive layer. Use a single shared rAF debouncer for mousemove (30ms) and a setTimeout for mouseleave (300ms) that's cancelled by a subsequent `pointerenter`.
>
> `hoverProducer.ts`: receives hover events and constructs the per-plot-type shape. The plot type is passed in at gesture-init time — one of the canonical 12: `line`, `bar`, `scatter`, `histogram`, `boxplot`, `heatmap`, `pie`, `flamegraph`, `table`, `gantt`, `area`, `range`. Per showcase §IT15.2 the shapes are:
>
> - **line / scatter / area**: `{ axes: { x: {column, value}, y: {column, value} } }` on mousemove (30ms debounce).
> - **bar / histogram**: `{ axes: { x: {column, value: barCategory} } }` (y omitted; the bar's height is the aggregate).
> - **boxplot**: `{ axes: { category: {column, value: catName} } }`.
> - **heatmap**: `{ axes: { x: {column, value}, y: {column, value} } }`.
> - **pie / flamegraph**: `{ value, category }` (no axis system — categorical, the hovered wedge/frame is translated to a category key by looking up the bound data).
> - **table**: `{ axes: {}, row: <object> }`.
> - **gantt**: `{ axes: { x: {column, value}, lane: {column, value} } }`.
> - **range**: `{ axes: { x: {column, value} } }`.
>
> Tests: see Gate list. Test each plot type's hover shape separately — the matrix is non-trivial.
>
> Acceptance: `npm run test -- liveVar/hover`, `npm run test:e2e -- liveVar/hover` pass.

---

### M-E4: Zoom producer/consumer + `$alias.zoom` master/clamp

**What**: Pan/zoom gesture on line / scatter / area / heatmap writes a `LiveZoomValue { x: [lo, hi], y: [lo, hi] }` to `$cell.zoom`; the `IN $alias.zoom` SQL operator filters by the visible window (same shape as brush but driven by zoom rather than drag); master/clamp semantics per §5.6 — when a plot is declared as a zoom master (or implicitly via being the user's most-recent zoom interaction), linked plots clamp their visible domain to the master's window rather than re-zooming independently. This avoids feedback loops on linked zoom.

**Showcase**: §5 live coupling, §5.6 linked zoom (deep dive — master/clamp), §5.7 filter_from chip.

**Files**:
- `frontend-v2/src/components/plots/gestures/ZoomGesture.ts` (create) — d3-zoom wrapper.
- `frontend-v2/src/services/liveVar/zoomProducer.ts` (create) — writes LiveZoomValue.
- `frontend-v2/src/services/liveVar/zoomMasterClamp.ts` (create) — master detection + clamp logic for linked plots.
- `frontend-v2/src/__tests__/liveVar/zoom.test.ts` (create).

**Tests**: unit | integration | e2e
- `zoom.test.ts`: scroll-wheel zoom writes `LiveZoomValue` to `$cell.zoom`; double-click resets the zoom; pan with drag updates `.x` only when no y-pan is allowed.
- `zoomMasterClamp.test.ts`: with two link-x-linked plots A and B, zooming A updates A's `$.zoom` and clamps B's rendered domain to A's window without writing to B's `$.zoom`; subsequent zoom on B promotes B to master.
- integration: `WHERE ts IN $cell.zoom` filters by the visible window.
- e2e: zoom on plot A, watch plot B (link-x-linked) clamp; zoom plot B, watch master flip.

**Gate**: zoom writes `$cell.zoom` per gesture; master plot drives clamp on link-x-linked plots without feedback loops; `IN $alias.zoom` operator filters by visible window.

**Blocked by**: M-E1 (store), M-C2 (line/area/scatter renderers).

> **Agent prompt (M-E4):**
>
> Read showcase.html §5.6 — the master/clamp semantics are the subtle part. Naive linked-zoom feedback-loops; the master/clamp design avoids that by making **one** plot at a time the source-of-truth and the others read-only followers until the user interacts with one of them, promoting it to master.
>
> `ZoomGesture.ts`: d3-zoom wrapper with scroll-zoom + drag-pan + double-click-reset. Debounce at 16ms.
>
> `zoomProducer.ts`: write `LiveZoomValue` to `$<alias>.zoom`. Include both `.x` and `.y` axes; consumers pick the axis they need.
>
> `zoomMasterClamp.ts`: track the most-recently-zoomed plot per link-group (M-E9 defines link-groups; for M-E4, accept the group id as a constructor arg). When a non-master receives a `$.zoom` change from the master, render with clamped domain but do **not** write to its own `$.zoom`. When the user interacts with a follower, it becomes master and the previous master becomes follower.
>
> Tests: see Gate list. The feedback-loop avoidance is the critical test — assert that A → B → A does not happen.
>
> Acceptance: `npm run test -- liveVar/zoom`, `npm run test:e2e -- liveVar/zoom` pass.

---

### M-E5: Selection producer — row selection on table + multi-select

**What**: Click-select rows in the result table writes a `LiveSelectionValue` (a set of row primary keys, or key-value tuples for compound keys) to `$cell.selection`. Standard selection patterns — plain click replaces the selection, shift-click extends to a contiguous range, cmd-click (ctrl on Windows/Linux) toggles a single row. Selection persists across re-renders (so a filter change that drops a selected row removes that row from the selection but keeps the others). Consumed via `WHERE pk IN $cell.selection`.

**Showcase**: §5 live coupling, §4a result tables row interactions.

**Files**:
- `frontend-v2/src/components/results/RowSelection.ts` (create) — selection state machine + keyboard shortcuts.
- `frontend-v2/src/services/liveVar/selectionProducer.ts` (create) — emits LiveSelectionValue to the store.
- `frontend-v2/src/__tests__/liveVar/selection.test.ts` (create).

**Tests**: unit | integration | e2e
- selection state: click row 3 → selection = {3}; shift-click row 7 → selection = {3,4,5,6,7}; cmd-click row 5 → selection = {3,4,6,7}; click row 9 (no modifier) → selection = {9}.
- persistence: rerender after filter drops row 4 → selection = {3,6,7} (4 removed, others preserved).
- integration: `WHERE pk IN $table.selection` filters to selected rows in a downstream cell.
- e2e: select 3 rows in a table, watch a downstream plot filter to those 3 rows' data.

**Gate**: click/shift-click/cmd-click work; selection persists across re-renders (dropped rows removed, others kept); `IN $cell.selection` filters by selected rows.

**Blocked by**: M-E1 (store), M-C8 (result table renderer).

> **Agent prompt (M-E5):**
>
> Read showcase.html §5 (live coupling) and §4a (result tables — the row interactions are the specification for what gestures map to what selection state changes).
>
> `RowSelection.ts`: a state machine over `Set<RowKey>` with `click(key)`, `shiftClick(key)`, `cmdClick(key)`, `clear()` methods. `shiftClick` needs to know the most-recently-clicked anchor to compute the range; track it internally.
>
> `selectionProducer.ts`: serialize the `Set` to a `LiveSelectionValue` (array of row keys or key-value tuples) and write to `$<alias>.selection`. Re-write on every selection change.
>
> Persistence on re-render: when the result table re-renders with new rows (e.g. after filter change), intersect the current selection with the new row-key set; drop missing keys.
>
> Tests: see Gate list. The persistence test is the subtle one — common bug source.
>
> Acceptance: `npm run test -- liveVar/selection`, `npm run test:e2e -- liveVar/selection` pass.

---

### M-E6: Scroll producer — synced scroll across plots

**What**: Scroll position on a plot's viewport is written as `LiveScrollValue { top: number, left: number }` to `$cell.scroll`; a `link-scroll` clause on plots subscribes them to a shared scroll group so scrolling one synchronizes the rest. Especially useful for long flamegraphs and wide tables. Debounced to avoid feedback loops (16ms — one frame).

**Showcase**: §5 live coupling, §5.1 five built-in live-var kinds (brush / hover / zoom / selection / **scroll**).

**Files**:
- `frontend-v2/src/components/plots/gestures/ScrollGesture.ts` (create) — listens to viewport scroll events.
- `frontend-v2/src/services/liveVar/scrollProducer.ts` (create) — writes LiveScrollValue.
- `frontend-v2/src/__tests__/liveVar/scroll.test.ts` (create).

**Tests**: unit | integration | e2e
- `scroll.test.ts`: scroll the viewport → `$cell.scroll = {top, left}` updates; debounced at 16ms.
- linked-scroll: two plots in the same `link-scroll` group → scrolling one moves the other; no feedback loop (B's scroll-from-sync does not write to its own `$.scroll`).
- e2e: long flamegraph + corresponding source list with link-scroll → scrolling the flamegraph scrolls the list in lock-step.

**Gate**: scroll writes `$cell.scroll`; linked plots scroll-sync via `link-scroll` group; 16ms debounce; no feedback loop.

**Blocked by**: M-E1 (store).

> **Agent prompt (M-E6):**
>
> Read showcase.html §5 and §5.1 — scroll is the fifth live-var kind alongside brush / hover / zoom / selection. The use case is long content (flamegraphs, tables): the user wants to keep correlated views aligned without manually scrolling each one.
>
> `ScrollGesture.ts`: attach a scroll listener to the plot's outer viewport `div`. Debounce at 16ms with rAF.
>
> `scrollProducer.ts`: write `{top, left}` to `$<alias>.scroll`. On receiving a scroll-from-sync update (i.e. the plot is in a link-scroll group and another member scrolled), set the viewport's `scrollTop` / `scrollLeft` without writing back to the store — use a flag (`isProgrammaticScroll`) that the gesture listener checks to skip the producer write.
>
> Tests: see Gate list. The no-feedback-loop test is essential.
>
> Acceptance: `npm run test -- liveVar/scroll`, `npm run test:e2e -- liveVar/scroll` pass.

---

### M-E7: Varbar UI — live-var pills + pause-coupling button + variable inspector

**What**: A top-of-notebook varbar shows all currently-bound `$x` and `$$x` values as pills (alias + kind + abbreviated value). A **pause-coupling button** stops live-var propagation while keeping current values readable (frozen) — downstream cells see the last value but no new writes invalidate them. Clicking a pill opens a **variable inspector popover** showing the current value (full, not abbreviated), the producer cell, the list of consumer cells (from the M-A4 dep graph), and an edit affordance for `$x` and `$$x` per §2.5. A separate `filter_from` chip authoring popover per §2.8 lets users build saved filters from a producer cell.

**Showcase**: §2.5 variable pills, §2.7 `$` variable popover, §2.8 filter_from chip authoring popover, §5.5 pause/resume coupling, §5.7 filter_from chip.

**Files**:
- `frontend-v2/src/components/varbar/Varbar.tsx` (create) — host container.
- `frontend-v2/src/components/varbar/VarPill.tsx` (create) — individual pill.
- `frontend-v2/src/components/varbar/VarInspector.tsx` (create) — popover with full value + producer + consumers + edit.
- `frontend-v2/src/components/varbar/PauseCouplingButton.tsx` (create) — pause/resume toggle.
- `frontend-v2/src/components/varbar/FilterFromChip.tsx` (create) — saved-filter authoring popover.
- `frontend-v2/src/__tests__/varbar/varbar.test.tsx` (create).
- `frontend-v2/src/__tests__/varbar/varInspector.test.tsx` (create).
- `frontend-v2/src/__tests__/varbar/pauseCoupling.test.tsx` (create).

**Tests**: unit | a11y | e2e
- `varbar.test.tsx`: all currently-bound `$x` and `$$x` render as pills with `alias.kind` labels; new bind adds a pill; unbind removes it.
- `varInspector.test.tsx`: clicking a pill opens a popover with the full value (JSON pretty-printed), the producer cell id (link to scroll-to-cell), the consumer list from the M-A4 dep graph, and an edit field for `$x` / `$$x`.
- `pauseCoupling.test.tsx`: clicking pause stops propagation — writes to live-vars do not invalidate downstream cells until resume.
- a11y: pills are buttons with aria-labels; popover is `role="dialog" aria-modal="false"` (non-modal); pause button has `aria-pressed`; focus ring per §10a.1.
- e2e: brush a plot → see `$cell.brush` pill appear → click pause → re-brush → assert downstream cell did not re-run → click resume → assert downstream re-runs immediately.

**Gate**: all bound vars displayed; pause halts propagation; inspector shows full value + producer + consumers; edit affordance updates value; a11y conformant.

**Blocked by**: M-E1 (store), M-A4 (dep graph — for the consumer list).

> **Agent prompt (M-E7):**
>
> Read showcase.html §2.5 (variable pills), §2.7 (the `$` variable popover), §2.8 (filter_from chip authoring popover), §5.5 (pause/resume coupling), §5.7 (filter_from chip). The varbar is the UI manifestation of M-E1's store — every bound name shows up as a pill in real time.
>
> `Varbar.tsx`: subscribe to the store's "bound names" set (a `Set<string>` derived from the store's keys). Render each as a `VarPill`. Place the pause-coupling button at the right edge.
>
> `VarPill.tsx`: button with the alias + kind (e.g. "cell-3.brush") and a small value preview (truncated JSON). Click opens `VarInspector`.
>
> `VarInspector.tsx`: popover with three panels — Value (full pretty-printed JSON), Producer (cell id + jump-to-cell button), Consumers (list from M-A4's dep graph, each a jump-to-cell button). Edit affordance: a JSON editor for the value with Save / Cancel. Save writes back through the store.
>
> `PauseCouplingButton.tsx`: toggles a `paused: boolean` flag on the M-E1 store. While paused, writes still update the value but the subscriber-notify step is suppressed; on resume, the notify fires once with the latest value.
>
> `FilterFromChip.tsx`: per §2.8 — a popover for building saved filters from a producer cell. Defers to M-E10 for the saved-filter store; M-E7 just wires the UI.
>
> Tests: see Gate list. Run axe-core for a11y per §10a.1.
>
> Acceptance: `npm run test -- varbar`, `npm run test:a11y -- varbar`, `npm run test:e2e -- varbar` pass.

---

### M-E8: Panel naming within cells (`name:` clause, `$alias.<panel>.brush`)

**What**: A cell with multiple plot panels (via `row{}` / `col{}` composition from M-C9) needs stable references when an external consumer wants to brush-from one panel but not another. The `name:` clause on a panel per iter-15 §IT15.3 introduces a stable identifier — implicit positional (`$alias.0.brush`, `$alias.1.brush`) is always available, and explicit named (`$alias.gc.brush`) is preferred for readability. The formatter (M-A5) auto-injects `name:` when the cell has multiple producers of the same live-var kind and the user references one by position. The dep graph (M-A4) surfaces panel sub-nodes when a cell has multiple producers.

**Showcase**: §5.4 panel `name:` clause.

**Files**:
- `frontend-v2/src/services/liveVar/panelAddressing.ts` (create) — resolves `$alias.<panel>.<kind>` to an actual producer.
- `frontend-v2/src/services/parser/plotDslParser.ts` (modify — extend M-A3) — accept `name:` clause inside `row{}` / `col{}` panels.
- `frontend-v2/src/services/depGraph/panelSubNodes.ts` (create) — augments dep graph nodes with sub-nodes per panel.
- `frontend-v2/src/__tests__/liveVar/panelAddressing.test.ts` (create).
- `frontend-v2/src/__tests__/parser/panelName.test.ts` (create).

**Tests**: unit | integration
- positional: `row { line {...}; line {...} }` exposes `$cell.0.brush` and `$cell.1.brush`.
- named: `row { line { name: gc; ... }; line { name: cpu; ... } }` exposes `$cell.gc.brush` and `$cell.cpu.brush`.
- formatter auto-inject: a cell with two `line` panels referenced as `$cell.0` / `$cell.1` and edited to add a third panel triggers the formatter to inject `name:` clauses with stable names.
- dep graph: a two-panel cell shows two sub-nodes in the M-A4 dep graph view.

**Gate**: `$alias.0.brush` positional works; `$alias.gc.brush` named works; formatter auto-injects `name:` when ambiguity exists; dep graph shows sub-nodes for multi-panel cells.

**Blocked by**: M-E1, M-A3 (plot DSL parser), M-A4 (dep graph), M-A5 (formatter — for auto-inject).

> **Agent prompt (M-E8):**
>
> Read showcase.html §5.4 — the `name:` clause is the only addressing scheme for multi-panel cells. Iter-15 §IT15.3 introduces it; without it, `$cell.brush` is ambiguous when a cell has multiple brush-producing panels.
>
> `panelAddressing.ts`: given a producer reference `$<alias>.<panel>.<kind>`, resolve `<panel>` to either a position (digit) or a name (identifier), then look up the corresponding plot panel and return its live-var binding.
>
> Extend `plotDslParser.ts` (M-A3): accept an optional `name: <ident>` clause as the first statement inside a `row{}` / `col{}` child block. Reject duplicate names within a parent (parser-level error).
>
> `panelSubNodes.ts`: for each cell, if it has >1 panel producing live-vars of the same kind, emit sub-nodes in the dep graph (one per panel) so the M-A4 graph viewer can render them.
>
> Formatter integration (M-A5): when serializing a cell with multiple panels, if any panel is referenced positionally but a sibling has the same kind, inject `name:` clauses based on the bound data (e.g. y-axis label slugged).
>
> Tests: see Gate list. The formatter auto-inject test is the integration-level check.
>
> Acceptance: `npm run test -- liveVar/panelAddressing`, `npm run test -- parser/panelName` pass.

---

### M-E9: Linked zoom — `link-x`, `link-y`, `link-xy` clauses

**What**: `link-x: <group>`, `link-y: <group>`, `link-xy: <group>` clauses on plots create synchronized-domain groups. Plots in the same group share their respective axis domains — when one zooms or pans, the others clamp to the same window via M-E4's master/clamp mechanism. `link-xy` covers both axes. Reciprocal updates do not loop (the master/clamp + producer-skip flag from M-E4 handle that).

**Showcase**: §5.6 linked zoom (deep dive).

**Files**:
- `frontend-v2/src/services/liveVar/linkGroups.ts` (create) — link-group registry keyed by group name.
- `frontend-v2/src/services/liveVar/linkPropagator.ts` (create) — propagates a master's zoom to followers.
- `frontend-v2/src/__tests__/liveVar/linkGroups.test.ts` (create).

**Tests**: unit | integration | e2e
- `linkGroups.test.ts`: declaring `link-x: cpu-group` on two plots adds them to the registry; declaring `link-y: cpu-group` adds them to the y-link-group separately.
- propagation: zooming master in a link-x group writes the x-domain to followers; followers' y-domain is untouched.
- no-loop: rapid alternating zooms between two members do not cause more than one update per frame per plot.
- e2e: three plots all `link-x: t`; zoom plot 1, watch plots 2 and 3 clamp; zoom plot 2, watch plot 1 and 3 clamp; verify no infinite loop.

**Gate**: `link-x` synchronizes x-domain; `link-y` synchronizes y-domain; `link-xy` both; reciprocal updates don't loop (debounce + master/clamp).

**Blocked by**: M-E4 (zoom producer + master/clamp).

> **Agent prompt (M-E9):**
>
> Read showcase.html §5.6 — the deep dive on linked zoom. The grouping is by name: plots that share `link-x: <name>` are in the same x-axis link group. M-E4's master/clamp prevents feedback loops; M-E9 is the multi-plot generalization.
>
> `linkGroups.ts`: a registry of `Map<groupName, Set<plotId>>`, one map per axis kind (x / y). On plot mount, register; on unmount, deregister.
>
> `linkPropagator.ts`: when a plot in a group becomes master and writes its zoom, propagate the relevant axis to followers via M-E4's clamp path. Each follower renders with the clamped domain but does not write to its own `$.zoom`.
>
> `link-xy` is sugar for declaring both `link-x: <name>` and `link-y: <name>` with the same group name.
>
> Tests: see Gate list. The no-loop test is essential — rapid alternation should converge.
>
> Acceptance: `npm run test -- liveVar/linkGroups`, `npm run test:e2e -- liveVar/linkGroups` pass.

---

### M-E10: Chains, saved filters, stale propagation, promote-to-view

**What**: A `filter_from:` chip per §5.7 creates a **saved filter** that survives reload (persisted to notebook frontmatter); the chip indicator "🔗 N from #X via #Y" per §5a.2 shows the chain depth; stale propagation per §5a.3 marks downstream cells stale when a chain ancestor's live-var changes (without immediately re-running them); promote-to-view per §5a.4 + §7.3 extracts a chain's SQL + filter into a named `view <name>` fence (a first-class view in the sidebar); predicate push-down per §5a.5 + plan §8.4 measurably speeds up multi-hop chains by inlining the `WHERE ... IN $...` clauses at SQL plan time rather than via DuckDB's general execution.

**Showcase**: §5.7 filter_from chip, §5a chains composition saved filters, §5a.1 through §5a.6 (all subsections).

**Files**:
- `frontend-v2/src/services/liveVar/savedFilters.ts` (create) — persisted filter store.
- `frontend-v2/src/components/varbar/ChainIndicator.tsx` (create) — "🔗 N from #X via #Y" badge.
- `frontend-v2/src/services/liveVar/stalePropagator.ts` (create) — stale-mark downstream cells on chain change.
- `frontend-v2/src/services/views/promoteToView.ts` (create) — extract chain to a named view.
- `frontend-v2/src/services/sql/predicatePushDown.ts` (create) — SQL-level push-down for chained filters.
- `frontend-v2/src/__tests__/liveVar/savedFilters.test.ts` (create).
- `frontend-v2/src/__tests__/sql/predicatePushDown.test.ts` (create).

**Tests**: unit | integration | e2e
- `savedFilters.test.ts`: create a filter_from chip → reload notebook → chip and its filter are restored byte-identical.
- `ChainIndicator`: a cell that consumes `$a.brush` which itself depends on `$b.brush` renders "🔗 2 from #b via #a".
- `stalePropagator`: change to `$b.brush` marks the chain's downstream cells as stale (gray ring indicator) without re-running them until the user clicks Run or auto-run fires.
- `promoteToView`: a chain `WHERE id IN $a.selection AND ts IN $b.brush` promoted to view emits a `view filtered_traces` fence with the inlined SQL.
- `predicatePushDown.test.ts`: a 5-hop chain runs ≥2× faster with push-down than without (measure on a 1M-row table).
- e2e: build a 3-hop chain → reload → chain restored → change root brush → downstream cells flash stale → click Run-All → push-down kicks in → measure perf.

**Gate**: filter_from chip persists across reload; chain indicator counts hops correctly; stale propagation marks downstream cells without auto-running them; promote-to-view extracts SQL + filter into a named view fence; predicate push-down measurably faster on 5-hop chain.

**Blocked by**: M-E2 (brush producer), M-A4 (dep graph — chain traversal).

> **Agent prompt (M-E10):**
>
> Read showcase.html §5.7 (filter_from chip) and §5a in full (sections 5a.1 through 5a.6 — chains, saved filters, stale propagation, promote-to-view, push-down, why). Also re-read REDESIGN_PLAN.md §8.4 for the push-down spec.
>
> `savedFilters.ts`: persist chips to notebook frontmatter (`liveVar.savedFilters: [{ id, name, sourceCell, expr, ... }]`). Restore on load.
>
> `ChainIndicator.tsx`: traverse the M-A4 dep graph from the consumer back to roots, count hops, render "🔗 N from #X via #Y". X = root, Y = direct predecessor.
>
> `stalePropagator.ts`: subscribe to live-var changes; for each change, walk the dep graph forward; mark each downstream cell as `stale: true`. The cell renders with a gray ring; Run-All / auto-run clears the flag.
>
> `promoteToView.ts`: given a chain (sequence of cells with chained filters), emit a synthesized `view <name>` fence that inlines the chain's filter predicates. Insert as a new cell above the chain root.
>
> `predicatePushDown.ts`: before passing SQL to DuckDB, inspect the AST (M-A2); if the query references `$x.brush` / `$x.zoom` / `$x.selection`, inline the predicate as `WHERE <col> BETWEEN <lo> AND <hi>` at plan time so DuckDB's optimizer can use indexes. Bench on a 1M-row table.
>
> Tests: see Gate list. The perf test is the most important — chains without push-down are unusable past 3 hops.
>
> Acceptance: `npm run test -- liveVar/savedFilters`, `npm run test -- sql/predicatePushDown`, `npm run test:e2e -- liveVar/chains` pass.

---

### M-E11: Shareable URLs — encode live state + size cap + sidecar fallback

**What**: A "Copy share link" affordance encodes the current notebook live-var state into the URL fragment per iter-15 §IT15.4 + iter-16 §IT16.4 — base64url-encoded JSON for compactness with a shorter named form for common ranges (`?b=cell-3:ts:1000..2000`). Per iter-17 §IT17.12, `$$x` globals are **not** encoded (they're constants the recipient may want to set independently). A size cap (~2KB URL budget) triggers a sidecar fallback per §10.size-cap — large state is stored in a sidecar file (JSON) referenced by a short token in the URL. The Copy share-link modal per §10.4 lets the user choose what to include (live-vars only, or also checkpoints / open chat / etc.). The recipient view per §10.5 opens the URL → decodes the state → restores live-vars → re-runs cells with the restored state.

**Showcase**: §10 shareable URLs (full chapter), §10 encoding, §10 `$$x` not encoded, §10 size cap, §10.4 copy share-link modal, §10.5 recipient view.

**Files**:
- `frontend-v2/src/services/sharing/urlEncoder.ts` (create) — encode live state to URL fragment.
- `frontend-v2/src/services/sharing/urlDecoder.ts` (create) — decode + validate.
- `frontend-v2/src/services/sharing/sidecarFallback.ts` (create) — sidecar JSON file + short-token reference.
- `frontend-v2/src/components/sharing/ShareLinkModal.tsx` (create) — Copy share-link modal.
- `frontend-v2/src/components/sharing/RecipientView.tsx` (create) — first-render hook that restores state.
- `frontend-v2/src/__tests__/sharing/encoder.test.ts` (create).
- `frontend-v2/src/__tests__/sharing/decoder.test.ts` (create).
- `frontend-v2/src/__tests__/sharing/roundTrip.property.test.ts` (create).

**Tests**: unit | property | integration | e2e
- `encoder.test.ts`: encode a known live-var snapshot → assert URL length < 2KB → assert base64url-decodes to the original JSON.
- `decoder.test.ts`: handle truncated, corrupt, or unknown-version fragments with a friendly error (do not crash); ignore `$$x` if present in the fragment (defensive).
- `roundTrip.property.test.ts`: fast-check property — for any LiveRangeValue / LiveZoomValue / LiveHoverValue / LiveSelectionValue / LiveScrollValue snapshot, encode → decode → equals original.
- size cap: encode a state that exceeds 2KB → falls back to sidecar (write sidecar JSON, embed short token in URL).
- `$$x` exclusion: a notebook with both `$x` and `$$x` values → only `$x` appears in the URL.
- e2e: brush a plot → click Copy share-link → assert clipboard contains URL → open URL in new tab → assert brush restored → downstream cells re-ran with restored state.

**Gate**: encode/decode round-trips preserve state; URL fragment < 2KB or falls back to sidecar; `$$x` excluded; recipient opens URL → live-vars restored → cells re-run with restored state.

**Blocked by**: M-E1 (store — source of state to encode).

> **Agent prompt (M-E11):**
>
> Read showcase.html §10 in full — the shareable-URL chapter. Iter-15 §IT15.4 and iter-16 §IT16.4 spec the encoding; iter-17 §IT17.12 explicitly excludes `$$x` (these are user-local constants, not part of the shared state); §10.size-cap defines the 2KB ceiling and sidecar fallback.
>
> `urlEncoder.ts`: collect all `$x` values from M-E1's store (skip names that start with `$$`), serialize to compact JSON, base64url-encode, prepend a version tag (`v=1`). Also emit a shorter named form for common single-range states: `?b=cell-3:ts:1000..2000`.
>
> `urlDecoder.ts`: parse the URL fragment; validate version; decode base64url; parse JSON; emit `RestoreState` events for each name. On any error, fall back gracefully (load notebook without restoration, show a non-modal toast).
>
> `sidecarFallback.ts`: if the encoded state > 2KB, write a sidecar file alongside the notebook (`<notebook>.share.<token>.json`) and put just the token in the URL. On decode, fetch the sidecar (or prompt for upload if missing).
>
> `ShareLinkModal.tsx`: shows the URL, a copy button, and inclusion toggles (live-vars / checkpoint reference / open chat). Updates the URL as toggles change.
>
> `RecipientView.tsx`: on notebook mount, if URL has a share fragment, decode → write each restored value into M-E1's store → trigger initial re-eval.
>
> Tests: see Gate list. The property round-trip is the load-bearing one.
>
> Acceptance: `npm run test -- sharing`, `npm run test:e2e -- sharing` pass.

---

### M-E12: HTML/PDF static export with embedded plots

**What**: Render the entire notebook as a standalone HTML file with all plots inlined as SVG (no external JS), all data inlined into the HTML, and all styles in-document — the result opens in any browser and renders identically without a running server. PDF export goes through a headless-browser print path or a print-CSS path. The export respects column redaction (M-E15) — redacted columns appear hashed or masked in the export. File size is bounded (target <5MB for typical notebooks); larger notebooks chunk into multi-file output with an index.

**Showcase**: §1a.6 export HTML/PDF (cross-ref), §3c.4 report mode, §10b.2 diff view uses same renderer.

**Files**:
- `frontend-v2/src/services/export/htmlStaticExport.ts` (create) — main HTML emitter.
- `frontend-v2/src/services/export/pdfExport.ts` (create) — PDF path (print-CSS + headless or direct).
- `frontend-v2/src/services/export/inlineSvg.ts` (create) — render any of the 12 plot types as inline SVG.
- `frontend-v2/src/components/export/ExportModal.tsx` (create) — choose format + options.
- `frontend-v2/src/__tests__/export/htmlStatic.test.ts` (create).
- `frontend-v2/src/__tests__/export/inlineSvg.test.ts` (create).
- `frontend-v2/src/__tests__/export/redactionRespect.test.ts` (create).

**Tests**: unit | integration | e2e
- `htmlStatic.test.ts`: export a 5-cell notebook → assert resulting HTML opens without console errors → all 5 cells render → no external resource requests (file:// open works).
- `inlineSvg.test.ts`: for each of the 12 plot types (M-C2 / M-C3 / M-C4 / M-C5), render to standalone SVG and assert structure matches the reference fixture.
- `redactionRespect.test.ts`: with a redaction config that hashes column `user_email`, export → assert the HTML contains hashed values, not the originals.
- file size: typical notebook (10 cells, 1M points downsampled to 10K) → final HTML < 5MB.
- PDF: export → assert generated PDF is readable, has correct page count, embeds the plots.
- e2e: from the Export modal, choose HTML → save → open in fresh browser tab → verify all plots render.

**Gate**: HTML opens standalone without console errors; all 12 plot types inline as SVG; PDF readable and embeds plots; redaction respected; typical-notebook size <5MB.

**Blocked by**: M-C9 (cell composition — needed to render row{}/col{} layouts to static SVG), M-E15 (redaction — for the redaction wiring).

> **Agent prompt (M-E12):**
>
> Read showcase.html §1a.6, §3c.4, and §10b.2. The export must be **self-contained** — no external JS, no fetch, no `<script src=>`. Data is inlined into the HTML as JSON. Styles are inlined into the document head. Plots are inlined as SVG.
>
> `inlineSvg.ts`: for each of the 12 plot renderers (M-C2 / M-C3 / M-C4 / M-C5), produce a standalone SVG given the data and config. Reuse the renderer code but swap the live D3 + DOM mounts for direct SVG string emission.
>
> `htmlStaticExport.ts`: walk the cell store; for each cell, emit a section with the markdown rendered, the SQL (if any) rendered as a code block, and the result (table or plot) inlined. Pipe through redaction (M-E15's applier).
>
> `pdfExport.ts`: open the static HTML in a headless context or use a print-CSS path; if running in Electron / Tauri, use the native print-to-PDF; if pure web, use `window.print()` with a print-CSS sheet.
>
> `ExportModal.tsx`: format toggle (HTML / PDF), include-data toggle (always on for HTML; optional for PDF), redaction summary if redaction is configured.
>
> Tests: see Gate list. The reference-fixture comparison for each of 12 plot types is tedious but essential.
>
> Acceptance: `npm run test -- export`, `npm run test:e2e -- export` pass.

---

### M-E13: Recording compare — baseline + candidate, DIFF macro, cross-recording live coupling

**What**: Attach a baseline `.jfr` file per §4b.1 in addition to the candidate; comparison plots per §4b.2 overlay both recordings on the same axes (or render side-by-side); a `DIFF(candidate, baseline)` macro per §4b.3 computes per-row deltas (count, sum, mean, p95) between the two; live coupling across recordings per §4b.4 — brushing a window in the candidate also brushes the same window in the baseline, so direct comparison is always synchronized.

**Showcase**: §4b recording compare (full chapter), §4b.1 attach baseline, §4b.2 comparison plots, §4b.3 DIFF macro, §4b.4 live coupling cross-recording, §4b.5 why.

**Files**:
- `frontend-v2/src/services/compare/baselineLoader.ts` (create) — loads + registers a second .jfr.
- `frontend-v2/src/services/compare/diffMacro.ts` (create) — SQL macro `DIFF(candidate, baseline)`.
- `frontend-v2/src/components/compare/CompareView.tsx` (create) — overlay / side-by-side renderer.
- `frontend-v2/src/components/compare/AttachBaselineButton.tsx` (create) — UI affordance.
- `frontend-v2/src/__tests__/compare/baselineLoader.test.ts` (create).
- `frontend-v2/src/__tests__/compare/diffMacro.test.ts` (create).
- `frontend-v2/src/__tests__/compare/crossRecordingCoupling.test.ts` (create).

**Tests**: unit | integration | e2e
- `baselineLoader.test.ts`: attaching a second .jfr registers tables with a `baseline_` prefix (`baseline_jfr_cpu_load`, `baseline_jfr_gc_pause`, `baseline_jfr_allocation_in_new_tlab`) and does not collide with candidate tables.
- `diffMacro.test.ts`: `SELECT * FROM DIFF(jfr_cpu_load, baseline_jfr_cpu_load) WHERE delta_p95 > 10` returns rows where candidate p95 exceeds baseline p95 by >10.
- `crossRecordingCoupling.test.ts`: brushing a time window on the candidate plot writes `$cell.brush` that is also consumed by the baseline plot's filter → both render the same time window.
- e2e: attach baseline → render a comparison line chart → brush → verify both lines re-render to the brushed window → apply DIFF macro → see delta values.

**Gate**: attach .jfr as baseline; DIFF macro computes per-column delta (count / sum / mean / p95); comparison plots overlay candidate + baseline; live coupling pumps both recordings.

**Blocked by**: M-A7 (JFR importer — needed twice), M-E1 (store — for cross-recording coupling), M-C10 (overlay rendering primitives).

> **Agent prompt (M-E13):**
>
> Read showcase.html §4b in full — recording compare is a flagship workflow. The user has a "before" and "after" recording and wants to see what changed; DIFF makes that quantitative.
>
> `baselineLoader.ts`: invoke M-A7's importer on a second .jfr file; register tables under `baseline_*` names. Maintain a metadata flag so the SQL editor's autocomplete distinguishes them.
>
> `diffMacro.ts`: a DuckDB UDF or macro that joins two tables on a key set and emits `delta_*` columns (count, sum, mean, p95) per metric column. Implement as a SQL macro template that the parser expands.
>
> `CompareView.tsx`: render two recordings on the same axes (overlay) or side-by-side (toggle). Use distinct color schemes for candidate vs baseline (semantic: candidate = vibrant, baseline = muted).
>
> `AttachBaselineButton.tsx`: file picker → calls baselineLoader → updates UI state.
>
> Cross-recording coupling: live-vars from the candidate plot's cell flow through M-E1's store; baseline-plot consumers subscribe to the same `$x` names → both recordings render with the same brushed / zoomed window.
>
> Tests: see Gate list. The DIFF macro test is the most computation-dense.
>
> Acceptance: `npm run test -- compare`, `npm run test:e2e -- compare` pass.

---

### M-E14: Checkpoints — auto + manual, drawer, restore, diff, storage budget

**What**: Auto-checkpoints every 10 minutes of active editing (rolling window of 20 checkpoints); manual checkpoints unlimited until the storage budget is reached. ⌥A → Checkpoints tab per §10b.2 opens the drawer. ⌘⇧K creates a named manual checkpoint. Restore reverts the notebook to a chosen checkpoint and **creates a pre-restore auto-checkpoint** so the user can re-revert. Diff per §10b.3 renders side-by-side (uses M-A5's formatter to normalize before diffing). Storage budget tracking per §10b.4 warns at 80% and refuses new manual checkpoints at 100% (auto-checkpoints rotate through the rolling window regardless).

**Showcase**: §10b checkpoints (full chapter), §10b.1 through §10b.6 (all subsections).

**Files**:
- `frontend-v2/src/services/checkpoints/checkpointStore.ts` (create) — IndexedDB-backed checkpoint store.
- `frontend-v2/src/services/checkpoints/checkpointDiffer.ts` (create) — formatted-normalized diff.
- `frontend-v2/src/components/checkpoints/CheckpointDrawer.tsx` (create) — drawer host.
- `frontend-v2/src/components/checkpoints/CheckpointRow.tsx` (create) — single-entry row.
- `frontend-v2/src/components/checkpoints/RestoreConfirmModal.tsx` (create) — restore confirmation.
- `frontend-v2/src/components/checkpoints/DiffView.tsx` (create) — side-by-side diff renderer.
- `frontend-v2/src/__tests__/checkpoints/checkpointStore.test.ts` (create).
- `frontend-v2/src/__tests__/checkpoints/checkpointDiffer.test.ts` (create).
- `frontend-v2/src/__tests__/checkpoints/storageBudget.test.ts` (create).

**Tests**: unit | integration | e2e
- `checkpointStore.test.ts`: auto-checkpoint timer fires every 10min (faked with vi.useFakeTimers); rolling window keeps last 20 auto-checkpoints; manual checkpoints (⌘⇧K) keep unlimited count until budget.
- `checkpointDiffer.test.ts`: diff two checkpoints; whitespace-only differences hidden after formatter-normalization; structural differences surfaced.
- `storageBudget.test.ts`: warns at 80%; refuses new manual at 100%; auto-checkpoints continue rotating.
- restore flow: choose checkpoint → confirm → pre-restore auto-checkpoint created → notebook reverts → assert state matches.
- e2e: edit notebook for 10 minutes → assert auto-checkpoint appeared → press ⌘⇧K → enter name → assert manual appeared → open drawer → restore → assert revert → assert pre-restore checkpoint exists.

**Gate**: 10-min auto-checkpoint timer; rolling window of 20 auto-checkpoints; ⌘⇧K names manual checkpoint; restore creates pre-restore auto-checkpoint; diff respects M-A5's formatter normalization; storage budget warns at 80%, blocks new manual at 100%.

**Blocked by**: M-B7 (notebook state store), M-A5 (formatter — for diff normalization).

> **Agent prompt (M-E14):**
>
> Read showcase.html §10b in full (sections 10b.1 through 10b.6). The auto-checkpoint cadence is **10 minutes of active editing**, not wall-clock — pause the timer when the notebook has no recent edits. The rolling-window count for auto is **20**; manual has no rolling cap (only the storage budget).
>
> `checkpointStore.ts`: IndexedDB schema — `{id, type: 'auto' | 'manual', name?, ts, payload}`. Payload is the serialized notebook (markdown + frontmatter via M-A5). Auto-prune to keep the last 20 auto entries; never auto-prune manual.
>
> `checkpointDiffer.ts`: format both sides via M-A5 (so the formatter pass normalizes whitespace / ordering before diffing), then run a structural diff (split by cell, compare per-cell). Render in `DiffView` side-by-side with green/red gutters.
>
> `CheckpointDrawer.tsx`: opens via ⌥A → Checkpoints tab. Lists checkpoints newest-first with type badge and name; click → opens RestoreConfirmModal.
>
> `RestoreConfirmModal.tsx`: shows summary + diff; on confirm, write a pre-restore auto-checkpoint, then apply the chosen checkpoint's payload to the notebook store.
>
> Storage budget: query IndexedDB used-bytes (`navigator.storage.estimate()`); warn at 80%, refuse new manuals at 100%.
>
> Tests: see Gate list. Use vi.useFakeTimers for the 10-min auto cadence.
>
> Acceptance: `npm run test -- checkpoints`, `npm run test:e2e -- checkpoints` pass.

---

### M-E15: Redaction — PII control modal, hash/mask transforms, per-recording persistence

**What**: ⌘⇧R opens the redaction modal per §10c.1. The modal lists every string-typed column across loaded tables with: 3 sample values, distinct count, and a per-column toggle (`keep` / `hash` / `mask`). Two transforms per §10c.2 — **hash** = stable SHA-256 truncated to 8 hex chars (so cardinality preserved across hash boundaries), **mask** = literal asterisks (`***`) or first-letter-only (`j***`). Redaction applies to share URL (M-E11) + HTML export (M-E12) + agent context (run_sql, schema, sample_table tools from M-D2). A **redaction badge** per §10c.4 appears on shared / exported artifacts. Settings persist per-recording via a content-hash key (so loading the same .jfr re-applies the same redaction config).

**Showcase**: §10c redaction (full chapter), §10c.1 modal, §10c.2 two transforms, §10c.3 where applies, §10c.4 badge, §10c.5 what it does not do, §10c.6 why.

**Files**:
- `frontend-v2/src/services/redaction/redactionStore.ts` (create) — per-recording config keyed by content hash.
- `frontend-v2/src/services/redaction/hashTransform.ts` (create) — stable SHA-256 truncated.
- `frontend-v2/src/services/redaction/maskTransform.ts` (create) — asterisk / first-letter mask.
- `frontend-v2/src/services/redaction/redactionApplier.ts` (create) — applies config to result rows.
- `frontend-v2/src/components/redaction/RedactionModal.tsx` (create) — full modal UI.
- `frontend-v2/src/components/redaction/RedactionBadge.tsx` (create) — badge for shared / exported artifacts.
- `frontend-v2/src/components/redaction/ColumnToggle.tsx` (create) — per-column three-state toggle.
- `frontend-v2/src/__tests__/redaction/hashTransform.test.ts` (create).
- `frontend-v2/src/__tests__/redaction/maskTransform.test.ts` (create).
- `frontend-v2/src/__tests__/redaction/applier.test.ts` (create).
- `frontend-v2/src/__tests__/redaction/persistence.test.ts` (create).

**Tests**: unit | integration | e2e
- `hashTransform.test.ts`: same input → same hash (deterministic); different inputs → different hashes; hash length is 8 hex chars; the same value across two recordings hashes to the same output.
- `maskTransform.test.ts`: full-mask returns `***`; first-letter returns `<first>***`; empty input returns empty.
- `applier.test.ts`: given a result set and a redaction config, the applier returns a new result set with the configured columns transformed.
- `persistence.test.ts`: configure redaction → reload notebook with the same .jfr (same content hash) → config restored; load a different .jfr → no redaction (or that recording's own config).
- integration: agent's run_sql tool returns rows that respect the active redaction config; schema tool returns the same column names but flags redacted columns.
- e2e: ⌘⇧R opens modal → toggle `user_email` to hash → close → run query → assert email column shows 8-char hex → export HTML → assert export also shows hashes → copy share link → recipient sees hashes.

**Gate**: ⌘⇧R opens modal; columns listed with 3 samples + distinct count; hash + mask transforms work; persists per-recording (content-hash key); badge appears on shared / exported artifacts; share URL + HTML export + agent run_sql all honor redaction.

**Blocked by**: M-E11 (share URL — for the share-URL applier path), M-E12 (HTML export — for the export applier path), M-D2 (agent tools — for the run_sql / schema / sample_table applier paths).

> **Agent prompt (M-E15):**
>
> Read showcase.html §10c in full (sections 10c.1 through 10c.6). Redaction is **per-column** and **per-recording**. The user picks columns; the recording's content hash keys the persistence so loading the same file twice doesn't lose the config. Crucially, §10c.5 lists what redaction does **not** do — it is not encryption, not access control, and not protection against an adversary with the source .jfr. It is a sharing-time scrub.
>
> `redactionStore.ts`: persist as `Map<contentHash, RedactionConfig>` in IndexedDB. `RedactionConfig = { columns: Record<columnName, 'keep' | 'hash' | 'mask'> }`. On recording load, compute content hash (SHA-256 of file bytes), look up config, apply.
>
> `hashTransform.ts`: `sha256(value).slice(0, 8)`. Use Web Crypto API.
>
> `maskTransform.ts`: full → `***`; first-letter → `value[0] + '***'`; configurable via the toggle (M-E15 ships the full mask as default; first-letter is a future iteration).
>
> `redactionApplier.ts`: given `RedactionConfig` and a result row, transform the row in-place (return new object). Used by share URL encoder (M-E11), HTML export emitter (M-E12), and agent tools (M-D2).
>
> `RedactionModal.tsx`: list each string-typed column from `INFORMATION_SCHEMA.columns WHERE data_type IN ('VARCHAR', 'TEXT')`. For each, query 3 distinct sample values + total distinct count (use M-A6's DuckDB worker). Render a three-state toggle.
>
> `RedactionBadge.tsx`: a small badge ("Redacted: N columns") shown on share-link modals, exported HTML headers, and the recipient view.
>
> Tests: see Gate list. The persistence test (same .jfr re-loaded → config restored) is critical.
>
> Acceptance: `npm run test -- redaction`, `npm run test:e2e -- redaction` pass.

---

## Phase F — Workspace Globals (`$$x` dual-sigil system)

Phase F upgrades workspace-globals from the Phase A simplification ("treat `$$x` identically to `$x` within a single notebook") into a real cross-notebook reactive layer. The substrate is a `localStorage`-keyed bus plus `BroadcastChannel` for same-origin cross-tab fan-out; the conflict model is last-writer-wins on monotonic timestamps with `originTabId` lexicographic tiebreak; the UI affordance is a separated section in the varbar (§2 / §0a topbar pills) with origin badges, pin-to-this-notebook overrides, and a conflict toast when an out-of-process write clobbers a value the user just typed.

Phase F's three milestones decompose along the standard substrate → semantics → UI seam:

- **M-F1** — the transport and clock.
- **M-F2** — the reactive store, conflict resolver, and SQL/plot re-execution hook.
- **M-F3** — the varbar UI, origin badges, pin control, and conflict toast.

§2.4 of `showcase.html` is the ground truth for the `$$x` model; §2.5 / §2.6 / §2.7 specify the pill popover, autocomplete picker, and varbar surface that M-F3 must satisfy; §0a specifies the topbar pill bindings for `$$session_start` / `$$session_end`.

---

### M-F1: Workspace-globals storage bus — `BroadcastChannel` + `storage` event, monotonic clock

**What**: A `localStorage`-backed bus that carries `WorkspaceVarUpdate{ name, value, ts, originTabId }` between tabs of the same origin. Two transports run in parallel — `BroadcastChannel('jfr-workspace')` for same-process subscribers and the `window.addEventListener('storage', …)` fallback for browsers / contexts where `BroadcastChannel` is unavailable. Timestamps come from a monotonic clock (`performance.now() + epochOffset`, where `epochOffset` is set once at session start and survives clock skew) so that comparisons across tabs use a globally-consistent ordering. The bus is the transport only — it has no conflict resolution, no UI, and no schema knowledge; it is a typed event pipe.

**Showcase**: §2.4 `$$` globals — the "Phase F adds LWW conflict resolution when two notebooks open in different windows write at once" callout in §2.4 is the explicit forward-reference for this milestone. §0a topbar pills (date pickers bound to `$$session_start` / `$$session_end`) is the cross-tab use case.

**Files**:
- `frontend-v2/src/workspace/workspaceBus.ts` (create) — `BroadcastChannel` + `storage` event bus, with deduplication of locally-originated echoes.
- `frontend-v2/src/workspace/monotonicClock.ts` (create) — `now()` returning monotonically non-decreasing timestamps; `epochOffset` initialization.
- `frontend-v2/src/workspace/types.ts` (create) — `WorkspaceVarUpdate`, `TabId`, `MonotonicTs` types.
- `frontend-v2/src/__tests__/workspace/workspaceBus.test.ts` (create).
- `frontend-v2/src/__tests__/workspace/monotonicClock.test.ts` (create).
- `frontend-v2/src/__tests__/workspace/busTwoTab.integration.test.ts` (create).
- `frontend-v2/src/__tests__/workspace/busConvergence.property.test.ts` (create).

**Interfaces**: new — `WorkspaceVarUpdate { name: string; value: PlotValue; ts: MonotonicTs; originTabId: TabId }`, `MonotonicTs = { logical: number; wallClock: number }`, `TabId = string` (uuid-v4 minted once per tab and persisted to `sessionStorage`).

**Tests**: unit | integration | property
- `monotonicClock.test.ts` (unit, 6 cases): `now()` strictly non-decreasing across 10_000 sequential calls; survives a `Date.now()` rewind (mock clock backwards 5s — monotonic clock keeps advancing via the `performance.now()` component); `epochOffset` initialized once and stable across calls; two clock instances in the same tab return ordered values; clock under simulated load (1ms `setTimeout` jitter, 1000 iterations) emits no duplicate `logical` values; serialization round-trips a `MonotonicTs` losslessly.
- `workspaceBus.test.ts` (unit, 7 cases): `publish()` writes to both `BroadcastChannel` and `localStorage` (mock both); local echoes (same `originTabId`) are filtered before the subscriber callback fires; subscribers receive remote `WorkspaceVarUpdate`s in publish order; unsubscribing stops delivery; closing the channel releases both transports; tombstone values (`value: null` with a special `__tombstone__` marker) propagate verbatim; oversized values (>64KB JSON) refuse to publish and emit an error event instead of silently truncating.
- `busTwoTab.integration.test.ts` (integration, 5 cases): tab A `publish({ name: '$$threshold', value: 10, … })`, tab B receives the same payload within 50ms; tab B publishes same name with newer ts, tab A receives the update; both tabs publish concurrently (within 5ms of each other) and both see both messages; tab A closes mid-stream, tab B's subscription continues unaffected; `BroadcastChannel` disabled (mock) → fallback `storage` event path still delivers updates.
- `busConvergence.property.test.ts` (property, fast-check, 4 properties): for N tabs (N ∈ [2, 8]) publishing M random updates (M ∈ [10, 200]) with random `(name, ts)` pairs, every tab's observed delivery set is a superset of every other tab's published set (no message loss); for any two concurrent writes to the same name across two tabs, both tabs observe both `WorkspaceVarUpdate`s (with both timestamps intact — conflict resolution is M-F2's job, not the bus's); the monotonic clock invariant holds across all tabs in the test (no `ts` appears with a smaller `logical` than a previously-seen one from the same `originTabId`); message order from a single `originTabId` is preserved across all subscribers.

**Gate**: `BroadcastChannel` + `storage` fallback both deliver `WorkspaceVarUpdate`s within 50ms cross-tab; monotonic clock never regresses under simulated wall-clock rewind; two-tab integration test green; property convergence test green for N ∈ [2, 8].

**Blocked by**: none (substrate layer; depends only on standard browser APIs).

> **Agent prompt (M-F1):**
>
> Read showcase.html §2.4 — note the explicit "Phase F adds LWW conflict resolution when two notebooks open in different windows write at once" sentence. M-F1 ships only the **transport**, not the resolver — keep that boundary strict. Implement `workspaceBus.ts` to fan out `WorkspaceVarUpdate` events via `BroadcastChannel('jfr-workspace')` first, with a `window.addEventListener('storage', …)` fallback gated on `typeof BroadcastChannel === 'undefined'`. Deduplicate locally-originated echoes by comparing `originTabId` to a tab-scoped UUID minted at session start and persisted to `sessionStorage` (so reload reuses the same id within a tab but new tabs get fresh ids).
>
> Implement `monotonicClock.ts` as `{ logical, wallClock }` where `logical` increments by one on every `now()` call and `wallClock = performance.now() + epochOffset` (set once at module load). The `logical` channel guarantees strict monotonicity even when `performance.now()` is paused or rewound by browser throttling. Serialize as `{ l: number, w: number }` to keep the bus payload tight.
>
> The integration test must use real `BroadcastChannel` + `localStorage` (or a `jsdom` shim that emits real `storage` events). Use `vitest`'s `@vitest/web-worker` or a custom multi-context harness; a single test process holding two `Window` contexts is acceptable.
>
> Tests: see Gate list. The property test is the load-bearing one — fast-check with `numRuns: 100` and `maxLength: 200` on the update sequence catches ordering bugs the unit suite misses.
>
> Acceptance: `npm run test -- workspace/bus`, `npm run test -- workspace/clock` pass; property test seed is fixed in `vitest.config.ts` to make CI reproducible.

---

### M-F2: `$$x` reactive store + last-writer-wins conflict resolution

**What**: A reactive store layered on top of M-F1's bus that resolves concurrent writes to the same `$$x` name via last-writer-wins on `ts.logical`, with `originTabId` lexicographic ordering as the tiebreak when two updates carry the same logical timestamp (which can only happen if two tabs forge the same clock; the property test from M-F1 makes this near-impossible but the resolver still handles it for correctness). The store exposes a subscribe-once API (`subscribe('$$threshold', cb)`) used by the SQL re-execution engine (M-B7 dep-graph) to re-run dependent cells when a `$$x` value changes. Tombstones (deletion) propagate by writing a `null` value with a `__tombstone__` flag — the store treats these as deletions for read but preserves the tombstone-with-ts so a later-arriving stale write is correctly suppressed.

**Showcase**: §2.4 `$$` globals — the entire section is the spec; in particular, the table at §2.4 listing built-in `$$session_start`, `$$session_end`, `$$theme`, `$$default_jfr_dir` plus user-defined names is what the store must support. §2.5 pill popover assumes `$$x` is reactive (clicking the pill writes the new value, every dependent cell re-runs).

**Files**:
- `frontend-v2/src/workspace/workspaceStore.ts` (create) — reactive store, subscribers, derived values.
- `frontend-v2/src/workspace/conflictResolver.ts` (create) — pure LWW resolver, no side effects.
- `frontend-v2/src/workspace/tombstones.ts` (create) — tombstone semantics.
- `frontend-v2/src/workspace/persistence.ts` (create) — snapshot to `localStorage['jfr-notebook/workspace']` (per §0d.1) on debounced commit.
- `frontend-v2/src/__tests__/workspace/workspaceStore.test.ts` (create).
- `frontend-v2/src/__tests__/workspace/conflictResolver.test.ts` (create).
- `frontend-v2/src/__tests__/workspace/tombstones.test.ts` (create).
- `frontend-v2/src/__tests__/workspace/storeConvergence.property.test.ts` (create).
- `frontend-v2/src/__tests__/workspace/storeReExec.integration.test.ts` (create).

**Interfaces**: new — `WorkspaceStore { get(name): PlotValue | undefined; set(name, value): void; subscribe(name, cb): Unsubscribe; snapshot(): Record<string, PlotValue> }`, `ConflictResolution { winner: WorkspaceVarUpdate; loser: WorkspaceVarUpdate; reason: 'newer-ts' | 'tiebreak-origin' }`. Re-uses `WorkspaceVarUpdate` from M-F1.

**Tests**: unit | property | integration
- `conflictResolver.test.ts` (unit, 8 cases): older `ts.logical` loses to newer; equal `ts.logical` with `originTabId: 'a'` loses to `originTabId: 'b'` (lexicographic); identical updates (same name, ts, value, originTabId) collapse to a single state with no spurious notification; a tombstone with newer ts wins over a real value with older ts (deletion observed); a real value with newer ts wins over a tombstone with older ts (resurrection observed); a tombstone with older ts loses to a real value with newer ts (no spurious deletion); resolver is pure — calling twice with same inputs returns identical `ConflictResolution`; resolver throws on malformed inputs (missing `originTabId`).
- `workspaceStore.test.ts` (unit, 9 cases): `set('$$threshold', 10)` then `get('$$threshold')` returns 10; subscribers fire on `set`; subscribers do not fire when the new value equals the current value (referential / deep-equal check); `unsubscribe` removes the callback; remote updates via the bus arrive as `set`-equivalent state changes; tombstone arrival removes the key from `get` but keeps the tombstone internally; `snapshot()` excludes tombstoned keys; persistence layer debounces writes (300ms) and writes to `localStorage['jfr-notebook/workspace']`; reload reconstructs the store from `localStorage`.
- `tombstones.test.ts` (unit, 5 cases): tombstone with `__tombstone__: true, ts, originTabId` marker; tombstones serialize through the bus verbatim; a stale write (older ts) arriving after a tombstone is suppressed; a fresher write arriving after a tombstone overrides it (resurrection); tombstones older than 24h are garbage-collected on snapshot.
- `storeConvergence.property.test.ts` (property, fast-check, 5 properties): given N stores (N ∈ [2, 6]) connected via mock buses, all stores converge to the same `snapshot()` after all writes drain; the converged value for each name is the one with the highest `(ts.logical, originTabId)` lex-pair; subscription notifications are causally ordered per name (no notification with older `ts` arrives after a newer one); tombstones are eventually visible in every store; replay of the full write log in random order produces the same final snapshot (commutativity).
- `storeReExec.integration.test.ts` (integration, 4 cases): SQL cell uses `WHERE startTime BETWEEN $$session_start AND $$session_end` → set `$$session_start` → cell re-executes within one tick of the store's subscriber callback; plot cell with `xDomain: [$$session_start, $$session_end]` re-renders on `$$x` change; remote tab writes `$$session_start` → dep-graph (M-B7) sees the change and re-runs only `$$x`-dependent cells (not unrelated cells); tombstone of `$$session_start` triggers re-execution with the cell's fallback value (or an error if no fallback declared).

**Gate**: LWW with `originTabId` tiebreak proven by property test; tombstone propagation correct; subscribers fire on remote and local writes; SQL / plot cells re-execute on `$$x` change via M-B7 dep-graph; `localStorage['jfr-notebook/workspace']` persistence round-trips.

**Blocked by**: M-F1 (bus + clock), M-B7 (dep-graph — for the re-execution wiring).

> **Agent prompt (M-F2):**
>
> Read showcase.html §2.4 in full — the table of built-in `$$x` names plus the "values are reactive everywhere they appear — in SQL, in plot configs, in `link-x` bindings, in macros" sentence is the contract. Also read §0d.1 — the workspace state (theme, `$$`-globals, open tabs, recently-opened files) persists to `localStorage` under key `jfr-notebook/workspace`. M-F2 owns that key for the `$$`-globals slice; do not write any other slice.
>
> Implement `conflictResolver.ts` as a pure function `resolve(a: WorkspaceVarUpdate, b: WorkspaceVarUpdate): ConflictResolution`. Order: compare `ts.logical` first; if equal, compare `originTabId` lexicographically. Document the tiebreak with a comment citing the property test.
>
> Implement `workspaceStore.ts` as a reactive map. Subscribe to M-F1's `workspaceBus`; on every incoming `WorkspaceVarUpdate`, compare against the current entry for that name via `conflictResolver`; if the new update wins, update the entry and notify subscribers; otherwise drop silently. For local `set()` calls, mint a `WorkspaceVarUpdate` with a fresh `MonotonicTs` and the local `TabId`, apply it to the store, *and* publish to the bus.
>
> Wire into M-B7's dep-graph: when a `$$x` value changes, walk the dep-graph and mark every cell whose `varRefs` (per `REDESIGN_INTERFACES.md §1.1`) include a `VarRef{ scope: 'global', name: '$$x' }` as stale, then trigger re-execution. The dep-graph is the existing machinery; M-F2 only adds the `$$x` → cell subscription.
>
> Tombstones: write a sentinel `{ __tombstone__: true, ts, originTabId }` as the bus value. The store treats tombstoned keys as absent for `get()` but keeps the sentinel for resolver use. GC tombstones older than 24h on snapshot.
>
> **`$$ai_providers` secrets slice** (showcase §2.4, §7b.7, §10c.1 / table at line 8123): the store treats `$$ai_providers` as a workspace-scope record `{ [providerId]: { endpoint, apiKey, modelId, dataAccess, costCapUsd } }`. API keys are **never** serialized into share URLs (M-E12 already excludes all `$$x` from the URL fragment — keep that invariant; do not special-case re-inclusion). The provider-config dialog (M-D1 ModelSelector — when the user picks a provider whose entry is missing or `apiKey` is empty, open the dialog instead of dispatching the turn) writes to this slice. Health state (`unhealthy_until_ts` per showcase §7e.4 / line 7271 — 60s cool-off after two consecutive failures) is **also** kept here so M-D7's failover prompt and the ModelSelector dropdown can read the same source of truth.
>
> Tests: see Gate list. The property test for store convergence is the canonical correctness proof — fast-check `numRuns: 200`.
>
> Acceptance: `npm run test -- workspace/store`, `npm run test -- workspace/resolver`, `npm run test -- workspace/tombstones` pass; integration test with M-B7 dep-graph green.

---

### M-F3: Varbar UI for workspace globals — separated section, origin badge, pin, conflict toast

**What**: The varbar (per §2.6 / §2.7 / §0b sidebar surfaces) renders a visually separated section for `$$x` globals beneath the notebook-local `$x` section. Each row shows a purple globe icon (matching the §2.5 popover's purple chip for `$$` vars), the variable name, the current value (with the §2.7 pill popover on click for inline editing), and an **origin badge** ("set by Notebook X" or "set by topbar") that names the most recent writer. A **pin-to-this-notebook** control on each row lets the user shadow the workspace value with a notebook-local override (writes `$x` into the notebook frontmatter with the same name minus one sigil; the SQL/plot resolver prefers the local `$x` when both exist). A **conflict toast** appears (using the §1a.5 activity-feed toast surface, but transient — auto-dismiss after 6s) when another tab writes a `$$x` value within 2 seconds of the user typing a different value for the same name; the toast offers "Keep mine" (re-applies the local edit with a fresh `ts`) and "Accept theirs" (no-op, since the remote already won).

**Showcase**: §2.4 `$$` globals (the separated workspace-globals concept), §2.5 variable pills (the click-to-edit pill popover — purple chip for `$$x`), §2.6 autocomplete (the `WORKSPACE · $$` grouping header in the picker matches the varbar section header), §2.7 the `$` variable popover (the popover layout the row reuses on click), §0a topbar pills (the `$$session_start` / `$$session_end` pills in the topbar coordinate with the varbar — both surfaces must reflect the same store).

**Files**:
- `frontend-v2/src/components/varbar/WorkspaceGlobalsSection.tsx` (create) — the separated `$$x` section in the varbar.
- `frontend-v2/src/components/varbar/WorkspaceGlobalRow.tsx` (create) — single `$$x` row with origin badge + pin control.
- `frontend-v2/src/components/varbar/OriginBadge.tsx` (create) — "set by Notebook X" / "set by topbar" badge with `aria-label`.
- `frontend-v2/src/components/varbar/PinToNotebookButton.tsx` (create) — shadow workspace value with a notebook-local `$x`.
- `frontend-v2/src/components/varbar/ConflictToast.tsx` (create) — transient toast on write conflict, `aria-live="polite"`.
- `frontend-v2/src/components/varbar/__visual__/WorkspaceGlobalsSection.stories.tsx` (create) — Storybook / visual-regression fixtures.
- `frontend-v2/src/__tests__/varbar/workspaceGlobalsSection.test.tsx` (create).
- `frontend-v2/src/__tests__/varbar/conflictToast.test.tsx` (create).
- `frontend-v2/src/__tests__/varbar/originBadge.a11y.test.tsx` (create).
- `frontend-v2/src/__tests__/e2e/varbarTwoTab.e2e.ts` (create) — Playwright two-tab test.

**Interfaces**: re-uses `WorkspaceStore` (M-F2). New UI-only: `OriginInfo { source: 'notebook' | 'topbar' | 'workspace.yaml'; notebookName?: string }` derived from the store's last-writer tracking (extend M-F2's `WorkspaceVarUpdate` with an optional `origin: OriginInfo` field — backwards-compatible since the bus already carries arbitrary `value`).

**Tests**: unit | visual | e2e | a11y
- `workspaceGlobalsSection.test.tsx` (unit, 7 cases): renders all `$$x` names from `WorkspaceStore.snapshot()` under the section header; sorts names alphabetically with built-ins (`$$session_start`, `$$session_end`, `$$theme`, `$$default_jfr_dir`) pinned to the top; clicking a row's value opens the §2.5 pill popover; pin button writes a notebook-local `$x` and the row gains a "shadowed" visual state; tombstoned `$$x` names do not appear; section is collapsible (state persisted to `localStorage`); empty workspace-globals state shows a "no globals yet — declare with `$$name = …`" hint.
- `conflictToast.test.tsx` (unit, 6 cases): toast appears when remote write arrives within 2s of local edit; toast does not appear when remote write arrives 2s+ after local edit; "Keep mine" re-publishes with a fresh `ts`; "Accept theirs" dismisses; auto-dismiss after 6s; multiple concurrent toasts stack (max 3 visible, older queue out).
- `originBadge.a11y.test.tsx` (a11y, 5 cases): badge has `aria-label="Last set by Notebook GC Analysis at 12:34:56"`; badge is keyboard-focusable; conflict toast announces via `aria-live="polite"` with the new value + origin; pin button has `aria-pressed` reflecting shadow state; `axe-core` scan of the section emits zero violations.
- Visual (Storybook + Chromatic / Loki snapshot, 6 fixtures): varbar with 0, 1, 5, 20 workspace globals; mixed local `$x` + workspace `$$x`; shadowed-by-local row state; conflict toast (single + stacked); dark + light themes.
- `varbarTwoTab.e2e.ts` (e2e, 4 cases): tab A sets `$$threshold = 10` via the pill popover → tab B's varbar shows `$$threshold = 10` within 100ms; tab B types `$$threshold = 20` → tab A sees a conflict toast within 100ms; tab A clicks "Keep mine" → tab B's value updates to 10; pin-to-notebook on tab A creates a local `$x` shadow → SQL cell using `$$threshold` resolves to the local override.

**Gate**: workspace-globals section renders separated from `$x` in the varbar; origin badge names the last writer; pin control creates a notebook-local shadow that the resolver prefers; conflict toast appears on contended writes with "Keep mine" / "Accept theirs"; a11y scan zero violations; two-tab e2e green within 100ms latency budget.

**Blocked by**: M-F2 (store + resolver — for the data the UI reflects), M-B7 (dep-graph — for the shadow-resolution path: notebook-local `$x` overrides workspace `$$x` when both exist), M-E14 (toast / activity-feed surface — for the toast host; the conflict toast is a new toast type but reuses the same surface).

> **Agent prompt (M-F3):**
>
> Read showcase.html §2.4 (workspace globals concept), §2.5 (purple-chip pill popover for `$$x`), §2.6 (the `WORKSPACE · $$` grouping in autocomplete — your varbar section header should visually match), §2.7 (the popover layout for editing values), and §0a (the topbar `$$session_start` / `$$session_end` pills — your varbar rows must stay in sync with the topbar pills because both bind to the same `WorkspaceStore`).
>
> Implement `WorkspaceGlobalsSection.tsx` as a sibling to the existing notebook-locals section in the varbar. Use a visible divider plus the section header `WORKSPACE · $$` (matching §2.6's autocomplete grouping). Render rows in the order: built-ins first (`$$session_start`, `$$session_end`, `$$theme`, `$$default_jfr_dir` — that order), then user-declared names alphabetically.
>
> `WorkspaceGlobalRow.tsx` composes: a purple globe icon, the name, the current value (clickable to open the §2.5 popover via the existing pill component — pass the `$$x` purple variant), the `OriginBadge`, and a `PinToNotebookButton`. The row reads from `WorkspaceStore` via a `useSyncExternalStore` hook for tear-free updates.
>
> `OriginBadge.tsx`: small text "set by Notebook GC Analysis" or "set by topbar" with `aria-label="Last set by <source> at <hh:mm:ss>"`. The badge data comes from the optional `origin: OriginInfo` field on `WorkspaceVarUpdate` (extend M-F2's update type).
>
> `PinToNotebookButton.tsx`: on click, write a `$x` entry to the notebook frontmatter (same name minus one sigil — `$$threshold` becomes `$threshold`) with the current `$$x` value. The resolver in M-B7's dep-graph already prefers `$x` over `$$x` when both exist; this milestone only adds the UI.
>
> `ConflictToast.tsx`: subscribe to `WorkspaceStore` writes; if a remote write to `$$name` arrives within 2s of a local `set($$name)`, emit a toast onto the §1a.5 activity-feed surface (reuse the surface but use a transient variant — auto-dismiss after 6s, max-stack 3). "Keep mine" calls `WorkspaceStore.set($$name, myLocalValue)` (which mints a fresh `ts` and wins); "Accept theirs" is just dismiss.
>
> The two-tab e2e test uses Playwright's `browserContext.newPage()` twice within the same context (so they share `localStorage` / `BroadcastChannel`). Latency budget: tab-to-tab propagation under 100ms in the e2e harness.
>
> Tests: see Gate list. The a11y test (`axe-core` zero violations) and the visual snapshot of the conflict-toast stack are both load-bearing — do not skip them.
>
> Acceptance: `npm run test -- varbar/workspace`, `npm run test:visual -- varbar/workspace`, `npm run test:e2e -- varbar/twoTab` pass; `axe-core` scan emits zero violations.

---

### M-F4 — Workspace secrets store: real `$$ai_providers` via Dexie

**What**: Replaces M-D0's localStorage stub with the production IndexedDB-backed `$$ai_providers` store. Owns the cost ledger persistence used by M-D7's cost-cap pre-send check.

**Showcase**: §2.4, §10c.1.

**Files**:
- `src/state/workspace/aiProvidersStore.ts` (create) — real implementation of `IAiProvidersStore` from `src/services/ai/aiProvidersStoreContract.ts` (defined in M-D0).
- `src/state/workspace/costLedger.ts` (create) — atomic-increment helper for `total_spend_usd` per provider id.
- `src/state/workspace/schema.ts` (create) — Dexie schema: `providers` table keyed by provider id with columns `{endpoint: string, apiKey: string, modelId: string, dataAccess: 'external'|'local', costCapUsd: number, unhealthy_until_ts: number, total_spend_usd: number}`.

**Spec**:
- DECISION (pre-resolved): IndexedDB via Dexie ≥4.x. Justification: matches showcase §10c.1; survives reload; supports atomic transactions for cost ledger increments.
- Migration from M-D0 stub: on first M-F4 boot, if `localStorage['$$ai_providers.v1']` exists, copy each provider entry into Dexie then delete the localStorage key. Migration runs once per browser; subsequent boots skip it (idempotency: Dexie version flag).
- DI wiring: M-F1 reads `frontend-v2/src/state/workspace/aiProvidersStore.ts` and registers it as the `secrets` slice. M-D0 consumers receive the real store transparently through the same `IAiProvidersStore` contract.

**Tests**:
- `aiProvidersStore.test.ts` — runs the M-D0 contract test suite against the real store. Must pass identically (zero-diff vs stub).
- `migration.test.ts` — seed localStorage with two provider entries, boot M-F4, assert Dexie contains both and localStorage key is deleted.
- `costLedger.test.ts` — property test: 1000 concurrent `increment(providerId, amount)` calls produce a final `total_spend_usd` equal to the sum of amounts (no lost updates).

**Gate**:
- `npm run test -- workspace/aiProvidersStore` green.
- `npm run test:e2e -- aiProvidersHandoff` green (E2E swaps stub→real mid-session and verifies M-D0's chat flow unaffected).

**Blocked by**: M-D0 (defines `IAiProvidersStore` contract), M-F1 (registers workspace slices).

**Agent prompt**:
> Implement the Dexie-backed `IAiProvidersStore` against the contract exported by M-D0 (`src/services/ai/aiProvidersStoreContract.ts`). The Dexie schema is given in Files above. The migration from localStorage runs once on first boot — check for `localStorage['$$ai_providers.v1']`, copy entries to the Dexie `providers` table, delete the localStorage key. Implement `costLedger.ts` as an `incrementSpend(providerId: string, deltaUsd: number)` helper using a Dexie transaction. Register the store in M-F1's `secrets` slice. Run the M-D0 contract test against the real store and confirm zero diff vs the stub.

**Acceptance**: All M-D0 tests pass with the real store substituted via DI. Migration test green. Cost-ledger property test green at N=1000.

---

## Cross-Cutting Concerns

Concerns in this section apply across **every** milestone (A–F) regardless of phase. They are not assigned to a single milestone because cutting them out of any one milestone is wrong — they form the spine that the per-milestone work attaches to. Each per-milestone "Gate" inherits the relevant subset; an "axe-core zero violations" gate on a UI milestone, for example, is enforcement of the a11y baseline below.

### Error Boundaries

Three concentric React error boundaries, each catching a different blast radius:

- **App-shell boundary** (`frontend-v2/src/components/errors/AppBoundary.tsx`) — the last line of defense. Catches anything the inner boundaries miss (notebook store corruption, hook order violations, theme-system crashes). Renders a full-page error with the JS stack, the current notebook id, the last 10 activity-feed entries (per M-B7), and a "Report issue" CTA that opens a `mailto:` link pre-filled with the same payload. Resets only by full page reload.
- **Notebook-level boundary** (`frontend-v2/src/components/errors/NotebookBoundary.tsx`) — wraps the cell column under `Shell.tsx`. Catches store and runtime errors (dep-graph corruption, DuckDB worker re-init failures, varbar reducer crashes) without taking down the topbar / sidebar / agent drawer. Renders a fallback panel with "Recover from last checkpoint" (wired to M-E14's `checkpointStore`), "Open a different notebook," and "Reset workspace." The boundary itself stays mounted across resets so the user never loses the shell.
- **Cell-level boundary** (`frontend-v2/src/components/errors/CellBoundary.tsx`) — wraps each cell's editor + renderer. Catches plot render errors (e.g., scatter renderer crashes on NaN), maps them to the M-C1 five-state machine's `"error"` state with the captured stack, and lets the user "Reset cell" without affecting neighbors. The boundary is the bridge between React-throws and the plot state machine — without it, one renderer's bug brings down the entire notebook.

**Files**:
- `frontend-v2/src/components/errors/AppBoundary.tsx`
- `frontend-v2/src/components/errors/NotebookBoundary.tsx`
- `frontend-v2/src/components/errors/CellBoundary.tsx`
- `frontend-v2/src/components/errors/errorReporter.ts` — shared stack-trace serializer + redaction-aware error payload assembler (so reporting a crash never leaks PII when redaction is active per M-E15).
- `frontend-v2/src/__tests__/errors/cellBoundary.test.tsx`
- `frontend-v2/src/__tests__/errors/notebookBoundary.test.tsx`
- `frontend-v2/src/__tests__/errors/appBoundary.test.tsx`
- `frontend-v2/src/__tests__/e2e/errorBoundaryFaultInjection.e2e.ts` (Playwright) — three test cases, one per layer: inject `throw new Error('fault-injected')` from a plot renderer, from the notebook store reducer, and from the Shell layout; assert the correct boundary catches and the others stay mounted.

**Gate**: fault-injection e2e green; cell crashes do not affect siblings; notebook crashes do not affect topbar/sidebar; app-shell crash recoverable only by reload but reproducibly so; error reporter respects the M-E15 redaction config.

### Accessibility (a11y) Baseline

The contract from showcase §10a.1 is non-negotiable across every UI milestone:

- **Keyboard-first**: every interactive element reachable via `Tab`; `Shift+Tab` reverses; `Enter` / `Space` activates; `Escape` dismisses modals / popovers / inline chat. Focus indicator is Tailwind `ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]` — visible against any background, color-independent.
- **Screen-reader**: `aria-live="polite"` on the issues panel (M-B5), the activity feed (M-B7), the agent transcript (M-D1), the brush/zoom/hover proposal toasts, and the workspace-global conflict toast (M-F3). Every icon-only button has `aria-label`. Every plot renderer (M-C1–M-C5) emits an `aria-label` summary on the canvas wrapper (`"line chart, 3 series, x-axis time, y-axis Heap usage"`) and a `<table>` data-equivalent inside a visually-hidden region for full screen-reader access.
- **Color contrast**: WCAG AA — text 4.5:1, large text and UI components 3:1. Theme palette in `tokens.css` is pre-verified; CI runs a `contrast.test.ts` against every `(fg-token, bg-token)` pair declared in the palette.
- **Motion**: every entrance / exit transition checks `prefers-reduced-motion: reduce` and degrades to instant. Brush drag is exempt (it's user-controlled), but the brush release animation respects the preference.
- **Color is never the only signal**: error states pair red with a `⚠` glyph; success pairs green with `✓`; coupling pills pair color with a `🔗 N` count.

**Tooling**:
- `@axe-core/playwright` injected on every e2e test via a shared fixture (`frontend-v2/src/__tests__/e2e/fixtures/axe.ts`); CI fails on any violation of severity `serious` or `critical`.
- `eslint-plugin-jsx-a11y` recommended rules enabled with no overrides; lint failures block merge.
- `frontend-v2/src/__tests__/a11y/keyboardNav.e2e.ts` — global tab-order test: starting from app load, the entire UI is traversable via `Tab` only, with no traps (Playwright's `keyboard.press('Tab')` in a 200-step loop).

**Per-milestone gate**: every milestone that touches UI (M-B1 through M-B8, M-C1 through M-C10, M-D1 through M-D8, M-E2 through M-E15, M-F3) **must** list an a11y test bucket and an `axe-core scan: zero violations` gate clause. The current draft is partially compliant; the design-polish pass that follows this section will finish the audit.

### Theming (Dark + Light)

Tailwind v4 with CSS custom properties; `:root[data-theme="light"]` defines the light palette, `:root[data-theme="dark"]` overrides. The theme attribute is set on `<html>` via `document.documentElement.setAttribute('data-theme', resolved)` (per M-B1's `SettingsContext`). Tailwind v4's `@custom-variant dark` is wired against `[data-theme="dark"]` so utility classes (`dark:bg-*`) stay synchronized with the same attribute — there is no `.dark` class selector anywhere in the codebase. Plot renderers read tokens via `getComputedStyle(document.documentElement).getPropertyValue('--accent')` — no hardcoded colors in renderer code.

**Token palette** (declared in `frontend-v2/src/theme/tokens.css`):

- Surface tokens: `--bg`, `--bg-elev` (1dp lift, used for sidebar/topbar), `--bg-elev-2` (modal / popover surfaces).
- Foreground tokens: `--fg` (body text), `--fg-muted` (secondary text, hint copy), `--fg-faint` (disabled states).
- Accent tokens: `--accent` (primary brand / focus ring), `--accent-fg` (text on accent backgrounds).
- Semantic tokens: `--danger`, `--danger-fg`, `--warn`, `--warn-fg`, `--ok`, `--ok-fg`, `--info`, `--info-fg`.
- Chart palette: `--chart-1` through `--chart-12` — 12 categorical colors, contrast-tested in pairs, color-blind safe (uses the Okabe-Ito palette as the seed with two extra perceptually-distinct additions for series counts up to 12).
- Brush / coupling tokens: `--brush-bg` (semi-transparent fill), `--brush-stroke`, `--coupling-link`, `--coupling-stale`.

**Persistence**: theme stored in `localStorage` under `jfr-notebook/workspace.theme` (slice owned by M-F2 alongside `$$theme`); system-preference default via `prefers-color-scheme`; ⌘⇧T toggles (per showcase §0a topbar shortcut). Theme switch is instant — no transition flash, achieved by setting `color-scheme: dark` / `color-scheme: light` on `<html>` before the first paint.

**Files**:
- `frontend-v2/src/theme/tokens.css` (create) — `:root[data-theme="light"]` + `:root[data-theme="dark"]` token declarations (no `.dark` class selector — the attribute is the single source of truth, matching the Design Polish token block below).
- `frontend-v2/src/theme/themeStore.ts` (create) — `useTheme()` hook + `setTheme(t)` action, syncs with `localStorage`.
- `frontend-v2/src/theme/contrastChecker.ts` (create) — pure WCAG-AA checker, used in tests.
- `frontend-v2/src/__tests__/theme/contrast.test.ts` (create) — iterates every declared `(fg, bg)` token pair, asserts AA passing.
- `frontend-v2/src/__tests__/visual/themes.spec.ts` (create) — Storybook snapshots in both modes for every component in `components/`.

**Per-milestone gate**: every plot renderer (M-C1–C5) and every component milestone must include a visual-regression snapshot in both light and dark. The `themes.spec.ts` runner iterates all stories.

### Keyboard-First Navigation

Every action accessible via keyboard. The central registry is `frontend-v2/src/keyboard/shortcuts.ts` — a single object map from chord to action, with conflict detection at module load (throws if two registrations claim the same chord).

**Global shortcuts** (citing showcase §0a topbar shortcut block):

| Chord | Action | Owning milestone |
|---|---|---|
| ⌘P | Command palette | M-B6 |
| ⌘K | Agent (inline chat focused on current cell) | M-D4 |
| ⌘⇧K | Agent (chat panel maximize) | M-D1 |
| ⌘⇧E | Issues panel toggle | M-B5 |
| ⌘⇧A / ⌥A | Activity feed drawer | M-B7 |
| ⌘⇧T | Theme toggle | M-B1 (theme), tokens from this section |
| ⌘⇧R | Redaction modal | M-E15 |
| ⌘⇧H | History / checkpoint drawer | M-E14 |
| ⌘⇧F | Find across cells | M-B8 |
| ⌘/ | Docs modal | M-B8 |
| ⌘\\ | Sidebar collapse / expand | M-B2 |
| ⌘G | Dep-graph overlay | M-B4 |
| ⌘⇧S | Save share-link modal | M-E11 |
| ⌘. | "Fix with agent" on focused cell error | M-D4 |
| ⌥↵ | Quickfix menu on focused diagnostic | M-B5 |

**Cell-level shortcuts** (cell must be focused):

| Chord | Action | Owning milestone |
|---|---|---|
| ⌘↵ | Run current cell | M-A6 + M-B6 |
| ⇧↵ | Run + advance | M-A6 + M-B6 |
| ⌘D | Duplicate cell | M-B6 |
| ⌥↑ / ⌥↓ | Move cell up / down | M-B6 |
| ⌘⇧↑ / ⌘⇧↓ | Jump to first / last cell | M-B6 |
| / (in cell) | Slash menu | M-C10 |
| $ (in cell) | Variable autocomplete | M-E1 / M-F3 |
| ? (browse mode) | Keyboard help modal | M-B8 |

A **skip-link** (`frontend-v2/src/components/Shell.tsx`) becomes the first focusable element on `Tab` from app-load: "Skip to current cell." Activates focus on the cell selected in the dep graph (or the first cell if none).

Modals (palette, agent maximize, docs, dep-graph overlay, share-link, redaction, checkpoint drawer, keyboard help) use a focus trap and `ESC` to close. Focus returns to the trigger on close.

**Files**:
- `frontend-v2/src/keyboard/shortcuts.ts` (create) — central registry + conflict detector.
- `frontend-v2/src/keyboard/useShortcut.ts` (create) — hook, wraps `window.addEventListener('keydown')` with chord parsing.
- `frontend-v2/src/keyboard/focusTrap.ts` (create) — for modals.
- `frontend-v2/src/__tests__/keyboard/conflictDetection.test.ts` (create) — module-load conflict throws.
- `frontend-v2/src/__tests__/keyboard/globalShortcuts.e2e.ts` (create) — Playwright walks the chord table above.

### Internationalization (i18n) — Out of Scope for v1.0

v1.0 ships **english-only**. The decision is intentional: locking the surface down before the design converges is wasted effort. But two cheap habits keep the door open:

- **Copy lives in a single map**: `frontend-v2/src/copy/en.ts` exports an object of every user-visible string keyed by a stable identifier (`copy.errors.sqlSyntax`, `copy.empty.cells`, etc.). Components import keys, never inline literals. A later i18n pass extracts the map to `i18next` or similar without touching component code.
- **No `Intl` lock-in**: timestamps render via `value.toLocaleString()` with no explicit locale (the browser's default is correct), and numeric units (bytes, ms, ns) format via showcase §1b.7's policy so the unit choice is data-driven, not locale-driven.
- **No RTL support**: but the document grid uses CSS logical properties (`margin-inline-start` not `margin-left`, `padding-block-end` not `padding-bottom`) where convenient. The cost is zero and future RTL becomes a stylesheet change.

**Documented in README**: a "v2 is english-only" line plus the above habits so contributors know the rules without re-reading this plan.

### Loading & Empty States

Every async surface ships **three** non-data states alongside the data state:

- **Loading**: Tailwind `animate-pulse` skeleton matching the final layout's bounding box. No spinners; no opacity flash; the skeleton occupies the same space the rendered content will occupy so layout never shifts on data arrival.
- **Empty**: friendly copy + a primary CTA. Examples: "No cells yet. Add your first cell." (welcome cell — M-B6); "No issues — your notebook is green." (issues panel empty state — M-B5); "No checkpoints yet. ⌘⇧K to capture one." (checkpoint drawer — M-E14); "No workspace globals yet — declare with `$$name = …`." (varbar workspace section — M-F3).
- **Error**: a red banner with a one-line headline ("Couldn't render line chart"), technical details collapsed under a `<details>` toggle, and a "Copy details" button that copies the redacted stack trace to the clipboard.

**Per-milestone gate**: every UI milestone explicitly enumerates the three states in its Files block and a test bucket covers each. The design-polish pass that follows verifies coverage; the canonical implementations live in `frontend-v2/src/components/states/{Skeleton,Empty,Error}.tsx` so individual milestones compose rather than reinvent.

### Performance Budgets

The numbers below are hard gates — exceeding any blocks a PR until either the budget is justified (with a doc update) or the regression is fixed.

| Budget | Target | Measurement | Owning gate |
|---|---|---|---|
| Cold start TTI | < 2s on M1 MacBook (Lighthouse mobile preset, simulated) | Lighthouse CI run in `frontend-v2/lighthouserc.json` | M-B1 |
| DuckDB query → first cell render | < 200ms for queries returning <10k rows | Playwright `performance.now()` around `runCell` | M-A6 |
| Brush drag → consumer cell re-execute | < 150ms (60fps target = 16ms frame; query gets ~10 frames) | Playwright trace, p95 frame time during a 5s drag | M-E2 |
| Bundle size | < 500KB gzipped initial JS | Rollup `bundle-analyzer` in CI; DuckDB-WASM lazy-loaded (only counts the loader, not the WASM) | M-A6 |
| Memory ceiling | < 500MB heap for 200-cell notebook with 1MB DuckDB result cache per cell | `performance.measureUserAgentSpecificMemory()` on Chromium in e2e | M-B7 (notebook store) |
| Plot renderer p95 frame time | < 16ms during interactive zoom/brush on 100k-point dataset | M-C1's renderer fixture harness | M-C1 |
| Worker round-trip overhead | < 5ms for a query whose execution time is 0ms (i.e., overhead only) | M-A6 worker fixture | M-A6 |

**Tooling**:
- Lighthouse CI on every PR — `frontend-v2/lighthouserc.json` with the four-budget assertion (TTI, performance score ≥ 95, accessibility score ≥ 95, total bundle).
- A long-running e2e test (`frontend-v2/src/__tests__/e2e/perfBudgets.e2e.ts`) seeds a 200-cell notebook, brushes for 5 seconds, opens 10 plots simultaneously, and asserts the p95 frame time + memory ceiling.
- Bundle analyzer artifact uploaded per PR; reviewers see the diff.

### Telemetry & Privacy

v1.0 ships **zero external telemetry**. This is a feature, not an oversight — JFR files contain operational data (hostnames, thread names, stack traces, user identifiers) that a notebook tool should never exfiltrate. The posture is:

- The activity feed (M-B7) is local-only; entries live in `localStorage` under `jfr-notebook/workspace.activity` and never leave the browser.
- The audit log (M-D8) is local-only; `last_ai_session` round-trips through frontmatter but does not POST.
- No analytics SDK is bundled; no `fetch` to a `*.anthropic.com` / `*.openai.com` / `*.example.com` is issued unless the user has explicitly configured an LLM provider (M-D6 / §7b.7–8 model selector). A network panel inspection on a freshly-loaded notebook (with no provider configured) shows **only** the static asset fetches.
- The "Report issue" CTA in `AppBoundary.tsx` opens a `mailto:` link — no in-app form, no auto-POST.

**Documented in README**: a "no-telemetry" section that calls this out at install time. Trust is earned by being legible about what the tool does and does not do; this is load-bearing for adoption among users handling sensitive `.jfr` files (which is most production JFR users).

**Per-milestone gate**: any milestone that adds a `fetch` call (M-D2 agent tools, M-D6 model bundle download, M-E11 share-link sidecar) must explicitly enumerate the network surface and justify it. The design-polish pass audits the network footprint.

---

## Showcase Coverage Matrix

Every numbered section from `showcase.html` is mapped to one or more milestones below. The mapping is built by reading the showcase TOC (lines 275–8815) and cross-referencing the per-milestone "Showcase" lines in this plan. A `⚠️ uncovered` flag in the Notes column means the section has no milestone owner — every flag is a bug in the plan, not a feature being deferred.

| Showcase section | Title | Milestone(s) | Notes |
|---|---|---|---|
| §0 | Architecture intro — Vite + Vitest + Playwright stack, COOP/COEP, SharedArrayBuffer | M-A0 | Scaffold milestone owns the build/test runner config + COOP/COEP headers that gate every later milestone |
| §0a | The whole app at a glance | M-B1, M-B6, keyboard shortcuts cross-cutting | Topbar layout in M-B1; ⌘P / ⌘K / etc. registry in M-B6 + cross-cutting keyboard section |
| §0a.1 | Cell anatomy — head and body | M-B1, M-C1 | Head zone (chips, status, ⋯) in M-B1's `CellHeader.tsx`; body routing to plot states in M-C1 |
| §0a.2 | Per-cell ⋯ menu | M-B6 | `CellMenu.tsx` populated in M-B6 (palette / shortcut handlers wired) |
| §0b | The sidebar — three nav panels & live preview | M-B2, M-B3 | M-B2 ships the three panels (placeholders); M-B3 ships the live preview pane |
| §0b.1 | The three nav panels (TABLES / VIEWS / MACROS) | M-B2, M-C10 | TABLES + VIEWS in M-B2; MACROS panel populated by M-C10 |
| §0b.2 | The preview pane | M-B3 | Whole pane is M-B3 |
| §0b.2.1 | The editable SQL line | M-B3 | In `PreviewPane.tsx` |
| §0b.2.2 | Sorting and filtering | M-B3 | Per-column filter, sort header in M-B3 |
| §0b.2.3 | Save as cell | M-B3 | Button writes a new SQL cell into the notebook store |
| §0b.3 | Why this shape | M-B2 | Rationale captured in M-B2 agent prompt |
| §0c | JFR ingest — from .jfr to queryable tables | M-A7 | GraalVM `jfr-importer.js` integration |
| §0c.1 | The drop overlay | M-B1, M-A7 | Drop-target UI in `Shell.tsx`; ingest wiring in M-A7 |
| §0c.2 | Parse progress | M-A7 | Progress events from worker → topbar status pill (M-B1) |
| §0c.3 | Recording metadata card | M-A7 | Metadata card emitted as a cell after ingest |
| §0c.4 | Failure modes | M-A7, M-B5 | Ingest errors land in the issues panel via M-B5 |
| §0c.5 | Capturing a JFR recording | M-B8 (docs) | Educational content in the docs modal; no runtime code |
| §0c.5.1 | Settings profile: profile vs default | M-B8 (docs) | Docs-only |
| §0c.5.2 | Event types this notebook indexes as tables | M-B8 (docs), M-A7 | Docs reference; index list lives in M-A7's importer config |
| §0c.6 | Why this matters | M-B8 (docs) | Docs-only |
| §0d | Save, autosave, and persistence | M-B1, M-F2 | OPFS persistence in M-B1; workspace slice in M-F2 |
| §0d.1 | The three storage destinations | M-B1, M-F2 | localStorage workspace slice owned jointly: M-B1 base, M-F2 `$$x` |
| §0d.2 | The save model | M-B1 | OPFS / autosave debounced commit |
| §0d.3 | Crash recovery | M-B1, M-E14 | OPFS journal in M-B1; checkpoint fallback in M-E14 |
| §0d.4 | External edits & conflicts | M-B1 | OPFS watcher emits conflict prompt |
| §0d.5 | What is not saved | M-B1 | Documented in agent prompt; tested via "reload should not restore X" cases |
| §0d.6 | Why this matters | M-B1 | Rationale |
| §1a | Getting around — empty state, keyboard, undo, export | M-B6, M-B7, M-C9 | Welcome + palette in M-B6; undo + activity in M-B7; export in M-C9 |
| §1a.1 | Empty state — the welcome cell | M-B6 | `WelcomeCell.tsx` |
| §1a.2 | First-run spotlight carousel | M-B6 | Spotlight overlay in `WelcomeCell.tsx` |
| §1a.3 | Keyboard map — single source of truth | M-B8, cross-cutting keyboard | `KeyboardMap.tsx` modal in M-B8; chord registry in cross-cutting section |
| §1a.4 | Undo — three grains, one ⌘Z | M-B7 | Three-grain undo (text / cell / notebook) |
| §1a.5 | The activity feed — ⌥A | M-B7, M-F3 | Feed UI in M-B7; conflict toast variant in M-F3 |
| §1a.6 | Export — HTML and PDF snapshots | M-C9, M-E12 | Markdown / report export in M-C9; full HTML/PDF in M-E12 |
| §1a.7 | Glyph legend — every symbol in the app | M-B6 | `GlyphLegend.tsx` in palette |
| §1a.8 | Run controls — Run all & Disable cell | M-B6 | Run controls in topbar / cell head |
| §1a.8.1 | Why no Run-above / Run-from-here? | M-A4 (dep-graph) | Rationale: dep-graph determines re-run scope |
| §1a.8.2 | Disabled cells in compare & export | M-E13, M-E12 | Compare honors disabled; export omits disabled |
| §1b | Getting around (continued) | M-B7, M-B8 | Bulk of nav features |
| §1b.1 | Rename cell | M-B6 | Inline rename on cell head |
| §1b.2 | Find across cells | M-B8 | ⌘⇧F |
| §1b.3 | Frontmatter editor | M-B8 | Modal editor on the YAML frontmatter |
| §1b.4 | Reorder cells | M-B6 | ⌥↑ / ⌥↓ + drag handle |
| §1b.5 | Theme switcher | M-B1, cross-cutting theming | ⌘⇧T |
| §1b.6 | Multi-notebook tabs | M-B1 | Tab bar in `Shell.tsx` |
| §1b.7 | Formatting preferences — time, units, locale | M-B1 (settings context), M-C1+ (renderer reads) | `SettingsContext.tsx` |
| §1b.7.1 | Per-plot / per-column overrides | M-C7 | Clause tail processor honors per-plot unit / format |
| §1b.7.2 | The "auto" unit policy | M-C1 | Renderer base auto-picks units by data range |
| §1b.7.3 | Why this matters | M-B1 | Rationale |
| §1c | Command palette | M-B6 | ⌘P |
| §1c.1 | Result kinds | M-B6 | Cells / vars / macros / views / docs |
| §1c.2 | Scoping prefixes | M-B6 | `#cell`, `$var`, etc. |
| §1c.3 | Fuzzy ranking | M-B6 | Fuse.js or equivalent |
| §1c.4 | Preview pane — inspect without leaving the palette | M-B6 | Right-pane preview |
| §1c.5 | Content search — `/` across cells | M-B6, M-B8 | Palette `/` prefix + ⌘⇧F backbone |
| §1c.6 | "Ask AI this question" — always-last fallback | M-B6, M-D1 | Hand-off to chat |
| §1c.7 | Relationship to the slash menu and ? | M-C10 (slash), M-B8 (?) | Cross-references |
| §1c.8 | Custom commands | M-B6 | User-defined entries persisted to workspace |
| §1d | Docs modal — the in-app reference | M-B8 | ⌘/ |
| §1d.1 | Entry points | M-B8 | Topbar `?`, palette `?`, in-cell `?` |
| §1d.2 | Layout | M-B8 | Modal layout |
| §1d.3 | Topics | M-B8 | Topics tree |
| §1d.4 | Search | M-B8 | Full-text search across docs |
| §1d.5 | Deep links & sharing | M-B8 | `#docs:<topic>` URL hash |
| §1d.6 | Why a modal, not a panel | M-B8 | Rationale |
| §2 | The two-sigil variable system | M-E1, M-F2 | `$x` reactive in M-E1; `$$x` in M-F2 |
| §2.4 | `$$` globals — workspace-wide time ranges & constants | M-D0, M-F1, M-F2 | Substrate + store; **`$$ai_providers` secrets slice ports v1 `IAiProvider` + three providers in M-D0** |
| §2.5 | Variable pills — click to inspect, click to edit | M-E7, M-F3 | Pill component in M-E7; `$$x` purple variant in M-F3 |
| §2.6 | Autocomplete — `$` opens a picker, unknown names auto-declare | M-E1, M-F3 | `$x` autocomplete in M-E1; `WORKSPACE · $$` group in M-F3 |
| §2.7 | The `$` variable popover | M-E7 | Range / scalar / brush popovers |
| §2.8 | The `filter_from` chip authoring popover | M-E10 | Chips, chains, promote-to-view |
| §3 | The plot DSL — twelve types, three composers | M-A3 | Sugar parser |
| §3a | The 12 plot types — each one, with its config | M-C1, M-C2, M-C3, M-C4, M-C5 | Five milestones for 12 renderers |
| §3a.1 | The cross-type clauses (`let`, `on`, …) | M-A3, M-C7 | Parsed in M-A3; effects in M-C7 |
| §3b | Plot rendering details | M-C1 | Renderer base |
| §3b.1 | The five plot states | M-C1 | idle / loading / rendered / error / empty |
| §3b.2 | Interactive legend | M-C1 | Legend in renderer base |
| §3b.3 | Hover tooltip | M-C1, M-E3 | Surface in M-C1; coupling in M-E3 |
| §3b.4 | Pinnable annotations | M-C1 | Annotation overlay |
| §3b.5 | On-canvas controls | M-C1 | Zoom / pan controls |
| §3b.6 | Share, copy, fullscreen | M-C1, M-E11 | Local actions in M-C1; share URL in M-E11 |
| §3b.7 | Why this matters | M-C1 | Rationale |
| §3c | Prose cells & report mode | M-C9 | Prose + report mode |
| §3c.1 | The two prose-cell shapes | M-C9 | Block vs inline |
| §3c.2 | Markdown inside prose | M-C9 | Markdown renderer |
| §3c.3 | Embedded references | M-C9 | Embed cell refs / var refs |
| §3c.4 | Report mode | M-C9 | Read-only report layout |
| §3c.5 | Why this matters | M-C9 | Rationale |
| §3d | Macro authoring — the `macro` fence | M-C10 | Macros |
| §3d.1 | The fence | M-A3, M-C10 | Parser in M-A3; UI in M-C10 |
| §3d.2 | Two macro kinds | M-C10 | SQL vs plot macros |
| §3d.3 | The MACROS panel — populated | M-C10 | Sidebar panel |
| §3d.4 | Where macros fit in the dep graph | M-A4 | Dep-graph macro edges |
| §3d.5 | Validation & errors | M-C10, M-B5 | Diagnostics in issues panel |
| §3d.6 | The "promote to macro" shortcut | M-C10 | Quickfix on a SQL cell |
| §3d.7 | Why this matters | M-C10 | Rationale |
| §4 | Cross-cell wiring — `-- @ alias` | M-A2 | SQL parser + alias resolution |
| §4a | Result tables — interactions | M-C8 | Full table interactions |
| §4a.1 | Interaction surface | M-C8 | Sort, filter, pagination |
| §4a.2 | Pagination & large results | M-C8 | Virtualized rows |
| §4a.2.1 | Find within the result (⌘F) | M-C8 | Per-table find |
| §4a.2.2 | Copy & export formats | M-C8 | CSV / JSON / TSV |
| §4a.2.3 | Plot image to clipboard | M-C1, M-C8 | Canvas → clipboard helper |
| §4a.3 | Empty & error states | M-C8 | Three-state per cross-cutting Loading & Empty |
| §4a.4 | Why this matters | M-C8 | Rationale |
| §4b | Recording compare — baseline vs candidate | M-E13 | Baseline attach + DIFF |
| §4b.1 | Attach a baseline | M-E13 | UI + ingest of second recording |
| §4b.2 | Comparison plots | M-E13 | Side-by-side / overlay |
| §4b.3 | The `DIFF()` macro | M-E13 | Built-in macro |
| §4b.4 | Live coupling across recordings | M-E13 | Cross-recording brush sync |
| §4b.5 | Why this matters | M-E13 | Rationale |
| §5 | Live coupling — the headline feature | M-E1, M-E2, M-E3, M-E4, M-E5, M-E6 | Six producer/consumer milestones |
| §5.1 | The five built-in live-var kinds | M-E2–M-E6 | brush, hover, zoom, selection, scroll |
| §5.2 | The `IN $producer.live-var` operator | M-E2 | SQL operator |
| §5.3 | Hover semantics across plot types | M-E3 | Per-type hover schema |
| §5.4 | Panel `name:` clause | M-E8 | Named panels within composed cells |
| §5.5 | Pause / resume coupling | M-E7 | Pause button in varbar |
| §5.6 | Linked zoom — `link-x`, `link-y`, `link-xy` | M-E9 | Zoom clauses |
| §5.7 | `filter_from:` — the chip that survives reload | M-E10 | Persistent filter chips |
| §5.8 | Worked example — four plots, one notebook | M-E2–M-E6, M-E9 | End-to-end e2e in respective milestones |
| §5a | Chains, composition & saved filters | M-E10 | Chip chains |
| §5a.1 | Multiple chips on one cell — AND/OR composition | M-E10 | Boolean composition |
| §5a.2 | Chains — the `🔗 N from #X via #Y` indicator | M-E10 | Chain visualization |
| §5a.3 | Stale propagation across the chain | M-E10 | Staleness flow |
| §5a.4 | Promote-to-view — saved filters as `view <name>` fences | M-E10 | Promote action |
| §5a.5 | Predicate push-down across the chain | M-E10 | Optimization |
| §5a.6 | The full picture — what a 5-hop chain looks like | M-E10 | Worked example tested |
| §6 | Issues panel — one fan, six kinds | M-B5 | Diagnostic panel |
| §6a | SQL-cell autocomplete | M-A2, M-B6 | Parser + completion |
| §6a.1 | Three completion sources | M-B6 | Schema / vars / snippets |
| §6a.2 | Cursor-context detection | M-A2 | Parser exposes context |
| §6a.3 | Variable-value preview | M-E7 | Hover preview from varbar |
| §6a.4 | Snippets | M-B6 | Snippet store |
| §6a.5 | Why this matters | M-B6 | Rationale |
| §6b | Error recovery | M-B5, M-D7 | Issues panel + agent recovery |
| §6b.1 | The four error families | M-B5 | Parse / type / runtime / coupling |
| §6b.2 | The error band — consistent across all families | M-B5, M-C1 | Cell-head band in M-B5; plot state in M-C1 |
| §6b.3 | The quickfix menu — ⌥↵ | M-B5 | Quickfix surface |
| §6b.4 | "Fix with agent" — ⌘. | M-D4 | Hands the error to inline chat |
| §6b.5 | "Revert to green" affordance | M-B7, M-E14 | Undo / checkpoint revert |
| §6b.6 | Errors that span cells — dep-graph view | M-B4 | Cytoscape overlay highlights stale chain |
| §6b.7 | Errors that should not be fatal — tolerant rendering | M-C1 | Renderer state machine |
| §6b.8 | What the user can't recover from — the honest list | M-B5 | Documented in issues panel docs |
| §7 | The agent — cell-scoped, tool-using, proposal-emitting | M-D0, M-D1–M-D8 | Full Phase D; **M-D0 ports the `IAiProvider` contract from v1 as the foundation for everything in Phase D** |
| §7a | Prompt language — typed grammar | M-D5 | Tokenizer + verbs + targets |
| §7b | Chat panel as UI | M-D1 | Drawer + maximize |
| §7b.1 | Docked drawer + maximize overlay | M-D1 | Two-mode panel |
| §7b.2 | The transcript renders interactive cells | M-D1, M-D3 | Live cells in transcript |
| §7b.3 | Context inspector — "what did the model see?" | M-D1 | Inspector pane |
| §7b.4 | `last_ai_session:` — audit log peer of `last_ai_prompt:` | M-D8 | Audit log round-trip |
| §7b.5 | Permission surfaces — data access stays visible | M-D2 | Tool permission badges |
| §7b.6 | Cell-scope vs notebook-scope chat | M-D1 | Two scopes |
| §7b.7 | External LLM vs local model — two paths reconciled | M-D0, M-D1, M-D6 | External path is **`IAiProvider`** (ported in M-D0 from v1: Gemini/OpenAI/Gardener); local path is the ~25M ONNX model (M-D6); selector wired in M-D1 |
| §7b.8 | Model selector — pick the backend per notebook | M-D1 | Per-notebook setting |
| §7c | Tool surface & cell proposals | M-D2, M-D3 | Tools + cell-emit |
| §7c.1 | The ten tools — MCP-style JSON tool-use | M-D2 | Tool registry |
| §7c.2 | Two tools earn their keep — `docs` and `diagnose` | M-D2 | Specific tools |
| §7c.3 | Tool calls in the transcript | M-D1 | `ToolCall.tsx` |
| §7c.4 | Sandboxing `run_sql` | M-D2 | Sandbox semantics |
| §7c.5 | The `cell-emit` proposal — what the LLM produces | M-D3 | Proposal schema |
| §7c.6 | Accept / reject mechanics | M-D3 | Atomic accept/reject |
| §7c.7 | What an accepted cell carries | M-D3 | Provenance frontmatter |
| §7c.8 | Live preview in the transcript | M-D3 | Preview while pending |
| §7c.9 | Why "propose, don't write" | M-D3 | Rationale |
| §7d | Inline chat — Copilot-style cursor overlay | M-D4 | Overlay |
| §7d.1 | The overlay | M-D4 | UI |
| §7d.2 | What's the same as the drawer, what's different | M-D4 | Reuse + differences |
| §7d.3 | `check_render` in the inline loop | M-D2, M-D4 | Validation tool wired into inline |
| §7d.4 | Multi-cell proposals stay atomic | M-D3, M-D4 | Atomic groups in inline flow |
| §7d.5 | Frontmatter & provenance | M-D8 | Provenance round-trip |
| §7e | Agent failure modes — rate limits, timeouts, loops, recovery | M-D7 | Failure handling |
| §7e.1 | The six failure modes | M-D7 | Classification |
| §7e.2 | The turn-state machine | M-D7 | State machine |
| §7e.3 | Tool-loop detection | M-D7 | Loop break logic |
| §7e.4 | Provider failover — model-switch escape hatch | M-D7 | Failover |
| §7e.5 | The token budget | M-D7 | Budget enforcement |
| §7e.6 | Mid-stream interruption — what survives | M-D7 | Partial state preservation |
| §7e.7 | The "what just happened?" panel | M-D7 | Post-mortem panel |
| §7e.8 | Refused tool calls vs failed tool calls | M-D7 | Distinction |
| §8 | Formatter — one canonical shape | M-A5 | Formatter |
| §8.4 | Format-on-save — the diff view | M-A5 | Diff UI |
| §8.5 | Round-trip — git diff stays clean | M-A5 | Idempotency proof |
| §8a | Performance — caches, materialization, push-down, cancellation | M-A6, M-E10, cross-cutting perf | Full perf story |
| §8a.1 | Budget — what "fast" means | cross-cutting perf | Budgets table above |
| §8a.2 | Result caching with quantized `$`-keys | M-A6 | DuckDB worker cache |
| §8a.3 | Materialization tiers — the `auto` policy | M-A6 | Tier policy in worker |
| §8a.4 | Predicate push-down across chains | M-E10 | Chip-chain push-down |
| §8a.5 | Cascading cancellation | M-A6 | AbortSignal propagation |
| §8a.6 | Perf visibility — always-on surface | M-B1 | Topbar perf pill |
| §8a.7 | The perf inspector — clicking a red badge | M-B1 | Inspector modal |
| §8a.8 | Where each mechanism lives in the worker boundary | M-A6 | Worker arch doc |
| §8a.9 | Why this matters — perf story end to end | M-A6 | Rationale |
| §8a.10 | Long-running query UX | M-A6 | Progressive UI |
| §8a.10.1 | Escalation rules | M-A6 | 1s / 5s / 30s thresholds |
| §8a.10.2 | Cancellation guarantees | M-A6 | Within 100ms |
| §8a.10.3 | Why a "show plan" button matters | M-A6 | EXPLAIN integration |
| §9 | Cheatsheet — everything you need on one page | M-B8 | Cheatsheet inside docs modal |
| §9.1 | Variable sigils & references | M-B8 | Docs section |
| §9.2 | Plot DSL — the 12 types | M-B8 | Docs section |
| §9.3 | Cross-type clauses — the `\|` tail | M-B8 | Docs section |
| §9.4 | Composers | M-B8 | Docs section |
| §9.5 | SQL — cross-cell aliasing | M-B8 | Docs section |
| §9.6 | Live-var operators in SQL | M-B8 | Docs section |
| §9.7 | Prompt grammar (chat & inline) | M-B8 | Docs section |
| §9.8 | Keyboard shortcuts | M-B8, cross-cutting keyboard | Docs section + registry |
| §9.9 | Frontmatter keys | M-B8 | Docs section |
| §9.10 | The thirty-second tour | M-B8 | Spotlight script |
| §10 | Shareable URLs — every finding is re-explorable | M-E11 | Share URL |
| §10.4 | The Copy share-link modal | M-E11 | Modal UI |
| §10.5 | Recipient view — what they see on open | M-E11 | Recipient route |
| §10a | Accessibility & activity feed | M-B7, cross-cutting a11y | Activity feed in M-B7; a11y commitments in cross-cutting |
| §10a.1 | Accessibility commitments | cross-cutting a11y | Owned by cross-cutting section |
| §10a.2 | Activity feed | M-B7 | Feed UI |
| §10a.3 | Time travel from the activity feed | M-B7 | Time-travel undo |
| §10a.4 | Privacy & size | M-B7, cross-cutting telemetry | Local-only, capped |
| §10b | Checkpoints & version history | M-E14 | Checkpoints |
| §10b.1 | Auto + manual checkpoints | M-E14 | 10-min cadence + ⌘⇧K |
| §10b.2 | The checkpoint drawer | M-E14 | Drawer UI |
| §10b.3 | Restore & diff | M-E14 | Diff view |
| §10b.4 | Storage budget & eviction | M-E14 | 80% / 100% gates |
| §10b.5 | Relationship to other persistence | M-E14 | Doc |
| §10b.6 | Why this matters | M-E14 | Rationale |
| §10c | Redaction — PII control on share & export | M-E15 | Redaction |
| §10c.1 | The redaction modal | M-D0, M-E15 | Modal UI in M-E15; **M-A5 owns the `$$ai_providers` → notebook scrub rule** (API keys never enter notebook files); M-D0 relies on this guarantee |
| §10c.2 | The two transforms | M-E15 | hash + mask |
| §10c.3 | Where redaction applies | M-E15 | Share, export, agent |
| §10c.4 | The redaction badge | M-E15 | Badge |
| §10c.5 | What redaction does not do | M-E15 | Honest list, in agent prompt |
| §10c.6 | Why this matters | M-E15 | Rationale |
| §11 | Six-phase roadmap | (this plan's phase structure) | The plan's Phase A–F mirrors §11 |
| §12 | Where to read more | M-B8 | References surfaced in docs modal |
| §12.x (By iteration / How to read) | Reading guide | M-B8, M-A0 | Docs index; perf budgets in §12 require SharedArrayBuffer enabled by M-A0's COOP/COEP headers |

**Coverage summary**: every numbered showcase section is mapped to at least one milestone. Zero `⚠️ uncovered` entries. Six sections (§0c.5, §0c.5.1, §0c.5.2, §0c.6, §1d.6, §3c.5, the §-rationale subsections, and §12.x) map to M-B8 (docs) because they are reference content that ships as in-app docs, not runtime features.

---

<!-- Cross-cutting + coverage matrix complete. Design polish iteration pass appended below. -->

## Design Polish

### Visual Quality Bar

Every shipped surface must look like it came from the showcase mockup. Functional-but-ugly is a regression, not a tradeoff — a milestone that computes correctly but ships a surface that drifts from the showcase reference is considered incomplete and shall be sent back for polish before being marked done. Three reference surfaces anchor the bar: the **topbar** (showcase §0a — the 44px header with file chip, theme toggle, agent toggle, and run controls; precise spacing and chip styling matters), the **varbar** (showcase §3 — the static + live variable strip above the notebook, with its amber static chips and cyan live chips with gradient backgrounds), and the **dep-graph overlay** (showcase §0b — the modal that overlays the notebook with animated edges, hit-test labels, and an axis-link orange highlight). If any of those three surfaces looks wrong, the design system itself is wrong; fix the tokens first, not the surface.

### Design Tokens (mandatory)

All visual values must be declared as CSS custom properties in `frontend-v2/src/theme/tokens.css` and referenced from every component. No component file (`.tsx`, `.ts`, `.css`) outside `tokens.css` may contain a hardcoded hex color, an `rgb()`/`rgba()` literal with numeric channels, or a pixel value (with a narrow allowlist for `1px` borders and `0`/`auto`). A CI lint rule enforces this — see "Lint Rule" subsection below.

```
/* frontend-v2/src/theme/tokens.css */
:root[data-theme="dark"] {
  /* ---- Color: surfaces (elevation ladder, lowest → highest) ---- */
  --bg-base:        #0d1117;  /* app background */
  --bg-elev-1:      #151a23;  /* topbar, status bar, panel headers */
  --bg-elev-2:      #161b25;  /* sidebar, cell body, chat panel */
  --bg-elev-3:      #1c2330;  /* chips, pills, hover backgrounds */

  /* ---- Color: foreground (contrast ladder, highest → lowest) ---- */
  --fg-strong:      #e8edff;  /* headings, primary text on focused surface */
  --fg-default:     #d8def0;  /* body text */
  --fg-muted:       #6b7896;  /* secondary text, metadata */
  --fg-dim:         #4a5468;  /* tertiary text, separators in copy */

  /* ---- Color: borders (subtle → strong) ---- */
  --border-subtle:  #1f2531;  /* internal dividers within a surface */
  --border-default: #232a37;  /* between surfaces */
  --border-strong:  #2e3645;  /* buttons, inputs, emphatic divisions */

  /* ---- Color: accents (semantic) ---- */
  --accent-cyan:    #22d3ee;  /* data dependencies, focus, primary */
  --accent-amber:   #fbbf24;  /* static vars, cell aliases */
  --accent-purple:  #a78bfa;  /* AI / prompt deps */
  --accent-green:   #10b981;  /* ok / success */
  --accent-red:     #ef4444;  /* error */
  --accent-yellow:  #f59e0b;  /* running / in-progress */
  --accent-stale:   #8b5cf6;  /* stale state */
  --accent-orange:  #fb923c;  /* axis-link */
  --live-cyan:      #06b6d4;  /* live-var pulse */

  /* ---- Chart palette (12 categorical colors, tuned for dark bg) ---- */
  --chart-1:        #22d3ee;  --chart-2:  #fbbf24;
  --chart-3:        #a78bfa;  --chart-4:  #10b981;
  --chart-5:        #fb923c;  --chart-6:  #f472b6;
  --chart-7:        #60a5fa;  --chart-8:  #facc15;
  --chart-9:        #34d399;  --chart-10: #c084fc;
  --chart-11:       #fb7185;  --chart-12: #38bdf8;
}

:root[data-theme="light"] {
  --bg-base:        #f7f8fb;
  --bg-elev-1:      #ffffff;
  --bg-elev-2:      #fbfcfe;
  --bg-elev-3:      #eef1f6;

  --fg-strong:      #0b1020;
  --fg-default:     #1f2535;
  --fg-muted:       #5a6478;
  --fg-dim:         #8b94a8;

  --border-subtle:  #eaedf3;
  --border-default: #dde1ea;
  --border-strong:  #c4cad6;

  --accent-cyan:    #0891b2;
  --accent-amber:   #d97706;
  --accent-purple:  #7c3aed;
  --accent-green:   #059669;
  --accent-red:     #dc2626;
  --accent-yellow:  #d97706;
  --accent-stale:   #6d28d9;
  --accent-orange:  #ea580c;
  --live-cyan:      #0891b2;

  --chart-1:  #0891b2; --chart-2:  #d97706; --chart-3:  #7c3aed; --chart-4:  #059669;
  --chart-5:  #ea580c; --chart-6:  #db2777; --chart-7:  #2563eb; --chart-8:  #ca8a04;
  --chart-9:  #047857; --chart-10: #9333ea; --chart-11: #e11d48; --chart-12: #0284c7;
}

:root {
  /* ---- Spacing (4px base scale) ---- */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-7:  32px;
  --space-8:  48px;
  --space-9:  64px;

  /* ---- Typography ---- */
  --font-display: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono:    "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --text-xs:   11px;
  --text-sm:   12px;
  --text-base: 13px;
  --text-md:   14px;
  --text-lg:   16px;
  --text-xl:   20px;
  --text-2xl:  24px;
  --lh-tight:    1.2;
  --lh-snug:     1.4;
  --lh-normal:   1.5;
  --lh-relaxed:  1.6;

  /* ---- Radius ---- */
  --radius-sm:   4px;
  --radius-md:   8px;
  --radius-lg:   12px;
  --radius-pill: 9999px;

  /* ---- Shadow ---- */
  --shadow-sm:        0 1px 2px rgba(0, 0, 0, 0.25);
  --shadow-md:        0 4px 12px rgba(0, 0, 0, 0.32);
  --shadow-lg:        0 12px 32px rgba(0, 0, 0, 0.42);
  --shadow-glow-cyan:  0 0 0 1px var(--accent-cyan), 0 0 16px rgba(34, 211, 238, 0.35);
  --shadow-glow-amber: 0 0 0 1px var(--accent-amber), 0 0 16px rgba(251, 191, 36, 0.32);

  /* ---- Motion ---- */
  --duration-fast:  120ms;
  --duration-base:  180ms;
  --duration-slow:  320ms;
  --ease-out:       cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out:    cubic-bezier(0.45, 0, 0.55, 1);

  /* ---- Z-index ---- */
  --z-base:    0;
  --z-sticky:  100;
  --z-overlay: 200;
  --z-modal:   300;
  --z-toast:   400;
  --z-tooltip: 500;
}
```

**Lint rule** (CI-enforced, runs on every PR):

```bash
# scripts/lint-design-tokens.sh — fails CI if violations found
set -e
SRC=frontend-v2/src
# 1. No hex literals outside tokens.css
git grep -nE '#[0-9a-fA-F]{3,8}\b' -- "$SRC" \
  | grep -v 'theme/tokens.css' \
  | grep -vE '//\s*allow-hex' \
  && { echo "ERROR: hardcoded hex color outside tokens.css"; exit 1; } || true
# 2. No pixel values outside tokens.css (except 1px borders and 0)
git grep -nE ':\s*[0-9]+(\.[0-9]+)?px\b' -- "$SRC" \
  | grep -v 'theme/tokens.css' \
  | grep -vE ':\s*1px\b' \
  | grep -vE '//\s*allow-px' \
  && { echo "ERROR: hardcoded pixel value outside tokens.css"; exit 1; } || true
# 3. No rgb/rgba with numeric channels outside tokens.css
git grep -nE 'rgba?\(\s*[0-9]' -- "$SRC" \
  | grep -v 'theme/tokens.css' \
  && { echo "ERROR: hardcoded rgb/rgba outside tokens.css"; exit 1; } || true
echo "design-tokens lint OK"
```

The lint script must be wired into the `frontend-v2` package.json `lint` task and into the CI workflow gate. Any milestone whose PR violates these rules is blocked.

### Typography Scale

The app uses two type families: **Inter** for display/UI (`--font-display`) and **JetBrains Mono** for code/identifiers/metrics (`--font-mono`). Both are loaded via `@fontsource/inter` and `@fontsource/jetbrains-mono` (no Google Fonts CDN — offline-capable). The scale is fixed; no surface invents its own font size.

| Role | Size | Weight | Line-height | Tracking | Notes |
|---|---|---|---|---|---|
| App title (welcome screen h1) | 24px | 700 | 1.2 | -0.02em | Only on welcome screen |
| Section heads (sidebar panels) | 11px | 600 | 1.2 | +0.06em | UPPERCASE, `--fg-muted` |
| Cell heading / alias | 14px | 600 | 1.4 | 0 | Mono for alias `$cellId`; display for prose |
| Body text | 13px | 400 | 1.6 | 0 | Default everywhere |
| SQL / code | 13px | 400 | 1.5 | 0 | Mono |
| Metadata pills | 11px | 500 | 1.2 | 0 | Mono |
| Status bar / shortcuts | 11px | 400 | 1.2 | 0 | Mono |
| Tooltip body | 11px | 400 | 1.4 | 0 | Mono |
| Button label | 12px | 500 | 1.2 | 0 | Display |

**No font-size below 11px anywhere.** Every size referenced via the `--text-*` token; no raw `font-size: 13px` in component CSS.

### Spacing Rhythm

The app uses a **strict 4px base grid**. Every margin, padding, gap, and (where applicable) absolute position must be a multiple of 4. The token scale (`--space-1` through `--space-9`) covers the legal values; if a surface needs a value outside the scale, the scale is wrong — extend the token, do not inline.

Canonical rhythms (memorize these; reach for tokens that produce them):

| Surface | Token | Value |
|---|---|---|
| Inter-cell gap | `--space-4` | 16px |
| Cell internal padding | `--space-4` | 16px |
| Collapsed cell padding | `--space-3` | 12px |
| Sidebar panel padding | `--space-3` | 12px |
| Sidebar row padding | `--space-1` `--space-3` | 4px 12px |
| Modal padding | `--space-6` | 24px |
| Tooltip padding | `--space-2` `--space-3` | 8px 12px |
| Pill padding | `--space-1` `--space-2` | 4px 8px |
| Topbar height | (fixed) | 44px |
| Status bar height | (fixed) | 24px |
| Sidebar default width | (fixed, resizable) | 280px |
| Sidebar collapsed width | (fixed) | 56px |
| Varbar default width | (fixed, resizable) | 320px |
| Icon button hit target | min 28×28px | wraps icon |

**Lint rule extension**: the design-tokens lint script (above) already rejects raw pixel literals; the spacing grid is enforced as a consequence. Additionally, the eslint config adds a custom rule `design/spacing-multiple-of-4` that scans inline-style props (`style={{ padding: 17 }}` etc.) and rejects non-multiples of 4.

### Micro-Interactions (mandatory list)

Every interactive element shall declare at minimum:

- **Hover state** — `transition: background-color var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)`; the background or border (or both) shifts one elevation step.
- **Active/pressed** — `transform: scale(0.98)`; `transition: transform 80ms var(--ease-out)`; restored on pointer-up.
- **Focus** — `outline: 2px solid var(--accent-cyan); outline-offset: 2px;` instant (no transition); applied via `:focus-visible` so mouse clicks do not trigger it.
- **Disabled** — `opacity: 0.5; cursor: not-allowed; pointer-events: none;`.
- **Loading** — either a shimmer skeleton at 1.4s cycle **or** a 1s spinner; never both on the same surface.

Surface-specific micro-interactions that must be present at acceptance:

- **Brush drag handles** (plots): cursor changes — `col-resize` on the left/right edges (within 6px of edge), `ew-resize` within the brush body, `crosshair` outside the brush on the plot area, `default` elsewhere.
- **Cell drag-to-reorder**: while dragging, the cell card lifts with `box-shadow: var(--shadow-lg)` and rotates 2deg; drop target shows a 2px `--accent-cyan` rail above/below.
- **Issue panel row**: hover slides a 2px `--accent-cyan` rail in from the left edge (translateX from -2px to 0 over `--duration-fast`).
- **Agent proposal Accept button**: idle is outline (`border: 1px solid --accent-cyan`, transparent fill); hover fills `--accent-cyan` with `--fg-strong` text; click scales the white check icon 1.0 → 1.1 → 1.0 over 240ms.
- **Live-var pill**: when its value updates, pulses `box-shadow: var(--shadow-glow-cyan)` at 1.4s cycle for up to 3 cycles (4.2s) **only if** the value has changed in the last 600ms; otherwise idle (no animation). Re-triggers on each new change.
- **Dep graph node**: hover thickens stroke from 1.5px to 2.5px; click expands sub-graph with a 240ms `--ease-out` morph (node spreads radially, edges follow).
- **Plot canvas**: cursor is `crosshair` within the plot frame; on hover, a 1px dashed `--fg-muted` vertical+horizontal guide tracks the pointer; data point under cursor scales from 3px → 5px.
- **Modal entrance**: 180ms `--ease-out` fade-in (opacity 0 → 1) combined with translateY(4px → 0); exit reverses with the same duration.
- **Topbar run button**: idle `--fg-default`; hover swaps to `--accent-green` icon; pressed shows a brief 80ms `transform: scale(0.96)`.
- **Sidebar accordion**: chevron rotates from 0deg → 90deg over `--duration-base` with `--ease-out`; body height animates with `grid-template-rows: 0fr → 1fr` trick (no JS height measurement).
- **Varbar pause button**: filled `--accent-amber` when paused, outlined when live; transition `--duration-fast`.

**Reduced motion** (`@media (prefers-reduced-motion: reduce)`): replace all transitions with `transition: none`; replace all `transform`-based animations with instant state changes; keep visual states (hover background, focus outline) — they still convey information without motion.

### Empty / Loading / Error State Library

The per-milestone gate (Cross-Cutting Concerns) already requires that every UI surface ships these three states. This section codifies their look.

**Empty state**

- Centered vertically + horizontally in the surface
- Icon (Lucide, size 32px / `--text-2xl` equivalent, `color: var(--fg-dim)`)
- Headline (`--text-md`, weight 600, `--fg-default`) — one short sentence
- Subhead (`--text-sm`, `--fg-muted`) — one short sentence, optional
- Primary CTA button (optional, only if a single obvious action exists)
- Min surface height before showing: 120px (smaller surfaces just stay blank)

Reference surfaces: empty notebook ("Drop a `.jfr` file or open a sample"), no issues ("No issues detected"), no live-vars ("Mark a cell live to start streaming"), no search results, empty agent history.

**Loading skeleton**

- Skeleton blocks match the final layout dimensions exactly (no jumps when content lands)
- Shimmer: `background: linear-gradient(90deg, transparent, var(--bg-elev-2), transparent); background-size: 200% 100%; animation: shimmer 1.4s linear infinite;`
- Multiple skeleton blocks on the same surface stagger by 80ms to avoid a "wall of pulse"
- Used for fetches >300ms expected duration; instant fetches show nothing

**Loading spinner** (for indeterminate actions < 2s)

- 16px circle, 2px border, top-color `--accent-cyan`, other sides `--border-default`, 1s linear rotate
- Centered in its surface or inline next to a label
- After 2s without progress, the spinner is replaced by a skeleton — sustained spin is a UX failure

**Error state**

- Surface gains `border-left: 3px solid var(--accent-red);` (replaces normal left border)
- Title in `--accent-red`, 13px weight 600
- Body in `--fg-default`, 13px
- If recoverable: "Retry" button (outlined, accent-cyan)
- If not: "Copy details" button (copies error + stack to clipboard) plus a link to the docs section for that error class

**Per-milestone application**: each UI milestone (M-B1 through M-F3) must list in its acceptance checklist which of these three states it implements visually. A milestone is incomplete until all three render and have at least the loading and empty visual snapshots in the visual regression suite.

### Plot Visual Quality

The 12 plot renderers (M-C2 through M-C5) carry disproportionate visual weight; the showcase's §5 and §5a screenshots are dominated by plots. Specify:

- **Axis lines**: 1px solid `--border-default`
- **Grid lines**: 1px dotted `--border-subtle`; do not show grid lines if data range produces fewer than 3 ticks
- **Tick labels**: 10px (this is the only exception to the "no font below 11px" rule, justified by axis density); `--font-mono`; `--fg-muted`
- **Plot title**: 13px / weight 600 / `--fg-strong`; left-aligned above plot
- **Plot subtitle / metadata** (row count, brush state): 11px / `--fg-muted`; right-aligned in the title row
- **Legend**: 11px; 8px color swatch (square, `--radius-sm`); 4px gap between swatch and label; horizontal by default, wraps; vertical above 5 series
- **Data colors**: cycle `--chart-1` → `--chart-12`; only `--accent-red` is reserved for emphasis (errors, outliers explicitly marked)
- **Tooltips**: padding `var(--space-2) var(--space-3)`; background `--bg-elev-3`; `--shadow-md`; 11px mono; `--radius-sm`; max-width 320px; pointer-arrow optional
- **Empty plot state**: dashed 1px `--border-default` border around plot area; centered message "no rows match current filters" in `--fg-muted` 12px
- **Brush overlay**: fill `--accent-cyan` at 12% alpha (`rgba(34, 211, 238, 0.12)` — defined as a token `--brush-fill` to keep it within `tokens.css`); border 1px solid `--accent-cyan`; the edge currently being dragged thickens to 2px and shows `--shadow-glow-cyan`
- **Hover crosshair**: 1px dashed `--fg-muted`; data point grows from 3px → 5px on hover with `--duration-fast` transition
- **Animated transitions**: data updates (zoom, brush re-execute) cross-fade old → new at 180ms; **no flying-data animations** (no animated bar height transitions, no interpolated point movement) — they obscure correctness on performance work and the audience here is a perf engineer who needs to trust the picture
- **Axis-link highlight**: when two plots share a linked x-axis (showcase §5a), the linked axis line itself is drawn in `--accent-orange` 1.5px, and both plots get an orange dot near the title for discoverability

### Layout Cohesion

Default desktop layout (showcase §1 / index.html lines 39–51):

```
+----------------------------------------------------------+
|                   topbar (44px)                          |
+----------+---------------------------------+-------------+
| sidebar  |        main (notebook)          |   varbar    |
| 280px    |        flex 1                   |   320px     |
| (or 56px |                                 | (or 56px    |
|  collapsed)                                |  collapsed) |
+----------+---------------------------------+-------------+
|                  status bar (24px)                       |
+----------------------------------------------------------+
```

Rules:

- Topbar 44px; status bar 24px; both span full width.
- Sidebar default 280px, collapsed 56px (icon-only rail). Varbar default 320px, collapsed 56px.
- Sidebars resize via a 4px-wide hit area at the seam between sidebar and main (cursor `col-resize`); minimum expanded width 200px, snap-to-collapsed below 100px.
- **Collapse animation**: 240ms `--ease-out` `width` transition; content opacity fades to 0 at 80ms **before** width animates to avoid layout thrash mid-flight; expanding reverses (width animates first, content fades in at the last 80ms).
- The seam is hover-highlighted (`background: --border-strong`) so users can find it.
- **Tablet** (768–1199px): varbar starts collapsed; sidebar default. **Mobile** (<768px): both sidebars become full-height overlays summoned from the topbar, with a `--shadow-lg` and a 60% black backdrop; status bar hidden; topbar gains a hamburger and a kebab.

### Iconography

- Single source: **Lucide React** (`lucide-react`). No other icon libraries. No SVGs hand-rolled in component files (a small set of app-specific glyphs may live in `frontend-v2/src/icons/` but must be authored to match Lucide's stroke style).
- Sizes: 14px (inline within text), 16px (default button/menu icon), 20px (sidebar panel header), 24px (welcome screen, large empty states).
- Stroke width: 1.5px (Lucide default — do not override).
- Color: always `currentColor` (inherits from parent text color). Icons never carry their own color literal; semantic color comes from the wrapping element's text color (e.g., a status-error icon sits inside an element with `color: var(--accent-red)`).

### Animation Discipline

A short manifesto, binding on every implementer:

1. **Animate state changes, not entrances.** A modal that opens needs entrance motion (causality); a list item that already exists does not need to fade in when the page renders.
2. **Never animate cell content.** Code, query text, and result tables appear instantly. Motion in the content area competes with the user's reading attention.
3. **Use motion to communicate causality.** When the user drags a brush, the consumer cells flash a 1px `--accent-cyan` ring for 240ms to confirm the dependency fired. This is the most important motion in the app.
4. **Never use bouncy or elastic easings.** Every transition is `--ease-out` or linear. Overshoot easings feel playful and consumer-grade; the audience here is doing serious performance analysis.
5. **Reduced motion disables all non-essential motion.** Skeleton shimmer and loading spinners may continue (they communicate state) but at slower rate (skeleton 2.4s, spinner 1.6s). All transforms and cross-fades become instant.
6. **No looping animation except loading indicators.** A pulsing element that pulses forever is visual noise; the live-var pulse explicitly bounds itself to 3 cycles per change.

### Welcome Screen Polish (M-B6)

Reference showcase §0c. Specific design requirements:

- **Layout**: centered single column, max-width 720px, vertically centered with the topbar visible above.
- **Title**: 24px / weight 700 / `--fg-strong` / tracking -0.02em — "JFR Notebook".
- **Subtitle**: 14px / `--fg-muted` — one sentence positioning ("Explore Java Flight Recorder dumps with SQL, dashboards, and an agent that reasons about your performance data.").
- **Drop zone**: 280px tall; dashed 2px `--border-strong` border; `--radius-lg`; centered drop icon (Lucide `upload-cloud`, 24px) plus "Drop a `.jfr` file here or click to browse" in 13px. On hover: border becomes solid `--accent-cyan` 2px. On drag-over: fill becomes `--accent-cyan` at 8% alpha plus solid `--accent-cyan` 2px border.
- **Open recent**: list of up to 8 entries; each row shows recording-content-hash short ID (first 8 chars, mono, `--accent-cyan`), filename (display, `--fg-default`), date (mono, `--fg-muted`), and a cell count badge. Click opens; secondary-click shows context menu (Open, Remove from recents, Reveal in finder).
- **Example notebooks**: three clickable cards in a horizontal row — "GC overview", "Allocation hotspots", "Thread contention". Each card 220×120px, `--bg-elev-2` background, `--border-default` border, hover lifts (`--shadow-md` + `--accent-cyan` border).
- **Bottom row**: small links to "Docs", "Keyboard shortcuts", "What's new" in 11px `--fg-muted`. Do not clutter — no banner ads, no version notes, no telemetry callouts above-the-fold.
- **Loading**: while parsing a dropped file, the drop zone replaces its idle content with a skeleton + a progress bar (determinate if size known); other surfaces unchanged.

### Issues Panel Polish (M-B5)

Reference showcase §7. Specific:

- **Five issue kinds** with the showcase mapping:
  - `error` — Lucide `alert-octagon`, `--accent-red`
  - `stale` — Lucide `history`, `--accent-stale`
  - `warning` — Lucide `alert-triangle`, `--accent-yellow`
  - `info` — Lucide `info`, `--accent-cyan`
  - `ai-suggestion` — Lucide `sparkles`, `--accent-purple`
- **Group headers**: sticky within the scrolling panel (`position: sticky; top: 0; background: var(--bg-elev-1);`); show kind icon + label + count; click toggles collapse with the standard accordion chevron.
- **Row hover**: highlights the related cell in the notebook by adding a 1px `--accent-cyan` ring **without scrolling** — pure visual peek so the user can scan the panel without losing position.
- **Row click**: scrolls the cell into view (smooth, 240ms), expands it if collapsed, and applies a CodeMirror decoration (1px `--accent-cyan` underline on the offending span) that auto-clears after 4s or on next edit.
- **Empty state**: Lucide `check-circle-2` in `--accent-green` 24px plus "No issues detected" — celebratory but not loud.
- **Loading**: skeleton rows matching final row geometry.

### Agent Chat Polish (M-D1, M-D3)

Reference showcase §8. Specific:

- **Bubble style**: user messages right-aligned, agent left-aligned. **No full bubble fill** — instead, a 3px `--accent-purple` (agent) or `--accent-cyan` (user) left/right border with `--bg-elev-2` background and 12px padding. Keeps the panel airy and reads more like a transcript than a chat app.
- **Tool calls**: render inline as collapsible chips — a single-row pill with the tool icon, tool name (mono), and result summary (e.g., "found 3 cells"). Click expands to show full input/output JSON in a syntax-highlighted code block.
- **Cell-emit proposals**: special card with `--accent-purple` left border (4px), a header "Proposed cell: `$alias`", a syntax-highlighted SQL preview, and Accept / Reject buttons at the bottom. If editing an existing cell, show a live diff preview (red strike-through removals, green additions, inline).
- **Thinking indicator**: three dots, 4px diameter, `--fg-muted`, pulsing in sequence at 600ms cycle (each dot peaks 200ms after the previous). **Not a spinner** — the spinner says "indeterminate wait", the dots say "actively thinking".
- **Streaming text**: a subtle cursor-blink (1px wide, `--accent-purple`, blinks at 800ms cycle) at the end of the last streamed token; stops on stream completion. The text itself appears character-by-character (or token-by-token if SSE chunks are token-sized), no fade.
- **Tool error**: the tool chip turns `--accent-red` border, click expands to show the error message and a "Retry" affordance.
- **Empty state**: Lucide `sparkles` icon plus "Ask anything about your recording" plus three example prompts as clickable chips.

### Visual Regression Gate

Visual regression is a first-class CI gate. Implementation:

- **Tool**: Playwright + per-page screenshot comparison (using `expect(page).toHaveScreenshot()`), tolerance 0.1% pixel diff (catches palette/spacing changes; tolerates AA font rendering jitter on different OSes — CI pins to Linux/Chromium so cross-OS rendering is not a concern but the tolerance is kept conservative).
- **Per milestone**: every milestone that ships a UI surface adds **at least 2 visual regression snapshots** (default state + one interaction state — e.g., hover, expanded, filled).
- **Themes**: snapshots run in **dark theme AND light theme**, so the minimum is 2 surfaces × 2 themes = 4 PNGs per milestone.
- **Location**: `frontend-v2/tests/visual/<milestone-id>/<surface>.<state>.<theme>.png`.
- **Workflow**: CI runs `pnpm test:visual`. If any snapshot exceeds tolerance, CI fails and posts the diff image as a PR comment. The reviewer either accepts the change intentionally (re-runs with `--update-snapshots`) or rejects the PR.
- **Initial bootstrap** (M-A): the Phase A milestone seeds the test harness with the topbar, sidebar, varbar, and an empty notebook — these four surfaces × two themes × two states = 16 baseline PNGs that every subsequent PR is compared against.

### Per-Milestone Polish Checklist (apply retroactively)

When working on any UI milestone (M-B1 through M-B8, M-C2 through M-C5, M-D1/D3/D4, M-E7/E11/E13/E14/E15, M-F3, M-F4), the implementing agent must add a "Polish" sub-checklist to its acceptance criteria, in addition to the functional checklist already specified in this plan. The milestone is not complete until every item passes.

```
Polish checklist (binding):
- [ ] All colors referenced via --* tokens; zero hex literals outside tokens.css
- [ ] All spacing (padding, margin, gap) on the 4px grid via --space-* tokens
- [ ] Typography sizes via --text-* tokens; no raw font-size values
- [ ] Hover, focus-visible, active, disabled states defined for every interactive element
- [ ] Loading skeleton matches final layout; empty state has icon + headline + optional CTA;
      error state has red-tinted left border + recovery affordance
- [ ] Visual regression snapshots added: ≥2 states × 2 themes = ≥4 PNGs
- [ ] prefers-reduced-motion respected (transitions disabled, states preserved)
- [ ] Axe-core accessibility check passes with zero serious/critical violations
- [ ] Lucide icons only; sizes from the {14, 16, 20, 24} set; stroke 1.5px; color inherits
- [ ] Animations follow the discipline manifesto (state changes only, --ease-out only,
      no bouncy easings, no looping animations except bounded loading indicators)
- [ ] Surface matches the showcase.html reference within reasonable judgment
      (cite the §-section number in the PR description)
```

The Cross-Cutting Concerns "Per-Milestone Gate" already requires functional, test, and a11y checks; this Polish checklist is an additional gate of the same weight. A PR that satisfies functional acceptance but fails any Polish item is sent back.

### Final Iteration Note

This plan instructs agents to build a tool that not only computes correctly but feels well-made. Polish is gated alongside functionality — a milestone is incomplete until both pass. The design tokens, lint rules, visual regression suite, and per-milestone Polish checklist together make visual quality a load-bearing engineering concern rather than an afterthought. The agent prompts elsewhere in this document assume an implementer who reads the showcase as ground truth, reaches for tokens before pixels, and treats a missing hover state or an unsnapshotted error state as a bug. Build what the showcase shows.

### Per-plot axis density rules

Grounds: showcase §3a (renderer catalog: line, bar, scatter, histogram, boxplot, heatmap, area, range) and §5a (live coupling examples where compact charts appear inside `col{}` stacks).

- Tick counts shall target: y-axis 4–6 ticks for all renderers; x-axis 5–8 ticks for categorical scales, 6–10 ticks for time scales. Histograms shall use bin count as x-density (no extra ticks).
- Numeric tick steps must be derived via D3 `tickStep` with 1-2-5 round bases. No raw min/max/10 division.
- X-label rotation: when sum of label widths exceeds 85% of axis width, rotate 45° clockwise and right-anchor. Always ellipsize labels at 16 characters with a `title` attr carrying the full text.
- Time axes must snap to natural intervals from the set `{1s, 5s, 15s, 1m, 5m, 15m, 1h, 6h, 1d}`. Pick the smallest interval that yields ≤ 10 ticks across the visible domain.
- Compact mode (plot height < 160px): drop to 3 y-ticks, hide minor gridlines, and move the axis title into the legend chip.
- Tick label color must be `--fg-muted`; gridline stroke must be `--border-subtle`. Axis-line stroke must be `--plot-axis` (defined in the light-theme audit subsection below).
- Heatmap density: one tick label per cell when cell width ≥ 24px; else every Nth where `N = Math.ceil(24 / cellPx)`. Always show first and last labels.
- Boxplot and range plots inherit line-plot density rules; scatter plots may relax x-density to 4–6 when point count > 5000 (visual clutter override).

### Multi-series color discipline

Grounds: showcase §3a series legends and §5a multi-series overlays (sugar plots layering percentile bands).

- Categorical series shall be assigned `--chart-1` through `--chart-12` in palette order. After exhausting 12, group remaining series into a single "Other" trace and emit a `tooManySeries` diagnostic to the issues panel.
- Sequential or ordered series (percentiles p50/p75/p90/p99, decile bands, ramp encodings) shall instead use the sequential ramp `--chart-seq-0` through `--chart-seq-9`. The renderer must detect "looks sequential" when series names parse as percentiles, deciles, or ordered numeric tags.
- Series ordering must be deterministic: if the SQL specifies `ORDER BY`, honor it; else apply `Array.prototype.sort()` over distinct series values. This guarantees stable snapshot tests.
- Legend hover: dim non-hovered series to 30% opacity over `--duration-fast` (120ms). Hovered series keeps full opacity and 1.5× stroke width.
- Legend click: toggle series visibility. Hidden series must be fully removed from the canvas draw path (not merely transparent) and shall display with strikethrough text + 40% opacity in the legend.
- Tail grouping into "Other" must preserve a tooltip listing all collapsed series and a click affordance to expand.

Token block (append to the existing token table):

```css
--chart-seq-0: oklch(0.92 0.04 230);
--chart-seq-1: oklch(0.86 0.07 230);
--chart-seq-2: oklch(0.80 0.09 230);
--chart-seq-3: oklch(0.74 0.11 230);
--chart-seq-4: oklch(0.68 0.13 230);
--chart-seq-5: oklch(0.62 0.15 230);
--chart-seq-6: oklch(0.56 0.17 230);
--chart-seq-7: oklch(0.50 0.18 230);
--chart-seq-8: oklch(0.46 0.19 230);
--chart-seq-9: oklch(0.42 0.20 230);
/* linear interpolation across 10 stops; single-hue blue ramp */
```

### Flamegraph aesthetics (M-C4)

Grounds: showcase §3a (renderer DSL lists `flamegraph` among sugar plots) and §5a (live coupling: flamegraph filtered by brushed time range).

- Color strategy: hash `frame.package` and bucket into one of 8 warm-palette colors `--chart-warm-0` through `--chart-warm-7`. Reserved bucket overrides: `jvm/*`, `java.lang.*`, and native frames map to `--neutral-400`; user-code frames must take warm hues.
- Minimum frame width: 2px. Frames narrower than 2px must merge into an `…` sibling whose tooltip lists every collapsed frame with self/total.
- Depth fade: frames at depth `N > 20` must reduce OKLCH chroma by 8% per level beyond 20 (floor at 0 chroma).
- Selected frame: 2px `--accent-cyan` outline; all non-ancestor, non-descendant siblings dim to 40% opacity.
- Root frame: always `--chart-1`, full width, no fade applied.
- Frame label: 11px monospace, ellipsize at `frame-width - 8px`. If fewer than 4 characters fit, hide the label entirely (rely on tooltip).
- Hover tooltip: monospace 11px, format `package.Class.method · self {pct} · total {pct}` with percentages to 1 decimal place.
- Click frame: zoom-to-frame with a 240ms ease-out transform animation. A breadcrumb at the top of the flamegraph card shows the active ancestor path; clicking any breadcrumb segment zooms to that ancestor.

### Gantt lane density (M-C4 / M-C5)

Grounds: showcase §3a renderer list (`gantt` named alongside flamegraph) and §5a (gantt of GC pauses with brushed time-range linkage).

- Lane height: 14px. Lane gap: 2px. Group separator: 1px `--border-default` rule with 8px gap above the next group.
- Event bar minimum width: 2px (sub-pixel durations round up). Border-radius 1px.
- Instant events (zero duration) must render as a 6px diamond glyph (rotated square) centered on the lane mid-line.
- Lane label: 11px, left-aligned, ellipsize at 22 characters with full text in a `title` attr.
- When lane count exceeds 40, the renderer must auto-collapse by thread-group. Each group header shows a chevron and a count badge (`▸ http-worker (24)`); expanded state remembers per-notebook.
- Hover lane: row highlight using `--bg-elev-1` background spanning the full lane width.
- Sticky lane header: when scrolling vertically, the current group header pins to the top edge of the viewport.
- Time axis must render at the bottom of the gantt card with vertical gridlines (`--border-subtle`) at every major tick aligned to the natural snap intervals from the axis-density subsection above.

### Dashboard composition (M-C6: `row{}` / `col{}` / `+`)

Grounds: showcase §3a layout DSL (`row{}`, `col{}`, `+` overlay) and §5a (composed dashboards aligning shared x-axes across stacked plots).

- `col{}` time-x stacks must hoist the x-axis to the bottom-most subplot only; intermediate subplots hide their x-axis labels. All subplots share x-extent. Left-edge pixel alignment is achieved by computing `max(paddingLeft)` across all subplots and applying that uniformly.
- `row{}` unit-share: if all subplots declare the same `unit:` annotation, share a single y-axis on the leftmost subplot; else render per-subplot y-axes.
- Overlay `+`: merge legends across overlaid plots, deduplicating by series name. A single shared tooltip groups all overlay values at the hovered x position.
- Composed plots must remove inner borders; only the outer composition card draws `1px --border-default`.
- Subplot titles: 11px small-caps in `--fg-muted`, with 8px gap below the title before the plot area begins.
- Gap between subplots: 12px for `row{}` and `col{}`; 0 for `+` overlay (they occupy the same canvas).
- Synchronized hover crosshair: hovering one subplot inside `col{}` (shared x) must draw the crosshair on every sibling at the same x coordinate.
- Border collapse rule: when two subplots are adjacent inside `row{}`, hide their inner edge borders to avoid rendering a 2px double-line; the outer card border alone delimits the composition.

### Agent voice and copy tone (M-D1, M-D3, M-D7)

Grounds: showcase §6 (agent surfaces — proposed cells, chat panel, magic ✨ button) where every agent string is technical, hedged, and free of conversational filler.

- Voice is concise and technical. Inferences must hedge with "likely", "appears", or "based on".
- The agent never apologizes for clarifying and never says "sorry".
- Cell-proposal framing: "I drafted a cell that joins `gc_pauses` with `thread_state`." Never "Sure thing! Here's that!"
- Error framing: "Couldn't reach DuckDB. Retrying in 2s." Never "Oops, something went wrong!"
- Maximum two sentences before any code block or list.
- Second-person "you" used sparingly — technical reference voice, not chatty.
- No emojis in agent prose. The single emoji exception is the magic ✨ button glyph itself; agent-generated text never carries emoji.
- No exclamation marks in agent prose. Exclamation marks are reserved for warning banners (e.g. "Recording truncated!").
- Banned phrases (lint rule blocks them): "Hope this helps", "Let me know if", "Feel free to", "I'd be happy to", "Sure thing", "No problem", "Awesome".
- Allowed uncertainty phrases: "I'm not sure whether…", "Two interpretations: …", "If you meant X, …".
- Cell-emit framing must always read: "I drafted {N} cells. Accept to insert, Reject to discard."
- Provide a `src/copy/agentVoice.ts` constant file with templated strings; an ESLint rule shall block raw string literals inside `<AgentBubble>`, `<ProposedCell>`, `<MagicResult>`, and the chat panel components.

### Microcopy library (cross-cutting)

Grounds: showcase §2 (welcome / dropzone), §3 (empty notebooks), §4 (issues panel), §5 (live vars empty state), §6 (agent errors). Every visible user-facing string must originate from one canonical file.

- Create `frontend-v2/src/copy/strings.ts` as the single source of truth for user-facing strings. All components import keys from this module.
- ESLint rule: ban string literals inside JSX whose shape matches `/^[A-Z][a-z]+ [a-z]/` (looks like a sentence). Permitted with an explicit `// eslint-disable-next-line no-raw-strings` directive plus a justification comment.
- Required keys with their exact strings:

```ts
export const strings = {
  empty: {
    notebook:      "Drop a .jfr file or pick a sample below.",
    queryResult:   "Query returned 0 rows. Try widening the time range.",
    issues:        "No issues. Everything's green.",
    searchResults: "No matches in this notebook.",
    liveVars:      "No live variables yet. Brush a chart to create one.",
  },
  loading: {
    parsingJfr:    "Parsing JFR... {bytes} read",
    runningQuery:  "Running query...",
  },
  error: {
    parser:        "Couldn't parse {what}. Expected {expected}.",
    truncation:    "Showing first {n} rows of {total}. Add `limit` to refine.",
    noRecording:   "Load a recording to start querying.",
  },
  cta: {
    loadJfr:       "Load .jfr",
    brushChart:    "Brush a chart",
    pickSample:    "Pick a sample",
    widenRange:    "Widen time range",
  },
} as const;
```

- Each empty state component must accept a CTA button label key (e.g. `cta.loadJfr`, `cta.brushChart`) and render the corresponding button when the slot is provided.
- Interpolation placeholders use `{name}` syntax; a `fmt(key, vars)` helper resolves and substitutes. No template literal concatenation in components.

### Skeleton catalog (per-surface geometry)

Grounds: showcase §2 (welcome load), §3 (cell loading), §4 (issues panel loading), §6 (chat loading), and §3a (plot/table loading inside cells). Every loading surface must use a skeleton, never a spinner.

- **Cell loading**: editor area renders 3 placeholder lines at 40ch / 28ch / 35ch widths stacked with 4px gap; result area renders a 200px-tall placeholder block.
- **Plot loading**: outer card border drawn solid; axis frame drawn with `--plot-axis`; plot area filled with a diagonal hatch pattern at 8% opacity. No spinner, no shimmer over the hatch.
- **Table loading**: header row drawn solid `--bg-elev-2`; 8 body rows each filled to staggered widths in this exact sequence: 60%, 40%, 40%, 40%, 35%, 45%, 40%, 30%.
- **Chat bubble loading**: 2 placeholder lines at 80% and 45% width with an 800ms left-to-right wave shimmer.
- **Issues panel skeleton**: 3 rows, each composed of a 12px circle (icon placeholder) plus 2 text lines at 90% and 60% width.
- **Sidebar skeleton**: 6 rows, 14px height each, 75% width, 6px vertical gap.
- **Dep-graph skeleton**: 5 placeholder circles at fixed pseudo-random positions joined by dashed connecting lines (`stroke-dasharray: 4 4`). Positions are seeded by notebook id for snapshot stability.
- **All skeletons** must use `--bg-elev-1` as the base and `--bg-elev-2` as the shimmer highlight. Shimmer is a linear-gradient sweep with 1.4s `ease-in-out` cycle. When multiple skeletons appear in the same viewport, their animations stagger by 80ms in DOM order to avoid synchronized strobing.

### Dep-graph node/edge spec (M-A4, M-B4)

Grounds: showcase §4a (dep-graph overlay revealing data lineage between cells, live-var pulses, axis-link relations).

- Library: Cytoscape.js with the `dagre` layout extension. No custom WebGL path.
- Layout parameters: `rankdir: 'TB'`, `nodesep: 24`, `ranksep: 40`, `edgesep: 12`.
- Node shapes by cell kind:
  - SQL / query cell — `roundrectangle`, padding 8 vertical / 12 horizontal.
  - Plot cell — `rectangle` with a 12px inline viz glyph (line/bar/scatter icon matching renderer).
  - Prose cell — `document` (custom SVG path that looks like a folded page corner).
  - Macro cell — `hexagon`.
  - Live-var pill — `ellipse`, smaller dimensions `32 × 16`.
- Edge styles by relationship kind:
  - `data` (cell→cell SQL dependency): solid 1.5px `--border-strong`, no arrow on the emitter end.
  - `var` (plain `$x` reference): dashed 1.5px `--accent-purple`, arrow head on consumer end.
  - `live-var` (`$alias.brush` reference from §5a): solid 2px `--accent-cyan`, arrow head on consumer end, single-shot pulse animation on update (600ms scale 1 → 1.2 → 1).
  - `axis-link` (link-x / link-y from M-E9): dotted 1px `--accent-amber`.
  - `prompt` (agent-derived linkage): solid 1px `--accent-orange`, diamond endpoint.
- Node label: 11px, rendered below the node, ellipsize at 14 characters. At zoom < 0.6, hide labels entirely; at zoom < 0.3, collapse nodes to dots.
- Hover node: stroke thickens from 1.5px to 2.5px; immediate neighbors highlight; non-neighbors dim to 30% opacity.
- Selected node: 2px `--accent-cyan` outline (same as flamegraph and gantt selection).
- Background: `--bg-base` so the overlay seamlessly blends with the surrounding canvas.

### Light-theme plot audit

Grounds: showcase §1 (theme toggle in topbar) and §3a (every renderer must read correctly in both themes). The dark-theme palette established earlier in this document must be re-validated against light backgrounds.

- Each `--chart-N` color must achieve ≥ 3:1 contrast against `--bg-base` in BOTH themes (WCAG SC 1.4.11 non-text contrast).
- Light-theme palette adjustments versus the dark palette: `--chart-3` (yellow), `--chart-7` (cyan-light), and `--chart-11` (lime) must darken by 12% L in OKLCH for the light theme variant. Other chart tokens retain their hue/chroma; only L shifts as needed to clear the 3:1 floor.
- Introduce plot-specific tokens distinct from the generic `--border` family:

```css
/* Light theme */
--plot-grid:       oklch(0.93 0.01 230);
--plot-axis:       oklch(0.78 0.02 230);
--plot-tick-label: var(--fg-muted);
--plot-frame:      var(--border-default);

/* Dark theme */
--plot-grid:       oklch(0.28 0.01 230);
--plot-axis:       oklch(0.42 0.02 230);
--plot-tick-label: var(--fg-muted);
--plot-frame:      var(--border-default);
```

- Playwright visual regression must render all 12 chart tokens swatched and all 8 renderer types in both themes. The CI gate fails when any `--chart-N` measures < 3:1 against `--bg-base` in either theme.
- Run `@adobe/leonardo-contrast-colors` (or an equivalent OKLCH-aware contrast lib) as a pre-commit check on any change to a `--chart-*`, `--plot-*`, `--bg-*`, or `--fg-*` token. PR cannot merge with a failing contrast report.

### Print stylesheet (M-E12 HTML/PDF export)

Grounds: showcase §7 (export to HTML/PDF — single-file standalone artifact embedding notebook + data).

The export pipeline must include this `@media print` rule set:

- Force the light theme regardless of user setting (override `data-theme` attribute via `@media print { :root { color-scheme: light; } }`).
- Hide non-content chrome: topbar, sidebar, varbar, status bar, dep-graph overlay, chat panel, magic-button overlay.
- Cells: apply `break-inside: avoid` when measured height ≤ 600px; cells taller than 600px allow break with the cell title repeated at the top of the continuation page.
- Footer (each page): `Page {N} of {M} · {notebook name} · Exported {ISO-8601}`.
- Header (first page): notebook title as h1, centered.
- Hyperlinks: append URL in parentheses via `a[href]::after { content: ' (' attr(href) ')'; font-size: 10px; color: #666; }`.
- Page margins: 18mm on all sides.
- Font scale: shift down one step (11px → 10px, 13px → 12px) for compact print.
- Apply `page-break-before: always` before each top-level H1 prose heading.
- Plot canvases must render as inline SVG (not raster) for vector-quality print output.
- Tables: `page-break-inside: avoid` for tables of ≤ 12 rows; longer tables allow break with the header row repeated on each continuation page (`thead { display: table-header-group; }`).
- Test: Playwright `page.pdf({ printBackground: true })` snapshot diff per export sample notebook; PR fails on visual regression.

### First-paint choreography (M-B1, M-B6)

Grounds: showcase §2 (welcome screen, dropzone) and §3 (first cell appears after JFR drop). The load sequence must feel intentional, never abrupt.

- **0–200ms**: dark blank canvas with the cyan logo fading from opacity 0 → 1 using `cubic-bezier(.2,.8,.2,1)`.
- **200–360ms**: welcome cards stagger in at 40ms intervals, each card translating `translateY(8px) → 0` plus opacity `0 → 1` over a 160ms duration.
- **On file drop**: the dropzone outline must pulse once — `scale(1.0) → scale(1.04) → scale(1.0)` over 240ms `ease-out`.
- **Drop → shell transition**: welcome fades out over 160ms while shell fades in over 200ms with a 40ms overlap (cross-fade).
- **First cell render**: editor surface renders first; the results skeleton appears at a 120ms delay; live results replace the skeleton when ready.
- The renderer must **never animate `width` or `height`** — only `transform` and `opacity`. Layout-affecting animations are banned to keep first paint cheap on cold-start.
- Reduced motion (`@media (prefers-reduced-motion: reduce)`): replace all entrance animations with instant appearance; keep cross-fades at 80ms so transitions do not pop harshly.

## Iteration Tag Glossary

The showcase document (`showcase.html`) was authored across multiple design iterations, each tagged `§ITx` (e.g., `§IT14`, `§IT15.3`). Where milestones in this plan reference `§ITx.y`, look up the tag here for the iteration's introduced behavior. This glossary is the canonical resolution — milestones never invent behavior beyond what is defined here. Where a milestone or test fixture says literal `M-ITx.y` (a malformed milestone ID), read it as `§ITx.y` and locate the owning milestone in the entry below.

### §IT14 — Verbose live-var operator (foundation)

**Introduced**: the verbose field-access shape `$!brush.x0` / `$!brush.x1` (and `$alias.brush.x0` / `$alias.brush.x1` once aliased) for reading brush bounds explicitly, together with the compact sugar `WHERE col IN $alias.brush` that expands at parse time to `BETWEEN $alias.brush.x.lo AND $alias.brush.x.hi`. Also introduced the `brush-column-mismatch` soft-warning diagnostic that fires when the consumer's filter column does not match the producer's brushed axis.

**Owning milestones**: M-E2 (brush producer + `IN` operator runtime), M-A3 (SQL parser extension for `IN $alias.brush`), M-B5 (`brush-column-mismatch` diagnostic in the issues panel).

**Showcase**: §5 (live coupling, lines 4616+), §5.2 (the `IN $producer.live-var` operator, lines 4645+), §6 (issues panel including the brush-binding validator at line 5337).

### §IT15.1 — Axis-explicit consumer columns

**Introduced**: when the consumer's filter column does not match the producer's brushed axis, the user writes `WHERE endTime IN $a.brush.x` to use the brushed x-range against `endTime` (instead of the implicit producer-axis column). Compact `IN $a.brush` still works when columns match; `$a.brush.x` (and `$a.brush.y`) is the axis-explicit escape hatch. The brush-binding validator (showcase line 5337) accepts both forms.

**Owning milestone**: M-E2 (brush producer + `IN` operator), with parser support in M-A3 and diagnostic support in M-B5.

**Showcase**: §5.2 (lines 4645+), §6 header tag (line 5319 — `§IT15.1`), validator prose at line 5337.

### §IT15.2 — Hover producer mechanism

**Introduced**: each plot type defines what `$cell.hover` writes when the cursor moves over the plot. Line/scatter/area: `{ axes: { x: {col, val}, y: {col, val} } }` on mousemove debounced 30ms. Bar/histogram: `{ axes: { x: {col, val: barCategory} } }`. Pie/flamegraph: `{ value, category }` (no axes — categorical-only). Table: `{ row: <full row> }`. Hover clears on mouseleave with a 300ms debounce so quick hops between adjacent plots do not flicker.

**Owning milestone**: M-E3 (hover producer wiring + per-plot-type shapes).

**Showcase**: §5.3 (hover semantics across plot types, line 4710 — explicitly tagged `iter-15 §IT15.2`).

### §IT15.3 — Panel naming within cells

**Introduced**: a cell with multiple panels (e.g., `row{a;b}`) addresses panels via positional index (`$cell.0.brush`, `$cell.1.brush`) or explicit `name:` clause on a panel (`line {...} | name: "gc"` → `$cell.gc.brush`). The formatter (M-A5) auto-injects `name:` when ambiguity exists, and the `panel-name-recommended` lint (iter-18 §IT18.4) nudges authors toward explicit names when multiple panels of the same kind exist.

**Owning milestone**: M-E8 (panel naming + addressing in the live-coupling runtime), with formatter support in M-A5 and the lint in M-B5. **Note**: legacy/stale `M-ITx.y` references in earlier draft text resolve here as `§ITx.y (implemented in the milestone listed above)`.

**Showcase**: §5.4 (panel `name:` clause, line 4738 — explicitly tagged `iter-15`), lint label at line 4761.

### §IT15.4 — Share-URL serializer migration

**Introduced**: URL fragment uses `?$alias.brush=<base64url(JSON of LiveRangeValue)>` instead of the verbose `?$!brush.cell=...&$!brush.x0=...&$!brush.x1=...` form. A shorter named form is permitted for common ranges (`?b=cell-3:ts:1000..2000`). Iter-16 §IT16.4 refines the encoding further; a backwards-compatible parser still accepts the pre-IT15 verbose shape so older share links resolve.

**Owning milestone**: M-E11 (shareable URLs encode/decode), with the size-cap sidecar fallback in the same milestone per §10.size-cap.

**Showcase**: §10 (shareable URLs, line 8143 — header tag includes `§IT15.4 · §IT16.4`), encoding subsection at line 8149.

### §IT15.5 — Cheatsheet update for live-var SQL operators

**Introduced**: new rows in the §9 cheatsheet covering `IN $brush`, `IN $alias.brush`, `IN $alias.brush.x`, `IN $alias.panel.brush`, and `IN $hover.category` — the full set of live-var operators that survived iter-15.

**Owning milestone**: M-B6 (docs / cheatsheet modal) — the cheatsheet is rendered from a static doc that ships with the app.

**Showcase**: §9.6 (live-var operators in SQL, line 8057), §9 cheatsheet (line 7985+).

### §IT15.6 — `produces:` capability list on cells

**Introduced**: each cell type publishes a `produces: string[]` list naming which live-vars it can produce — `'brush'`, `'hover'`, `'zoom'`, `'selection'`, `'scroll'`. The agent's `list_cells` tool returns this so the model can target plots that actually publish what it wants to consume (e.g., the agent will not propose `IN $cell-7.brush` if `cell-7` is a table that only produces `selection`).

**Owning milestones**: M-A1 (cell type definitions carry the `produces` field), M-D2 (`list_cells` tool surfaces the field through the MCP-style tool registry).

**Showcase**: §7 agent tools table at line 5711 (`list_cells` returns `produces: ['brush', 'zoom']`), tool I/O schema at line 5850.

### §IT16 — Variable handling expansion (sigil collapse)

**Introduced**: full `$x` semantics — reactive, namespaced (`$alias.brush`), and uniformly live (no static/live distinction in the language; the runtime decides reactivity). Subsumes earlier `$!x` (verbose-live) and `$x` (static) into one sigil. §IT16.4 also refined the share-URL encoder (see §IT15.4); §IT16.5 fixed the `vars:` key shape used by `get_live_var`.

**Owning milestone**: M-E1 (live-var runtime + reactive var store), with parser support in M-A3.

**Showcase**: §2 (the two-sigil variable system, line 2532 — header tag `§IT16 sigil collapse`), §10 header tag (line 8143 — `§IT16.4` encoding), `vars:` key shape note at line 5736.

### §IT17 — Workspace globals architecture (`$$x`)

**Introduced**: the second sigil `$$x` for workspace-global, machine-local persistence — config that follows the user across notebooks rather than living in any one notebook. **§IT17.12 specifically** mandates that `$$x` values are EXCLUDED from share URLs (they are machine-local config, not notebook content); a share-link recipient sets their own `$$x` independently.

**Owning milestones**: M-F1 (`$$x` parsing + storage), M-F2 (`$$x` editor / inspector surface), M-F3 (`$$x` reactive integration with the live-var runtime), plus M-E11 (share URL encoder explicitly excludes `$$x` per §IT17.12).

**Showcase**: §2 (two-sigil system, line 2532), §10 (`$$x` globals NOT encoded, line 8165 — explicitly tagged `iter-17 §IT17.12`), §11 (roadmap, line 8700).

### §IT18 — `get_live_var` agent tool argument shape

**Introduced**: the agent's `get_live_var` tool accepts `{ name: string, kind: 'live' | 'liveLive' }` so the model can disambiguate `$x` (notebook-local, `kind: 'live'`) from `$$x` (workspace-global, `kind: 'liveLive'`). Without the explicit `kind`, the tool refuses ambiguous names that exist in both scopes.

**Owning milestone**: M-D2 (tool registry — `get_live_var` is one of the ten MCP-style tools).

**Showcase**: §7 (agent overview, line 5698 — header tag `§IT18.6`), `get_live_var` argument shape detail at line 5731 (explicitly tagged `iter-18 §IT18.6`).

<!-- IMPLEMENTATION_PLAN.md complete — Phase A through F, cross-cutting concerns, showcase coverage matrix, design polish. Total scope: every showcase feature mapped to a milestone with self-contained agent prompt, tests, polish gate. -->
