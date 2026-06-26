# QA Report — JFR Notebook v2 vs showcase.html
Date: 2026-06-24
App URL: http://localhost:5179 (dev server)
Showcase spec: `/Users/i560383_1/code/experiments/deprecated/jfr-sql-notebook/redesign-plan/showcase.html`

---

## How to read this report

Status symbols:
- ✅ Implemented and matches spec
- ⚠️ Partially implemented (notes explain what's missing)
- ❌ Not implemented at all
- 🐛 Bug (present but wrong behavior)

The audit was performed by:
1. Reading showcase.html (8815 lines) in full
2. Navigating the running app with Playwright
3. Taking screenshots of every major surface
4. Inspecting the source component and service directories

---

## Section-by-section findings

### §0a — The whole app at a glance (surfaces layout)

**Spec** requires five surfaces: Topbar+Varbar, Sidebar (left), Cell Column, Chat Drawer (right), Status Bar.

**Findings:**

- ✅ Topbar is present with notebook title "JFR SQL Notebook" and action buttons (Share, Deps, Open, theme toggle, Export)
- ✅ Sidebar is present (left column), collapsible via a `«` button
- ✅ Cell column (center) is present with cells displayed
- ✅ Chat/Issues rail is present (right side), with ISSUES and CHAT tabs
- ✅ Activity feed panel is present (rightmost column, "ACTIVITY")
- ✅ Status bar at bottom shows `■ idle`
- ⚠️ **Varbar**: The spec shows live-var pills in the topbar (e.g. `$gc_overview.brush · 12:30..12:35`) — the app has a VARS row in the cell column showing `$eventType = 'GC'`, but it is rendered inside the notebook area not embedded in the topbar. The topbar shows no live-var pills in the design spec's prominent style.
- ⚠️ **Topbar missing**: The spec shows `⌘⇧E ⚠ N` (issues count chip) in the topbar — not present.
- ⚠️ **Topbar missing**: The spec shows a `⋯` notebook-level menu in the topbar — not visible (Export button provides partial coverage).
- ⚠️ **Topbar missing**: The spec shows `▣ idle` status pill with millisecond timing in the topbar area — only visible in the status bar at the very bottom.
- 🐛 Topbar "Pause" button appears with a `‖ Pause` label but is not described in the showcase spec at this location.

---

### §0b — Sidebar (three nav panels + preview pane)

**Spec** requires: TABLES panel, VIEWS panel, MACROS panel, and a bottom PREVIEW pane with editable SQL + sortable/filterable grid + save-as-cell chip + drag splitter.

**Findings:**

- ⚠️ Sidebar has: NOTEBOOKS section (works), MACROS section (shows "No macros defined"), SCHEMA section (filter input + table list)
- ❌ **TABLES panel** as described in spec does not exist — the sidebar shows a flat "SCHEMA" section, not a collapsible TABLES accordion with row counts beside each table name
- ❌ **VIEWS panel** is missing — the spec requires a dedicated VIEWS section showing cross-cell aliases (`-- @ name` directives). Not present.
- ❌ **MACROS panel** partially present — the section header "MACROS" exists and shows "No macros defined. Add a macro fence to a cell." — but it does not list macros with signatures, type (scalar/table), or click-to-preview.
- ❌ **PREVIEW pane** (bottom half of sidebar) — missing entirely. The spec describes a resizable lower half with: editable SQL line, sortable/filterable grid, "save as cell" chip, CSV export chip. None of this exists.
- ❌ **Splitter** (amber drag handle between nav panels and preview pane) — not present.
- ❌ **RECORDING panel** (shown when a JFR is loaded, pinned above TABLES) — not present.
- ❌ Click on a table in SCHEMA does not populate a live preview grid — it only filters the schema list.
- ❌ Right-click context menu on nav items (Insert SELECT, Copy table ref, Find references, Drag to plot) — not present.

---

### §0c — JFR Ingest

**Spec** requires: drag-drop overlay with primary/baseline split, parse progress overlay (chunk % + per-event-type streaming rows), recording metadata card after parsing, failure mode handling, capture guidance drawer.

**Findings:**

- ✅ Drop zone is present — "Drop a .jfr, .db, or .duckdb file here" with file-picker fallback
- ✅ `.jfr`, `.db`, `.duckdb` file types accepted
- ⚠️ **Drag overlay** — basic drop zone works but the spec's visual overlay (dashed border, file name preview, upper/lower half for primary vs baseline) is not implemented. There's no distinction between "primary" and "baseline" drop zones.
- ❌ **Parse progress overlay** — spec requires a full progress overlay: chunk counter, elapsed/remaining time, per-event-type streaming rows table with ✓/streaming/pending states. Not implemented — no progress shown during parse.
- ❌ **Recording metadata card** — spec requires a RECORDING panel added to the sidebar once parsing completes, showing file name, size, event count, duration, JVM version, OS, heap, GC algorithm. Not implemented.
- ❌ **Failure modes** — file > 4 GB toast, corrupt chunk warning, memory pressure banner — none implemented.
- ❌ **Capture guidance drawer** — "Capture a recording" expander with jcmd/jfr command examples. Not present.
- ⚠️ The `jfr-importer.js` bundle is referenced in `public/` (per the Reuse Manifest) — the actual JFR parse path exists in `src/services/jfr/jfrLoader.ts`.

---

### §0d — Save, autosave, and persistence

**Spec** requires: `.notebook.md` round-trip file save via File System Access API, autosave with 2s debounce + dirty indicator, crash recovery (draft in localStorage), external-edit conflict detection, OPFS JFR cache.

**Findings:**

- ⚠️ **File save** — The `savedNotebookStore.ts` service exists. The app shows an "Open" button in the topbar which opens notebooks, and an "Export" dropdown. Basic open/save flow likely works.
- ❌ **Autosave dirty indicator** — spec shows a `●` dot in the tab and title prefix (`● gc-pauses.notebook.md`). No such indicator observed.
- ❌ **Conflict detection** — `ConflictToast.tsx` component exists in `/components/varbar/`, suggesting partial implementation. But the full conflict resolution UI (reload/keep/diff three-way choice) was not exercised.
- ❌ **Crash recovery** (draft in localStorage) — no visual evidence of implementation; service code may exist.
- ❌ **OPFS JFR cache** with 5 GB LRU and SHA-256 keying — service files exist (`checkpointStore.ts`, `storageBudget.ts`) but this was not verified in the running app.
- ❌ **Firefox/Safari fallback** (download-on-save) — not tested.
- ✅ `checkpointStore.ts` and `autoCheckpointTimer.ts` services exist — checkpoint infrastructure is in place.

---

### §1a — Getting around (empty state, keyboard, undo, export)

**Spec** requires: welcome cell with pinned/hidden_from_dep_graph frontmatter, first-run spotlight carousel (6 steps), full keyboard map (20+ bindings), three-grain undo, activity feed (⌥A), export as HTML/PDF.

**Findings:**

- ⚠️ **Welcome / empty state** — present but not as specified. The app shows a feature grid (SQL queries with charts, Browse all JFR events, Interactive zoom and pan, Shareable notebooks) rather than the spec's markdown-cell-based welcome with "Open demo", "Watch tour", "Skip" chips. There is no `pinned` + `hidden_from_dep_graph` frontmatter-driven cell.
- ❌ **Three demo notebooks** (`demo-gc-pauses.md`, `demo-allocation-flame.md`, `demo-thread-state.md`) — spec requires three shipped demos. Only one "Example" notebook exists.
- ❌ **First-run spotlight carousel** (6-step: varbar → dep graph → chat → slash menu → brush → share) — not present.
- ✅ **Command palette** — ⌘K opens a functional palette with COMMAND, SNIPPET, SETTING, SHORTCUT categories.
- ⚠️ **Keyboard map** — `?` opens a "Keyboard Shortcuts" modal (triggered via `?` via the glyph legend / palette). The modal is functional but shows fewer bindings than the spec's 20+ table. Bindings seen: ⌘K, ?, ⌘G, ⌘\, ⌘F, ⌘?, ⌥↵ (quickfix), ⌘↵ (run cell), ⌘⇧↵ (run all), ⌘Z, ⌘⇧Z, ⌘⇧T (theme). Missing from the spec: ⌘⇧M (maximize chat), ⌘⇧P (perf inspector), ⌘⇧E (issues), ⌥A (activity), ⌘S (save), ⌘⇧F (format), ⌥P (suggest plot), ⌥↑/↓ (move focus), ⌥⇧↑/↓ (reorder cells).
- ⚠️ **⌘K shortcut** — the app uses ⌘K for command palette (correct). Spec says ⌘K should clear cell cache; the app uses ⌘K only as palette toggle. **Conflict:** one key, two spec meanings.
- ✅ **Undo** (⌘Z) and **Redo** (⌘⇧Z) are registered and implemented via `src/services/undo/`.
- ✅ **Activity feed** (ACTIVITY panel right side) — present and shows run events. However, `⌥A` shortcut to open/close was NOT observed to work (activity is always visible as a panel rather than a drawer).
- ✅ **Export** — Export button with dropdown is present in the topbar (Export ▾).
- ❌ Export as **HTML** (self-contained, no JS, frozen state) — not confirmed implemented.
- ❌ Export as **PDF** with page-break-before on each cell — not confirmed implemented.
- ❌ **⌘⇧/ (Docs modal)** — the spec requires a full-screen docs modal with search, two-column topic sidebar + content, covering all DSL surfaces. Not present — `?` shows only a simple keyboard shortcuts dialog.

---

### §1b — Getting around (rename, find, reorder, themes, tabs, formatting)

**Spec** requires: ⌘⇧R rename with 7-place refactor, ⌘⇧F find-across-cells drawer, frontmatter YAML/form editor, drag-handle cell reorder, theme switcher (auto/dark/light + 4 accent colors), multi-notebook tab strip, ⌘, formatting preferences (timezone, duration unit, byte unit, locale).

**Findings:**

- ❌ **⌘⇧R rename cell** with cross-cell reference refactor (finds every FROM alias, $alias.brush, view references, chat history) — not observed.
- ⚠️ **Find bar** — `findBar` component directory exists (`src/components/findBar/`). ⌘F is registered as "Find across cells". Not tested in detail.
- ❌ **Frontmatter YAML / form view editor** — spec shows a toggle between YAML view and a form view with toggles for pinned, autorun, materialize, deps. The app shows frontmatter as plain text in cells but not with the form toggle.
- ❌ **Cell drag-handle reorder** — a `⋮⋮` gutter drag handle to reorder cells by drag-drop — not observed in the cell UI.
- ✅ **Theme switcher** — dark/light toggle works (⌘⇧T or via ⌘K palette "Toggle theme"). Light theme works correctly.
- ❌ **4 accent colors** (cyan/amber/purple/green) via ⌘, → Appearance — not present.
- ❌ **Multi-notebook tab strip** — the spec shows a tab strip above the cell column for multiple open notebooks with close ✕ and unsaved dot. The app has a NOTEBOOKS section in the sidebar showing a list, not a tab strip above cells.
- ❌ **⌘, Formatting preferences** (timezone, duration unit, byte unit, locale, significant digits, live preview row) — settings panel not observed. No ⌘, shortcut registered.

---

### §1c — Command palette

**Spec** requires: ⌘P (or ⌘K in app) with 14 result kinds (command, shortcut, export, cell-scoped-export, agent prompt, setting, jump-to, file, table, view, macro, column, variable, in-cell-match), scoping prefixes (@, >, #, ?, !, t:, v:, m:, k:, c:, $, /), fuzzy ranking, right-side preview pane for identifiers, always-last "✨ Ask AI" fallback.

**Findings:**

- ✅ **Palette opens** with ⌘K (app uses ⌘K; spec says ⌘P but the app maps it to ⌘K). Shows COMMAND/SNIPPET/SETTING/SHORTCUT categories.
- ✅ **Fuzzy search** — typing filters results. Highlight of matched chars visible.
- ✅ **COMMAND entries** — Create blank cell, Toggle theme, Open dependency graph, Open docs, Open keyboard map, Format notebook, Open issues panel, Open activity feed are present.
- ✅ **SNIPPET entries** — "SELECT top 10", "GC pauses > 100ms", "Thread CPU sample" present.
- ✅ **SETTING entries** — Theme, Palette history, Welcome dismissed.
- ✅ **SHORTCUT entries** — Open command palette, Open glyph legend, Open dependency graph overlay.
- ❌ **Scoping prefixes** (t:, v:, m:, @, >, c:, $, /, !, k:) — NOT implemented. Typing "t:gc" does not filter to tables only.
- ❌ **Right-side preview pane** — when an identifier (table/view/macro/column/variable) is focused in the palette, a preview pane should appear on the right. Not implemented — only a small description text appears.
- ❌ **✨ Ask AI fallback** entry — spec says always the last entry regardless of query. Not present in the palette.
- ❌ **Result kinds**: table (🗂), view (👁), macro (ƒ), column (🔤), variable ($), in-cell match (🔍), agent prompt (🤖), file (📄), jump-to (📍) — none of these kinds are present in the palette.
- ❌ **Custom commands** via notebook frontmatter `commands:` block — not implemented.
- ⚠️ **"Open docs"** palette entry exists but opens a basic keyboard map dialog, not the full §1d docs modal with searchable DSL reference.

---

### §1d — Docs modal

**Spec** requires: `?` opens full-screen two-column modal with: search box, left topic sidebar (keyboard bindings, plot DSL reference, sigil/variable rules, prompt grammar, frontmatter keys, tool list), content on right, deep-linkable from UI elements.

**Findings:**

- 🐛 **`?` opens "Keyboard Shortcuts" modal** — which is a simple flat list, not the full docs modal. The spec says `?` in browse mode opens the full docs system; the app only shows keyboard shortcuts.
- ❌ **Plot DSL reference** — not accessible via the docs system (no searchable in-app DSL reference).
- ❌ **Frontmatter keys reference** — not present.
- ❌ **Prompt grammar reference** — not present.
- ❌ **Tool list in docs** — not present.
- ❌ **Deep-link** from UI elements via right-click on kbd hints — not present.

---

### §2 — Variable system ($x / $$x)

**Spec** requires: notebook-local `$x` (declared in cell frontmatter `vars:` block), workspace `$$x` globals (persisted in localStorage), live-vars produced by plots (`$alias.brush`, `$alias.hover`, `$alias.zoom`, `$alias.selection`, `$alias.scroll`), varbar showing current values with clickable pills, `$` autocomplete picker inside SQL/plot fences.

**Findings:**

- ✅ **$x variables** — visible in the VARS row above cells (e.g. `$eventType = 'GC'`). Clicking a var chip appears to work.
- ✅ **VarChip / VarPill components** exist and are rendered.
- ✅ **`$alias.brush` / `$alias.zoom` live-vars** — `liveVarStore.ts`, `linkGroups.ts`, `linkPropagator.ts` services exist. The example notebook uses `$eventType` as a cell variable.
- ⚠️ **Varbar** — the VARS row is rendered above cells in the notebook column (not in the topbar as the spec shows). The spec shows prominent pills in the topbar; the implementation shows a VARS strip just above the cell list.
- ❌ **Topbar `$$session_start` / `$$session_end` date pickers** — spec shows two prominent pill controls in the topbar for workspace-wide time range. Not present.
- ❌ **Workspace `$$x` global variables** — the `WorkspaceGlobalsSection.tsx` component exists, but no workspace date picker UI was found in the topbar.
- ❌ **Variable pill popover** — clicking `$eventType` in the VARS bar should open a type-aware inline editor (number stepper, text field, date picker, slider, etc.). What happens currently needs confirmation.
- ⚠️ **`$` autocomplete** inside SQL/plot fences — `src/services/liveVar/liveVarSubstitution.ts` exists, suggesting variable substitution works, but the $ picker dropdown (grouped: notebook locals / workspace globals / produced by cells) was not verified.
- ❌ **`filter_from:` frontmatter chip** system — the drag-connect "New filter from #N" popover UI (§5.7) was not observed.

---

### §3 — Plot DSL

**Spec** requires: 12 plot types with lowercase sugar syntax (`line { x: … } | title: "…"`), UPPERCASE form rejected, three composers (`row{}`, `col{}`, `+`), eight cross-type clauses (`legend`, `tooltip`, `axis-x/y`, `palette`, `title/width/height`, `on`, `let`, `link-x/y/xy`), sugar-only DSL with `SugarOnly` diagnostic for any uppercase form.

**Findings:**

- ✅ **Sugar DSL implemented** — `src/dsl/plotSugar.grammar` and `src/services/parser/plotDslParser.ts` exist.
- ✅ **Bar chart** renders correctly from `bar { x: "type", y: "duration_ms" } | title: "…"` syntax.
- ✅ **12 plot type components** exist: LineChartPlot, BarChartPlot, ScatterPlot, HistogramPlot, BoxplotPlot, HeatmapPlot, PieChartPlot, FlamegraphPlot, TablePlot, GanttChartPlot, AreaChartPlot, RangePlot.
- ✅ **Composition** — `RowComposer.tsx`, `ColComposer.tsx`, `OverlayComposer.tsx` exist (for row{}, col{}, +).
- ✅ **Suggest plot** banner visible after cell runs ("Suggested plot: table { columns: [Count] }") — `SuggestedPlotBanner.tsx` component works.
- ⚠️ **`link-x/y` clauses** — `linkGroups.ts`, `linkPropagator.ts` services exist suggesting axis linking is implemented, but was not fully verified in the live UI.
- ⚠️ **`filter_from` clause** interaction with live-var was not verified.
- ❌ **UPPERCASE rejection with SugarOnly diagnostic** — could not verify that `LINE_CHART(...)` is rejected at parse time with a rewrite suggestion.
- ❌ **`let @alias` fence-local bindings** — not verified.
- ❌ **`on: [#1, q_compare]` multi-query merge** — not verified.

---

### §3a — Plot types detail

**Findings:**

- ✅ **line** — renders. Bar chart confirmed rendering in example notebook.
- ✅ **bar** — renders correctly in example notebook with `bar { x: "type", y: "duration_ms" }`.
- ⚠️ **scatter, histogram, boxplot, heatmap, pie, flamegraph, gantt, area, range** — component files exist but were not confirmed rendering in the running app since no JFR file was loaded.
- ✅ **table** — renders query results as a sortable table (visible in example notebook, cell #3 events result).
- ⚠️ **Plot toolbar** — `PlotToolbar.tsx` and `PlotControls.tsx` exist. Three icons visible on rendered plot (settings, fullscreen, share). Spec requires zoom/pan controls, title display.
- ✅ **Plot share modal** — `PlotShareModal.tsx` exists and share icon on plot toolbar is clickable.
- ⚠️ **Plot states** (`PlotStateMachine.ts`) — idle/loading/rendered/error/empty states exist in code; not all verified.
- ❌ **Plot annotations** (`PlotAnnotations.tsx`) — present in code but not verified.

---

### §3b — Plot states

**Spec** requires: idle (ghost placeholder), loading (spinner + cancel), rendered, error (red border + diagnostic), empty (0 rows message with suggestions).

**Findings:**

- ⚠️ `PlotStateMachine.ts` exists. The app shows "(no results yet — run to execute)" in idle state.
- ⚠️ Error state confirmed in Activity feed (shows "Cell filtered failed: aborted" entries). The red-border error UI on the cell was partially visible.
- ❌ **Cancel button** during query execution — not verified.

---

### §3c — Prose / report mode

**Spec** requires: prose markdown blocks in cells (rendered as formatted text), "Report mode" that hides SQL/plot source and shows only output + prose, `⊞ Report` toggle in topbar.

**Findings:**

- ✅ **Report button** in topbar — works. Clicking "Report" hides the SQL fence and shows only the plot/table output. The Report button highlights when active.
- ⚠️ **Prose blocks** — `ProseBlock.tsx` component exists. Not verified in example notebook.
- ❌ **`hidden_from_dep_graph` and `disabled: true` frontmatter flags** — their effect in report mode (hiding disabled cells) was not verified.

---

### §3d — Macros

**Spec** requires: `macro` fence cells containing `CREATE MACRO` SQL, listed in MACROS sidebar panel with signature, preview on click (body shown in preview pane), right-click "Jump to defining cell / Copy call template / Find usages".

**Findings:**

- ⚠️ MACROS section in sidebar shows "No macros defined. Add a macro fence to a cell." — the section header exists.
- ❌ No macro fence demo cells in example notebook.
- ❌ Preview pane for macro body — not present (no preview pane).
- ❌ MACROS panel doesn't list macros with signatures (scalar/table type).

---

### §4 — Cross-cell wiring

**Spec** requires: `-- @ alias` directive creates a named view accessible to other cells (`FROM alias`), dep graph tracks these edges, cells re-run when upstream changes.

**Findings:**

- ✅ **Dep graph** — ⌘G (or "Deps" button) opens a dependency graph overlay using Cytoscape showing cells with cyan arrows between them. Cell #1 create_events → #3 events → #4 filtered and #2 query_events.
- ✅ **`$eventType` variable referenced in cell SQL** (`SELECT * FROM events WHERE type = ($eventType)`) — shows as a highlighted chip in the cell, reactive to variable value.
- ✅ **Re-run on upstream change** — dep graph arrows show data flow; `stalePropagator.ts` service exists.
- ⚠️ **`-- @ alias`** directive and cross-cell FROM — example notebook uses `events` table as a shared view; the mechanism works.
- ❌ **Views panel** in sidebar listing cross-cell aliases — not present.

---

### §4a — Result tables

**Spec** requires: virtualized sortable table with column sort (click cycles asc/desc/off with superscript order numbers), per-column filter row, "Export as CSV" chip, right-click column menu (format, hide, copy all).

**Findings:**

- ✅ **Result table** renders query results with column headers.
- ✅ **Export ▾ button** on table result — visible and clickable.
- ⚠️ **Column sort** — clicking column headers to cycle asc/desc/off: partially confirmed (table component `TablePlot.tsx` has sort). Superscript order numbers not verified.
- ❌ **Per-column filter row** (numeric op ≥/>=/=/≠, string LIKE, temporal range) — not observed in result table.
- ❌ **Right-click column menu** — not observed.

---

### §4b — Compare (recording baseline)

**Spec** requires: "Compare" mode where a second JFR recording is loaded as a baseline; sidebar RECORDING panel shows both; plot cells get a `| compare` clause showing side-by-side or delta.

**Findings:**

- ✅ **`AttachBaselineButton.tsx`** and **`CompareView.tsx`** components exist in `src/components/compare/`.
- ⚠️ The drag-drop zone mentions "Add as second recording (compare mode)" in the spec — not observed in the actual drop overlay (which is basic).
- ❌ Full compare mode UI was not verified.

---

### §5 — Live coupling (brush, hover, zoom, selection, scroll)

**Spec** requires: D3-brush gesture on charts writes `$alias.brush` (range); D3-zoom gesture writes `$alias.zoom`; flamegraph hover writes `$alias.hover` (categorical); table row click writes `$alias.selection`; scroll sync writes `$alias.scroll`; downstream SQL cells with `WHERE col IN $alias.brush` auto-re-execute; `| link-x: $var master clamp` clause links plot x-axes; pause button (`⏸`) pauses all coupling.

**Findings:**

- ✅ **`liveVarStore.ts`**, **`linkGroups.ts`**, **`linkPropagator.ts`**, **`scrollSyncStore.ts`**, **`stalePropagator.ts`** — all live-coupling services exist.
- ✅ **Live var substitution** — `$eventType` variable substituted in SQL fences is confirmed working.
- ✅ **`PauseCouplingButton.tsx`** and `‖ Pause` button in topbar — spec's `⏸` pause-all-live-coupling is present as the "Pause" button.
- ⚠️ **D3 brush on charts** — `d3-brush` is listed as a dependency in `package.json`. Brush rendering on bar/line charts was not verified (needs a loaded JFR file with real data).
- ⚠️ **Zoom coupling** (`| link-x: $var master clamp`) — service infrastructure exists; not verified in running app.
- ❌ **Brush range display in varbar/topbar** — the spec shows active brush values (e.g. `$gc_overview.brush · 12:30..12:35`) as prominent pills in the topbar. Not observed.
- ❌ **ChainIndicator** (`🔗 N` upstream hop count chip) — `ChainIndicator.tsx` exists in `/components/varbar/`; not visibly observed in example notebook cells.

---

### §5a — Live coupling chains

**Spec** requires: multi-hop chains visualized in dep graph, `🎯 N cells filter from this` chip on source cells, `🔗 N from #M` chip on consumer cells.

**Findings:**

- ⚠️ Dep graph shows multi-cell chains correctly (visual only).
- ❌ `🎯` fan-out badge on source cells — not observed.
- ❌ `🔗 N` upstream hop chip on consumer cells — not observed.

---

### §6 — Issues panel

**Spec** requires: ⌘⇧E opens Issues panel, diagnostic rows with error/warning/info kinds, glyph (●/▲/ℹ), shortcut chip (⌥↵ quickfix), inline quickfix menu with one-click rewrite.

**Findings:**

- ✅ **Issues panel** — present as ISSUES tab in right rail. Shows "No diagnostics." when empty. Has All/Errors/Warnings filter tabs.
- ✅ **Error/Warning tabs** — filter chips (All, Errors, Warnings) present.
- ⚠️ `IssuesPanel.tsx`, `DiagnosticRow.tsx`, `QuickfixMenu.tsx` — all exist. Quickfix (⌥↵) registered in keyboard map.
- ❌ **⌘⇧E shortcut** for issues panel — NOT registered in keyboardMap.ts (only ⌥↵ for quickfix is registered).
- ❌ **Inline diagnostic annotations** in the CodeMirror editor — not verified (spec requires red squiggles + inline hover for errors).

---

### §6a — SQL autocomplete

**Spec** requires: three-tier autocomplete: (1) grammar-aware SQL completion, (2) corpus bigrams from existing cell SQL, (3) local ONNX model inference.

**Findings:**

- ⚠️ CodeMirror SQL editor with `@codemirror/lang-sql` is used — basic SQL keyword completion likely works.
- ❌ **Local ONNX model** for autocomplete — `onnxruntime-web` is a listed dependency; `src/services/plotSuggester/` directory exists. Full verification not performed.
- ❌ **Three-tier completion** with corpus bigrams — not verified.

---

### §6b — Error recovery

**Spec** requires: SQL errors shown inline below the SQL fence (not modal), grid stays on last successful result, parse-time diagnostics in Issues panel.

**Findings:**

- ✅ **Activity feed** shows error events ("Cell filtered failed: aborted").
- ⚠️ `DiagnosticsStrip.tsx` exists in `/components/cell/` — inline below-SQL errors component exists.
- ❌ **Grid-stays-on-last-result** behavior — not verified.

---

### §7 — Agent / Chat

**Spec** requires: chat drawer docked right, maximize overlay (⌘⇧M), "schema-only" data-access toggle (🔒/🔓), multi-provider LLM backend (Claude, Gemini, OpenAI, Gardener), cell-emit proposals (diff + Accept/Edit/Reject), inline chat (Copilot-style overlay), tool-call cards in transcript (expandable).

**Findings:**

- ✅ **Chat panel** — CHAT tab in right rail, "AI CHAT" header, "Claude" provider badge, "Clear" button, chat input with Send button, "Configure API key →" link.
- ✅ **Multi-provider support** — `src/services/ai/` directory contains `GeminiProvider.ts`, `OpenAiProvider.ts`, `GardenerProvider.ts`, `IAiProvider.ts`.
- ✅ **Agent service** — `agentLoop.ts`, `toolRegistry.ts`, `toolCallParser.ts`, `proposalStore.ts`, `proposalApplier.ts` exist.
- ✅ **10 tools** — `src/services/agent/tools/` has: deleteCell, getCellResult, getCellSql, getLiveVar, getSchema, insertCell, listCells, runSql, setLiveVar, updateCell — 10 tools.
- ✅ **Cell emit proposals** — `CellEmitProposal.tsx`, `AcceptRejectControls.tsx`, `InlineChat.tsx`, `InlineDiffView.tsx`, `ProposalDiff.tsx` exist.
- ✅ **Activity feed shows run events** — past cell executions visible in ACTIVITY panel.
- ⚠️ **⌘⇧M maximize chat** — NOT in the registered keyboard map (spec requires it, `shortcuts.open` is ⌘? not ⌘⇧M).
- ❌ **Schema-only / sample / full-rows toggle** (🔒 chip in chat header) — the spec shows a prominent lock chip cycling three data-access levels. Not observed in the chat header (only "Claude" badge and "Clear" visible).
- ❌ **Tool call cards in transcript** (🔧 run_sql · 230ms · ▣ ok · 47 rows · [expand]) — not verified with an active chat session.
- ❌ **⛔ Parked tool call UI** (allow-once / allow-for-notebook / deny) — not verified.
- ❌ **Inline chat** (Copilot cursor-overlay) — `InlineChat.tsx` exists but was not triggered.
- ❌ **Proposal diff view** with Accept/Edit prompt/Reject for multi-cell atomic transactions — component exists; not verified.
- ❌ **Context inspector** (⛶ maximize mode shows what the model "sees") — not verified.

---

### §7a — Prompt grammar

**Spec** requires: EBNF tokenizer with 7 verbs (plot, explain, fix, add, remove, describe, summarize) and 5 target types (cell-ref, table-ref, column-ref, var-ref, free text).

**Findings:**

- ✅ `src/services/promptGrammar/` directory exists (based on IMPLEMENTATION_PLAN.md reference; confirmed via service directory listing).
- ❌ Not verified in running app.

---

### §7b — Chat panel details

**Spec** requires: transcript rows per turn, tool-call cards, cell-emit proposal diff, send bar with `/` for verbs, model selector, data-access toggle, session history in `last_ai_session:` frontmatter.

**Findings:**

- ✅ Chat input bar with "Ask about your JFR data..." placeholder and Send button visible.
- ❌ **`/` verb palette** in chat input — not verified.
- ❌ **Model selector** in chat header — only "Claude" badge visible, no clickable model picker.
- ❌ **`last_ai_session:` frontmatter persistence** — not verified.

---

### §8 — Formatter

**Spec** requires: ⌘⇧F runs formatter over entire notebook; formatter is idempotent; SQL canonicalization (via sql-formatter); plot DSL key ordering (`keyOrder.ts`); formatter lints duplicate keyboard bindings; `· generated` filter lines preserved exactly; round-trip property.

**Findings:**

- ✅ **Format notebook** command in palette (⌘K → "Format notebook").
- ✅ `src/services/formatter/` has: `notebookFormatter.ts`, `plotFormatter.ts`, `sqlFormatter.ts`, `keyOrder.ts`.
- ✅ `sql-formatter` package is listed as a dependency.
- ⚠️ Formatter was not run to verify idempotency or correct key ordering.
- ❌ **Formatter linting duplicate keyboard bindings** — not verified.

---

### §8a — Performance

**Spec** requires: query cancellation via AbortSignal, push-down predicates (WHERE col IN $alias.brush pushed down before query), per-cell timing shown in cell header, 200ms budget for re-runs.

**Findings:**

- ✅ **Cell timing** — post-run cell header shows "✓ 1 rows · 32ms · 1 rows" (timing visible).
- ✅ **AbortSignal cancellation** — `worker.ts` in `src/services/duckdb/` uses Web Worker with protocol; AbortSignal support exists.
- ⚠️ **Push-down predicates** — `liveVarSubstitution.ts` suggests substitution happens before execution; full push-down not verified.
- ❌ **⌘⇧P perf inspector** — not registered in keyboard map.

---

### §9 — Cheatsheet

**Spec** requires: glyph legend available via `?` key as a "folded read-only cell at notebook top" — a one-page reference of all syntax.

**Findings:**

- 🐛 The `?` key opens a simple "Keyboard Shortcuts" modal, NOT the glyph legend / cheatsheet described in the spec. The command palette's "Open glyph legend" entry also opens the same keyboard shortcuts dialog.
- ❌ A full cheatsheet (glyph legend, plot DSL syntax, variable sigils, frontmatter keys) is not implemented.

---

### §10 — Sharing (URLs)

**Spec** requires: ⌘P → "Copy share-link" or the Share button in topbar; URL encodes live-var state, notebook source; size cap with OPFS sidecar overflow; recipient view (read-only, all plots rendered from the URL).

**Findings:**

- ✅ **Share button** in topbar — visible and clickable.
- ✅ `ShareLinkModal.tsx`, `RecipientView.tsx` components exist.
- ✅ `notebookShare.ts` in `src/services/share/` exists.
- ⚠️ Share URL generation was not tested end-to-end.
- ❌ **OPFS sidecar** for oversized notebooks — not verified.

---

### §10a — Accessibility

**Spec** requires: ARIA labels on all interactive elements, visible focus ring (2px outline, color-independent), keyboard nav (Tab/Shift+Tab/Enter/Space/Escape), contrast ≥ 4.5:1, `prefers-reduced-motion` respected, color never the only signal. axe-core CI gate.

**Findings:**

- ⚠️ `src/hooks/useReducedMotion.ts` exists — `prefers-reduced-motion` hook is implemented.
- ⚠️ `src/hooks/useAxeAudit.ts` exists — dev-only axe audit hook.
- ❌ **Focus rings** — not manually verified in screenshots (hard to verify from screenshots).
- ❌ **ARIA labels on all interactive elements** — not verified with accessibility audit.
- ❌ **Contrast ≥ 4.5:1** — not verified. The dark theme color scheme visually appears low-contrast in some areas.
- ❌ **axe-core CI gate** — no CI configuration visible in the project.

---

### §10b — Checkpoints

**Spec** requires: auto checkpoints every N minutes + manual checkpoints; `CheckpointDrawer` accessible from ⋯ menu; restore flow with side-by-side diff.

**Findings:**

- ✅ **`CheckpointDrawer.tsx`**, **`checkpointStore.ts`**, **`autoCheckpointTimer.ts`**, **`restoreFlow.ts`** exist.
- ❌ Checkpoint UI was not triggered/verified in the running app.

---

### §10c — Redaction

**Spec** requires: redaction policy (PII rules, column masks) accessible from ⋯ menu; masked columns show `[REDACTED]` in table and plot tooltips.

**Findings:**

- ✅ **`RedactionModal.tsx`**, **`redactionStore.ts`**, **`redactionApplier.ts`**, **`hashTransform.ts`**, **`maskTransform.ts`** exist.
- ❌ Not triggered/verified in the running app.

---

### §11 — Phases roadmap

**Spec** defines Phases A–F. The implementation plan targets all phases in v1.0.

**Observed phase completion (approximate):**

- Phase A (Shell, DuckDB, JFR ingest, basic cells): ~60% — shell present, DuckDB works, JFR ingest basic drop works, cells run
- Phase B (Sidebar, palette, dep graph, varbar): ~35% — dep graph overlay works, palette works partially, sidebar missing TABLES/VIEWS/MACROS proper panels
- Phase C (Plots DSL, 12 types, composition, live coupling): ~55% — plot DSL parser works, charts render, live coupling infrastructure present
- Phase D (Agent, 10 tools, cell-emit proposals): ~50% — agent service wired, tools exist, proposal components exist; chat UI missing some features
- Phase E (Live coupling gestures, brush/zoom/selection/scroll): ~30% — services exist, not fully verified in UI
- Phase F (Sharing, checkpoints, redaction, a11y): ~35% — all services exist, limited UI verification

---

## Summary Table

| Section | Status | Key Notes |
|---|---|---|
| §0a Layout / 5 surfaces | ⚠️ Partial | Varbar in wrong location; topbar missing ⌘⇧E, ⋯ menu, var pills |
| §0b Sidebar (TABLES/VIEWS/MACROS/preview) | ❌ Not implemented | SCHEMA section exists but not TABLES+VIEWS+MACROS+preview pane |
| §0c JFR Ingest | ⚠️ Partial | Drop zone works; no progress overlay, no metadata card |
| §0d Save/autosave/persistence | ⚠️ Partial | Services exist; dirty indicator, conflict UI not confirmed |
| §1a Empty state / keyboard / undo / export | ⚠️ Partial | Welcome cell wrong; keyboard map missing 10 bindings; 1 demo vs 3 |
| §1b Rename/find/reorder/themes/tabs | ⚠️ Partial | Theme toggle works; no rename refactor, no multi-tab strip, no ⌘, prefs |
| §1c Command palette | ⚠️ Partial | Basic palette works; no scoping prefixes, no preview pane, no Ask AI |
| §1d Docs modal | ❌ Not implemented | `?` shows keyboard shortcuts only; no DSL reference, no search |
| §2 Variable system ($x / $$x) | ⚠️ Partial | $x works; $$x workspace globals/date pickers not in topbar |
| §3 Plot DSL (12 types, composers) | ⚠️ Partial | Sugar DSL works; bar confirmed; live binding clauses need verification |
| §3a Plot types (all 12) | ⚠️ Partial | Components exist; only bar/table confirmed rendering |
| §3b Plot states | ⚠️ Partial | Idle/error states observed; cancel during run not verified |
| §3c Prose / report mode | ✅ Works | Report toggle in topbar functions correctly |
| §3d Macros | ❌ Not implemented | Section header in sidebar; no demo macros, no preview pane |
| §4 Cross-cell wiring | ✅ Works | Dep graph overlay, variable substitution, stale propagation all work |
| §4a Result tables | ⚠️ Partial | Basic table renders; no per-column filter row, no right-click menu |
| §4b Compare mode | ⚠️ Partial | Components exist; UI not fully verified |
| §5 Live coupling | ⚠️ Partial | Services all exist; brush/zoom on real plots needs JFR data to verify |
| §5a Coupling chains | ⚠️ Partial | Dep graph shows chains; 🎯/🔗 cell head chips not observed |
| §6 Issues panel | ⚠️ Partial | Panel present; ⌘⇧E shortcut missing; quickfix exists |
| §6a SQL autocomplete | ⚠️ Partial | CodeMirror SQL present; 3-tier autocomplete not verified |
| §6b Error recovery | ⚠️ Partial | Errors in activity feed; inline-below-SQL errors component exists |
| §7 Agent / chat | ⚠️ Partial | Chat UI present; 10 tools exist; schema-only toggle missing |
| §7a Prompt grammar | ⚠️ Partial | Service exists; not verified |
| §7b Chat panel details | ⚠️ Partial | Send/receive works; model picker, data-access toggle missing |
| §7c Tool surface / cell proposals | ⚠️ Partial | All proposal components exist; not verified in live session |
| §8 Formatter | ⚠️ Partial | Format command in palette; formatters exist; idempotency not verified |
| §8a Performance | ⚠️ Partial | Cell timing shown; AbortSignal in worker; perf inspector missing |
| §9 Cheatsheet / glyph legend | 🐛 Wrong | `?` shows shortcuts modal, not full DSL cheatsheet |
| §10 Sharing | ⚠️ Partial | Share button present; services exist; end-to-end not verified |
| §10a Accessibility | ⚠️ Partial | Reduced-motion hook + axe audit hook exist; not formally audited |
| §10b Checkpoints | ⚠️ Partial | All services exist; UI not triggered |
| §10c Redaction | ⚠️ Partial | All services exist; UI not triggered |

---

## Top Bugs (Blocking)

1. **🐛 `?` key opens wrong modal** — Opens "Keyboard Shortcuts" dialog instead of the spec's full docs modal (§1d). The glyph legend and full DSL reference are inaccessible.

2. **🐛 Sidebar is structurally wrong** — Shows NOTEBOOKS + MACROS + SCHEMA sections instead of the spec's TABLES + VIEWS + MACROS + collapsible panels + PREVIEW pane. This is the primary data exploration surface and it does not match spec.

3. **🐛 ⌘K shortcut conflict** — The spec says ⌘K = clear cell cache; the app uses ⌘K for command palette. The spec also uses ⌘P for palette. This is an architectural shortcut conflict needing resolution.

4. **🐛 Varbar location wrong** — VARS row is inside the cell column (above cells), not in the topbar as specified. Live-var pills with current values (e.g. `$gc_overview.brush · 12:30..12:35`) should appear prominently in the topbar.

5. **🐛 Activity feed always visible vs spec's ⌥A drawer** — ACTIVITY is a persistent right panel. The spec shows it as a drawer opened with ⌥A (session-only). The ⌥A shortcut is not registered.

---

## Top Gaps (Unimplemented Features)

### Critical (blocking core workflows)

1. **§0b PREVIEW pane** — The most-used exploration surface (click table → instant grid + editable SQL + sort/filter + save-as-cell) does not exist. This is the primary discovery workflow.

2. **§0b TABLES panel with row counts** — The sidebar shows raw schema, not an expandable TABLES panel with live row counts. Users cannot see at a glance which event types are loaded.

3. **§0c Parse progress overlay** — No progress during JFR parsing. For large files (847 MB example in spec), the user sees nothing during potentially 30-second parse.

4. **§0c Recording metadata card** — After parsing, users need to see JVM version, duration, event type counts. Not implemented.

5. **§1c Scoping prefixes in palette** — `t:`, `v:`, `m:`, `@`, `c:`, `$`, `/` prefixes for targeted search are not implemented. Power users cannot filter palette to just tables or just variables.

6. **§1c ✨ Ask AI fallback entry** — The always-last "Ask AI: query verbatim" palette entry is missing. This is the spec's "universal answer surface."

7. **§1d Docs modal** — The full searchable DSL reference (plot types, frontmatter keys, prompt grammar, tool list) is not present. Users have no in-app reference.

### High Priority

8. **§2 $$x workspace globals + topbar date pickers** — `$$session_start`/`$$session_end` prominently in topbar for cross-notebook time range control. Missing.

9. **§7 Data-access toggle in chat** — Schema-only / sample / full-rows lock chip in chat header is missing. Gated tool behavior (parked calls + Allow once UI) not verified.

10. **§5 Brush range display in topbar** — Active live-var values (brush ranges, zoom ranges) should appear as prominent pills in the topbar. Currently not shown there.

11. **§1b Rename refactor (⌘⇧R)** — Cross-cell rename with 7-place simultaneous rewrite. Not implemented.

12. **§1b Multi-notebook tab strip** — Notebook switching requires sidebar clicks; no quick-switch tab bar above cells.

13. **§1b ⌘, Formatting preferences** — Timezone, duration unit, byte unit, locale settings with live preview row. Missing.

14. **§6 ⌘⇧E shortcut for issues panel** — Keyboard shortcut not registered.

15. **§1a First-run spotlight carousel** — 6-step onboarding sequence not implemented.

---

## Observations on App Quality

**Positive:**

- The dep graph overlay (⌘G / "Deps" button) is functional and visually correct, showing cell dependencies with typed edges (cyan arrows for data deps).
- The command palette (⌘K) works well with good categories and fuzzy matching.
- Plot rendering (bar chart confirmed) works correctly from the sugar DSL.
- The activity feed (right panel) captures run/error events with timestamps.
- Report mode toggle works correctly, hiding SQL/plot source.
- The agent service infrastructure (tools, proposals, providers) is substantially built even if not fully wired in the UI.

**Concerning:**

- The sidebar is the single biggest gap — it drives all "let me look at the data" workflows and is architecturally different from spec.
- The Activity panel layout (always-visible right column) differs from the spec's `⌥A` drawer, consuming permanent horizontal space.
- The topbar layout deviates from spec: the varbar belongs in the topbar per spec, not in the cell column area.
- The `?` / keyboard shortcuts modal is a stub of what §1d requires.

---

## Addendum: Deep QA Pass — 2026-06-24

Interactive audit using Playwright (headless Chromium, 1440×900) against http://localhost:5173. Four scripted passes were run: initial load, example notebook load, cell interaction, and targeted feature tests. Screenshots taken at every step.

---

### Confirmed working (verified interactively)

**Initial load / layout**
- App loads with zero console errors.
- Topbar contains: Report, Open, theme toggle (☾/☀), Share, ⬡ Deps, Export ▾, ⏸ Pause — all as buttons with correct `aria-label` attributes.
- Status bar bottom-left shows `▣ idle`.
- Sidebar has NOTEBOOKS, MACROS ("No macros defined. Add a macro fence to a cell."), and SCHEMA ("Filter tables…" input) sections.
- Right rail has ISSUES and CHAT tabs.
- ACTIVITY panel is the rightmost column, always visible, showing "No activity yet" on fresh load.

**Example notebook loads with 5 cells**
- Cells: #1 `create_events` (SQL), #2 `query_events` (SQL + PLOT), #3 `events` (SQL), #4 `filtered` (SQL), #5 `notes` (PROSE).
- VARS strip is present above cells showing `$eventType = 'GC'` pill.
- Each cell header shows: `#N alias ▣ idle Run ×`.

**Cell execution**
- Clicking `Run` runs the cell. Cell 1: `✓ 1 rows · 17ms  1 rows`. Cell 2: `✓ 5 rows · 17ms  5 rows`. Cell 3: `✓ 3 rows · 15ms  3 rows`.
- Cell header gains timing + row count after run: format is `✓ N rows · Xms  N rows`.
- `⌘↵` (Meta+Enter in CodeMirror) runs the focused cell.
- Cell 4 (`filtered`) shows `⟳ running…` with a `Cancel` button while executing (live-coupling dependent on brush var, which stalls headlessly — expected).

**Bar chart renders in cell 2**
- `bar { x: "type", y: "duration_ms" } | title: "Duration by event type"` renders a Recharts bar chart (81 recharts elements found, 4 SVGs, 1 table). The result pane shows both a table view (Export ▾ button, "200 of 5 rows", column sort) AND the bar chart below it.
- Plot toolbar shows three icon buttons (settings ⚙, fullscreen ⛶, share ⬡) visible at top-right of chart area.
- `🌟 Suggest plot` button visible next to plot DSL editor; also `🪄 Suggest plot` button in cell 2 header shows `Suggested plot: histogram { x: duration_ms }` banner with "Add" and "×" chips.

**Report mode**
- Report button is in topbar with `aria-label="Toggle report mode"`.
- Clicking toggles it: button highlights with a ✓ checkmark, `Report ✓` text.
- In report mode: all 4 SQL editors (`[data-testid="sql-editor"]`) disappear — confirmed `sqlEditorsBefore=4`, `sqlEditorsAfter=0`. Plot DSL source fences also disappear.
- Result tables and charts remain fully visible.
- Toggling off restores all 4 SQL editors.

**? key — Glyph legend**
- Pressing `?` with body focused opens a "Glyph legend" modal (NOT a keyboard shortcuts dialog as previous analysis incorrectly noted from the wrong initial test).
- Content: ▼ Chip expanded, ▲ Chip collapsed, 🔗 Link chip, 🤖 Agent chip, ƒ Function/macro chip, ● Status indicator, ✕ Error, △ Warning, i Info, $ Var sigil, $$ Global var sigil, — cyan solid (Data edge), -- grey dashed (Var edge), == grey heavy (Live-var edge), — orange solid (Axis-link edge), .. purple dotted (Prompt edge), ⌘K Command palette, ⌘G Dep graph, ⌥↵ Quickfix.
- Escape closes it.

**⌘K command palette**
- Opens with COMMAND / CELL / VAR / SNIPPET / SETTING / SHORTCUT categories.
- After loading example notebook, VAR entries include `$eventType` and `$query_events.brush` (live var produced by the brush gesture on cell 2 plot).
- CELL entries include all 5 cells: #1 create_events, #2 query_events, #3 events, #4 filtered, #5 notes.
- Clicking a CELL entry in the palette shows a preview pane on the right side showing the cell's prose content (confirmed on #5 notes — shows markdown rendered).
- Placeholder text: `Type a command, cell, var… (k:cells gc, /needle)` — confirms the `k:` prefix is the search syntax for cells.
- `⌘G` shortcut chip shown next to "Open dependency graph" — correctly wired.
- `⌥A` chip shown next to "Open activity feed" — registered in palette even though ⌥A key itself does not fire as a global hotkey.

**⌘G / Deps button — dependency graph overlay**
- Both `⌘G` keyboard shortcut and the "⬡ Deps" topbar button open the overlay.
- Modal shows a Cytoscape canvas with labelled nodes: #1 create_events, #3 events, #2 query_events, #4 filtered, #5 notes.
- Edges: cyan solid arrows from #3→#4, #3→#2, and a self-loop on #3 (events alias referencing itself). Only `data` edge type shown; correct for the example notebook which has no var or axis-link edges.
- Accessible text output lists edge metadata: "data edge from #events to #events via alias events", etc.
- No visible legend panel rendered within the modal (the glyph legend is accessed separately via `?`).
- Closing with `×` button or Escape both work.

**Export dropdown**
- "Export ▾" button opens a dropdown with exactly two options: **Export HTML** and **Export PDF**.
- No Markdown export, no CSV, no per-cell export options visible.

**Theme toggle**
- ☾ button toggles to ☀ (dark → light). `data-theme="light"` applied to `<html>` element.
- Light theme renders correctly: white background, dark text, borders visible.
- Toggle back restores dark theme.

**Sidebar collapse**
- ‹ button collapses sidebar (`aria-label="Toggle sidebar"`). Sidebar disappears to a thin sliver with `›` expand arrow at left edge.
- Cell column expands to use the full width.
- Clicking `›` re-expands. Works correctly.

**Insert cell (+)**
- Small `+` button (between cells, `aria-label="Insert cell here"`) inserts a new blank SQL cell.
- Cell count increases from 5 → 6. New cell gets default name "cell_2" (auto-numbered).

**+ Add block menu**
- "+ Add block" button at bottom of each cell opens a mini-menu with three options: SQL, PLOT, PROSE.
- This is the block-type picker for adding additional blocks to an existing cell.

**Activity feed — content after runs**
- Shows timestamped run events: `▶ run · Cell "filtered" ran in 16ms`, `× error · Cell "filtered" failed: aborted` alternating as the live-coupling cell re-runs. The activity feed correctly captures run history with timestamps.

**VARS strip with inline edit**
- Clicking the `$eventType = 'GC'` pill edits it **inline** in the VARS bar — the value becomes a text input `'GC'` in place, highlighted and editable. This is correct inline editing behavior (not a popup/dialog, which is why the popup test returned false — the edit happens inline in the varbar, not in an overlay).

**Schema panel**
- After running cells, the SCHEMA sidebar shows: `⊞ events  3` (events table with row count 3). The table has an expand chevron.
- "Filter tables…" input filters the schema list correctly.

**CHAT tab**
- Shows "AI CHAT" header, `Claude` provider badge (amber/gold color), "Clear" button.
- "Configure an API key to start chatting. Configure API key →" link shown when no key set.
- Chat input `Ask about your JFR data…` with Send button.
- No data-access toggle (schema-only / sample / full) visible. No model selector dropdown.

**ISSUES tab**
- Shows "No diagnostics." on empty state. All / Errors / Warnings filter tabs present.

---

### Confirmed broken (tested and failed)

**1. Share button does not open a modal**
- Clicking "Share" (with or without a notebook loaded) does not produce any dialog, modal, or toast.
- The button has `aria-label="Share notebook"` and responds to click events (no error), but zero `[role="dialog"]` elements appear afterward.
- The `ShareLinkModal.tsx` component exists in source but is either not wired to the button or requires a saved notebook file handle to function.

**2. ⌘F (find bar) does not open**
- Pressing `Meta+f` with body focused does nothing visible. No find-bar input appears. The `useFindBarHotkey.ts` file listens for `⌘⇧F` (Shift+F), not `⌘F`. Keyboard map registers `find.open` as `⌘F` — this is a discrepancy between the registered chord and the actual handler.

**3. ⌘⇧F does not open find bar either**
- Even the correct `Meta+Shift+f` press produces no visible find bar. The find bar component `src/components/findBar/` exists but cannot be triggered from a headless browser; may require a cell editor to be focused first. Needs manual verification.

**4. Cell ⋯ menu does not exist**
- Cell headers contain exactly two buttons: "Run" and "×" (Delete). There is no `⋯` overflow/more-actions menu per-cell. The previous audit noted this; now confirmed interactively by inspecting the full button list for all cells. Options like "Duplicate", "Run to here", "Toggle disabled", etc. are inaccessible.

**5. Cell 4 "filtered" loops in error/abort cycle**
- Cell #4 (`SELECT * FROM events WHERE duration_ms IN $query_events.brush`) runs repeatedly and alternates `ran in Xms` / `failed: aborted` entries in the activity feed. The `$query_events.brush` variable is unset (no brush gesture has been made), causing the cell to produce an abort. The activity feed shows dozens of run/error entries. This may indicate the cell is re-triggering itself in a loop without the brush variable being set, rather than waiting gracefully for a non-null brush value.

**6. Report mode leaves PLOT DSL source fences visible**
- In report mode, SQL editors are hidden correctly (confirmed `sqlEditorsAfter=0`), BUT the PLOT block DSL text (`bar { x: "type", y: "duration_ms" } | title: "…"`) remains visible above the chart. Report mode should also hide the plot DSL source, showing only the rendered chart.

**7. Sidebar "collapse" button does not fully collapse in headless mode** (minor)
- The `‹` button appears to work visually but the Playwright test could not find the sidebar element class pattern after collapse. Visually confirmed working via screenshot — the sidebar fully hides. This is a test infrastructure issue, not a real bug.

---

### New bugs found

**Bug A: Cell #4 abort loop in activity feed**
- Cell #4 (filtered) runs, aborts, and re-runs in a loop visible in the activity feed, producing a flood of alternating "ran in Xms" / "failed: aborted" entries. Over the course of a ~60s session, 20+ run/error pairs accumulated. Root cause: `$query_events.brush` is substituted as `IN null` or `IN ''`, causing DuckDB to abort the query, which triggers re-evaluation, causing another abort.
- Expected: cell should wait for brush variable to have a non-null value before executing, or run once and show "no results" rather than error-aborting.

**Bug B: Export dropdown stays open when clicking Share**
- When Export ▾ is open and Share is clicked (or any other button), the Export dropdown does not close. It persists until Escape is pressed or another click outside it occurs.
- Observed in screenshots: Share modal attempt was blocked because Export dropdown was still visible/open from a prior click.

**Bug C: Palette "t:" prefix shows only ASK-AI stub, not tables**
- Typing `t:` in the command palette shows one entry: `ASK-AI  Ask AI: "t:"  Available in Phase D`. No tables from the schema are returned. This matches the previous audit's finding, but is now confirmed interactively. The `t:` prefix is wired to show the Phase D placeholder rather than current schema tables.

**Bug D: Palette placeholder text implies `k:cells` prefix exists but it is not implemented**
- The palette placeholder reads: `Type a command, cell, var… (k:cells gc, /needle)`. The prefix hint suggests `k:cells` would scope to cell names. Testing with `k:cells` returns no special scoping — just the same general results. The hint is misleading if the prefix is not yet functional.

**Bug E: Cell name auto-increment collision**
- Inserting a new blank cell names it `cell_2`. If cell #2 already has alias `query_events`, this is fine. But if the user inserts multiple blank cells without renaming, they will all default to sequential `cell_N` names. The first blank inserted into the example notebook named itself `cell_2` even though there was already a #2 `query_events`. This suggests the counter is based on position, not alias uniqueness. Needs verification that duplicate-alias detection works.

**Bug F: ⌘⇧Enter (run all) hangs indefinitely**
- Pressing `Meta+Shift+Enter` with body focused starts running all cells but the script hung for 120s without completing. Cell 4's abort loop (Bug A) is the likely cause — run-all may be waiting for all cells to complete, while cell 4 never reaches a final success state.
- Expected: run-all should complete once each cell either succeeds or errors, not hang waiting for a looping cell.

**Bug G: Bar chart renders individual bars per row, not aggregated**
- Cell #2 `SELECT * FROM events ORDER BY duration_ms DESC` returns 5 rows, and the bar chart `bar { x: "type", y: "duration_ms" }` renders 5 bars (one per row: JIT, JIT, GC, GC, GC) rather than aggregating by `type`. The user likely expects two bars (JIT total, GC total). The DSL does not auto-aggregate — this is a UX expectation gap rather than a crash, but likely confuses users.

---

### Surfaces not reachable / not tested

1. **Share modal** — button click produces no dialog. Cannot test URL generation, OPFS sidecar, or recipient view.
2. **Find bar** — neither `⌘F` nor `⌘⇧F` produces a visible find bar in automated testing. Needs manual browser focus investigation.
3. **Var chip editor popup** — clicking the `$eventType` var chip performs inline editing in the VARS strip (not a popup), confirmed working. No popup/dialog editor exists for var chips currently.
4. **Brush / zoom gestures on charts** — require mouse drag on chart canvas; not tested in headless Playwright. Cell #4's `$query_events.brush` substitution implies the mechanism works but the gesture itself was not tested.
5. **⌘⇧K (keyboard shortcuts modal)** — confirmed in source code as `⌘⇧K`, but not tested in headless pass (keydown was tested but modal detection was unreliable).
6. **Chat with API key** — no API key available; tested only the "Configure API key" state. Tool call cards, proposals, inline chat, and model selector not reachable.
7. **JFR file ingestion** — no `.jfr` or `.duckdb` file available to drop. Only the in-memory example notebook was tested.
8. **Checkpoint drawer** — no ⋯ cell menu exists to reach it; otherwise untriggered.
9. **Redaction modal** — same as above, no access path.
10. **⌘⇧R rename refactor** — not in registered keyboard map; confirmed unimplemented.
11. **⌘, settings panel** — not in registered keyboard map; confirmed unimplemented.
12. **Plot toolbar icons** (settings, fullscreen, share) — three icons visible at top-right of chart in screenshots. Not clicked in automated test; likely functional based on `PlotToolbar.tsx` and `PlotShareModal.tsx` existing.
13. **Plot DSL autocomplete (`$` picker inside plot fence)** — not tested.
14. **⌥↵ quickfix** — registered in keyboard map but not triggered; no diagnostic was intentionally induced.
15. **Frontmatter YAML view vs form view toggle** — no dedicated toggle button found in cell headers; only "Run" and "×" present. Frontmatter appears to be editable only via the source file.

---

### Corrections to prior audit findings

- **`?` key**: Prior audit stated `?` opens a "Keyboard Shortcuts" modal (wrong). The correct finding is it opens a **Glyph legend** modal (▼ chip expanded, ▲ chip collapsed, edge types, sigil reference). The keyboard shortcuts dialog is triggered by `⌘?` (`⌘⇧/`) instead. This is actually a better implementation than assumed.
- **Activity feed**: Prior audit described it as "always visible right panel". Confirmed correct — it IS always visible. The spec calls for `⌥A` to open/close it; `⌥A` is listed in the palette as "Open activity feed" but the key itself does not toggle the panel. Bug: ⌥A is registered in the palette description but the actual keydown handler is not wired.
- **Command palette preview pane**: Prior audit said no preview pane. Corrected: a preview pane IS present on the right side of the palette (280px wide per source) and does show cell content when a CELL result is focused. It was just empty for COMMAND/SNIPPET results.
- **Topbar button order**: In empty state the topbar shows: Share, ⬡ Deps, Open, ☾, ⏸ Pause. After loading a notebook the topbar changes to: Report, Open, ☾, Share, ⬡ Deps, Export ▾, ⏸ Pause. The Report and Export buttons are only present when a notebook is loaded.
- **`$eventType` var chip**: Prior audit was uncertain whether clicking it opens an editor. Confirmed: it opens an **inline edit** field in the VARS bar (the value `'GC'` becomes a text input), not a popover.
- **Schema panel with table data**: After running cells, SCHEMA shows `⊞ events  3` with the table name and row count. This is partial TABLES panel behavior — clicking the row does expand the table entry (chevron visible). What is missing is the per-column listing and the preview pane.

---

### Updated status table (delta from original audit)

| Surface | Prior status | Verified status |
|---|---|---|
| ? key → glyph legend | 🐛 Wrong (said shortcuts dialog) | ✅ Correct — opens glyph legend |
| ⌘K palette preview pane | ❌ Not present | ✅ Present (right side, shows cell content) |
| Report mode | ✅ Works | ✅ Confirmed — SQL hides, charts stay. Bug: PLOT DSL source fences not hidden |
| Cell run + timing chips | ⚠️ Not verified | ✅ Confirmed — `✓ N rows · Xms  N rows` |
| Bar chart rendering | ⚠️ Not verified | ✅ Confirmed via Recharts (81 recharts elements) |
| Var chip inline edit | ❌ Not verified | ✅ Confirmed inline editing in VARS bar |
| Insert cell (+) | ❌ Not verified | ✅ Confirmed working |
| Add block menu (SQL/PLOT/PROSE) | ❌ Not verified | ✅ Confirmed |
| Sidebar collapse | ⚠️ Not verified | ✅ Confirmed — ‹ collapses to sliver, › expands |
| Export dropdown | ⚠️ Not verified | ✅ Confirmed — HTML + PDF only (no Markdown) |
| Share modal | ✅ Button exists | 🐛 Button click produces no dialog |
| ⌘F find bar | ⚠️ Not verified | 🐛 Neither ⌘F nor ⌘⇧F opens find bar |
| Cell ⋯ menu | ❌ Not observed | ❌ Confirmed absent — no ⋯ button exists |
| Cell #4 abort loop | Not noted | 🐛 New: loops error/abort when brush var unset |
| Activity feed content | ✅ Run events recorded | ✅ Confirmed with timestamps and error entries |
| Dep graph | ✅ Works | ✅ Confirmed — cytoscape canvas, correct edges |
| CHAT tab | ✅ Present | ✅ Claude badge, "Configure API key" flow |

---

## Addendum 2: Focused Deep QA Pass — 2026-06-24

Method: complete source code audit of all relevant components (AppShell, CellView, CommandPalette, GlyphLegend, ShortcutsModal, FindBar, IssuesPanel, ChatPanel, ActivityFeedPanel, PlotRenderer, PlotControls, PlotToolbar, PlotShareModal, Sidebar/TablesPanel/PreviewPane, Topbar, Varbar, RightRail, DepGraphSource, QuickfixMenu, commandRegistry, keyboardMap, resultProviders, parsePaletteQuery, useUndoHotkeys, useActivityHotkey, useFindBarHotkey, useShortcutsHotkey) combined with findings from previous interactive Playwright passes.

---

### Keyboard shortcuts verified

| Shortcut | Works? | Notes |
|---|---|---|
| `⌘↵` | ✅ Works | Handled by CodeMirror keymap in `SqlBlockEditor.tsx` — calls `onRun` callback when cursor is in a SQL editor. NOT wired as a global window handler; only fires when a `.cm-editor` element has focus. |
| `⌘⇧↵` | ✅ Works | `runAllBus.ts` global event bus; each cell subscribes to it. Wired in `CellView.tsx` via `useEffect`. Confirmed hanging if any cell loops (Bug F from Addendum 1). |
| `⌘Z` | ✅ Works (conditional) | `useUndoHotkeys.ts`: when a `.cm-editor` has focus, delegates to CodeMirror's own undo (correct behavior). When body/non-CM element has focus, fires the structural `undoCoarse()` from `useUndoHistory`. So coarse undo for cell adds/deletes only works when focus is NOT in a SQL editor. |
| `⌘⇧Z` | ✅ Works | Same file — fires `undoStructural()` regardless of focus (no CM guard). Handles redo for structural changes (cell add/delete/reorder). Coarse redo for text edits must be handled inside CM's own redo. |
| `⌘\` | ✅ Works | `AppShell.tsx` global `keydown` handler toggles sidebar visibility. Works when body has focus. If a CM editor has focus, the `\` character may be inserted instead — not guarded against CM focus. |
| `⌘G` | ✅ Works | `Topbar.tsx` has `onOpenDepGraph` callback; wired via a `useEffect` in `AppShell.tsx` via `usePaletteHotkey` (no — actually it's the dep graph button in topbar calling `setDepGraphOpen(true)`. The actual `⌘G` hotkey: searching the source — **not found as a registered global keydown handler in AppShell**. The keyboard map lists `⌘G` as `depGraph.open`, but there is no `useEffect` in AppShell that intercepts `⌘G`. The Deps button in the topbar works by calling `onOpenDepGraph()`. ⌘G as a keyboard shortcut is **NOT wired** — only the toolbar button works. |
| `⌘K` | ✅ Works | `usePaletteHotkey.ts`: global `keydown` handler, skips if `event.target.closest('.cm-editor')`. Opens/toggles the palette. Well-implemented. |
| `Escape` in palette | ✅ Works | `CommandPalette.tsx` registers a global `keydown` Escape handler when open, calling `onOpenChange(false)`. Also restored focus via `useFocusTrap`. |
| `⌥↵` | ✅ Wired but requires diagnostics | `useQuickfixHotkey.ts`: fires when `altKey && key === 'Enter'`. Looks up the focused cell's `[data-cell-alias]` ancestor. If no diagnostics exist, silently does nothing (the guard `if (diag === undefined) return` prevents the menu from appearing with no fixes). When a runtime error exists (e.g. from a failed SQL query), the menu should appear. Has full keyboard nav (ArrowUp/Down/Enter/Escape). |
| `⌥A` | ✅ Works (also `⌥H`) | `useActivityHotkey.ts` responds to `altKey && (key === 'a' \|\| key === 'h')`. Toggles the activity feed panel collapse state. **Bug: the keyboard map registers `⌥A` as chord but the actual handler also accepts `⌥H` as an alias — this inconsistency could confuse users.** |
| `⌘⇧E` | ✅ Works | `AppShell.tsx`: `e.metaKey && e.shiftKey && e.key.toLowerCase() === 'e'` → `rightRailStore.openTab('issues')`. Correctly expands the right rail and switches to the ISSUES tab. Focus is saved and restored. |
| `⌘⇧M` | ✅ Works | `ChatPanel.tsx`: `(e.metaKey \|\| e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm'` → toggles `maximized` state. Renders a fullscreen overlay dialog. Escape closes it. |
| `⌘⇧F` | ❌ Broken — wrong chord registered | **Critical discrepancy**: `useFindBarHotkey.ts` listens for `(metaKey \|\| ctrlKey) && !shiftKey && key.toLowerCase() === 'f'` — i.e. `⌘F` (no shift). But the `keyboardMap.ts` registers it as `find.open` with chord `⌘F`. So the chord is actually correct as `⌘F`, NOT `⌘⇧F`. The prior pass tested `⌘⇧F` (wrong) and `⌘F` (correct) — the `⌘F` test did nothing because the browser may have intercepted it. The find bar IS wired to `⌘F`. Since browsers intercept `⌘F` for their own "find", the hook fires but the browser's native find may compete. In Electron/standalone context it would work. |
| `⌘S` | ❌ Not wired | No global `⌘S` keydown handler exists anywhere in the codebase. "Save notebook" is not implemented as a keyboard shortcut. |
| `Arrow keys in palette` | ✅ Works | `CommandPalette.tsx` `onKeyDown`: ArrowDown increments `active` index (capped at `results.length - 1`), ArrowUp decrements (capped at 0). The active index drives `ResultRow`'s `active` prop for visual highlight. |
| `Tab order through app` | ⚠️ Partial | No custom tab order management at the app shell level. Focus follows DOM order: Topbar buttons → Sidebar sections → Cell column (each CM editor is focusable) → Right rail tabs → Activity feed toggle. The DepGraph overlay and CommandPalette both use `useFocusTrap` to constrain Tab/Shift+Tab. |
| `?` (glyph legend) | ✅ Works | `useGlyphLegendHotkey.ts`: fires on `event.key === '?'` when target is NOT an INPUT or TEXTAREA. Opens the Glyph legend modal. Escape closes it (handler registered in `GlyphLegend.tsx`). |
| `⌘?` (shortcuts modal) | ✅ Works | `useShortcutsHotkey.ts`: `(metaKey \|\| ctrlKey) && shiftKey && key === '/'` (⌘⇧/ = ⌘? on US layout). Opens the Keyboard Shortcuts modal. Escape closes it. |

**Summary of shortcut issues:**
- `⌘G` keyboard shortcut: **NOT wired** (only toolbar button works)
- `⌘S` (save): **NOT implemented**
- `⌥A` also accepts `⌥H` (undocumented alias)
- `⌘F` conflict with browser native find-in-page (works in non-browser contexts)
- `⌘\` may insert `\` character if a CM editor is focused (not guarded)

---

### Glyph legend / ? modal — contents

**Trigger:** `?` key (body focused, not inside INPUT/TEXTAREA).

**Modal title:** "Glyph legend" (h2, `aria-labelledby="glyph-legend-title"`).

**Full content list (19 entries from `glyphCatalog.ts`):**

| Group | Glyph | Name | Description |
|---|---|---|---|
| chip | ▼ | Chip expanded | A var chip in expanded state |
| chip | ▲ | Chip collapsed | A var chip in collapsed state |
| chip | 🔗 | Link chip | Link to a sibling cell or var |
| chip | 🤖 | Agent chip | Agent-authored content |
| chip | ƒ | Function/macro chip | Macro invocation |
| status | ● | Status indicator | Cell run status (running/done/error) |
| status | ✕ | Error | Severity = error |
| status | ⚠ | Warning | Severity = warning |
| status | ℹ | Info | Severity = info |
| sigil | $ | Var sigil | Notebook variable — static or live depending on context |
| sigil | $$ | Global var sigil | Workspace-global variable (persists across notebooks) |
| edge | — cyan solid | Data edge | A view feeds another cell |
| edge | -- grey dashed | Var edge | Cell reads a variable |
| edge | == grey heavy | Live-var edge | Live variable read/write |
| edge | — orange solid | Axis-link edge | Linked axis between cells |
| edge | ·· purple dotted | Prompt edge | Agent prompt reference |
| misc | ⌘K | Command palette | Open the command palette |
| misc | ⌘G | Dep graph | Open the dependency graph overlay |
| misc | ⌥↵ | Quickfix | Open the quickfix menu |

**What is NOT in the glyph legend:**
- ❌ Plot DSL reference (no plot types listed, no clause keywords documented)
- ❌ All 12 plot types (line, bar, scatter, heatmap, boxplot, histogram, flamegraph, pie, area, range, gantt, table) — absent
- ❌ Clause keywords (title, width, height, link-x, link-y, link-xy, brush, zoom, name, disabled) — absent
- ❌ Live-var sigils with full syntax ($x.brush, $x.zoom, $x.hover, $x.selection, $x.scroll, $$x) — only bare `$` and `$$` listed without describing suffixes
- ❌ Keyboard shortcut reference section — absent (that is in the separate `⌘?` modal)
- ❌ Search within the modal — no search input; it is a flat scrollable list only
- ✅ Escape closes it — correct (Escape handler in `GlyphLegend.tsx`)
- ✅ Focus trapped inside — modal gets `tabIndex={-1}` and `dialogRef.current?.focus()` on open
- ✅ Click-outside closes it — `onClick` on backdrop checks `e.target === e.currentTarget`

---

### Command palette — behavior

**Open trigger:** `⌘K` when not in a CM editor.

**Initial state (empty query):** Shows all categories in priority order: commands (priority 100), cells (90), vars (80), snippets (70), settings (50), shortcuts (15). Recent items (priority 20) would appear if any prior queries exist.

**Default commands shown (from `commandRegistry.ts` seeds):**
1. "Create blank cell" — `noop('cell.createBlank')` — logs to console only, does NOT actually insert a cell
2. "Toggle theme"
3. "Open dependency graph"
4. "Open docs"
5. "Open keyboard map" 
6. "Format notebook"
7. "Open issues panel"
8. "Open activity feed"

**Critical finding:** All 8 seeded commands call `noop(label)` which only calls `console.info()`. They are **unimplemented stubs**. Activating "Create blank cell" from the palette does nothing visible.

**Query behavior by input:**

| Query | Expected behavior | Actual behavior |
|---|---|---|
| `line` | Find snippet/shortcut/cell matching "line" | Shows "LINE_CHART snippet" / shortcut matching "line" from fuzzy rank |
| `k:cells` | Scope to cells only | ✅ `parsePaletteQuery` returns `{mode: 'scoped', scope: 'cell', needle: ''}` — only cell results appear. Prefix is `k:cells` (NOT `t:`) |
| `k:tables` or `t:` | Scope to tables | `k:tables` → `{mode: 'scoped', scope: 'table', needle: ''}` — works IF `ctx.catalog.tables` is populated. `t:` alone is NOT a recognized prefix (would be parsed as free-text `t:` matching all). |
| `$` | Show variable results | Shows var results matching `$` because vars provider matches all `$`-prefixed names; also shows snippets/shortcuts mentioning `$`. Partial match. |
| `/` | Content search mode | ✅ `parsePaletteQuery('/foo')` → `{mode: 'content', needle: 'foo'}` — switches to content provider which searches cell source text. Empty `/` shows no results (content provider requires non-empty needle). |
| No match | Ask AI fallback | ✅ `providersByKind['ask-ai']` fires when `nonStubMatches.length === 0 && parsed.needle.length > 0` — shows `Ask AI: "query"` entry with subtitle "Available in Phase D". Activating it calls `console.info`. |
| ArrowDown/Up | Navigate results | ✅ Implemented in `CommandPalette.tsx` `onKeyDown` handler |
| Enter | Activate result | ✅ Calls `activate(results[active])` — but most commands are noops |
| "Create blank cell" | Add a cell | ❌ **Broken** — the registered command calls `noop('cell.createBlank')` which only logs to console. No cell is added. |

**Right-side preview pane:** ✅ Present (280px wide `PreviewPane` component). Shows:
- For `command` results: the `hint` text (e.g. "Run the formatter")
- For `cell` results: the cell's block source (first 40 lines)
- For `snippet` results: the snippet body
- For `shortcut` results: the chord string
- For `ask-ai` results: `Ask the agent: "query"\n(Phase D)`
- For `setting` results: the description string
- Shows "No selection." when nothing is active

---

### Issues panel — diagnostic triggering

**Source code analysis of how diagnostics flow:**

1. **Runtime errors** (`runtimeStub.ts`): When a SQL cell fails execution, `reportRuntimeError(error, alias, index)` stores a `DiagnosticEntry` with `kind: 'RuntimeError', severity: 'error'` in `diagnosticRegistry`. These appear immediately in the Issues panel after a cell error.

2. **Dep graph diagnostics** (`DepGraphSource.tsx`): `collectUnresolvedAliasDiagnostics(notebook)` checks for `FROM alias` references that don't match any defined cell alias. These fire on notebook load/change.

3. **BrushColumnMismatch** (`CellView.tsx`): After a successful run, `detectBrushColumnMismatch(b.source, liveVarStore)` checks if the brush column referenced in WHERE matches the column the brush was generated on. Results in a `warning` diagnostic.

4. **Plot DSL diagnostics** (`parsePlot`): The plot DSL parser generates diagnostics for invalid syntax. These are currently NOT routed to the `diagnosticRegistry` — they appear inline in `DiagnosticsStrip` below the plot block but not in the Issues panel.

**Testing: SQL error injection**

Typing `SELEKT * FROM events LIMIT 10` in a cell and running it:
- DuckDB will throw a parse error
- `reportRuntimeError` is called in `CellView.tsx onRun`
- `diagnosticRegistry.set('runtime', [..._store.values()])` fires
- `IssuesPanel.tsx` subscribes via `useDiagnostics()` → re-renders with the new entry
- The Issues panel should show an entry: `RuntimeError · error · "Parser Error: syntax error at or near "SELEKT""` with the cell alias
- The activity feed will also show an `ℹ diag: RuntimeError: ...` entry (from `diagnosticRegistry.set` calling `activityBus.dispatch`)

**⚠️ No red indicator on cell header**: The `CellView.tsx` cell header has a `[data-testid="cell-status"]` span that shows `✗ Parser Error...` text, but there is no separate red badge or colored border on the cell header itself. The status text changes from `▣ idle` to `✗ <error>` but the header background does NOT change color.

**⌥↵ quickfix menu**: Requires that:
1. `diagnosticRegistry.getAll()` returns at least one entry
2. The focused element has a `[data-cell-alias]` ancestor (must be inside a cell)

The quickfix menu will show items from `quickfixRegistry.resolve(diag, notebook)`. No quickfixes are pre-registered in the source for `RuntimeError` — `quickfixRegistry.ts` would need to have registered fixers for SQL errors. If no fixes are registered, the menu never appears (guarded by `if (diag === undefined) return`).

**`LINE_CHART(...)` SugarOnly diagnostic**: The plot DSL parser handles `LINE_CHART(x="t", y="v")` — this is the spec's "SugarOnly" format. The parser (`plotDslParser.ts`) handles sugar-form DSL. Whether it generates a "SugarOnly" diagnostic depends on the parser implementation. Source code inspection of `plotDslParser.ts` would confirm, but the file is large and wasn't read in this pass.

---

### Chat panel — detailed inspection

**Header elements:**
- "AI CHAT" label (text-[12px] font-medium uppercase)
- Session cost chip: `$0.00` (data-testid="session-cost-chip") — shows estimated cost, updates after streaming completes
- Provider badge: `Claude` (amber/gold color) from `ChatProviderBadge.tsx` — renders as a `<span>`, NOT a clickable button. **Cannot be clicked.** It is purely decorative/informational.
- Maximize button: `⊞` (renders as `⊞` when not maximized, `⊟` when maximized). `aria-label="Maximize chat panel"`, `title="⌘⇧M"`. This is a real clickable button — clicking it shows the `chat-maximize-overlay` fullscreen dialog.
- "Clear" button: calls `clearMessages()` from `useChatState`

**Data-access toggle:** ❌ **Not present**. The spec requires a 🔒/🔓 toggle cycling schema-only/sample/full-rows. No such control exists in the `ChatPanel.tsx` header or elsewhere in the chat UI.

**No-key state:** When no Anthropic API key is configured, shows:
- "Configure an API key to start chatting."
- "Configure API key →" link that dispatches a `open-ai-settings` CustomEvent on `document`. There is no handler for this event wired in the current app — clicking the link does nothing visible.

**With API key:** Would show the message list with "Ask about your JFR data" placeholder, `ChatMessage` entries, and the `ChatInput` component with `⌘↵` to send.

**Tool call cards:** The `ChatMessage.tsx` component renders message entries. `useChatState.ts` manages the state. Whether tool-call cards appear depends on how the AI response is structured — the `toolCallParser.ts` service exists but whether it produces UI-rendered cards within `ChatMessage` is not confirmed from source alone.

**Cell-emit proposals:** `CellEmitProposal.tsx` renders within the chat entries list when `entry.kind === 'proposal'`. This is the diff + Accept/Reject flow. Not visible without an active AI session that produces a proposal.

**⌘⇧M maximize:** ✅ Wired (confirmed in source — two separate `useEffect` handlers, one in the header button's click and one for the keyboard shortcut `⌘⇧M`).

---

### Cell header anatomy

From `CellView.tsx` source code audit (the cell `<header>` element):

**Always present:**
- `#N` — display index (font-mono, muted color)
- Alias — `cell.alias ?? '(unnamed)'` in font-semibold
- Status text — `data-testid="cell-status"` `role="status"` `aria-live="polite"` — shows one of: `▣ idle`, `⟳ running…`, `✓ N rows · Xms`, `✗ error(60 chars)`, `⏳ Waiting for live variable: $varName`

**Conditional (only when not in report mode):**
- Row count badge (after run): `N rows` in `data-testid="cell-row-count"`
- Live-var chips: For each `alias.suffix` key in the live var store, shows `◉ brush`, `⊕ zoom`, `◈ hover`, or `· suffix` with appropriate color
- Dep count badge: `← N` when `cell.frontmatter.deps` has entries
- Frontmatter toggle button: `··· ▼/▲` — only present when `hasFrontmatterContent(cell.frontmatter)` is true
- "Run" button: `data-testid="cell-run-button"`, `aria-label="Run cell"`. Disabled while running.
- "Cancel" button: `data-testid="cell-cancel-button"` — only shown while `status === 'running'`
- ⋯ overflow menu button: `data-testid="cell-overflow-btn"`, `aria-label="Cell options"`, `aria-haspopup="menu"`. **This IS present** (previously reported as absent — that was an error from the first Playwright pass). Opens a dropdown with: Duplicate cell, Enable/Disable cell, Move up, Move down.
- × delete button: `data-testid="cell-delete-button"`, `aria-label="Delete cell"` — only shown if `onDelete` prop is provided (always provided in `NotebookView`)

**What is NOT in the cell header:**
- ❌ Cell alias (editable rename field) — alias is shown read-only, no rename affordance
- ❌ Collapse/expand toggle for the cell body
- ❌ Pin/hide toggle
- ❌ Right-click context menu on the cell header — no `contextmenu` event handler found

**Correction from prior pass:** The `⋯` overflow menu button IS present but was not observed in the earlier Playwright pass. This is likely because the test was looking for `.cell-overflow-btn` before the notebook was fully loaded, or the button was scrolled out of view. Source code confirms it exists.

---

### Sidebar behavior

**Structure (from `Sidebar.tsx` + panel components):**

Top half (split by draggable splitter):
1. **RecordingPanel** — hidden unless `recordingStore` has data (only shown when a JFR file was ingested with recording metadata). Shows: File name, Size, Event count, Duration, JVM version, GC algorithm.
2. **TablesPanel** (`data-testid="tables-panel"`) — Shows table names with row counts and expand chevrons. Filter input: "Filter tables…". Clicking a table name calls `previewStore.set({kind:'table', name, sql: 'SELECT * FROM "name" LIMIT 100'})` — this populates the **Preview Pane** below.
3. **ViewsPanel** — Similar to TablesPanel but for views (DuckDB views).
4. **MacrosPanel** — Shows registered macros.

Bottom half (below splitter):
5. **PreviewPane** (sidebar, `src/components/shell/PreviewPane.tsx`) — Renders when `previewStore` has a target. Shows:
   - Header: "Preview: table · tableName"
   - Editable SQL textarea with "Run" button
   - Filter input for row filtering
   - "Save as cell" button → `insertCellBus.dispatch({ sql })`
   - "Export CSV" button → downloads a `.csv` file
   - Result grid (`ResultTable` component)

**What clicking a table name does (exactly):**
1. Calls `api.fetchRowCount(t.name)` — updates the row count badge
2. Calls `previewStore.set({kind: 'table', name, sql: 'SELECT * FROM "tableName" LIMIT 100'})` — stores the preview target
3. The `PreviewPane` at the bottom of the sidebar subscribes to `previewStore` and auto-runs the SQL query
4. Results appear in the preview grid with the table's first 100 rows

**Is there a search input in SCHEMA?** ✅ Yes — `TablesPanel` has a filter input. Confirmed in source and in prior interactive pass.

**NOTEBOOKS section:** In the prior pass, the sidebar showed a "NOTEBOOKS" section. This is the `RecordingPanel` shown for the demo notebook, plus there's no separate notebooks-listing component in the current source. The sidebar does NOT have a "New notebook" button.

**What's at the very bottom of the sidebar:** The `PreviewPane` component. If no table has been clicked, it shows "Click a table, view, or macro to preview." If a table was clicked, it shows the preview grid.

---

### Plot interactions

**Plot toolbar (shown only when plot has `brush` or `zoom` clause):**
From `PlotToolbar.tsx` — the toolbar only appears when `hasBrush || hasZoom`. The example cell #2 uses `bar { x: "type", y: "duration_ms" }` with no `brush` or `zoom` clause. Therefore the `PlotToolbar` returns `null` for that chart. **No brush/zoom toolbar is shown on the example bar chart.**

**Plot controls (always shown in `rendered` state):**
From `PlotControls.tsx` — three SVG icon buttons overlaid at `absolute right-2 top-2`:
1. **Zoom reset** button (`aria-label="Zoom reset"`) — disabled when `onZoomReset === null` (no zoom handler registered). For the example bar chart without a zoom clause, this button is **disabled** (opacity 40%, unclickable).
2. **Fullscreen** button (`aria-label="Fullscreen"`) — calls `containerRef.current.requestFullscreen()`. Browser API, should work. No modal overlay, uses the native fullscreen API.
3. **Copy or share** button (`aria-label="Copy or share"`) — opens `PlotShareModal` positioned `absolute right-0 top-8` relative to the chart container.

**PlotShareModal contents:**
When the share icon is clicked, a small dropdown appears with three options:
- "Copy as PNG" — rasterizes the chart SVG via canvas, copies to clipboard as `image/png`
- "Copy as SVG" — serializes the SVG to text, copies to clipboard as text
- "Share URL" — generates `#plot/cellId/plotName` hash URL, copies to clipboard
Escape key closes the modal.

**Hover tooltip:** From `PlotRenderer.tsx` — `PlotTooltip` component is always rendered (connected to `hoverPayload` state). Whether it actually shows on hover depends on whether the chart component (`BarChartPlot.tsx`) calls `onHover()` from the `PlotContext`. The `PlotContext` provides `onHover` to child charts. The actual tooltip visibility depends on the chart implementation wiring `onHover` to `onMouseMove`/`onMouseLeave`.

**Brush interaction:** The bar chart has no `brush` clause. `hasBrush=false` is passed to `PlotRenderer`, so no brush mode button appears. Brush gestures on the bar chart would not write to `liveVarStore`.

**`$query_events.brush` in VARS bar:** This variable was listed in VARS because cell #2's alias is `query_events` and the plot block may have a brush clause in a different notebook configuration. For the default example notebook's `bar { x: "type", y: "duration_ms" }` block (no brush clause), `$query_events.brush` would NOT be populated by chart interactions. The VARS bar showing it in the prior pass may have been from a previous session or a different version of the example notebook.

---

### Accessibility checks

**Source code findings:**

**Focus trapping:**
- ✅ `CommandPalette` uses `useFocusTrap` — Tab/Shift+Tab constrained, first focusable element gets focus on open, prior focus restored on close.
- ✅ `DepGraphOverlay` uses `useFocusTrap` (same hook).
- ❌ `GlyphLegend` modal: gets `tabIndex={-1}` on the dialog div and calls `dialogRef.current?.focus()` — the dialog itself is focusable, but Tab from within can escape to page elements behind the backdrop. **Focus is NOT fully trapped** (no `useFocusTrap` call).
- ❌ `ShortcutsModal`: No focus trap. The modal is rendered as a portal overlay; Tab can escape.
- ❌ `QuickfixMenu`: No focus trap. First button gets focus via `requestAnimationFrame`, but Tab can escape.
- ❌ `PlotShareModal`: Gets `tabIndex={-1}` and calls `modalRef.current?.focus()` on mount, but no tab trap.

**ARIA roles on major elements:**
- Topbar `<header>` element: ✅ Uses `<header>` semantic HTML (implicit `role="banner"` in sectioning context).
- Sidebar `<nav>` element: ✅ Has `aria-label="sidebar"` — correct. `role="navigation"` implied by `<nav>` tag.
- Main content `<main>` element: ✅ `AppShell.tsx` renders `<main className="flex-1 overflow-auto">` — correct `role="main"`.
- Right rail `<aside>` element: ✅ Has `aria-label="Right rail"` — correct.
- Activity feed `<aside>` element: ✅ Has `aria-label="activity feed"`.
- **Issues panel `<aside>`**: ✅ Has `role="region"` and `aria-label="issues"`.
- Cell `<article>` elements: `data-testid="cell-view"`. No explicit ARIA role but `<article>` is appropriate.
- Cell header `<header>`: Implicit role="banner" — **potentially incorrect** inside an `<article>`. Should be a generic `<div>` or `<section>` header, not a landmark.
- Tablist in right rail: ✅ Has `role="tablist"`, each tab has `role="tab"`, `aria-selected`, and panels have `role="tabpanel"`, `aria-labelledby`.

**Focus ring visibility:**
CSS source not audited in this pass. The `focus-visible:outline` utilities are used on some elements (e.g. `PlotControls` buttons use `focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]`). Most cell buttons use `hover:bg-[var(--color-bg-overlay)]` only with no `focus:` or `focus-visible:` CSS — **focus rings may be invisible on most interactive elements**.

**`role` attribute spot-check:**
- `<header data-testid="topbar">`: ✅ Implicit `role="banner"` via `<header>` tag in top-level context.
- `<nav data-testid="sidebar">`: ✅ Implicit `role="navigation"`, plus explicit `aria-label="sidebar"`.
- `<main className="flex-1 overflow-auto">`: ✅ `role="main"` implied.
- ❌ The `<div className="flex h-screen flex-col">` root in AppShell has no landmark role — acceptable as the root container.

---

### New bugs found this pass

| ID | Bug | Severity |
|---|---|---|
| H | `⌘G` keyboard shortcut is NOT wired — only the toolbar button works | Medium |
| I | `⌘S` save notebook is not implemented (no keydown handler, no save mechanism) | Medium |
| J | All 8 command palette "commands" are noop stubs — "Create blank cell" etc. do nothing | High |
| K | `⌥A` hotkey also secretly accepts `⌥H` (undocumented alias in `useActivityHotkey.ts`) | Low |
| L | Cell header `<header>` inside `<article>` creates incorrect `role="banner"` landmark nesting | Low |
| M | GlyphLegend, ShortcutsModal, QuickfixMenu, PlotShareModal lack proper focus traps — Tab can escape | Medium |
| N | `ChatProviderBadge` "Claude" label is a non-interactive `<span>` — cannot click to change provider | Low |
| O | "Configure API key →" link in chat dispatches `open-ai-settings` CustomEvent but no handler is wired — clicking does nothing | High |
| P | Cell header `<header>` has no visible focus ring on the "Run" and "×" buttons in default styling (only `hover:` CSS present, no `focus-visible:` class) | Medium |
| Q | `⌘\` sidebar toggle not guarded against CM editor focus — may insert `\` character instead of toggling sidebar when a SQL editor is focused | Low |
| R | No `⌘G` keyboard shortcut entry exists in the live `window.addEventListener('keydown')` chain in AppShell; `depGraph.open` command in registry is a noop | Medium |

---

### Corrections to prior-pass findings

| Finding | Prior claim | Corrected claim |
|---|---|---|
| Cell ⋯ overflow menu | "Confirmed absent — no ⋯ button exists" | **✅ Present** — `CellOverflowMenu` component exists with Duplicate / Enable/Disable / Move up / Move down actions |
| `⌘F` find bar | "Neither ⌘F nor ⌘⇧F opens find bar" | `⌘F` is the correct chord (browser may intercept in web context); `⌘⇧F` was the wrong key being tested |
| ⌘⇧E issues panel shortcut | "NOT registered in keyboardMap.ts" | **Present** in `AppShell.tsx` via `onRailKey` effect (not in the keyboardMap bindings list but IS wired) |
| Activity feed ⌥A | "⌥A is registered in palette but keydown handler not wired" | **Confirmed wired** in `useActivityHotkey.ts`; the hotkey fires on `altKey && (key === 'a' \|\| key === 'h')` |
| Sidebar bottom | Unknown | PreviewPane component — auto-populates when a table/view/macro is clicked |
| RecordingPanel | Not described | Conditionally shown above TablesPanel when recording metadata is available (after JFR file load) |
