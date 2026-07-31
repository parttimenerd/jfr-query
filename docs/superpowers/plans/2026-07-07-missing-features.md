# Missing Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix documentation/implementation mismatches, remove orphan parsed-but-unused features (SUBTITLE, ON CLICK NAVIGATE), and implement `AXIS FORMAT` / `TYPE TIME|BAND` wiring, `${… | time}` timeFormat handling, front-matter title/description/tags/license, `ON HOVER TOOLTIP` and `TOOLTIP COLUMNS`, `cellConditions` visibility, and `LINK_X master` drive-vs-follower semantics.

**Architecture:** Most changes are isolated: parser regex updates, single-file format fixes, and component-level tooltip wiring. `cellConditions` requires a `Notebook.tsx` integration. `LINK_X master` requires `PlotRenderer` + `InteractivePlotWrapper` changes. Where two features share a helper (M1+M2 → `PlotTooltip`), we build the helper once and consume it in each chart.

**Tech Stack:** TypeScript, React, Recharts, Vitest, DuckDB WASM

**Test command:** `cd core && npx vitest run` (all tests) or `cd core && npx vitest run <path>` (single file).

**Working directory note:** All paths below are absolute or rooted at `core/frontend/…`. Commands assume you `cd core` first (as shown per-step) unless the working directory is already `core`.

---

## File Structure Overview

| File | Responsibility | Tasks touching it |
|------|---------------|-------------------|
| `core/frontend/utils/plotParser.ts` | DSL clause regexes, ParsedPlotCall shape | Task 1 (C1), Task 3 (H2) |
| `core/frontend/components/editor/plot/parser.ts` | Editor-side plot parser tail-keywords | Task 1 (C2) |
| `core/frontend/components/editor/plot/derive.ts` | Editor-side ParsedPlotCall + subtitle derive | Task 1 (C2) |
| `core/frontend/components/editor/plot/aiPlotContext.ts` | Docs string served to AI | Task 1 (C2) |
| `core/frontend/tests/plotParser.clauses.test.ts` | Unit tests for `plotParser` clause regexes | Task 1, Task 3 |
| `core/frontend/tests/plotParser.new.test.ts` | Editor-side parser tests | Task 1 (C2) |
| `core/frontend/tests/plotFormatter.test.ts` | Plot formatter tests | Task 1 (C2) |
| `docs-site/plot-dsl.md`, `docs-site/variables.md` | User-facing DSL docs | Task 2 (H1) |
| `core/frontend/components/plots/*.tsx` | Chart components | Task 4 (H3), Task 7 (M1+M2) |
| `core/frontend/components/plots/PlotTooltip.tsx` (NEW) | Shared tooltip helper for onHoverTooltip + tooltipColumns | Task 7 |
| `core/frontend/utils/notebookParser.ts` | Front-matter YAML → NotebookMetadata | Task 5 (H4) |
| `core/frontend/types.ts` | `NotebookMetadata` interface | Task 5 (H4) |
| `core/frontend/services/templating/formatValue.ts` | `${… \| fmt}` value formatter | Task 6 (H5) |
| `core/frontend/components/Notebook.tsx` | Cell rendering loop; runs cell condition SQL | Task 8 (M3) |
| `core/frontend/components/PlotRenderer.tsx` | LINK_X publish/subscribe wiring | Task 9 (M4) |

---

## Task 1: Remove SUBTITLE and ON CLICK NAVIGATE (C1 + C2)

**Rationale:** These clauses are parsed but no component consumes them. Removing keeps the DSL surface honest.

**Files:**
- Modify: `core/frontend/utils/plotParser.ts` (ParsedPlotCall + CLAUSES)
- Modify: `core/frontend/components/editor/plot/parser.ts` (UPPERCASE_TAIL_KEYWORDS, LOWERCASE_TAIL_KEYS, tailValueType, comment)
- Modify: `core/frontend/components/editor/plot/derive.ts` (ParsedPlotCall shape + subtitle case)
- Modify: `core/frontend/components/editor/plot/aiPlotContext.ts` (docs string)
- Modify: `core/frontend/tests/plotParser.clauses.test.ts` (delete ON CLICK NAVIGATE test)
- Modify: `core/frontend/tests/plotParser.new.test.ts` (delete SUBTITLE tests)
- Modify: `core/frontend/tests/plotFormatter.test.ts` (delete SUBTITLE test)

- [ ] **Step 1: Remove `onClickNavigate` from `ParsedPlotCall`**

In `core/frontend/utils/plotParser.ts` around line 37, delete the line:

```ts
    onClickNavigate?: string;
```

- [ ] **Step 2: Remove the ON CLICK NAVIGATE entry from `CLAUSES`**

In `core/frontend/utils/plotParser.ts` around line 156, delete the entire array entry:

```ts
    { key: 'onClickNavigate', regex: /(?<!\w)ON\s+CLICK\s+NAVIGATE\s+(?:"([^"]*)"|'([^']*)')\s*$/i, processor: (m) => m[1] ?? m[2] },
```

- [ ] **Step 3: Delete the ON CLICK NAVIGATE test**

In `core/frontend/tests/plotParser.clauses.test.ts` around lines 48–51, delete the test case:

```ts
    it('parses ON CLICK NAVIGATE "..."', () => {
      // ... whole `it` block
    });
```

- [ ] **Step 4: Remove SUBTITLE from editor parser tail-keywords**

In `core/frontend/components/editor/plot/parser.ts`:

- Line 37: remove `'SUBTITLE'` from `UPPERCASE_TAIL_KEYWORDS`. Change:
  ```ts
  'TITLE', 'SUBTITLE', 'NAME', 'ZOOM',
  ```
  to:
  ```ts
  'TITLE', 'NAME', 'ZOOM',
  ```
- Line 45: remove `'subtitle'` from `LOWERCASE_TAIL_KEYS`. Change:
  ```ts
  'title', 'subtitle', 'name', 'zoom', 'width', 'height',
  ```
  to:
  ```ts
  'title', 'name', 'zoom', 'width', 'height',
  ```
- Line 819: in `tailValueType`, change:
  ```ts
  if (u === 'TITLE' || u === 'SUBTITLE' || u === 'NAME') return 'string';
  ```
  to:
  ```ts
  if (u === 'TITLE' || u === 'NAME') return 'string';
  ```
- Line 915: update the comment to drop SUBTITLE:
  ```ts
  // Other tails (TITLE, NAME, ZOOM, WIDTH, HEIGHT) — single value.
  ```

- [ ] **Step 5: Remove `subtitle` from editor `ParsedPlotCall` and derive**

In `core/frontend/components/editor/plot/derive.ts`:

- Line 19: delete the line `subtitle?: string;` from the `ParsedPlotCall` interface.
- Lines 208–211: delete the `case 'subtitle':` block:
  ```ts
              case 'subtitle': {
                  if (arg) result.subtitle = String(jsValue(arg));
                  break;
              }
  ```

- [ ] **Step 6: Remove SUBTITLE from AI plot context**

In `core/frontend/components/editor/plot/aiPlotContext.ts` around line 71, delete the line:

```ts
  SUBTITLE "str"       — chart subtitle
```

- [ ] **Step 7: Delete SUBTITLE tests**

In `core/frontend/tests/plotParser.new.test.ts`, delete every reference to SUBTITLE (spec cites lines 185–186, 1155–1158, 1237–1240). Search for `SUBTITLE` case-insensitively and remove the entire `it(...)` block containing each occurrence, plus any surrounding empty-line residue.

In `core/frontend/tests/plotFormatter.test.ts` around line 45, delete the SUBTITLE formatter test (the entire `it(...)` block containing `SUBTITLE`).

- [ ] **Step 8: Run tests to confirm nothing else broke**

Run:
```bash
cd core && npx vitest run tests/plotParser.clauses.test.ts tests/plotParser.new.test.ts tests/plotFormatter.test.ts
```
Expected: PASS (all remaining tests green).

- [ ] **Step 9: Type-check + full test sweep**

Run:
```bash
cd core && npx tsc --noEmit && npx vitest run
```
Expected: no type errors; all tests green. If `tsc --noEmit` complains about a stray reference to `subtitle` or `onClickNavigate` in unlisted files, delete that reference too.

- [ ] **Step 10: Commit**

```bash
git add core/frontend/utils/plotParser.ts \
        core/frontend/components/editor/plot/parser.ts \
        core/frontend/components/editor/plot/derive.ts \
        core/frontend/components/editor/plot/aiPlotContext.ts \
        core/frontend/tests/plotParser.clauses.test.ts \
        core/frontend/tests/plotParser.new.test.ts \
        core/frontend/tests/plotFormatter.test.ts
git commit -m "chore(plot-dsl): remove unused SUBTITLE and ON CLICK NAVIGATE clauses"
```

---

## Task 2: Remove stale "not yet implemented" from LINK_Y docs (H1)

**Files:**
- Modify: `docs-site/plot-dsl.md` (line 550)
- Modify: `docs-site/variables.md` (line 77)

- [ ] **Step 1: Strip the parenthetical from `plot-dsl.md`**

Open `docs-site/plot-dsl.md`. Find the LINK_Y bullet at line 550 that ends with `*(not yet implemented)*`. Delete the `*(not yet implemented)*` fragment (and any leading space) so the bullet reads as a normal description.

- [ ] **Step 2: Strip the parenthetical from `variables.md`**

Open `docs-site/variables.md`. Find the LINK_Y bullet at line 77 that ends with `*(not yet implemented)*`. Delete the fragment identically.

- [ ] **Step 3: Commit**

```bash
git add docs-site/plot-dsl.md docs-site/variables.md
git commit -m "docs(plot-dsl): drop stale 'not yet implemented' on LINK_Y"
```

---

## Task 3: Fix AXIS_X/AXIS_Y and LINK_Y/LINK_XY underscore syntax (H2)

**Rationale:** Docs advertise `AXIS_X`, `AXIS_Y`, `LINK_Y`, `LINK_XY` (underscores) but the parser only accepts `AXIS-X`, `AXIS-Y`, `LINK-Y`, `LINK-XY` (hyphens). Accept both.

**Files:**
- Modify: `core/frontend/utils/plotParser.ts` (CLAUSES entries at ~lines 151, 152, 162, 163)
- Modify: `core/frontend/tests/plotParser.clauses.test.ts` (add tests)

- [ ] **Step 1: Add failing tests for underscore variants**

Open `core/frontend/tests/plotParser.clauses.test.ts`. Append the following four tests inside the outer `describe` block that already covers CLAUSES (put them near the existing `LINK-Y` / `AXIS-X` tests):

```ts
  it('parses LINK_Y with underscore', () => {
    const res = parsePlotCall('LINE_CHART X time Y v LINK_Y $ydom');
    expect(res.linkY).toBe('$ydom');
  });

  it('parses LINK_XY with underscore', () => {
    const res = parsePlotCall('LINE_CHART X time Y v LINK_XY $xy');
    expect(res.linkXY).toBe('$xy');
  });

  it('parses AXIS_X sub-clause with underscore', () => {
    const res = parsePlotCall('LINE_CHART X time Y v AXIS_X LABEL "T"');
    expect(res.axisX?.label).toBe('T');
  });

  it('parses AXIS_Y sub-clause with underscore', () => {
    const res = parsePlotCall('LINE_CHART X time Y v AXIS_Y TYPE log');
    expect(res.axisY?.type).toBe('log');
  });
```

If the existing test file imports `parsePlotCall` under a different name (check the top of the file), match that name. Do not invent an import.

- [ ] **Step 2: Run tests to see them fail**

```bash
cd core && npx vitest run tests/plotParser.clauses.test.ts
```
Expected: the four new tests FAIL (undefined or unmatched regex). Existing tests still PASS.

- [ ] **Step 3: Broaden the four regexes**

In `core/frontend/utils/plotParser.ts`:

- Line ~151, LINK-Y: change
  ```ts
  { key: 'linkY', regex: /(?<!\w)LINK-Y\s+(?:"(\$[A-Za-z_][\w]*)"|'(\$[A-Za-z_][\w]*)'|(\$[A-Za-z_][\w]*))\s*$/i, processor: (m) => m[1] ?? m[2] ?? m[3] },
  ```
  to
  ```ts
  { key: 'linkY', regex: /(?<!\w)LINK[-_]Y\s+(?:"(\$[A-Za-z_][\w]*)"|'(\$[A-Za-z_][\w]*)'|(\$[A-Za-z_][\w]*))\s*$/i, processor: (m) => m[1] ?? m[2] ?? m[3] },
  ```

- Line ~152, LINK-XY: change
  ```ts
  { key: 'linkXY', regex: /(?<!\w)LINK-XY\s+.../i, ... },
  ```
  to
  ```ts
  { key: 'linkXY', regex: /(?<!\w)LINK[-_]XY\s+(?:"(\$[A-Za-z_][\w]*)"|'(\$[A-Za-z_][\w]*)'|(\$[A-Za-z_][\w]*))\s*$/i, processor: (m) => m[1] ?? m[2] ?? m[3] },
  ```

- Line ~162, AXIS-X: change
  ```ts
  { key: 'axisX', regex: new RegExp(`(?<!\\w)AXIS-X\\s+${AXIS_SUB.source}\\s*$`, 'i'), processor: buildAxisProcessor('axisX'), merge: true },
  ```
  to
  ```ts
  { key: 'axisX', regex: new RegExp(`(?<!\\w)AXIS[-_]X\\s+${AXIS_SUB.source}\\s*$`, 'i'), processor: buildAxisProcessor('axisX'), merge: true },
  ```

- Line ~163, AXIS-Y: change identically to
  ```ts
  { key: 'axisY', regex: new RegExp(`(?<!\\w)AXIS[-_]Y\\s+${AXIS_SUB.source}\\s*$`, 'i'), processor: buildAxisProcessor('axisY'), merge: true },
  ```

- [ ] **Step 4: Re-run tests, expect green**

```bash
cd core && npx vitest run tests/plotParser.clauses.test.ts
```
Expected: PASS (including the four new tests).

- [ ] **Step 5: Run full plot-parser suite (belt-and-braces)**

```bash
cd core && npx vitest run tests/plotParser
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/frontend/utils/plotParser.ts core/frontend/tests/plotParser.clauses.test.ts
git commit -m "fix(plot-dsl): accept underscore forms LINK_Y/LINK_XY/AXIS_X/AXIS_Y"
```

---

## Task 4: Wire AXIS FORMAT and TYPE TIME|BAND into chart components (H3)

**Rationale:** `AxisSpec.format` and `AxisSpec.type` are parsed but never rendered. Consume them via Recharts `tickFormatter` and `scale`.

**Files:**
- Modify: `core/frontend/components/plots/LineChartPlot.tsx`
- Modify: `core/frontend/components/plots/BarChartPlot.ts`
- Modify: `core/frontend/components/plots/ScatterPlot.tsx`
- Modify: `core/frontend/components/plots/HistogramPlot.tsx`
- Modify: `core/frontend/components/plots/AreaChartPlot.tsx`
- Modify: `core/frontend/components/plots/RangePlot.tsx`
- Modify: `core/frontend/components/plots/BoxPlot.tsx`
- Modify: `core/frontend/components/plots/GanttChartPlot.tsx` (only if it currently ignores axis format/type)
- Modify: `core/frontend/components/plots/HeatmapPlot.tsx` (only if it currently ignores axis format/type)
- Create: `core/frontend/utils/axisFormat.ts` — shared helper so all charts route through one function.
- Modify or create test: `core/frontend/tests/axisFormat.test.ts`

- [ ] **Step 1: Write failing tests for the shared helper**

Create `core/frontend/tests/axisFormat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeTickFormatter, mapAxisScale } from '../utils/axisFormat';

describe('makeTickFormatter', () => {
  it('routes HH:mm:ss through formatTimestamp for time axes', () => {
    const fmt = makeTickFormatter({ type: 'time', format: 'HH:mm:ss' });
    // A fixed epoch: 1970-01-01T00:01:23.000Z → "00:01:23" in UTC HH:mm:ss.
    // formatTimestamp interprets the number as ms; we assert the shape, not the tz.
    expect(fmt!(83_000)).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('applies d3-format-style ".2f" to numeric axes', () => {
    const fmt = makeTickFormatter({ type: 'linear', format: '.2f' });
    expect(fmt!(3.14159)).toBe('3.14');
  });

  it('applies ".0f" thousand-grouping to numeric axes', () => {
    const fmt = makeTickFormatter({ type: 'linear', format: ',.0f' });
    expect(fmt!(1234567)).toBe('1,234,567');
  });

  it('returns undefined when no format nor time type', () => {
    expect(makeTickFormatter({ type: 'linear' })).toBeUndefined();
    expect(makeTickFormatter(undefined)).toBeUndefined();
  });
});

describe('mapAxisScale', () => {
  it('maps type=time to "time"', () => {
    expect(mapAxisScale({ type: 'time' })).toBe('time');
  });
  it('maps type=log to "log"', () => {
    expect(mapAxisScale({ type: 'log' })).toBe('log');
  });
  it('maps type=band to "band"', () => {
    expect(mapAxisScale({ type: 'band' })).toBe('band');
  });
  it('returns undefined for linear or missing', () => {
    expect(mapAxisScale({ type: 'linear' })).toBeUndefined();
    expect(mapAxisScale(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to see them fail**

```bash
cd core && npx vitest run tests/axisFormat.test.ts
```
Expected: FAIL — `utils/axisFormat` does not exist.

- [ ] **Step 3: Implement the shared helper**

Create `core/frontend/utils/axisFormat.ts`:

```ts
import { format as d3Format } from 'd3-format';
import { formatTimestamp } from './timeFormatter';
import type { AxisSpec } from './plotParser';

/**
 * Build a Recharts `tickFormatter` for an AxisSpec.
 * - Time axes route through `formatTimestamp(v, format ?? 'HH:mm:ss.SSS')`.
 * - Non-time axes with a `format` string route through d3-format (e.g. ".2f").
 * - Returns undefined when neither applies so callers can spread `{...}`.
 */
export function makeTickFormatter(
  axis: AxisSpec | undefined,
): ((v: number | string) => string) | undefined {
  if (!axis) return undefined;
  if (axis.type === 'time') {
    const spec = axis.format ?? 'HH:mm:ss.SSS';
    return (v) => formatTimestamp(v as number, spec);
  }
  if (axis.format) {
    try {
      const f = d3Format(axis.format);
      return (v) => (typeof v === 'number' ? f(v) : String(v));
    } catch {
      return (v) => String(v);
    }
  }
  return undefined;
}

/**
 * Map an AxisSpec `type` to Recharts `scale` prop, or undefined if the
 * default should be kept.
 */
export function mapAxisScale(axis: AxisSpec | undefined): 'time' | 'log' | 'band' | undefined {
  if (!axis) return undefined;
  switch (axis.type) {
    case 'time': return 'time';
    case 'log': return 'log';
    case 'band': return 'band';
    default: return undefined;
  }
}
```

**If `d3-format` is not already a dependency,** check `core/frontend/package.json`. If absent, add it:

```bash
cd core/frontend && npm install d3-format @types/d3-format --save
```

Verify with `grep -n '"d3-format"' core/frontend/package.json` before running tests.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd core && npx vitest run tests/axisFormat.test.ts
```
Expected: PASS.

- [ ] **Step 5: Wire helper into LineChartPlot**

Open `core/frontend/components/plots/LineChartPlot.tsx`. At the top, add:

```ts
import { makeTickFormatter, mapAxisScale } from '../../utils/axisFormat';
```

Locate the `<XAxis .../>` element (search for `<XAxis`). Add both props (name `clauses` may differ — use the local variable that holds the ParsedPlotCall or its `axisX`/`axisY` fields; in this file that is typically `parsed` or `cfg.axisX`). Example (adjust the accessor to match the local variable name):

```tsx
<XAxis
  {/* ...existing props... */}
  tickFormatter={makeTickFormatter(parsed.axisX) ?? existingXTickFormatter}
  scale={mapAxisScale(parsed.axisX)}
/>
```

If an `existingXTickFormatter` already exists (the file has a `formatTimestamp`-based one), prefer the new one only when non-undefined:

```tsx
const xTick = makeTickFormatter(parsed.axisX) ?? (isTime ? (l:any) => formatTimestamp(l, settings.timeFormat) : undefined);
<XAxis ... tickFormatter={xTick} scale={mapAxisScale(parsed.axisX)} />
```

Repeat for `<YAxis>` using `parsed.axisY`. If the chart has a Y2 axis, apply to it too when the DSL surfaces a second AxisSpec (skip if not).

- [ ] **Step 6: Wire helper into BarChartPlot**

Open `core/frontend/components/plots/BarChartPlot.ts`. Same import. Same treatment on `<XAxis>` and `<YAxis>`. Note bar charts default XAxis to categorical (`scale="band"`); pass `mapAxisScale(parsed.axisX)` only when it returns something (fall back to the current default).

- [ ] **Step 7: Wire helper into ScatterPlot**

Open `core/frontend/components/plots/ScatterPlot.tsx`. Add the import. Wire `tickFormatter` and `scale` on both axes. This is the file that previously had no log support on Y — `mapAxisScale(parsed.axisY)` provides it.

- [ ] **Step 8: Wire helper into HistogramPlot, AreaChartPlot, RangePlot, BoxPlot**

For each of:
- `core/frontend/components/plots/HistogramPlot.tsx`
- `core/frontend/components/plots/AreaChartPlot.tsx`
- `core/frontend/components/plots/RangePlot.tsx`
- `core/frontend/components/plots/BoxPlot.tsx`

Add the import and apply `tickFormatter={makeTickFormatter(parsed.axisX|axisY)}` and `scale={mapAxisScale(...)}` on the `<XAxis>` / `<YAxis>`.

- [ ] **Step 9: Check GanttChartPlot and HeatmapPlot**

Open each. If they already use `axisX.format`/`axisY.format`, skip. Otherwise, apply the same two-prop wiring where they have visible axes.

- [ ] **Step 10: Add integration test for a chart wiring**

Create `core/frontend/tests/plotAxisWiring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeTickFormatter, mapAxisScale } from '../utils/axisFormat';
import { parsePlotCall } from '../utils/plotParser';

describe('AXIS wiring end-to-end', () => {
  it('parses AXIS_X TYPE time FORMAT "HH:mm:ss" and yields a tick formatter', () => {
    const parsed = parsePlotCall('LINE_CHART X t Y v AXIS_X TYPE time FORMAT "HH:mm:ss"');
    expect(parsed.axisX?.type).toBe('time');
    expect(parsed.axisX?.format).toBe('HH:mm:ss');
    const fmt = makeTickFormatter(parsed.axisX);
    expect(fmt).toBeDefined();
    expect(fmt!(0)).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(mapAxisScale(parsed.axisX)).toBe('time');
  });

  it('parses AXIS_Y TYPE log FORMAT ".2f"', () => {
    const parsed = parsePlotCall('SCATTER_PLOT X t Y v AXIS_Y TYPE log FORMAT ".2f"');
    expect(parsed.axisY?.type).toBe('log');
    const fmt = makeTickFormatter(parsed.axisY);
    expect(fmt!(3.14159)).toBe('3.14');
    expect(mapAxisScale(parsed.axisY)).toBe('log');
  });
});
```

Adapt the `parsePlotCall` import name if the codebase exports a different name; use `grep -n "export" core/frontend/utils/plotParser.ts` if unsure.

- [ ] **Step 11: Run tests**

```bash
cd core && npx vitest run tests/axisFormat.test.ts tests/plotAxisWiring.test.ts
```
Expected: PASS.

- [ ] **Step 12: Type-check + full run**

```bash
cd core && npx tsc --noEmit && npx vitest run
```
Expected: no errors, all green.

- [ ] **Step 13: Commit**

```bash
git add core/frontend/utils/axisFormat.ts \
        core/frontend/components/plots/LineChartPlot.tsx \
        core/frontend/components/plots/BarChartPlot.ts \
        core/frontend/components/plots/ScatterPlot.tsx \
        core/frontend/components/plots/HistogramPlot.tsx \
        core/frontend/components/plots/AreaChartPlot.tsx \
        core/frontend/components/plots/RangePlot.tsx \
        core/frontend/components/plots/BoxPlot.tsx \
        core/frontend/components/plots/GanttChartPlot.tsx \
        core/frontend/components/plots/HeatmapPlot.tsx \
        core/frontend/tests/axisFormat.test.ts \
        core/frontend/tests/plotAxisWiring.test.ts \
        core/frontend/package.json core/frontend/package-lock.json
git commit -m "feat(plots): honor AXIS FORMAT and TYPE time|band|log via shared axisFormat helper"
```

Only stage `package*.json` if `d3-format` was actually installed.

---

## Task 5: Parse title/description/tags/license from front matter (H4)

**Files:**
- Modify: `core/frontend/types.ts` (`NotebookMetadata` interface at line 94–103)
- Modify: `core/frontend/utils/notebookParser.ts` (`parseFrontMatter` at line 38)
- Modify: `core/frontend/tests/notebookParser.templating.test.ts` (or a new focused test file)
- Modify: `core/frontend/components/Notebook.tsx` (surface tags in intro cell — small change)

- [ ] **Step 1: Write failing tests**

Create `core/frontend/tests/notebookParser.frontMatter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseNotebook } from '../utils/notebookParser';

describe('parseFrontMatter — descriptive keys', () => {
  it('extracts title, description, license as strings', () => {
    const nb = parseNotebook([
      '---',
      'title: My Notebook',
      'description: A short blurb',
      'license: Apache-2.0',
      '---',
      '# Body',
      '',
    ].join('\n'));
    expect(nb.metadata.title).toBe('My Notebook');
    expect(nb.metadata.description).toBe('A short blurb');
    expect(nb.metadata.license).toBe('Apache-2.0');
  });

  it('parses inline YAML list `tags: [a, "b c", d]`', () => {
    const nb = parseNotebook([
      '---',
      'tags: [a, "b c", d]',
      '---',
      '',
    ].join('\n'));
    expect(nb.metadata.tags).toEqual(['a', 'b c', 'd']);
  });

  it('parses block-style YAML list under `tags:`', () => {
    const nb = parseNotebook([
      '---',
      'tags:',
      '  - jfr',
      '  - "gc profile"',
      '  - z',
      '---',
      '',
    ].join('\n'));
    expect(nb.metadata.tags).toEqual(['jfr', 'gc profile', 'z']);
  });

  it('leaves tags undefined when absent', () => {
    const nb = parseNotebook('---\n---\n');
    expect(nb.metadata.tags).toBeUndefined();
  });
});
```

Verify the top-level parser export name via `grep -n "export" core/frontend/utils/notebookParser.ts | head`. If it's `parseNotebook`, use that. If it's a different name, adjust.

- [ ] **Step 2: Run tests to see them fail**

```bash
cd core && npx vitest run tests/notebookParser.frontMatter.test.ts
```
Expected: FAIL — `tags` is not parsed as a list; `title`/`description`/`license` may already fall through the catch-all but the `metadata.tags` assertion will fail (string vs array).

- [ ] **Step 3: Update NotebookMetadata**

In `core/frontend/types.ts` around line 94, extend the interface:

```ts
export interface NotebookMetadata {
  views: CustomView[];
  macros: CustomMacro[];
  customSystemPrompt?: string;
  timeFormat?: string;
  decimalPlaces?: number;
  variables?: Record<string, string>;
  /** Keyed by cell `name` or fallback `cell_<1-based-index>`; SQL returning truthy → cell rendered, else collapsed. */
  cellConditions?: Record<string, string>;
  /** Human-readable notebook title (falls back to first H2/H1 heading in intro cell). */
  title?: string;
  /** Optional short description shown in the sidebar / intro. */
  description?: string;
  /** Categorization tags; parsed from inline `[a, b]` or block YAML list. */
  tags?: string[];
  /** SPDX identifier or free-text license note. */
  license?: string;
}
```

- [ ] **Step 4: Implement tags list parsing and typed pass-through in `parseFrontMatter`**

Open `core/frontend/utils/notebookParser.ts`. Locate the `parseFrontMatter` function around line 38. Inside the `if (indent === 0)` branch (around lines 63–90), add explicit handlers for `tags` and typed casts for `title`, `description`, `license` **before** the fall-through `(result as any)[keyTrimmed] = value` line.

Add near the top of `parseFrontMatter`, a small helper (module-local; no export needed):

```ts
const parseInlineYamlList = (raw: string): string[] | null => {
    const t = raw.trim();
    if (!t.startsWith('[') || !t.endsWith(']')) return null;
    const inner = t.slice(1, -1).trim();
    if (inner === '') return [];
    // Split on commas at top level; support "quoted, with, commas" strings.
    const out: string[] = [];
    let cur = '';
    let inQ: '"' | "'" | null = null;
    for (const ch of inner) {
        if (inQ) {
            if (ch === inQ) inQ = null; else cur += ch;
        } else if (ch === '"' || ch === "'") {
            inQ = ch as '"' | "'";
        } else if (ch === ',') {
            out.push(cur.trim());
            cur = '';
        } else {
            cur += ch;
        }
    }
    if (cur.trim() !== '' || out.length > 0) out.push(cur.trim());
    // Strip surrounding quotes still present on individual entries.
    return out.map(s => s.replace(/^["'](.*)["']$/, '$1'));
};
```

Then, inside the loop at `indent === 0`, insert (before the existing catch-all):

```ts
if (keyTrimmed === 'tags') {
    // Case A: inline list on same line.
    const inline = parseInlineYamlList(value);
    if (inline !== null) {
        result.tags = inline;
        continue;
    }
    // Case B: block list — collect indented `- item` lines until we drop below indent+1.
    const items: string[] = [];
    // The parser walks lines via an index `i` (adjust based on the actual local var name).
    // Peek forward: while next line starts with two spaces followed by "- ", capture the item.
    while (i + 1 < lines.length) {
        const nxt = lines[i + 1];
        const m = nxt.match(/^\s+-\s+(.+)$/);
        if (!m) break;
        i++;
        const item = m[1].trim().replace(/^["'](.*)["']$/, '$1');
        items.push(item);
    }
    result.tags = items;
    continue;
}
if (keyTrimmed === 'title' || keyTrimmed === 'description' || keyTrimmed === 'license') {
    (result as NotebookMetadata)[keyTrimmed] = value.replace(/^["'](.*)["']$/, '$1');
    continue;
}
```

**Important:** the outer loop's line index variable is whatever `notebookParser.ts` uses (likely `i` or `idx`). Confirm by reading around line 60 of the file. If it uses `for (const line of lines)` (no index), refactor to a `for (let i = 0; i < lines.length; i++)` loop to enable the peek-ahead.

- [ ] **Step 5: Run tests to verify pass**

```bash
cd core && npx vitest run tests/notebookParser.frontMatter.test.ts
```
Expected: PASS.

- [ ] **Step 6: Surface `title` and `tags` in the intro cell UI**

Open `core/frontend/components/Notebook.tsx`. Find the intro-cell rendering block (search for the H2/H1 fallback logic — often near `metadata.title` or where the first cell is rendered). Add, in the intro area, before the body of the first cell:

```tsx
{metadata.title && (
  <h1 className="text-2xl font-semibold mb-1">{metadata.title}</h1>
)}
{metadata.description && (
  <p className="text-sm text-gray-400 mb-2">{metadata.description}</p>
)}
{metadata.tags && metadata.tags.length > 0 && (
  <div className="flex flex-wrap gap-1 mb-2">
    {metadata.tags.map(t => (
      <span key={t} className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-100">
        {t}
      </span>
    ))}
  </div>
)}
```

If a `title` is already rendered elsewhere (via H1 in the intro markdown), guard the new block behind `metadata.title && !existingH1FromMarkdown` — inspect the file to decide. The safe default: render `metadata.title` only when it exists; do not attempt to strip the markdown H1. Docs already state front-matter title overrides the H2/H1 fallback.

- [ ] **Step 7: Run the whole notebook parser suite**

```bash
cd core && npx vitest run tests/notebookParser
```
Expected: PASS.

- [ ] **Step 8: Type-check and full run**

```bash
cd core && npx tsc --noEmit && npx vitest run
```
Expected: no errors, all green.

- [ ] **Step 9: Commit**

```bash
git add core/frontend/types.ts \
        core/frontend/utils/notebookParser.ts \
        core/frontend/components/Notebook.tsx \
        core/frontend/tests/notebookParser.frontMatter.test.ts
git commit -m "feat(notebook): parse title/description/tags/license from front matter"
```

---

## Task 6: Fix `${… | time}` to use `timeFormat` (H5)

**Files:**
- Modify: `core/frontend/services/templating/formatValue.ts`
- Modify: `core/frontend/tests/formatValue.test.ts` (if exists; else create)

- [ ] **Step 1: Write failing test**

Check whether `core/frontend/tests/formatValue.test.ts` exists (`ls core/frontend/tests | grep -i format`). If it does, append; otherwise create it with:

```ts
import { describe, it, expect } from 'vitest';
import { formatValue } from '../services/templating/formatValue';

describe('formatValue — time', () => {
  it('renders time values using settings.timeFormat', () => {
    const settings = { timeFormat: 'HH:mm:ss' };
    // 83_000 ms = 00:01:23 UTC; the test only checks the pattern shape.
    expect(formatValue(83_000, 'time', settings)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('falls back to HH:mm:ss.SSS when timeFormat is unset', () => {
    expect(formatValue(83_000, 'time', {})).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it('returns String(value) when the value cannot be parsed', () => {
    expect(formatValue('not a date', 'time', {})).toBe('not a date');
  });
});
```

Adapt the exported symbol name if `formatValue` is exported under a different name (verify with `grep -n "^export" core/frontend/services/templating/formatValue.ts`).

- [ ] **Step 2: Run test to see it fail**

```bash
cd core && npx vitest run tests/formatValue.test.ts
```
Expected: FAIL — the current `case 'time':` returns an ISO string, not `HH:mm:ss`.

- [ ] **Step 3: Update `formatValue.ts` `case 'time':`**

Open `core/frontend/services/templating/formatValue.ts`. At the top of the file, add the import (place it next to any other `../utils/` import):

```ts
import { formatTimestamp } from '../../utils/timeFormatter';
```

**Important:** the correct relative path from `services/templating/` to `utils/` is `../../utils/timeFormatter` (two `..`s). Verify with `ls core/frontend/services/templating/../../utils/timeFormatter.ts`.

Replace the current `case 'time':` block (lines 93–97):

```ts
        case 'time':
            // For now defer to the JS Date stringifier; the existing
            // `timeFormat` helpers in utils/ can be plugged in when wired.
            try { return new Date(value as any).toISOString(); }
            catch { return String(value); }
```

with:

```ts
        case 'time':
            try {
                return formatTimestamp(value as number, settings.timeFormat ?? 'HH:mm:ss.SSS');
            } catch {
                return String(value);
            }
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd core && npx vitest run tests/formatValue.test.ts
```
Expected: PASS.

- [ ] **Step 5: Full sweep**

```bash
cd core && npx tsc --noEmit && npx vitest run
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add core/frontend/services/templating/formatValue.ts core/frontend/tests/formatValue.test.ts
git commit -m "fix(templating): render \${… | time} via formatTimestamp+timeFormat"
```

---

## Task 7: PlotTooltip helper (M1 + M2 combined)

**Rationale:** Both features write a custom `<Tooltip content={…}/>` for Recharts. Ship one helper (`PlotTooltip`) with three modes:
- `onHoverTooltip` set → format-string tooltip (M1).
- `tooltipColumns` set → filtered standard tooltip (M2).
- Neither → callers use the default `<Tooltip>` (no change).

**Files:**
- Create: `core/frontend/components/plots/PlotTooltip.tsx`
- Create: `core/frontend/tests/plotTooltip.test.tsx`
- Modify: each chart that renders `<Tooltip>`:
  - `core/frontend/components/plots/LineChartPlot.tsx`
  - `core/frontend/components/plots/BarChartPlot.ts`
  - `core/frontend/components/plots/ScatterPlot.tsx`
  - `core/frontend/components/plots/HistogramPlot.tsx`
  - `core/frontend/components/plots/AreaChartPlot.tsx`
  - `core/frontend/components/plots/RangePlot.tsx`
  - `core/frontend/components/plots/BoxPlot.tsx`
  (Skip `GanttChartPlot.tsx`, `FlameGraphPlot.tsx` — custom tooltips already.)

- [ ] **Step 1: Write failing tests for PlotTooltip**

Create `core/frontend/tests/plotTooltip.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PlotTooltip } from '../components/plots/PlotTooltip';

const payload = [
  { name: 'method', value: 'foo()', dataKey: 'method', color: '#f00' },
  { name: 'duration', value: 123, dataKey: 'duration', color: '#0f0' },
  { name: 'thread', value: 'main', dataKey: 'thread', color: '#00f' },
];

describe('PlotTooltip', () => {
  it('formats {col} placeholders when onHoverTooltip is set', () => {
    const { container } = render(
      <PlotTooltip active={true} payload={payload} onHoverTooltip="Method: {method} — {duration}ms" />
    );
    expect(container.textContent).toContain('Method: foo() — 123ms');
  });

  it('filters rows when tooltipColumns is set', () => {
    const { container } = render(
      <PlotTooltip active={true} payload={payload} tooltipColumns={['method', 'duration']} />
    );
    expect(container.textContent).toContain('method');
    expect(container.textContent).toContain('duration');
    expect(container.textContent).not.toContain('thread');
  });

  it('returns null when inactive', () => {
    const { container } = render(
      <PlotTooltip active={false} payload={payload} onHoverTooltip="x: {duration}" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when both filters absent (caller should use default Tooltip)', () => {
    const { container } = render(
      <PlotTooltip active={true} payload={payload} />
    );
    expect(container.firstChild).toBeNull();
  });
});
```

If `@testing-library/react` is not installed, install it:

```bash
cd core/frontend && npm install --save-dev @testing-library/react @testing-library/jest-dom jsdom
```

Also confirm `core/vitest.config.*` sets `environment: 'jsdom'`. If not, either add it to the config or restrict this test to use `// @vitest-environment jsdom` at file top:

```tsx
// @vitest-environment jsdom
```

- [ ] **Step 2: Run test to see it fail**

```bash
cd core && npx vitest run tests/plotTooltip.test.tsx
```
Expected: FAIL — `PlotTooltip` not found.

- [ ] **Step 3: Implement `PlotTooltip`**

Create `core/frontend/components/plots/PlotTooltip.tsx`:

```tsx
import React from 'react';

export interface PlotTooltipEntry {
    name: string;
    value: unknown;
    dataKey: string;
    color?: string;
}

export interface PlotTooltipProps {
    active?: boolean;
    payload?: PlotTooltipEntry[];
    label?: unknown;
    /** Format string with `{columnName}` placeholders (M1). */
    onHoverTooltip?: string;
    /** Only show these column names / dataKeys in the tooltip (M2). */
    tooltipColumns?: string[];
    /** Optional label formatter for the tooltip header row. */
    labelFormatter?: (label: unknown) => string;
}

const boxCls = 'bg-gray-800 border border-gray-600 text-white text-xs p-2 rounded';

const lookup = (payload: PlotTooltipEntry[], key: string): unknown => {
    for (const e of payload) {
        if (e.name === key || e.dataKey === key) return e.value;
    }
    return undefined;
};

const formatPlaceholders = (fmt: string, payload: PlotTooltipEntry[]): string =>
    fmt.replace(/\{([A-Za-z_][\w]*)\}/g, (_m, key: string) => {
        const v = lookup(payload, key);
        return v === undefined ? '' : String(v);
    });

export const PlotTooltip: React.FC<PlotTooltipProps> = ({
    active, payload, label, onHoverTooltip, tooltipColumns, labelFormatter,
}) => {
    if (!active || !payload || payload.length === 0) return null;

    if (onHoverTooltip) {
        return <div className={boxCls}>{formatPlaceholders(onHoverTooltip, payload)}</div>;
    }

    if (tooltipColumns && tooltipColumns.length > 0) {
        const shown = payload.filter(e => tooltipColumns.includes(e.name) || tooltipColumns.includes(e.dataKey));
        return (
            <div className={boxCls}>
                {label !== undefined && (
                    <div className="mb-1 opacity-80">
                        {labelFormatter ? labelFormatter(label) : String(label)}
                    </div>
                )}
                {shown.map((e) => (
                    <div key={e.dataKey} style={{ color: e.color }}>
                        <span className="opacity-80">{e.name.replace(/_/g, ' ')}:</span>{' '}
                        <span>{String(e.value)}</span>
                    </div>
                ))}
            </div>
        );
    }

    // Neither mode → let the caller fall back to the default Recharts Tooltip.
    return null;
};
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd core && npx vitest run tests/plotTooltip.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Wire PlotTooltip into LineChartPlot**

Open `core/frontend/components/plots/LineChartPlot.tsx`. Add import:

```ts
import { PlotTooltip } from './PlotTooltip';
```

Find the `<Tooltip .../>` element (around line 115). Wrap the existing props into a fallback and add `content` when either DSL clause is set. Concretely, keep the existing default styling for the fallback and only override with `content` when custom behavior is requested:

```tsx
<Tooltip
  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563' }}
  formatter={(v, n) => [(allY2.includes(String(n)) ? y2Formatter : yFormatter)(v), String(n).replace(/_/g, ' ')]}
  labelFormatter={isTime ? (l) => formatTimestamp(l, settings.timeFormat) : undefined}
  content={
    (parsed.onHoverTooltip || (parsed.tooltipColumns && parsed.tooltipColumns.length > 0))
      ? (props: any) => (
          <PlotTooltip
            {...props}
            onHoverTooltip={parsed.onHoverTooltip}
            tooltipColumns={parsed.tooltipColumns}
            labelFormatter={isTime ? (l: any) => formatTimestamp(l, settings.timeFormat) : undefined}
          />
        )
      : undefined
  }
/>
```

Adjust the `parsed` variable name to match the local one in the file (may be `parsedPlot`, `cfg`, or similar — inspect the file's top). The `content` prop, when passed a function that returns `null`, causes Recharts to skip rendering the tooltip — that is why `PlotTooltip` returns `null` in the neither-clause branch, and why we guard the `content={…}` with the outer conditional to still allow the default when neither clause is set.

- [ ] **Step 6: Wire PlotTooltip into remaining charts**

Repeat Step 5 for:
- `BarChartPlot.ts`
- `ScatterPlot.tsx`
- `HistogramPlot.tsx`
- `AreaChartPlot.tsx`
- `RangePlot.tsx`
- `BoxPlot.tsx`

For each, look at the existing `<Tooltip .../>` element. Preserve its current props (styles/formatters). Add the `content={ … ? (props) => <PlotTooltip …/> : undefined }` block using the same pattern.

If a chart passes its `<Tooltip>` no `formatter` currently (e.g. `HistogramPlot.tsx` at line 83), simply add the `content` prop; leave everything else as-is.

- [ ] **Step 7: Add an integration test**

Append to `core/frontend/tests/plotTooltip.test.tsx` (or add a small new test file if you prefer to keep concerns separate) a parser round-trip:

```tsx
import { parsePlotCall } from '../utils/plotParser';

describe('PlotTooltip integration with parser', () => {
  it('parses ON HOVER TOOLTIP and forwards to PlotTooltip format', () => {
    const parsed = parsePlotCall('LINE_CHART X t Y v ON HOVER TOOLTIP "at {t}: {v}"');
    expect(parsed.onHoverTooltip).toBe('at {t}: {v}');
  });
  it('parses TOOLTIP COLUMNS [...]', () => {
    const parsed = parsePlotCall('LINE_CHART X t Y v TOOLTIP COLUMNS [a, "b c", d]');
    expect(parsed.tooltipColumns).toEqual(['a', 'b c', 'd']);
  });
});
```

- [ ] **Step 8: Full sweep**

```bash
cd core && npx tsc --noEmit && npx vitest run
```
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add core/frontend/components/plots/PlotTooltip.tsx \
        core/frontend/components/plots/LineChartPlot.tsx \
        core/frontend/components/plots/BarChartPlot.ts \
        core/frontend/components/plots/ScatterPlot.tsx \
        core/frontend/components/plots/HistogramPlot.tsx \
        core/frontend/components/plots/AreaChartPlot.tsx \
        core/frontend/components/plots/RangePlot.tsx \
        core/frontend/components/plots/BoxPlot.tsx \
        core/frontend/tests/plotTooltip.test.tsx
git commit -m "feat(plots): implement ON HOVER TOOLTIP and TOOLTIP COLUMNS via PlotTooltip"
```

Stage `package*.json` if new dev deps were installed.

---

## Task 8: Implement cellConditions visibility (M3)

**Rationale:** `NotebookMetadata.cellConditions` maps cell handle → SQL predicate. If falsy, the cell renders collapsed.

**Files:**
- Modify: `core/frontend/components/Notebook.tsx`
- Modify or create: `core/frontend/services/templating/evaluators.ts` (no code change needed — just import)
- Create test: `core/frontend/tests/cellConditions.test.tsx` (component-level render smoke) OR a plainer unit test file `core/frontend/tests/cellConditions.test.ts` that stubs `dbQuery` and calls a factored-out helper.

**Decomposition:** To keep the change testable without a full DOM/duckdb fixture, factor out a pure helper `resolveCellVisibility` in a new file `core/frontend/utils/cellVisibility.ts`. `Notebook.tsx` then calls it in a `useEffect`.

- [ ] **Step 1: Write failing test for `resolveCellVisibility`**

Create `core/frontend/tests/cellVisibility.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolveCellVisibility } from '../utils/cellVisibility';

describe('resolveCellVisibility', () => {
  it('returns true for cells with no condition', async () => {
    const q = vi.fn();
    const r = await resolveCellVisibility('some_cell', undefined, {}, q);
    expect(r).toBe(true);
    expect(q).not.toHaveBeenCalled();
  });

  it('substitutes variables before running the predicate', async () => {
    const q = vi.fn().mockResolvedValue([{ v: 1 }]);
    await resolveCellVisibility(
      'c1',
      { c1: 'SELECT 1 WHERE ${threshold} > 0' },
      { threshold: '5' },
      q,
    );
    expect(q).toHaveBeenCalledWith('SELECT 1 WHERE 5 > 0');
  });

  it('collapses (returns false) when predicate yields no rows', async () => {
    const q = vi.fn().mockResolvedValue([]);
    const r = await resolveCellVisibility('c1', { c1: 'SELECT 1 WHERE FALSE' }, {}, q);
    expect(r).toBe(false);
  });

  it('collapses when predicate yields a falsy first cell', async () => {
    const q = vi.fn().mockResolvedValue([{ v: 0 }]);
    const r = await resolveCellVisibility('c1', { c1: 'SELECT 0 AS v' }, {}, q);
    expect(r).toBe(false);
  });

  it('shows when predicate yields a truthy first cell', async () => {
    const q = vi.fn().mockResolvedValue([{ v: 1 }]);
    const r = await resolveCellVisibility('c1', { c1: 'SELECT 1 AS v' }, {}, q);
    expect(r).toBe(true);
  });

  it('defaults to visible when the predicate throws', async () => {
    const q = vi.fn().mockRejectedValue(new Error('bad sql'));
    const r = await resolveCellVisibility('c1', { c1: 'SELECT bogus' }, {}, q);
    expect(r).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to see it fail**

```bash
cd core && npx vitest run tests/cellVisibility.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `resolveCellVisibility`**

Create `core/frontend/utils/cellVisibility.ts`:

```ts
import { expandVariables } from '../services/variableExpander';

export type CellQueryFn = (sql: string) => Promise<Array<Record<string, unknown>>>;

const isTruthy = (v: unknown): boolean => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
    if (typeof v === 'string') return v.length > 0 && v.toLowerCase() !== 'false' && v !== '0';
    if (typeof v === 'boolean') return v;
    return true;
};

export async function resolveCellVisibility(
    cellName: string,
    cellConditions: Record<string, string> | undefined,
    variables: Record<string, string>,
    query: CellQueryFn,
): Promise<boolean> {
    if (!cellConditions) return true;
    const predicate = cellConditions[cellName];
    if (!predicate) return true;

    const expanded = expandVariables(predicate, variables);
    try {
        const rows = await query(expanded);
        if (!rows || rows.length === 0) return false;
        const firstRow = rows[0];
        const firstVal = Object.values(firstRow)[0];
        return isTruthy(firstVal);
    } catch {
        // On evaluation error, default to visible so authors can see (and fix) the cell.
        return true;
    }
}
```

**Verify import path** for `expandVariables`: run `grep -n "expandVariables" core/frontend/services/variableExpander.ts`. If the export is named differently, adjust. Fallback: if `expandVariables` doesn't exist in that exact form, use whatever the module exports for variable substitution (e.g. `substituteVars`).

- [ ] **Step 4: Run test to verify pass**

```bash
cd core && npx vitest run tests/cellVisibility.test.ts
```
Expected: PASS.

- [ ] **Step 5: Wire into `Notebook.tsx`**

Open `core/frontend/components/Notebook.tsx`. Add imports:

```ts
import { resolveCellVisibility } from '../utils/cellVisibility';
import { useEffect, useState } from 'react';
```
(Only the ones not already imported.)

Inside the component that renders the cell list, add a state map for visibility and a resolver effect. Assume the existing cells iterable is `cells` and each cell has a `name` field (from `parseCellDirective`) and a fallback `cell_<idx>`:

```tsx
const [cellVisibility, setCellVisibility] = useState<Record<string, boolean>>({});

useEffect(() => {
  let cancelled = false;
  (async () => {
    const next: Record<string, boolean> = {};
    for (let idx = 0; idx < cells.length; idx++) {
      const c = cells[idx];
      const name = c.name || `cell_${idx + 1}`;
      next[name] = await resolveCellVisibility(
        name,
        metadata.cellConditions,
        metadata.variables ?? {},
        dbQuery,
      );
    }
    if (!cancelled) setCellVisibility(next);
  })();
  return () => { cancelled = true; };
}, [cells, metadata.cellConditions, metadata.variables, dbQuery]);
```

Adjust names to match locals in the file:
- The array of cells may be `cells`, `parsed.cells`, or `notebook.cells` — inspect the file.
- `dbQuery` may be `runQuery`, `db.query`, or come from a hook (`useDb()`) — inspect and use the actual function that returns `Array<Record<string, unknown>>`.

When rendering each cell, use `cellVisibility[name]` (defaulting to `true` when key is missing, so the initial render shows everything until the effect resolves):

```tsx
{cells.map((c, idx) => {
  const name = c.name || `cell_${idx + 1}`;
  const visible = cellVisibility[name] ?? true;
  return (
    <CellComponent key={idx} cell={c} collapsed={!visible} />
  );
})}
```

If `CellComponent` (or whatever renders individual cells) does not yet accept a `collapsed` prop, either:
- Extend it with `collapsed?: boolean` — when true, render only the cell header (e.g. the cell name row) and hide the body; OR
- Conditionally wrap the cell in a `<details>` when collapsed:
  ```tsx
  return visible
    ? <CellComponent key={idx} cell={c} />
    : <details key={idx} className="opacity-60"><summary>{name} (hidden by condition)</summary></details>;
  ```

Pick whichever fits the existing component contract. The `<details>` fallback is safe when unsure.

- [ ] **Step 6: Type-check and full run**

```bash
cd core && npx tsc --noEmit && npx vitest run
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add core/frontend/utils/cellVisibility.ts \
        core/frontend/components/Notebook.tsx \
        core/frontend/tests/cellVisibility.test.ts
git commit -m "feat(notebook): evaluate cellConditions front-matter to collapse hidden cells"
```

---

## Task 9: LINK_X master — drive-vs-follower semantics (M4)

**Rationale:** With `LINK_X($start, $end, master)`, that plot drives the domain. Peers subscribe but don't publish.

**Files:**
- Modify: `core/frontend/components/PlotRenderer.tsx` (`InteractivePlotWrapper` or the publish/subscribe wiring around line 748)
- Create test: `core/frontend/tests/linkXMaster.test.ts`

- [ ] **Step 1: Inspect the existing publish/subscribe logic**

Read `core/frontend/components/PlotRenderer.tsx` lines 640–800 (search for `linkXStore`, `linkXMaster`, and `InteractivePlotWrapper`). Identify:

- Where the plot publishes gesture events to `linkXStore` (e.g. `linkXStore.publish(...)`).
- Where the plot subscribes for domain updates (e.g. `linkXStore.subscribe(...)` or a hook).

Document (in a scratch comment while working) the two symbols used for publish and subscribe. The remainder of this task assumes:
- `publishDomain(pair, domain)` writes to the store.
- `useLinkXDomain(pair)` reads the current domain.

Substitute these with the actual names from the file.

- [ ] **Step 2: Write failing test for a `shouldPublishLinkX` helper**

Factor out a tiny pure helper so the semantics are testable. Create `core/frontend/tests/linkXMaster.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldPublishLinkX } from '../utils/linkXMaster';

describe('shouldPublishLinkX', () => {
  it('publishes when no linkX pair is set (no linking)', () => {
    expect(shouldPublishLinkX(undefined, undefined)).toBe(true);
  });
  it('publishes when a pair is set and master is undefined (legacy peer-broadcast)', () => {
    expect(shouldPublishLinkX(['$a', '$b'], undefined)).toBe(true);
  });
  it('publishes when master is true', () => {
    expect(shouldPublishLinkX(['$a', '$b'], true)).toBe(true);
  });
  it('does NOT publish when master is false (explicit follower)', () => {
    expect(shouldPublishLinkX(['$a', '$b'], false)).toBe(false);
  });
});
```

Note: In the current parser, `linkXMaster` is set to `options.includes('master')` (line 223 of plotParser.ts), so it's `true` when `master` is present and `false` when absent. That means "follower with no `master` keyword" and "explicit follower" collide today. The spec here defines:
- `master=true` → publish + subscribe.
- `master=false` → subscribe only (legacy peer-broadcast is replaced by this).

To preserve the "no keyword = peer-broadcast" behaviour described in the spec's third bullet, we distinguish "no LINK_X keyword arg present" from "LINK_X keyword arg with `master` absent". That requires the parser to emit `undefined` when the `master` keyword is not among the options and only `true` when it is. Change plotParser.ts line 223 from:

```ts
result.linkXMaster = options.includes('master');
```

to:

```ts
result.linkXMaster = options.includes('master') ? true : undefined;
```

And add the equivalent change in `core/frontend/components/editor/plot/derive.ts` line 303:

```ts
result.linkXMaster = opts.includes('master') ? true : undefined;
```

Now `linkXMaster` is `true` when explicit-master, `undefined` when just linked (peer-broadcast), and never `false`. The helper's `master=false` test above becomes hypothetical for future explicit `follower` keyword; keep it in the suite as a specification test.

- [ ] **Step 3: Run test to see it fail**

```bash
cd core && npx vitest run tests/linkXMaster.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 4: Implement helper**

Create `core/frontend/utils/linkXMaster.ts`:

```ts
/**
 * Decide whether a plot should publish its gesture-derived domain to the
 * cross-plot linkX store.
 *
 * @param linkXPair the [`$start`, `$end`] variable names, or undefined when not linked.
 * @param master    the `linkXMaster` field on the parsed plot call:
 *                  - true      → explicit master; publishes and subscribes
 *                  - false     → explicit follower; subscribes only
 *                  - undefined → legacy peer-broadcast; publishes and subscribes
 * @returns true when the plot should publish to the store on gesture events.
 */
export function shouldPublishLinkX(
    linkXPair: [string, string] | undefined,
    master: boolean | undefined,
): boolean {
    if (!linkXPair) return true;         // not linked at all
    if (master === false) return false;  // explicit follower
    return true;                          // master=true or undefined (peer)
}
```

- [ ] **Step 5: Verify parser change and update the plotParser test**

Update `plotParser.ts` line 223 and `derive.ts` line 303 as in Step 2 (change assignment). Then add to `core/frontend/tests/plotParser.clauses.test.ts`:

```ts
  it('sets linkXMaster undefined when master keyword absent', () => {
    const res = parsePlotCall('LINE_CHART X t Y v LINK_X($a, $b)');
    expect(res.linkX).toEqual(['$a', '$b']);
    expect(res.linkXMaster).toBeUndefined();
  });

  it('sets linkXMaster true when master keyword present', () => {
    const res = parsePlotCall('LINE_CHART X t Y v LINK_X($a, $b, master)');
    expect(res.linkXMaster).toBe(true);
  });
```

- [ ] **Step 6: Run tests to verify helper + parser**

```bash
cd core && npx vitest run tests/linkXMaster.test.ts tests/plotParser.clauses.test.ts
```
Expected: PASS.

- [ ] **Step 7: Consume the helper in PlotRenderer**

Open `core/frontend/components/PlotRenderer.tsx`. Add import:

```ts
import { shouldPublishLinkX } from '../utils/linkXMaster';
```

Find the publish call inside `InteractivePlotWrapper` (near line 748, where the JSDoc says "Publish to plotBrushStore for cross-cell LINK-X/Y/XY subscriptions"). Wrap the publish site with the helper. The exact code will look like something along the lines of:

```ts
// Before:
linkXStore.publish(pair, domain);

// After:
if (shouldPublishLinkX(leaf.linkX, leaf.linkXMaster)) {
    linkXStore.publish(pair, domain);
}
```

Substitute `leaf` for whatever local variable holds the parsed plot (may be `parsed`, `plot`, `node`). The subscribe side is untouched — followers still receive updates.

If the file also disables interactivity when there's no publish (e.g., mouse handlers only wired when publishing), decide whether followers should still show a mouse cursor for local hover. The safe default: keep interactivity enabled but skip the publish call. This preserves tooltips while making the follower non-driving.

- [ ] **Step 8: Update the multi-plot coordination test to cover master/follower**

Open `core/frontend/tests/multiPlotCoordination.test.ts` (already exists per earlier grep). Append a test:

```ts
import { shouldPublishLinkX } from '../utils/linkXMaster';

describe('LINK_X master semantics', () => {
  it('followers do not publish', () => {
    expect(shouldPublishLinkX(['$a', '$b'], false)).toBe(false);
  });
  it('masters publish', () => {
    expect(shouldPublishLinkX(['$a', '$b'], true)).toBe(true);
  });
  it('legacy peers publish', () => {
    expect(shouldPublishLinkX(['$a', '$b'], undefined)).toBe(true);
  });
});
```

If the file uses a different testing pattern (`vitest`'s `describe`/`it` should be already imported at file top), keep consistent with existing imports.

- [ ] **Step 9: Type-check and full run**

```bash
cd core && npx tsc --noEmit && npx vitest run
```
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add core/frontend/utils/linkXMaster.ts \
        core/frontend/utils/plotParser.ts \
        core/frontend/components/editor/plot/derive.ts \
        core/frontend/components/PlotRenderer.tsx \
        core/frontend/tests/linkXMaster.test.ts \
        core/frontend/tests/plotParser.clauses.test.ts \
        core/frontend/tests/multiPlotCoordination.test.ts
git commit -m "feat(link-x): master keyword drives publishes; peers keep legacy broadcast"
```

---

## Wrap-up

- [ ] **Final full-suite run**

```bash
cd core && npx tsc --noEmit && npx vitest run
```
Expected: no type errors; all tests green.

- [ ] **Optional smoke test in the browser**

```bash
cd core/frontend && npm run dev
```
Open the app; load an example notebook; verify:
- SUBTITLE and ON CLICK NAVIGATE errors do not surface for existing notebooks that used them (they are now unknown clauses — parser should ignore or reject cleanly; if they were removed by anyone, no user-facing regression).
- A plot with `AXIS_Y TYPE log FORMAT ".2f"` renders log-scaled with two-decimal ticks.
- A plot with `ON HOVER TOOLTIP "…{col}…"` renders the format string.
- A plot with `TOOLTIP COLUMNS [a, b]` shows only `a` and `b`.
- A notebook front-matter with `title:`, `tags: [a, b]` shows those in the intro.
- A cell with `cellConditions: { name: "SELECT 0" }` renders collapsed.
- Two linked plots where only one has `LINK_X(..., master)`: gestures on the master zoom both; gestures on the follower do not affect the master.

- [ ] **Sanity-check the commit sequence**

```bash
git log --oneline main..HEAD
```
Expected: nine commits, one per task, each with the message shown above.
