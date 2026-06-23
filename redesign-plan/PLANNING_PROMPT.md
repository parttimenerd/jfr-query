# Meta: Agent Prompt for Writing IMPLEMENTATION_PLAN.md

This document is a prompt for an AI agent tasked with producing the comprehensive IMPLEMENTATION_PLAN.md for the JFR Notebook v2 redesign. It defines what the agent must read, understand, and deliver.

## Your Task

Write a comprehensive IMPLEMENTATION_PLAN.md at:
```
/Users/i560383_1/code/experiments/jfr-query/redesign-plan/IMPLEMENTATION_PLAN.md
```

This plan is the source-of-truth document for implementing a greenfield v2 rewrite of JFR Notebook. It must be detailed enough that implementing agents can read it and begin work on individual milestones without asking for clarification.

---

## Phase 0: Read & Understand

### Ground Truth Documents
Before writing a single line, read these sources completely:

1. **showcase.html** (8815 lines)
   - Path: `/Users/i560383_1/code/experiments/jfr-sql-notebook/redesign-plan/showcase.html`
   - This is the UX specification. Every feature shown here must appear in the plan.
   - Extract the table of contents by reading all `<h1>`, `<h2>`, `<h3>` headers.
   - Key sections to map to milestones:
     - §0a–§0d: Shell, sidebar, JFR ingest, persistence
     - §1a–§1d: Navigation, command palette, docs modal
     - §2: Two-sigil variable system ($x, $$x)
     - §3–§3d: Plot DSL (12 types), composition, prose, macros
     - §4–§4b: Cross-cell wiring, result tables, recording compare
     - §5–§5a: Live coupling (brush, hover, zoom, selection, scroll), chains
     - §6–§6b: Issues panel, autocomplete, error recovery
     - §7–§7e: Agent chat, 10 MCP tools, cell-emit, inline chat, failure modes
     - §8–§8a: Formatter, performance (caching, cancellation, push-down)
     - §9: Cheatsheet (one-page reference of all syntax)
     - §10–§10c: Shareable URLs, accessibility, checkpoints, redaction
     - §11: Six-phase roadmap (Phase A–F)
     - §12: Reference index by iteration

2. **REDESIGN_INTERFACES.md** (525 lines)
   - Path: `/Users/i560383_1/code/experiments/jfr-sql-notebook/redesign-plan/REDESIGN_INTERFACES.md`
   - Read the TypeScript interface definitions. These are the types you must realize in code.
   - Key sections:
     - Notebook, Cell, CellBlock types (block union = SqlBlock | PlotBlock | ViewBlock | MacroBlock | ProseBlock)
     - PlotNode tree and composition (row{}, col{}, +)
     - DepGraph (nodes, edges, five edge types: uses, produces, propagates, flows, chains)
     - LiveRangeValue, LiveHoverValue, LiveZoomValue shapes
     - Validator types (Diagnostic, DiagnosticKind enum)
     - Formatter invariants (idempotency property)

3. **v1 Codebase** (`/Users/i560383_1/code/experiments/jfr-query/core/frontend/`)
   - Read these files to understand what's already working:
     - `utils/duckdbWasmLoader.ts` (55 lines) — DuckDB init via jsDelivr, Blob Worker pattern
     - `utils/jfrToWasmLoader.ts` (82 lines) — GraalVM jfr-importer.js integration
     - `context/DuckDBContext.tsx` (329 lines) — DB state machine
     - `components/plots/` directory — 12 plot component files (reference implementations)
     - `wasm/web/jfr-importer.js[.wasm][.wat]` — GraalVM-compiled JFR parser
   - Read `package.json` to see exact dependency versions (React 19, Vite 6, CodeMirror 6, DuckDB-WASM 1.29, Tailwind 4, Vitest, Playwright, Recharts 3.2)

4. **REDESIGN_PLAN.md** (5242 lines, optional deep-dive)
   - Path: `/Users/i560383_1/code/experiments/jfr-sql-notebook/redesign-plan/REDESIGN_PLAN.md`
   - This is the design narrative (15 iterations of gap-filling). Reference it for intent, but showcase.html is your acceptance spec.
   - Read §11 (six-phase roadmap) and the phase definitions (Phase A–F).

---

## Phase 1: Map Showcase to Implementation Milestones

Extract a complete table of:
- **Showcase section** (§0a, §1c, §3a.1, etc.)
- **Feature surface** (e.g., "command palette with result kinds and preview pane")
- **Which phase** (A, B, C, D, E, or F)
- **Roughly which milestone** (M-A1, M-B3, M-C5, etc.)

This becomes your coverage matrix at the end of the plan.

Key principle: **vertical slices**. Each milestone should deliver one complete feature end-to-end, not all UI before all logic. Example: M-C1 (plot DSL parser) should also include M-C1's tests, not defer testing to later.

---

## Phase 2: Define the Output Structure

The IMPLEMENTATION_PLAN.md file must have these sections (in order):

### 1. Summary
- One paragraph: what this plan covers, constraints, target outcome
- Example: "This plan specifies a greenfield v2 rewrite of JFR Notebook, covering all 60+ features shown in showcase.html. Built in 6 phases (A–F). All phases ship in v1.0. Stack: React 19 + Vite 6 + DuckDB-WASM + Vitest + Playwright. Reuses DuckDB/JFR loaders and 12 plot renderers from v1."

### 2. Repository Layout
- Show the `frontend-v2/` directory structure
- Example:
  ```
  frontend-v2/
    src/
      App.tsx
      index.tsx
      index.css
      components/
        Shell.tsx
        Sidebar.tsx
        CellEditor.tsx
        plots/
          LineChartPlot.tsx
          ... (12 plot files)
        agent/
          ChatPanel.tsx
          ToolCall.tsx
        ...
      hooks/
        useNotebook.ts
        useLiveVar.ts
        useDepGraph.ts
        ...
      context/
        NotebookContext.tsx
        SettingsContext.tsx
        DuckDBContext.tsx
        AgentContext.tsx
        ...
      services/
        parser/
          plotDslParser.ts
          notebookParser.ts
          validator.ts
        formatter/
          plotFormatter.ts
          notebookFormatter.ts
        depGraph/
          DepGraph.ts
          cycle-detection.ts
        liveVar/
          liveVarRuntime.ts
          liveVarTypes.ts
        agent/
          agentService.ts
          toolRegistry.ts
          cellEmitParser.ts
        ...
      utils/
        duckdbWasmLoader.ts (from v1)
        jfrToWasmLoader.ts (from v1)
        plotUtils.ts
        urlSharing.ts
        a11y.ts
        ...
      __tests__/
        parser.test.ts
        formatter.test.ts
        depGraph.test.ts
        liveVar.test.ts
        plots.test.tsx
        agent.test.ts
        e2e/
          ... (Playwright specs)
    public/
      jfr-importer.js (from v1)
      jfr-importer.wasm (from v1)
      jfr-importer.wat (from v1)
    vite.config.ts
    vitest.config.ts
    playwright.config.ts
    tailwind.config.js
    tsconfig.json
    package.json
  ```

### 3. Reuse Manifest
- Table of files copied/adapted from v1:
  - Source file → Target location → Changes made
  - Example: `core/frontend/utils/duckdbWasmLoader.ts` → `frontend-v2/src/utils/duckdbWasmLoader.ts` → "No changes, copy as-is"
  - Example: `core/frontend/components/plots/LineChartPlot.tsx` → `frontend-v2/src/components/plots/LineChartPlot.tsx` → "Adapt prop interface to match PlotNodeProps from REDESIGN_INTERFACES.md"

### 4. Stack & Tooling
- List all npm packages (with versions from v1's package.json)
- Note critical config: Vite COOP/COEP headers for SharedArrayBuffer (required for DuckDB-WASM)
- Note build & dev commands: `npm run dev`, `npm run build`, `npm run test`, `npm run test:ui`, `npm run test:e2e`

### 5. Testing Strategy
- Define test taxonomy:
  - **Unit** (Vitest): parser, formatter, dep-graph logic, live-var runtime, utility functions
  - **Property tests** (fast-check or vitest-fast-check): parser round-trip, formatter idempotency, dep-graph cycle invariants
  - **Integration** (Vitest + real DuckDB-WASM in worker): query execution, JFR loading, live-var propagation, cross-cell aliasing
  - **E2E** (Playwright): showcase surface coverage (every §-section), error recovery, empty states, loading states
  - **Visual regression**: plot snapshot tests (12 plot types × key rendering states)
  - **Accessibility**: axe-core audit per §10a.1 commitments (ARIA labels, focus rings, keyboard navigation)
  - **Performance**: perf budgets per §8a (first query ≤500ms warm, result render ≤100ms for 10k rows)
- Link to concrete test files that will be created in milestone descriptions

### 6. Phase A — Foundations (no UI)
**What**: Parser, formatter, dep graph, in-memory model. Markdown round-trips byte-for-byte. DuckDB-WASM moved to a Web Worker.

**Showcase**: §0d (persistence model), §4 (cross-cell aliasing), §8–§8a (formatter, perf), §9 (cheatsheet syntax)

List milestones M-A1, M-A2, …, M-Ax. Each milestone should include:

- **M-Ax: [Name]**
  - **What**: [feature description with showcase §-refs]
  - **Files**: [exact paths to create/modify in `frontend-v2/`]
  - **Interfaces**: [which REDESIGN_INTERFACES.md types are realized here]
  - **Tests**: [test bucket keywords: unit | property | integration | e2e | visual | a11y, plus specific test-file names and edge cases]
  - **Gate**: [what must be true before moving to next milestone]
  - **Showcase**: [§-refs, e.g., "§8, §9.5"]

  > **Agent prompt (M-Ax):**
  > 
  > [Self-contained paragraph an agent can read to implement this milestone. Include:
  > - What to read first (which interfaces, which v1 code to reference)
  > - What files to create/modify
  > - What types to realize
  > - What tests to write and their names
  > - Acceptance criteria (e.g., "formatter idempotency passes 100k random inputs", "parser rejects UPPERCASE with diagnostic")]

**Milestone granularity examples**:
- M-A1: Markdown parser + round-trip tests
- M-A2: SQL parser (identifier resolution, macro expansion)
- M-A3: Plot DSL sugar parser (reject UPPERCASE with diagnostic)
- M-A4: Dep graph builder (5 edge types, cycle detection)
- M-A5: Formatter (SQL + plot DSL + markdown, idempotency property test)
- M-A6: DuckDB-WASM worker (query execution, AbortSignal cancellation)
- M-A7: JFR loader in worker (GraalVM jfr-importer.js integration)

### 7. Phase B — Visibility
**What**: First user-visible payoff. Shell layout, sidebar with 3 nav panels + preview pane, dep-graph overlay, issues panel, welcome cell, keyboard map, activity feed.

**Showcase**: §0a, §0b, §1a, §1c, §1d (partial — docs modal comes later in D), §6 (issues panel), §9.8 (keyboard map), §10a.2 (activity feed)

List milestones M-B1, M-B2, …

**Milestone granularity examples**:
- M-B1: Shell layout (React root, dark/light theme toggle, OPFS persistence skeleton)
- M-B2: Sidebar nav panels (TABLES, VIEWS, MACROS panels with search, SAVED+TEMP)
- M-B3: Sidebar preview pane (result table, sort/filter UI, export-to-cell affordance)
- M-B4: Dep-graph overlay (Cytoscape.js, §0a node, edge rendering, modal toggle ⌘G)
- M-B5: Issues panel (open on sidebar, diagnostic rendering, quickfix menu ⌥↵)
- M-B6: Welcome cell, glyph legend, keyboard map (⌘⇧K modal)
- M-B7: Activity feed (⌥A drawer with timeline, time-travel undo)
- M-B8: Syntax highlighting in editor (CodeMirror 6 setup + Lezer grammar)

### 8. Phase C — DSL & Dashboards
**What**: Plot DSL sugar parser, composition (row{}, col{}, +), plot DSL formatter, slash menu, promote-to-view, macro fence, macro panel.

**Showcase**: §3, §3a (12 plot types), §3b (rendering details), §3c (prose), §3d (macro fence), §6a (autocomplete), §9.2–§9.4 (DSL cheatsheet)

List milestones M-C1, M-C2, …

**Milestone granularity examples**:
- M-C1: Plot DSL sugar parser (12 types + 3 composers + clause tail, reject UPPERCASE)
- M-C2: Plot types 1–4 renderers (line, bar, scatter, histogram — adapted from v1, new prop interface)
- M-C3: Plot types 5–8 renderers (boxplot, heatmap, pie, flamegraph)
- M-C4: Plot types 9–12 renderers (table, gantt, area, range)
- M-C5: Plot DSL formatter (idempotency tests, key-order normalization per §8)
- M-C6: Plot composition rendering (row{}, col{}, + operators, nested layouts)
- M-C7: Plot rendering states (idle, loading, rendered, error, empty) and interactive UI (legend, hover tooltip, on-canvas controls)
- M-C8: Prose cells (two shapes: prose block, prose-with-embedded-plot) and report-mode renderer (PDF/HTML export per §1a.6, §3c.4)
- M-C9: Macro fence parser, MACROS sidebar panel, promote-to-view affordance, macro validation
- M-C10: Slash menu (/ prefix in SQL cells, suggest common snippets, macro expansion)

### 9. Phase D — AI Surface
**What**: Agent chat panel, 10 MCP-style tools (schema, describe, read_cell, list_cells, docs, diagnose, check_render, run_sql, sample_table, get_live_var), cell-emit proposals, inline chat, prompt grammar, local model integration (tiny HuggingFace transformers for local inference).

**Showcase**: §7, §7a (prompt grammar), §7b (chat panel UI), §7c (tools + cell-emit), §7d (inline chat), §7e (failure modes), §9.7 (grammar cheatsheet)

List milestones M-D1, M-D2, …

**Milestone granularity examples**:
- M-D1: Chat panel UI (docked drawer + maximize overlay, transcript rendering, context inspector)
- M-D2: Tool registry + 10 MCP tools (schema, describe, read_cell, list_cells, docs, diagnose, check_render, run_sql, sample_table, get_live_var)
- M-D3: Cell-emit proposal rendering (visual diff, Accept/Reject buttons, atomic multi-cell flow)
- M-D4: Inline chat (Copilot-style cursor overlay, same tooling as chat panel)
- M-D5: Prompt grammar (EBNF, tokenizer, seven verbs, five target kinds, @resolver)
- M-D6: Local model integration (HuggingFace transformers tiny model, plotForSql inference per §7a)
- M-D7: Agent failure-mode handling (rate limits, timeouts, loops, recovery per §7e)
- M-D8: Last-AI-prompt/session roundtrip (frontmatter storage, audit log rendering)

### 10. Phase E — Live Coupling
**What**: $x live-variable runtime, five live-var kinds (brush, hover, zoom, selection, scroll), varbar with pause-coupling button, IN $alias.brush operator in SQL, intra-cell panel naming, linked zoom (link-x/link-y/link-xy), shareable URLs (encode/decode live state), HTML/PDF export, checkpoints, redaction.

**Showcase**: §2 (two-sigil system), §5 (live coupling), §5a (chains, saved filters), §10 (shareable URLs), §10a (accessibility), §10b (checkpoints), §10c (redaction)

List milestones M-E1, M-E2, …

**Milestone granularity examples**:
- M-E1: Live-var runtime ($x read/write, reactive updates)
- M-E2: Brush producer/consumer (plotNode.produces, IN $alias.brush operator, validator per §IT14.5)
- M-E3: Hover producer/consumer (hover semantics per §IT15.2, categorical hover for pie/flamegraph)
- M-E4: Zoom producer/consumer ($alias.zoom master/clamp linking per §5.6)
- M-E5: Selection producer (row selection in table, consumed in SQL WHERE clauses)
- M-E6: Scroll producer (scroll state for synced scroll across plots)
- M-E7: Varbar UI (live-var pills, pause-coupling button, variable inspector popover)
- M-E8: Panel naming within cells (explicit `name: "gc"` clause, positional $!<cell>.0.brush, dep-graph panel sub-nodes)
- M-E9: Link-x/link-y/link-xy axis linking (synchronized domain across plots)
- M-E10: Chains and saved filters (stale propagation, promote-to-view UX per §5a)
- M-E11: Shareable URLs (encode live state, decode on recipient open, URL size cap + sidecar fallback per §10)
- M-E12: HTML/PDF static export (render notebook as standalone HTML with embedded plots, PDF via headless browser)
- M-E13: Recording compare baseline (attach second .jfr, DIFF macro, live coupling across recordings per §4b)
- M-E14: Checkpoints (auto+manual saves, checkpoint drawer, restore+diff per §10b)
- M-E15: Redaction (PII control, column masks on share/export per §10c)

### 11. Phase F — Workspace Globals
**What**: $$x cross-notebook time ranges & constants. localStorage bus, last-writer-wins conflict resolution with per-tab monotonic timestamps.

**Showcase**: §2.4 ($$x globals), §2 (two-sigil system), §11 (roadmap notes F is v1.2+ but user confirmed all showcase features ship in v1.0)

List milestones M-F1, M-F2, …

**Milestone granularity examples**:
- M-F1: Workspace-global storage layer (localStorage bus, tab identity, monotonic timestamps)
- M-F2: $$x runtime (cross-notebook read/write, conflict resolution)
- M-F3: UI surfaces ($$x variable pills in varbar, popup to edit global values)

### 12. Cross-Cutting Concerns
- **Error boundaries**: React error boundary at Shell level, graceful fallback UI per §6b
- **Accessibility**: ARIA labels on all interactive elements, focus rings (2px outline), keyboard navigation (Tab/Shift+Tab, Enter/Space, Escape), color contrast ≥4.5:1, semantic HTML, per §10a.1
- **Dark/light theme**: CSS custom properties for all colors, toggle button in settings, localStorage persistence
- **Keyboard-first navigation**: ⌘K palette, ⌘G dep graph, ⌘P command-palette alternate, ⌘Z undo, ⌘⇧K keyboard map, ⌥A activity feed, ⌥H interaction history
- **Internationalization of display formats**: time, units, locale per §1b.7; all user-facing strings extracted (i18n infrastructure for future localization)

### 13. Showcase Coverage Matrix
- Table: one row per showcase §-section
- Columns: Showcase §, Feature, Milestone, Status (pending/in-progress/complete)
- Example:
  | Showcase | Feature | Milestone | Status |
  |----------|---------|-----------|--------|
  | §0a | Shell layout | M-B1 | — |
  | §1c | Command palette | M-B5 | — |
  | §3a.1 | Line chart | M-C2 | — |

This matrix is your acceptance test. By the end of Phase F, every row should be complete.

---

## Phase 3: Write IMPLEMENTATION_PLAN.md

Using the structure defined above, write the complete plan. Key guidelines:

1. **Agent prompts must be self-contained**
   - An agent reading a single milestone's prompt must be able to implement it without re-reading the full plan
   - Include file paths, type names, test names, acceptance criteria
   - Example:
     ```
     > **Agent prompt (M-A3):**
     > 
     > Implement the plot DSL sugar parser in `frontend-v2/src/services/parser/plotDslParser.ts`.
     > 
     > Read first:
     > - REDESIGN_INTERFACES.md PlotNode, PlotNodeType, Clause types
     > - showcase.html §3a (12 plot types), §3 (composition, clause tail)
     > - v1's `core/frontend/utils/plotParser.ts` for reference (UPPERCASE parser to be replaced)
     > 
     > Write:
     > - `plotDslParser.ts`: export `parsePlot(source: string): ParseResult<PlotNode>`
     >   - Accept: `line { x: "ts", y: "dur" } | title: "GC pause" | width: 600`
     >   - Accept: `row{ line{...}; col{pie{...}; bar{...}} }`
     >   - Reject with `SugarOnly` diagnostic: `LINE_CHART(...)` and `BAR_CHART(...)`
     >   - Support all 12 types: line, bar, scatter, histogram, boxplot, heatmap, pie, flamegraph, table, gantt, area, range
     >   - Support 3 composers: row{}, col{}, + operator
     >   - Support clause tail (| clauses): title, width, height, link-x, link-y, link-xy, name, settings, disabled, on_hover, on_selection, on_brush
     >   - Property test: `format(format(src)) === format(src)` idempotency for 100 random plots
     > 
     > Tests:
     > - `__tests__/parser.test.ts`:
     >   - Unit: 50+ test cases covering all 12 types, all composers, all clauses, nesting
     >   - Edge cases: empty plot `line{}`, deeply nested `row{col{row{...}}}`, clause order independence
     >   - Error cases: reject `LINE_CHART(...)` with diagnostic, reject unknown clause names
     >   - Property: 1000 random plot sources, format idempotency
     > 
     > Acceptance criteria:
     > - All 50+ unit tests pass
     > - Property test passes 1000 iterations
     > - Parser diagnostics use `SugarOnly` type with suggestion
     > - No UPPERCASE syntax accepted
     > - Type: `ParseResult<PlotNode>` returns either AST or diagnostic array
     ```

2. **Be specific about file paths**
   - Always use `frontend-v2/src/` prefix, never relative paths like `../services/`
   - Example: `frontend-v2/src/services/parser/plotDslParser.ts`, not `parser/plotDslParser.ts`

3. **Reference showcase.html by section**
   - Example: "see showcase.html §3a for 12 plot types" or "showcase.html §5.2 for IN $producer.live-var syntax"
   - Map every major feature to a showcase section so implementers know where to check the spec

4. **Test buckets must be concrete**
   - Don't say "test everything"; say "unit: 30 test cases for parser covering line, bar, scatter + nesting + error rejection; property: format idempotency on 1000 random inputs"
   - Name the test file (e.g., `__tests__/parser.test.ts`)
   - List edge cases by name (e.g., "deeply nested composers", "empty plot", "clause order independence")

5. **Gates must be verifiable**
   - Don't say "works"; say "all unit tests pass, idempotency property test passes, npm run test passes"
   - Chain milestones: M-A2 must complete before M-A3 (parser before formatter depends on parsed AST)

6. **Reuse is explicit**
   - For files adapted from v1, note exactly what changes (e.g., "adapt prop interface to PlotNodeProps")
   - For files created fresh, note they're new

---

## Phase 4: Output Validation

After writing IMPLEMENTATION_PLAN.md, verify:

1. **Showcase coverage**: Every §-section in showcase.html appears in at least one milestone
2. **Milestone count**: ~20–30 milestones total (roughly 3–5 per phase)
3. **Phase sequencing**: Phase A completed before B, B before C, etc.
4. **Agent prompts**: Every milestone has a blockquote prompt; each is self-contained
5. **Test buckets**: Every milestone lists at least one test category
6. **Gate criteria**: Every milestone has a clear gate before the next milestone
7. **File paths**: All paths use `frontend-v2/src/` prefix consistently

---

## Writing Style

- Markdown headings: Use `###` for milestones, `####` for sub-sections within a milestone
- Code blocks: Use triple-backtick fences with language tag (typescript, tsx, bash)
- Agent prompts: Use `> **Agent prompt (M-Xx):**` blockquote style
- Lists: Use bullet points for features, numbered for steps in agent prompts
- Tables: Use Markdown pipe syntax for showcase coverage matrix
- Links: Reference showcase sections like `[showcase.html §3a](...)` or just inline `showcase.html §3a`

Keep line count to 1200–1500 lines (concise but complete).

---

## Final Deliverable

Write the complete IMPLEMENTATION_PLAN.md file to disk at:
```
/Users/i560383_1/code/experiments/jfr-query/redesign-plan/IMPLEMENTATION_PLAN.md
```

Do NOT summarize or abbreviate. This is a working document; agents will implement from it. Every detail matters.
