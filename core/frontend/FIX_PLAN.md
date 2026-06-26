# Bug Fix Plan — jfr-query frontend (B-001 → B-190)

Generated: 2026-06-26. Source: BUGS.md codebase walkthrough, 190 documented issues.

---

## Priority Groups

### P0 — Critical (system-breaking, must fix first)

| Bug | File:line | Diagnosis | Fix strategy |
|-----|-----------|-----------|--------------|
| **B-179** | `services/variableExpander.ts` (never imported) | `expandBrushOperator` exists + tested but is NEVER called in production; `WHERE ts IN $gc.brush` is silently broken | Import and call before `substituteVariables` in `NotebookCell.tsx` `handleRun` |
| **B-141/142/143** | `components/PlotRenderer.tsx:265-354` | `ParsedPlotCall.on` parsed but never read; every chart leaf gets the same primary dataset | Thread multi-query result map through renderer; resolve `leaf.on` to correct dataset |
| **B-145** | `utils/plotParser.ts:134` | `ON #N` syntax fails — regex `(?:\w+\|\d+)` never matches `#N` | Extend alternation: `(?:#\d+\|\w+\|\d+)` |
| **B-144** | `utils/plotParser.ts:195-203` | `LINK_X(start, end)` without `$` silently dropped | Emit parse error or auto-prepend `$` with deprecation warning |
| **B-161** | `runtime/executionGraph.ts:59-74` | Plot `ON #N` cross-cell refs never add DAG edges; downstream plots run before upstream SQL | Scan `plotBlocksWithSqlIndex` for `on` refs, add producer→consumer edges |
| **B-162** | `context/ExecutorContext.tsx:44-57` | `graphCells` useMemo depends on full `cells` array; every `metadata.variables` write (every pan frame) rebuilds the execution graph | Derive stable structural key from `cell.id + cell.content`, memo on that |
| **B-101** | `services/AiService.ts:216-221` | `getModelFor` validProviders missing `anthropic`; any Anthropic call throws at runtime | Add `anthropic: true` + consult `AnthropicProvider.getMetadata().defaultModels[tier]` |
| **B-071** | `services/ai/BrowserModelProvider.ts` | No `stream()` method; in-browser AI throws `TypeError` on first stream call | Add `async *stream()` adapter that delegates to `getSuggestPlot()` and yields once |
| **B-084** | `services/ai/tools/runtime.ts` | `isForbiddenSql` bypassed by quoted `"$ai_providers"`; API keys could be exfiltrated | Regex: `/"?\$ai_providers"?/i` |

### P1 — High (significant user-visible breakage)

| Bug | File:line | Diagnosis | Fix strategy |
|-----|-----------|-----------|--------------|
| **B-166** | `components/editor/plot/lint.ts:362` | `lintQueryRef` always skips; `sqlBlockCount` is 0 (caused by B-159) | Fix B-159 first; thread notebook-wide count |
| **B-159** | `components/NotebookCell.tsx` | `sqlBlockCount` passed to SQLEditor is current-cell count, not notebook-wide | Compute from `notebookPlotScope` `queryIndexCounter` at App level |
| **B-172** | `stores/linkScrollGroups.ts:48` | Single module-level `debounceTimer` shared across all groups; concurrent scroll from two linked plots drops events | Move `debounceTimer` into `GroupEntry` struct |
| **B-176** | `utils/plotValidator.ts:32` | Uses `split('\n')` on config, breaks composites spanning multiple lines | Replace with `parseComposite` + recurse into children |
| **B-177** | `utils/plotValidator.ts:45` | `supportsMultiQuery` is `undefined` on most plot types → `!undefined` is truthy → spurious "does not support multiple queries" errors | Use strict `=== false` check |
| **B-178** | `utils/plotValidator.ts:37` | `ROW(…)`/`COL(…)` always fails as "Unknown plot type ROW" | Detect composite via `parseComposite` before registry lookup |
| **B-148/149/150** | `components/PlotRenderer.tsx:99,185` | `debouncedOnVariableChange` recreated every pan frame (debounce never fires); wheel listener re-registered every render; per-pan writes go to `metadata.variables` causing 60fps notebook re-renders | Stable callback ref + useMemo debounce; route zoom writes through `plotBrushStore` not `metadata.variables` |
| **B-106** | `components/PlotRenderer.tsx:284` | Config split on `'\n\n'` breaks multi-line tails and quoted strings containing blank lines | Replace with AST-based top-level call splitter from `parseComposite` |
| **B-103** | All AI providers | `streamChatWithTools` collects full response then yields once — not real streaming | Use native SSE streaming for Anthropic, OpenAI, Gemini |
| **B-107/181** | `components/plots/HeatmapPlot.tsx:54` | Hardcoded `height: 200` on outer div | `height: '100%'` |
| **B-108/182** | `components/plots/GanttChartPlot.tsx:113` | Height uses raw row count not distinct lane count → undersized chart | `new Set(chartData.map(r => r.__rowLabel)).size * 28 + 60` |
| **B-127** | `components/plots/HistogramPlot.tsx:33` | `domainX` prop ignored | `domain={domainX ?? config.xDomain}` |
| **B-129** | `components/plots/BarChartPlot.tsx:69-77` | `lineY` overlay shares single Y axis; different-scale series collapse to zero | Add secondary `YAxis yAxisId="right"` |
| **B-073** | `utils/plotUtils.ts:78-100` | `findColumn` case-sensitive and breaks on backslash-containing names | `new RegExp(escaped, 'i')` with proper backslash escaping |
| **B-109/136** | `components/ChatPanel.tsx:238`, `InlineChat.tsx:192` | Single-match regex replaces wrong plot block when cell has multiple plots | Tokenize; locate by index; replace by offset |
| **B-095** | `components/editor/sql/dispatcher.ts:103` | Returns `null` when schema unloaded → completions silently disappear | Return SQL keyword fallback list |
| **B-113/114/115** | `components/DataTable.tsx:44,104,200` | `isDurationLike` cap too low; BigInt sort falls back to lex; CSV exports formatted timestamps | Raise cap; explicit BigInt sort; export raw values |
| **B-133** | `context/DuckDBContext.tsx:116-118` | BigInt→Number loses precision for nanosecond timestamps above MAX_SAFE_INTEGER | Keep as BigInt; convert only at display time |
| **B-118** | `components/PlotRenderer.tsx:63-73` | AI error-fixer fires synchronously on every render | 500ms debounce + abort prior request |
| **B-104** | `services/ai/LocalAiProvider.ts:248-266` | Parses `<tool>` tags even when `tools=[]`; hallucinated tags routed as tool calls | Skip `parseLocalToolCalls` when `tools.length === 0` |

### P2 — Medium (incorrect behavior, workarounds exist)

- **B-075** — `aiPlotContext.ts` silently drops cells; surface `trimmed: boolean` flag
- **B-076** — `extractPlotMetadata` only processes first call in composite scripts
- **B-077** — `PlotSchemaDiscovery` cache never invalidates on schema change
- **B-078** — `annotateColumns` hardcodes clause names; consult registered shape params
- **B-079** — `lintTail` fires on mid-typing partial keywords (noise)
- **B-080** — `lint.ts` `unknown-column` fires for `$variable` refs; skip `$`-prefixed idents
- **B-081** — `plotSchemaDiscoveryEnabled` defaults false; document or enable
- **B-082** — Schema discovery races with cell execution; add loading gate
- **B-085** — AI `runQuery`/`sampleRows` hard-cap 100 rows; add page/offset
- **B-086** — Sanitized-mode distinct counts run on render thread; move to SQL/worker
- **B-087** — `plotSuggestOfflineOnly` throws without heuristic fallback; chain ONNX→heuristic→`TABLE()`
- **B-088** — 404 on missing `decoder_model_merged.onnx` silently swallowed; surface toast + fallback
- **B-089** — `heuristicPlot` picks stacked AREA for independent series
- **B-090** — `classifyColumns` treats BIGINT `startTime` as time without unit awareness
- **B-091** — `RangeSlider` wraps on fast-drag; clamp + throttle
- **B-092** — `FilterModal` `recordingStart/End` not bound to actual data extents
- **B-093** — `RangeSlider` lacks keyboard text input
- **B-094** — `FilterModal` sends malformed ISO strings on DST boundary
- **B-096** — SQL completions missing cross-cell CTE/view refs from `notebookPlotScope`
- **B-097** — Plot registry coverage test expects 12 keys, now 13 (Task #452 pending)
- **B-098** — `handleCommitBlockName` strips any leading `--` comment from SQL (Task #453)
- **B-099/B-165** — `collectPrecedingCellVariables` returns all cells when ID not found (Task #454)
- **B-100** — `variableUsage` plotBlocks sparse indexing (Task #455)
- **B-102** — `streamChatWithTools` sends only schema payload as systemInstruction; add real role/tool guidance
- **B-105** — No streaming cancel UX for partial tool calls
- **B-110** — `PlotRenderer` outer catch uses `e.fixContext` without type guard
- **B-111** — `executionGraph` Kahn's uses `Array.shift` → O(n²); use index pointer
- **B-112** — `Executor.scheduleRun` leaves stale `'running'` status on abandoned runs
- **B-116** — `buildSmartTemplate` returns `null` cast as any; return `''`
- **B-117** — `buildSmartTemplate` for PIE_CHART uses deprecated `name:`; switch to `category:`
- **B-119** — `substituteVariables` always runs 10 passes; detect convergence and short-circuit
- **B-120** — `parseFrontMatter` inline-YAML regex strips structured values; switch to `js-yaml`
- **B-128** — `ScatterPlot` size domain `[min,max]` with `min===max` → NaN sizing
- **B-130** — `validFor` regex allows hyphens in identifiers; remove `-`
- **B-132** — `SHAPE_MAP` missing `AREA_CHART` and `RANGE`
- **B-134** — `fetchSchemaFor` manual escape paths; use parameterized quoting
- **B-135** — `executeQuery` only guards SELECT against unready state; DDL statements unguarded
- **B-137** — Deprecated `useFullContext` toggle overrides `chatVisibility` dropdown
- **B-138** — `InlineChat.handleSend` clears `approvalResolvers` without rejecting pending promises
- **B-139** — `plotBrushStore.subscribe` cycle detection misses pre-publish subscribe
- **B-140** — Re-entrant `clampToRange` from subscriber callback; queue via `queueMicrotask`
- **B-146** — `LINK-Y`/`LINK-XY` require double-quoted variable; add bare-identifier form
- **B-147** — `notebookPlotScope.ts:329` dead ternary — both branches identical; reconstruct full dotted path
- **B-148** — See P1 (also touches debounce stability)
- **B-151** — `queryIndexCounter` increments for current-cell SQL but `queryRefs.push` skips current cell
- **B-152** — `VIEW_ALIAS_RE` rejects double-quoted view names
- **B-153** — `splitTopLevelOp` mishandles `\\` escapes in string literals
- **B-154** — `parsePlotCall` LINK_X paren-arg regex allows non-`$` args silently
- **B-155** — `parseComposite` overlay split fires on `+` inside string literals
- **B-156** — `LINK_X` clamp assumes sorted data; use `Math.min/max` over data
- **B-157** — `parsePlotCall` doesn't strip `#` line comments before LINK_X regex
- **B-158** — Cross-cell LINK_X via `metadata.variables` doesn't actually sync; document or move to shared store
- **B-160** — `notebookPlotScope.ts` uses `parsePlotCall` on composite strings; misses inner `linkX` refs
- **B-163** — Failed upstream cell causes downstream to run with stale data (silent swallow in executor)
- **B-164** — `qualRe` in `executionGraph` rejects numeric right-side aliases like `cell_3.1`
- **B-167** — `lintTail` accepts zero-arg `LINK_X()` with no error
- **B-168** — `lintVarRef` parent-tail walk only 2 levels deep (fragile)
- **B-169** — `hasMidTypingHoleAncestor` over-suppresses lint for stale holes, not just current cursor
- **B-170** — `publisherUnmounting` captures stale `cellName` at timer-fire time
- **B-171** — Brush gesture indices reference raw array but data may be LTTB-decimated
- **B-173** — `CellAliasContext.buildAliasSql` conflates identifier and literal quoting in `columnsQuery`
- **B-174** — `CellAliasContext.unregisterCell` naive `.split('.')` breaks on dotted alias names
- **B-175** — Partial alias registration failure leaves orphaned schema entries
- **B-180** — `handleCommitBlockName` strips any leading `--` comment from SQL body
- **B-183** — `findColumn` fallback returns typo'd name silently (returns `undefined` for all rows)
- **B-186** — `buildPlotAiContext` prior-cell truncation loop is O(n²): `priors.shift()` + `buildUser()` on every iteration
- **B-187** — `crossPlotAnnotator` case-sensitive plot name comparison; `LINK_X(MyPlot)` won't resolve if named `myplot`
- **B-188** — `handleRun` passes unsubstituted SQL to `onRunQuery`; substitution is only used for alias registration
- **B-189** — `LET` requires forward-reference ordering but constraint is undocumented
- **B-190** — Multiple LET expansion errors collapsed to first; join all with `\n`

### P3 — Low / Polish

B-005, B-015, B-020, B-033, B-039, B-043, B-051, B-052, B-053, B-054, B-055, B-057, B-060, B-062, B-064, B-065, B-072, B-083, B-089 (partial), B-090 (partial), B-091 (partial), B-093 (partial), B-105, B-121, B-122, B-123, B-124, B-125, B-126, B-131, B-154, B-155, B-182, B-184, B-185

One-line fixes; no dedicated test infrastructure needed. Address after all P0–P2 are resolved.

---

## Dependency Order

Fix in this sequence so each batch builds on stable foundations:

1. **B-179** must come before any brush-range integration tests (the test harness needs working wire-up to validate).
2. **B-145** (`#N` regex) must come before **B-141/142/143** (multi-query routing requires the parser to emit `on` refs first).
3. **B-159** (notebook-wide `sqlBlockCount`) must come before **B-166** (linter cannot validate query refs without it) and **B-151**.
4. **B-141/142/143** (routing) must come before **B-074** (`supportsMultiQuery` flag becomes testable).
5. **B-161** (graph `ON` edges) requires **B-145** to be resolved so the parser emits refs the graph scanner can read.
6. **B-176** + **B-178** (validator uses `parseComposite`) must come before **B-177** (strict `=== false` check); `ROW/COL` must dispatch before per-leaf validation runs.
7. **B-148/149** (stable callback chain) must come before **B-150** (extracting zoom writes out of `metadata.variables` requires a stable dispatch path).
8. **B-162** (graph memo stability) is most effective after **B-150** — until pan stops writing `metadata.variables` at 60fps the cells reference will continue to churn regardless of the memo key.
9. **B-101** must come before **B-102** (model resolution must work before system-prompt fix is testable for Anthropic).
10. **B-071** must come before **B-087/B-088** (the offline fallback chain only matters if the local provider's `stream()` resolves).
11. **B-099 = B-165** — fixing one closes both.

---

## Fix Batches

### Batch 1 — Brush operator wire-up _(S, unit + integration)_
**Bugs:** B-179  
**Files:** `components/NotebookCell.tsx` (handleRun), `services/variableExpander.ts` (import)  
**Test:** Integration test asserting `WHERE ts IN $gc.brush` → `BETWEEN lo AND hi`; assert query skips when brush is unset. Re-enable existing `variableExpander.test.ts` suite.

### Batch 2 — Plot parser corrections _(M, unit)_
**Bugs:** B-144, B-145, B-146, B-153, B-155, B-157, B-160  
**Files:** `utils/plotParser.ts`, `components/editor/plot/notebookPlotScope.ts`  
**Test:** Parser unit tests for `ON #1`, bare `LINK-Y $v`, comment-stripping, escape handling, composite recursion.

### Batch 3 — Multi-query routing in renderer _(L, integration + Playwright)_
**Bugs:** B-141, B-142, B-143, B-074  
**Files:** `components/PlotRenderer.tsx`, `components/plots/CompositeRenderer.tsx`, `components/NotebookCell.tsx`  
**Test:** Playwright: cell with 2 SQL blocks + `LINE_CHART(...) ON #1; BAR_CHART(...) ON #2` renders each from its own dataset.

### Batch 4 — Plot validator overhaul _(M, unit)_
**Bugs:** B-176, B-177, B-178  
**Files:** `utils/plotValidator.ts`  
**Test:** Unit tests for `ROW(A+B, C)`, multi-line configs, `supportsMultiQuery` strict-false check.

### Batch 5 — Execution graph correctness _(M, unit)_
**Bugs:** B-161, B-162, B-164  
**Files:** `runtime/executionGraph.ts`, `context/ExecutorContext.tsx`  
**Test:** Unit test that plot `ON #2` in cell B adds edge to producer cell. Perf test: 100 variable writes don't rebuild graph.

### Batch 6 — Linter sqlBlockCount + variable lints _(S, unit)_
**Bugs:** B-159, B-166, B-167, B-168, B-169, B-151  
**Files:** `components/NotebookCell.tsx`, `components/editor/plot/lint.ts`  
**Test:** Lint snapshot tests for `ON #999` (error), zero-arg `LINK_X()` (error), stale-hole over-suppression.

### Batch 7 — Interactive plot gesture stability _(L, integration + Playwright)_
**Bugs:** B-148, B-149, B-150  
**Files:** `components/PlotRenderer.tsx`, `services/plotBrushStore.ts` (extend for zoom)  
**Test:** Playwright: pan a linked plot → sibling cells sync. Verify `cells` reference is NOT replaced on each frame via `React.Profiler`.

### Batch 8 — Config block splitting _(S, unit)_
**Bugs:** B-106  
**Files:** `components/PlotRenderer.tsx`  
**Test:** Snapshot tests for `TITLE "A\n\nB"` (stays one plot) and multi-plot blocks (splits correctly).

### Batch 9 — AI provider correctness _(M, unit + integration)_
**Bugs:** B-101, B-102, B-071, B-072, B-083, B-084, B-104  
**Files:** `services/AiService.ts`, `services/ai/BrowserModelProvider.ts`, `components/editor/plot/aiPlotContext.ts`, `services/ai/tools/runtime.ts`  
**Test:** Unit tests for `isForbiddenSql` (quoted variants), `getModelFor('anthropic')`. Mock Anthropic provider end-to-end.

### Batch 10 — Real streaming _(L, manual smoke)_
**Bugs:** B-103, B-105  
**Files:** All provider implementations  
**Test:** Manual smoke with each provider; verify cancel button works mid-stream.

### Batch 11 — Scroll groups + brush store concurrency _(S, unit)_
**Bugs:** B-172, B-139, B-140, B-170, B-171  
**Files:** `stores/linkScrollGroups.ts`, `services/plotBrushStore.ts`, `hooks/usePlotGestures.ts`  
**Test:** Unit tests for two concurrent groups, re-entrant publish, decimation index mapping.

### Batch 12 — Plot rendering polish _(M, snapshot + Playwright)_
**Bugs:** B-107/181, B-108/182, B-127, B-129, B-128, B-116, B-117  
**Files:** `HeatmapPlot.tsx`, `GanttChartPlot.tsx`, `HistogramPlot.tsx`, `BarChartPlot.tsx`, `ScatterPlot.tsx`  
**Test:** Snapshot tests + Playwright smoke for `BAR_CHART` with `lineY` overlay.

### Batch 13 — DataTable + DuckDB context _(S, unit)_
**Bugs:** B-113, B-114, B-115, B-133, B-134, B-135  
**Files:** `components/DataTable.tsx`, `context/DuckDBContext.tsx`  
**Test:** Unit tests for BigInt sort, CSV round-trip, `isDurationLike` with 1.8×10⁹ µs.

### Batch 14 — Chat panel + InlineChat fixes _(S, unit)_
**Bugs:** B-109, B-136, B-137, B-138  
**Files:** `components/ChatPanel.tsx`, `components/InlineChat.tsx`  
**Test:** Unit test: cell with 2 plot blocks, apply AI result to second — verify second is replaced.

### Batch 15 — Editor completions + lint polish _(M, unit)_
**Bugs:** B-095, B-096, B-130, B-132, B-152, B-080, B-187  
**Files:** `components/editor/sql/dispatcher.ts`, `components/editor/sql/providers/symbols.ts`, `components/editor/plot/lint.ts`, `crossPlotAnnotator.ts`  
**Test:** Completion snapshot tests: empty schema, post-CREATE-VIEW, quoted view names, case-insensitive plot name lookup.

### Batch 16 — Variable substitution + cell handling _(S, unit)_
**Bugs:** B-119, B-120, B-180, B-188, B-189, B-190, B-099/B-165, B-098, B-100  
**Files:** `utils/variableSubstitution.ts`, `utils/notebookParser.ts`, `components/NotebookCell.tsx`, `utils/crossCellVariables.ts`, `utils/plotConstants.ts`  
**Test:** Unit tests for cycle short-circuit, comment-stripping in block names, sparse plotBlocks indexing.

### Batch 17 — Schema discovery + ML _(M, manual smoke)_
**Bugs:** B-075, B-076, B-077, B-078, B-081, B-085, B-086, B-087, B-088, B-089, B-090, B-091, B-092, B-093, B-094  
**Files:** `components/editor/plot/schemaProvider.tsx`, `annotators/columnAnnotator.ts`, `services/ml/PlotGenerationService.ts`, `heuristicPlot.ts`, `components/FilterModal.tsx`, `components/RangeSlider.tsx`  
**Test:** Manual smoke for offline mode, FilterModal date bounds.

### Batch 18 — CellAliasContext + Executor _(S, unit)_
**Bugs:** B-111, B-112, B-163, B-173, B-174, B-175  
**Files:** `runtime/executionGraph.ts`, `runtime/executor.ts`, `context/CellAliasContext.tsx`  
**Test:** Unit tests for run-id race, partial-failure schema cleanup, qualified-key split with embedded dots.

### Batch 19 — P3 cosmetic + remaining polish _(one-line fixes)_
All remaining P3 bugs. Small per-file PRs; no dedicated test infrastructure.

---

## Individual Fix Notes (P0 / P1)

### B-179 — Wire up `expandBrushOperator`

**File:** `components/NotebookCell.tsx` — `handleRun` function (around the SQL execution path)

**Broken:**
```ts
// handleRun — simplified
const substituted = substituteVariables(sql, allVariables);
await onRunQuery(cell.id, sql, index, allVariables);   // raw sql, not substituted!
```

**Fixed:**
```ts
import { expandBrushOperator } from '../services/variableExpander';

// in handleRun:
const expanded = expandBrushOperator(sql, allVariables);
const substituted = substituteVariables(expanded, allVariables);
await onRunQuery(cell.id, substituted, index, allVariables);
```

**Why correct:** `expandBrushOperator` handles the unresolved-brush case by leaving the `IN $...brush` token in place, so `substituteVariables`'s unresolved-variable check skips execution with a clear message. Calling it before substitution is exactly what the JSDoc instructs. Existing `variableExpander.test.ts` suite covers it.

---

### B-141/142/143 — Multi-query routing in PlotRenderer

**File:** `components/PlotRenderer.tsx:265-354`, `components/NotebookCell.tsx`, `components/plots/CompositeRenderer.tsx`

**Broken:** `data: any[]` forwarded identically to every chart leaf; `parsed.on` never read.

**Fix outline:**
1. Change the `data` prop to `dataByQueryRef: Record<string | number, any[]>` plus a fallback `primaryData: any[]`.
2. In each chart leaf/composite renderer, compute:
   ```ts
   const leafData = resolveDataForOn(leaf.on, dataByQueryRef) ?? primaryData;
   ```
3. In `NotebookCell.tsx`, build the map from `results[cell.id]` keyed by the `parsedContent.plotBlocksWithSqlIndex` association and global query index.
4. Implement `resolveDataForOn(onRefs, map)` — iterate `onRefs`, parse numeric index vs alias string, look up in map, return first hit.

---

### B-145 — `ON #N` regex

**File:** `utils/plotParser.ts:134`

**Broken:**
```ts
/(?<!\w)ON\s+((?:\w+|\d+)(?:\s*,\s*(?:\w+|\d+))*)\s*$/i
```

**Fixed:**
```ts
/(?<!\w)ON\s+((?:#\d+|\w+|\d+)(?:\s*,\s*(?:#\d+|\w+|\d+))*)\s*$/i
```

Then in the consumer strip the optional `#` prefix and tag as a numeric query-index ref.

---

### B-161 — Plot ON refs missing from execution graph

**File:** `runtime/executionGraph.ts:59-74`

**Fix:** After scanning `parsedContent.sqlBlocks` for alias refs, also scan each cell's `plotBlocks`:
```ts
for (const plotBlock of parsed.plotBlocksWithSqlIndex) {
  const call = parsePlotCall(plotBlock.content);
  for (const ref of call.on ?? []) {
    const normalized = ref.startsWith('#') ? parseInt(ref.slice(1)) : ref;
    const producerId = resolveQueryRef(normalized, allCells);
    if (producerId && producerId !== cell.id) graph.addEdge(producerId, cell.id);
  }
}
```

---

### B-162 — Stabilize `graphCells` memo

**File:** `context/ExecutorContext.tsx:44-57`

**Broken:**
```ts
const graphCells = useMemo(() => cells.map(c => ({ ... })), [cells]);
```

**Fixed:**
```ts
const graphStructKey = useMemo(
  () => cells.map(c => `${c.id}:${c.content}`).join('\n'),
  [cells],
);
const graphCells = useMemo(() => cells.map(c => ({ ... })), [graphStructKey]);
```

`metadata.variables` changes don't alter `c.content`, so the graph is only rebuilt when actual cell code changes.

---

### B-166 / B-159 — Notebook-wide `sqlBlockCount`

**Files:** `components/NotebookCell.tsx`, `components/editor/plot/lint.ts:362`

**Fix:**
1. In `App.tsx` or wherever the notebook renders, compute:
   ```ts
   const notebookSqlBlockCount = cells.reduce(
     (sum, c) => sum + parseCellContent(c.content).sqlBlocks.length, 0
   );
   ```
2. Thread through `NotebookCell` → `PlotConfigEditor` → `lint.ts` via existing `sqlBlockCount` prop.
3. Lint's early-exit `if (deps.sqlBlockCount <= 0) return` then only fires when there are truly zero SQL blocks notebook-wide.

---

### B-172 — Per-group scroll debounce

**File:** `stores/linkScrollGroups.ts:48`

**Broken:** `let debounceTimer` at module scope.

**Fixed:** Move into `GroupEntry`:
```ts
interface GroupEntry {
  subscribers: Map<string, ScrollCallback>;
  last: ScrollPosition;
  rafId: number | null;
  pending: ScrollPosition | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;  // ← was module-level
}
// in broadcastScrollPosition(groupId, pos):
const entry = groups.get(groupId)!;
if (entry.debounceTimer !== null) clearTimeout(entry.debounceTimer);
entry.debounceTimer = setTimeout(() => {
  entry.debounceTimer = null;
  doFlush(entry, pos);
}, 16);
```

---

### B-176/178 — Validator uses `parseComposite`

**File:** `utils/plotValidator.ts:32-53`

**Fixed:**
```ts
import { parseComposite } from './plotParser';

export function validatePlotConfig(configLine: string, data: any[]): string | null {
  const parsed = parseComposite(configLine.trim());
  if (parsed.composite) {
    for (const child of parsed.composite.children) {
      const err = validatePlotConfig(child.mainConfig, data);
      if (err) return err;
    }
    return null;
  }
  // existing single-call validation path below
  // ...
}
```

---

### B-177 — `supportsMultiQuery` strict check

**File:** `utils/plotValidator.ts:45`

**Broken:**
```ts
if (on && on.length > 1 && !plotRegistration.supportsMultiQuery)
```
`!undefined` is `true` → every type without the field explicitly set fires a spurious error.

**Fixed:**
```ts
if (on && on.length > 1 && plotRegistration.supportsMultiQuery === false)
```

---

### B-101 — Anthropic in `getModelFor`

**File:** `services/AiService.ts:216-221`

**Fix:** Add `anthropic` to the valid-provider map and add setting keys `anthropicTinyModel`, `anthropicBasicModel`, `anthropicGoodModel`. When a setting is blank, fall back to `AnthropicProvider.getMetadata().defaultModels[tier]`.

---

### B-071 — BrowserModelProvider `stream()` adapter

**File:** `services/ai/BrowserModelProvider.ts`

**Fix:**
```ts
async *stream(
  system: string,
  user: string,
  signal?: AbortSignal,
): AsyncIterable<string> {
  if (signal?.aborted) return;
  const out = await this.getSuggestPlot({ system, user });
  if (signal?.aborted) return;
  yield out;
}
```

---

### B-084 — `isForbiddenSql` bypass via quoted identifier

**File:** `services/ai/tools/runtime.ts`

**Broken:** `/\$ai_providers/i` — misses `"$ai_providers"`.

**Fixed:**
```ts
const FORBIDDEN_RE = /"?\$ai_providers"?/i;
```

---

### B-148/149/150 — Gesture stability + zoom store

**File:** `components/PlotRenderer.tsx`

**Step 1 — stable debounce:**
```ts
const cbRef = useRef(onVariableChange);
cbRef.current = onVariableChange;
const stableOnVar = useCallback((p: Variables) => cbRef.current(p), []);
const debouncedOnVar = useMemo(() => debounce(stableOnVar, 200), [stableOnVar]);
```

**Step 2 — stable wheel listener:**
```ts
const handleInteraction = useCallback((e: WheelEvent) => {
  // ...gesture logic...
}, [plotId, debouncedOnVar]);

useEffect(() => {
  ref.current?.addEventListener('wheel', handleInteraction, { passive: false });
  return () => ref.current?.removeEventListener('wheel', handleInteraction);
}, [handleInteraction]);
```

**Step 3 — zoom via brush store not metadata.variables:**
```ts
// Instead of:
onVariableChange({ ...vars, [startVar]: newStart, [endVar]: newEnd });
// Use:
plotBrushStore.publish(plotId, { start: newStart, end: newEnd });
```
Other linked plots subscribe via `plotBrushStore.subscribe` and update their local view range without touching the notebook's `cells` array at all.

---

### B-106 — Config block splitting

**File:** `components/PlotRenderer.tsx:284`

**Broken:** `effectiveConfig.split('\n\n')` — breaks on blank lines inside quoted strings or multi-line tails.

**Fixed:** Use the parser for top-level statement boundaries:
```ts
import { parseComposite } from '../utils/plotParser';
// Split by finding top-level non-composite calls (each separated by a full blank line or semicolon at depth 0).
// For now, use a bracket-depth tracker instead of naive split.
const configs = splitTopLevelConfigs(effectiveConfig); // new utility
```
Implement `splitTopLevelConfigs` analogous to `splitTopLevelOp` in `plotParser.ts` — split only at blank-line boundaries that are at nesting depth 0.

---

### B-095 — SQL completion fallback

**File:** `components/editor/sql/dispatcher.ts:103`

**Fixed:**
```ts
if (!ctx.schema) {
  return {
    from,
    options: SQL_KEYWORDS.map(k => ({ label: k, type: 'keyword' as const })),
  };
}
```

---

### B-073 — `findColumn` case-insensitive + escape-safe

**File:** `utils/plotUtils.ts:78-100`

**Fixed:**
```ts
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// ...
const pattern = new RegExp(`^\\d+_${escapeRegex(col)}$`, 'i');
const match = columnNames.find(c => pattern.test(c));
return match ?? col;  // return original name, not the regex-mutated one
```

---

### B-104 — LocalAiProvider tool-tag false-positive

**File:** `services/ai/LocalAiProvider.ts:248-266`

**Fixed:**
```ts
const toolCalls = tools.length > 0 ? parseLocalToolCalls(content) : [];
```

---

## Critical Files for Implementation

| File | Primary Batches |
|------|----------------|
| `components/NotebookCell.tsx` | 1, 3, 6, 16 |
| `components/PlotRenderer.tsx` | 3, 7, 8, 11 |
| `utils/plotParser.ts` | 2 |
| `runtime/executionGraph.ts` | 5, 18 |
| `services/variableExpander.ts` | 1 |
| `utils/plotValidator.ts` | 4 |
| `components/editor/plot/lint.ts` | 6, 15 |
| `stores/linkScrollGroups.ts` | 11 |
| `services/plotBrushStore.ts` | 7, 11 |
| `services/AiService.ts` | 9 |
| `services/ai/BrowserModelProvider.ts` | 9 |
| `context/ExecutorContext.tsx` | 5 |
| `context/CellAliasContext.tsx` | 18 |
| `components/plots/HeatmapPlot.tsx` | 12 |
| `components/plots/GanttChartPlot.tsx` | 12 |
| `components/plots/BarChartPlot.tsx` | 12 |
| `components/plots/HistogramPlot.tsx` | 12 |
| `components/DataTable.tsx` | 13 |
| `context/DuckDBContext.tsx` | 13 |
| `components/ChatPanel.tsx` | 14 |
| `components/InlineChat.tsx` | 14 |
| `components/editor/sql/dispatcher.ts` | 15 |
| `utils/variableSubstitution.ts` | 16 |
| `utils/crossCellVariables.ts` | 16 |
| `runtime/executor.ts` | 18 |
