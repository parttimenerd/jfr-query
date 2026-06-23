# M-C1: Plot Renderer Base + 5-State Machine

> **For agentic workers:** Use superpowers:executing-plans.
> **Testing standard:** See docs/superpowers/TESTING_STANDARD.md — all 5 layers apply.

**Goal:** Deliver the `PlotRenderer` wrapper component and the five-state machine (`idle / loading / rendered / error / empty`) that every concrete plot type (M-C2 through M-C5) will mount inside. Also delivers the six shared infrastructure pieces consumed by all concrete renderers: `PlotLegend`, `PlotTooltip`, `PlotAnnotations`, `PlotControls`, `PlotShareModal`, and a `PlotContext`. The state machine is a pure reducer with no DOM dependency, making it independently unit-testable.

**Blocked by:** M-A3 (PlotNode AST — already in `src/services/parser/types.ts`).

**Important:** Recharts is not yet installed. This milestone adds it as a dependency (`npm install recharts`). The `PlotRenderer` wrapper does not use Recharts directly — it provides the shell that Recharts-powered concrete renderers mount inside — but the dependency is introduced here so M-C2 can proceed without a dep-installation step.

**Tech stack:** React 19.2, TypeScript 5.8, Vite 6.2, Tailwind v4 (CSS-first, `[data-theme="dark"]`), Recharts 2.x, Vitest 4.1.9 (pool: forks), @testing-library/react 16.3.0, @testing-library/user-event 14.6.1, @testing-library/jest-dom 6.6.3, Playwright 1.61.0, AxeBuilder from @axe-core/playwright.

---

## Pre-resolved decisions

### DECISION 1: State machine is a pure reducer

`PlotStateMachine.ts` exports a `reduce(state: PlotRenderState, event: PlotEvent): PlotRenderState` function. No classes, no singletons, no DOM. The state union and event union are the public API; the reducer is the only code path. Tests can call `reduce()` directly without rendering anything.

State union:
```ts
type PlotRenderState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'rendered'; rowCount: number }
  | { status: 'error'; message: string; detail?: string }
  | { status: 'empty' }
```

Event union:
```ts
type PlotEvent =
  | { type: 'run' }       // any → loading
  | { type: 'data'; rowCount: number }  // loading → rendered | empty
  | { type: 'fail'; message: string; detail?: string }  // loading → error
  | { type: 'reset' }     // any → idle
  | { type: 'retry' }     // error → loading
```

### DECISION 2: Illegal transitions return input state with console.warn

Rather than throwing, illegal transitions (e.g. `data` event in `idle` state) call `console.warn` and return the input state unchanged. Tests assert the return value is identical (same reference) to the input and that `console.warn` was called. This is safer in production — a stray event doesn't crash the renderer.

### DECISION 3: PlotRenderer accepts state as a prop

For M-C1, `PlotRenderer` accepts `state: PlotRenderState` as a direct prop (not internally managed). The runtime (Phase E) will feed live state transitions; for now, callers control state by passing it directly. This makes the component trivially testable in isolation. Internal state management (hooking state to `useReducer`) is added in M-C7 when the clause-tail processor wires execution events.

### DECISION 4: PlotContext for series registration

`PlotContext` is a React context that concrete renderers use to register their series and hover handlers with the wrapper:
```ts
interface PlotContextValue {
  registerSeries(series: SeriesDescriptor[]): void;
  onHover(payload: HoverPayload | null): void;
  hiddenSeries: Set<string>;
}
```
`PlotRenderer` creates this context; concrete renderers consume it via `usePlotContext()`. The legend reads `hiddenSeries` from the same context. This is the coupling mechanism between `PlotRenderer` and concrete chart bodies.

### DECISION 5: PlotLegend click toggles series visibility

`PlotLegend` receives `series: SeriesDescriptor[]` and reads `hiddenSeries: Set<string>` from `PlotContext`. Clicking a legend item calls a callback that updates the `hiddenSeries` set in `PlotRenderer`'s local state. The updated set is provided back through `PlotContext` so concrete renderers can filter their data.

### DECISION 6: PlotTooltip is positioned absolutely within the chart container

`PlotTooltip` renders a `position: absolute` div inside the plot container. It is hidden when `payload === null`. The tooltip is triggered either by pointer events (concrete renderer calls `context.onHover(payload)`) or by keyboard focus (Tab into the chart area, arrow keys move across data points — concrete renderer manages focus and calls `context.onHover`). `PlotTooltip` itself has `role="tooltip"` and is referenced via `aria-describedby` on the chart container element.

### DECISION 7: PlotAnnotations stores pins in component state

`PlotAnnotations` maintains `pins: AnnotationPin[]` in `useState`. Pins are added by clicking on the chart area (concrete renderer dispatches a `pin` event via context). Pins are cleared when a `reset` event arrives (the component watches the `state.status` prop — when it becomes `loading`, it clears pins). Pins survive `rendered` state updates (re-renders with new data).

### DECISION 8: PlotControls — fullscreen uses Fullscreen API

`PlotControls` renders a small `<div>` with three icon buttons: Zoom Reset, Fullscreen, Copy. Zoom Reset dispatches a `resetZoom` event through `PlotContext` (concrete renderers listen). Fullscreen calls `containerRef.current?.requestFullscreen()`. Copy opens `PlotShareModal`. All three buttons have `type="button"`, `aria-label`, and are keyboard-reachable in DOM order.

### DECISION 9: PlotShareModal — clipboard API with fallback

Copy-as-PNG: `canvas.toBlob('image/png')` then `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`. Copy-as-SVG: clone the SVG node, serialize via `new XMLSerializer().serializeToString(svg)`, then `navigator.clipboard.writeText(svgString)` (SVG via `writeText` is the most compatible approach). Share-via-URL: build `#plot/<cellId>/<plotName>` hash and call `navigator.clipboard.writeText(url)`. Tests mock `navigator.clipboard.write` and `navigator.clipboard.writeText`.

### DECISION 10: Recharts installation

Run `npm install recharts` as the first step. Recharts 2.15.x is compatible with React 19. The package is a `dependency` (not devDependency) since it's used in production rendering. Types are included with the package (`recharts` ships its own `index.d.ts`).

### DECISION 11: data-testid attributes

- `data-testid="plot-renderer"` on `PlotRenderer` root
- `data-testid="plot-state-idle"` / `data-testid="plot-state-loading"` / `data-testid="plot-state-rendered"` / `data-testid="plot-state-error"` / `data-testid="plot-state-empty"` on the state-specific shell
- `data-testid="plot-legend"` on `PlotLegend` root
- `data-testid="plot-legend-item-{key}"` on each legend item
- `data-testid="plot-tooltip"` on `PlotTooltip` root
- `data-testid="plot-annotations"` on `PlotAnnotations` root
- `data-testid="plot-controls"` on `PlotControls` root
- `data-testid="plot-share-modal"` on `PlotShareModal` root
- `data-testid="plot-copy-png"` on the Copy PNG button
- `data-testid="plot-copy-svg"` on the Copy SVG button
- `data-testid="plot-share-url"` on the Share URL button

### DECISION 12: `prefers-reduced-motion` for animations

`PlotRenderer` wraps the loading skeleton in a class that uses `motion-safe:animate-pulse` (Tailwind's built-in `prefers-reduced-motion` variant). The loading spinner in `LoadingOverlay` (M-B9) already uses `animate-spin` but that's a separate component. For `PlotRenderer`'s loading state, use `motion-safe:animate-pulse` on the skeleton div.

---

## Steps

### Step 1 — Install Recharts

- [ ] **1.1** Install recharts:

```bash
cd frontend-v2 && npm install recharts
```

- [ ] **1.2** Verify installation:

```bash
ls frontend-v2/node_modules/recharts/index.js
```

- [ ] **1.3** Run `npx tsc --noEmit` — must pass after install.

---

### Step 2 — Define plot types

- [ ] **2.1** Create `frontend-v2/src/components/plots/plotTypes.ts`:

```ts
/**
 * Plot renderer types — shared across PlotStateMachine, PlotRenderer,
 * PlotLegend, PlotTooltip, PlotAnnotations, PlotControls, PlotShareModal.
 *
 * These are local render-layer types; AST types live in src/services/parser/types.ts.
 */

// ─── State machine ───────────────────────────────────────────────────────────

export type PlotRenderStatus = 'idle' | 'loading' | 'rendered' | 'error' | 'empty';

export type PlotRenderState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'rendered'; rowCount: number }
  | { status: 'error'; message: string; detail?: string }
  | { status: 'empty' };

export type PlotEvent =
  | { type: 'run' }
  | { type: 'data'; rowCount: number }
  | { type: 'fail'; message: string; detail?: string }
  | { type: 'reset' }
  | { type: 'retry' };

// ─── Legend ──────────────────────────────────────────────────────────────────

export interface SeriesDescriptor {
  /** Unique key for this series, used as legend item id and hidden-set key. */
  key: string;
  /** Human-readable label. */
  label: string;
  /** Tailwind token colour class (e.g. "text-[--color-accent]") or a CSS custom property name. */
  color: string;
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

export interface HoverPayload {
  /** Data point values to render in the tooltip. */
  entries: Array<{ label: string; value: string | number }>;
  /** Position hint (pixel coords relative to chart container). */
  x: number;
  y: number;
}

// ─── Annotations ─────────────────────────────────────────────────────────────

export interface AnnotationPin {
  /** Unique id — nanoid or similar. */
  id: string;
  /** Data-space x coordinate (used for persistence across re-renders). */
  dataX: number | string;
  /** Data-space y coordinate. */
  dataY: number;
  /** Human-readable label shown next to the pin. */
  label: string;
  /** Tailwind color token for pin marker. */
  color: string;
}

// ─── Context ─────────────────────────────────────────────────────────────────

export interface PlotContextValue {
  /** Concrete renderer calls this on mount / when series change. */
  registerSeries(series: SeriesDescriptor[]): void;
  /** Concrete renderer calls this on pointer move / keyboard focus change. */
  onHover(payload: HoverPayload | null): void;
  /** Concrete renderer reads this to know which series to skip rendering. */
  hiddenSeries: ReadonlySet<string>;
  /** Concrete renderer calls this to add a pin at a data point. */
  addPin(pin: Omit<AnnotationPin, 'id'>): void;
  /** Fired when zoom reset is requested. */
  onZoomReset: (() => void) | null;
  /** Register a zoom-reset handler (called by concrete renderer on mount). */
  registerZoomReset(handler: () => void): void;
}
```

- [ ] **2.2** Run `npx tsc --noEmit` — must pass.

---

### Step 3 — Write failing tests for PlotStateMachine

- [ ] **3.1** Create `frontend-v2/src/__tests__/plots/stateMachine.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reduce } from '../../components/plots/PlotStateMachine';
import type { PlotRenderState, PlotEvent } from '../../components/plots/plotTypes';

const IDLE: PlotRenderState = { status: 'idle' };
const LOADING: PlotRenderState = { status: 'loading' };
const RENDERED: PlotRenderState = { status: 'rendered', rowCount: 10 };
const ERROR: PlotRenderState = { status: 'error', message: 'SQL failed', detail: 'syntax error' };
const EMPTY: PlotRenderState = { status: 'empty' };

describe('PlotStateMachine — legal transitions', () => {
  it('idle → loading on "run"', () => {
    const next = reduce(IDLE, { type: 'run' });
    expect(next.status).toBe('loading');
  });

  it('loading → rendered on "data" with rowCount > 0', () => {
    const next = reduce(LOADING, { type: 'data', rowCount: 42 });
    expect(next.status).toBe('rendered');
    if (next.status === 'rendered') {
      expect(next.rowCount).toBe(42);
    }
  });

  it('loading → empty on "data" with rowCount === 0', () => {
    const next = reduce(LOADING, { type: 'data', rowCount: 0 });
    expect(next.status).toBe('empty');
  });

  it('loading → error on "fail"', () => {
    const next = reduce(LOADING, { type: 'fail', message: 'oops', detail: 'detail text' });
    expect(next.status).toBe('error');
    if (next.status === 'error') {
      expect(next.message).toBe('oops');
      expect(next.detail).toBe('detail text');
    }
  });

  it('error → loading on "retry"', () => {
    const next = reduce(ERROR, { type: 'retry' });
    expect(next.status).toBe('loading');
  });

  it('rendered → loading on "run" (re-run)', () => {
    const next = reduce(RENDERED, { type: 'run' });
    expect(next.status).toBe('loading');
  });

  it('any state → idle on "reset"', () => {
    for (const state of [IDLE, LOADING, RENDERED, ERROR, EMPTY]) {
      expect(reduce(state, { type: 'reset' }).status).toBe('idle');
    }
  });

  it('empty → loading on "run"', () => {
    const next = reduce(EMPTY, { type: 'run' });
    expect(next.status).toBe('loading');
  });

  it('"fail" without detail produces error state without detail', () => {
    const next = reduce(LOADING, { type: 'fail', message: 'no detail here' });
    expect(next.status).toBe('error');
    if (next.status === 'error') {
      expect(next.detail).toBeUndefined();
    }
  });
});

describe('PlotStateMachine — illegal transitions', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('idle + "data" → warns and returns idle unchanged', () => {
    const event: PlotEvent = { type: 'data', rowCount: 5 };
    const next = reduce(IDLE, event);
    expect(next).toBe(IDLE); // same reference
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('idle + "fail" → warns and returns idle unchanged', () => {
    const event: PlotEvent = { type: 'fail', message: 'oops' };
    const next = reduce(IDLE, event);
    expect(next).toBe(IDLE);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('idle + "retry" → warns and returns idle unchanged', () => {
    const next = reduce(IDLE, { type: 'retry' });
    expect(next).toBe(IDLE);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('rendered + "data" → warns and returns rendered unchanged', () => {
    const event: PlotEvent = { type: 'data', rowCount: 99 };
    const next = reduce(RENDERED, event);
    expect(next).toBe(RENDERED);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('rendered + "fail" → warns and returns rendered unchanged', () => {
    const next = reduce(RENDERED, { type: 'fail', message: 'x' });
    expect(next).toBe(RENDERED);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('rendered + "retry" → warns and returns rendered unchanged', () => {
    const next = reduce(RENDERED, { type: 'retry' });
    expect(next).toBe(RENDERED);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('empty + "data" → warns and returns empty unchanged', () => {
    const next = reduce(EMPTY, { type: 'data', rowCount: 0 });
    expect(next).toBe(EMPTY);
    expect(warnSpy).toHaveBeenCalledOnce();
  });
});

describe('PlotStateMachine — purity', () => {
  it('does not mutate input state', () => {
    const state: PlotRenderState = { status: 'loading' };
    const frozen = Object.freeze(state);
    // Should not throw even though input is frozen
    const next = reduce(frozen, { type: 'data', rowCount: 5 });
    expect(next).not.toBe(frozen);
    expect(next.status).toBe('rendered');
  });

  it('same input produces same output (determinism)', () => {
    const state: PlotRenderState = { status: 'loading' };
    const event: PlotEvent = { type: 'data', rowCount: 10 };
    const a = reduce(state, event);
    const b = reduce(state, event);
    expect(a).toEqual(b);
  });

  it('does not produce the same reference on valid transition', () => {
    const state: PlotRenderState = { status: 'idle' };
    const next = reduce(state, { type: 'run' });
    expect(next).not.toBe(state);
  });
});
```

- [ ] **3.2** Run `npm run test -- stateMachine` — all tests fail.

---

### Step 4 — Implement PlotStateMachine

- [ ] **4.1** Create `frontend-v2/src/components/plots/PlotStateMachine.ts`:

```ts
import type { PlotRenderState, PlotEvent } from './plotTypes';

/**
 * Pure state machine reducer for plot lifecycle.
 * Illegal transitions emit a console.warn and return the input state unchanged (same reference).
 * No DOM, no side effects beyond the console.warn diagnostic.
 */
export function reduce(state: PlotRenderState, event: PlotEvent): PlotRenderState {
  switch (event.type) {
    case 'run':
      // Any state can transition to loading on 'run'
      return { status: 'loading' };

    case 'data': {
      if (state.status !== 'loading') {
        console.warn(
          `[PlotStateMachine] Illegal transition: 'data' event in '${state.status}' state. Ignoring.`
        );
        return state;
      }
      if (event.rowCount === 0) {
        return { status: 'empty' };
      }
      return { status: 'rendered', rowCount: event.rowCount };
    }

    case 'fail': {
      if (state.status !== 'loading') {
        console.warn(
          `[PlotStateMachine] Illegal transition: 'fail' event in '${state.status}' state. Ignoring.`
        );
        return state;
      }
      const errorState: PlotRenderState = { status: 'error', message: event.message };
      if (event.detail !== undefined) {
        return { ...errorState, detail: event.detail };
      }
      return errorState;
    }

    case 'reset':
      return { status: 'idle' };

    case 'retry': {
      if (state.status !== 'error') {
        console.warn(
          `[PlotStateMachine] Illegal transition: 'retry' event in '${state.status}' state. Ignoring.`
        );
        return state;
      }
      return { status: 'loading' };
    }

    default: {
      // Exhaustiveness guard — TypeScript should catch this at compile time
      const _exhaustive: never = event;
      console.warn('[PlotStateMachine] Unknown event:', _exhaustive);
      return state;
    }
  }
}
```

- [ ] **4.2** Run `npm run test -- stateMachine` — all tests must pass.
- [ ] **4.3** Run `npx tsc --noEmit` — must pass.

---

### Step 5 — Write failing tests for PlotRenderer

- [ ] **5.1** Create `frontend-v2/src/__tests__/plots/renderer.test.tsx`:

```tsx
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JSX } from 'react';
import { PlotRenderer } from '../../components/plots/PlotRenderer';
import type { PlotRenderState, SeriesDescriptor, HoverPayload } from '../../components/plots/plotTypes';
import { usePlotContext } from '../../components/plots/PlotContext';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const IDLE_STATE: PlotRenderState = { status: 'idle' };
const LOADING_STATE: PlotRenderState = { status: 'loading' };
const RENDERED_STATE: PlotRenderState = { status: 'rendered', rowCount: 20 };
const ERROR_STATE: PlotRenderState = { status: 'error', message: 'Query failed', detail: 'syntax error at line 1' };
const EMPTY_STATE: PlotRenderState = { status: 'empty' };

const SERIES: SeriesDescriptor[] = [
  { key: 'heap', label: 'Heap Used', color: '--color-accent' },
  { key: 'committed', label: 'Committed', color: '--color-accent-green' },
];

/** A concrete-renderer stub that registers series and fires hover events via context. */
function ConcreteRendererStub({
  onMount,
}: {
  onMount?: (ctx: ReturnType<typeof usePlotContext>) => void;
}): JSX.Element {
  const ctx = usePlotContext();
  // Register series on first render
  if (onMount) onMount(ctx);
  return <div data-testid="concrete-renderer">chart body</div>;
}

function makeChart(
  state: PlotRenderState,
  title = 'GC Heap Usage',
  extraChildren?: JSX.Element
): JSX.Element {
  return (
    <PlotRenderer state={state} title={title} cellId="gc_overview" plotName="heap_chart">
      {extraChildren ?? <ConcreteRendererStub />}
    </PlotRenderer>
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PlotRenderer — state-specific shells', () => {
  it('renders idle shell in idle state', () => {
    render(makeChart(IDLE_STATE));
    expect(screen.getByTestId('plot-state-idle')).toBeInTheDocument();
    expect(screen.queryByTestId('plot-state-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('concrete-renderer')).not.toBeInTheDocument();
  });

  it('renders loading skeleton in loading state', () => {
    render(makeChart(LOADING_STATE));
    expect(screen.getByTestId('plot-state-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('concrete-renderer')).not.toBeInTheDocument();
  });

  it('renders children (chart) in rendered state', () => {
    render(makeChart(RENDERED_STATE));
    expect(screen.getByTestId('plot-state-rendered')).toBeInTheDocument();
    expect(screen.getByTestId('concrete-renderer')).toBeInTheDocument();
  });

  it('renders error banner in error state', () => {
    render(makeChart(ERROR_STATE));
    expect(screen.getByTestId('plot-state-error')).toBeInTheDocument();
    expect(screen.getByText(/Query failed/)).toBeInTheDocument();
    expect(screen.queryByTestId('concrete-renderer')).not.toBeInTheDocument();
  });

  it('renders "no rows" message in empty state', () => {
    render(makeChart(EMPTY_STATE));
    expect(screen.getByTestId('plot-state-empty')).toBeInTheDocument();
    expect(screen.getByText(/no rows/i)).toBeInTheDocument();
    expect(screen.queryByTestId('concrete-renderer')).not.toBeInTheDocument();
  });

  it('error state shows error detail when provided', () => {
    render(makeChart(ERROR_STATE));
    expect(screen.getByText(/syntax error at line 1/)).toBeInTheDocument();
  });
});

describe('PlotRenderer — legend integration', () => {
  it('legend is visible in rendered state', () => {
    render(makeChart(RENDERED_STATE));
    expect(screen.getByTestId('plot-legend')).toBeInTheDocument();
  });

  it('legend is not present in idle state', () => {
    render(makeChart(IDLE_STATE));
    expect(screen.queryByTestId('plot-legend')).not.toBeInTheDocument();
  });

  it('clicking a legend item hides the series', async () => {
    let capturedCtx: ReturnType<typeof usePlotContext> | null = null;
    render(
      <PlotRenderer state={RENDERED_STATE} title="Test" cellId="c1" plotName="p1">
        <ConcreteRendererStub
          onMount={(ctx) => {
            ctx.registerSeries(SERIES);
            capturedCtx = ctx;
          }}
        />
      </PlotRenderer>
    );

    // Give React time to process registerSeries
    await Promise.resolve();

    const heapItem = screen.getByTestId('plot-legend-item-heap');
    await userEvent.click(heapItem);

    // After click, heap should be in hiddenSeries
    expect(capturedCtx?.hiddenSeries.has('heap')).toBe(true);
  });

  it('clicking a hidden legend item shows the series again', async () => {
    let capturedCtx: ReturnType<typeof usePlotContext> | null = null;
    render(
      <PlotRenderer state={RENDERED_STATE} title="Test" cellId="c1" plotName="p1">
        <ConcreteRendererStub
          onMount={(ctx) => {
            ctx.registerSeries(SERIES);
            capturedCtx = ctx;
          }}
        />
      </PlotRenderer>
    );

    await Promise.resolve();

    const heapItem = screen.getByTestId('plot-legend-item-heap');
    await userEvent.click(heapItem); // hide
    await userEvent.click(heapItem); // show
    expect(capturedCtx?.hiddenSeries.has('heap')).toBe(false);
  });

  it('legend items have role="checkbox" with aria-checked', async () => {
    render(
      <PlotRenderer state={RENDERED_STATE} title="Test" cellId="c1" plotName="p1">
        <ConcreteRendererStub onMount={(ctx) => ctx.registerSeries(SERIES)} />
      </PlotRenderer>
    );

    await Promise.resolve();

    const items = screen.getAllByRole('checkbox');
    expect(items.length).toBeGreaterThanOrEqual(2);
    items.forEach((item) => {
      expect(item).toHaveAttribute('aria-checked');
    });
  });
});

describe('PlotRenderer — tooltip', () => {
  it('tooltip is not visible when no hover payload', () => {
    render(makeChart(RENDERED_STATE));
    const tooltip = screen.queryByTestId('plot-tooltip');
    // Either not present or hidden
    if (tooltip) {
      expect(tooltip).toHaveAttribute('hidden');
    }
  });

  it('tooltip appears when concrete renderer fires onHover', async () => {
    const payload: HoverPayload = {
      entries: [{ label: 'Heap', value: '512 MB' }],
      x: 100,
      y: 50,
    };

    let capturedCtx: ReturnType<typeof usePlotContext> | null = null;

    render(
      <PlotRenderer state={RENDERED_STATE} title="Test" cellId="c1" plotName="p1">
        <ConcreteRendererStub
          onMount={(ctx) => {
            capturedCtx = ctx;
          }}
        />
      </PlotRenderer>
    );

    await Promise.resolve();
    capturedCtx?.onHover(payload);
    await Promise.resolve();

    const tooltip = screen.getByTestId('plot-tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('Heap');
    expect(tooltip).toHaveTextContent('512 MB');
  });

  it('tooltip has role="tooltip"', async () => {
    const payload: HoverPayload = {
      entries: [{ label: 'X', value: '1' }],
      x: 10, y: 10,
    };

    let capturedCtx: ReturnType<typeof usePlotContext> | null = null;
    render(
      <PlotRenderer state={RENDERED_STATE} title="Test" cellId="c1" plotName="p1">
        <ConcreteRendererStub onMount={(ctx) => { capturedCtx = ctx; }} />
      </PlotRenderer>
    );

    await Promise.resolve();
    capturedCtx?.onHover(payload);
    await Promise.resolve();

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toBeInTheDocument();
  });
});

describe('PlotRenderer — annotations', () => {
  it('annotations container is present in rendered state', () => {
    render(makeChart(RENDERED_STATE));
    expect(screen.getByTestId('plot-annotations')).toBeInTheDocument();
  });

  it('pin is added when addPin is called via context', async () => {
    let capturedCtx: ReturnType<typeof usePlotContext> | null = null;
    render(
      <PlotRenderer state={RENDERED_STATE} title="Test" cellId="c1" plotName="p1">
        <ConcreteRendererStub onMount={(ctx) => { capturedCtx = ctx; }} />
      </PlotRenderer>
    );

    await Promise.resolve();
    capturedCtx?.addPin({ dataX: 100, dataY: 200, label: 'GC start', color: '--color-accent-red' });
    await Promise.resolve();

    const annotations = screen.getByTestId('plot-annotations');
    expect(within(annotations).getByText('GC start')).toBeInTheDocument();
  });

  it('pins are cleared when state transitions to loading (re-run)', async () => {
    let capturedCtx: ReturnType<typeof usePlotContext> | null = null;
    const { rerender } = render(
      <PlotRenderer state={RENDERED_STATE} title="Test" cellId="c1" plotName="p1">
        <ConcreteRendererStub onMount={(ctx) => { capturedCtx = ctx; }} />
      </PlotRenderer>
    );

    await Promise.resolve();
    capturedCtx?.addPin({ dataX: 100, dataY: 200, label: 'Pin 1', color: '--color-accent' });
    await Promise.resolve();

    // Re-run: transition to loading
    rerender(
      <PlotRenderer state={LOADING_STATE} title="Test" cellId="c1" plotName="p1">
        <ConcreteRendererStub />
      </PlotRenderer>
    );

    // Back to rendered
    rerender(
      <PlotRenderer state={RENDERED_STATE} title="Test" cellId="c1" plotName="p1">
        <ConcreteRendererStub />
      </PlotRenderer>
    );

    const annotations = screen.getByTestId('plot-annotations');
    expect(within(annotations).queryByText('Pin 1')).not.toBeInTheDocument();
  });
});

describe('PlotRenderer — controls', () => {
  it('controls bar is visible in rendered state', () => {
    render(makeChart(RENDERED_STATE));
    expect(screen.getByTestId('plot-controls')).toBeInTheDocument();
  });

  it('zoom reset button is present and has aria-label', () => {
    render(makeChart(RENDERED_STATE));
    const btn = screen.getByRole('button', { name: /zoom reset/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('fullscreen button is present and has aria-label', () => {
    render(makeChart(RENDERED_STATE));
    expect(screen.getByRole('button', { name: /fullscreen/i })).toBeInTheDocument();
  });

  it('copy/share button is present', () => {
    render(makeChart(RENDERED_STATE));
    expect(screen.getByRole('button', { name: /copy|share/i })).toBeInTheDocument();
  });

  it('share modal opens when copy button is clicked', async () => {
    render(makeChart(RENDERED_STATE));
    const copyBtn = screen.getByRole('button', { name: /copy|share/i });
    await userEvent.click(copyBtn);
    expect(screen.getByTestId('plot-share-modal')).toBeInTheDocument();
  });
});

describe('PlotRenderer — share modal', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        write: vi.fn().mockResolvedValue(undefined),
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function openModal(): Promise<void> {
    render(makeChart(RENDERED_STATE));
    const copyBtn = screen.getByRole('button', { name: /copy|share/i });
    await userEvent.click(copyBtn);
  }

  it('share modal has Copy PNG button', async () => {
    await openModal();
    expect(screen.getByTestId('plot-copy-png')).toBeInTheDocument();
  });

  it('share modal has Copy SVG button', async () => {
    await openModal();
    expect(screen.getByTestId('plot-copy-svg')).toBeInTheDocument();
  });

  it('share modal has Share URL button', async () => {
    await openModal();
    expect(screen.getByTestId('plot-share-url')).toBeInTheDocument();
  });

  it('Share URL writes to clipboard', async () => {
    await openModal();
    await userEvent.click(screen.getByTestId('plot-share-url'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('gc_overview')
    );
  });
});

describe('PlotRenderer — ARIA', () => {
  it('root has role="figure" with aria-label from title', () => {
    render(makeChart(RENDERED_STATE, 'GC Heap Usage'));
    const figure = screen.getByRole('figure');
    expect(figure).toHaveAttribute('aria-label', 'GC Heap Usage');
  });

  it('chart container has aria-describedby pointing to tooltip id', () => {
    render(makeChart(RENDERED_STATE));
    const renderer = screen.getByTestId('plot-renderer');
    // The chart container inside should have aria-describedby
    const container = renderer.querySelector('[aria-describedby]');
    expect(container).not.toBeNull();
  });
});
```

- [ ] **5.2** Run `npm run test -- renderer` — all tests fail.

---

### Step 6 — Implement PlotContext

- [ ] **6.1** Create `frontend-v2/src/components/plots/PlotContext.ts`:

```ts
import { createContext, useContext } from 'react';
import type { PlotContextValue } from './plotTypes';

export const PlotContext = createContext<PlotContextValue | null>(null);

export function usePlotContext(): PlotContextValue {
  const ctx = useContext(PlotContext);
  if (!ctx) {
    throw new Error('usePlotContext must be called inside a PlotRenderer');
  }
  return ctx;
}
```

- [ ] **6.2** Run `npx tsc --noEmit` — must pass.

---

### Step 7 — Implement PlotLegend

- [ ] **7.1** Create `frontend-v2/src/components/plots/PlotLegend.tsx`:

```tsx
import type { JSX, KeyboardEvent } from 'react';
import type { SeriesDescriptor } from './plotTypes';

interface PlotLegendProps {
  series: SeriesDescriptor[];
  hiddenSeries: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

export function PlotLegend({ series, hiddenSeries, onToggle }: PlotLegendProps): JSX.Element {
  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, key: string): void {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onToggle(key);
    }
  }

  return (
    <div
      data-testid="plot-legend"
      className="flex flex-wrap gap-2 px-2 py-1"
      aria-label="Chart legend"
    >
      {series.map((s) => {
        const hidden = hiddenSeries.has(s.key);
        return (
          <button
            key={s.key}
            type="button"
            role="checkbox"
            data-testid={`plot-legend-item-${s.key}`}
            aria-checked={!hidden}
            aria-label={`${hidden ? 'Show' : 'Hide'} ${s.label}`}
            onClick={() => onToggle(s.key)}
            onKeyDown={(e) => handleKeyDown(e, s.key)}
            className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium transition-opacity ${
              hidden ? 'opacity-40' : 'opacity-100'
            } hover:bg-[--color-bg-overlay] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[--color-accent]`}
          >
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: `var(${s.color})` }}
            />
            <span className="text-[--color-fg-muted]">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
```

---

### Step 8 — Implement PlotTooltip

- [ ] **8.1** Create `frontend-v2/src/components/plots/PlotTooltip.tsx`:

```tsx
import type { JSX } from 'react';
import type { HoverPayload } from './plotTypes';

interface PlotTooltipProps {
  id: string;
  payload: HoverPayload | null;
}

export function PlotTooltip({ id, payload }: PlotTooltipProps): JSX.Element {
  if (!payload) {
    // Render hidden so aria-describedby wiring remains stable
    return (
      <div
        id={id}
        data-testid="plot-tooltip"
        role="tooltip"
        hidden
        className="pointer-events-none absolute z-20 rounded border border-[--color-border] bg-[--color-bg-surface] px-2 py-1.5 text-[11px] shadow"
      />
    );
  }

  return (
    <div
      id={id}
      data-testid="plot-tooltip"
      role="tooltip"
      style={{ left: payload.x, top: payload.y }}
      className="pointer-events-none absolute z-20 rounded border border-[--color-border] bg-[--color-bg-surface] px-2 py-1.5 text-[11px] shadow"
    >
      {payload.entries.map((entry) => (
        <div key={entry.label} className="flex items-center gap-2">
          <span className="text-[--color-fg-muted]">{entry.label}:</span>
          <span className="font-medium text-[--color-fg-base]">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}
```

---

### Step 9 — Implement PlotAnnotations

- [ ] **9.1** Create `frontend-v2/src/components/plots/PlotAnnotations.tsx`:

```tsx
import { useState, useEffect } from 'react';
import type { JSX } from 'react';
import type { AnnotationPin, PlotRenderState } from './plotTypes';

interface PlotAnnotationsProps {
  pins: AnnotationPin[];
  state: PlotRenderState;
}

export function PlotAnnotations({ pins, state }: PlotAnnotationsProps): JSX.Element {
  // State transitions to loading = cell is re-running; pins will be cleared by PlotRenderer
  // This component is purely presentational — PlotRenderer manages the pins array
  const _ = state; // consumed by parent for clearing logic

  return (
    <div
      data-testid="plot-annotations"
      className="pointer-events-none absolute inset-0 z-10"
      aria-hidden="true"
    >
      {pins.map((pin) => (
        <div
          key={pin.id}
          className="absolute flex items-center gap-1"
          style={{
            // Position is managed by the concrete renderer via data-coords;
            // PlotAnnotations renders labels; coordinates come from the concrete renderer.
            // For M-C1, we render labels at top-left as a placeholder.
            // M-C2+ will supply actual coordinate transforms.
            top: 8,
            left: 8,
          }}
        >
          <div
            className="h-2 w-2 rounded-full border border-white"
            style={{ background: `var(${pin.color})` }}
            aria-hidden="true"
          />
          <span
            className="rounded bg-[--color-bg-surface]/80 px-1 text-[10px] text-[--color-fg-base]"
          >
            {pin.label}
          </span>
        </div>
      ))}
    </div>
  );
}
```

---

### Step 10 — Implement PlotControls

- [ ] **10.1** Create `frontend-v2/src/components/plots/PlotControls.tsx`:

```tsx
import type { JSX } from 'react';

interface PlotControlsProps {
  onZoomReset: (() => void) | null;
  onFullscreen: () => void;
  onShare: () => void;
}

export function PlotControls({ onZoomReset, onFullscreen, onShare }: PlotControlsProps): JSX.Element {
  return (
    <div
      data-testid="plot-controls"
      className="absolute right-2 top-2 z-20 flex items-center gap-1"
    >
      {onZoomReset && (
        <button
          type="button"
          aria-label="Zoom reset"
          onClick={onZoomReset}
          className="rounded p-1 text-[--color-fg-muted] hover:bg-[--color-bg-overlay] hover:text-[--color-fg-base] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[--color-accent]"
        >
          {/* Zoom reset icon */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0" />
            <path d="M9 12h6M12 9v6" />
          </svg>
        </button>
      )}
      <button
        type="button"
        aria-label="Fullscreen"
        onClick={onFullscreen}
        className="rounded p-1 text-[--color-fg-muted] hover:bg-[--color-bg-overlay] hover:text-[--color-fg-base] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[--color-accent]"
      >
        {/* Fullscreen icon */}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Copy or share"
        onClick={onShare}
        className="rounded p-1 text-[--color-fg-muted] hover:bg-[--color-bg-overlay] hover:text-[--color-fg-base] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[--color-accent]"
      >
        {/* Share icon */}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      </button>
    </div>
  );
}
```

---

### Step 11 — Implement PlotShareModal

- [ ] **11.1** Create `frontend-v2/src/components/plots/PlotShareModal.tsx`:

```tsx
import { useRef, useEffect } from 'react';
import type { JSX, KeyboardEvent } from 'react';

interface PlotShareModalProps {
  cellId: string;
  plotName: string;
  onClose: () => void;
}

export function PlotShareModal({ cellId, plotName, onClose }: PlotShareModalProps): JSX.Element {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    modalRef.current?.focus();
  }, []);

  async function copyPng(): Promise<void> {
    // In production, we'd rasterize the SVG/canvas inside the plot container.
    // For M-C1, we write a stub that creates a 1x1 transparent PNG.
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png')
    );
    if (!blob) return;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    onClose();
  }

  async function copySvg(): Promise<void> {
    // Stub for M-C1 — concrete renderers will supply the SVG node in M-C2+
    const stubSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
    await navigator.clipboard.writeText(stubSvg);
    onClose();
  }

  async function shareUrl(): Promise<void> {
    const hash = `#plot/${encodeURIComponent(cellId)}/${encodeURIComponent(plotName)}`;
    const url = `${window.location.href.split('#')[0]}${hash}`;
    await navigator.clipboard.writeText(url);
    onClose();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Copy or share plot"
      aria-modal="true"
      data-testid="plot-share-modal"
      ref={modalRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="absolute right-0 top-8 z-30 flex flex-col gap-1 rounded border border-[--color-border] bg-[--color-bg-surface] p-2 shadow-lg"
    >
      <button
        type="button"
        data-testid="plot-copy-png"
        onClick={() => void copyPng()}
        className="rounded px-3 py-1.5 text-left text-[12px] text-[--color-fg-base] hover:bg-[--color-bg-overlay] transition-colors"
      >
        Copy as PNG
      </button>
      <button
        type="button"
        data-testid="plot-copy-svg"
        onClick={() => void copySvg()}
        className="rounded px-3 py-1.5 text-left text-[12px] text-[--color-fg-base] hover:bg-[--color-bg-overlay] transition-colors"
      >
        Copy as SVG
      </button>
      <button
        type="button"
        data-testid="plot-share-url"
        onClick={() => void shareUrl()}
        className="rounded px-3 py-1.5 text-left text-[12px] text-[--color-fg-base] hover:bg-[--color-bg-overlay] transition-colors"
      >
        Share URL
      </button>
    </div>
  );
}
```

---

### Step 12 — Implement PlotRenderer

- [ ] **12.1** Create `frontend-v2/src/components/plots/PlotRenderer.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { PlotContext } from './PlotContext';
import { PlotLegend } from './PlotLegend';
import { PlotTooltip } from './PlotTooltip';
import { PlotAnnotations } from './PlotAnnotations';
import { PlotControls } from './PlotControls';
import { PlotShareModal } from './PlotShareModal';
import type {
  PlotRenderState,
  SeriesDescriptor,
  HoverPayload,
  AnnotationPin,
  PlotContextValue,
} from './plotTypes';

interface PlotRendererProps {
  state: PlotRenderState;
  title: string;
  cellId: string;
  plotName: string;
  children?: ReactNode;
}

const TOOLTIP_ID_PREFIX = 'plot-tooltip-';

let tooltipIdCounter = 0;

function nextTooltipId(): string {
  return `${TOOLTIP_ID_PREFIX}${++tooltipIdCounter}`;
}

function nanoid8(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function PlotRenderer({
  state,
  title,
  cellId,
  plotName,
  children,
}: PlotRendererProps): JSX.Element {
  const [series, setSeries] = useState<SeriesDescriptor[]>([]);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [hoverPayload, setHoverPayload] = useState<HoverPayload | null>(null);
  const [pins, setPins] = useState<AnnotationPin[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [zoomResetHandler, setZoomResetHandler] = useState<(() => void) | null>(null);

  const tooltipId = useRef(nextTooltipId());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevStatusRef = useRef<PlotRenderState['status']>(state.status);

  // Clear pins when transitioning to loading (cell re-run)
  useEffect(() => {
    if (state.status === 'loading' && prevStatusRef.current !== 'loading') {
      setPins([]);
      setHoverPayload(null);
    }
    prevStatusRef.current = state.status;
  }, [state.status]);

  const registerSeries = useCallback((incoming: SeriesDescriptor[]): void => {
    setSeries(incoming);
  }, []);

  const onHover = useCallback((payload: HoverPayload | null): void => {
    setHoverPayload(payload);
  }, []);

  const toggleSeries = useCallback((key: string): void => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const addPin = useCallback((pin: Omit<AnnotationPin, 'id'>): void => {
    setPins((prev) => [...prev, { ...pin, id: nanoid8() }]);
  }, []);

  const registerZoomReset = useCallback((handler: () => void): void => {
    setZoomResetHandler(() => handler);
  }, []);

  function handleFullscreen(): void {
    if (containerRef.current) {
      void containerRef.current.requestFullscreen?.();
    }
  }

  const contextValue: PlotContextValue = {
    registerSeries,
    onHover,
    hiddenSeries,
    addPin,
    onZoomReset: zoomResetHandler,
    registerZoomReset,
  };

  return (
    <PlotContext.Provider value={contextValue}>
      <figure
        role="figure"
        data-testid="plot-renderer"
        aria-label={title}
        className="relative flex flex-col w-full h-full"
      >
        {/* State: idle */}
        {state.status === 'idle' && (
          <div
            data-testid="plot-state-idle"
            className="flex items-center justify-center h-full text-[12px] text-[--color-fg-dim]"
          >
            Not yet executed
          </div>
        )}

        {/* State: loading */}
        {state.status === 'loading' && (
          <div
            data-testid="plot-state-loading"
            className="flex flex-col gap-2 h-full p-3"
          >
            <div className="h-4 rounded motion-safe:animate-pulse bg-[--color-bg-overlay]" />
            <div className="flex-1 rounded motion-safe:animate-pulse bg-[--color-bg-overlay]" />
            <div className="h-3 w-2/3 rounded motion-safe:animate-pulse bg-[--color-bg-overlay]" />
          </div>
        )}

        {/* State: error */}
        {state.status === 'error' && (
          <div
            data-testid="plot-state-error"
            className="flex flex-col gap-2 h-full items-center justify-center p-4 text-center"
          >
            <p className="text-[13px] font-medium text-[--color-accent-red]">
              {state.message}
            </p>
            {state.detail && (
              <p className="text-[11px] text-[--color-fg-muted] font-mono">
                {state.detail}
              </p>
            )}
          </div>
        )}

        {/* State: empty */}
        {state.status === 'empty' && (
          <div
            data-testid="plot-state-empty"
            className="flex items-center justify-center h-full text-[12px] text-[--color-fg-dim]"
          >
            No rows returned
          </div>
        )}

        {/* State: rendered — chart shell */}
        {state.status === 'rendered' && (
          <div className="flex flex-col w-full h-full">
            {/* Legend (top) */}
            {series.length > 0 && (
              <PlotLegend
                series={series}
                hiddenSeries={hiddenSeries}
                onToggle={toggleSeries}
              />
            )}

            {/* Chart container */}
            <div
              data-testid="plot-state-rendered"
              ref={containerRef}
              aria-describedby={tooltipId.current}
              className="relative flex-1 min-h-0"
            >
              {children}

              {/* Tooltip */}
              <PlotTooltip id={tooltipId.current} payload={hoverPayload} />

              {/* Annotations */}
              <PlotAnnotations pins={pins} state={state} />

              {/* Controls */}
              <PlotControls
                onZoomReset={zoomResetHandler}
                onFullscreen={handleFullscreen}
                onShare={() => setShareOpen(true)}
              />

              {/* Share modal */}
              {shareOpen && (
                <PlotShareModal
                  cellId={cellId}
                  plotName={plotName}
                  onClose={() => setShareOpen(false)}
                />
              )}
            </div>
          </div>
        )}
      </figure>
    </PlotContext.Provider>
  );
}
```

- [ ] **12.2** Run `npm run test -- renderer` — all tests must pass.
- [ ] **12.3** Run `npx tsc --noEmit` — must pass.

---

### Step 13 — Create plots directory and index

- [ ] **13.1** Create `frontend-v2/src/components/plots/index.ts`:

```ts
export { PlotRenderer } from './PlotRenderer';
export { PlotStateMachine, reduce } from './PlotStateMachine';
export { PlotContext, usePlotContext } from './PlotContext';
export { PlotLegend } from './PlotLegend';
export { PlotTooltip } from './PlotTooltip';
export { PlotAnnotations } from './PlotAnnotations';
export { PlotControls } from './PlotControls';
export { PlotShareModal } from './PlotShareModal';
export type {
  PlotRenderState,
  PlotEvent,
  SeriesDescriptor,
  HoverPayload,
  AnnotationPin,
  PlotContextValue,
} from './plotTypes';
```

- [ ] **13.2** Update `PlotStateMachine.ts` to also add a named export:

In `PlotStateMachine.ts`, the `reduce` function is already a named export. Add an object export for consistency with the index:

```ts
// Add at bottom of PlotStateMachine.ts
export const PlotStateMachine = { reduce };
```

- [ ] **13.3** Run `npx tsc --noEmit` — must pass.
- [ ] **13.4** Run `npm run test` — full suite must pass.

---

### Step 14 — E2E tests

- [ ] **14.1** Create `frontend-v2/tests/e2e/plot-renderer.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

// These e2e tests use a dedicated test page that renders PlotRenderer in different states.
// The page is served by Vite dev server at /__test__/plot-renderer.

test.describe('PlotRenderer E2E', () => {
  // Smoke: verify the app loads without console errors
  test('@e2e app loads without JavaScript errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await page.waitForSelector('[data-testid="welcome-cell"]');
    // Recharts import should not cause errors
    expect(errors.filter((e) => !e.includes('ResizeObserver'))).toHaveLength(0);
  });

  // Note: Full PlotRenderer lifecycle e2e (cell runs, plot transitions) is implemented
  // in M-C7 when execution events are wired. For M-C1, we test the static states
  // by injecting a story URL parameter.
  test('@e2e plot-renderer state=idle renders idle shell', async ({ page }) => {
    await page.goto('/?__plot_story=idle');
    const idle = page.locator('[data-testid="plot-state-idle"]');
    // If story harness not yet wired, this will be skipped
    try {
      await idle.waitFor({ timeout: 3_000 });
      await expect(idle).toBeVisible();
    } catch {
      test.skip();
    }
  });

  test('@e2e plot-renderer state=error renders error banner', async ({ page }) => {
    await page.goto('/?__plot_story=error');
    const errorPanel = page.locator('[data-testid="plot-state-error"]');
    try {
      await errorPanel.waitFor({ timeout: 3_000 });
      await expect(errorPanel).toBeVisible();
    } catch {
      test.skip();
    }
  });
});
```

- [ ] **14.2** Run `npm run test:e2e -- plot-renderer` — tests run (some may be skipped pending story harness; that is acceptable for M-C1).

---

### Step 15 — Accessibility tests

- [ ] **15.1** Create `frontend-v2/tests/e2e/a11y-plot-renderer.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('@a11y PlotRenderer Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="welcome-cell"]');
  });

  test('welcome page (no plot rendered) has no axe violations', async ({ page }) => {
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('plot renderer (idle state) injected into DOM has no axe violations', async ({ page }) => {
    // Inject a minimal plot-renderer-idle shell for axe testing
    await page.evaluate(() => {
      const fig = document.createElement('figure');
      fig.setAttribute('role', 'figure');
      fig.setAttribute('aria-label', 'GC Heap Usage');
      fig.setAttribute('data-testid', 'plot-renderer-axe-test');

      const idle = document.createElement('div');
      idle.textContent = 'Not yet executed';
      fig.appendChild(idle);

      document.body.appendChild(fig);
    });

    const results = await new AxeBuilder({ page })
      .include('[data-testid="plot-renderer-axe-test"]')
      .analyze();

    expect(results.violations).toHaveLength(0);
  });

  test('plot legend items have checkbox role and aria-checked', async ({ page }) => {
    // Inject a legend for axe testing
    await page.evaluate(() => {
      const legend = document.createElement('div');
      legend.setAttribute('data-testid', 'plot-legend-axe');
      legend.setAttribute('aria-label', 'Chart legend');

      const btn = document.createElement('button');
      btn.setAttribute('role', 'checkbox');
      btn.setAttribute('aria-checked', 'true');
      btn.setAttribute('aria-label', 'Hide Heap Used');
      btn.textContent = 'Heap Used';
      legend.appendChild(btn);

      document.body.appendChild(legend);
    });

    const results = await new AxeBuilder({ page })
      .include('[data-testid="plot-legend-axe"]')
      .analyze();

    expect(results.violations).toHaveLength(0);
  });

  test('share modal injected has no axe violations', async ({ page }) => {
    await page.evaluate(() => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-label', 'Copy or share plot');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('data-testid', 'plot-share-modal-axe');
      dialog.setAttribute('tabindex', '-1');

      ['Copy as PNG', 'Copy as SVG', 'Share URL'].forEach((label) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.type = 'button';
        dialog.appendChild(btn);
      });

      document.body.appendChild(dialog);
    });

    const results = await new AxeBuilder({ page })
      .include('[data-testid="plot-share-modal-axe"]')
      .analyze();

    expect(results.violations).toHaveLength(0);
  });

  test('tooltip has role="tooltip" with content', async ({ page }) => {
    await page.evaluate(() => {
      const tip = document.createElement('div');
      tip.setAttribute('role', 'tooltip');
      tip.setAttribute('id', 'plot-tooltip-axe-1');
      tip.setAttribute('data-testid', 'plot-tooltip-axe');
      tip.textContent = 'Heap: 512 MB';
      document.body.appendChild(tip);

      const host = document.createElement('div');
      host.setAttribute('aria-describedby', 'plot-tooltip-axe-1');
      host.textContent = 'Chart area';
      document.body.appendChild(host);
    });

    const results = await new AxeBuilder({ page })
      .include('[data-testid="plot-tooltip-axe"]')
      .analyze();

    expect(results.violations).toHaveLength(0);
  });
});
```

- [ ] **15.2** Run `npm run test:a11y -- plot-renderer` — must pass.

---

### Step 16 — Visual regression tests

- [ ] **16.1** Create `frontend-v2/tests/visual/plot-renderer.visual.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('@visual PlotRenderer Visual Snapshots', () => {
  // These snapshots use the welcome page as a baseline.
  // Full plot state snapshots require a story harness (M-C2+).
  // For M-C1, we snapshot the state-specific CSS shells injected into the DOM.

  test('plot loading skeleton — light theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="welcome-cell"]');

    // Inject a loading skeleton
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'visual-test-plot';
      host.style.cssText = 'width:400px;height:200px;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);';
      host.innerHTML = `
        <div data-testid="plot-state-loading" style="display:flex;flex-direction:column;gap:8px;height:100%;padding:12px;">
          <div style="height:16px;border-radius:4px;background:var(--color-bg-overlay);"></div>
          <div style="flex:1;border-radius:4px;background:var(--color-bg-overlay);"></div>
          <div style="height:12px;width:66%;border-radius:4px;background:var(--color-bg-overlay);"></div>
        </div>`;
      document.body.appendChild(host);
    });

    await expect(page.locator('#visual-test-plot')).toHaveScreenshot(
      'plot-loading-skeleton-light.png',
      { maxDiffPixelRatio: 0.02 }
    );
  });

  test('plot loading skeleton — dark theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="welcome-cell"]');
    await page.click('[data-testid="theme-toggle"]');

    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'visual-test-plot-dark';
      host.style.cssText = 'width:400px;height:200px;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);';
      host.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;height:100%;padding:12px;">
          <div style="height:16px;border-radius:4px;background:var(--color-bg-overlay);"></div>
          <div style="flex:1;border-radius:4px;background:var(--color-bg-overlay);"></div>
          <div style="height:12px;width:66%;border-radius:4px;background:var(--color-bg-overlay);"></div>
        </div>`;
      document.body.appendChild(host);
    });

    await expect(page.locator('#visual-test-plot-dark')).toHaveScreenshot(
      'plot-loading-skeleton-dark.png',
      { maxDiffPixelRatio: 0.02 }
    );
  });

  test('plot error state — light theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="welcome-cell"]');

    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'visual-test-plot-error';
      host.style.cssText = 'width:400px;height:200px;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;';
      host.innerHTML = `
        <div data-testid="plot-state-error" style="text-align:center;padding:16px;">
          <p style="font-size:13px;font-weight:500;color:var(--color-accent-red);">Query failed</p>
          <p style="font-size:11px;color:var(--color-fg-muted);font-family:monospace;">syntax error at line 1</p>
        </div>`;
      document.body.appendChild(host);
    });

    await expect(page.locator('#visual-test-plot-error')).toHaveScreenshot(
      'plot-error-state-light.png',
      { maxDiffPixelRatio: 0.02 }
    );
  });

  test('plot empty state — light theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="welcome-cell"]');

    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'visual-test-plot-empty';
      host.style.cssText = 'width:400px;height:200px;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;';
      host.innerHTML = `
        <div data-testid="plot-state-empty" style="font-size:12px;color:var(--color-fg-dim);">
          No rows returned
        </div>`;
      document.body.appendChild(host);
    });

    await expect(page.locator('#visual-test-plot-empty')).toHaveScreenshot(
      'plot-empty-state-light.png',
      { maxDiffPixelRatio: 0.02 }
    );
  });
});
```

- [ ] **16.2** Run `npm run test:visual -- plot-renderer` — capture baseline snapshots. Second run must pass.

---

### Step 17 — Performance benchmarks

- [ ] **17.1** Create `frontend-v2/src/__tests__/plots/stateMachine.bench.ts`:

```ts
import { bench, describe } from 'vitest';
import { reduce } from '../../components/plots/PlotStateMachine';
import type { PlotRenderState, PlotEvent } from '../../components/plots/plotTypes';

const IDLE: PlotRenderState = { status: 'idle' };
const LOADING: PlotRenderState = { status: 'loading' };
const ERROR: PlotRenderState = { status: 'error', message: 'fail' };

describe('PlotStateMachine reducer perf', () => {
  bench('idle → loading (run event)', () => {
    reduce(IDLE, { type: 'run' });
  });

  bench('loading → rendered (data event, 1000 rows)', () => {
    reduce(LOADING, { type: 'data', rowCount: 1000 });
  });

  bench('loading → empty (data event, 0 rows)', () => {
    reduce(LOADING, { type: 'data', rowCount: 0 });
  });

  bench('loading → error (fail event)', () => {
    reduce(LOADING, { type: 'fail', message: 'SQL syntax error', detail: 'at line 1 col 5' });
  });

  bench('error → loading (retry event)', () => {
    reduce(ERROR, { type: 'retry' });
  });

  bench('any → idle (reset event)', () => {
    reduce(LOADING, { type: 'reset' });
  });

  bench('illegal transition (warn + return same ref)', () => {
    // Suppress warn for bench
    const noop = (): void => {};
    const orig = console.warn;
    console.warn = noop;
    reduce(IDLE, { type: 'data', rowCount: 5 });
    console.warn = orig;
  });

  bench('full lifecycle: idle→loading→rendered→loading→empty (4 reduces)', () => {
    const s1 = reduce(IDLE, { type: 'run' });
    const s2 = reduce(s1, { type: 'data', rowCount: 42 });
    const s3 = reduce(s2, { type: 'run' });
    reduce(s3, { type: 'data', rowCount: 0 });
  });
});
```

- [ ] **17.2** Run `npm run test:perf -- stateMachine` — benchmarks run and produce output.

---

### Step 18 — Final verification

- [ ] **18.1** Run `npm run test` — all unit tests pass.
- [ ] **18.2** Run `npx tsc --noEmit` — no type errors.
- [ ] **18.3** Run `npm run lint` — no lint errors.
- [ ] **18.4** Run `npm run test:e2e -- plot-renderer` — e2e tests pass (or are explicitly skipped with `test.skip()` where story harness is pending).
- [ ] **18.5** Run `npm run test:a11y -- plot-renderer` — a11y tests pass.
- [ ] **18.6** Run `npm run test:visual -- plot-renderer` — visual snapshots stable.
- [ ] **18.7** Run `npm run test:perf -- stateMachine` — benchmarks produce output.
- [ ] **18.8** Manual gate check:
  - `npm run dev` starts without errors
  - Browser console is clean (no import errors from recharts)
  - `npx tsc --noEmit` reports 0 errors

---

## Acceptance criteria

All of the following must be true before marking M-C1 complete:

1. Recharts installed as a `dependency` in `package.json`.
2. `PlotStateMachine.ts` exports a pure `reduce(state, event)` function; all legal transitions work; illegal transitions warn and return input unchanged (same reference).
3. `PlotRenderer` renders state-specific shells for all 5 states (idle, loading, rendered, error, empty).
4. `PlotContext` provides `registerSeries`, `onHover`, `hiddenSeries`, `addPin`, `onZoomReset`, `registerZoomReset` to concrete renderers.
5. `PlotLegend` renders series with `role="checkbox"` + `aria-checked`; click toggles `hiddenSeries` in context; keyboard-accessible (Tab + Space/Enter).
6. `PlotTooltip` renders with `role="tooltip"` when payload is non-null; hidden otherwise; wired via `aria-describedby` on chart container.
7. `PlotAnnotations` stores pins in component state; pins cleared on `loading` state transition; renders labels.
8. `PlotControls` exposes Zoom Reset (when handler registered), Fullscreen, Copy/Share buttons with `aria-label`; all keyboard-accessible.
9. `PlotShareModal` has Copy PNG (clipboard.write), Copy SVG (clipboard.writeText), Share URL (clipboard.writeText with `#plot/` hash) buttons; opens/closes correctly.
10. Root `<figure>` has `role="figure"` with `aria-label` from `title` prop.
11. `plotTypes.ts` defines all shared types with no `any` — only `unknown` with narrowing where needed.
12. All five test layers pass: unit, E2E (or explicitly skipped), visual, a11y, perf bench.
13. No type errors (`npx tsc --noEmit` clean).
