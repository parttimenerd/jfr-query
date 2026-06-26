# jfr-query bugs and UX issues

Last triaged: 2026-06-26
Triage source: codebase walkthrough (App.tsx, NotebookCell.tsx, SQLEditor.tsx, PlotConfigEditor.tsx, PlotRenderer.tsx, Sidebar.tsx, SettingsModal.tsx, SettingsPanel.tsx, ChatPanel.tsx, notebookParser.ts, variableSubstitution.ts, useHistoryState.ts) plus a live Playwright probe against http://localhost:3003 with `default.jfr`. Extended: plot autocomplete pipeline (parser.ts, ast.ts, lint.ts, aiPlotSource.ts, aiPlotContext.ts, schemaProvider.tsx, annotators/), AI chat integration (tools/runtime.ts, visibility.ts, BrowserModelProvider.ts, AiService.ts), local ML models (heuristicPlot.ts, classifyColumns.ts, PlotGenerationService.ts), date selectors (FilterModal.tsx, RangeSlider.tsx), SQL autocomplete (dispatcher.ts, providers/).

## Severity legend
- 🔴 broken / data loss / crash
- 🟠 surprising behavior / silently wrong
- 🟡 mild UX friction
- 🔵 nice-to-have

---

## Autocompletion

### 🔴 [B-001] SQL autocomplete does not know about tables, views, or macros ✅ FIXED
**Where:** `core/frontend/components/SQLEditor.tsx:181,206-211`; `core/frontend/index.html:18-19`
**Repro:** In any SQL block, type `SELECT * FROM Gar` and wait, or hit Ctrl-Space.
**Observed:** Hints contain only generic SQL keywords (`SELECT`, `SET`, …). Live probe confirmed: `hint items sample: ['SELECT', 'SET']`. None of the 178 tables, custom views, or macros are offered, even though the schema is fully loaded and is used for syntax-highlighting in the very same editor.
**Expected:** After `FROM`/`JOIN`/quote, suggest table + view names; suggest macro names where a function is expected.
**Notes:** `sql-hint.js` is loaded but never configured with `hintOptions.tables`. There is no `registerHelper('hint','sql', …)` and no `editor.setOption('hintOptions',{tables:…})`. The only customization is `extraKeys: { 'Ctrl-Space': 'autocomplete' }`. Worse: the inputRead handler at line 206 calls `editor.showHint({ completeSingle:false })` on every keystroke, so the broken default fires constantly. Fix: feed the schema (`combinedSchema.tables/views`) into `hintOptions.tables` (a `{ tableName: [columns…] }` map) and a custom hint function that also returns `metadata.macros` and `metadata.views`.
**Fix:** Custom `buildHint` function in SQLEditor now provides prefix-matched completions for all tables, views, macros and `$variables`. Verified live: typing `GC` + Ctrl-Space returns 24 matching table/view entries.

### 🔴 [B-002] No autocomplete for `$variables` in SQL or plot editors ✅ FIXED
**Where:** `core/frontend/components/SQLEditor.tsx:206-211`; `PlotConfigEditor.tsx:29-145`
**Repro:** In a SQL or plot block, type `$lim`. Hit Ctrl-Space.
**Observed:** Nothing matching `$lim` is suggested even when `$limit` is defined in the cell's variables block (or in metadata).
**Expected:** Suggest the defined cell-local + global variables, with their values shown like the inline marker widget already does for highlighting (`SQLEditor.tsx:251-255`).
**Notes:** Both editors receive `variables` as a prop but never use it from a hint helper. Plot editor only suggests `@constants`, not `$variables`.
**Fix:** `buildHint` in SQLEditor checks if the current token starts with `$` and returns matching variable entries with their current values (`$name = value` display).

### 🟠 [B-003] Plot hint helper is registered globally on every render ✅ FIXED
**Where:** `core/frontend/components/PlotConfigEditor.tsx:24-145`
**Repro:** Open two cells with plot configs. Edit cell A, then cell B with different SQL results.
**Observed:** Each `PlotConfigEditor` mount calls `window.CodeMirror.registerHelper('hint','plot', …)` with a closure over its own `data`. Because `registerHelper` is global, the *most recently mounted* editor's `data` keys leak into every other plot editor's column completions.
**Expected:** Either pass `data` via `editor.setOption('hintOptions',{data})` or register the helper once and look the data up via the editor instance.
**Notes:** Combined with React.memo on PlotConfigEditor this is subtle — the helper is replaced on every `useEffect([data])` run. Symptom: column-name suggestions reflect the wrong query.
**Fix:** Helper registered once (module-level `ensurePlotHintRegistered`). Each PlotConfigEditor passes `hintData={data}` to SQLEditor, which sets `editor.setOption('hintOptions', {data})` per instance. The helper reads `cm.getOption('hintOptions')?.data` to get its own data.

### 🟠 [B-004] `inputRead` triggers SQL hint on every keystroke even mid-identifier ✅ FIXED
**Where:** `core/frontend/components/SQLEditor.tsx:206-211`
**Notes:** Now only triggers on delimiter chars (space, `.`, `(`, `,`) or when prefix ≥ 2 chars.

### 🟡 [B-005] Plot hint match logic uses substring on `displayText`, producing noisy ranking
**Where:** `core/frontend/components/PlotConfigEditor.tsx:133-135`
**Repro:** In a plot block type `tit`.
**Observed:** Anything whose display text contains "tit" anywhere matches; e.g. parameter names with "title" in their description appear before the actual `TITLE` clause.
**Expected:** Prefix-rank or score by edit distance.

### 🔵 [B-006] No autocomplete inside the front-matter Custom-View / Custom-Macro editors
**Where:** `core/frontend/components/SettingsPanel.tsx:100`
**Repro:** Open Settings panel, edit a custom view's SQL.
**Observed:** Same SQLEditor with all the same problems as B-001/B-002, plus the cells' local `$variables` are not in scope so the editor flags every `$x` as undefined visually even when it'll be substituted at runtime. (Variables aren't currently substituted into views at all — see B-009.)

---

## View language / variables coupling

### 🔴 [B-007] Global `metadata.variables` are typed but never parsed or persisted ✅ FIXED
**Where:** `core/frontend/types.ts:64-71`; `core/frontend/utils/notebookParser.ts:28-89,91-134`
**Repro:** Save a notebook with `metadata.variables = { '$start': '0' }` (set via the AI chat or in code). Reload the notebook from disk.
**Observed:** `parseFrontMatter` does not handle a top-level `variables:` key — it would land in the `else if (keyTrimmed)` branch on line 56-57 as a string, not parsed as an object. `stringifyFrontMatter` puts it through the unknown-keys serializer at line 127-131 (which only handles primitives) so it is silently dropped on save. The value `metadata.variables` therefore only ever exists in memory; refresh blows it away.
**Expected:** Round-trip the global variables through YAML, OR document that "global variables" don't exist and remove `metadata.variables` from the type and from the merge in `NotebookCell.tsx:152`.
**Notes:** `PlotRenderer.tsx:189-196` already writes `metadata.variables` when a `$$global` linked plot is interacted with — so global zoom state is being silently discarded on every reload.
**Fix:** notebookParser now parses `variables:` as a top-level map and round-trips it. Two new tests in `notebookParser.test.ts`.

### 🔴 [B-008] `$$global` variable convention is half-implemented ✅ FIXED
**Where:** `core/frontend/components/NotebookCell.tsx:317`; `PlotRenderer.tsx:190-196`; `SettingsPanel.tsx`
**Repro:** Define a plot with `LINK_X($$start, $$end)`.
**Observed:** Click on `$$start` → `onGlobalVariableClick` → `Notebook.tsx:42` → `settingsPanelRef.current.focusVariable` → `SettingsPanel.tsx:60` `console.log("Focus variable request: …")` and then *nothing else happens* (it's a "Placeholder for future implementation" no-op). The Settings panel doesn't even render an editor for global variables. Combined with B-007, `$$`-prefixed variables are essentially write-only.
**Expected:** Either fully implement the global-variable editor or strip the `$$` branch.
**Fix:** SettingsPanel now hosts a "Notebook Variables" section with add/rename/delete/edit controls. `focusVariable` ensures the section is open, creates the variable if it doesn't yet exist, and focuses+selects the matching name input. SQLEditor regex widened to `\$\$?\w+` so `$$x` is recognized as a single token. `substituteVariables` adds a left-boundary `(?<!\$)` for `$x` and processes longer keys first so `$x` never eats into `$$x`. Round-trip verified end-to-end (Playwright probe): adding `$$newVar=myValue123` in the panel, pressing ⌘S, reopening the saved file → variable persists in front-matter.

### 🔴 [B-009] Variable substitution only applies to the cell's SQL — not to views, macros, or other cells ✅ FIXED
**Where:** `core/frontend/App.tsx:171-194` (only `runQuery` substitutes); custom views in `metadata.views` are passed through to DuckDB unchanged.
**Repro:** Define `$limit = 10` in cell A. Reference it from a `views:` SQL in front matter, or from cell B.
**Observed:** Cell B does not see cell A's `$limit` (each cell only sees its own `parsed.variables` plus the broken `metadata.variables`); custom views never have any variables substituted because they are sent directly to DuckDB on first run. The error message in `App.tsx:178` even talks about defining vars in the "cell's `variables` block" — implying per-cell scope is intentional, but this contradicts the AI chat panel's coupling assumption.
**Expected:** Document the scope clearly, and either (a) make global variables real (B-007/B-008) or (b) at least allow front-matter views to use `$variables` from the notebook scope.
**Fix:** App.tsx registers front-matter `views`/`macros` to DuckDB on mount and on metadata change, with `metadata.variables` substituted into their SQL. With B-008 also fixed, the `$$global` convention is now real — define `$$limit` in the Notebook Variables panel, reference it from any view, macro, or cell, and changes flow everywhere. Macros must include an explicit `(args) AS body` parameter list — bare expressions are skipped (legacy behavior). Cross-cell coupling via `metadata.variables` works (B-007 fix). Cell-local `$x` deliberately does NOT flow into views/other cells — each cell remains a separate scope by design; promote to `$$x` to share.

### 🟠 [B-010] Variable rename in the variable-editor renames the value, never the references ✅ FIXED
**Where:** `core/frontend/components/NotebookCell.tsx:77-82,314`
**Repro:** Cell uses `LIMIT $limit;`. In the variable editor, rename `$limit` → `$max`.
**Observed:** The variable map is updated but the SQL still says `$limit` and starts erroring with "Undefined variable(s) found: $limit".
**Expected:** Either auto-rename usages, or refuse the rename, or surface a confirmation. At minimum the error should say "did you also rename usages?".
**Fix:** `handleVariableChange` now detects when `oldKey !== newKey` and does a boundary-safe regex replace of the old name in all `sql`/`plot` segments before calling `handleSegmentsUpdate`. Both single-dollar and `$$` prefixes handled correctly.

### 🟠 [B-011] Variable substitution is single-pass and order-sensitive; transitive references silently misbehave ✅ FIXED
**Where:** `core/frontend/utils/variableSubstitution.ts:16-30`
**Repro:** Define `$a = $b + 1` and `$b = 2`.
**Observed:** Behavior depends on JS object iteration order. The doc-comment even calls this out: "callers should not rely on transitive substitution." But there's no warning surfaced to the user.
**Expected:** Either fixed-point substitution with a cycle check, or explicit lint warning when a value contains another `$name`.
**Fix:** `substituteVariables` now iterates up to 10 passes, stopping when no more changes occur (fixpoint). Cycles (e.g. `$a = $b, $b = $a`) stop after 10 iterations with the unresolved tokens left intact. 4 new tests added covering transitive chains, cycles, and word-boundary safety across passes.

### 🟠 [B-012] Auto-run only fires when a variable is referenced in the literal SQL string, not when a *macro/view used by the SQL* references the variable ✅ FIXED
**Where:** `core/frontend/components/NotebookCell.tsx:207`
**Repro:** Define a custom macro `gc_after($t)` that uses `$t`. In a cell call `SELECT * FROM gc_after($cutoff)`. Change `$cutoff`.
**Observed:** Auto-run skips because `/\$\w+/.test(sql)` only inspects the raw SQL — works in this example. Try the inverse: `SELECT * FROM my_filtered_view` where `my_filtered_view` was defined as `SELECT * FROM Foo WHERE t > $cutoff`. Variable changes *don't* re-run because views aren't substituted (B-009) and the SQL doesn't textually contain `$cutoff`.
**Expected:** If we ever do view-side substitution, the auto-run change-detection has to follow.
**Fix:** Auto-run effect now also checks `usesCustomView`: if `metadata.variables` changed AND the SQL references any custom view/macro name from `metadata.views`/`metadata.macros`, it re-runs. This covers the "SQL calls a view whose body uses `$$global`" pattern without any false positives for built-in views.

### 🟠 [B-013] Variable input field accepts `$$` but the cell scope overrides global with the same name ✅ FIXED
**Where:** `core/frontend/components/NotebookCell.tsx:152`
**Notes:** `VariableEditor` now validates against `^\$(?!\$)\w+` — `$$`-prefixed names turn the key input red and revert on blur. The parser already rejects `$$` names in cell blocks (surfaced as warnings). Use Notebook Settings to define `$$global` variables.

### 🟡 [B-014] Variable-block parser ignores comments and refuses any non-assignment line silently ✅ FIXED
**Where:** `core/frontend/utils/notebookParser.ts:283-288`
**Repro:** Inside ```` ```variables ```` add `# this is a comment` or `$broken` (no `=`).
**Observed:** Garbage lines are silently ignored; no feedback that the line didn't define anything.
**Expected:** Either highlight lines that fail the `^(\$\w+)\s*=` shape, or show a small inline diagnostic.
**Fix:** `parseCellContent` now collects non-matching, non-comment, non-blank lines into `ParsedContent.variableWarnings[]`. `#`-prefixed lines are treated as comments (silently skipped). All other unrecognized lines surface as yellow inline text below the variable list in `NotebookCell.tsx`.

### 🟡 [B-015] No variable autocomplete in the inline-chat / AI prompt either
**Where:** `core/frontend/components/InlineChat.tsx`
**Repro:** Use the chat-bubble action on a SQL block.
**Observed:** Asking the AI to "set $limit to 100" yields an answer that uses `$limit` but the AI doesn't know which variables exist.
**Expected:** Pass `allVariables` into the prompt context.

---

## Zoom / time-range coupling

### 🔴 [B-016] Plot help docs claim "scroll to zoom and drag to pan" but pan is not implemented; even zoom requires Shift ✅ FIXED
**Where:** `core/frontend/components/PlotRenderer.tsx:126-154`; `components/plots/LineChartPlot.tsx:86`; `components/PlotHelpModal.tsx:174,220`
**Repro:** Create a `LINE_CHART(...) LINK_X($start, $end)`. Drag inside it.
**Observed:** No drag handler exists (`grep onMouseDown`/`onPan` returns nothing in PlotRenderer); only `onWheel` with a `!e.shiftKey` early-return at line 127. Plain wheel does nothing, but the cursor still shows `crosshair` (line 157) so users assume it's interactive.
**Expected:** Implement drag-to-pan, or update the docs.
**Notes:** The `master` keyword (linkXMaster) is parsed but completely unused — `parsedCall.linkXMaster` is destructured nowhere outside `plotParser.ts`. If "master" is supposed to mean "this plot drives others", that doesn't exist.
**Fix:** Added `onMouseDown`/`onMouseMove`/`onMouseUp`/`onMouseLeave` handlers in `InteractivePlotWrapper`. Drag computes domain shift as `-(pixelsDragged / rect.width) * currentRange` and calls `handleInteraction`. Cursor changes from `grab` → `grabbing` while dragging. Hint chip updated to "drag = pan · ⇧ scroll = zoom". PlotHelpModal updated to match ("drag to pan, Shift+scroll to zoom").

### 🟠 [B-017] Cross-cell zoom coupling does not work even though it ostensibly should ✅ FIXED
**Where:** `core/frontend/components/PlotRenderer.tsx:189-196`
**Notes:** `handleVariableChange` now always routes LINK_X variable changes to `onMetadataChange` (notebook-global `metadata.variables`), so sibling cells that read the same variable names via `allVariables = {...metadata.variables, ...parsed.variables}` see the updated domain immediately.

### 🟠 [B-018] Wheel-zoom is hijacked from the page only on Shift; without Shift the page scrolls *through* a hovered chart ✅ FIXED (discoverability)
**Where:** `core/frontend/components/PlotRenderer.tsx:127`
**Repro:** Hover an interactive plot, scroll wheel.
**Observed:** Page scrolls. Most users will try wheel first and never discover Shift.
**Expected:** Either show a hint (the cursor crosshair already implies interactivity) or use plain wheel with a small dead-zone.
**Fix:** Added a "⇧ scroll = zoom" hint chip next to the lock button (visible on hover). Plain wheel still scrolls the page through the chart by design — same convention as Grafana / Datadog — but the modifier is now discoverable.

### 🟠 [B-019] The "lock" toggle on linked plots is hidden and only opacity-revealed on hover ✅ FIXED
**Where:** `core/frontend/components/PlotRenderer.tsx:158`
**Repro:** Open a linked plot. Try to find the lock.
**Observed:** Button is `opacity-0 group-hover:opacity-100` — invisible and unfocusable until you hover.
**Expected:** Always show, or at least give it a focus ring for keyboard users.
**Fix:** Lock button is now always visible (was opacity-0 group-hover:opacity-100). Added a focus ring for keyboard users. The "⇧ scroll = zoom" hint chip beside it stays opacity-fade so it's not visually noisy.

### 🟡 [B-020] Linked-plot domain reset jumps when `linkXClamp` is set and the data range shrinks past current domain
**Where:** `core/frontend/components/PlotRenderer.tsx:106-119`
**Observed:** `if (dataRange.max - dataRange.min < finalMax - finalMin)` snaps to full data range with no animation; visually jarring. Minor.

---

## Schema sidebar / preview

### 🟠 [B-021] Clicking a Tables/Views/Macros item populates preview but does NOT focus the preview editor ✅ FIXED
**Where:** `core/frontend/components/Sidebar.tsx:165-177` (handleItemSelect)
**Repro:** Click any table in the schema sidebar.
**Observed:** Live probe confirmed active element after click is the Tables-list button, not the preview editor. Preview editor isn't even visible until the user clicks the pencil ("Show Query Editor", line 423-429). User has to: click table → click pencil → click into editor → edit. Three clicks for what should be one.
**Expected:** Auto-show the preview editor and focus its CodeMirror cursor at end-of-query.
**Fix:** `handleItemSelect` now takes a `userInitiated` flag. User-initiated clicks set `isPreviewEditorVisible=true` and bump a `previewFocusTrigger` counter; SQLEditor watches `focusTrigger` and refocuses + moves the cursor to end on each bump. The first auto-select (`useEffect` on mount) does not pass the flag, so the editor stays hidden until interaction.

### 🟠 [B-022] "Macros" sidebar invocation template uses `…` placeholder which DuckDB rejects ✅ FIXED
**Where:** `core/frontend/components/Sidebar.tsx:170-171`
**Repro:** Click any macro in the sidebar.
**Observed:** Default query becomes `SELECT macro_name(..., ..., ...);` which is then run by `runPreviewQuery` and errors. The error becomes the preview content.
**Expected:** Use the macro's `parameters[i]` names, or insert NULLs / sample values; or don't auto-run a macro click.
**Fix:** macro click now uses `parameters[]` names (or empty-arg form when none) and skips the auto-run; user fills in real arguments first.

### 🟡 [B-023] First-table auto-select races with sidebar mount ✅ FIXED
**Where:** `core/frontend/components/Sidebar.tsx:68-72`
**Notes:** Added `autoSelectedRef` so the auto-select fires only once (first schema arrival), preventing re-evaluation on every schema update that could override a user selection.

### 🟡 [B-024] "Show Query Editor" pencil and "Show Search" magnifier reset on every panel re-mount ✅ FIXED
**Where:** `core/frontend/components/Sidebar.tsx:55-56`
**Observed:** State is `useState(false)` — never persisted. After every reload (which the settings save forces — see B-035), the preview editor is hidden again.
**Fix:** `isPreviewEditorVisible` is now initialized from `localStorage` and persisted back on every change via `useEffect`. Survives reload without the full-page-reload side effect.

### 🟡 [B-025] Tooltip for views/macros has no max-height; long view SQL bleeds off-screen ✅ FIXED
**Where:** `core/frontend/components/Sidebar.tsx:79`
**Notes:** `tooltipMaxHeight = 250` is only used for *positioning*, not as a CSS max-height — so a 500-line view spills out of the dark box.
**Fix:** Added `style={{ maxHeight: '250px' }}` and `overflow-y-auto` to the tooltip div so long view SQL scrolls within the bounded box.

---

## Cell editor

### 🔴 [B-026] Cell ID is content-hashed → typing in the title (or first ~100 chars) silently re-keys the cell ✅ FIXED
**Where:** `core/frontend/App.tsx:152-169`
**Repro:** Type the first character of the cell title. Run a query. Continue typing the title.
**Observed:** `id: 'cell-${hash(content[0..100]+i)}'` changes with every keystroke in the prefix. React unmounts/remounts the cell, the running-state map keyed on `cell.id` is dropped, and the `results[cell.id]` from the previous keystroke's id orphans (App's `results` keeps growing memory until reload). The only thing that stays is `useState`-backed segment cache, which is also reset on remount because the *component* is new.
**Expected:** Stable IDs that are persisted to the markdown (e.g. as a hidden HTML comment or a frontmatter `id:` field) or assigned once on parse and stored in a Map keyed by content-position.
**Notes:** Mitigation: results-by-id uses an actual ID, but because IDs change, old results live forever in `results` until reload. Memory leak per character typed.
**Fix:** Cell IDs are now position-based (`cell-${index}`). Editing content no longer re-keys the React subtree, eliminating the keystroke-induced remount churn AND the orphaned-results memory leak. Trade-off: insert/delete in the middle of the notebook still misaligns IDs (so results from a removed cell may briefly carry over to its successor) — same behavior as before, but content-edit is the dominant case.

### 🟠 [B-027] Add Cell button uses `cell-${Date.now()}` — non-deterministic across reloads ✅ FIXED
**Where:** `core/frontend/App.tsx:204`
**Notes:** B-026 already switched cells to position-based IDs (`cell-${index}`) derived from the notebook parse; the temporary Date.now() ID in `addCell` is overwritten immediately by `updateCellsAndMarkdown`. Non-issue in current architecture.

### 🟠 [B-028] Front-matter `views`/`macros` get `fm-${Date.now()}-${Math.random()}` IDs that change on every parse ✅ FIXED
**Where:** `core/frontend/utils/notebookParser.ts:70`
**Notes:** Changed to deterministic `fm-${section}-${index}` so the JSON.stringify key used in App.tsx's useMemo deps is stable across re-parses.

### 🟠 [B-029] Plot block creation immediately seeds `TABLE()` even when SQL still says "SELECT * FROM …" ✅ FIXED
**Where:** `core/frontend/components/NotebookCell.tsx:303`
**Notes:** Auto-run gate now detects `...` and `<placeholder>` patterns and skips running them.

### 🟠 [B-030] Variable rename via `VariableEditor` debounces with stale closure ✅ FIXED
**Where:** `core/frontend/components/NotebookCell.tsx:77-82`
**Notes:** `debouncedOnChange = useCallback(debounce(onChange, 800), [onChange])` — `onChange` itself depends on `parsed.variables` indirectly (via `handleCellVariableChange` → `segments`). When the user types fast, the debounced call fires with `varKey/value` from a 800ms-old render but reads `segments` from the freshest render — risk of inconsistent merges. Because `debounce` here doesn't capture `args` correctly between calls (each new key/value pair starts a new timer), only the *last* arg-set fires, but it could be applied against a segment list where another variable was already deleted.
**Fix:** Removed the debounce entirely. Key and value inputs now use local state while typing and commit via `onBlur` using a `onChangeRef.current` (stable ref) to always call the freshest `onChange`. This eliminates the stale-closure window entirely.

### 🟡 [B-031] Title editor's `Enter` saves but `Escape` only cancels the editing UI without restoring the original value visually until a re-render ✅ FIXED
**Where:** `core/frontend/components/NotebookCell.tsx:306`
**Notes:** It uses `defaultValue` so the input keeps its in-progress text after Escape — minor.
**Fix:** Added `editingTitleValue` controlled state. Clicking to edit initializes it to the current title. Escape now correctly reverts the displayed value.

### 🟡 [B-032] No keyboard shortcut for run / undo / save / toggle markdown ✅ PARTIALLY FIXED
**Where:** `core/frontend/App.tsx`
**Observed:** Verified: only the editors' own `extraKeys` exist; no `keydown` listener on the document.
**Expected:** Cmd/Ctrl-Enter to run cell, Cmd/Ctrl-Z bound to history undo, Cmd/Ctrl-S to save, etc.
**Fix:** App-level keydown listener now binds Cmd/Ctrl-S (save), Cmd/Ctrl-Z (undo), Cmd/Ctrl-Shift-Z and Cmd/Ctrl-Y (redo). Save fires unconditionally; undo/redo only fire when focus is outside a CodeMirror instance, so the editor's own history wins inside editors. Button titles updated with shortcut hints. Verified Cmd-S download via Playwright.
**Still open:** Cmd-Enter to run focused cell — needs per-editor wiring with cell-aware `onRunQuery`.

### 🟡 [B-033] Markdown raw-mode toggle silently loses cell-by-cell collapse/lock state
**Where:** `core/frontend/App.tsx:113`; `NotebookCell.tsx:93`
**Observed:** Switching to raw markdown unmounts every cell, so collapse, AI chat panels, and edit-mode flags reset.

---

## Settings modal

### 🔴 [B-034] Escape does NOT close the Settings modal ✅ FIXED
**Where:** `core/frontend/components/SettingsModal.tsx:137-339`
**Repro:** Open settings. Press Esc. Live probe confirmed: modal stays open.
**Expected:** Standard modal Esc-to-close.
**Notes:** `handleBackdropClick` exists for click-out but no keydown handler.
**Fix:** Added a window keydown listener (gated on `isOpen`) that calls `onClose()` on Escape. Verified via Playwright probe.

### 🟠 [B-035] Settings save *forces* a `window.location.reload()` — every preference change throws away in-memory notebook state ✅ FIXED
**Where:** `core/frontend/components/SettingsModal.tsx:56-61`
**Observed:** Comment says "Reload to ensure all services re-initialize with new keys/settings." But `aiService.initialize` is called from `App.tsx:73-105` on `[settings]` changes anyway, so the reload is redundant. Side effect: any unsaved cell edits (within the 800ms debounce) are gone.
**Expected:** Re-init AI provider in place; only reload if absolutely needed.
**Fix:** Removed `window.location.reload()` from `handleSave`. `saveSettings` writes to localStorage → `usePersistentState` triggers → `App.tsx useEffect([settings])` reinitializes `aiService` automatically. No state is lost.

### 🟠 [B-036] API-key field is type=password but value is bound directly to `localSettings` and shown as fully-visible characters in DOM inspectors via `value={…}` even when env-var-loaded ✅ BY DESIGN
**Where:** `core/frontend/components/SettingsModal.tsx:200-207`
**Notes:** React controlled inputs always reflect value in the DOM attribute. `type=password` masks it in the UI. The env-var-prefill → localStorage persistence is intentional for UX. WONTFIX unless moving to uncontrolled inputs or a secrets manager.

### 🟠 [B-037] Local-AI base URL has no validation ✅ FIXED
**Where:** `core/frontend/components/SettingsModal.tsx:178-192`
**Notes:** Input changed to `type="url"` with `pattern="https?://.+"`. An inline red warning appears when the URL doesn't start with `http://` or `https://`. The Test button is disabled for invalid URLs.

### 🟠 [B-038] Test-result staleness logic doesn't cover localBaseUrl changes ✅ FIXED
**Where:** `core/frontend/components/SettingsModal.tsx:39-51`
**Notes:** Staleness now uses a composite `apiKey|baseUrl` string for the `local` provider; `localBaseUrl` added to effect deps and stored value.

### 🟡 [B-039] "Surprise Me!" prompt cycles through 10 prompts but persists `suggestionIndex` only in component state
**Where:** `core/frontend/components/SettingsPanel.tsx:56,98`
**Observed:** Closing/reopening the panel resets the index.

---

## Notebook lifecycle

### 🟠 [B-040] Saving a notebook always writes `notebook.md`; loading the same file twice in a row needs `e.target.value=''` reset (which is done) but the file picker accepts ANY file (e.g. .json) and tries to parse it as markdown silently ✅ FIXED
**Where:** `core/frontend/App.tsx:120-133`
**Notes:** Fixed: `accept=".md,.markdown"` now set on the file input.

### 🟠 [B-041] `runQuery` writes results into a sparse array indexed by `queryIndex` ✅ FIXED
**Where:** `core/frontend/App.tsx:182-186,188-192`
**Repro:** Cell has 3 SQL blocks. Delete the first. Run remaining.
**Observed:** `setResults(prev => { const newCellResults = [...(prev[cellId]||[])]; newCellResults[queryIndex] = data; … })` — when the indices shift, results[0] keeps the old query's data until run #2. Combined with `deleteQueryBlock` not clearing `results[cellId][index]`, the result panel shows stale data for the deleted slot until you trigger a re-run.
**Fix:** `deleteQueryBlock` now calls `arr.splice(index, 1)` on the cell's results array, removing the deleted slot and compacting the remaining results so downstream indices stay aligned.

### 🟠 [B-042] Auto-run also fires for SQL whose error is "syntax error" — wasting cycles and noisy ✅ FIXED
**Where:** `core/frontend/components/NotebookCell.tsx:205-218`
**Notes:** Runnable gate already blocks unbalanced parens/trailing comma; also added `isPlaceholder` check (`...` or `<…>`) so new-block placeholder SQL never auto-runs.

### 🟡 [B-043] Notebook content history is per-keystroke after a new "session" starts but debounce can drop intermediate states
**Where:** `core/frontend/hooks/useHistoryState.ts:50-74`
**Notes:** Functional, but undo step granularity feels random — sometimes a single Cmd-Z reverts seconds of typing.

### 🟡 [B-044] No "unsaved changes" warning on browser tab close ✅ FIXED
**Where:** `core/frontend/App.tsx`
**Notes:** Added `beforeunload` handler — fires if `notebookMarkdown !== savedMarkdownRef.current`. `savedMarkdownRef` updates on Save (download). localStorage still auto-saves continuously so data isn't lost even without a manual save.

---

## Chat panel / AI

### 🟠 [B-045] AI failures during a 3-attempt agentic loop swallow the underlying error from the user ✅ FIXED
**Where:** `core/frontend/components/ChatPanel.tsx:59-97`
**Observed:** On final failure user sees "I'm sorry, I was unable to generate a valid response after a few attempts." The actual `error.message` is appended to the *next* prompt as feedback but never shown.
**Expected:** Append the last error to the failure message, optionally collapsible.
**Fix:** `lastError` variable tracks the last caught error message in the loop. The failure message now includes `\n\nLast error: ${lastError}` when available.

### 🟠 [B-046] `onKeyPress` is deprecated and won't fire for IME composition correctly ✅ FIXED
**Where:** `core/frontend/components/ChatPanel.tsx:103-105,121`
**Notes:** Use `onKeyDown` and check `e.isComposing`.
**Fix:** Renamed `handleKeyPress` → `handleKeyDown`, using `onKeyDown` event handler and checking `e.nativeEvent.isComposing` to avoid firing during IME composition.

### 🟡 [B-047] Reset Conversation button drops context but the AI provider doesn't know — long-context Local provider keeps conversation in its own KV cache
**Where:** `core/frontend/components/ChatPanel.tsx:35-38`
**Notes:** Mostly a non-issue since each request resends the full history; flag for the future if streaming is added.

### 🟡 [B-048] Chat input is disabled while loading but no Cancel button — a runaway 60s local-AI request blocks the panel ✅ FIXED
**Where:** `core/frontend/components/ChatPanel.tsx:121`
**Notes:** While loading, the Send button swaps to a red Cancel (×) button. `handleCancel` sets `cancelledRef.current = true`; the agentic loop checks this flag each iteration and skips the final message if cancelled.

---

## Performance

### 🟠 [B-049] Schema `combinedSchema` recreates regexes on every render (within useMemo, fine), but `createSqlOverlay` is called inside another `useEffect` with `[combinedSchema, mode]` deps — every metadata change rebuilds and re-attaches the overlay, redrawing the whole editor ✅ FIXED
**Where:** `core/frontend/components/SQLEditor.tsx:271-293`
**Notes:** `combinedSchema` now depends on stable `metaViewsKey`/`metaMacrosKey` (JSON.stringify of name+sql arrays), so the overlay is only recreated when view/macro definitions actually change, not on every metadata object-reference churn.

### 🟠 [B-050] `useEffect([cell.content])` re-tokenizes the cell every parent re-render ✅ FIXED (via B-026 + B-049)
**Where:** `core/frontend/components/NotebookCell.tsx:104`
**Notes:** B-026 switched to position-based IDs (string comparison, not reference); B-049 fixed the overlay rebuild. Cell content tokenization only fires when the content string value actually changes.

### 🟡 [B-051] DataTable / PlotRenderer render full result rows even when result is e.g. 100k rows
**Where:** `core/frontend/components/DataTable.tsx`, `PlotRenderer.tsx`
**Notes:** Not measured, but JFR queries on 178 tables can return huge result sets quickly.

### 🟡 [B-052] Row-count query on schema fetch is one giant `UNION ALL` over 178 tables
**Where:** `core/frontend/context/DuckDBContext.tsx:203-208`
**Notes:** Works for default.jfr but on a slow WASM/server probably blocks first paint for noticeable time. Consider lazy / on-hover counting.

---

## Other UX

### 🟠 [B-053] `shadow-2xl shadow-cyan-900/20` and dozens of similar inline class strings are duplicated everywhere — but more concretely, dark-mode is the only mode and several text colors fail WCAG AA on dark gray (e.g. `text-gray-500` on `bg-gray-800/50`).
**Where:** Multiple components (`Sidebar.tsx`, `NotebookCell.tsx`, etc.)

### 🟠 [B-054] `aria-label`/role missing on most buttons — only `title` is set
**Where:** Globally
**Notes:** Screen readers only get the title attr if at all.

### 🟠 [B-055] Drag-and-drop cell reorder uses native HTML5 DnD with no keyboard fallback
**Where:** `core/frontend/components/NotebookCell.tsx:307-309`

### 🟠 [B-056] Plot tooltip hides itself with a 200ms timeout that resets on `mousemove`, so moving across two adjacent tokens flickers the tooltip in/out ✅ FIXED
**Where:** `core/frontend/components/SQLEditor.tsx:296-388`
**Notes:** Hide delay increased from 200ms to 400ms so the next `mousemove` (which clears the timeout) fires before the tooltip disappears when moving between adjacent tokens.

### 🟡 [B-057] `Notebook.tsx` raw-markdown editor renders the entire notebook in one CodeMirror instance with no virtualization
**Where:** `core/frontend/components/Notebook.tsx:45-58`
**Notes:** For multi-thousand-line notebooks the SQLEditor's regex overlay (B-049) becomes pathological.

### 🟡 [B-058] Mode badge always reads "WASM" or "Server" but never indicates *connection health* — if the backend dies mid-session, the badge stays green ✅ FIXED
**Where:** `core/frontend/App.tsx:361-372`
**Notes:** Badge now shows red with ⚠ prefix when `errorMessage` is non-null, green for healthy Server mode, and cyan for WASM. The tooltip shows the error message on hover.

### 🟡 [B-059] `confirm`-less Trash icons everywhere ✅ FIXED (cell delete)
**Where:** `Sidebar.tsx`, `SettingsPanel.tsx`, `NotebookCell.tsx`
**Observed:** Click a trash icon → cell or view is gone. Undo *does* exist but isn't obvious.
**Fix:** Cell delete button now calls `window.confirm('Delete this cell?')` before invoking `onDelete`. View/macro delete in SettingsPanel and Sidebar remain without confirm (they're reversible via front-matter revert).

### 🟡 [B-060] `AddCellFromAI` builds segment with two consecutive `markdown` separators, which works because `reconstructCellContent` joins on `''`, but if those segments ever get filtered the structure breaks
**Where:** `core/frontend/App.tsx:212-227`

### 🟡 [B-061] `ToastNotification` has no auto-dismiss timer ✅ ALREADY FIXED
**Where:** `core/frontend/components/ToastNotification.tsx`
**Notes:** A persistent "AI features disabled" toast can sit in the corner for the entire session.
**Status:** The component already has `duration = 8000` default and calls `onClose()` after the timer. Toast also gained a configurable `title` prop (added during B-063 fix) to avoid the hardcoded "AI Assistant Alert" label.

### 🟡 [B-062] No way to hide internal views in the *Custom Views* SettingsPanel section, but internal views aren't shown there anyway — minor naming confusion: "Custom Views" vs Sidebar's "Views" (which mixes built-in + custom)

---

## Environment / startup

### 🟠 [B-063] Probe-server logic POSTs `SELECT 1` to `/api/query` and falls back to WASM if it fails — but a 405/CORS response from a generic static server returns "not ok" silently and the user just sees the JFR drop zone with no explanation ✅ FIXED
**Where:** `core/frontend/context/DuckDBContext.tsx:92-105,232-254`
**Notes:** Add a "Falling back to WASM mode (server probe failed: …)" toast.
**Fix:** `probeServer` now returns `{ ok, reason? }`. On fallback, `serverProbeError` is set in context and exposed to consumers. `App.tsx` shows a `ToastNotification` ("Running in WASM mode — server probe failed: [reason]") that auto-dismisses after 12 s and can be manually closed. `ToastNotification` gains an optional `title` prop to avoid the hardcoded "AI Assistant Alert" label.

### 🟠 [B-064] `process.env.GEMINI_API_KEY` etc. are read in client code ✅ BY DESIGN
**Where:** `core/frontend/components/SettingsModal.tsx:124-129`
**Notes:** Vite injects these at build time via `define` in vite.config.ts. Rotating an env var requires a rebuild. This is the standard Vite pattern for SPA apps; WONTFIX unless the deployment model changes to a server that can inject vars at runtime.

### 🟡 [B-065] CodeMirror is loaded from cdnjs, not bundled — offline use is impossible
**Where:** `core/frontend/index.html:14-20`

### 🔴 [B-066] Cell h2 title always shows "Introduction" instead of the `## Heading` from the cell's markdown ✅ FIXED
**Where:** `core/frontend/components/NotebookCell.tsx:156`
**Repro:** Load the GC Analysis Notebook template. All cell titles in the header bar show "Introduction".
**Root cause:** `const title = parsed.introduction?.title || cell.title` — `parsed.introduction.title` is always the hardcoded dummy string `'Introduction'` (set in `parseCellContent:311`), which shadows `cell.title` (always `''` from App.tsx). The actual title extracted from `## Heading` was stored in `parsed.title` but never used.
**Fix:** Changed to `const title = parsed.title || cell.title` so the `## Heading` extracted by `parseCellContent` is used directly.

### 🔴 [B-067] GC analysis views used `epoch(DOUBLE)` which is not a valid DuckDB overload ✅ FIXED
**Where:** `core/src/main/java/me/bechberger/jfr/duckdb/definitions/ViewCollection.java` — gc-efficiency, gc-throughput, gc-overhead views
**Repro:** Server fails to start when new GC views are loaded: `epoch(DOUBLE) has no matching overload`.
**Root cause:** `sumOfPauses` in `GarbageCollection` is a DOUBLE (seconds) not an INTERVAL/TIMESTAMP. `epoch()` requires a temporal type.
**Fix:** Replaced `epoch(sumOfPauses)` with bare `sumOfPauses` (already in seconds) and `epoch(g.sumOfPauses)` with `g.sumOfPauses`.

### 🔴 [B-068] `heap-summary-over-time` view used bare `when` keyword causing DuckDB parse error ✅ FIXED
**Where:** `core/src/main/java/me/bechberger/jfr/duckdb/definitions/ViewCollection.java:1440`
**Repro:** Server fails to start: "syntax error at or near 'when'".
**Root cause:** `when AS "When"` in SELECT — `when` is a reserved SQL keyword that must be quoted when used as a bare column name.
**Fix:** Changed to `"when" AS "When"`. Also fixed `before.when` → `before."when"` in gc-efficiency JOIN conditions.

### 🔴 [B-069] `heap-committed-vs-used` and `heap-summary-over-time` referenced `heapCommitted` which doesn't exist in `GCHeapSummary` ✅ FIXED
**Where:** `core/src/main/java/me/bechberger/jfr/duckdb/definitions/ViewCollection.java:1441,1462`
**Root cause:** `GCHeapSummary` only has `heapUsed`; `heapCommitted` does not exist as a flat column.
**Fix:** Removed `heapCommitted` from both views. `heap-committed-vs-used` now shows `"Used MB"` and `"Phase"` (before/after GC). Template updated to use single-column `y: ["Used MB"]` array.

### 🟠 [B-070] `allocation-rate` and `allocation-by-class-detail` views referenced `ObjectAllocationInNewTLAB` which is absent in default recordings ✅ FIXED
**Where:** `core/src/main/java/me/bechberger/jfr/duckdb/definitions/ViewCollection.java:1483,1506`
**Root cause:** Default JFR recordings use `ObjectAllocationSample` (sampled), not `ObjectAllocationInNewTLAB` (requires profiling JFC).
**Fix:** Rewrote both views to use `ObjectAllocationSample` with its `weight` column. Column name updated from `"TLAB MB/s"` to `"Sample MB/s"`. GC template updated to match.

---

## Investigated but NOT a bug

- **Variable substitution `$&`/`$1` injection** — `variableSubstitution.ts` correctly uses the function-form replace, so user-supplied values containing `$&` or `$1` cannot be miscaptured. Good.
- **AsyncLock around remote+wasm queries** — `DuckDBContext.tsx:9-37` correctly serializes; no double-acquire bug seen.
- **Front-matter parser quote-stripping** — single-quote escape `''` round-trip works in both directions.
- **`tokenizeCellContent` regex `(```(?:sql|plot|variables))([\s\S]*?)(```)` ungreedy match** — does the right thing, no nested-fence issue because none of these blocks contain triple backticks.
- **`useEffect` cleanup in NotebookCell auto-run** — explicitly resets `prevSqlBlocksRef.current = []` to handle React StrictMode (memory file `feedback_react_strictmode_debounce_stale_refs.md` documents this); appears correct.
- **Bigint conversion in WASM query results** — converting via `Number()` loses precision for >2^53 but JFR data rarely exceeds that; acceptable trade-off.

---

## Plot DSL autocomplete pipeline

### 🔴 [B-071] Browser-mode plot ghost-text is a no-op — `BrowserModelProvider` has no `stream()` method
**Where:** `services/ai/BrowserModelProvider.ts`; `components/editor/plot/aiPlotSource.ts:84-100`
**Repro:** Set provider to local/ONNX model, focus a plot editor. Wait for debounce (300 ms).
**Observed:** `aiPlotAutocompleteExtension` calls `deps.stream(system, user, signal, 'browser')`. `AiService.stream()` routes to `BrowserModelProvider.stream()`. That method does not exist on `BrowserModelProvider` — only `getSuggestPlot()` and `getInlineSuggestion()` are defined. Result: runtime `TypeError: deps.stream is not a function` or `TypeError: provider.stream is not a function`, so the entire ghost-text overlay is silently dead for local models.
**Expected:** Either (a) add a `stream(system, user, signal)` wrapper to `BrowserModelProvider` that calls `getSuggestPlot()` and yields its output, or (b) add a separate non-streaming code path in `aiPlotAutocompleteExtension` for 'browser' model routing.
**Notes:** `getSuggestPlot()` already returns a `Promise<string>` via `PlotGenerationService` — the bridge is one thin adapter.

### 🔴 [B-072] `aiPlotContext.ts` SYSTEM_PROMPT references DSL clauses that do not exist in the parser or plot registry
**Where:** `components/editor/plot/aiPlotContext.ts:1-40` (hardcoded SYSTEM_PROMPT string)
**Observed:** The prompt documents `LEGEND AT RIGHT|LEFT|TOP|BOTTOM|NONE`, `PALETTE "name"`, `AXIS-X DOMAIN [a,b]`, `BRUSH "$var" MODE X|Y|XY`, `ON HOVER TOOLTIP`, and `ON CLICK NAVIGATE`. None of these are valid tokens in `parser.ts`, none appear in `plotRegistry.ts`, and none are handled in `lint.ts` or `derive.ts`.
**Expected:** AI-generated suggestions matching the real DSL: `TITLE`, `SUBTITLE`, `WIDTH`, `HEIGHT`, `ZOOM`, `ON`, `LINK-X/Y/XY`, `LINK-SCROLL`, `DISABLED`, `NAME`, `#queryRef`, `LET`.
**Impact:** Every AI-generated plot suggestion will contain hallucinated clauses that the parser will flag as errors and the renderer will silently drop. Worse, the linter will fire `unknown-tail-keyword` on every AI suggestion, making it appear broken.
**Fix:** Rewrite SYSTEM_PROMPT to list only the tail keywords returned by `UPPERCASE_TAIL_KEYWORDS` in `parser.ts` and the actual shape registry from `plotRegistry.ts`.

### 🔴 [B-073] `findColumn` / `findColumns` in `plotUtils.ts` pass a regex pattern as a string literal
**Where:** `utils/plotUtils.ts:78-100` (exact lines vary; the `findColumn` and `findColumns` functions)
**Repro:** Use a multi-query plot result whose columns are prefixed `0_`, `1_`, etc. (e.g. `LINE_CHART(x: "0_time", y: "0_value")`).
**Observed:** `findColumn(col, allColumns)` builds the pattern `` `^\\d+_${escaped}$` `` as a template literal string and passes it to `.match(pattern)`. `String.prototype.match(string)` coerces its argument via `new RegExp(string)` — but the template literal produces `^\d+_colName$` which is `new RegExp("^\\d+_colName$")` = `/^\d+_colName$/`. Wait — that actually works because `\\d` in a JS string is the two-character sequence `\d`, which `new RegExp` then interprets as the digit class.
**Corrected finding:** The fallback pattern at line ~81 that tries `` `^\\d+_${escaped}` `` DOES work via string→RegExp coercion. However, the regex is constructed with `escaped = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` — if `col` already contains backslash (which DuckDB column names can via STRUCT dot-notation), the double-escaping breaks the match. Additionally, there is no `i` flag, so column name matching is case-sensitive even though DuckDB identifiers are case-insensitive by default.
**Expected:** Use `new RegExp(...)` explicitly, add `i` flag, and test with STRUCT-derived column names like `thread.name`.

### 🟠 [B-074] `supportsMultiQuery: true` is declared on four plot types but multi-query dispatch is never implemented in the renderer
**Where:** `components/plots/plotTypes.ts` (`supportsMultiQuery` field); `components/plots/LineChartPlot.tsx`, `BarChartPlot.tsx`, `AreaChartPlot.tsx`, `PieChartPlot.tsx`; `components/PlotRenderer.tsx`
**Observed:** `PlotRegistration` has `supportsMultiQuery?: boolean`. Four registrations set it `true`. The `#queryRef` ON syntax in `parser.ts` can reference multiple SQL blocks by index. `derive.ts` extracts `on: [...]` from the AST. But `PlotRenderer` receives a single `data: any[]` prop and passes it straight to the component — there is no fan-out, no per-query result dispatch, no `data[queryIndex]` lookup.
**Expected:** When a plot's `on` list has multiple query refs, `PlotRenderer` should receive `dataByQuery: Record<string, any[]>` and dispatch each column-group to the component accordingly, or the component should receive the full combined result with index-prefixed columns.
**Impact:** `LINE_CHART(x: "time", y: "latency") ON #q1 ON #q2` silently renders only the data from the first query; the second is dropped with no warning.

### 🟠 [B-075] Plot AI context budget silently drops prior cells when over 3 072 tokens without any user notification
**Where:** `components/editor/plot/aiPlotContext.ts:buildPlotAiContext()`
**Observed:** `BUDGET = 3072`. Prior cells are trimmed FIFO when over budget. The result is passed directly to `stream()`. There is no indication in the editor that context was trimmed; the AI completion simply omits the trimmed cells' context.
**Expected:** Return a `trimmed: boolean` flag from `buildPlotAiContext()` and surface it as a subtle status indicator in the plot editor toolbar (e.g. "context trimmed").

### 🟠 [B-076] Plot scope `extractPlotMetadata()` only parses the first `PlotCall` in a script — composite plots lose all but the first element's metadata
**Where:** `components/editor/plot/notebookPlotScope.ts:extractPlotMetadata()`
**Observed:** `parseScript()` may return a `composite` node wrapping multiple plot calls. `extractPlotMetadata` calls `parsedResult.plots[0]` or similar and only processes the first. Named plots inside a composite script (`NAME "myPlot"` tail on the second call) are not registered in `PlotScopeView.namedPlots`.
**Expected:** Walk all top-level calls in the script, or recurse into composite nodes, to register every named plot.

### 🟠 [B-077] `PlotSchemaDiscovery` caches results by SQL string but never invalidates on DuckDB schema change (e.g., after `CREATE VIEW`)
**Where:** `components/editor/plot/schemaProvider.tsx:PlotSchemaDiscovery`
**Observed:** Column schema is fetched via `DESCRIBE (sql)` and cached. If a preceding SQL block creates a new view or temp table that the plot's SQL `FROM`s, the cache may return stale column info until the component unmounts and remounts.
**Expected:** Invalidate on `onSchemaChange` event (already used elsewhere in the app) or accept a schema-version counter as a cache-bust key.

### 🟠 [B-078] `annotateColumns` only checks columns in `DEFAULT_COLUMN_CLAUSES` — custom plot shapes with non-standard clause names get no column validation or suggestions
**Where:** `components/editor/plot/annotators/columnAnnotator.ts:DEFAULT_COLUMN_CLAUSES`
**Observed:** `DEFAULT_COLUMN_CLAUSES = ['x','y','y2','color','size','group','frame','value','name','start','end','min','max','columns']`. A plot like `GANTT_CHART` uses `start` and `end` (covered), but a hypothetical custom shape with clause `series:` or `bucket:` would never have its column idents annotated or validated.
**Expected:** The annotator should consult the shape's registered `params` (from `PlotRegistration.params`) to determine which clauses are of `type: 'column'`, rather than hardcoding a list.

### 🟠 [B-079] `lint.ts` `closestMatch` has a hard cap of Levenshtein distance 2, so misspellings of long names (e.g. `HISTOGARM` → `HISTOGRAM`) return no match
**Where:** `components/editor/plot/lint.ts:closestMatch()`
**Observed:** `closestMatch('HISTOGARM', shapeNames)` — edit distance to `HISTOGRAM` is 2 (swap `R` and `M`). That's within the cap. But `closestMatch('SCATER_PLOT', shapeNames)` — distance to `SCATTER_PLOT` is 2. Also within cap. However `closestMatch('LIEN_CHART', ...)` — distance to `LINE_CHART` is 2 (swap). Still within cap.
**Revised finding:** The cap of 2 is actually reasonable for short names but fails for multi-word names like `GANTT_CHART` where a user types `GANT_CHART` (distance 1 — fine) vs. `GANTTCHART` (distance 1 — fine). Real failure case: `AREACHART` → `AREA_CHART` (distance 1) — works. `BARCHART` → `BAR_CHART` (distance 1) — works. The real problem is for very long shape names where a 3+ edit distance typo gives no suggestion at all and the user gets only "Unknown shape; did you mean: (none)".
**Expected:** Scale the allowed distance by `Math.max(2, Math.floor(name.length / 5))` or always suggest the closest regardless of distance if it's < 40% of the name length.

### 🟡 [B-080] Plot linter rule `unknown-column` fires on `$variable` column references even though variables are valid placeholders
**Where:** `components/editor/plot/lint.ts` unknown-column rule; `components/editor/plot/annotators/columnAnnotator.ts`
**Observed:** If a user writes `LINE_CHART(x: $xCol)` where `$xCol` is a variable holding a column name string, the `columnAnnotator` sees an ident node `$xCol`, cannot find it in `scope.lookupColumn()`, and the linter fires `unknown-column: "$xCol"`.
**Expected:** The column annotator should skip resolution for ident nodes that start with `$` (variable references), since their value is only known at runtime after variable substitution.

### 🟡 [B-081] `schemaProvider.tsx` feature flag `plotSchemaDiscoveryEnabled` defaults to `false` — column type inference silently off unless the flag is set
**Where:** `components/editor/plot/schemaProvider.tsx` (feature flag check)
**Observed:** `PlotSchemaProvider` wraps column discovery behind `plotSchemaDiscoveryEnabled`. If this flag is false (the default), the annotator receives no columns, so `annotateColumns` finds nothing to validate, and the linter never fires `unknown-column` even for genuine typos.
**Expected:** Either enable by default or document prominently in UI that column validation requires the feature flag.

### 🟡 [B-082] Plot editor debounce has no `timeout` reference — calling `clearTimeout` on undefined is a no-op, so rapid edits queue multiple lint/schema-discovery passes
**Where:** `components/NotebookCell.tsx:75` (debounce utility call in plot editor area)
**Observed:** The debounce call does not capture the return value of `setTimeout`, so `clearTimeout(undefined)` in the cleanup has no effect. This causes the lint callback to fire once per keystroke after the delay, not once per idle period.
**Expected:** Capture the timeout id: `const tid = setTimeout(...); return () => clearTimeout(tid);`

---

## AI chat integration

### 🔴 [B-083] Chat panel has no per-feature model selector — the model choice in `SettingsModal` is global and cannot be overridden per-chat or per-inline-suggestion
**Where:** `components/ChatPanel.tsx`; `components/SettingsModal.tsx`
**Observed:** A single `provider` / `model` setting applies to both the chat panel and the inline plot ghost-text. There is no way to say "use GPT-4o for chat but GPT-4o-mini for inline suggestions". The `'cloud-tiny'` hint in `aiPlotSource.ts:84` is a hardcoded string that may or may not map to the user's configured provider.
**Expected:** Expose a model selector in the chat panel header (at minimum for the chat conversation) and an independent model selector for inline autocomplete in settings.

### 🔴 [B-084] `isForbiddenSql()` only checks for the token `$ai_providers` — a user can bypass it with quoted identifier `"$ai_providers"` or `[$ai_providers]`
**Where:** `services/ai/tools/runtime.ts:isForbiddenSql()`
**Observed:** `isForbiddenSql(sql)` does a simple string `includes('$ai_providers')`. A query like `SELECT * FROM "$ai_providers"."openai"` passes the check if the identifier is quoted and DuckDB's parser normalises it.
**Expected:** Also reject `"$ai_providers"` (double-quoted form) and check via regex: `/\$ai_providers|\"\$ai_providers\"/i`.

### 🟠 [B-085] Chat tool `runQuery` enforces a 100-row limit but `sampleRows` also hard-caps at 100 — there is no way for the AI to page through large result sets
**Where:** `services/ai/tools/runtime.ts:executeTool()` cases `runQuery` and `sampleRows`
**Observed:** Both tools silently truncate at 100 rows. The AI has no mechanism to request `OFFSET n LIMIT 100` on the next page. For large result sets (e.g., all GC events) the AI only ever sees the first 100 rows and may draw incorrect conclusions.
**Expected:** Either expose a `page`/`offset` parameter, or let the AI write its own pagination with `LIMIT`/`OFFSET` in the SQL (currently allowed but must be within the 100-row cap, so offset is useless).

### 🟠 [B-086] `visibility.ts` `sanitized` mode computes top-3 distinct string values via `Array.from(new Set(...))` over the entire result array in JS — O(n) per column, runs synchronously in the render thread
**Where:** `services/ai/visibility.ts:buildContextPayload()` sanitized branch
**Observed:** For a result set with 50 000 rows and 10 string columns, computing distinct counts means iterating 500 000 items before returning. This happens synchronously in the chat panel's context builder.
**Expected:** Compute statistics via a DuckDB query (`SELECT col, COUNT(*) FROM result GROUP BY 1 ORDER BY 2 DESC LIMIT 3`) or defer to a Web Worker.

### 🟡 [B-087] `plotSuggestOfflineOnly: true` setting throws `AiOfflineEnforcedError` with no heuristic fallback — the auto-plot feature is completely broken in air-gapped mode
**Where:** `services/ai/AiService.ts` (offline enforcement); `services/ml/heuristicPlot.ts`
**Observed:** When `plotSuggestOfflineOnly=true` and the active provider requires network access, `AiService` throws rather than falling back to `heuristicPlot()`. The ONNX-based `PlotGenerationService` is the intended offline path, but when that model is not loaded (cold start), there is no further fallback to the rule-based `heuristicPlot`.
**Expected:** Fallback chain: ONNX model → `heuristicPlot` → default `TABLE()`. Never throw to the user in auto-plot mode.

---

## Local ML / auto-plot selection

### 🔴 [B-088] `PlotGenerationService` seq2seq model requires `decoder_model_merged.onnx` under `onnx/` but the loader silently 404s when the file is missing
**Where:** `services/ml/PlotGenerationService.ts` (Transformers.js model load path)
**Observed:** Transformers.js seq2seq pipelines expect the merged decoder artifact at `<modelDir>/onnx/decoder_model_merged.onnx`. If the file does not exist (e.g., first-run or partial download), the loader returns a 404 that is caught and swallowed, leaving `modelReady = false` indefinitely. No user-visible error or retry.
**Expected:** Surface the 404 as a warning toast: "Local plot model not found — using rule-based fallback". Log the exact path that was tried.

### 🟠 [B-089] `heuristicPlot` priority ladder does not distinguish `AREA_CHART` (stacked) from `LINE_CHART` for time+multiple-numeric case — stacked area is chosen even when values represent independent series
**Where:** `services/ml/heuristicPlot.ts:heuristicPlot()`
**Observed:** When columns include a time column + 3 or more numeric columns, `heuristicPlot` returns `AREA_CHART(stacked: true, ...)`. This is often wrong when numerics are independent metrics (e.g., `heapUsed`, `gcDuration`, `threadCount`) rather than parts of a whole.
**Expected:** Only choose stacked area when the numeric columns sum to a meaningful total (e.g., the column names contain "allocated", "freed", "committed" patterns). Otherwise prefer `LINE_CHART`.

### 🟠 [B-090] `classifyColumns()` treats any column named `startTime` as `time` category, but for allocation events `startTime` is in nanoseconds (BIGINT), not a TIMESTAMP — the type check is skipped when name-matching wins
**Where:** `services/ml/classifyColumns.ts:classifyColumns()`
**Observed:** `classifyColumns` checks DuckDB type first; if type is NUMERIC (BIGINT) and name matches `TIME_NAMES_RE`, it still returns `time`. But `looksLikeStartName()` matches `startTime` and `start_time`. A BIGINT nanosecond epoch is treated as a time column, which causes `heuristicPlot` to select `LINE_CHART(x: "startTime")`. Recharts then renders the raw nanosecond integer on the X axis — no formatting, no human-readable time.
**Expected:** For BIGINT columns matching time-name patterns, add a `rawNanos: true` annotation and format X axis labels accordingly (divide by 1e9 → seconds, then use the recording start as epoch offset).

### 🟡 [B-091] `classifyColumns()` `DURATION_NAMES_RE` check prevents `duration` columns from being classified as `time`, but `gcDuration` in nanoseconds then becomes `numeric` — `heuristicPlot` may choose it as a Y axis, producing an unformatted nanosecond scale
**Where:** `services/ml/classifyColumns.ts`; `services/ml/heuristicPlot.ts`
**Observed:** `gcDuration` (a DOUBLE in seconds or BIGINT in nanoseconds, depending on the view) is classified `numeric`. When it becomes a Y axis in `LINE_CHART`, the chart shows raw values (e.g., 1 234 567 890) with no unit suffix.
**Expected:** `PlotRegistration` components should check if the column name ends in `Duration`/`_ns`/`Nanos` and auto-format the Y axis label as milliseconds or seconds.

---

## Date/time selectors

### 🔴 [B-092] `FilterModal` receives `recordingStart`/`recordingEnd` as static props — date range slider is not bounded to actual data in the loaded JFR file
**Where:** `components/FilterModal.tsx`; callers in `App.tsx` or `NotebookCell.tsx`
**Observed:** `FilterModal` receives `recordingStart: number` and `recordingEnd: number` as props. These must be computed by the caller. If the caller hardcodes them or derives them from metadata (not from a live DuckDB query), the slider's min/max are wrong — the user may drag the slider to a range that contains no events at all, or the slider spans only part of the recording.
**Expected:** `FilterModal` (or the component managing it) should run `SELECT MIN(startTime), MAX(startTime) FROM jdk_ExecutionSample` (or the primary events table) to derive the actual data bounds, and pass those as `recordingStart`/`recordingEnd`. Default selection: full range.

### 🟠 [B-093] `RangeSlider` has no keyboard input — users cannot type precise nanosecond timestamp values
**Where:** `components/RangeSlider.tsx`
**Observed:** Both range thumbs are `<input type="range">` only. There is no text field override. For JFR analysis where the user may want to inspect a 100ms window in a 10-minute recording (nanosecond precision), dragging to the correct position is practically impossible.
**Expected:** Add two text inputs alongside (or as click-to-edit overlays on) the thumb labels, accepting ISO datetime strings or raw nanosecond integers. Validate and clamp on blur.

### 🟡 [B-094] `RangeSlider` thumb labels overlap when `minVal` and `maxVal` are very close (e.g., < 1% of range apart)
**Where:** `components/RangeSlider.tsx` (label positioning via `left: ${getPercent(val)}%`)
**Observed:** Both labels are positioned at `left: X%` where X is very close. No collision avoidance exists, so labels render on top of each other.
**Expected:** When `abs(getPercent(maxVal) - getPercent(minVal)) < 8`, offset the labels vertically or pin them to opposite sides of their respective thumbs.

---

## SQL autocomplete (CodeMirror 6 dispatcher)

### 🟠 [B-095] SQL autocomplete dispatcher returns `null` (no completions) when no schema is loaded — no fallback keyword list during app startup
**Where:** `components/editor/sql/dispatcher.ts:103-104`
**Observed:** `dispatcher.ts` returns `null` when the schema has not yet loaded AND the token does not start with an already-known prefix. During the first few seconds of app startup (before DuckDB finishes loading the JFR) or after a schema fetch failure, Ctrl-Space produces no completions at all — not even SQL keywords like `SELECT`, `FROM`, `WHERE`.
**Expected:** Always return at least the SQL keyword list as a fallback, even when schema is unavailable.

### 🟠 [B-096] Cross-cell CTE and view references are not surfaced in SQL autocomplete
**Where:** `components/editor/sql/providers/symbols.ts:cteProvider`
**Observed:** `cteProvider` only searches `ctx.scope.listCtes()` which covers CTEs defined in the current query block. Views and CTEs created in preceding SQL cells (e.g., `CREATE VIEW myView AS ...`) are not included in the suggestion list, even though they are accessible in the DuckDB session.
**Expected:** Walk preceding cell SQL results (already tracked in `collectPrecedingCellVariables`) to extract `CREATE VIEW / CREATE TABLE / WITH` aliases and offer them as completions.

---

## Misc / previously noted

### 🟠 [B-097] Plot registry coverage test expects 12 keys but registry now has 13 entries (`FLAME_GRAPH` alias added)
**Where:** `components/plots/plotRegistry.ts:24`; corresponding test file
**Observed:** `FLAME_GRAPH: flameGraphPlot` alias was added as a comment-noted entry. Any test asserting `Object.keys(plotRegistry).length === 12` now fails.
**Expected:** Update test expectation to 13, or use `Object.values` dedup count (which remains 12 unique registrations).

### 🟠 [B-098] `handleCommitBlockName` strips `-- comment` suffixes from SQL block names — SQL blocks whose names naturally contain `--` are silently truncated
**Where:** `components/NotebookCell.tsx` (handleCommitBlockName)
**Observed:** The function splits on `--` to strip comments, but SQL block names are free-form strings that could legitimately contain `--` (e.g., `-- main query`). Any name containing `--` is truncated at the first occurrence.
**Expected:** SQL block name editing should treat `--` as a literal character in the name, not as a comment delimiter, since block names are not SQL.

### 🟠 [B-099] `collectPrecedingCellVariables` returns variables from ALL cells when the current cell ID is not found in the cells array
**Where:** `components/NotebookCell.tsx` (collectPrecedingCellVariables utility)
**Observed:** When `cells.findIndex(c => c.id === currentCellId)` returns -1 (cell not yet registered or stale ID), the function falls through and returns variables from all cells including the current one. This causes unexpected variable shadowing and can expose cell-private variables to other cells.
**Expected:** Return an empty map (or throw) when the current cell cannot be located.

### 🟠 [B-100] `variableUsage` in `NotebookCell.tsx` indexes plot blocks by sparse array position rather than contiguous index, causing `plotErrors[i]` to misalign when SQL blocks precede plot blocks
**Where:** `components/NotebookCell.tsx` (variableUsage or plotBlocks indexing)
**Observed:** `parsedContent.plotBlocksWithSqlIndex` contains objects with `.segmentIndex` which is the raw position in `segments[]`. `plotErrors` is indexed 0…N in order of plot blocks. When `plotErrors[block.segmentIndex]` is used instead of the contiguous plot-block index, any segment index > number of plot blocks results in `undefined`.
**Expected:** Use the plot-block's positional index (0, 1, 2…) in all error/result arrays, not its raw segment index.

---

## Provider / AI service wiring

### 🔴 [B-101] `getModelFor` excludes `anthropic` from its `validProviders` map — model resolution always throws `Unknown AI provider: anthropic` at runtime
**Where:** `services/AiService.ts:216-221`
**Observed:** `validProviders = { google: true, openai: true, gardener: true, local: true, browser: true }`. The key `'anthropic'` is absent. Calling any `getAiAgentResponse`, `getAiInlineSuggestion`, etc. while `settings.aiProvider === 'anthropic'` immediately throws. The Anthropic provider is initialized correctly by `providerFactoryRegistry` and `providerRegistry` (lines 48, 63) — only the model-tier lookup breaks.
**Expected:** Add `anthropic: true` to `validProviders`, and add `anthropicTinyModel`, `anthropicBasicModel`, `anthropicGoodModel` settings keys so the tier lookup resolves to the user's configured model.
**Notes:** The `AnthropicProvider` does define `defaultModels` in `getMetadata()` — those are never consulted because `getModelFor` throws first.

### 🔴 [B-102] `streamChatWithTools` uses `buildContextPayload` as the `systemInstruction` — the schema description lands where the system prompt should be, but it contains no instructions on HOW to respond (no role, no guidelines, no tool use guidance)
**Where:** `services/AiService.ts:451-456`
**Observed:** `const systemInstruction = buildContextPayload(opts.visibility, schema, opts.recentResult, ...)`. `buildContextPayload` returns only a schema + data block — it has no role declaration, no behavioral guidelines, and no tool-calling instructions. The cloud provider receives this as the `system` message. The chat panel's separate `getAiAgentResponse` path builds a rich `systemInstruction` at line 275 with guidelines and a role; `streamChatWithTools` does not.
**Expected:** The `streamChatWithTools` system instruction should include a role ("You are an expert DuckDB analyst…"), the schema/data block, plotting docs, and tool-use instructions. Currently the model in tool-chat mode has no guidance on what to do with the tools.

### 🟠 [B-103] All providers implement `streamChatWithTools` as a single-round non-streaming call (no actual SSE/chunking) — the "streaming" interface is a polyfill that yields the complete response as one chunk after full wait
**Where:** `services/ai/AnthropicProvider.ts:190-228`; `services/ai/OpenAiProvider.ts:167-203`; `services/ai/GardenerProvider.ts:161-214`; `services/ai/GeminiProvider.ts:208-232`
**Observed:** Every provider's `streamChatWithTools` calls `.json()` on the completed response (not `.text()` with streaming) and emits one or two `yield` statements at the end. There is no SSE parser, no `ReadableStream` consumption. Anthropic supports streaming via `stream: true`; OpenAI supports it via `stream: true`; neither is used here.
**Impact:** Tool-call round-trips incur full model latency per round (up to 60s) with no progress indicator. The cancel button has no effect until the `fetch()` call resolves (the `signal` is passed but `fetch` holds it until the response body is complete). For 10-round orchestration loops this is up to 600s with no UI feedback.
**Expected:** Use SSE streaming at minimum for the chat `streamChatWithTools` path.

### 🟠 [B-104] `LocalAiProvider.streamChatWithTools` does not pass `stream: false` in `buildBody()` override — if the local server responds with SSE the response body is read as a single `.json()` call and throws
**Where:** `services/ai/LocalAiProvider.ts:248-266`
**Observed:** `streamChatWithTools` calls `this.sendWithRetry(body)` with `body` built from `buildBody()` which sets `stream: false`. That's correct for the text call. But `sendWithRetry` calls `response.json()` — if the user accidentally toggles streaming on the server or the body-spreading `...this.buildBody(model, wireMessages)` stomps a key, the json parse fails silently.
**Revised finding:** The actual risk is that `buildBody` returns `{ stream: false }` but `streamChatWithTools` spreads it into `body: any = { ...this.buildBody(model, wireMessages) }`. The `tools` field is then set separately. This is structurally fine, but the `wireMessages` passed to `buildBody` already includes all messages — there is no separate system-message prepend for the tool `systemInstruction`. The system instruction from `opts.systemInstruction` is correctly added at line 225-227, but this means it appears as the FIRST message only if `wireMessages` is still empty at that point. Since `wireMessages` starts empty, the system message is prepended correctly. Low risk.
**Actual bug:** If `tools.length === 0`, no `tools` key is set, which is correct. But `parseLocalToolCalls` is still called on every response even when no tools were offered — if the model halluccinates a `<tool>` tag in a normal response, it is incorrectly parsed as a tool call.

### 🟡 [B-105] `LocalAiProvider` retry loop uses `await new Promise(r => setTimeout(r, backoff))` inside a `for` loop — the outer `AbortSignal` is not checked during the wait period, so cancel requests are delayed up to 2s (backoff on attempt 1)
**Where:** `services/ai/LocalAiProvider.ts:137-140`
**Observed:** `backoff = 1000 * Math.pow(2, attempt)` → 1000ms on first retry, 2000ms on second. During this sleep, `signal?.aborted` is not checked. A user clicking Cancel must wait for the backoff to complete before the abort propagates.
**Expected:** Use `Promise.race([timer, abortPromise])` pattern or check `signal?.aborted` every 100ms.

---

## Plot rendering / layout

### 🔴 [B-106] `PlotRenderer.tsx` splits configs on `\n\n` (double newline) then `;` — a TITLE tail containing a quoted string with `\n\n` or a DSL comment with a blank line silently splits the config into two rows, producing two broken plots instead of one
**Where:** `components/PlotRenderer.tsx:284`
**Observed:** `effectiveConfig.split('\n\n')` is the row separator. If a title contains escaped newlines (edge case), or if the user puts a blank comment line between the function call and a tail keyword, the split fires mid-config. Example: `LINE_CHART(x: "t", y: ["v"])\n\nTITLE "My Chart"` → two configs: `LINE_CHART(x: "t", y: ["v"])` and `TITLE "My Chart"`, the second of which throws "Unknown plot type TITLE".
**Expected:** The row separator should be a blank line that appears BETWEEN complete plot calls, not inside them. The parser should be the authority on where one plot ends and the next begins.

### 🟠 [B-107] `HeatmapPlot` has a hardcoded `height: 200` on its outer div — the chart ignores the container height set by `HEIGHT` tail keyword or the cell's flex layout
**Where:** `components/plots/HeatmapPlot.tsx:54`
**Observed:** `<div style={{ width: '100%', height: 200 }}>`. The `ResponsiveContainer` inside expands to fill this fixed 200px container regardless of the `height` prop from `parsedCall.height` or the parent flex cell.
**Expected:** Use `height: '100%'` and let the parent cell set the size, consistent with how all other plot components work.

### 🟠 [B-108] `GanttChartPlot` computes `chartHeight = Math.max(320, chartData.length * 28 + 60)` per-row without accounting for duplicate lane labels — if 1000 events all belong to 3 lanes, the chart is 28 028px tall
**Where:** `components/plots/GanttChartPlot.tsx:113`
**Observed:** `chartData.length * 28` uses the raw event count, not the distinct lane count. A thread timeline with 1 000 GC events on 3 threads produces a 28 060px chart that scrolls off the page.
**Expected:** Use `new Set(chartData.map(r => r.__rowLabel)).size * 28 + 60` (distinct lane count × row height + margin).

### 🟠 [B-109] `PlotRenderer.tsx` `applyPlot` in `ChatPanel` uses a non-anchored regex `/```plot[\s\S]*?```/` that replaces only the FIRST plot block in a cell — cells with multiple plot blocks have the wrong block replaced
**Where:** `components/ChatPanel.tsx:238`
**Observed:** `cell.content.replace(/```plot[\s\S]*?```/, ...)` uses string `.replace()` which replaces only the first match. If a cell has two plot blocks and the AI targets the second, the first is replaced instead.
**Expected:** Match by plot-block index (using `tokenizeCellContent` to find the Nth plot segment's start/end offsets) rather than simple string replace.

### 🟡 [B-110] `PlotRenderer` wraps each column config in `try/catch` and re-throws with `fixContext`; but the outer catch at line 429 accesses `e.fixContext?.failedConfig` — if `e` is a non-Error object (e.g. a plain string thrown by Recharts), `e.fixContext` is undefined and `config` (the full multi-plot config) is shown in the AI fixer instead of the broken sub-config
**Where:** `components/PlotRenderer.tsx:429-434`
**Observed:** Recharts occasionally throws strings from deep within its rendering (`throw "Invariant violation..."`, etc.). These propagate to the outer catch with no `.fixContext`. `errorInfo.failedConfig` falls back to the raw `config` prop — the entire multi-plot config string — which is then sent to the AI fixer. The AI receives a much larger context than needed and may produce wrong column-matching fixes.

---

## ExecutionGraph / Executor

### 🟠 [B-111] `executionGraph.ts` `Kahn's algorithm` uses `ready.shift()` — O(n²) for large notebooks because `Array.shift` on an untyped array is O(n)
**Where:** `runtime/executionGraph.ts:83`
**Observed:** For notebooks with N cells in a chain (A → B → C → …), each `shift()` call is O(N) giving O(N²) total. With 100 cells this is 10 000 operations; acceptable. But for notebooks with hundreds of auto-generated cells (template-heavy dashboards) this may degrade.
**Notes:** Minor for current usage, but easy to fix: use a deque or index pointer.

### 🟠 [B-112] `Executor.scheduleRun` abandons a run when the `runId` changes mid-await, but it does NOT set the cell status back to `'pending'` — stale `'running'` status is left in the map if a second schedule fires while the first is in the upstream-await phase
**Where:** `runtime/executor.ts:87-89`
**Observed:** If `scheduleRun(cellId)` is called twice in rapid succession, the second call bumps `runIds`. The first call's `if (this.runIds.get(cellId) !== myRunId) return;` guard fires and the async function returns without setting status. The second run correctly sets 'running' → 'done'. But during the gap between first abandonment and second `setStatus('running')`, the status remains at whatever the previous run left it ('done' from a prior run). If the previous run was 'running', the cell shows 'running' while actually doing nothing.
**Expected:** When abandoning a run, set status to 'pending' if it was 'running'.

---

## DataTable

### 🟠 [B-113] `DataTable` `isDurationLike` excludes values > `1e9` as "timestamps" — but DuckDB INTERVAL values in microseconds can be > 1e9 µs (e.g., 30-minute pause = 1.8e9 µs) and are silently treated as non-duration
**Where:** `components/DataTable.tsx:44`
**Observed:** `if (num < 0 || num > 1e9) return false;` — a 30-minute GC pause serialized as microseconds = 1 800 000 000 µs > 1e9, so `isDurationLike` returns `false` for the column. The value is then formatted as a plain number (`1800000000`) instead of `30m 0s`.
**Expected:** The cap of 1e9 is too low for microsecond-precision durations. For microsecond-unit values the cutoff should be at least `1e12` (about 11 days). Alternatively, detect the unit from the DuckDB column type (`INTERVAL` → always duration regardless of magnitude).

### 🟡 [B-114] `DataTable` sort for BIGINT values uses `a[key] - b[key]` numeric subtraction — BigInt arithmetic throws `TypeError: Cannot mix BigInt and other types` when `a[key]` is a JS BigInt
**Where:** `components/DataTable.tsx:200`
**Observed:** `if (typeof a[key] === 'number' && typeof b[key] === 'number') return (a[key]-b[key])*asc;` — the check is `typeof === 'number'` which excludes BigInt. BigInt values fall through to `String(a[key]).localeCompare(String(b[key]))`. Lexicographic sort of numeric strings is wrong: `'9' > '10'` alphabetically. DuckDB BIGINT columns like `startTime` sort incorrectly in the table.
**Expected:** Add `|| typeof a[key] === 'bigint'` to the numeric branch (use `Number(a[key]) - Number(b[key])`, accepting precision loss for display purposes) or use a direct BigInt comparison.

### 🟡 [B-115] `DataTable` `exportToCsv` formats all values through `formatCell` — exported timestamps are human-readable strings (e.g. "12:34:56.78") rather than ISO-8601, making the CSV non-machine-parseable
**Where:** `components/DataTable.tsx:104-117`
**Observed:** `headers.map(h => escape(String(formatCell(r[h], h))))` — `formatCell` applies `formatTimestampUtil` for timestamp columns, which formats to `HH:mm:ss.SS` (no date part). The raw nanosecond epoch is lost. Re-importing the CSV into another tool produces times without dates.
**Expected:** CSV export should use raw values (or ISO-8601) rather than the display-formatted strings.

---

## Plot DSL parsing / evaluation

### 🟠 [B-116] `buildSmartTemplate` in `plotUtils.ts` uses `null as any` as a return value when no column is found — callers that don't null-check get `null` passed to the editor as initial content, producing a `null` literal in the plot editor
**Where:** `utils/plotUtils.ts:169,238` — `return null as any;` in two places
**Observed:** `buildSmartTemplate('HEATMAP', [], null)` returns `null` (cast to `any`). If the caller passes this to a CodeMirror editor initial value, the editor shows the text "null".
**Expected:** Return `''` or the shape's blank template string (`plotRegistry[name].template`) instead of `null`.

### 🟠 [B-117] `buildSmartTemplate` for `PIE_CHART` uses `category: name:` — the old deprecated parameter name — instead of the current `category:` parameter
**Where:** `utils/plotUtils.ts:212-215`
**Observed:** The template builds `PIE_CHART(name: ${q(nameCol)}, value: ${q(valCol)})`. However the current `PieChartPlot.tsx` params list defines `category` as the required column (line 23 of `PieChartPlot.tsx`), not `name`. `name` is a deprecated alias. The smart template generates code that triggers a deprecation warning in the linter.
**Expected:** Use `category:` in the template: `PIE_CHART(category: ${q(nameCol)}, value: ${q(valCol)})`.

### 🟠 [B-118] `AiErrorFixer` fires an AI request immediately on every render where `error` changes — if the error flickers (e.g. user types a character that briefly produces an error then resolves), a stale AI request is in-flight and its result may apply after the error has cleared
**Where:** `components/PlotRenderer.tsx:63-73` (AiErrorFixer `useEffect`)
**Observed:** `useEffect(() => { setIsLoading(true); aiService.getAiPlotFixSuggestion(…).then(...) }, [error, config, data, sql, cellContext, metadata])` — no debounce. The `isMounted` flag prevents applying a stale response, but the request is still made and counted against the provider's rate limit.
**Expected:** Add a 500ms debounce or only trigger when the error has been stable for that duration.

---

## variableSubstitution / notebookParser

### 🟠 [B-119] `substituteVariables` iterates to fixpoint up to 10 passes — if a variable value contains another variable that resolves to the first, the loop runs all 10 passes before giving up, adding latency on every SQL execution in a notebook with circular variables
**Where:** `utils/variableSubstitution.ts:41-48`
**Observed:** 10 full passes over all variable patterns on every SQL block. For a cell with 20 variables and a large SQL, this is 200 regex replacements per execution. Cycles are rare but the cost is paid unconditionally.
**Expected:** Detect the cycle on the first pass (check if any `$ref` in `value` matches a key already on the substitution stack) and skip re-substituting cyclic variables rather than iterating to the cap.

### 🟡 [B-120] `notebookParser.ts` `parseFrontMatter` inline YAML array parser tries to fix `{k: v}` → `{"k": "v"}` via regex replacement, but the regex `: ([^"{\[\],}][^\],}]*?)([,\]}])` may strip legitimate values containing spaces followed by `]` or `}`
**Where:** `utils/notebookParser.ts:126-131`
**Observed:** The YAML-JSON coercion regex `.replace(/:\s*([^"{\[\],}][^\],}]*?)([,\]}])/g, ':"$1"$2')` is greedy and may mismatch on values like `{name: hello world}` (spaces in value) or `{type: STRUCT<a INT>}` (angle brackets). The try/catch falls back to a comma-split, but this discards structured objects.
**Expected:** Use a proper YAML parser for front-matter (e.g. `js-yaml`) rather than a hand-rolled regex.

---

## Plot components — rendering & data issues

### 🟡 [B-121] `AreaChartPlot` LTTB decimation uses only the first Y column to guide downsampling — when multi-series data is rendered (`y: ["a","b","c"]`), features of series 2 and 3 may be dropped even though they contain important peaks/troughs
**Where:** `components/plots/AreaChartPlot.tsx:87-91`
**Observed:** `const decimated = (isTimeAxis && primaryY && …) ? lttb(transformedData, xCol, primaryY, AREA_SOFT_CAP_PER_SERIES) : transformedData;` — only `allYCols[0]` drives LTTB. If series 2 has a spike on a row that LTTB drops to preserve series 1's shape, the spike is silently lost.
**Expected:** Either downsample each series separately or use a multi-column importance metric.

### 🟡 [B-122] `AreaChartPlot` hardcodes `height={320}` on the inner `ResponsiveContainer` while wrapping it in a 100% flex div — the explicit 320px override means the parent's `flex: 1 1 0` sizing is ignored when the plot is inside a composite layout, causing all area charts in a `col {}` composite to be 320px regardless of allocated height
**Where:** `components/plots/AreaChartPlot.tsx:97` — `<ResponsiveContainer width="100%" height={320}>`
**Observed:** Same pattern as `RangePlot.tsx:85`. Outer div has `height: '100%'` but `ResponsiveContainer` ignores it with an explicit pixel height.
**Expected:** Remove the explicit `height` prop or set `height="100%"` to inherit from the flex container.

### 🟡 [B-123] `RangePlot` fills the area between `__rangeLow` and `__rangeHigh` using two stacked `Area` components but has no `stackId` on either — Recharts will draw the low area from zero to the low value and the high area from zero to the high value, creating an overlap artifact rather than a clean band
**Where:** `components/plots/RangePlot.tsx:133-155`
**Observed:** The correct approach to render a band in Recharts is `stackId` + a transparent lower area. Without `stackId` the two areas overlap rather than stacking, so the shaded region includes data below the low bound.
**Expected:** Set `stackId="band"` on the lower `Area` and use `fill="transparent"` there, so the upper `Area` fills only the `[low, high]` band.

### 🟡 [B-124] `BoxPlot` `calculateStats` uses integer indexing `sorted[Math.floor(sorted.length * 0.25)]` for quantiles — for small arrays this gives Q1 = Q3 for common cases (e.g. 4-element array: Q1 index = 1, Q3 index = 3, but with 3 elements Q3 index = floor(3*0.75) = 2 = max element), producing a zero-height box
**Where:** `components/plots/BoxPlot.tsx:28-33`
**Observed:** Standard Tukey boxplot quantile estimation should interpolate between adjacent values. `sorted[Math.floor(n * 0.5)]` (not `Math.round((n-1)*0.5)`) can give the wrong median for even-length arrays (off by one element), and Q1/Q3 have the same indexing bias.
**Expected:** Use `(sorted[Math.floor(…)] + sorted[Math.ceil(…)]) / 2` or a standard interpolation formula.

### 🟡 [B-125] `FlameGraphPlot` rebuilds the entire flame tree (the `root` construction loop starting at line 135) on every render, including while the user is typing in the search box — searching causes a full O(n·depth) re-aggregation per keystroke because the build is not wrapped in `useMemo`
**Where:** `components/plots/FlameGraphPlot.tsx:132-153`
**Observed:** The `root` variable and the entire for-loop are declared directly in the component function body (not inside a `useMemo`). Each character typed in the search input triggers a re-render, re-running the full tree build.
**Expected:** Wrap the tree construction in `useMemo([data, framesCol, valueCol])` so it only rebuilds when data/columns change, not on search input.

### 🟡 [B-126] `FlameGraphPlot` `handleZoom` callback captures `root` via closure — but `root` is rebuilt on every render (see B-125), so the `root` reference used inside `handleZoom` may be stale after data changes while the user is zoomed in; clicking a breadcrumb that calls `setZoomStack(prev => [...prev, node])` and then later tries to match the node against the new `root` may find no match
**Where:** `components/plots/FlameGraphPlot.tsx:161-164`
**Observed:** `const handleZoom = useCallback((node) => { if (node === root || …) }, [root])` — `root` in the dep array means the callback is recreated on every render anyway (since `root` is never memoized), defeating `useCallback`.
**Expected:** Memoize `root` first (B-125), then key `handleZoom` off the memoized root.

### 🟠 [B-127] `HistogramPlot` ignores the `domainX` prop — it is declared in the component's prop signature but never used; passing `LINK_X` or a domain override to a `HISTOGRAM` plot has no effect
**Where:** `components/plots/HistogramPlot.tsx:33` — `domainX` received in props but the XAxis always uses `config.xDomain` (`domain={config.xDomain as any}`), not the interactive-zoom `domainX` prop
**Observed:** When `HISTOGRAM` is used with `LINK_X`, the parent passes a `domainX` prop but the histogram's XAxis ignores it, so pan/zoom has no effect.
**Expected:** Use `domainX ?? config.xDomain` on the XAxis `domain` prop, the same pattern used by `LINE_CHART` and `SCATTER_PLOT`.

### 🟡 [B-128] `ScatterPlot` size domain uses `[min, max]` of raw data values as the ZAxis domain — if all points have the same size value, `min === max` and the ZAxis maps everything to a single radius, which Recharts may then display with `NaN` sizing
**Where:** `components/plots/ScatterPlot.tsx:45-52`
**Observed:** `const [min, max] = [Math.min(...values), Math.max(...values)]` passed directly as `domain`. When all values are equal, `domain=[5, 5]` makes Recharts try to compute `(value - 5) / (5 - 5)` → `NaN`.
**Expected:** Guard: `if (min === max) return [10, 100]` (already done for `values.length === 0`; needs to cover the all-same case too).

### 🟠 [B-129] `BarChartPlot` mixed bar+line charts (`lineY`) use the same single `YAxis` for both bars and lines — if the bar values are in the range `[0, 1000]` and the overlay line is `[0, 1]` (e.g. CPU ratio), both axes share the same scale and the line appears flat at the bottom; no secondary Y-axis is rendered
**Where:** `components/plots/BarChartPlot.ts:69-77,123-131`
**Observed:** One `YAxis` element for both `barElements` and `lineElements`. The `yAxisId` prop is not used, so lines and bars share the scale.
**Expected:** When `lineY` columns are present whose magnitude differs from `y` columns, add a secondary `YAxis` with `yAxisId="right"` and pass `yAxisId="right"` to the `Line` elements.

---

## Completion / editor intelligence

### 🟡 [B-130] `sqlCompletionSource` completion regex `validFor: /^"?[\w-]*$/` allows hyphens in identifiers — DuckDB SQL identifiers cannot contain hyphens without quoting, so the completion popup stays open after a user types `foo-` (a subtraction expression), offering stale completions
**Where:** `components/editor/completions.ts:391` — `validFor: /^"?[\w-]*$/`
**Observed:** After `foo-`, the completion list remains open with the partial token `foo-`, filtering for columns/tables starting with `foo-`. The filter matches nothing but the popup persists.
**Expected:** Use `validFor: /^"?\w*$/` (no hyphen) to dismiss the popup after a non-identifier character.

### 🟡 [B-131] `EmbeddingService.rankCandidates` enters the `if (allPrecomputed || _ready)` branch when `allPrecomputed === true` even if the model is NOT ready, then calls `embedQuery` which immediately returns `null` (line 148: `if (!_ready) return null`) — the function then reaches `if (allPrecomputed && qVec)` with `qVec === null` and falls through to the `if (_ready)` branch which also returns the unranked list because `_ready` is false
**Where:** `services/ml/EmbeddingService.ts:193-231`
**Observed:** When `allPrecomputed === true` and `_ready === false`, the code takes the `allPrecomputed || _ready` branch, calls `embedQuery`, gets `null` back, skips the `allPrecomputed && qVec` guard (qVec is null), skips the `_ready` guard, and returns the original unranked `candidates`. The control flow is correct but the dead-code path through `embedQuery` wastes an async hop on every completion trigger until the model warms up.
**Expected:** Short-circuit: `if (allPrecomputed && !_ready) return candidates;` before entering the main branch, since without a query embedding precomputed vectors can't be scored.

### 🟡 [B-132] `getPlotRegistryAsShapes` in `completions.ts` is memoized in a module-level variable `cachedShapeRegistry` — the `AREA_CHART` and `RANGE` plot types (added in `AreaChartPlot.tsx` / `RangePlot.tsx`) are not present in the `SHAPE_MAP`, so they fall back to `upperName.toLowerCase()` (`area_chart`, `range`) which won't match the parser's shape registry keys — completions for those shapes won't work
**Where:** `components/editor/completions.ts:1180-1196` — `SHAPE_MAP` missing `AREA_CHART` and `RANGE`
**Observed:** `SHAPE_MAP` maps 9 names; plot registry exports at minimum 11. `AREA_CHART` → `area_chart` (not in parser registry), `RANGE` → `range` (not in parser registry). The linter/completer silently ignores these shapes.
**Expected:** Add `AREA_CHART: 'area_chart'` and `RANGE: 'range'` (or whatever keys the parser uses) to `SHAPE_MAP`, or derive the keys consistently.

---

## DuckDB context / query path

### 🟠 [B-133] `DuckDBContext` `runWasmQuery` converts all `BigInt` values to `Number` via `Number(v)` — for `BigInt` values > `Number.MAX_SAFE_INTEGER` (2^53-1), this silently truncates the value; JFR timestamps are nanosecond epochs (e.g. `1_700_000_000_000_000_000n`) which exceed `MAX_SAFE_INTEGER` and will be corrupted
**Where:** `context/DuckDBContext.tsx:116-118`
**Observed:** `if (typeof v === 'bigint') { obj[k] = Number(v); }` — a nanosecond timestamp `1_700_000_000_000_000_000n` becomes `1_700_000_000_000_000_000` (exactly representable? let's check: 2^53 ≈ 9×10^15, but 1.7×10^18 > 9×10^15, so it is NOT safely representable as a double). The nearest representable double will differ by up to 1024 ns.
**Expected:** Return BigInt values as strings (for display) or keep them as BigInt and teach downstream consumers; at minimum document the precision loss.

### 🟡 [B-134] `DuckDBContext` `fetchSchemaFor` builds the row-count query by concatenating table names directly into a UNION ALL SQL string — the name is escaped via `replace(/"/g, '""')` for the `FROM` identifier, but the `SELECT '${t.name.replace(/'/g, "''")}' as name` literal escaping is done separately; a table name containing both `'` and `"` (unusual but valid in DuckDB) would produce a malformed query
**Where:** `context/DuckDBContext.tsx:203-208`
**Observed:** The two escape paths (`/"/g` for the identifier, `/'/g` for the string literal) are applied independently. A name like `it's a "table"` would produce `"it's a ""table"""` (identifier) and `'it''s a "table"'` (literal), which happen to be valid separately but are easy to get wrong when mixed.
**Expected:** Use parameterized queries or the DuckDB `quote_ident`/`quote_literal` functions instead of manual escaping.

### 🟡 [B-135] `DuckDBContext` `executeQuery` (the `query` callback exposed to the context) guards against running `SELECT` when the DB is not ready, but allows non-`SELECT` statements to bypass the guard regardless of DB state — a cell that runs `CREATE TABLE` or `INSERT` while the DB is still importing could corrupt the in-memory WASM state
**Where:** `context/DuckDBContext.tsx:336-341`
**Observed:** `if (dbState !== DBState.READY && sql.trim().toLowerCase().startsWith('select')) throw …` — only `SELECT` is guarded. `CREATE`, `INSERT`, `DROP`, `COPY` all pass through unconditionally.
**Expected:** Guard all write-capable statements when `dbState !== READY`, or simply guard all statements (SELECT and otherwise).

---

## InlineChat / ChatPanel

### 🟠 [B-136] `InlineChat` `mutateCells` `applyPlot` branch uses the same single-match regex `cell.content.replace(/```plot[\s\S]*?```/, …)` as `ChatPanel` (B-109) — only the first `plot` block in a multi-block cell is replaced
**Where:** `components/InlineChat.tsx:192`
**Observed:** Same bug as B-109 but in a different path. Multi-block cells with two plot blocks will have only the first replaced.
**Expected:** Use `replace` with a global flag or find the correct block by index.

### 🟡 [B-137] `InlineChat` `handleSendLegacy` still reads `useFullContext` state and the deprecated `fullNotebookContext` variable but the "full context" toggle button is labelled as deprecated in the JSX tooltip — the deprecated toggle still silently overrides the `chatVisibility` dropdown, and `resolveVisibility(useFullContext, chatVisibility)` will return `'full'` whenever the deprecated toggle is on, even if the user set the dropdown to `'no-data'`
**Where:** `components/InlineChat.tsx:260` — `resolveVisibility(useFullContext, chatVisibility)`; `inlineChatHelpers.ts`
**Observed:** When `useFullContext=true`, `resolveVisibility` returns `'full'` regardless of the `chatVisibility` dropdown value. The button tooltip says it's deprecated but it still silently wins over the explicit dropdown selection.
**Expected:** Remove the deprecated `useFullContext` toggle or make it not override an explicit `chatVisibility` selection.

### 🟡 [B-138] `InlineChat` `handleSend` clears `proposals` and `approvalResolvers` at the start of every send — if a previous request is still in-flight with unresolved approvals, clearing `approvalResolvers` causes the old pending promises to never resolve or reject, leaking the old `handleSend` coroutine indefinitely
**Where:** `components/InlineChat.tsx:254-258`
**Observed:** `approvalResolvers.current.clear()` is called synchronously on each send without first rejecting the pending resolvers. The old `for await (const chunk of stream)` loop that's waiting for an approval will be blocked forever (or until it times out).
**Expected:** Before clearing, iterate `approvalResolvers.current` and call `reject(new Error('superseded'))` on each, then cancel the old stream via AbortController.

---

## plotBrushStore

### 🟡 [B-139] `plotBrushStore.subscribe` cycle detection only fires when the brush _already has a payload_ at subscribe time — if cell A subscribes to `$y` first (before cell B publishes `$y`), and cell B subscribes to a brush that A publishes, the cycle is never detected because `this.state.get(name)` returns `undefined` at A's subscribe time
**Where:** `services/plotBrushStore.ts:88-104`
**Observed:** `const publisher = this.state.get(name); if (publisher?.cellName …)` — the state map is only populated after `publish()` is called. If both cells subscribe before either publishes, no cycle warning fires and both cells will update each other in a feedback loop.
**Expected:** Track publisher cell names separately from state payloads, or run the cycle check in `publish()` as well.

### 🟡 [B-140] `plotBrushStore.clampToRange` modifies an existing domain but calls `this.publish(…)` which calls `subs.forEach(entry => entry.fn(payload))` synchronously — if a subscriber's callback triggers another `clampToRange` (e.g. a linked chart whose data range also shifted), the re-entrant call modifies `this.state` while the outer `publish`'s `subs.forEach` is still running, potentially causing double-notifications
**Where:** `services/plotBrushStore.ts:150-163`
**Observed:** `this.publish({ ...current, domain: newDomain })` is called inside `clampToRange`. `publish` iterates subscribers synchronously. A subscriber that calls `clampToRange` on another brush during its callback re-enters the publish loop.
**Expected:** Queue re-entrant publishes as microtasks (e.g. `queueMicrotask`) rather than calling `publish` synchronously from within `clampToRange`.

---

## Cross-cell plot linking / multi-query / LINK_X

### 🔴 [B-141] `PlotRenderer` never reads `ParsedPlotCall.on` — the `ON` tail clause is parsed into `parsed.on: string[]` but nowhere in `PlotRenderer.tsx` is this array consumed; all charts in a cell (including multi-config grids and composites) always receive the same single `data` prop (the primary query result), making multi-query routing via `ON #2`, `ON myView`, etc. completely non-functional
**Where:** `components/PlotRenderer.tsx:265-354` — the `effectiveOn` / `parsed.on` field is never referenced; `data` is forwarded identically to every `reg.parseConfig` call and every `renderLeaf` invocation
**Observed:** User writes `LINE_CHART(x:"time", y:"cpu") ON 1` alongside `BAR_CHART(x:"name", y:"count") ON 2` in a composite or grid — both charts get the same dataset (the cell's single query result). The second chart renders with wrong data or is empty if the columns don't match.
**Expected:** When `parsed.on` is set, resolve each ref against the cell's multi-query result map (by numeric index or named view) and pass the appropriate dataset to each chart instance.

### 🔴 [B-142] `PlotRenderer` multi-config grid loop (lines 297-354) passes the same `data` array to every config in the grid — a cell with multiple SQL + plot block pairs renders all charts from the same first-block data, ignoring which SQL block each plot logically belongs to
**Where:** `components/PlotRenderer.tsx:313,318` — `reg.parseConfig(leafMain, data)` and `renderLeaf(leaf, data)` both receive the outer `data` argument unchanged
**Observed:** A `PlotRenderer` that renders `config1\n\nconfig2\n\nconfig3` (split on `\n\n`) will call `reg.parseConfig` three times, each with the identical `data` argument. If the cell has multiple SQL blocks whose results are stored in `queryResults[0]`, `queryResults[1]`, etc., PlotRenderer has no mechanism to know which result index maps to which config slot.
**Expected:** Either thread per-config data via the `ON` clause (requires B-141 fix), or accept `data: any[][] | any[]` and index into the array by config position.

### 🔴 [B-143] `CompositeRenderer` passes the same single `data` argument to all leaf children — nested composites `ROW(LINE_CHART(…) ON 1, BAR_CHART(…) ON 2)` render all children with dataset 0, because the `renderLeaf` callback in `PlotRenderer.tsx` always captures the same outer `data` variable
**Where:** `components/plots/CompositeRenderer.tsx` `renderLeaf(leaf, data)` callback defined in `PlotRenderer.tsx:310-320` — `data` is closed over from the parent's props, not resolved per-leaf from `leaf.on`
**Observed:** Inside a `ROW(…, …)` composite, each leaf `ParsedPlotCall` may have its own `on` field. The `renderLeaf` callback ignores `leaf.on` and always renders with the same top-level data.
**Expected:** `renderLeaf` should check `leaf.on` and resolve the dataset from the cell's multi-result map before calling `reg.parseConfig`.

### 🔴 [B-144] `parsePlotCall` silently drops `LINK_X` when the variable arguments lack a `$` prefix — `LINK_X(start, end)` produces `variables = []` (the filter `arg.startsWith('$')` matches nothing), so `result.linkX` is never set and no error or warning is shown; the interactive zoom is silently disabled
**Where:** `utils/plotParser.ts:195-203`
**Observed:** `const variables = linkArgs.filter(arg => arg.startsWith('$'));` — if the user writes `LINK_X(start, end)` without `$`, `variables` is empty and the `if (variables.length >= 2)` block is skipped. The clause is consumed from the string (it was matched) but its output is discarded.
**Expected:** Either validate and emit a parse error, or accept bare names and prepend `$` with a deprecation note. Silently ignoring a consumed clause is confusing because the string is stripped from `mainConfig` but `result.linkX` stays `undefined`.

### 🔴 [B-145] `parsePlotCall` `ON` clause regex does not match `#N` hash-prefixed query references — `ON #1, #2` is not captured because the regex `(?:\w+|\d+)` only allows word-chars and bare digits; `#` is neither, so the entire `ON` clause falls through unmatched and `result.on` stays `undefined`
**Where:** `utils/plotParser.ts:134`
**Observed:** Regex: `/(?<!\w)ON\s+((?:\w+|\d+)(?:\s*,\s*(?:\w+|\d+))*)\s*$/i` — the `\w+` arm matches alphanumeric names like `myView`, and `\d+` matches bare numbers like `1`. But `#1` starts with `#`, which fails both alternatives.
**Expected:** Extend the alternation to `(?:#?\w+|\d+)` or `(?:#\d+|\w+|\d+)` to match hash-prefixed query-number refs.

### 🟠 [B-146] `LINK-Y` and `LINK-XY` tail clauses in `parsePlotCall` require the variable to be double-quoted — `LINK-Y $varName` (bare) does not match because the regex has no unquoted alternative; only `LINK-Y "$varName"` works
**Where:** `utils/plotParser.ts:139-140`
**Observed:** Regexes: `/LINK-Y\s+(?:"(\$[A-Za-z_][\w]*)"|'(\$[A-Za-z_][\w]*)')\s*$/i` — no bare-word alternative. `LINK-Y $zoom` (the natural unquoted form documented in the showcases) is silently dropped.
**Expected:** Add a bare-variable alternative: `(?:"(\$…)"|'(\$…)'|(\$[A-Za-z_][\w]*))` mirroring the `BRUSH` clause pattern. Adjust capture group indices accordingly.

### 🟠 [B-147] `extractPlotMetadata` in `notebookPlotScope.ts` has a dead ternary on the `linkedXVars` push — `collected.push(v.path.length > 0 ? v.name : v.name)` both branches return `v.name`, so path-qualified variable names like `$plot1.brush.lo` are stored without their `.brush.lo` path; downstream scope lookups that use the full path string will never match
**Where:** `components/editor/plot/notebookPlotScope.ts:329`
**Observed:** `const name = v.path.length > 0 ? v.name : v.name;` — both arms are identical. The intent was likely `v.path.length > 0 ? v.name + '.' + v.path.join('.') : v.name` to reconstruct the full dotted path.
**Expected:** Fix the ternary to reconstruct the full qualified name when `v.path.length > 0`, or use `v.raw` / `v.qualified` if the variable object has a pre-built full name field.

### 🟠 [B-148] `InteractivePlotWrapper` `debouncedOnVariableChange` is recreated on every pan/zoom gesture — `onVariableChange` is created as a new closure inside `NotebookCell.tsx` each time `metadata` changes, so after each variable write the parent re-renders, `onVariableChange` gets a new identity, `useCallback([onVariableChange])` rebuilds `debouncedOnVariableChange`, and the 200 ms debounce timer resets; continuous panning produces a new debounce on every frame, so the write never fires until the user stops AND the component doesn't re-render
**Where:** `components/PlotRenderer.tsx:99` — `const debouncedOnVariableChange = useCallback(debounce(onVariableChange, 200), [onVariableChange])`
**Observed:** `onVariableChange` prop is `handleVariableChange` from `NotebookCell.tsx`, which is `useCallback`-keyed on `[cell.id, onMetadataChange]`. `onMetadataChange` is the `updateCell` from `App.tsx` — stable. But `cell` itself may be a new object each render if `cells` state is reassigned (which happens when variables are written). So `handleVariableChange` gets a new identity after each pan, defeating the debounce.
**Expected:** Stabilize `onVariableChange` (e.g. via a ref + stable wrapper) so `debouncedOnVariableChange` is not recreated mid-gesture.

### 🟠 [B-149] `InteractivePlotWrapper` wheel-event `useEffect` adds and removes the event listener on every render because `handleInteraction` is defined as an inline function inside `useEffect` — the deps array includes `handleInteraction` but `handleInteraction` is recreated every time the effect runs
**Where:** `components/PlotRenderer.tsx:185-195`
**Observed:** `useEffect(() => { const handleInteraction = (e) => { … }; ref.current.addEventListener('wheel', handleInteraction); return () => ref.current.removeEventListener('wheel', handleInteraction); }, [handleInteraction])` — since `handleInteraction` is defined inside the effect body, it's a new function on every invocation, so the dep check always triggers, removing and re-adding the listener on every render.
**Expected:** Move `handleInteraction` (or its equivalent) into a `useCallback` defined outside the effect, so the dep is stable and the listener is only re-registered when zoom state actually changes.

### 🟠 [B-150] Every pan/zoom gesture in `InteractivePlotWrapper` writes to `metadata.variables` via `onMetadataChange` which triggers a full notebook re-render in `App.tsx` — for a notebook with 10+ cells and large SQL results, each wheel tick causes a tree-wide reconciliation; with the debounce broken (B-148), this occurs at 60fps while the user pans
**Where:** `components/PlotRenderer.tsx:259-265` `handleVariableChange` + `NotebookCell.tsx` `onMetadataChange` propagation path
**Observed:** `onVariableChange({name, value})` → `onMetadataChange({...cell.metadata, variables: {..., [name]: value}})` → `updateCell(id, {metadata: …})` → `setCells(…)` → entire `App` re-renders → all `NotebookCell` instances re-render. Even with `React.memo` the `metadata` prop changes, busting memoization.
**Expected:** Store interactive zoom state in a local React ref or dedicated context (e.g. an existing `plotBrushStore`) that notifies only subscribed plots, bypassing the `metadata.variables` write-then-notebook-rerender path.

### 🟠 [B-151] `buildScopeView` in `notebookPlotScope.ts` increments `queryIndexCounter` for ALL SQL blocks including those in the current cell — but `queryRefs` only includes non-current-cell SQL blocks; so the query index numbers shown in completions (e.g. `ON 3`) don't match the actual 1-based indices used at runtime, because the current cell's SQL blocks are counted toward the index but excluded from the visible reference list
**Where:** `components/editor/plot/notebookPlotScope.ts:185-220`
**Observed:** The counter increments for both `cell.id === currentCellId` (current cell's SQL blocks) and other cells' SQL blocks. `queryRefs.push(…)` only fires for non-current cells. If cell A (not current) has 2 SQL blocks and cell B (current) has 1 SQL block, the completion hints show `ON 1`, `ON 2` (A's blocks) but the runtime PlotRenderer would use index 3 for B's block (since A occupied 1-2). The hint indices are off by the count of SQL blocks in all prior cells.
**Expected:** Reset or branch `queryIndexCounter` so that the numbers shown in completions match the numbers the renderer will actually use, or document the exact numbering convention consistently.

### 🟡 [B-152] `notebookPlotScope.ts` `VIEW_ALIAS_RE` regex for detecting `CREATE VIEW <alias> AS` does not handle double-quoted view names — `CREATE VIEW "my alias" AS …` is a valid DuckDB statement but `VIEW_ALIAS_RE` expects a bare identifier `([A-Za-z_][\w$]*)`, so cells that create quoted-name views are not registered in the alias registry and won't appear in `ON` completions
**Where:** `components/editor/plot/notebookPlotScope.ts` (the `VIEW_ALIAS_RE` constant, also referenced in `CellAliasContext`)
**Observed:** `VIEW_ALIAS_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([A-Za-z_][\w$]*)\s+AS/i` — the capture group `([A-Za-z_][\w$]*)` does not accept `"` as the start of the name.
**Expected:** Also match `"([^"]+)"` as an alternative: `/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:"([^"]+)"|([A-Za-z_][\w$]*))\s+AS/i` and coalesce the two capture groups.

### 🟡 [B-153] `parseComposite` overlay split on top-level `+` conflicts with SQL `operator +` in plot clauses — if a plot config contains a TITLE with a `+` character, e.g. `LINE_CHART(x:"t") TITLE "A + B"`, the `splitTopLevelOp(trimmed, '+')` call will split on the `+` inside the quoted string because `splitTopLevelOp` only tracks `(`, `[`, `{` for depth, not string delimiters — the `inStr` guard was added in `splitTopLevelOp` but only handles `"` and `'` at depth 0; the `+` inside `TITLE "A + B"` IS inside a string so it should be safe, but the string tracking in `splitTopLevelOp` has an off-by-one: the `if (inStr)` branch sets `inStr = null` when it sees the closing quote, but the closing-quote character is still appended to `cur` before `inStr` is cleared, meaning the next character is treated as outside the string — if the string ends exactly at a `+`, that `+` would be treated as outside the string
**Where:** `utils/plotParser.ts:239-263` `splitTopLevelOp`
**Observed:** The `inStr` block processes: `cur += c; if (c === inStr && s[i-1] !== '\\') inStr = null; continue;` — the closing quote character is consumed and `inStr` is set to null. The character after the closing quote is not mishandled. The actual risk is `TITLE "A+B" + LINE_CHART` where the outer `+` splits correctly because it's at depth 0 after the string closes. However: if the string ends with `"A +" title clause (trailing `+` before close paren of `ROW()`), the `+` inside the string is correctly skipped. The true bug is that the backslash-escape check `s[i-1] !== '\\'` reads character `i-1` but for multi-byte escapes like `\\+` (an escaped backslash followed by `+`) the check would treat the `+` as escaped when it should not be, causing a split failure.
**Expected:** Use a more robust string scanner that handles `\\` as an escape sequence properly (detect `\\` as literal backslash, not an escaper).

### 🟡 [B-154] `validateComposite` checks x-axis semantic compatibility for `+` overlays but does not validate that LINK_X variable pairs on all overlay children are the same — two LINE_CHARTs overlaid with `LINK_X($a, $b)` on one and `LINK_X($c, $d)` on the other will each write to different variable pairs on pan/zoom, causing the two charts to move independently rather than staying synchronized
**Where:** `utils/plotParser.ts:326-358` `validateComposite`
**Observed:** The overlay validation only checks `childTypes` (categorical vs continuous) and `xCols` (column names). It does not inspect `child.linkX` to check that all overlay children share the same LINK_X variable pair.
**Expected:** Add a check: if any overlay child has a `linkX` clause, warn if not all children share the same `[start, end]` variable pair. Two charts overlaid but syncing to different ranges is almost certainly a configuration error.

### 🟡 [B-155] `NotebookCell.tsx` `allVariables` merge order puts `metadata.variables` (cell-local) last, so it can never override workspace or preceding-cell variables — a user who manually sets `$zoom_start` as a cell-level variable to provide a default will find it overridden by any preceding cell that also writes `$zoom_start` via a LINK_X gesture
**Where:** `components/NotebookCell.tsx` `allVariables` computation
**Observed:** The merge order is `{ ...workspaceVariables, ...precedingCellVariables, ...cellLocalVariables }`. Preceding-cell variables (written by `onMetadataChange` of other cells during LINK_X pan) overwrite cell-local variables. The user cannot set a local override.
**Expected:** Merge order should be `{ ...workspaceVariables, ...precedingCellVariables, ...metadata.variables }` — cell-local variables should win over preceding-cell variables since they represent intentional cell-level defaults, not gesture state. Alternatively, document that gesture-written variables are in a separate namespace.

### 🟡 [B-156] The `LINK_X` interactive zoom clamps the pan range to the full data domain but this clamping is computed from `data[0]` (the first row's x value) to `data[data.length-1]` (the last row's), assuming data is already sorted by x — for unsorted queries or queries with a non-time x axis (e.g. string category IDs sorted alphabetically), the clamp range will be wrong and the chart may appear to pan outside the real extent
**Where:** `components/PlotRenderer.tsx` `InteractivePlotWrapper` pan boundary calculation
**Observed:** The clamp is computed once on mount from `data` as passed in. If the data is not sorted by the x column, the min/max from `data[0]` and `data[data.length-1]` will be incorrect. For time axes DuckDB typically returns data in time order, but there is no guarantee.
**Expected:** Compute `Math.min(...data.map(r => r[xCol]))` and `Math.max(…)` explicitly, or use `d3.extent`, rather than assuming sorted order.

### 🟡 [B-157] `parsePlotCall` `LINK_X` parsing extracts the inner parens content with `/LINK_X\s*\(([^)]+)\)/i` — the `[^)]+` stops at the first `)`, so a variable name containing a paren (unusual but possible in exotic DSLs) or a trailing comment like `LINK_X($a, $b) # comment` would fail to parse because the `#` comment is not stripped before the paren-arg regex runs
**Where:** `utils/plotParser.ts:193`
**Observed:** `stripComments` (from `plotConfigParser.ts`) is NOT called in `parsePlotCall` before the LINK_X regex. The main config `configLine` may still contain `# …` line comments from the raw cell content. If the user writes `LINE_CHART(…) LINK_X($a, $b) # interactive zoom`, the regex `/LINK_X\s*\(([^)]+)\)\s*$/i` requires end-of-string `$`, but the `# comment` part means the string doesn't end at `)`. The regex won't match, and LINK_X is silently dropped.
**Expected:** Strip comments from `configLine` before the clause-parsing loop begins, or handle `#`-to-EOL comments within `parsePlotCall`.

### 🟡 [B-158] Cross-cell `precedingCellVariables` collection in `NotebookCell.tsx` walks all cells before the current one and merges their `metadata.variables` — variables written by LINK_X gestures in cell N (e.g. `$zoom_start`) will appear as `precedingCellVariables` in cell N+1's context, but if cell N+1 also has a LINK_X writing the same variable name, they conflict silently; the last cell writing wins at the `allVariables` merge level but the plot in cell N still reads from `metadata.variables` of cell N, not the merged context
**Where:** `components/NotebookCell.tsx` `collectPrecedingCellVariables` usage + `PlotRenderer` `metadata.variables` reads
**Observed:** PlotRenderer reads from the `ParsedPlotCall.linkX` pair directly and writes back via `onVariableChange`, which calls `onMetadataChange` on the current cell. It does not read `allVariables`; it writes its own cell's metadata. So two cells with `LINK_X($zoom, $zoomEnd)` both writing to the same variable name each write to their OWN cell's metadata, not to a shared store. Cell N+1's `allVariables` sees cell N's writes (via `precedingCellVariables`) but cell N+1's own LINK_X gesture overwrites only its own metadata. The charts in cell N and N+1 never actually synchronize unless they share a variable name AND cell N+1's reads come via `allVariables` rather than `metadata.variables`.
**Expected:** Document or enforce a clear model: shared LINK_X zoom should use a named global variable written to the notebook's workspace variables (or `plotBrushStore`), not cell-local metadata. The current multi-cell propagation path is a coincidental side effect of the `precedingCellVariables` merge.

### 🟡 [B-159] `NotebookCell.tsx` passes `sqlBlockCount` to `SQLEditor` as the count of SQL blocks in the notebook — but `sqlBlockCount` is computed as `parsedContent.sqlBlocks.length` (the current cell's SQL blocks), not the notebook-wide count; the notebook-wide count is needed by the plot completion source to generate correct `ON N` hints
**Where:** `components/NotebookCell.tsx` prop threading to `SQLEditor` `sqlBlockCount`
**Observed:** The prop name says "notebook" but the value is the current cell's SQL block count. If a notebook has cells with 1, 2, 3 SQL blocks respectively, a plot cell would always receive `sqlBlockCount=0` (since plot cells have no SQL blocks), and the completion source would offer no `ON N` completions.
**Expected:** Pass the total SQL-block count across all cells (which is tracked in `notebookPlotScope` as `queryIndexCounter` after processing all cells), not the current cell's count.

### 🟡 [B-160] `extractPlotMetadata` uses `parsePlotCall` (not `parseComposite`) — if a plot block contains a composite expression like `ROW(LINE_CHART(x:"t") LINK_X($a,$b), BAR_CHART(x:"name"))`, the entire string is passed to `parsePlotCall` which will not recognize the outer `ROW(…)` and will set `mainConfig` to the full composite string; `linkedXVars` will be empty because the LINK_X clause parser runs on a non-composite string that doesn't match the paren-arg pattern in the expected position
**Where:** `components/editor/plot/notebookPlotScope.ts:295-340` `extractPlotMetadata`
**Observed:** `parsePlotCall` is designed for single plot calls with tail clauses. A composite string like `ROW(A, B)` passed to `parsePlotCall` will not be split into children; it will remain as one big `mainConfig` with no `linkX` field. Any `LINK_X` on children won't be extracted.
**Expected:** Call `parseComposite` instead, then recursively traverse the `composite.children` to collect all `linkX` and `brush` fields from every leaf node.

---

## Execution graph / cell dependencies

### 🔴 [B-161] `executionGraph.ts` builds dependency edges only from SQL alias references (`CREATE VIEW ... AS ...`) — it does not account for plot `ON #N` references; if cell B has a plot `ON #2` that depends on cell A's second SQL block, and cell B's SQL is unrelated to cell A's alias, the graph has no A→B edge and `scheduleRun(B)` may run before A's data is available
**Where:** `runtime/executionGraph.ts:59-74` — `extractReferences` is called only on `referencedSql`; plot DSL blocks in `parsedContent.plotBlocksWithSqlIndex` are never scanned
**Observed:** `graphCells` is built in `ExecutorContext.tsx:45-52` using `referencedSql = parsed.sqlBlocks.join('\n')` — only SQL content, no plot DSL. Plot `ON` references are completely absent from the DAG. A plot that says `ON #2` where `#2` is in another cell will render with stale or empty data if that cell's SQL runs last.
**Expected:** Also scan plot DSL blocks for `ON <N>` and `ON <alias>` references, resolve them to producer cell ids, and add those as dependency edges.

### 🟠 [B-162] `ExecutorContext` `buildExecutionGraph` is recomputed on every render where `cells` array changes (via `useMemo([cells])`) — the `cells` array is `NotebookCellData[]` from `App.tsx` state, which is replaced on every `updateCell` call (including metadata writes from LINK_X pan gestures); this means the entire execution graph is rebuilt on every pan frame, which reconstructs all `parseCellContent` calls across all cells
**Where:** `context/ExecutorContext.tsx:44-57` — `graphCells` useMemo deps on `cells`, which changes on every metadata mutation
**Observed:** Each LINK_X pan gesture calls `onMetadataChange` → `updateCell` → `setCells` → new `cells` array → `graphCells` and `graph` useMemo both re-run → `Executor.updateGraph` is called. For a 10-cell notebook, this is 10 `parseCellContent` calls per pan frame.
**Expected:** Separate the mutable `metadata.variables` map from the cell structure used to compute the execution graph, so variable writes don't invalidate the graph memo.

### 🟠 [B-163] `Executor.scheduleRun` stores the in-flight promise in `runPromises.set(cellId, p)` — but the async closure also `await`s upstream deps before setting status to `'running'`; if `scheduleRun(A)` is called twice rapidly, the second call increments `myRunId` and the first call detects the id mismatch and returns early, but the second call's `p` is stored in `runPromises` before its `await deps` chain starts — so `awaitCell(A)` from cell B may resolve immediately against the new (not-yet-running) promise, then B runs before A finishes
**Where:** `runtime/executor.ts:81-103`
**Observed:** Timeline: `scheduleRun(A)` starts, saves `p1`; `scheduleRun(A)` called again, saves `p2` (replaces `p1`); B calls `awaitCell(A)` and gets `p2`; `p2` is async and hasn't awaited its own deps yet; `p2` resolves when A finishes; but B may have read `awaitCell(A)` and gotten `p2` while it was still mid-`await`-deps, meaning B started running. Actually `p2` doesn't resolve until A finishes, so the dependency chain is preserved. The real bug is if `runFn` rejects: `p` rejects, `runPromises.get(A)` holds a rejected promise, and future `awaitCell(A)` calls in downstream cells will throw, bypassing the `try { await } catch { }` guard that swallows errors — which means B proceeds after A failed. The bug is that swallowed errors allow downstream cells to run on stale/missing alias data.
**Expected:** Surface failed upstream cell status to dependents; don't silently continue downstream on upstream failure. At minimum, set a `failedDeps` flag rather than silently swallowing all errors.

### 🟡 [B-164] `buildExecutionGraph` `extractReferences` is called on the raw SQL text with `qualRe` to find qualified references (`handle.alias`) — but DuckDB `schema.table` dot-notation for numeric aliases like `cell_3.1` (where `1` is the `aliasOr1` default) does NOT match `qualRe = /\b([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\b/g` because `1` is not `[A-Za-z_][\w]*` — references to `cell_3.1` in SQL are silently ignored by the graph builder, so cells that reference a numbered alias won't have the dependency edge
**Where:** `services/templating/dependencies.ts:118-129` — `qualRe` requires both sides to start with a letter or underscore; `cell_3.1` has a digit-only right side
**Observed:** A SQL block `SELECT * FROM "cell_3"."1"` (the qualified path for a cell with no alias) will not produce a `qualified` reference because `1` fails `[A-Za-z_][\w]*`. The dependency edge from that cell to the referencing cell is missing.
**Expected:** Accept `[A-Za-z_0-9][\w]*` (or `[\w]+`) on the right side of the dot to also capture numeric aliases.

### 🟡 [B-165] `collectPrecedingCellVariables` walks cells in array order and calls `break` when it finds `currentCellId` — if `currentCellId` is not found (e.g. the cell was just created and isn't in the `cells` array yet), the loop runs to completion and returns ALL cells' variables, not just the preceding ones
**Where:** `utils/crossCellVariables.ts:17-27`
**Observed:** If `currentCellId` doesn't match any cell, the `if (c.id === currentCellId) break` never fires, and the function returns variables from every cell in the notebook including cells that come after the new cell. This was already noted as B-119-adjacent but is its own distinct bug.
**Expected:** Add an explicit found-flag; if `currentCellId` is never found, return `{}` (empty) rather than all cells' variables.

---

## Plot linter / diagnostics

### 🟠 [B-166] `lintQueryRef` uses `deps.sqlBlockCount` to validate `#N` query refs — but `sqlBlockCount` passed from `NotebookCell.tsx` to `SQLEditor` is the CURRENT CELL's SQL block count (which is zero for pure plot cells), not the notebook-wide count; so `lintQueryRef` always sees `sqlBlockCount = 0`, the early-exit guard `if (deps.sqlBlockCount <= 0) return` fires, and no out-of-range errors are ever reported for numeric query refs
**Where:** `components/editor/plot/lint.ts:362` — `if (deps.sqlBlockCount <= 0) return;`; `components/NotebookCell.tsx` prop threading
**Observed:** This is a consequence of B-159 (wrong `sqlBlockCount` prop). The linter silently skips ALL query-ref range validation. A user typing `ON #999` gets no error.
**Expected:** Pass the notebook-wide query count to `lintQueryRef`, same fix as B-159.

### 🟠 [B-167] `lintTail` validates `LINK_X` arguments by checking that bare idents are either `'master'`, `'clamp'`, or a known plot name — but `LINK_X($start, $end)` should take variable `$var` references, not plot names; if the user writes `LINK_X($a, $b, chartA)` where `chartA` is a legitimate named-plot sync target, the validator correctly passes it — but for `LINK_X($a, $b)` the bare-ident check is skipped (only `varRef` and `ident` nodes are checked, not the absence of idents) — the validator never checks that at least two `varRef` nodes exist, so `LINK_X()` (zero args) gets no error from this path
**Where:** `components/editor/plot/lint.ts:409-448` — `lintTail` for `LINK_` only warns if exactly 1 var exists; if 0 vars exist, no warning fires
**Observed:** `LINK_X()` with empty parens produces zero `varRef` children, so `vars.length === 1` is false, the single-var warning doesn't fire, and zero-arg LINK_X is silently accepted by the linter even though it will silently do nothing at runtime.
**Expected:** Add a check: `if (vars.length === 0) emit error "LINK_X requires at least two variables"`.

### 🟡 [B-168] `lintVarRef` skips the undefined-variable check for any `$varRef` that is a direct child of a `tail` node with a key starting with `LINK_` — but the check uses `parentTail?.kind === 'tail'` where `parentTail = node.parent?.kind === 'list' ? node.parent.parent : node.parent`; if the `varRef` is nested more than one level deep inside the tail's argument list (e.g. inside a function call within the args), `parentTail` will be some intermediate non-tail node and the LINK_ suppression won't fire, causing false "variable not defined" warnings for LINK_X output variables
**Where:** `components/editor/plot/lint.ts:509-512`
**Observed:** For `LINK_X($a, $b)` where the args list has `varRef` children of a `list` node, the path is `varRef → list → tail`; `node.parent?.kind === 'list' ? node.parent.parent : node.parent` correctly gets the `tail`. But a more deeply nested case would fail. This is fragile.
**Expected:** Walk up all ancestors looking for a `tail` ancestor with a LINK_-prefixed key, not just two levels.

### 🟡 [B-169] `hasMidTypingHoleAncestor` in `lint.ts` returns `true` for ANY `hole` node in the ancestor chain, suppressing ALL lint for the entire expression whenever the user is mid-typing — this is overly broad: if a cell has two plot calls and the user is mid-typing in the second, the first (fully typed) call also gets its lint suppressed because `walk` visits every node and the first call's nodes may have a `hole` somewhere in the global AST
**Where:** `components/editor/plot/lint.ts:119-131`
**Observed:** `walk(root, (node) => { if (hasMidTypingHoleAncestor(node)) return; … })` — the `walk` visits each node independently, and `hasMidTypingHoleAncestor` only walks UP from that specific node. So lint suppression is actually per-subtree, not global. The bug is the opposite: inside a composite `ROW(A, B)`, if node N inside child B has a `hole` ancestor, only N and B's subtree are suppressed. Child A still gets linted. So the per-node suppression is correct in structure, but `hasMidTypingHoleAncestor` unconditionally returns `true` for ANY hole kind — even resolved/completed holes that the parser left in the tree for a prior typing session — because there's no check on hole state (is this hole the CURRENT cursor position?).
**Expected:** Only suppress lint for a hole that corresponds to the current cursor position (e.g. check `hole.isActive` or `hole.pos === view.state.selection.main.head`), not all stale holes in the tree.

---

## plotBrushStore / gesture integration

### 🟠 [B-170] `plotBrushStore.publisherUnmounting` schedules a 1-second retention timer — but if the publisher cell REMOUNTS within that 1 second (e.g. due to a React StrictMode double-invoke or a hot-reload), `publish()` is called which cancels the timer; however if the cell NEVER remounts (genuine unmount), the 1-second timer fires `clear()` which calls `subs.forEach(entry => entry.fn(payload))` with `domain: null` — subscribers are notified with a null domain, and any subscriber that reacts to null by showing an empty state will flash briefly even if the publisher reappeared in the tree; worse, the `cellName` passed to `clear` at timer-fire time may be stale if `publisherUnmounting` was called multiple times with different cell names
**Where:** `services/plotBrushStore.ts:136-144`
**Observed:** `publisherUnmounting(name, cellName)` is called with the cell's current name. If the cell re-renders with a different name (e.g. `NAME "foo"` changed to `NAME "bar"`) and then unmounts, the timer fires `clear(name, 'foo')` even though the live cell had name `'bar'`. Subscribers receiving `cellName: 'foo'` in the null payload may misidentify the source.
**Expected:** Capture `cellName` fresh from the payload at timer-fire time, or store it in the timer closure separately.

### 🟠 [B-171] `usePlotGestures.onBrushChange` constructs `{ lo, hi }` from `data[startIndex][xKey]` and `data[endIndex][xKey]` — if `xKey` is undefined (not passed by the caller), it falls back to `(item as any).x`; but Recharts `ReferenceLine` brush events pass `startIndex`/`endIndex` as 0-based indices into the chart's rendered data array, NOT the full raw `data` prop — if LTTB decimation has run, the rendered array is shorter and `data[startIndex]` may be undefined or point to the wrong row
**Where:** `hooks/usePlotGestures.ts:58-61`
**Observed:** `const lo = startIndex != null ? getX(data[startIndex]) : undefined;` — `data` is the raw (pre-decimation) data array, but `startIndex`/`endIndex` are indices into the Recharts-internal decimated data. For a 10,000-row dataset decimated to 1,000 rows, `startIndex=50` means row 50 of the decimated array, but `data[50]` is row 50 of the raw array — a completely different row. The computed `lo/hi` values will be incorrect.
**Expected:** Pass the same decimated array to both Recharts and `usePlotGestures`, or map `startIndex`/`endIndex` back through the decimation index map.

### 🟡 [B-172] `linkScrollGroups.ts` `broadcastScrollPosition` uses a single module-level `debounceTimer` shared across all scroll groups — if two different scroll groups (e.g. `groupA` and `groupB`) both fire scroll events within 16ms of each other, the shared timer fires only once, executing the rAF for whichever group's `entry.pending` was set last; the first group's pending update is lost
**Where:** `stores/linkScrollGroups.ts:48-82`
**Observed:** `let debounceTimer: ReturnType<typeof setTimeout> | null = null;` is module-level, not per-group. If `broadcastScrollPosition('groupA', ...)` is called at t=0 and `broadcastScrollPosition('groupB', ...)` at t=5ms, the second call clears the first timer, and only `groupB`'s `entry.rafId` is set (via `entry.pending`). `groupA`'s rAF is cancelled and `groupA.pending` stays set but `rafId` is only registered for `groupB` (since `entry` = `groups.get(group)` uses the specific group's entry, so the rAF is per-group). Actually, re-reading: `entry.rafId` is per-entry (per-group), but `debounceTimer` is shared. When the second call fires, it cancels the first timer and sets a new one; the new timer fires the rAF only for `groupB`'s entry. `groupA`'s `rafId` was cancelled and `groupA.entry.pending` is still set, but nothing will trigger `groupA`'s rAF now.
**Expected:** Use a per-group debounce timer (`entry.debounceTimer`) instead of a module-level shared one.

---

## CellAliasContext / alias registration

### 🟠 [B-173] `CellAliasContext.buildAliasSql` uses `sanHandle.replace(/'/g, "''")` to escape the schema name in the `columnsQuery` string — but `sanHandle` is the `sanitizeForDuckDB`-processed handle, which replaces special chars with `_`; however, if a cell title is something like `it's a cell`, `sanitizeForDuckDB` would replace the `'` with `_`, making `sanHandle` = `it_s_a_cell`, and the escaping is redundant (no `'` remains); but if `sanitizeForDuckDB` is ever updated to preserve more characters, this assumption breaks; more critically, the `information_schema` query uses the sanHandle in a string literal inside the `WHERE` clause, not as a schema identifier, so identifier-quoting and literal-quoting are conflated
**Where:** `context/CellAliasContext.tsx:118-122`
**Observed:** The schema is used as both `${quoteIdent(sanHandle)}.${quoteIdent(aliasOr1)}` (identifier, correct) and `'${sanHandle.replace(...)}'` (literal in WHERE clause). If sanitization changes, the literal path is wrong.
**Expected:** Use a parameterized query or a DuckDB `quote_literal` call, matching the approach already used for identifiers.

### 🟠 [B-174] `CellAliasContext.unregisterCell` splits a qualified key on `.` with `key.split('.')` — if a cell handle contains a dot (e.g. a cell titled `v1.0`), `sanitizeForDuckDB` would replace `.` with `_`, so stored keys would be `v1_0.alias`; however, if a future version of `sanitizeForDuckDB` preserves dots, `key.split('.')[0]` would only get `v1` instead of `v1.0`, causing a malformed `DROP VIEW` statement
**Where:** `context/CellAliasContext.tsx:211-213` — `const [h, a] = key.split('.')`
**Observed:** `key.split('.')` splits on the FIRST dot only if using destructuring, but it actually splits on ALL dots. For a key like `schema.v1.alias`, `[h, a]` = `['schema', 'v1']`, and `alias` part is dropped. The `DROP VIEW` would target `schema.v1` instead of `schema.v1.alias`.
**Expected:** Use `key.indexOf('.')` to split at the first dot only: `const dotIdx = key.indexOf('.'); const h = key.slice(0, dotIdx); const a = key.slice(dotIdx + 1);`.

### 🟡 [B-175] `CellAliasContext.registerAlias` runs each alias SQL statement sequentially with `for (const stmt of built.statements) { await query(stmt); }` — if the `CREATE OR REPLACE TEMP TABLE` (materialized) statement fails partway through (after the schema was already created but before the table was created), the function returns `null` but the orphaned schema is left in DuckDB; on the next register call, `CREATE SCHEMA IF NOT EXISTS` succeeds silently but the old partial state persists
**Where:** `context/CellAliasContext.tsx:157-164`
**Observed:** Partial failure leaves the DuckDB schema created but the view/table missing. Subsequent `getByQualified` calls return `undefined` but DuckDB still has the schema. This is a minor resource leak, but if DuckDB ever counts schemas for performance reasons it accumulates.
**Expected:** Use a try/finally to drop the schema if any subsequent statement fails, or execute all statements in a single transaction (`BEGIN; …; COMMIT;`).

---

## validatePlotConfig / plotValidator

### 🟠 [B-176] `validatePlotConfig` calls `parsePlotCall` (not `parseComposite`) on each line-split config — composite expressions like `ROW(A, B)` or `A + B` are split on `\n` which may not split them correctly (a multi-line `ROW()` body stays on one line but `A\n+\nB` would split into three lines `A`, `+`, `B`); the `+` and `B` lines are passed individually to `parsePlotCall`, each of which fails validation as standalone configs
**Where:** `utils/plotValidator.ts:32-53`
**Observed:** `const configs = joinedConfig.split('\n').map(c => c.trim()).filter(Boolean)` — every non-blank line is treated as an independent plot config. A multi-line composite isn't joined before splitting. The join step above only collapses `\(\s*\n…\n\s*\)` patterns. A `ROW(A, B)` on a single line is fine, but `ROW(\n  A,\n  B\n)` would be joined; however an overlay `A\n+ B` (operator on a new line) would become `['A', '+ B']` — each half is parsed independently and fails.
**Expected:** Use `parseComposite` on the entire expanded config string rather than splitting on newlines, mirroring the `PlotRenderer` approach.

### 🟡 [B-177] `validatePlotConfig` checks `if (on && on.length > 1 && !plotRegistration.supportsMultiQuery)` — but `supportsMultiQuery` is not defined on most plot registrations (it's optional and absent from `HISTOGRAM`, `SCATTER_PLOT`, `BOX_PLOT`, `HEATMAP`, `FLAMEGRAPH`, `GANTT_CHART`, `RANGE`), defaulting to `undefined` which is falsy; so those plots will always fail this check if someone writes `ON 1, 2`, generating a spurious "does not support multiple queries" error even though `ON` routing is not implemented anyway (B-141)
**Where:** `utils/plotValidator.ts:45-47`
**Observed:** `HISTOGRAM`, `BOX_PLOT`, etc. have no `supportsMultiQuery` field. A user writing `HISTOGRAM(x:"t") ON 1, 2` gets the error `"Plot type HISTOGRAM does not support multiple queries"` — technically accurate, but inconsistent: `SCATTER_PLOT` also lacks the flag but happens to be unimplemented rather than explicitly `false`.
**Expected:** Either explicitly set `supportsMultiQuery: false` on all non-supporting types for clarity, or change the guard to `supportsMultiQuery === false` (strict false) rather than truthy check.

### 🟡 [B-178] `validatePlotConfig` uses `normalizePlotName` on the regex match but the same regex `mainConfig.match(/^(\w+)\s*\(/)` fails for composite expressions parsed via `parsePlotCall`; `parsePlotCall` for `ROW(A, B)` returns `mainConfig = 'ROW(A, B)'` since `ROW` is not stripped as a tail clause — `normalizePlotName('ROW')` may or may not be in the registry, and if not it returns `"Unknown plot type ROW"` error instead of recognizing the composite
**Where:** `utils/plotValidator.ts:37-39`
**Observed:** `plotRegistry` has no `ROW` or `COL` key — those are composite keywords, not plot registrations. Any cell config using `ROW(…)` or `COL(…)` top-level will always fail validator with `"Unknown plot type ROW"` even though PlotRenderer handles it correctly via `parseComposite`.
**Expected:** Check `parseComposite(singleConfig).composite` first; if it's a composite, skip the registry-check path and recurse into children.

---

## expandBrushOperator / variable substitution

### 🔴 [B-179] `expandBrushOperator` in `services/variableExpander.ts` is never imported or called in production code — it exists only in tests; brush-range SQL like `WHERE ts IN $gc.brush` is NOT expanded at runtime, so the DuckDB query receives the literal string `$gc.brush` as an unresolved variable, causing either a substitution failure (if variable check blocks the query) or a DuckDB syntax error ("unknown function `$gc`")
**Where:** `services/variableExpander.ts` — entire file; `grep` confirms no production import
**Observed:** `expandBrushOperator` is tested in `tests/variableExpander.test.ts` but never called from `components/NotebookCell.tsx`, `context/DuckDBContext.tsx`, or anywhere in the SQL execution path. The brush-range shorthand is documented but silently broken at runtime.
**Expected:** Call `expandBrushOperator(sql, allVariables)` before `substituteVariables` in `NotebookCell.tsx` `handleRun`, exactly as described in the function's own JSDoc.

### 🟠 [B-180] `NotebookCell.tsx` `handleCommitBlockName` strips the first comment line from a SQL block with `/^\s*--\s*[^\n]*\n/` — this regex also matches intentional SQL comments at the top of a block (e.g. `-- This query finds all GC pauses`); renaming a block whose first line is a non-alias comment silently discards that comment
**Where:** `components/NotebookCell.tsx:667`
**Observed:** `seg.content.replace(/^\s*--\s*[^\n]*\n/, '')` removes ANY leading `--` comment. A block like `-- explain the query\nSELECT ...` will have the explanation comment deleted whenever the block name is set.
**Expected:** Only strip comment lines that match the alias format (e.g. `-- alias <name>` or a configurable prefix), not all leading comments.

### 🟠 [B-181] `HeatmapPlot` hardcodes `height: 200` on the outer `div` wrapping `ResponsiveContainer` — unlike `GanttChartPlot` which computes a dynamic height from the data, the heatmap is always 200px regardless of the number of x/y categories; large heatmaps with 20×20 cells will be illegibly cramped
**Where:** `components/plots/HeatmapPlot.tsx:54` — `<div style={{ width: '100%', height: 200 }}>`
**Observed:** 200px static height for a 20-row heatmap means each row is ~8px — too small to see. The heatmap never auto-sizes from data.
**Expected:** Compute height from `yLabels.length * cellSize + margins`, similar to GanttChartPlot's `Math.max(320, chartData.length * 28 + 60)`.

### 🟡 [B-182] `GanttChartPlot` computes `chartHeight = Math.max(320, chartData.length * 28 + 60)` using `chartData.length` (number of rows) rather than the number of distinct `lane` values — if multiple rows share the same lane (e.g. 100 events on 5 lanes), the chart height is 100 * 28 + 60 = 2860px, far too tall
**Where:** `components/plots/GanttChartPlot.tsx:113`
**Observed:** `chartHeight` uses raw `chartData.length`. But Recharts CategoryAxis bands each `__rowLabel` value separately; if there are duplicate `__rowLabel` values (multiple rows with the same lane), Recharts stacks them all at the same y-position and only draws one band per distinct label. The height calculation overcounts.
**Expected:** Use `new Set(chartData.map(r => r.__rowLabel)).size` as the row count for height calculation.

### 🟡 [B-183] `findColumn` in `plotUtils.ts` falls back to returning `baseName` unchanged when no match is found — if a column doesn't exist in the data, `findColumn` silently returns the original name; `plotConfigParser.createConfigParser` then validates columns against data and throws an error — but `findColumn` is also used in the component body (e.g. `GanttChartPlot.tsx:62-65`) outside `parseConfig`, where the validation is not re-checked; a typo in `lane:` will silently return the typo'd name and `row[rCol]` returns `undefined` for all rows, rendering an empty y-axis with no error
**Where:** `utils/plotUtils.ts:76-83` `findColumn` fallback + `components/plots/GanttChartPlot.tsx:65`
**Observed:** `findColumn('wrongColName', allColumns)` returns `'wrongColName'`, and `row['wrongColName']` returns `undefined`, causing `__rowLabel: 'undefined'` for every row. The chart renders but with all tasks in a single `undefined` lane — no error is thrown.
**Expected:** `findColumn` should throw (or return `undefined`) when no match is found, matching the behavior of `createConfigParser` which validates columns at parse time.

### 🟡 [B-184] `plotFormatter.ts` `shouldBreakCallArgs` walks back from the comma to find the opening `(` by tracking `rparen`/`lparen` depth — but the bracket depth guard checks for brackets in tokens 0..commaIdx, re-scanning from the start; for a long config with many brackets, this is O(n²) for each comma in a long argument list
**Where:** `utils/plotFormatter.ts:282-323` — `shouldBreakCallArgs` is O(n) per call and called O(commas) times
**Observed:** For `LINE_CHART(x: "a", y: ["b","c","d","e","f","g","h"])` with 7 commas inside `[…]` and 3 outer commas, `shouldBreakCallArgs` scans from the beginning on every comma. For a config with 100+ params this becomes noticeable.
**Expected:** Track bracket/paren depth incrementally in the `emit` loop rather than re-scanning on every comma. This is a performance issue, not a correctness bug.

### 🟡 [B-185] `aiPlotSource.ts` `validatePlotStream` garbage-filter checks only the first non-whitespace character of `acc` against `VALID_START_CHARS` — but model responses often start with a valid char like `(` or `)` before a carriage-return + LF sequence, which after `.replace(/^\s+/, '')` strips the initial whitespace and leaves `\r` (carriage return, U+000D) as the first char; `\r` is not in `VALID_START_CHARS` and not matched by `/[A-Za-z0-9_]/`, so the entire suggestion is discarded as garbage even though it starts with a valid continuation
**Where:** `components/editor/plot/aiPlotSource.ts:126-129`
**Observed:** `firstNonWs = acc.replace(/^\s+/, '')` — `\s` in JavaScript regex matches `\t`, ` `, `\n`, `\r`, and others. So `\r` IS stripped by `\s+`. Actually `\r` IS whitespace per JS, so the first non-WS char would be the char after `\r`. The actual risk is a BOM (`﻿`) that some models prepend: BOM is not `\s` in JS regex (it's a zero-width space, not a whitespace), so `firstNonWs` would start with BOM which is not in `VALID_START_CHARS`, discarding the suggestion.
**Expected:** Also strip BOM (`﻿`) before the `VALID_START_CHARS` check: `acc.replace(/^[\s﻿]+/, '')`.

### 🟡 [B-186] `buildPlotAiContext` truncates `priorPlotCellsContent` by shifting from the front of the array in a while loop — `priors.shift()` mutates the array on each iteration, and `buildUser()` is called on every iteration to recompute tokens; for a context with 20 prior cells each at 1024 chars, this is 20 calls to `buildUser()` (each O(n) string join), totaling O(n²) work before settling on the trimmed set
**Where:** `components/editor/plot/aiPlotContext.ts:177-181`
**Observed:** `while (total > budget && priors.length > 0) { priors.shift(); user = buildUser(); total = … }` — `buildUser()` reconstructs the entire sections string on each iteration. For large prior-cell lists this is quadratic.
**Expected:** Binary-search the correct number of prior cells to include (by estimating tokens per cell), then call `buildUser()` once. Or compute cumulative token costs once and pick the cutoff index.

### 🟡 [B-187] `crossPlotAnnotator.ts` looks up named plots by exact string equality `ctx.scope.namedPlots.find(p => p.plotName === n.name)` — but `notebookPlotScope.ts` stores `plotName` as extracted from the raw DSL (with `stripQuotes` applied), while the user may have quoted the name differently (`NAME "Foo"` vs `NAME 'Foo'`); the comparison is case-sensitive, so a user referencing `foo` (lowercase) who named their plot `Foo` (uppercase) gets an "Unknown plot" diagnostic even if the names visually match
**Where:** `components/editor/plot/annotators/crossPlotAnnotator.ts:60`
**Observed:** `ctx.scope.namedPlots.find(p => p.plotName === n.name)` — case-sensitive comparison. `LINK_X(myPlot)` won't resolve if the plot is named `MyPlot`. Similarly `ON myplot` won't find `ON MyPlot`.
**Expected:** Use `.toLowerCase()` on both sides of the comparison, since plot names should be case-insensitive per the DSL design (other identifiers in the DSL are case-insensitive).

### 🟡 [B-188] `NotebookCell.tsx` `handleRun` (line 460) calls `onRunQuery(cell.id, sql, index, allVariables)` where `sql` is the RAW (unsubstituted) SQL from the segment — `substituteVariables` is called on line 464 ONLY for the alias registration path, not for the actual query execution; the execution receives the raw `$var` tokens which `onRunQuery` must substitute internally, but if `onRunQuery` does NOT call `substituteVariables`, the DuckDB query receives unresolved `$var` placeholders
**Where:** `components/NotebookCell.tsx:460-464`
**Observed:** `handleRun(sql, index)` where `sql` is `parsed.sqlBlocks[index]` — the raw content. `onRunQuery` is implemented in `App.tsx` and calls `substituteVariables` internally before sending to DuckDB. But if the substitution in `App.tsx` uses a DIFFERENT `allVariables` snapshot than the one `NotebookCell` passes (race condition between React state updates), the substituted values could be stale.
**Expected:** Substitute variables before passing to `onRunQuery` so the executed SQL matches the substituted alias registration SQL exactly.

---

## Plot constants / LET expansion

### 🟠 [B-189] `expandPlotConstants` splits the config on `\n` to find `LET` lines — a multi-line plot call like `LINE_CHART(\n  x: "time",\n  y: ["a", "b"]\n)` will have `LET @name = value` lines mixed with the plot call lines if the user places LET after the call; the `LET_LINE_RE` regex only matches lines that START with `LET` (preceded by optional whitespace), so a LET declaration indented inside a `row { … }` block will not be recognized and the constant remains undefined
**Where:** `utils/plotConstants.ts:35-43` — `LET_LINE_RE = /^\s*LET\s+@…/i` — anchored to start of line (`^`)
**Observed:** Inside a composite body: `row { LET @c = "red"\n  LINE_CHART(…) }` — the `LET` line is indented with a `row {` preamble above it. When the entire block is split on `\n`, the `LET` line starts with spaces/tabs which `\s*` handles — so it IS recognized. The real issue is that `LET` lines are only available in lines BEFORE the lines that use them (top-to-bottom pass). A LET declared after a plot that uses the constant will fail. This is by design but undocumented.
**Expected:** No code bug here — the top-to-bottom-only pass is intentional. But if the user declares `LET` lines after `row { }` they won't be visible inside the composite body's `@ref` uses. This should be documented as a constraint, or the pass should do two passes (collect all LETs, then substitute).

### 🟡 [B-190] `expandPlotConstants` emits an error string `"Line N: undefined constant @name"` and leaves `@name` in the output — the caller (`PlotRenderer`) calls `expandPlotConstants`, checks `expansion.errors.length > 0`, and throws the first error, preventing the chart from rendering; however, `validatePlotConfig` also calls `expandPlotConstants` and `return expansion.errors[0]` for the first error — if the user has a LET with a typo and uses `@ref` in multiple plots in the config, only the FIRST error is surfaced, the remaining `@ref` tokens pass through to the parser which may emit confusing "unknown column @name" errors
**Where:** `utils/plotValidator.ts:23-26` and `components/PlotRenderer.tsx:280-282`
**Observed:** `expansion.errors[0]` — only the first LET error is shown. If the user wrote `@x` and `@y` both undefined, only `@x`'s error is shown.
**Expected:** Join all errors with `\n` so the user sees all undefined constants at once (same way DuckDB surfaces multiple syntax errors).

Now there are no more unexamined source files with significant multi-plot/linking logic. Time to create the planning agent.

