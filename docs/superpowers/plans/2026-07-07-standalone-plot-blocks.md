# Standalone Plot Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `+ Add Plot` button at the bottom of every cell so users can insert a standalone plot block that queries a DuckDB table or view directly (via `DATASET <name>`) rather than requiring a preceding SQL block.

**Architecture:** Today, `parseCellContent` in `notebookParser.ts` silently drops any `plot` segment that has no preceding SQL block (`currentSqlIndex < 0`). We introduce a new `standalonePlots` array on `ParsedCellContent` for plots that do *not* follow a SQL block. `NotebookCell.tsx` renders these standalone plots with their own `DATASET`-backed data fetch (the `datasetResults` map already handles `DATASET <name>` queries). The `+ Add Plot` button appends a new plot segment to the cell, defaulting to `TABLE() DATASET GarbageCollection` (or the first table in schema if available). The hover insert bar's `+ Plot` already handles mid-cell insertions; its behaviour is unchanged.

**Tech Stack:** TypeScript, React, Vitest (tests), DuckDB-WASM (data), CodeMirror 6 (plot editor)

---

## Background: key types and files

### `CellSegment` (notebookParser.ts line 277)
```typescript
export type CellSegment =
  | { type: 'markdown'; content: string }
  | { type: 'variables'; content: string }
  | { type: 'sql'; content: string }
  | { type: 'plot'; content: string }
  | { type: 'if'; condition: string; body: string };
```

### Current `ParsedCellContent` (notebookParser.ts ~line 10)
```typescript
export interface ParsedCellContent {
  sqlBlocks: string[];
  plotBlocks: string[];          // indexed by sql block index
  plotBlocksWithSqlIndex: Array<{ config: string; sqlIndex: number }>;
  plotAliases: (string | null)[];
  queryAliases: (string | null)[];
  queryAliasMaterialized: boolean[];
  variables: Record<string, string>;
  variableWarnings: string[];
  conclusion: MarkdownSection | null;
}
```

### Plot markdown syntax
```
```plot
TABLE() DATASET GarbageCollection
```
```

The `DATASET <name>` clause fetches `SELECT * FROM <name>` and feeds data to the plot renderer. It already works for plots attached to SQL blocks — we just need to make it work for plots with no preceding SQL.

### Key locations in `NotebookCell.tsx`
- **Line 920**: `handleAddSql` — appends `{type:'sql'}` + markdown separator
- **Line 921–926**: `handleInsertAt` — inserts at arbitrary segment index (already supports `'plot'`)
- **Line 927**: `handleAddPlot` — **currently a no-op** — this is what we replace
- **Lines 654–692**: `datasetResults` state + `useEffect` that fetches `DATASET` data
- **Lines 1204–1293**: Segment rendering loop's `seg.type === 'plot'` branch
- **Lines 1298–1303**: Bottom button bar (`+ Add variable`, `+ Add SQL`) — **add `+ Add Plot` here**

### Test files
- `core/frontend/tests/notebookParser.test.ts` — parser unit tests
- `core/frontend/tests/notebookParser.templating.test.ts` — templating / directives

---

## Files Modified

| File | Change |
|---|---|
| `core/frontend/utils/notebookParser.ts` | Add `standalonePlots` to `ParsedCellContent`; populate it in `parseCellContent` |
| `core/frontend/components/NotebookCell.tsx` | Replace no-op `handleAddPlot`; add `+ Add Plot` button; render standalone plots |
| `core/frontend/tests/notebookParser.test.ts` | Tests for standalone plot parsing and roundtrip |

---

## Task 1: Extend the parser to collect standalone plots

**Files:**
- Modify: `core/frontend/utils/notebookParser.ts`
- Test: `core/frontend/tests/notebookParser.test.ts`

The standalone plot is a `plot` segment that appears before any `sql` segment in the cell, or after an `sql` segment's associated plot has already been consumed (i.e. `currentSqlIndex < 0` at parse time).

- [ ] **Step 1: Write the failing tests**

Open `core/frontend/tests/notebookParser.test.ts` and add this describe block after the existing tests:

```typescript
describe('standalone plots (no preceding SQL)', () => {
    it('collects a standalone plot into standalonePlots', () => {
        const input = '```plot\nTABLE() DATASET GarbageCollection\n```';
        const segments = tokenizeCellContent(input);
        const parsed = parseCellContent(segments);
        expect(parsed.standalonePlots).toHaveLength(1);
        expect(parsed.standalonePlots[0]).toBe('TABLE() DATASET GarbageCollection');
        expect(parsed.sqlBlocks).toHaveLength(0);
        expect(parsed.plotBlocks).toHaveLength(0);
    });

    it('standalone plot does not appear in plotBlocks', () => {
        const input = '```plot\nTABLE() DATASET GarbageCollection\n```\n```sql\nSELECT 1\n```';
        const segments = tokenizeCellContent(input);
        const parsed = parseCellContent(segments);
        expect(parsed.standalonePlots).toHaveLength(1);
        expect(parsed.standalonePlots[0]).toBe('TABLE() DATASET GarbageCollection');
        // The sql block has no following plot, so plotBlocks[0] = ''
        expect(parsed.plotBlocks[0]).toBe('');
    });

    it('multiple standalone plots are all collected', () => {
        const input = '```plot\nTABLE() DATASET GarbageCollection\n```\n```plot\nLINE_CHART(x: "t") DATASET HeapSnapshot\n```';
        const segments = tokenizeCellContent(input);
        const parsed = parseCellContent(segments);
        expect(parsed.standalonePlots).toHaveLength(2);
    });

    it('standalone plot coexists with sql-attached plot', () => {
        const input = '```sql\nSELECT 1\n```\n```plot\nTABLE()\n```\n```plot\nLINE_CHART() DATASET HeapSnapshot\n```';
        const segments = tokenizeCellContent(input);
        const parsed = parseCellContent(segments);
        // TABLE() is attached to the SQL block
        expect(parsed.plotBlocks[0]).toBe('TABLE()');
        // LINE_CHART() DATASET comes after the sql-attached plot — it's a standalone
        // (no second sql block to attach to)
        expect(parsed.standalonePlots).toHaveLength(1);
        expect(parsed.standalonePlots[0]).toBe('LINE_CHART() DATASET HeapSnapshot');
    });

    it('roundtrip: standalone plot survives reconstructCellContent', () => {
        const input = '```plot\nTABLE() DATASET GarbageCollection\n```\n';
        const segments = tokenizeCellContent(input);
        const rebuilt = reconstructCellContent(segments);
        expect(rebuilt).toContain('TABLE() DATASET GarbageCollection');
        // Re-tokenize and re-parse to confirm no data loss
        const reparsed = parseCellContent(tokenizeCellContent(rebuilt));
        expect(reparsed.standalonePlots[0]).toBe('TABLE() DATASET GarbageCollection');
    });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
cd core && npx vitest run tests/notebookParser.test.ts 2>&1 | tail -30
```

Expected: FAIL — `parsed.standalonePlots is not iterable` or `Cannot read properties of undefined`.

- [ ] **Step 3: Add `standalonePlots` to `ParsedCellContent` interface**

In `core/frontend/utils/notebookParser.ts`, find the `ParsedCellContent` interface (around line 10–30). Add the new field:

```typescript
export interface ParsedCellContent {
  sqlBlocks: string[];
  plotBlocks: string[];
  plotBlocksWithSqlIndex: Array<{ config: string; sqlIndex: number }>;
  plotAliases: (string | null)[];
  queryAliases: (string | null)[];
  queryAliasMaterialized: boolean[];
  variables: Record<string, string>;
  variableWarnings: string[];
  conclusion: MarkdownSection | null;
  standalonePlots: string[];          // ← ADD THIS LINE
}
```

- [ ] **Step 4: Initialize `standalonePlots` in the result object**

In `parseCellContent`, find the `result` initialization (around line 373, after `plotBlocksWithSqlIndex: []`). Add:

```typescript
standalonePlots: [],
```

- [ ] **Step 5: Populate `standalonePlots` in the parse loop**

Find the existing `else if (seg.type === 'plot')` branch (around line 461). Replace it:

**Before:**
```typescript
} else if (seg.type === 'plot') {
    if (currentSqlIndex < 0) {
        // No preceding SQL block - skip this orphaned plot block
        continue;
    }
    while (result.plotBlocks.length <= currentSqlIndex) {
        result.plotBlocks.push('');
    }
    let plotContent = seg.content;
    let plotAlias: string | null = null;

    const plotAliasMatch = plotContent.match(/^\s*--\s*([a-zA-Z_][\w\s-]*?)\s*\n/);
    if (plotAliasMatch) {
        plotAlias = plotAliasMatch[1].trim();
        plotContent = plotContent.substring(plotAliasMatch[0].length);
    }

    const plotLines = plotContent.split('\n');
    if (plotLines.length > 0 && plotLines[0].trim() === '') plotLines.shift();
    if (plotLines.length > 0 && plotLines[plotLines.length - 1].trim() === '') plotLines.pop();
    const plotConfig = plotLines.join('\n');
    result.plotBlocks[currentSqlIndex] = plotConfig;
    result.plotAliases.push(plotAlias);
    result.plotBlocksWithSqlIndex.push({ config: plotConfig, sqlIndex: currentSqlIndex });
}
```

**After:**
```typescript
} else if (seg.type === 'plot') {
    let plotContent = seg.content;
    let plotAlias: string | null = null;

    const plotAliasMatch = plotContent.match(/^\s*--\s*([a-zA-Z_][\w\s-]*?)\s*\n/);
    if (plotAliasMatch) {
        plotAlias = plotAliasMatch[1].trim();
        plotContent = plotContent.substring(plotAliasMatch[0].length);
    }

    const plotLines = plotContent.split('\n');
    if (plotLines.length > 0 && plotLines[0].trim() === '') plotLines.shift();
    if (plotLines.length > 0 && plotLines[plotLines.length - 1].trim() === '') plotLines.pop();
    const plotConfig = plotLines.join('\n');

    if (currentSqlIndex < 0 || result.plotBlocks[currentSqlIndex] !== undefined && result.plotBlocks[currentSqlIndex] !== '') {
        // No preceding SQL block, or the preceding SQL's plot slot is already filled:
        // this is a standalone plot.
        result.standalonePlots.push(plotConfig);
    } else {
        while (result.plotBlocks.length <= currentSqlIndex) {
            result.plotBlocks.push('');
        }
        result.plotBlocks[currentSqlIndex] = plotConfig;
        result.plotAliases.push(plotAlias);
        result.plotBlocksWithSqlIndex.push({ config: plotConfig, sqlIndex: currentSqlIndex });
    }
}
```

- [ ] **Step 6: Run tests and confirm they pass**

```bash
cd core && npx vitest run tests/notebookParser.test.ts 2>&1 | tail -30
```

Expected: All tests PASS including the new `standalone plots` describe block.

- [ ] **Step 7: Commit**

```bash
git add core/frontend/utils/notebookParser.ts core/frontend/tests/notebookParser.test.ts
git commit -m "feat(parser): collect standalone plot blocks (no preceding SQL) into standalonePlots"
```

---

## Task 2: Render standalone plots in `NotebookCell.tsx`

**Files:**
- Modify: `core/frontend/components/NotebookCell.tsx`

Standalone plots render inline in the segment loop just like SQL-attached plots, but they get their data from `datasetResults` (the `DATASET <name>` query mechanism). The `datasetResults` effect already iterates `parsedPlotBlocks` — we need to extend it to also iterate `standalonePlots`.

- [ ] **Step 1: Wire `standalonePlots` from parsed data**

In `NotebookCell.tsx`, find where `parsedPlotBlocks` is computed (around line 386). The `parsed` object already has `standalonePlots`. Add a memoized stable reference, following the same pattern used for `parsedPlotBlocks`:

```typescript
// After parsedPlotBlocksWithSqlIndex memo (around line 399):
const parsedStandalonePlotsRef = useRef<string[]>(parsed.standalonePlots);
const parsedStandalonePlots = useMemo(() => {
    const next = parsed.standalonePlots;
    const prev = parsedStandalonePlotsRef.current;
    if (next.length === prev.length && next.every((v, i) => v === prev[i])) return prev;
    parsedStandalonePlotsRef.current = next;
    return next;
}, [parsed.standalonePlots]);
```

- [ ] **Step 2: Extend `datasetResults` effect to cover standalone plots**

Find the `useEffect` that populates `datasetResults` (lines 668–692). It currently loops over `parsedPlotBlocks`. Extend it to also loop over `parsedStandalonePlots`, using a key of `standalone-${pi}:<name>`:

```typescript
useEffect(() => {
    let cancelled = false;
    (async () => {
        const next: Record<string, any[]> = {};

        // Existing: fetch DATASET for SQL-attached plots
        for (let pi = 0; pi < parsedPlotBlocks.length; pi++) {
            const config = parsedPlotBlocks[pi];
            if (!config || !config.trim()) continue;
            try {
                const expanded = expandPlotConstants(config);
                const firstConfig = expanded.expanded.split(/\n\s*\n/)[0].trim();
                const parsed2 = parsePlotCall(firstConfig);
                if (!parsed2.dataset) continue;
                const name = parsed2.dataset;
                if (!/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)?$/.test(name)) continue;
                const parts = name.split('.');
                const ident = parts.map(p => `"${p.replace(/"/g, '""')}"`).join('.');
                const rows = await dbQuery(`SELECT * FROM ${ident}`);
                if (cancelled) return;
                next[`${pi}:${name}`] = rows ?? [];
            } catch { /* renderer falls back to query-result data */ }
        }

        // New: fetch DATASET for standalone plots
        for (let si = 0; si < parsedStandalonePlots.length; si++) {
            const config = parsedStandalonePlots[si];
            if (!config || !config.trim()) continue;
            try {
                const expanded = expandPlotConstants(config);
                const firstConfig = expanded.expanded.split(/\n\s*\n/)[0].trim();
                const parsed2 = parsePlotCall(firstConfig);
                if (!parsed2.dataset) continue;
                const name = parsed2.dataset;
                if (!/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)?$/.test(name)) continue;
                const parts = name.split('.');
                const ident = parts.map(p => `"${p.replace(/"/g, '""')}"`).join('.');
                const rows = await dbQuery(`SELECT * FROM ${ident}`);
                if (cancelled) return;
                next[`standalone-${si}:${name}`] = rows ?? [];
            } catch { /* no data — plot renders empty */ }
        }

        if (!cancelled) setDatasetResults(next);
    })();
    return () => { cancelled = true; };
}, [parsedPlotBlocks, parsedStandalonePlots, aliasVersionSum, dbQuery]);
```

- [ ] **Step 3: Render standalone plot segments in the segment loop**

In the segment rendering loop (the `segments.forEach` starting around line 1046), find the `else if (seg.type === 'plot')` branch that currently handles SQL-attached plots (line 1204). Add a new counter for standalone plots at the top of the loop, and handle the standalone case:

At the top of the `segments.forEach` callback, after `let plotIdx = -1;`, add:
```typescript
let standaloneIdx = -1;
```

Then, inside `else if (seg.type === 'plot')`, the existing code does `const plotInfo = parsedPlotBlocksWithSqlIndex[plotIdx]` and returns early if `!plotInfo`. Standalone plots would not be in `plotBlocksWithSqlIndex` — they have no associated SQL. Modify that branch as follows:

**Find this block (lines 1204–1293) and replace it:**

```typescript
} else if (seg.type === 'plot') {
    plotIdx++;
    const plotInfo = parsedPlotBlocksWithSqlIndex[plotIdx];
    if (!plotInfo) {
        // This is a standalone plot (no preceding SQL).
        standaloneIdx++;
        const si = standaloneIdx;
        const config = parsedStandalonePlots[si] ?? '';
        const capturedSegIdx = segIdx;

        // Resolve DATASET data
        let standaloneData: any[] | null = null;
        try {
            const configToCheck = config.trim() || 'TABLE()';
            const expanded = expandPlotConstants(configToCheck);
            const firstConfig = expanded.expanded.split(/\n\s*\n/)[0].trim();
            const parsed2 = parsePlotCall(firstConfig);
            if (parsed2.dataset) {
                standaloneData = datasetResults[`standalone-${si}:${parsed2.dataset}`] ?? null;
            }
        } catch { /* no data */ }

        const plotDataCols = (standaloneData && standaloneData.length > 0 && !standaloneData[0]?.error)
            ? Object.keys(standaloneData[0])
            : [];
        const configToRender = config.trim() || 'TABLE()';

        const handleStandalonePlotChange = (newConfig: string) => {
            const newSegments = [...segmentsRef.current];
            if (newSegments[capturedSegIdx]?.type === 'plot') {
                newSegments[capturedSegIdx] = { type: 'plot', content: '\n' + newConfig + '\n' };
                handleSegmentsUpdate(newSegments);
            }
        };

        if (!presenterMode) {
            items.push(
                <CollapsibleBlock key={`standalone-plot-${si}`}
                    title={<span className="cursor-pointer">{`Plot ${si + 1}`}</span>}
                    preview={config.replace(/\s+/g, ' ').substring(0, 60)}
                    isCollapsed={collapsedStates[`standalone-plot-${si}`] ?? false}
                    onToggle={() => setCollapsedStates(s => ({ ...s, [`standalone-plot-${si}`]: !s[`standalone-plot-${si}`] }))}
                    controls={
                        <button onClick={() => { const ns = [...segmentsRef.current]; ns.splice(capturedSegIdx, 1); handleSegmentsUpdate(ns); }}
                            className="p-0.5 rounded hover:bg-red-900/40" title="Delete plot">
                            <TrashIcon className="w-3.5 h-3.5 text-gray-400 hover:text-red-400" />
                        </button>
                    }
                >
                    {plotDataCols.length > 0 && (
                        <div className="px-2 pt-1.5 pb-0.5 flex flex-wrap gap-1 items-center border-b border-gray-700/60">
                            <span className="text-[10px] text-gray-600 mr-0.5">columns:</span>
                            {plotDataCols.slice(0, 12).map(col => (
                                <button key={col}
                                    onClick={() => navigator.clipboard.writeText(`"${col}"`).catch(() => {})}
                                    title={`Copy "${col}" to clipboard`}
                                    className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/60 hover:bg-cyan-800/50 text-gray-400 hover:text-cyan-300 font-mono transition-colors"
                                >{col}</button>
                            ))}
                            {plotDataCols.length > 12 && <span className="text-[10px] text-gray-600">+{plotDataCols.length - 12} more</span>}
                            <span className="text-[10px] text-gray-600 ml-1">— click to copy</span>
                        </div>
                    )}
                    <PlotConfigEditor
                        value={config}
                        onChange={handleStandalonePlotChange}
                        index={-1}
                        data={standaloneData}
                    />
                </CollapsibleBlock>
            );
        }

        // Show plot result (both in edit mode and presenter mode)
        const standaloneIsCollapsed = !presenterMode && (collapsedStates[`standalone-plot-${si}`] ?? false);
        if (standaloneData && !standaloneIsCollapsed) {
            items.push(
                <div key={`standalone-result-${si}`}
                    className="group/result rounded-md border border-gray-700/60 overflow-hidden relative"
                    style={{ minHeight: resultPanelHeight }}>
                    <div id={`result-container-${cell.id}-standalone-${si}`}
                        className="flex-grow overflow-auto"
                        style={{ minHeight: resultPanelHeight }}>
                        <PlotRenderer
                            config={configToRender}
                            data={standaloneData}
                            dataByQueryRef={dataByQueryRef}
                            sql={''}
                            cellContext={cellContext}
                            formatSettings={formatSettings}
                        />
                    </div>
                </div>
            );
        }
        return;
    }
    // ... rest of existing SQL-attached plot rendering (unchanged) ...
```

> **Note:** The `return` at the end of the standalone block makes the `forEach` callback exit early for this segment — equivalent to `continue` in a regular loop.

- [ ] **Step 4: Build and visually verify**

```bash
cd core && npm run dev &
# Open browser at http://localhost:5173
# Load demo, go to a cell, click "+ Add Plot" (next step adds the button)
```

This step is just to check TypeScript compiles without errors:
```bash
cd core && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors (or only pre-existing errors unrelated to these files).

- [ ] **Step 5: Commit**

```bash
git add core/frontend/components/NotebookCell.tsx
git commit -m "feat(cell): render standalone plot segments with DATASET data"
```

---

## Task 3: Replace the no-op `handleAddPlot` and add `+ Add Plot` button

**Files:**
- Modify: `core/frontend/components/NotebookCell.tsx`

The existing `handleAddPlot` at line 927 is a no-op. We replace it to append a new standalone plot segment. The default content is `TABLE() DATASET GarbageCollection` — TABLE works on any data, and GarbageCollection is the most common table in demo and GC notebooks. If users are on a different dataset they edit the DATASET clause.

- [ ] **Step 1: Replace `handleAddPlot` with a real implementation**

Find line 927:
```typescript
const handleAddPlot = () => { /* No-op, plot change creates plot blocks */ };
```

Replace with:
```typescript
const handleAddPlot = () => {
    handleSegmentsUpdate([
        ...segmentsRef.current,
        { type: 'markdown', content: '\n\n' },
        { type: 'plot', content: '\nTABLE() DATASET GarbageCollection\n' },
    ]);
};
```

- [ ] **Step 2: Add `+ Add Plot` button next to `+ Add SQL` in the bottom toolbar**

Find lines 1298–1303 (the bottom button bar):
```typescript
{!presenterMode && (
    <div className="flex justify-end gap-3">
        <button onClick={handleAddVariable} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 px-1 py-0.5 rounded"><PlusIcon className="w-3 h-3"/> Add variable</button>
        <button onClick={handleAddSql} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 px-1 py-0.5 rounded"><PlusIcon className="w-3 h-3"/> Add SQL</button>
    </div>
)}
```

Replace with:
```typescript
{!presenterMode && (
    <div className="flex justify-end gap-3">
        <button onClick={handleAddVariable} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 px-1 py-0.5 rounded"><PlusIcon className="w-3 h-3"/> Add variable</button>
        <button onClick={handleAddPlot} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 px-1 py-0.5 rounded"><PlusIcon className="w-3 h-3"/> Add Plot</button>
        <button onClick={handleAddSql} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 px-1 py-0.5 rounded"><PlusIcon className="w-3 h-3"/> Add SQL</button>
    </div>
)}
```

- [ ] **Step 3: Verify in browser**

Start dev server (if not running):
```bash
cd core && npm run dev
```

Open http://localhost:5173 → Try the demo.

1. Scroll to any cell.
2. Click `+ Add Plot` at the bottom.
3. Confirm a new "Plot 1" block appears with content `TABLE() DATASET GarbageCollection`.
4. Confirm the table renders GarbageCollection rows below the plot editor.
5. Change `GarbageCollection` to `HeapSnapshot` in the plot editor and confirm the data updates.
6. Change `TABLE()` to `LINE_CHART(x: "startTime", y: ["heapUsed"])` and confirm a line chart renders.
7. Click the trash icon on the standalone plot and confirm it's removed.

- [ ] **Step 4: Commit**

```bash
git add core/frontend/components/NotebookCell.tsx
git commit -m "feat(cell): add '+ Add Plot' button that inserts a standalone DATASET plot"
```

---

## Task 4: Handle `PlotConfigEditor` `index={-1}` gracefully

**Files:**
- Modify: `core/frontend/components/NotebookCell.tsx` (the `handleStandalonePlotChange` closure from Task 2 already handles change routing)
- Check: `core/frontend/components/editor/plot/` — verify `index=-1` doesn't crash

The existing `handlePlotChange` callback uses `index` to find the SQL block that owns the plot. Standalone plots pass `index={-1}` to `PlotConfigEditor`, which passes it back via `onChange(newConfig, index)`. The `handlePlotChange` function returns early if `sqlSegmentIndex === -1`, so existing plots are safe. But standalone plots use their own `handleStandalonePlotChange` closure (defined in Task 2, Step 3), so they never reach `handlePlotChange`. This task verifies there are no crashes.

- [ ] **Step 1: Verify `PlotConfigEditor` prop types allow `index={-1}`**

```bash
grep -n "index.*number\|index: number\|index?: number" core/frontend/components/editor/plot/parser.ts core/frontend/components/NotebookCell.tsx 2>/dev/null | head -20
```

Expected: `index` is typed as `number` — `-1` is valid.

- [ ] **Step 2: Verify the `onChange` callback routing**

In `NotebookCell.tsx`, find the `PlotConfigEditor` for SQL-attached plots (around line 1272):
```typescript
<PlotConfigEditor value={config} onChange={handlePlotChange} index={defaultSqlIndex} data={results} ... />
```

The standalone `PlotConfigEditor` (added in Task 2) uses `onChange={handleStandalonePlotChange}` and `index={-1}`. Confirm `handleStandalonePlotChange` is defined in Task 2 and does NOT call `handlePlotChange` — it directly updates the segment at `capturedSegIdx`.

- [ ] **Step 3: TypeScript check**

```bash
cd core && npx tsc --noEmit 2>&1 | grep -E "error TS|standalone|PlotConfigEditor" | head -20
```

Expected: No new errors.

- [ ] **Step 4: Commit (if any changes needed)**

```bash
git add core/frontend/components/NotebookCell.tsx
git commit -m "fix(cell): standalone plot onChange uses direct segment update, not handlePlotChange"
```

---

## Task 5: Update the existing "orphaned plot" test to match new behaviour

**Files:**
- Modify: `core/frontend/tests/notebookParser.test.ts`

The existing Fix2 test at line 95 asserts that `plotBlocks.length === 1` and `plotBlocks[0] === ''` when a plot appears before a SQL block. With our change, the orphaned plot now goes to `standalonePlots`, so `plotBlocks` should still have 1 element (for the SQL block) but with an empty string — that behaviour is unchanged. However, we should also assert `standalonePlots` is populated correctly.

- [ ] **Step 1: Update the Fix2 test**

Find the test `'Fix2: plot block before any sql block is silently dropped'` in `core/frontend/tests/notebookParser.test.ts`. Update it:

```typescript
it('Fix2: plot block before any sql block is now collected into standalonePlots (not dropped)', () => {
    const input = '```plot\nLINE_CHART(x: "t")\n```\n```sql\nSELECT 1\n```';
    const segments = tokenizeCellContent(input);
    const parsed = parseCellContent(segments);
    // The pre-SQL plot is now a standalone plot
    expect(parsed.standalonePlots).toHaveLength(1);
    expect(parsed.standalonePlots[0]).toBe('LINE_CHART(x: "t")');
    // The SQL block has no following plot, so plotBlocks[0] = ''
    expect(parsed.plotBlocks.length).toBe(1);
    expect(parsed.plotBlocks[0]).toBe('');
    expect(parsed.sqlBlocks.length).toBe(1);
});
```

- [ ] **Step 2: Run all parser tests**

```bash
cd core && npx vitest run tests/notebookParser.test.ts tests/notebookParser.templating.test.ts 2>&1 | tail -30
```

Expected: All tests PASS.

- [ ] **Step 3: Run the full test suite**

```bash
cd core && npx vitest run 2>&1 | tail -30
```

Expected: All tests PASS (or only pre-existing failures unrelated to this feature).

- [ ] **Step 4: Commit**

```bash
git add core/frontend/tests/notebookParser.test.ts
git commit -m "test(parser): update Fix2 test — pre-SQL plots go to standalonePlots, not dropped"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ `+ Add Plot` button at the bottom of each cell
- ✅ Standalone plot that queries a table/view directly (via `DATASET GarbageCollection`)
- ✅ Works for TABLE() and LINE_CHART() and other plot types
- ✅ Delete standalone plot
- ✅ Column chips showing available columns from DATASET result
- ✅ Presenter mode: shows plot result, hides editor

**2. Placeholder scan:** None — all code blocks are complete.

**3. Type consistency:**
- `parsedStandalonePlots` (ref + memo) — used consistently as `string[]`
- Key format: `standalone-${si}:${name}` in `datasetResults` — used consistently in both effect and render
- `handleStandalonePlotChange` — direct segment update, no `handlePlotChange` involvement
- `collapsedStates[`standalone-plot-${si}`]` — consistent key format

**One edge case to note:** When `parsedPlotBlocksWithSqlIndex[plotIdx]` is `undefined` (Task 2, Step 3), we treat this as a standalone plot and increment `standaloneIdx`. This assumes `parsedPlotBlocksWithSqlIndex` has exactly one entry per SQL-attached plot in segment order — which is guaranteed by the parser (each plot attached to a SQL block is pushed to `plotBlocksWithSqlIndex` in encounter order). A pure standalone plot segment produces no entry in `plotBlocksWithSqlIndex`, so `plotIdx` increments but `parsedPlotBlocksWithSqlIndex[plotIdx]` is `undefined` for it. This is correct.
