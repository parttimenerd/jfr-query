# jfr-query bugs and UX issues

Last triaged: 2026-06-20
Triage source: codebase walkthrough (App.tsx, NotebookCell.tsx, SQLEditor.tsx, PlotConfigEditor.tsx, PlotRenderer.tsx, Sidebar.tsx, SettingsModal.tsx, SettingsPanel.tsx, ChatPanel.tsx, notebookParser.ts, variableSubstitution.ts, useHistoryState.ts) plus a live Playwright probe against http://localhost:3003 with `default.jfr`.

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
