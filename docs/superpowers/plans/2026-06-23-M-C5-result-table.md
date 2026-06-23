# M-C5: Result Table with Full Interactions — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans.
> **Testing standard:** All 5 layers apply.

**Goal:** Deliver a fully-interactive result table with sort, virtual scroll, column resize, row selection, and CSV/JSON copy.
**Blocked by:** M-B3 (query execution pipeline, result rows format)
**Tech stack:** React 19.2, TypeScript 5.8, Vitest 4.1.9 (pool: forks), no external table library

---

## Critical Rules (NEVER violate)

- `AppShell.tsx` MUST keep `useState(!hasNotebook)` — NEVER change to `useState(false)`
- `import type { JSX } from 'react'` in every component file
- `pool: 'forks'` in vitest.config.ts — NEVER change
- All colors via CSS token vars only — NEVER hardcode hex values
- No `text-sm` — use literal px sizes: `text-[11px]`, `text-[12px]`, `text-[13px]`
- No `any` type — use `unknown` with narrowing

---

## File Map

```
src/components/resultTable/
  ResultTable.tsx              — main orchestrating component
  ResultTableToolbar.tsx       — copy-all CSV button + selection count display
  useColumnTypes.ts            — column type inference hook (number/date/string)
  useVirtualList.ts            — windowed rendering hook (position:absolute rows)
  useTableSort.ts              — single-column sort state + comparator
  useColumnResize.ts           — mouse-drag column resize hook
  useRowSelection.ts           — row selection state + keyboard shortcuts

src/utils/resultTableUtils.ts  — pure functions: rowToCSV, rowToJSON, rowsToCSV

src/__tests__/resultTable/
  resultTableUtils.test.ts     — unit tests for pure utility functions
  useColumnTypes.test.ts       — type inference hook tests
  useTableSort.test.ts         — sort logic tests
  useVirtualList.test.ts       — windowing calculation tests
  ResultTable.test.tsx         — component integration tests (Vitest + jsdom)
```

---

## Tasks

### Task 1 — Pure utility functions (rowToCSV, rowToJSON, rowsToCSV)

**Principle:** Start with pure functions — no React, no DOM, easiest to unit-test.

#### 1a. Write failing tests

Create `src/__tests__/resultTable/resultTableUtils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  rowToCSV,
  rowToJSON,
  rowsToCSV,
  escapeCsvField,
} from '../../utils/resultTableUtils'

describe('escapeCsvField', () => {
  it('returns plain value for simple strings', () => {
    expect(escapeCsvField('hello')).toBe('hello')
  })
  it('wraps in quotes when field contains comma', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"')
  })
  it('wraps in quotes and escapes inner quotes', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
  })
  it('wraps in quotes when field contains newline', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"')
  })
  it('converts null to empty string', () => {
    expect(escapeCsvField(null)).toBe('')
  })
  it('converts undefined to empty string', () => {
    expect(escapeCsvField(undefined)).toBe('')
  })
  it('converts numbers to string', () => {
    expect(escapeCsvField(42)).toBe('42')
  })
})

describe('rowToCSV', () => {
  it('serialises row values in column order', () => {
    const row: Record<string, unknown> = { b: 2, a: 1, c: 'x' }
    const columns = ['a', 'b', 'c']
    expect(rowToCSV(row, columns)).toBe('1,2,x')
  })
  it('handles missing column value as empty', () => {
    const row: Record<string, unknown> = { a: 1 }
    expect(rowToCSV(row, ['a', 'b'])).toBe('1,')
  })
})

describe('rowToJSON', () => {
  it('returns pretty-printed JSON for a row', () => {
    const row: Record<string, unknown> = { a: 1, b: 'hello' }
    const result = rowToJSON(row)
    expect(JSON.parse(result)).toEqual({ a: 1, b: 'hello' })
  })
})

describe('rowsToCSV', () => {
  it('produces header + data rows', () => {
    const rows: Record<string, unknown>[] = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]
    const columns = ['name', 'age']
    const csv = rowsToCSV(rows, columns)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('name,age')
    expect(lines[1]).toBe('Alice,30')
    expect(lines[2]).toBe('Bob,25')
  })
  it('returns just header for empty rows', () => {
    expect(rowsToCSV([], ['a', 'b'])).toBe('a,b')
  })
  it('quotes fields with commas', () => {
    const rows: Record<string, unknown>[] = [{ x: 'a,b' }]
    expect(rowsToCSV(rows, ['x'])).toBe('x\n"a,b"')
  })
})
```

#### 1b. Verify tests fail

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/resultTableUtils.test.ts 2>&1 | tail -20
```

Expected: `Cannot find module '../../utils/resultTableUtils'`

#### 1c. Implement `src/utils/resultTableUtils.ts`

```typescript
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

export function rowToCSV(row: Record<string, unknown>, columns: string[]): string {
  return columns.map((col) => escapeCsvField(row[col])).join(',')
}

export function rowToJSON(row: Record<string, unknown>): string {
  return JSON.stringify(row, null, 2)
}

export function rowsToCSV(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(',')
  if (rows.length === 0) return header
  const dataLines = rows.map((row) => rowToCSV(row, columns))
  return [header, ...dataLines].join('\n')
}
```

#### 1d. Verify tests pass

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/resultTableUtils.test.ts 2>&1 | tail -10
```

Expected: all tests pass, no failures.

#### 1e. Commit

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/utils/resultTableUtils.ts \
  frontend-v2/src/__tests__/resultTable/resultTableUtils.test.ts
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "feat(M-C5): pure utils rowToCSV/rowToJSON/rowsToCSV with full unit tests"
```

---

### Task 2 — `useColumnTypes` hook

**Principle:** Type inference is logic-heavy — test it independently before wiring to UI.

#### 2a. Write failing tests

Create `src/__tests__/resultTable/useColumnTypes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useColumnTypes } from '../../components/resultTable/useColumnTypes'

const numericRows: Record<string, unknown>[] = [
  { id: 1, name: 'Alice', score: 99.5 },
  { id: 2, name: 'Bob', score: 87.0 },
  { id: 3, name: 'Carol', score: 72.3 },
]

const dateRows: Record<string, unknown>[] = [
  { ts: '2024-01-15T10:00:00Z', val: 1 },
  { ts: '2024-02-20T14:30:00Z', val: 2 },
]

describe('useColumnTypes', () => {
  it('infers "number" for numeric columns', () => {
    const { result } = renderHook(() =>
      useColumnTypes(numericRows, ['id', 'name', 'score'])
    )
    expect(result.current.id).toBe('number')
    expect(result.current.score).toBe('number')
  })

  it('infers "string" for string columns', () => {
    const { result } = renderHook(() =>
      useColumnTypes(numericRows, ['id', 'name', 'score'])
    )
    expect(result.current.name).toBe('string')
  })

  it('infers "date" for ISO date string columns', () => {
    const { result } = renderHook(() =>
      useColumnTypes(dateRows, ['ts', 'val'])
    )
    expect(result.current.ts).toBe('date')
  })

  it('handles empty rows gracefully', () => {
    const { result } = renderHook(() =>
      useColumnTypes([], ['a', 'b'])
    )
    expect(result.current.a).toBe('string')
    expect(result.current.b).toBe('string')
  })

  it('samples only first 50 rows', () => {
    const bigRows: Record<string, unknown>[] = Array.from({ length: 100 }, (_, i) => ({
      x: i < 50 ? 42 : 'text',
    }))
    const { result } = renderHook(() => useColumnTypes(bigRows, ['x']))
    // First 50 are numeric, so result should be number
    expect(result.current.x).toBe('number')
  })

  it('falls back to "string" for mixed columns', () => {
    const mixed: Record<string, unknown>[] = [
      { v: 1 },
      { v: 'hello' },
    ]
    const { result } = renderHook(() => useColumnTypes(mixed, ['v']))
    expect(result.current.v).toBe('string')
  })
})
```

#### 2b. Verify tests fail

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/useColumnTypes.test.ts 2>&1 | tail -20
```

Expected: module not found error.

#### 2c. Implement `src/components/resultTable/useColumnTypes.ts`

```typescript
import { useMemo } from 'react'

export type ColumnType = 'number' | 'date' | 'string'

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

function inferType(values: unknown[]): ColumnType {
  if (values.length === 0) return 'string'
  let allNumber = true
  let allDate = true
  for (const v of values) {
    if (v === null || v === undefined) continue
    if (typeof v !== 'number') allNumber = false
    if (typeof v !== 'string' || !ISO_DATE_RE.test(v)) allDate = false
    if (!allNumber && !allDate) break
  }
  if (allNumber) return 'number'
  if (allDate) return 'date'
  return 'string'
}

export function useColumnTypes(
  rows: Record<string, unknown>[],
  columns: string[]
): Record<string, ColumnType> {
  return useMemo(() => {
    const sample = rows.slice(0, 50)
    const result: Record<string, ColumnType> = {}
    for (const col of columns) {
      const values = sample.map((r) => r[col])
      result[col] = inferType(values)
    }
    return result
  }, [rows, columns])
}
```

#### 2d. Verify tests pass

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/useColumnTypes.test.ts 2>&1 | tail -10
```

#### 2e. Commit

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/components/resultTable/useColumnTypes.ts \
  frontend-v2/src/__tests__/resultTable/useColumnTypes.test.ts
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "feat(M-C5): useColumnTypes hook with number/date/string inference"
```

---

### Task 3 — `useTableSort` hook

**Principle:** Sort is pure logic — test comparator and state transitions in isolation.

#### 3a. Write failing tests

Create `src/__tests__/resultTable/useTableSort.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTableSort } from '../../components/resultTable/useTableSort'

const rows: Record<string, unknown>[] = [
  { name: 'Charlie', score: 70 },
  { name: 'Alice', score: 90 },
  { name: 'Bob', score: 80 },
]

describe('useTableSort', () => {
  it('returns original order when no column is sorted', () => {
    const { result } = renderHook(() => useTableSort(rows))
    expect(result.current.sortedRows.map((r) => r.name)).toEqual([
      'Charlie', 'Alice', 'Bob',
    ])
    expect(result.current.sortKey).toBeNull()
    expect(result.current.sortDir).toBe('none')
  })

  it('sorts ascending on first click', () => {
    const { result } = renderHook(() => useTableSort(rows))
    act(() => result.current.onSort('name'))
    expect(result.current.sortDir).toBe('asc')
    expect(result.current.sortedRows.map((r) => r.name)).toEqual([
      'Alice', 'Bob', 'Charlie',
    ])
  })

  it('sorts descending on second click of same column', () => {
    const { result } = renderHook(() => useTableSort(rows))
    act(() => result.current.onSort('name'))
    act(() => result.current.onSort('name'))
    expect(result.current.sortDir).toBe('desc')
    expect(result.current.sortedRows.map((r) => r.name)).toEqual([
      'Charlie', 'Bob', 'Alice',
    ])
  })

  it('clears sort on third click of same column', () => {
    const { result } = renderHook(() => useTableSort(rows))
    act(() => result.current.onSort('name'))
    act(() => result.current.onSort('name'))
    act(() => result.current.onSort('name'))
    expect(result.current.sortDir).toBe('none')
    expect(result.current.sortKey).toBeNull()
    expect(result.current.sortedRows.map((r) => r.name)).toEqual([
      'Charlie', 'Alice', 'Bob',
    ])
  })

  it('switches to new column asc when different column clicked', () => {
    const { result } = renderHook(() => useTableSort(rows))
    act(() => result.current.onSort('name'))
    act(() => result.current.onSort('score'))
    expect(result.current.sortKey).toBe('score')
    expect(result.current.sortDir).toBe('asc')
    expect(result.current.sortedRows.map((r) => r.score)).toEqual([70, 80, 90])
  })

  it('sorts numbers correctly (not lexicographically)', () => {
    const numRows: Record<string, unknown>[] = [
      { v: 100 }, { v: 9 }, { v: 20 },
    ]
    const { result } = renderHook(() => useTableSort(numRows))
    act(() => result.current.onSort('v'))
    expect(result.current.sortedRows.map((r) => r.v)).toEqual([9, 20, 100])
  })

  it('handles null values (nulls last)', () => {
    const nullRows: Record<string, unknown>[] = [
      { v: 'b' }, { v: null }, { v: 'a' },
    ]
    const { result } = renderHook(() => useTableSort(nullRows))
    act(() => result.current.onSort('v'))
    const vals = result.current.sortedRows.map((r) => r.v)
    expect(vals[0]).toBe('a')
    expect(vals[1]).toBe('b')
    expect(vals[2]).toBeNull()
  })
})
```

#### 3b. Verify tests fail

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/useTableSort.test.ts 2>&1 | tail -20
```

#### 3c. Implement `src/components/resultTable/useTableSort.ts`

```typescript
import { useState, useMemo } from 'react'

export type SortDir = 'asc' | 'desc' | 'none'

export interface UseTableSortResult {
  sortedRows: Record<string, unknown>[]
  sortKey: string | null
  sortDir: SortDir
  onSort: (column: string) => void
}

function compareValues(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

export function useTableSort(rows: Record<string, unknown>[]): UseTableSortResult {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('none')

  function onSort(column: string): void {
    if (sortKey !== column) {
      setSortKey(column)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else if (sortDir === 'desc') {
      setSortKey(null)
      setSortDir('none')
    }
  }

  const sortedRows = useMemo(() => {
    if (sortKey === null || sortDir === 'none') return rows
    return [...rows].sort((a, b) => {
      const cmp = compareValues(a[sortKey], b[sortKey])
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir])

  return { sortedRows, sortKey, sortDir, onSort }
}
```

#### 3d. Verify tests pass

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/useTableSort.test.ts 2>&1 | tail -10
```

#### 3e. Commit

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/components/resultTable/useTableSort.ts \
  frontend-v2/src/__tests__/resultTable/useTableSort.test.ts
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "feat(M-C5): useTableSort hook with asc/desc/none cycling and null-last"
```

---

### Task 4 — `useVirtualList` hook

**Principle:** Windowing math is pure — test visible range calculations without any DOM.

#### 4a. Write failing tests

Create `src/__tests__/resultTable/useVirtualList.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVirtualList } from '../../components/resultTable/useVirtualList'

describe('useVirtualList', () => {
  const ROW_HEIGHT = 28
  const CONTAINER_HEIGHT = 280 // exactly 10 rows visible

  it('returns correct visible range for offset 0', () => {
    const { result } = renderHook(() =>
      useVirtualList({ itemCount: 1000, itemHeight: ROW_HEIGHT, containerHeight: CONTAINER_HEIGHT, scrollTop: 0 })
    )
    expect(result.current.startIndex).toBe(0)
    // overscan of 3 above + 10 visible + 3 below = indices 0..12
    expect(result.current.endIndex).toBeLessThanOrEqual(15)
    expect(result.current.totalHeight).toBe(1000 * ROW_HEIGHT)
  })

  it('shifts window when scrolled down', () => {
    const { result } = renderHook(() =>
      useVirtualList({ itemCount: 1000, itemHeight: ROW_HEIGHT, containerHeight: CONTAINER_HEIGHT, scrollTop: 560 })
    )
    // scrollTop 560 / 28 = 20th row
    expect(result.current.startIndex).toBeLessThanOrEqual(20)
    expect(result.current.endIndex).toBeGreaterThan(20)
  })

  it('clamps endIndex to itemCount', () => {
    const { result } = renderHook(() =>
      useVirtualList({ itemCount: 5, itemHeight: ROW_HEIGHT, containerHeight: CONTAINER_HEIGHT, scrollTop: 0 })
    )
    expect(result.current.endIndex).toBe(5)
  })

  it('returns correct offsetTop for each visible item', () => {
    const { result } = renderHook(() =>
      useVirtualList({ itemCount: 100, itemHeight: ROW_HEIGHT, containerHeight: CONTAINER_HEIGHT, scrollTop: 0 })
    )
    const items = result.current.visibleItems
    expect(items[0].offsetTop).toBe(0)
    expect(items[1].offsetTop).toBe(ROW_HEIGHT)
  })

  it('returns empty visibleItems for zero itemCount', () => {
    const { result } = renderHook(() =>
      useVirtualList({ itemCount: 0, itemHeight: ROW_HEIGHT, containerHeight: CONTAINER_HEIGHT, scrollTop: 0 })
    )
    expect(result.current.visibleItems).toHaveLength(0)
    expect(result.current.totalHeight).toBe(0)
  })
})
```

#### 4b. Verify tests fail

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/useVirtualList.test.ts 2>&1 | tail -20
```

#### 4c. Implement `src/components/resultTable/useVirtualList.ts`

```typescript
import { useMemo } from 'react'

export interface VirtualItem {
  index: number
  offsetTop: number
}

export interface UseVirtualListOptions {
  itemCount: number
  itemHeight: number
  containerHeight: number
  scrollTop: number
}

export interface UseVirtualListResult {
  startIndex: number
  endIndex: number
  visibleItems: VirtualItem[]
  totalHeight: number
}

const OVERSCAN = 3

export function useVirtualList(options: UseVirtualListOptions): UseVirtualListResult {
  const { itemCount, itemHeight, containerHeight, scrollTop } = options

  return useMemo(() => {
    const totalHeight = itemCount * itemHeight

    if (itemCount === 0) {
      return { startIndex: 0, endIndex: 0, visibleItems: [], totalHeight: 0 }
    }

    const rawStart = Math.floor(scrollTop / itemHeight)
    const visibleCount = Math.ceil(containerHeight / itemHeight)

    const startIndex = Math.max(0, rawStart - OVERSCAN)
    const endIndex = Math.min(itemCount, rawStart + visibleCount + OVERSCAN)

    const visibleItems: VirtualItem[] = []
    for (let i = startIndex; i < endIndex; i++) {
      visibleItems.push({ index: i, offsetTop: i * itemHeight })
    }

    return { startIndex, endIndex, visibleItems, totalHeight }
  }, [itemCount, itemHeight, containerHeight, scrollTop])
}
```

#### 4d. Verify tests pass

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/useVirtualList.test.ts 2>&1 | tail -10
```

#### 4e. Commit

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/components/resultTable/useVirtualList.ts \
  frontend-v2/src/__tests__/resultTable/useVirtualList.test.ts
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "feat(M-C5): useVirtualList hook with overscan and clamped endIndex"
```

---

### Task 5 — `useColumnResize` hook

**Principle:** Drag logic is stateful — test width transitions without requiring real mouse events.

#### 5a. Write failing tests

Add to `src/__tests__/resultTable/ResultTable.test.tsx` (or create a dedicated file `useColumnResize.test.ts`):

Create `src/__tests__/resultTable/useColumnResize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useColumnResize } from '../../components/resultTable/useColumnResize'

describe('useColumnResize', () => {
  const initialWidths: Record<string, number> = { name: 150, score: 100 }

  it('returns initial widths unchanged', () => {
    const { result } = renderHook(() => useColumnResize(initialWidths))
    expect(result.current.widths.name).toBe(150)
    expect(result.current.widths.score).toBe(100)
  })

  it('setWidth updates a column width', () => {
    const { result } = renderHook(() => useColumnResize(initialWidths))
    act(() => result.current.setWidth('name', 200))
    expect(result.current.widths.name).toBe(200)
    expect(result.current.widths.score).toBe(100)
  })

  it('clamps width to min 60px', () => {
    const { result } = renderHook(() => useColumnResize(initialWidths))
    act(() => result.current.setWidth('name', 10))
    expect(result.current.widths.name).toBe(60)
  })

  it('clamps width to max 600px', () => {
    const { result } = renderHook(() => useColumnResize(initialWidths))
    act(() => result.current.setWidth('name', 700))
    expect(result.current.widths.name).toBe(600)
  })

  it('getResizeHandleProps returns onMouseDown handler', () => {
    const { result } = renderHook(() => useColumnResize(initialWidths))
    const props = result.current.getResizeHandleProps('name')
    expect(typeof props.onMouseDown).toBe('function')
    expect(props.style?.cursor).toBe('col-resize')
  })

  it('resetWidths restores all widths to initial', () => {
    const { result } = renderHook(() => useColumnResize(initialWidths))
    act(() => result.current.setWidth('name', 300))
    act(() => result.current.resetWidths())
    expect(result.current.widths.name).toBe(150)
  })
})
```

#### 5b. Verify tests fail

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/useColumnResize.test.ts 2>&1 | tail -20
```

#### 5c. Implement `src/components/resultTable/useColumnResize.ts`

```typescript
import { useState, useCallback, useRef } from 'react'

const MIN_WIDTH = 60
const MAX_WIDTH = 600

export interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void
  style: React.CSSProperties
}

export interface UseColumnResizeResult {
  widths: Record<string, number>
  setWidth: (column: string, width: number) => void
  getResizeHandleProps: (column: string) => ResizeHandleProps
  resetWidths: () => void
}

function clamp(value: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value))
}

export function useColumnResize(
  initialWidths: Record<string, number>
): UseColumnResizeResult {
  const [widths, setWidths] = useState<Record<string, number>>({ ...initialWidths })
  const draggingColumn = useRef<string | null>(null)
  const dragStartX = useRef<number>(0)
  const dragStartWidth = useRef<number>(0)

  const setWidth = useCallback((column: string, width: number) => {
    setWidths((prev) => ({ ...prev, [column]: clamp(width) }))
  }, [])

  const resetWidths = useCallback(() => {
    setWidths({ ...initialWidths })
  }, [initialWidths])

  const getResizeHandleProps = useCallback(
    (column: string): ResizeHandleProps => ({
      style: { cursor: 'col-resize', userSelect: 'none', width: 6, position: 'absolute', right: 0, top: 0, bottom: 0 },
      onMouseDown: (e: React.MouseEvent) => {
        e.preventDefault()
        draggingColumn.current = column
        dragStartX.current = e.clientX
        dragStartWidth.current = widths[column] ?? 100

        function onMouseMove(ev: MouseEvent): void {
          if (!draggingColumn.current) return
          const delta = ev.clientX - dragStartX.current
          setWidth(draggingColumn.current, dragStartWidth.current + delta)
        }

        function onMouseUp(): void {
          draggingColumn.current = null
          window.removeEventListener('mousemove', onMouseMove)
          window.removeEventListener('mouseup', onMouseUp)
        }

        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
      },
    }),
    [widths, setWidth]
  )

  return { widths, setWidth, getResizeHandleProps, resetWidths }
}
```

#### 5d. Verify tests pass

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/useColumnResize.test.ts 2>&1 | tail -10
```

#### 5e. Commit

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/components/resultTable/useColumnResize.ts \
  frontend-v2/src/__tests__/resultTable/useColumnResize.test.ts
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "feat(M-C5): useColumnResize hook with 60-600px clamp and drag handles"
```

---

### Task 6 — `useRowSelection` hook

**Principle:** Selection state with keyboard modifiers is complex — test all modifier combinations before building UI.

#### 6a. Write failing tests

Create `src/__tests__/resultTable/useRowSelection.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRowSelection } from '../../components/resultTable/useRowSelection'

describe('useRowSelection', () => {
  it('starts with empty selection', () => {
    const { result } = renderHook(() => useRowSelection(10))
    expect(result.current.selectedIndices.size).toBe(0)
  })

  it('selects single row on plain click', () => {
    const { result } = renderHook(() => useRowSelection(10))
    act(() => result.current.onRowClick(3, { shiftKey: false, metaKey: false, ctrlKey: false }))
    expect(result.current.selectedIndices.has(3)).toBe(true)
    expect(result.current.selectedIndices.size).toBe(1)
  })

  it('deselects all others on plain click', () => {
    const { result } = renderHook(() => useRowSelection(10))
    act(() => result.current.onRowClick(1, { shiftKey: false, metaKey: false, ctrlKey: false }))
    act(() => result.current.onRowClick(3, { shiftKey: false, metaKey: false, ctrlKey: false }))
    expect(result.current.selectedIndices.has(1)).toBe(false)
    expect(result.current.selectedIndices.has(3)).toBe(true)
  })

  it('adds to selection with Ctrl+click', () => {
    const { result } = renderHook(() => useRowSelection(10))
    act(() => result.current.onRowClick(1, { shiftKey: false, metaKey: false, ctrlKey: false }))
    act(() => result.current.onRowClick(4, { shiftKey: false, metaKey: false, ctrlKey: true }))
    expect(result.current.selectedIndices.has(1)).toBe(true)
    expect(result.current.selectedIndices.has(4)).toBe(true)
  })

  it('adds to selection with Meta+click (Mac Cmd)', () => {
    const { result } = renderHook(() => useRowSelection(10))
    act(() => result.current.onRowClick(2, { shiftKey: false, metaKey: false, ctrlKey: false }))
    act(() => result.current.onRowClick(5, { shiftKey: false, metaKey: true, ctrlKey: false }))
    expect(result.current.selectedIndices.size).toBe(2)
  })

  it('removes already-selected row with Ctrl+click', () => {
    const { result } = renderHook(() => useRowSelection(10))
    act(() => result.current.onRowClick(2, { shiftKey: false, metaKey: false, ctrlKey: false }))
    act(() => result.current.onRowClick(2, { shiftKey: false, metaKey: false, ctrlKey: true }))
    expect(result.current.selectedIndices.has(2)).toBe(false)
  })

  it('selects range with Shift+click', () => {
    const { result } = renderHook(() => useRowSelection(10))
    act(() => result.current.onRowClick(2, { shiftKey: false, metaKey: false, ctrlKey: false }))
    act(() => result.current.onRowClick(5, { shiftKey: true, metaKey: false, ctrlKey: false }))
    expect(result.current.selectedIndices.size).toBe(4) // 2,3,4,5
    expect(result.current.selectedIndices.has(2)).toBe(true)
    expect(result.current.selectedIndices.has(5)).toBe(true)
  })

  it('clearSelection empties the set', () => {
    const { result } = renderHook(() => useRowSelection(10))
    act(() => result.current.onRowClick(3, { shiftKey: false, metaKey: false, ctrlKey: false }))
    act(() => result.current.clearSelection())
    expect(result.current.selectedIndices.size).toBe(0)
  })

  it('selectedCount matches set size', () => {
    const { result } = renderHook(() => useRowSelection(10))
    act(() => result.current.onRowClick(1, { shiftKey: false, metaKey: false, ctrlKey: false }))
    act(() => result.current.onRowClick(3, { shiftKey: false, metaKey: false, ctrlKey: true }))
    expect(result.current.selectedCount).toBe(2)
  })
})
```

#### 6b. Verify tests fail

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/useRowSelection.test.ts 2>&1 | tail -20
```

#### 6c. Implement `src/components/resultTable/useRowSelection.ts`

```typescript
import { useState, useCallback } from 'react'

export interface ClickModifiers {
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}

export interface UseRowSelectionResult {
  selectedIndices: Set<number>
  selectedCount: number
  onRowClick: (index: number, modifiers: ClickModifiers) => void
  clearSelection: () => void
}

export function useRowSelection(rowCount: number): UseRowSelectionResult {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)

  const onRowClick = useCallback(
    (index: number, { shiftKey, metaKey, ctrlKey }: ClickModifiers) => {
      setSelectedIndices((prev) => {
        if (shiftKey && lastClickedIndex !== null) {
          const lo = Math.min(index, lastClickedIndex)
          const hi = Math.max(index, lastClickedIndex)
          const next = new Set<number>()
          for (let i = lo; i <= hi; i++) next.add(i)
          return next
        }
        if (metaKey || ctrlKey) {
          const next = new Set(prev)
          if (next.has(index)) {
            next.delete(index)
          } else {
            next.add(index)
          }
          return next
        }
        return new Set([index])
      })
      if (!shiftKey) setLastClickedIndex(index)
    },
    [lastClickedIndex, rowCount]
  )

  const clearSelection = useCallback(() => {
    setSelectedIndices(new Set())
    setLastClickedIndex(null)
  }, [])

  return {
    selectedIndices,
    selectedCount: selectedIndices.size,
    onRowClick,
    clearSelection,
  }
}
```

#### 6d. Verify tests pass

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/useRowSelection.test.ts 2>&1 | tail -10
```

#### 6e. Commit

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/components/resultTable/useRowSelection.ts \
  frontend-v2/src/__tests__/resultTable/useRowSelection.test.ts
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "feat(M-C5): useRowSelection with single/range/multi-select and clear"
```

---

### Task 7 — `ResultTableToolbar` component

**Principle:** Build the toolbar as a standalone component before wiring to the full table.

#### 7a. Write failing tests

Add toolbar tests inside `src/__tests__/resultTable/ResultTable.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ResultTableToolbar } from '../../components/resultTable/ResultTableToolbar'

describe('ResultTableToolbar', () => {
  it('renders "Copy all as CSV" button', () => {
    render(
      <ResultTableToolbar
        selectedCount={0}
        onCopyAllCSV={vi.fn()}
        totalRows={100}
        visibleRows={100}
      />
    )
    expect(screen.getByRole('button', { name: /copy all as csv/i })).toBeTruthy()
  })

  it('shows selected count when rows are selected', () => {
    render(
      <ResultTableToolbar
        selectedCount={3}
        onCopyAllCSV={vi.fn()}
        totalRows={100}
        visibleRows={100}
      />
    )
    expect(screen.getByText(/3 rows selected/i)).toBeTruthy()
  })

  it('does not show selected count when nothing is selected', () => {
    render(
      <ResultTableToolbar
        selectedCount={0}
        onCopyAllCSV={vi.fn()}
        totalRows={100}
        visibleRows={100}
      />
    )
    expect(screen.queryByText(/rows selected/i)).toBeNull()
  })

  it('calls onCopyAllCSV when button clicked', () => {
    const onCopyAllCSV = vi.fn()
    render(
      <ResultTableToolbar
        selectedCount={0}
        onCopyAllCSV={onCopyAllCSV}
        totalRows={100}
        visibleRows={100}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /copy all as csv/i }))
    expect(onCopyAllCSV).toHaveBeenCalledOnce()
  })
})
```

#### 7b. Verify tests fail

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/ResultTable.test.tsx 2>&1 | tail -20
```

#### 7c. Implement `src/components/resultTable/ResultTableToolbar.tsx`

```typescript
import type { JSX } from 'react'

interface ResultTableToolbarProps {
  selectedCount: number
  onCopyAllCSV: () => void
  totalRows: number
  visibleRows: number
}

export function ResultTableToolbar({
  selectedCount,
  onCopyAllCSV,
  totalRows,
  visibleRows,
}: ResultTableToolbarProps): JSX.Element {
  return (
    <div
      className="flex items-center gap-3 px-3 py-1.5 border-b"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-bg-overlay)',
      }}
    >
      <button
        type="button"
        onClick={onCopyAllCSV}
        className="text-[11px] px-2 py-1 rounded flex items-center gap-1"
        style={{
          color: 'var(--color-fg-muted)',
          border: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-bg-surface)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--color-fg-base)'
          e.currentTarget.style.borderColor = 'var(--color-border-strong)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--color-fg-muted)'
          e.currentTarget.style.borderColor = 'var(--color-border)'
        }}
      >
        Copy all as CSV
      </button>

      {selectedCount > 0 && (
        <span
          className="text-[11px]"
          style={{ color: 'var(--color-accent)' }}
        >
          {selectedCount} row{selectedCount !== 1 ? 's' : ''} selected
        </span>
      )}

      <span className="ml-auto text-[11px]" style={{ color: 'var(--color-fg-dim)' }}>
        {totalRows !== visibleRows
          ? `${visibleRows.toLocaleString()} of ${totalRows.toLocaleString()} rows`
          : `${totalRows.toLocaleString()} rows`}
      </span>
    </div>
  )
}
```

#### 7d. Verify tests pass

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/ResultTable.test.tsx 2>&1 | tail -10
```

#### 7e. Commit

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/components/resultTable/ResultTableToolbar.tsx \
  frontend-v2/src/__tests__/resultTable/ResultTable.test.tsx
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "feat(M-C5): ResultTableToolbar with copy-all and selection count"
```

---

### Task 8 — `ResultTable` component: core rendering

**Principle:** Build the minimal table structure first — columns, rows, alignment, empty state.

#### 8a. Write failing tests

Append to `src/__tests__/resultTable/ResultTable.test.tsx`:

```typescript
import { ResultTable } from '../../components/resultTable/ResultTable'

describe('ResultTable core rendering', () => {
  const columns = ['name', 'score', 'ts']
  const rows: Record<string, unknown>[] = [
    { name: 'Alice', score: 90, ts: '2024-01-01T00:00:00Z' },
    { name: 'Bob', score: 80, ts: '2024-02-01T00:00:00Z' },
  ]

  it('renders column headers', () => {
    render(<ResultTable rows={rows} columns={columns} />)
    expect(screen.getByText('name')).toBeTruthy()
    expect(screen.getByText('score')).toBeTruthy()
    expect(screen.getByText('ts')).toBeTruthy()
  })

  it('renders row data', () => {
    render(<ResultTable rows={rows} columns={columns} />)
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('90')).toBeTruthy()
  })

  it('renders empty state when no rows', () => {
    render(<ResultTable rows={[]} columns={columns} />)
    expect(screen.getByText(/no results/i)).toBeTruthy()
  })

  it('shows pagination banner when rows > 200', () => {
    const bigRows = Array.from({ length: 201 }, (_, i) => ({ id: i }))
    render(<ResultTable rows={bigRows} columns={['id']} />)
    expect(screen.getByText(/showing 200 of 201/i)).toBeTruthy()
  })

  it('load more button appends rows', async () => {
    const bigRows = Array.from({ length: 400 }, (_, i) => ({ id: i }))
    render(<ResultTable rows={bigRows} columns={['id']} />)
    expect(screen.getByText(/showing 200 of 400/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    expect(screen.getByText(/showing 400 of 400/i)).toBeTruthy()
  })
})
```

#### 8b. Verify tests fail

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/ResultTable.test.tsx 2>&1 | tail -20
```

#### 8c. Implement `src/components/resultTable/ResultTable.tsx`

```typescript
import type { JSX } from 'react'
import { useState, useRef, useCallback, useEffect } from 'react'
import { ResultTableToolbar } from './ResultTableToolbar'
import { useColumnTypes } from './useColumnTypes'
import { useTableSort } from './useTableSort'
import { useColumnResize } from './useColumnResize'
import { useRowSelection } from './useRowSelection'
import { useVirtualList } from './useVirtualList'
import { rowToCSV, rowToJSON, rowsToCSV } from '../../utils/resultTableUtils'

const PAGE_SIZE = 200
const ROW_HEIGHT = 28
const DEFAULT_COL_WIDTH = 120

interface ResultTableProps {
  rows: Record<string, unknown>[]
  columns: string[]
}

interface ContextMenuState {
  x: number
  y: number
  rowIndex: number
} | null

export function ResultTable({ rows, columns }: ResultTableProps): JSX.Element {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(400)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const columnTypes = useColumnTypes(rows, columns)
  const { sortedRows, sortKey, sortDir, onSort } = useTableSort(rows)

  const initialWidths: Record<string, number> = {}
  for (const col of columns) initialWidths[col] = DEFAULT_COL_WIDTH
  const { widths, getResizeHandleProps } = useColumnResize(initialWidths)

  const displayRows = sortedRows.slice(0, visibleCount)
  const { selectedIndices, selectedCount, onRowClick, clearSelection } =
    useRowSelection(displayRows.length)

  const { visibleItems, totalHeight } = useVirtualList({
    itemCount: displayRows.length,
    itemHeight: ROW_HEIGHT,
    containerHeight,
    scrollTop,
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      setContainerHeight(entries[0]?.contentRect.height ?? 400)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function handleScroll(): void {
    if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop)
  }

  async function handleCopyAllCSV(): Promise<void> {
    const csv = rowsToCSV(sortedRows, columns)
    await navigator.clipboard.writeText(csv)
  }

  function handleContextMenu(e: React.MouseEvent, rowIndex: number): void {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, rowIndex })
  }

  async function handleCopyRowJSON(rowIndex: number): Promise<void> {
    await navigator.clipboard.writeText(rowToJSON(displayRows[rowIndex]))
    setContextMenu(null)
  }

  async function handleCopyRowCSV(rowIndex: number): Promise<void> {
    await navigator.clipboard.writeText(rowToCSV(displayRows[rowIndex], columns))
    setContextMenu(null)
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedIndices.size > 0) {
      const selectedRows = [...selectedIndices].sort((a, b) => a - b).map((i) => displayRows[i])
      const tsv = selectedRows.map((r) => columns.map((c) => String(r[c] ?? '')).join('\t')).join('\n')
      void navigator.clipboard.writeText(tsv)
    }
  }

  if (rows.length === 0) {
    return (
      <div
        className="flex items-center justify-center h-20 text-[12px]"
        style={{ color: 'var(--color-fg-dim)' }}
      >
        No results
      </div>
    )
  }

  const totalRows = rows.length
  const showBanner = totalRows > visibleCount

  return (
    <div
      className="flex flex-col h-full outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={() => contextMenu && setContextMenu(null)}
      style={{ color: 'var(--color-fg-base)' }}
    >
      <ResultTableToolbar
        selectedCount={selectedCount}
        onCopyAllCSV={() => void handleCopyAllCSV()}
        totalRows={totalRows}
        visibleRows={visibleCount}
      />

      {/* Scrollable table body */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto relative"
        style={{ minHeight: 0 }}
      >
        <div
          ref={scrollRef}
          className="overflow-auto h-full"
          onScroll={handleScroll}
        >
          {/* Table with sticky header */}
          <table className="w-full border-collapse table-fixed">
            <thead
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 10,
                backgroundColor: 'var(--color-bg-overlay)',
              }}
            >
              <tr>
                {columns.map((col) => (
                  <th
                    key={col}
                    style={{
                      width: widths[col] ?? DEFAULT_COL_WIDTH,
                      minWidth: widths[col] ?? DEFAULT_COL_WIDTH,
                      position: 'relative',
                      userSelect: 'none',
                      borderBottom: '1px solid var(--color-border)',
                      borderRight: '1px solid var(--color-border)',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      textAlign: columnTypes[col] === 'number' ? 'right' : columnTypes[col] === 'date' ? 'center' : 'left',
                    }}
                    className="text-[11px]"
                    onClick={() => onSort(col)}
                  >
                    {col}
                    {sortKey === col && sortDir !== 'none' && (
                      <span style={{ marginLeft: 4, color: 'var(--color-accent)' }}>
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                    {/* Resize handle */}
                    <span
                      {...getResizeHandleProps(col)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody style={{ position: 'relative', height: totalHeight }}>
              {visibleItems.map(({ index, offsetTop }) => {
                const row = displayRows[index]
                const isSelected = selectedIndices.has(index)
                return (
                  <tr
                    key={index}
                    style={{
                      position: 'absolute',
                      top: offsetTop,
                      width: '100%',
                      height: ROW_HEIGHT,
                      backgroundColor: isSelected
                        ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)'
                        : index % 2 === 0
                        ? 'var(--color-bg-surface)'
                        : 'var(--color-bg-base)',
                    }}
                    onClick={(e) =>
                      onRowClick(index, {
                        shiftKey: e.shiftKey,
                        metaKey: e.metaKey,
                        ctrlKey: e.ctrlKey,
                      })
                    }
                    onContextMenu={(e) => handleContextMenu(e, index)}
                  >
                    {columns.map((col) => (
                      <td
                        key={col}
                        style={{
                          width: widths[col] ?? DEFAULT_COL_WIDTH,
                          minWidth: widths[col] ?? DEFAULT_COL_WIDTH,
                          padding: '4px 8px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          textAlign:
                            columnTypes[col] === 'number'
                              ? 'right'
                              : columnTypes[col] === 'date'
                              ? 'center'
                              : 'left',
                          borderRight: '1px solid var(--color-border)',
                        }}
                        className="text-[12px]"
                      >
                        {row[col] === null || row[col] === undefined
                          ? <span style={{ color: 'var(--color-fg-dim)' }}>null</span>
                          : String(row[col])}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination banner */}
      {showBanner && (
        <div
          className="flex items-center justify-between px-4 py-2 text-[11px] border-t"
          style={{
            backgroundColor: 'var(--color-bg-overlay)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-fg-muted)',
          }}
        >
          <span>
            Showing {visibleCount.toLocaleString()} of {totalRows.toLocaleString()} rows
          </span>
          <button
            type="button"
            onClick={() => setVisibleCount((n) => Math.min(n + PAGE_SIZE, totalRows))}
            style={{
              color: 'var(--color-accent)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Load more (+{Math.min(PAGE_SIZE, totalRows - visibleCount)})
          </button>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 1000,
            backgroundColor: 'var(--color-bg-overlay)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 4,
            minWidth: 160,
          }}
        >
          <button
            type="button"
            className="block w-full text-left px-3 py-2 text-[12px]"
            style={{ color: 'var(--color-fg-base)' }}
            onClick={() => void handleCopyRowJSON(contextMenu.rowIndex)}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}
          >
            Copy row as JSON
          </button>
          <button
            type="button"
            className="block w-full text-left px-3 py-2 text-[12px]"
            style={{ color: 'var(--color-fg-base)' }}
            onClick={() => void handleCopyRowCSV(contextMenu.rowIndex)}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}
          >
            Copy row as CSV
          </button>
        </div>
      )}
    </div>
  )
}
```

#### 8d. Verify tests pass

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/ResultTable.test.tsx 2>&1 | tail -15
```

#### 8e. Commit

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/components/resultTable/ResultTable.tsx
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "feat(M-C5): ResultTable core with virtual scroll, sort, resize, context menu"
```

---

### Task 9 — Integration tests: sort UX

**Principle:** Verify sort cycle (asc → desc → none) works through the full component.

#### 9a. Write failing tests

Append to `src/__tests__/resultTable/ResultTable.test.tsx`:

```typescript
describe('ResultTable sort interactions', () => {
  const columns = ['name', 'score']
  const rows: Record<string, unknown>[] = [
    { name: 'Charlie', score: 70 },
    { name: 'Alice', score: 90 },
    { name: 'Bob', score: 80 },
  ]

  it('clicking a header shows sort indicator ↑', () => {
    render(<ResultTable rows={rows} columns={columns} />)
    fireEvent.click(screen.getByText('name'))
    expect(screen.getByText('↑')).toBeTruthy()
  })

  it('clicking a header twice shows ↓', () => {
    render(<ResultTable rows={rows} columns={columns} />)
    fireEvent.click(screen.getByText('name'))
    fireEvent.click(screen.getByText('name'))
    expect(screen.queryByText('↑')).toBeNull()
    expect(screen.getByText('↓')).toBeTruthy()
  })

  it('clicking a header three times removes sort indicator', () => {
    render(<ResultTable rows={rows} columns={columns} />)
    fireEvent.click(screen.getByText('name'))
    fireEvent.click(screen.getByText('name'))
    fireEvent.click(screen.getByText('name'))
    expect(screen.queryByText('↑')).toBeNull()
    expect(screen.queryByText('↓')).toBeNull()
  })
})
```

#### 9b. Verify tests fail, then pass after implementation from Task 8

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/ResultTable.test.tsx --reporter=verbose 2>&1 | tail -30
```

All sort tests should pass since `ResultTable` from Task 8 already integrates `useTableSort`.

#### 9c. Commit

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/__tests__/resultTable/ResultTable.test.tsx
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "test(M-C5): sort indicator integration tests"
```

---

### Task 10 — Integration tests: row selection & keyboard copy

**Principle:** Verify selection state and keyboard shortcut through the component layer.

#### 10a. Write failing tests

Append to `src/__tests__/resultTable/ResultTable.test.tsx`:

```typescript
describe('ResultTable row selection', () => {
  const columns = ['name']
  const rows: Record<string, unknown>[] = [
    { name: 'Alice' },
    { name: 'Bob' },
    { name: 'Carol' },
  ]

  it('toolbar shows selection count after row click', () => {
    render(<ResultTable rows={rows} columns={columns} />)
    // Click on a data row (find it by text content of td)
    fireEvent.click(screen.getByText('Alice').closest('tr')!)
    expect(screen.getByText(/1 row selected/i)).toBeTruthy()
  })

  it('toolbar updates count on Ctrl+click multi-select', () => {
    render(<ResultTable rows={rows} columns={columns} />)
    fireEvent.click(screen.getByText('Alice').closest('tr')!)
    fireEvent.click(screen.getByText('Bob').closest('tr')!, { ctrlKey: true })
    expect(screen.getByText(/2 rows selected/i)).toBeTruthy()
  })
})
```

#### 10b. Verify tests pass

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/ResultTable.test.tsx 2>&1 | tail -15
```

#### 10c. Commit

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/__tests__/resultTable/ResultTable.test.tsx
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "test(M-C5): row selection integration tests"
```

---

### Task 11 — Integration tests: context menu

**Principle:** Verify right-click context menu appearance and copy actions.

#### 11a. Write failing tests

Append to `src/__tests__/resultTable/ResultTable.test.tsx`:

```typescript
describe('ResultTable context menu', () => {
  const columns = ['name', 'score']
  const rows: Record<string, unknown>[] = [{ name: 'Alice', score: 99 }]

  it('right-click shows context menu', () => {
    render(<ResultTable rows={rows} columns={columns} />)
    const row = screen.getByText('Alice').closest('tr')!
    fireEvent.contextMenu(row)
    expect(screen.getByText('Copy row as JSON')).toBeTruthy()
    expect(screen.getByText('Copy row as CSV')).toBeTruthy()
  })

  it('left-click anywhere closes context menu', () => {
    render(<ResultTable rows={rows} columns={columns} />)
    const row = screen.getByText('Alice').closest('tr')!
    fireEvent.contextMenu(row)
    expect(screen.getByText('Copy row as JSON')).toBeTruthy()
    // Click the container to dismiss
    fireEvent.click(document.body)
    // menu should be gone
    expect(screen.queryByText('Copy row as JSON')).toBeNull()
  })
})
```

#### 11b. Verify tests pass

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/ResultTable.test.tsx --reporter=verbose 2>&1 | tail -20
```

#### 11c. Commit

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/__tests__/resultTable/ResultTable.test.tsx
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "test(M-C5): context menu right-click and dismiss tests"
```

---

### Task 12 — A11y audit

**Principle:** Tables must be accessible — audit column headers and keyboard focus.

#### 12a. Write a11y tests

Append to `src/__tests__/resultTable/ResultTable.test.tsx`:

```typescript
import { axe } from 'jest-axe'

describe('ResultTable a11y', () => {
  const columns = ['name', 'score']
  const rows: Record<string, unknown>[] = [
    { name: 'Alice', score: 90 },
    { name: 'Bob', score: 80 },
  ]

  it('passes axe accessibility audit', async () => {
    const { container } = render(<ResultTable rows={rows} columns={columns} />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
```

> **Note:** If `jest-axe` is not yet installed, add it:
> ```bash
> cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
> npm install --save-dev jest-axe @types/jest-axe
> ```
> Then import in the test file: `import { axe, toHaveNoViolations } from 'jest-axe'`
> and add `expect.extend(toHaveNoViolations)` at the top of the describe block.

#### 12b. Address any a11y failures

Common fixes:
- `<th scope="col">` for column headers — add `scope="col"` to each `<th>` in the header
- `aria-sort="ascending"` / `"descending"` / `"none"` on sorted `<th>`
- `role="row"` on `<tr>` elements within virtualised absolute-positioned `<tbody>`
- `tabIndex={0}` on container (already present) and ensure focus ring is visible

Edit `ResultTable.tsx` to add proper ARIA attributes:

```typescript
// In the <th> element, add:
scope="col"
aria-sort={
  sortKey === col
    ? sortDir === 'asc'
      ? 'ascending'
      : sortDir === 'desc'
      ? 'descending'
      : 'none'
    : 'none'
}
```

#### 12c. Verify a11y tests pass

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/ResultTable.test.tsx 2>&1 | tail -10
```

#### 12d. Commit

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/components/resultTable/ResultTable.tsx \
  frontend-v2/src/__tests__/resultTable/ResultTable.test.tsx
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "fix(M-C5): add aria-sort and scope=col for a11y compliance"
```

---

### Task 13 — Wire ResultTable into CellView

**Principle:** Integrate the new component at the exact render point — leave everything else untouched.

#### 13a. Inspect current CellView

Read `src/components/cell/CellView.tsx` to find where result blocks are rendered. Look for `Block` type handling — specifically the result/table block type.

```bash
grep -n 'result\|table\|rows\|Record<' /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/components/cell/CellView.tsx | head -30
```

#### 13b. Add ResultTable import and render

In `CellView.tsx`, locate the block rendering section and add:

```typescript
import { ResultTable } from '../resultTable/ResultTable'

// Inside the block renderer, for result blocks:
case 'table':
case 'result': {
  const tableRows = block.rows as Record<string, unknown>[]
  const tableCols = block.columns as string[]
  return (
    <div key={blockIndex} className="mt-2" style={{ height: 320 }}>
      <ResultTable rows={tableRows} columns={tableCols} />
    </div>
  )
}
```

> **Constraint:** NEVER change `useState(!hasNotebook)` in `AppShell.tsx`. Do NOT touch AppShell at all.

#### 13c. Verify the app compiles

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx tsc --noEmit 2>&1 | tail -20
```

Fix any TypeScript errors before proceeding. Common issue: `block.rows` may need type narrowing:

```typescript
if (block.type === 'result' && Array.isArray(block.rows) && Array.isArray(block.columns)) {
  return (
    <div key={blockIndex} style={{ height: 320 }}>
      <ResultTable
        rows={block.rows as Record<string, unknown>[]}
        columns={block.columns as string[]}
      />
    </div>
  )
}
```

#### 13d. Commit

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/components/cell/CellView.tsx
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "feat(M-C5): wire ResultTable into CellView result block rendering"
```

---

### Task 14 — Visual regression checkpoint via Playwright MCP

**Principle:** Verify the component looks correct in a real browser before calling the milestone done.

#### 14a. Start the dev server

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npm run dev -- --port 5173
```

#### 14b. Create a Playwright visual test script

Create `src/__tests__/e2e/resultTable.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'

test.describe('ResultTable visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
  })

  test('table renders with mock data', async ({ page }) => {
    // Navigate to a cell that produces a result table
    // This assumes the dev fixture or storybook-style route exposes the table
    await page.waitForSelector('[data-testid="result-table"]', { timeout: 5000 })
    await expect(page.locator('[data-testid="result-table"]')).toBeVisible()
    await expect(page).toHaveScreenshot('result-table-base.png')
  })

  test('sort ascending on header click', async ({ page }) => {
    await page.waitForSelector('[data-testid="result-table"]')
    await page.locator('th').first().click()
    await expect(page.locator('th').first()).toContainText('↑')
    await expect(page).toHaveScreenshot('result-table-sort-asc.png')
  })

  test('context menu on right-click', async ({ page }) => {
    await page.waitForSelector('[data-testid="result-table"]')
    await page.locator('tbody tr').first().click({ button: 'right' })
    await expect(page.locator('text=Copy row as JSON')).toBeVisible()
    await expect(page).toHaveScreenshot('result-table-context-menu.png')
  })
})
```

> **Note:** Add `data-testid="result-table"` to the outer `<div>` in `ResultTable.tsx` to make targeting reliable.

#### 14c. Run Playwright via MCP

Using the Playwright MCP tool:

1. Navigate to `http://localhost:5173`
2. Verify the notebook loads and a result table is visible after running a query cell
3. Screenshot the table in default state
4. Click a column header — verify `↑` appears
5. Right-click a row — verify context menu appears with "Copy row as JSON"
6. Scroll within the table (if >200 rows fixture exists) — verify pagination banner
7. Click "Load more" — verify row count updates

#### 14d. Commit screenshots as baseline

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/__tests__/e2e/resultTable.spec.ts
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "test(M-C5): Playwright e2e visual regression spec for ResultTable"
```

---

### Task 15 — Performance benchmark

**Principle:** Verify virtual scroll keeps large tables fast — measure render time.

#### 15a. Write a performance test

Create `src/__tests__/resultTable/resultTablePerf.bench.ts`:

```typescript
import { bench, describe } from 'vitest'
import { rowsToCSV } from '../../utils/resultTableUtils'
import { inferColumnTypes } from '../../components/resultTable/useColumnTypes'

const bigRows: Record<string, unknown>[] = Array.from({ length: 10_000 }, (_, i) => ({
  id: i,
  name: `user_${i}`,
  score: Math.random() * 100,
  ts: new Date(Date.now() - i * 1000).toISOString(),
}))
const columns = ['id', 'name', 'score', 'ts']

describe('ResultTable perf', () => {
  bench('rowsToCSV 10k rows', () => {
    rowsToCSV(bigRows, columns)
  })
})
```

> **Note:** Export a standalone `inferColumnTypes(rows, columns)` from `useColumnTypes.ts` (non-hook version) to allow benchmarking without React.

#### 15b. Run benchmarks

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest bench src/__tests__/resultTable/resultTablePerf.bench.ts 2>&1 | tail -20
```

Acceptable thresholds:
- `rowsToCSV` for 10k rows: < 50ms
- Type inference for 50 rows: < 1ms

#### 15c. Commit

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/__tests__/resultTable/resultTablePerf.bench.ts
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "perf(M-C5): benchmark rowsToCSV and type inference at 10k rows"
```

---

### Task 16 — Final full test run + index export

**Principle:** Confirm all 5 test layers pass before declaring M-C5 done.

#### 16a. Run all ResultTable tests

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/resultTable/ --reporter=verbose 2>&1
```

All tests across these files must pass:
- `resultTableUtils.test.ts`
- `useColumnTypes.test.ts`
- `useTableSort.test.ts`
- `useVirtualList.test.ts`
- `useColumnResize.test.ts`
- `useRowSelection.test.ts`
- `ResultTable.test.tsx`

#### 16b. TypeScript compile check

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx tsc --noEmit 2>&1
```

Must produce zero errors.

#### 16c. Create barrel export

Create `src/components/resultTable/index.ts`:

```typescript
export { ResultTable } from './ResultTable'
export { ResultTableToolbar } from './ResultTableToolbar'
export { useColumnTypes } from './useColumnTypes'
export { useTableSort } from './useTableSort'
export { useVirtualList } from './useVirtualList'
export { useColumnResize } from './useColumnResize'
export { useRowSelection } from './useRowSelection'
export type { ColumnType } from './useColumnTypes'
export type { SortDir } from './useTableSort'
export type { VirtualItem } from './useVirtualList'
```

#### 16d. Final commit

```bash
git -C /Users/i560383_1/code/experiments/jfr-query add \
  frontend-v2/src/components/resultTable/index.ts
git -C /Users/i560383_1/code/experiments/jfr-query commit -m "feat(M-C5): barrel export for resultTable module — milestone complete"
```

---

## Acceptance Criteria Checklist

- [ ] `resultTableUtils.test.ts` — all pure function tests pass
- [ ] `useColumnTypes.test.ts` — number/date/string inference passes for all cases
- [ ] `useTableSort.test.ts` — asc/desc/none cycling, null-last, numeric comparison pass
- [ ] `useVirtualList.test.ts` — windowing math, overscan, endIndex clamp pass
- [ ] `useColumnResize.test.ts` — min/max clamp, setWidth, resetWidths pass
- [ ] `useRowSelection.test.ts` — single/range/multi-select, clearSelection pass
- [ ] `ResultTable.test.tsx` — toolbar, empty state, pagination, sort indicator, context menu pass
- [ ] a11y tests pass with no axe violations
- [ ] TypeScript `--noEmit` produces zero errors
- [ ] Playwright: table renders, sort works, context menu visible, pagination loads more
- [ ] Performance: `rowsToCSV` 10k rows < 50ms
- [ ] `AppShell.tsx` `useState(!hasNotebook)` — UNCHANGED

---

## Token Budget

| Task | Hooks/Files | Est. lines |
|------|-------------|------------|
| 1 | `resultTableUtils.ts` | 40 + 60 tests |
| 2 | `useColumnTypes.ts` | 40 + 50 tests |
| 3 | `useTableSort.ts` | 45 + 60 tests |
| 4 | `useVirtualList.ts` | 35 + 50 tests |
| 5 | `useColumnResize.ts` | 55 + 45 tests |
| 6 | `useRowSelection.ts` | 50 + 60 tests |
| 7 | `ResultTableToolbar.tsx` | 50 + 40 tests |
| 8 | `ResultTable.tsx` | 160 + 40 tests |
| 9–11 | Integration tests | 60 tests |
| 12 | A11y + ARIA | 20 + 10 tests |
| 13 | CellView wiring | 15 |
| 14 | Playwright e2e | 35 |
| 15 | Bench | 20 |
| 16 | Barrel + final run | 15 |
| **Total** | | **~905 code + 465 tests ≈ 1370 lines** |
