# Frontend Test Inventory & Workflows

A walkable checklist for systematic regression testing. Two parts:

1. **Feature inventory** — grouped by area, each row is a discrete capability
2. **User workflows** — multi-step journeys that chain features together

Use `- [ ]` checkboxes to track a pass.

---

## Part 1 — Feature Inventory

### 1. Data Ingestion

- [ ] **File drop (WASM)** — drag `.jfr`/`.duckdb` into the dropzone → import via DuckDB-WASM. `components/JFRDropZone.tsx`, `utils/jfrToWasmLoader.ts`
- [ ] **Server mode** — backend probe on startup; "Server" badge appears when reachable. `context/DuckDBContext.tsx:79`
- [ ] **Demo button** — "New JFR Demo" loads sample JFR + GC analysis template. `App.tsx:790`
- [ ] **Template quick-start** — "New from template" button opens gallery. `components/TemplateGalleryModal.tsx`
- [ ] **URL auto-load** — `?jfr=<url>`, `?notebook=<url>`, `?notebook=base64,<...>`, `?run=true`. `App.tsx:269`
- [ ] **Recording bounds** — `$session_start` / `$session_end` seeded from JFR metadata. `App.tsx:767`, `components/SessionDateChip.tsx`

### 2. Notebook

- [ ] **Cell structure** — markdown / SQL / plot blocks; `---` delimiters. `utils/notebookParser.ts`
- [ ] **Reorder cells** — drag-and-drop changes position. `App.tsx:667`
- [ ] **Add cell** — manual button + AI `addCell` tool. `App.tsx:543`
- [ ] **Delete cell** — removes cell + results. `App.tsx:608`
- [ ] **Cell variables** — `variables:` directive + notebook-level front-matter. `utils/variableSubstitution.ts`
- [ ] **Collapse all / Expand all** — header buttons. `App.tsx:892`
- [ ] **Presenter mode** — hides editors, shows output only. `App.tsx:908`
- [ ] **Markdown mode** — raw markdown editor split-pane. `App.tsx:900`, `components/Notebook.tsx:78`
- [ ] **Undo / redo** — Cmd-Z / Cmd-Shift-Z, 50-entry history. `App.tsx:149`, `hooks/useHistoryState.ts`
- [ ] **Save notebook** — Cmd-S downloads `.md`. `App.tsx:198`
- [ ] **Load notebook** — upload `.md` or drag-drop. `App.tsx:183`

### 3. SQL editor & execution

- [ ] **CodeMirror integration** — syntax highlight, line numbers, indent. `components/SQLEditor.tsx`
- [ ] **Schema-aware autocomplete** — table/column completions, embeddings ranking. `services/ml/EmbeddingService.ts`, `components/editor/completions.ts`
- [ ] **Query execution** — run single block or "Run All". `App.tsx:511`
- [ ] **Run preview from chat** — chat-side query before promote. `App.tsx:698`
- [ ] **Format SQL** — Cmd-K. `utils/sqlFormatter.ts`
- [ ] **Variable expansion** — `$var`, `$session_start`, cell-scoped vars. `App.tsx:512`
- [ ] **Brush operator** — `$min..[$max]` SQL syntax linked to plot brushes. `services/variableExpander.ts`
- [ ] **Auto-run on load** — `?run=true` + persisted toggle. `App.tsx:158, 325`
- [ ] **Views / macros** — front-matter `views:` / `macros:` registered into DuckDB with topo-sort. `App.tsx:431`

### 4. Plotting

- [ ] **DSL parser** — `BAR_CHART(x: "col", y: ["col2"]) TITLE "x"`. `utils/plotParser.ts`, `services/plot/plotLanguage.ts`
- [ ] **Plot types** — LINE / BAR / AREA / SCATTER / PIE / BOX / TABLE / HEATMAP / HISTOGRAM. `components/PlotRenderer.tsx`, `components/plots/`
- [ ] **Composite layouts** — ROW / COL / OVERLAY (nested OK). `utils/plotParser.ts:45`
- [ ] **Linked variables** — `LINK_X("$min", "$max")`. `components/PlotRenderer.tsx`
- [ ] **Brush interaction** — `BRUSH(name: "$var", mode: "x")`. `services/plotBrushStore.ts`
- [ ] **Plot suggestion** — ✨ button → AI proposes DSL. `App.tsx:683`
- [ ] **Format plot** — auto-format DSL. `utils/plotFormatter.ts`
- [ ] **DSL validation** — pre-render syntax + column-existence check. `utils/plotValidator.ts`
- [ ] **AI error recovery** — "Fix with AI" button when render fails. `components/PlotRenderer.tsx` (AiErrorFixer)
- [ ] **Cross-cell ON / DATASET** — plot pulls data from another cell's alias/view. `components/Notebook.tsx:55`

### 5. Sidebar (schema explorer)

- [ ] **Tables list** — name, row count, sort A-Z or by count. `components/Sidebar.tsx`
- [ ] **Views list** — toggle to hide internal `jfr_*` views.
- [ ] **Macros list** — name + parameter signature.
- [ ] **Column preview** — click table → columns panel. `components/SchemaTooltipContent.tsx`
- [ ] **Sample rows** — "Sample" button → inline DataTable.
- [ ] **Search filter** — filters table/view/macro names live.
- [ ] **Custom SQL preview** — ad-hoc editor in sidebar.
- [ ] **Resizable panels** — drag-dividers; state persisted.

### 6. Chat / AI (sidebar)

- [ ] **Provider switching** — Anthropic / OpenAI / Gemini / Browser / Local / Gardener. `services/ai/*`
- [ ] **Conversation pane** — streaming markdown, code blocks, tool calls. `components/ChatPanel.tsx`
- [ ] **Visibility modes** — `no-data` / `sanitized` / `full`. `services/ai/visibility.ts`
- [ ] **Chat modes** — chat / plan / btw (best-try-when). `services/ai/chatModes.ts`
- [ ] **Approval gating** — mutate tools surface a proposal card. `components/ChatProposalCard.tsx`
- [ ] **Tool: runQuery** — paginated read SQL, returned/truncated flags. `services/ai/tools/index.ts`
- [ ] **Tool: describeTable**
- [ ] **Tool: sampleRows**
- [ ] **Tool: listPlots**
- [ ] **Tool: previewPlot** — inline chart with "Add to Notebook" promote (combined SQL + plot cell)
- [ ] **Tool: screenshotPlot** — PNG capture, `full` visibility + image-capable provider only
- [ ] **Tool: addCell** / **editCell** / **applyPlot** / **deleteCell** / **moveCell**
- [ ] **Tool: listCells** / **readCell**
- [ ] **Tool: listVariables** / **setVariable** / **deleteVariable**
- [ ] **System prompt** — tools grouped (Explore/Preview/Inspect/Mutate), DSL quoting rules, visibility hints. `services/AiService.ts:485`
- [ ] **Persistence** — chat history per session in localStorage. `services/ai/chatPersistence.ts`
- [ ] **Plan / proposal cards** — multi-step plans with per-step approval. `components/chat/ChatPlanCard.tsx`

### 7. Inline chat (per-cell)

- [ ] **Chat icon on each cell** — opens inline pane. `components/InlineChat.tsx`
- [ ] **Cell context** — current cell type + columns + variables passed to AI. `components/inlineChatHelpers.ts`
- [ ] **Pop to sidebar** — moves conversation to main chat panel. `App.tsx:961`
- [ ] **Cancel button while loading** — inflight request abort.
- [ ] **Markdown rendering** — bold / links / fenced code highlighted. `components/chat/ChatMarkdownView.tsx`

### 8. Templates

- [ ] **Built-in templates** — `gc-analysis`, `exceptions`, `heap-allocation`, `threading`, comprehensive test. `data/templates/builtin/*.md`
- [ ] **Template merge** — append vs replace; conflict detection. `services/TemplateService.ts`, `utils/templateMerge.ts`
- [ ] **Template variables** — front-matter defaults applied on insert.

### 9. Settings

- [ ] **API keys** — Anthropic / OpenAI / Gemini / Local / Gardener.
- [ ] **Test credentials** — probe call; success/error toast.
- [ ] **Visibility default** — applies to new chat sessions.
- [ ] **Display settings** — time format, decimal places. `context/DisplaySettingsContext.tsx`
- [ ] **Theme** — dark default.
- [ ] **Collapse / auto-run state** — persisted to localStorage.

### 10. Notifications

- [ ] **Toast notifications** — auto-dismiss + manual close. `components/ToastNotification.tsx`
- [ ] **AI failure toast** — invalid creds, rate limited.
- [ ] **Server probe toast** — backend unavailable.
- [ ] **Query error inline** — shown in result block. `components/NotebookCell.tsx`

### 11. Help / modals

- [ ] **Plot help modal** — DSL clause docs. `components/PlotHelpModal.tsx`
- [ ] **Command palette** — Shift-Shift, fuzzy search. `components/CommandPalette.tsx`, `App.tsx:378`
- [ ] **Settings modal** — full form with validation. `components/SettingsModal.tsx`
- [ ] **Template gallery modal** — preview + insert. `components/TemplateGalleryModal.tsx`
- [ ] **Filter modal** — visual WHERE-builder. `components/FilterModal.tsx`
- [ ] **Compare view** — diff between notebook versions. `components/CompareView.tsx`

### 12. DataTable

- [ ] **Sortable columns** — BigInt-safe comparisons. `components/DataTable.tsx`
- [ ] **Fuzzy search** — across all columns.
- [ ] **Pagination** — 50/page; next/prev.
- [ ] **Type formatting** — timestamps, decimals, BigInt as string.
- [ ] **Click cell to copy** — clipboard + toast.

### 13. Persistence

- [ ] **Notebook autosave** — localStorage on every edit.
- [ ] **Chat history per session.**
- [ ] **Settings (incl. keys) in localStorage.**
- [ ] **UI state** — sidebar/chat collapsed, auto-run, presenter mode.

### 14. Tooltips

- [ ] **Schema tooltip** — hover sidebar entry → columns + types.
- [ ] **Plot tooltip** — hover datapoint → row data (visibility-respecting). `components/PlotTooltipContent.tsx`
- [ ] **Tool status tooltip** — pending/executed/failed for tool calls. `components/chat/chatStatusTooltip.ts`

### 15. Advanced

- [ ] **Anomaly detection ML** — `services/ml/AnomalyAnalyzer.ts`
- [ ] **Plot generation ML** — schema-aware suggestions. `services/ml/PlotGenerationService.ts`
- [ ] **Skills marketplace** — `context/SkillContext.tsx`, `data/skills/`
- [ ] **Flame graph** — `components/FlameGraph.tsx`
- [ ] **Varbar mini-charts** — `components/Varbar.tsx`
- [ ] **Notebook tabs** — multiple notebooks open. `components/NotebookTabs.tsx`
- [ ] **Plot composer** — visual plot builder. `components/PlotComposer.tsx`

---

## Part 2 — User Workflows

Each workflow has: Trigger / Steps / Success / Failure points. Use the checkbox to mark "tested and works".

### W1. Start from scratch with JFR file drop
- [ ] **Trigger:** App loads in WASM mode (no DB) → user drags `.jfr` onto dropzone.
- **Steps:** drag → import → schema populates sidebar → `$session_start`/`$session_end` seeded → empty notebook ready.
- **Success:** schema visible; can write+run a SELECT.
- **Failure:** invalid JFR; OOM; corrupted metadata.

### W2. Start with template gallery
- [ ] **Trigger:** "New from template" button.
- **Steps:** modal opens → filter by tag → preview → choose Replace vs Append → Insert.
- **Success:** cells appear; front-matter variables auto-seed.
- **Failure:** merge conflict; template references missing event types.

### W3. Ask AI → previewPlot → "Add to Notebook"
- [ ] **Trigger:** type question in chat sidebar.
- **Steps:** open chat → ask "show GC pauses over time" → AI calls `previewPlot` → chart renders inline → click "Add to Notebook" → combined SQL+plot cell appears.
- **Success:** plot renders in chat AND in notebook; one cell, both code blocks.
- **Failure:** AI hallucinates table; invalid DSL; visibility=`no-data` blocks previewPlot.

### W4. Per-cell inline chat: fix a broken plot
- [ ] **Trigger:** plot block errors; user clicks the cell's chat icon.
- **Steps:** describe issue → AI sees cell + error + variables → returns fixed DSL → user clicks Apply.
- **Success:** chart re-renders.
- **Failure:** AI suggests columns user can't see in current visibility mode.

### W5. Per-cell inline chat: extend SQL
- [ ] **Trigger:** chat icon on SQL cell with results.
- **Steps:** "also show GC phase" → AI extends with JOIN → Apply → cell auto-reruns.
- **Success:** new column in result table.
- **Failure:** AI invents columns; alias from another cell not visible.

### W6. Reorder + variable cross-cell reference
- [ ] **Trigger:** drag cell B above cell A that defined `$cpu_threshold`.
- **Steps:** drag → B errors ("undefined variable") → either reorder back or hoist variable to global front-matter.
- **Success:** both cells run; substitution works.
- **Failure:** topo-sort not re-applied; variable typo.

### W7. Composite plot with `ON @alias`
- [ ] **Trigger:** build cross-cell plot.
- **Steps:** cell A `SELECT ... -- alias cpu_data` → cell C `BAR_CHART(...) ON @cpu_data` → renders; brush updates `$time_range` → A re-executes.
- **Success:** plot uses data from another cell; brush links work.
- **Failure:** alias typo; cell A hasn't run yet.

### W8. Save & reload notebook `.md`
- [ ] **Trigger:** Cmd-S, then later drop the saved `.md`.
- **Steps:** save → file downloads → reopen app → drop file → cells reconstruct.
- **Success:** identical structure; can re-run.
- **Failure:** unicode escaping in labels; >10MB; bad front-matter YAML.

### W9. Share notebook via `?notebook=base64,...` URL
- [ ] **Trigger:** colleague opens shared URL.
- **Steps:** URL → notebook loads even before DB ready → colleague drops their JFR → queries run against their data.
- **Success:** queries succeed against new data.
- **Failure:** URL too long; encoding mangles unicode; recipient's JFR missing event types.

### W10. Configure AI provider + verify credentials
- [ ] **Trigger:** gear icon or "AI unavailable" toast.
- **Steps:** modal → pick provider → enter key → "Test" → save.
- **Success:** chat panel turns "ready".
- **Failure:** 401; rate-limit; wrong model for provider.

### W11. Switch chat visibility mode
- [ ] **Trigger:** dropdown in chat header.
- **Steps:** select `no-data` → ask for chart → `previewPlot` rejected → AI falls back to `addCell`. Then `full` → `screenshotPlot` succeeds. Then `sanitized` → `screenshotPlot` rejected.
- **Success:** tools gate correctly per mode.
- **Failure:** AI calls a forbidden tool anyway; orchestrator doesn't strip data outbound.

### W12. Bulk format + undo
- [ ] **Trigger:** Shift-Shift → "Format all cells".
- **Steps:** run command → all cells reformat → Cmd-Z restores prior state.
- **Success:** consistent indentation; undo intact.
- **Failure:** formatter breaks a string literal; undo overwritten.

### W13. Recovery: SQL error → AI fix
- [ ] **Trigger:** column-doesn't-exist error.
- **Steps:** see inline error → "Ask AI" → suggestion → Apply → re-run.
- **Success:** clean run.
- **Failure:** heuristic suggests wrong column; AI hallucinates.

### W14. Variables — cell-local + global
- [ ] **Trigger:** define `$$slow_threshold` in front-matter; reference `$$slow_threshold` in queries; define cell-local `$offset`.
- **Steps:** edit values via Settings panel → dependent cells re-execute.
- **Success:** substitution everywhere; downstream invalidation works.
- **Failure:** circular ref; reserved-keyword value; missing `$` prefix.

### W15. Presenter mode
- [ ] **Trigger:** eye icon.
- **Steps:** editors hide → markdown / charts / tables remain → user clicks "Run All" → toggle back.
- **Success:** clean readout.
- **Failure:** plot legend overflows; table doesn't fit.

### W16. screenshotPlot full path (AI sees its chart)
- [ ] **Trigger:** chat at `full` visibility, Anthropic provider.
- **Steps:** previewPlot → screenshotPlot(previewId) → PNG embedded in next AI turn → AI references visual details (label readability, color).
- **Success:** AI feedback matches what's on screen.
- **Failure:** other provider (no `supportsImageToolResults`); `sanitized`/`no-data` mode; html2canvas fails to load.

### W17. Custom view / macro round-trip
- [ ] **Trigger:** edit notebook front-matter to add a `views:` entry.
- **Steps:** save → view registered in DuckDB → callable in any cell; macro with params works.
- **Success:** view + macro behave like first-class tables/funcs.
- **Failure:** circular includes; topo-sort fails silently.

---

## Part 3 — Testing pass plan (do NOT skip the order)

1. **Automated test audit** (next) — map every checkbox above to existing tests in `tests/`. Identify gaps; note where a vitest unit test would cover quickly vs needing Playwright e2e.
2. **Manual E2E sweep** — start dev server, walk each workflow via Playwright MCP. Screenshot regressions. Prioritize W3, W11, W16 (recent AI tool work) and W7, W14 (touch the variable/brush plumbing).
3. **Fill the gaps** — write missing tests as we discover them.

### Out of scope for this pass
- Performance benchmarks (10k-row sort, 100-cell format)
- Mobile / tablet layouts
- Accessibility (keyboard nav, screen reader)
- Internationalization

---

## Part 4 — Expanded feature inventory (plots + interdependencies)

### 4a. Plot types — per-type options

- [ ] **LINE_CHART** — x (numeric/time/date), y single/dual (y2), connectNulls, lineType (line/dots), yScale/y2Scale (linear/log), xRefLines, yRefLines, color grouping. `components/plots/LineChartPlot.tsx`
- [ ] **LINE_CHART — LTTB decimation** — soft-cap 5000 samples/series; preserves visual extrema. `components/plots/LineChartPlot.tsx:11`
- [ ] **BAR_CHART** — x (categories), y (multiple), stacked/grouped, lineY overlay, logScale, horizontal, color grouping. `components/plots/BarChartPlot.ts`
- [ ] **AREA_CHART** — x, y (multiple), stacked/overlay, opacity, connectNulls, yScale, xRefLines. `components/plots/AreaChartPlot.tsx`
- [ ] **AREA_CHART — decimation** — LTTB soft-cap 5000 per series. `components/plots/AreaChartPlot.tsx:14`
- [ ] **SCATTER_PLOT** — x, y, size (bubble), color (grouping), category alias. `components/plots/ScatterPlot.tsx`
- [ ] **PIE_CHART** — category, value, innerRadius (donut), outerRadius, sliceLabel (inside/outside/none), showPercent, soft-cap 12 slices → "Other". `components/plots/PieChartPlot.tsx`
- [ ] **BOX_PLOT** — value, category, color alias; q1/median/q3/whiskers, linear quantile interpolation. `components/plots/BoxPlot.tsx`
- [ ] **HISTOGRAM** — x, bins (number/auto/Freedman-Diaconis), logBins, logScale, xDomain. `components/plots/HistogramPlot.tsx`
- [ ] **HEATMAP** — x cats, y cats, value (numeric for color); HSL scale blue→red. `components/plots/HeatmapPlot.tsx`
- [ ] **RANGE_PLOT** — x, low, high band; center line optional; opacity, color. `components/plots/RangePlot.tsx`
- [ ] **GANTT_CHART** — start, end, lane (Y categories), color, task label. `components/plots/GanttChartPlot.tsx`
- [ ] **FLAMEGRAPH** — hierarchical stack; zoom, regex search, package-prefix colors. `components/plots/FlameGraphPlot.tsx`
- [ ] **TABLE** — sortable + formatted rows/cols. `components/plots/TablePlot.ts`

### 4b. Plot DSL clauses (outer syntax)

- [ ] **TITLE** / **WIDTH** / **HEIGHT** / **LEGEND** — base clauses. `utils/plotParser.ts:20-28`
- [ ] **AXIS-X / AXIS-Y** — TYPE (log/linear), DOMAIN [lo,hi], LABEL. `utils/plotParser.ts:29-30`
- [ ] **LINK-X ($a,$b)** / **LINK-Y ($v)** / **LINK-XY ($v)** — brush↔variable wiring. `utils/plotParser.ts:24-33`
- [ ] **BRUSH (name, mode: x|y|xy)** — publish brush domain. `utils/plotParser.ts:38`
- [ ] **ON @alias1, @alias2** — data from other cells. `utils/plotParser.ts:19`
- [ ] **DATASET viewname** — fallback data source. `utils/plotParser.ts:46`
- [ ] **LINK_SCROLL (group:"x")** — coordinated horizontal scroll. `utils/plotParser.ts:34`
- [ ] **PALETTE name** — color palette override. `utils/plotParser.ts:31`
- [ ] **TOOLTIP_COLUMNS [...]** / **ON_HOVER_TOOLTIP** / **ON_CLICK_NAVIGATE**. `utils/plotParser.ts:35-37`
- [ ] **LET @const = value** — cell-local constants, no forward refs (B-189). `utils/plotConstants.ts`

### 4c. Composite layouts

- [ ] **ROW / COL / OVERLAY** — flex horizontal / vertical / absolute-stacked. `components/plots/CompositeRenderer.tsx:50,64`
- [ ] **Nested composites** — row-in-col, col-in-overlay, arbitrary depth.
- [ ] **Child error isolation** — broken child wrapped in boundary; siblings still render. `components/plots/CompositeRenderer.tsx:19`
- [ ] **Shared axes (overlay)** — children inherit container domain.
- [ ] **Mixed plot types in one composite** — e.g., BAR + LINE in OVERLAY.

### 4d. Linked variables & brushes

- [ ] **plotBrushStore pub/sub** — publish/subscribe API. `services/plotBrushStore.ts:52`
- [ ] **Brush cycle detection** — A→B→A breaks at second hop with one-shot warning (B-139). `services/plotBrushStore.ts:100`
- [ ] **Publisher retention 1000ms** — survives unmount/remount transients.
- [ ] **IN $var.brush operator** — `WHERE ts IN $gc.brush` → `BETWEEN $gc.brush.lo AND $gc.brush.hi`. `services/variableExpander.ts:19`
- [ ] **Brush unset handling** — query skipped with "unresolved variable".
- [ ] **LINK-X master flag** — authoritative publisher for linked domain.
- [ ] **LINK-X clamp flag** — clamp to data bounds vs allow pan outside.

### 4e. Cross-cell dependencies

- [ ] **ON @cellAlias** — plot pulls from another cell's named result.
- [ ] **DATASET viewname** — plot fetches from registered DuckDB view/macro.
- [ ] **Shared brushes across cells** — A publishes, B subscribes via LINK.
- [ ] **Shared filters** — FilterChip reflects brush values across cells.
- [ ] **Views/macros in front-matter** — topo-sorted registration. `App.tsx:431`
- [ ] **Execution-order dependency** — B references A only if A ran.
- [ ] **crossCellQueryRefs map** — blocks reordering that would break refs.

### 4f. Variable system

- [ ] **Scalar / cell-scoped / notebook-scoped** vars. `utils/variableSubstitution.ts`
- [ ] **Datetime variables** — ISO strings auto-quoted via `toSqlVariables`.
- [ ] **Range/dot notation** — `$brush.lo`, `$brush.hi`.
- [ ] **Default values** — cell metadata `defaultValue` seeds range pickers.
- [ ] **Transitive resolution** — `$a = $b + 1` fixpoint, up to 10 passes. `variableSubstitution.ts:48`
- [ ] **Cycle guard** — unresolved after 10 iterations → error.
- [ ] **`$$notebook_var` escape** — disambiguates notebook-level from cell-level.
- [ ] **Comment preservation** — `# $x` not substituted.
- [ ] **Boundary regex `(?!\w)`** — `$v` doesn't match inside `$v2`.

### 4g. Filter system

- [ ] **FilterChip display** — name + range, ns→µs/ms/s formatting. `components/FilterChip.tsx`
- [ ] **FilterChip remove** — × clears filter, re-runs SQL.
- [ ] **FilterModal visual builder** — `components/FilterModal.tsx`
- [ ] **Filter expansion into SQL** — via plotBrushStore + variableExpander.
- [ ] **Filter persistence** — saved as brush vars across reload.

### 4h. Plot renderer features

- [ ] **PlotTooltipContent** — hover datapoint with visibility-respecting row data.
- [ ] **Legend interactions** — click to hide/show series.
- [ ] **Zoom & pan** — wheel zoom, drag pan; publishes domain. `hooks/usePlotGestures.ts`
- [ ] **PNG/SVG export** — context menu / button (future).
- [ ] **Animation toggle** — `isAnimationActive`, `animationDuration`.
- [ ] **PlotErrorBoundary** — render error caught, message shown.
- [ ] **AiErrorFixer inline** — "Fix with AI" button suggests + applies.

### 4i. Plot composer / config editor

- [ ] **PlotConfigEditor** — DSL editor with autocomplete. `components/PlotConfigEditor.tsx`
- [ ] **PlotComposer** — composite renderer entry. `components/PlotComposer.tsx`
- [ ] **DSL-only features** — composites, AXIS-X, LEGEND only via text.
- [ ] **Live preview debounced** — on-keyup update.

### 4j. Plot suggestion / generation

- [ ] **✨ entry point** — `App.tsx:683`.
- [ ] **Local ONNX model** — schema-aware. `services/ml/PlotGenerationService.ts`
- [ ] **Cloud tier routing** — tiny/basic via AiService.
- [ ] **PlotSchemaDiscovery** — DESCRIBE / SELECT LIMIT 0.
- [ ] **Debounce 500ms + LRU 64** — `services/plotSuggestion.ts:74,77`.
- [ ] **Offline-only mode degraded result** — `Settings.plotSuggestOfflineOnly`.

### 4k. Theming & colors

- [ ] **COLORS palette per plot type** — hardcoded 8-color arrays.
- [ ] **PALETTE clause** — named palette override.
- [ ] **Dark theme CSS** — #1f2937 bg, #9ca3af text.
- [ ] **Custom hex** — RANGE_PLOT color, etc.
- [ ] **FlameGraph heuristic colors** — JDK blue, libs purple, GC red, kernel amber.

### 4l. Performance / scale

- [ ] **10k rows line/area** — LTTB → ~5k samples.
- [ ] **10k rows pie** — soft-cap 12 + "Other".
- [ ] **100 series line** — recharts handles; UI smoke test.
- [ ] **BigInt y-axis** — `utils/numberFormatter.ts` no precision loss.
- [ ] **ResponsiveContainer** — auto-resize, aspect ratio preserved.

---

## Part 5 — Expanded workflows (AI chat depth)

### W18. Multi-turn follow-up with context preservation
- [ ] **Trigger:** "analyze GC events" → "now show me by phase".
- **Steps:** describeTable → runQuery (GROUP BY) → follow-up uses prior columns → refined query.
- **Success:** second query reuses first's column knowledge; no redundant describeTable.
- **Failure:** history compaction truncates context (inline chat `MAX_INLINE_HISTORY_TURNS=12`).

### W19. Tool-chain discovery: describeTable → sampleRows → previewPlot
- [ ] **Trigger:** "plot event count distribution for the largest table".
- **Steps:** listCells → describeTable → sampleRows → runQuery → previewPlot → Add to Notebook.
- **Success:** combined SQL+plot cell inserted in one round.
- **Failure:** sampleRows empty table; previewPlot DSL invalid.

### W20. Plan mode with per-step rejection / edit / re-plan
- [ ] **Trigger:** Plan mode → "build a 3-panel dashboard".
- **Steps:** read tools → plan card → user rejects step 2 → edits step 1 SQL → "Execute Remaining".
- **Success:** notebook has cells from approved steps only.
- **Failure:** edited step has syntax error; afterCellId of later step stale.

### W21. Dashboard: ROW of interdependent plots
- [ ] **Trigger:** "create a 3-plot dashboard — GC pause, heap, threads".
- **Steps:** three previewPlot calls → AI emits `ROW(...)` DSL referencing the configs → user approves single cell.
- **Success:** three plots render side-by-side; shared parent cell.
- **Failure:** one child DSL invalid → CompositeRenderer error-isolates it; previewId expires mid-flow.

### W22. Cross-cell SQL aliasing via readCell
- [ ] **Trigger:** cell A `-- alias cpu_summary`; "use that in cell B".
- **Steps:** listCells → readCell A → editCell B with `FROM @cpu_summary`.
- **Success:** B runs; alias resolves.
- **Failure:** alias typo; A hasn't run; circular alias.

### W23. Visibility mode switch mid-conversation
- [ ] **Trigger:** `sanitized` → ask for raw → switch to `full` → ask for screenshot.
- **Steps:** previewPlot in sanitized → toggle to full → screenshotPlot succeeds → AI references visual.
- **Success:** tools gate per current mode; prior results unchanged.
- **Failure:** image tool result on non-image provider; gating leaks retroactively.

### W24. Provider switch mid-session (Anthropic → OpenAI)
- [ ] **Trigger:** 3 Anthropic turns → switch provider → new message.
- **Steps:** chat history retained → next turn uses OpenAI → tool flow continues.
- **Success:** history intact, no auth/format errors.
- **Failure:** prior image tool_result blocks OpenAI parse (supportsImageToolResults mismatch).

### W25. Pagination + AI token awareness via offset
- [ ] **Trigger:** "show top 100 allocations" → "next 100".
- **Steps:** runQuery(limit:100) → `truncated:true` → runQuery(offset:100, limit:100) → AI decides to stop.
- **Success:** offset honored; AI self-regulates further fetches.
- **Failure:** AI loses offset; off-by-one boundary.

### W26. Rejection loop: AI rephrases after user rejects proposal
- [ ] **Trigger:** AI proposes 5-dim plot; user rejects "too crowded".
- **Steps:** applyPlot rejected → AI simplifies → applyPlot again → approved.
- **Success:** simpler plot applied.
- **Failure:** AI repeats identical proposal; needs anti-loop bail.

### W27. Concurrent cell edit while AI is editing
- [ ] **Trigger:** AI mid `editCell(C)` while user types in C.
- **Steps:** AI tool fires → user keystroke local → AI write lands → conflict.
- **Success:** last-write-wins with indicator, OR merge prompt.
- **Failure:** cell corrupted; undo broken; silent overwrite.

### W28. DuckDB error → AI self-correction
- [ ] **Trigger:** AI selects non-existent column.
- **Steps:** runQuery → error in tool_result → AI calls describeTable → resubmits.
- **Success:** corrected query passes.
- **Failure:** AI ignores error; repeats same column.

### W29. Plot DSL validation feedback loop
- [ ] **Trigger:** AI emits invalid previewPlot DSL.
- **Steps:** runtime returns "invalid plot DSL: ..." → AI verifies columns → resubmits.
- **Success:** valid DSL renders.
- **Failure:** AI repeats same invalid DSL; error message too cryptic.

### W30. Anti-loop guard: repeated identical tool call
- [ ] **Trigger:** AI loops on same runQuery call 3+ times.
- **Steps:** orchestrator detects → caches OR refuses with "looks like a loop".
- **Success:** loop short-circuited.
- **Failure:** AI burns turns until rate limit.

### W31. Brush cascade → dependent re-execution
- [ ] **Trigger:** plot with `BRUSH(name:"$time_range")` — user brushes.
- **Steps:** brush updates `$time_range` → dependent cells invalidate → auto-run reruns → AI sees new results.
- **Success:** cascade fires; AI references new data.
- **Failure:** stale `$time_range` in next AI turn.

### W32. listVariables → setVariable → cascade
- [ ] **Trigger:** "set threshold to 500 and show impact".
- **Steps:** listVariables → setVariable → runQuery uses new value → AI compares with cached prior result.
- **Success:** vars persisted; cascade visible.
- **Failure:** substitution fails; type mismatch.

### W33. Inline-chat escalation: pop to sidebar
- [ ] **Trigger:** inline chat conversation expands beyond one cell.
- **Steps:** inline AI proposes addCell(B) → "Pop to Sidebar" → full tool set, history intact.
- **Success:** history preserved; tool set richer.
- **Failure:** history lost; stale cell context.

### W34. "Ask AI to fix" from broken plot
- [ ] **Trigger:** plot block errors; AiErrorFixer button.
- **Steps:** inline chat opens with cell + error → AI calls previewPlot with fix → Apply.
- **Success:** plot re-renders.
- **Failure:** error context stripped; visibility hides offending column name.

### W35. Visibility-aware system prompt adaptation
- [ ] **Trigger:** chat at `no-data` → "what are the outliers".
- **Steps:** system prompt warns AI; AI uses only schema tools, no previewPlot.
- **Success:** AI respects mode; generic suggestions.
- **Failure:** AI calls forbidden tool; orchestrator must catch.

### W36. btw-mode hints
- [ ] **Trigger:** main turn completes; gate (>15s, >80ch, not no-data) lets btw run.
- **Steps:** secondary AI call with BTW_MODE_HINT_SYSTEM → emits 0-3 jfr-btw hints.
- **Success:** hints rendered; click sends prompt.
- **Failure:** debounce broken; duplicate hints; JSON parse error.
