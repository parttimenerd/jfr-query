# M-B2: Cell Editor Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans.
> **Testing standard:** See docs/superpowers/TESTING_STANDARD.md — all 5 layers apply.

**Goal:** Cell editing surface — CodeMirror 6 SQL+plot editors, $var inline chips,
diagnostics strip, run button stub. First milestone with real interactive UI.

**Architecture:** A `NotebookView` renders a list of `CellView`s. Each `CellView`
owns one `Cell` from `services/parser/types.ts` plus a local `Diagnostic[]` map
keyed by block index. Blocks render block-specific editors: `SqlBlockEditor`
(CodeMirror 6 + SQL highlighting + `$var` mark decorations), `PlotBlockEditor`
(CodeMirror 6 plain editor, no language extension), `ProseBlock` (`<textarea>`).
The `$var` decoration wraps each `\$[a-z][a-z0-9_]*` match in a `VarChip` widget
that opens an inline popover. `App.tsx` chooses between `WelcomeCell` (when
no notebook is open) and `NotebookView` (when one is). At this milestone the
"open" notebook is a hardcoded example so that the editor surface is exercisable
in Playwright before M-F* persistence ships.

**Tech Stack:** React 19.2, TypeScript 5.8, Vite 6.2, Tailwind v4, Vitest 4.1.9,
Playwright 1.61.0, `@testing-library/react` 16.3.0, `@testing-library/user-event`
14.6.1, `@testing-library/jest-dom` 6.6.3, `@codemirror/state@6.5.2`,
`@codemirror/view@6.36.4`, `@codemirror/lang-sql@6.8.0`,
`@codemirror/theme-one-dark@6.1.2`.

---

## Pre-resolved decisions

**DECISION: CodeMirror 6.** Install the four CM packages with `--save-exact`.
No custom grammar for plot DSL at this milestone — `PlotBlockEditor` uses
`EditorView` with no language extension. SQL editor uses `@codemirror/lang-sql`
and adds a custom `ViewPlugin` that scans the visible ranges with the regex
`/\$[a-z][a-z0-9_]*/gi` and emits `Decoration.mark({ class: 'cm-var-chip',
attributes: { 'data-testid': 'var-chip', 'data-var-name': name } })` per match.

**DECISION: $var chip rendering.** Implement as a CM6 mark decoration (NOT a
widget) — the underlying text stays selectable. The CSS class `cm-var-chip`
styles the span with a pill background. Clicking a chip dispatches a custom
`varChipClick` event with `detail: { name, anchor }`; `SqlBlockEditor` listens
on its host `<div>` and renders a single `<VarChip>` popover positioned at the
anchor. Popover is `<div role="tooltip" data-testid="var-chip-popover">` and
shows `$<name> = <value or "(unset)">`. Values come from the optional
`variables: Record<string,string>` prop on `SqlBlockEditor` (passed by
`CellView` from `notebook.frontmatter.variables`).

**DECISION: Cell state.** Cell content lives in local React state on each
`CellView`. The parent `NotebookView` owns the `Notebook` and replaces the
`source` of a block when a child editor calls `onSourceChange(blockIndex, src)`.
No persistence at this milestone (that ships in M-F*).

**DECISION: Formatter on Meta+S.** `SqlBlockEditor` registers a CodeMirror
`keymap.of([{ key: 'Mod-s', preventDefault: true, run: ... }])` entry that
calls `formatSql(currentDoc)` from `src/services/formatter/sqlFormatter.ts`
and replaces the doc when `result.diagnostics` is empty.

**DECISION: Run button.** `CellHeading` renders a button with
`data-testid="cell-run-button"`, `aria-label="Run cell"`, and an `onClick`
that is a no-op for now. Status chip is `data-testid="cell-status"` and
shows `idle` at all times this milestone.

**DECISION: Diagnostics.** `CellView` keeps a `diagnosticsByBlock: Diagnostic[][]`
state, indexed by block position. Each block editor receives only its slice.
`DiagnosticsStrip` renders nothing when its `diagnostics` prop is empty (returns
`null` — keeps the DOM tidy). Otherwise it renders `<ul role="list"
data-testid="diagnostics-strip">` with one `<li>` per diagnostic, each carrying
a `data-severity` attribute and a color glyph (▣ for error, ▲ for warning,
ⓘ for info) so color is never the sole signal.

**DECISION: Test strategy.** CodeMirror does not render in jsdom in a way the
Testing Library can interrogate. For Vitest unit tests we mock the editor
modules with `vi.mock(...)` so the component under test renders a `<textarea>`
stub carrying the right `data-testid`. Playwright tests use the real CM6
build and interact via `.cm-content` selectors.

**DECISION: Example notebook.** Hardcoded in
`src/components/notebook/exampleNotebook.ts`. Two cells: one SQL cell with
alias `events` and source `select * from events where type = $eventType`, one
prose cell with a short description. Frontmatter sets `variables: { eventType:
"'cpu'" }` so the chip popover shows a real value.

**DECISION: App.tsx routing.** Add `useState<Notebook | null>(null)` for the
"current notebook". A button on the welcome cell (`data-testid="open-example"`)
sets it to the hardcoded example. Playwright tests for M-B2 click that button
to reach the editor. The button does not exist in M-B1 — it is added here.

**DECISION: Spec file alignment.** Per TESTING_STANDARD.md, M-B2 owns
`tests/e2e/02-vars-and-sigils.spec.ts`. The two SQL-formatter tests for M-A5
that need a live editor also land here in `tests/e2e/08-formatter.spec.ts`
(only the two specified tests — the others remain `test.fixme`).

---

## Steps

### Step 1 — Install CodeMirror 6 (exact versions)

- [ ] **1.1** Install the four CM packages with pinned versions:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && \
    npm install --save-exact \
      @codemirror/state@6.5.2 \
      @codemirror/view@6.36.4 \
      @codemirror/lang-sql@6.8.0 \
      @codemirror/theme-one-dark@6.1.2
  ```
  Expected: install completes; `package.json` `dependencies` lists each pinned
  version (no `^` prefix).

- [ ] **1.2** Verify all four entries landed at the pinned versions:
  ```bash
  grep -E '@codemirror/(state|view|lang-sql|theme-one-dark)' \
    /Users/i560383_1/code/experiments/jfr-query/frontend-v2/package.json
  ```
  Expected: four lines, exact versions, no carets.

- [ ] **1.3** Typecheck to confirm the new types resolve:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run typecheck
  ```
  Expected: exits 0.

---

### Step 2 — Create cell+notebook directories and write failing tests (TDD red)

- [ ] **2.1** Create directories:
  ```bash
  mkdir -p /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/components/cell \
           /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/components/notebook \
           /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/cell \
           /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/__tests__/notebook
  ```
  Expected: silent (mkdir -p).

- [ ] **2.2** Create `frontend-v2/src/__tests__/cell/DiagnosticsStrip.test.tsx`:
  ```tsx
  import { describe, it, expect } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { DiagnosticsStrip } from '../../components/cell/DiagnosticsStrip';
  import type { Diagnostic } from '../../services/parser/types';

  function d(severity: Diagnostic['severity'], message: string): Diagnostic {
    return { kind: 'ParseError', severity, message, offset: 0, length: 0 };
  }

  describe('DiagnosticsStrip', () => {
    it('renders nothing when diagnostics array is empty', () => {
      const { container } = render(<DiagnosticsStrip diagnostics={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders an item per diagnostic with role=list', () => {
      render(
        <DiagnosticsStrip
          diagnostics={[d('error', 'bad token'), d('warning', 'deprecated')]}
        />,
      );
      const strip = screen.getByTestId('diagnostics-strip');
      expect(strip).toHaveAttribute('role', 'list');
      expect(strip.querySelectorAll('li')).toHaveLength(2);
    });

    it('carries data-severity attribute per item', () => {
      render(
        <DiagnosticsStrip
          diagnostics={[d('error', 'e'), d('warning', 'w'), d('info', 'i')]}
        />,
      );
      const items = screen
        .getByTestId('diagnostics-strip')
        .querySelectorAll('li');
      expect(items[0].getAttribute('data-severity')).toBe('error');
      expect(items[1].getAttribute('data-severity')).toBe('warning');
      expect(items[2].getAttribute('data-severity')).toBe('info');
    });

    it('renders a non-color glyph per severity (color not sole signal)', () => {
      render(<DiagnosticsStrip diagnostics={[d('error', 'boom')]} />);
      const item = screen.getByTestId('diagnostics-strip').querySelector('li')!;
      // glyph ▣ / ▲ / ⓘ — must be present in the text content
      expect(item.textContent).toMatch(/[▣▲ⓘ]/);
      expect(item.textContent).toContain('boom');
    });
  });
  ```

- [ ] **2.3** Create `frontend-v2/src/__tests__/cell/SqlBlockEditor.test.tsx`
  (this test mocks the real implementation so we exercise the public surface
  contract — the CM6 internals are covered by Playwright):
  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';

  // Mock the editor module so it renders a textarea in jsdom.
  vi.mock('../../components/cell/SqlBlockEditor', () => ({
    SqlBlockEditor: ({
      value,
      onChange,
    }: {
      value: string;
      onChange: (v: string) => void;
      variables?: Record<string, string>;
    }) => (
      <textarea
        data-testid="sql-editor"
        defaultValue={value}
        onChange={(e) => onChange(e.target.value)}
      />
    ),
  }));

  import { SqlBlockEditor } from '../../components/cell/SqlBlockEditor';

  describe('SqlBlockEditor (mocked surface)', () => {
    it('renders a sql-editor testid', () => {
      render(<SqlBlockEditor value="select 1" onChange={() => {}} />);
      expect(screen.getByTestId('sql-editor')).toBeInTheDocument();
    });

    it('seeds with the value prop', () => {
      render(
        <SqlBlockEditor value="select 42" onChange={() => {}} />,
      );
      const ta = screen.getByTestId('sql-editor') as HTMLTextAreaElement;
      expect(ta.value).toBe('select 42');
    });

    it('emits onChange when typed into', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<SqlBlockEditor value="" onChange={onChange} />);
      await user.type(screen.getByTestId('sql-editor'), 'select 1');
      expect(onChange).toHaveBeenCalled();
      expect(onChange.mock.calls.at(-1)?.[0]).toBe('select 1');
    });
  });
  ```

- [ ] **2.4** Create `frontend-v2/src/__tests__/cell/CellView.test.tsx`:
  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';

  // Mock heavy editors so jsdom can render them.
  vi.mock('../../components/cell/SqlBlockEditor', () => ({
    SqlBlockEditor: ({
      value,
      onChange,
    }: {
      value: string;
      onChange: (v: string) => void;
    }) => (
      <textarea
        data-testid="sql-editor"
        defaultValue={value}
        onChange={(e) => onChange(e.target.value)}
      />
    ),
  }));
  vi.mock('../../components/cell/PlotBlockEditor', () => ({
    PlotBlockEditor: ({ value }: { value: string }) => (
      <textarea data-testid="plot-editor" defaultValue={value} />
    ),
  }));

  import { CellView } from '../../components/cell/CellView';
  import type { Cell } from '../../services/parser/types';

  function makeCell(): Cell {
    return {
      displayIndex: 1,
      alias: 'events',
      frontmatter: {},
      blocks: [
        { kind: 'sql', source: 'select * from events\n' },
        { kind: 'prose', source: 'Notes about the cell.\n' },
      ],
    };
  }

  describe('CellView', () => {
    it('renders the cell heading with alias and display index', () => {
      render(<CellView cell={makeCell()} onChange={() => {}} />);
      expect(screen.getByText(/events/i)).toBeInTheDocument();
      expect(screen.getByText('#1')).toBeInTheDocument();
    });

    it('renders one editor per block in order', () => {
      render(<CellView cell={makeCell()} onChange={() => {}} />);
      expect(screen.getByTestId('sql-editor')).toBeInTheDocument();
      expect(screen.getByTestId('prose-editor')).toBeInTheDocument();
    });

    it('renders a run button with aria-label "Run cell"', () => {
      render(<CellView cell={makeCell()} onChange={() => {}} />);
      const btn = screen.getByTestId('cell-run-button');
      expect(btn).toHaveAttribute('aria-label', 'Run cell');
    });

    it('renders an idle status chip', () => {
      render(<CellView cell={makeCell()} onChange={() => {}} />);
      expect(screen.getByTestId('cell-status')).toHaveTextContent(/idle/i);
    });

    it('renders an empty results area placeholder', () => {
      render(<CellView cell={makeCell()} onChange={() => {}} />);
      expect(screen.getByTestId('cell-results')).toBeInTheDocument();
    });

    it('invokes onChange when a block emits a new source', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<CellView cell={makeCell()} onChange={onChange} />);
      await user.type(screen.getByTestId('sql-editor'), 'X');
      expect(onChange).toHaveBeenCalled();
      const [blockIndex, newSource] = onChange.mock.calls.at(-1)!;
      expect(blockIndex).toBe(0);
      expect(newSource).toContain('X');
    });
  });
  ```

- [ ] **2.5** Create `frontend-v2/src/__tests__/notebook/NotebookView.test.tsx`:
  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';

  vi.mock('../../components/cell/SqlBlockEditor', () => ({
    SqlBlockEditor: ({ value }: { value: string }) => (
      <textarea data-testid="sql-editor" defaultValue={value} />
    ),
  }));
  vi.mock('../../components/cell/PlotBlockEditor', () => ({
    PlotBlockEditor: ({ value }: { value: string }) => (
      <textarea data-testid="plot-editor" defaultValue={value} />
    ),
  }));

  import { NotebookView } from '../../components/notebook/NotebookView';
  import type { Notebook } from '../../services/parser/types';

  function makeNotebook(): Notebook {
    return {
      frontmatter: { variables: { eventType: "'cpu'" } },
      cells: [
        {
          displayIndex: 1,
          alias: 'a',
          frontmatter: {},
          blocks: [{ kind: 'sql', source: 'select 1\n' }],
        },
        {
          displayIndex: 2,
          alias: 'b',
          frontmatter: {},
          blocks: [{ kind: 'prose', source: 'note\n' }],
        },
      ],
    };
  }

  describe('NotebookView', () => {
    it('renders a notebook-view container', () => {
      render(<NotebookView initial={makeNotebook()} />);
      expect(screen.getByTestId('notebook-view')).toBeInTheDocument();
    });

    it('renders one CellView per cell', () => {
      render(<NotebookView initial={makeNotebook()} />);
      // Each cell rendered → both editors present.
      expect(screen.getByTestId('sql-editor')).toBeInTheDocument();
      expect(screen.getByTestId('prose-editor')).toBeInTheDocument();
    });

    it('renders empty state when notebook has zero cells', () => {
      render(
        <NotebookView
          initial={{ frontmatter: {}, cells: [] }}
        />,
      );
      expect(screen.getByTestId('notebook-empty')).toBeInTheDocument();
    });
  });
  ```

- [ ] **2.6** Run the new tests — they MUST fail because none of the components
  exist yet:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && \
    npm run test -- "(cell|notebook)" 2>&1 | tail -30
  ```
  Expected: module-resolution failures pointing at
  `components/cell/DiagnosticsStrip`, `components/cell/SqlBlockEditor`,
  `components/cell/PlotBlockEditor`, `components/cell/CellView`,
  `components/notebook/NotebookView`. Exit code non-zero — red phase confirmed.

---

### Step 3 — Implement `DiagnosticsStrip` and `VarChip` (green for strip)

- [ ] **3.1** Create `frontend-v2/src/components/cell/DiagnosticsStrip.tsx`:
  ```tsx
  import type { Diagnostic } from '../../services/parser/types';

  interface DiagnosticsStripProps {
    diagnostics: Diagnostic[];
  }

  const GLYPH: Record<Diagnostic['severity'], string> = {
    error: '▣',
    warning: '▲',
    info: 'ⓘ',
  };

  const TONE: Record<Diagnostic['severity'], string> = {
    error: 'text-[--color-accent-red]',
    warning: 'text-[--color-accent-amber]',
    info: 'text-[--color-fg-muted]',
  };

  export function DiagnosticsStrip({
    diagnostics,
  }: DiagnosticsStripProps): JSX.Element | null {
    if (diagnostics.length === 0) return null;
    return (
      <ul
        role="list"
        data-testid="diagnostics-strip"
        className="m-0 list-none border-t border-[--color-border] bg-[--color-bg-overlay] px-3 py-1 text-xs"
      >
        {diagnostics.map((d, i) => (
          <li
            key={`${d.offset}-${i}`}
            data-severity={d.severity}
            className={`flex items-center gap-2 ${TONE[d.severity]}`}
          >
            <span aria-hidden="true">{GLYPH[d.severity]}</span>
            <span className="sr-only">{d.severity}:</span>
            <span>{d.message}</span>
          </li>
        ))}
      </ul>
    );
  }
  ```

- [ ] **3.2** Create `frontend-v2/src/components/cell/VarChip.tsx`:
  ```tsx
  interface VarChipProps {
    name: string;
    value: string | undefined;
    onClose: () => void;
  }

  export function VarChip({ name, value, onClose }: VarChipProps): JSX.Element {
    return (
      <div
        role="tooltip"
        data-testid="var-chip-popover"
        className="absolute z-20 rounded border border-[--color-border] bg-[--color-bg-surface] px-3 py-2 text-xs shadow-md"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[--color-accent-cyan]">${name}</span>
          <span className="text-[--color-fg-muted]">=</span>
          <span className="font-mono text-[--color-fg-base]">
            {value ?? '(unset)'}
          </span>
        </div>
        <button
          type="button"
          aria-label="Close variable popover"
          onClick={onClose}
          className="absolute right-1 top-1 px-1 text-[--color-fg-muted] hover:text-[--color-fg-base]"
        >
          ×
        </button>
      </div>
    );
  }
  ```

- [ ] **3.3** Run DiagnosticsStrip tests — they MUST pass:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && \
    npm run test -- cell/DiagnosticsStrip 2>&1 | tail -10
  ```
  Expected:
  ```
  Test Files  1 passed (1)
       Tests  4 passed (4)
  ```

---

### Step 4 — Implement `SqlBlockEditor` (CM6 + $var decorations + Meta+S formatter)

- [ ] **4.1** Create `frontend-v2/src/components/cell/SqlBlockEditor.tsx`:
  ```tsx
  import { useEffect, useRef, useState } from 'react';
  import { EditorState, RangeSetBuilder } from '@codemirror/state';
  import {
    EditorView,
    Decoration,
    ViewPlugin,
    keymap,
    type DecorationSet,
    type ViewUpdate,
  } from '@codemirror/view';
  import { sql } from '@codemirror/lang-sql';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { formatSql } from '../../services/formatter/sqlFormatter';
  import { VarChip } from './VarChip';

  const VAR_RE = /\$[a-z][a-z0-9_]*/gi;

  function buildVarDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      VAR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = VAR_RE.exec(text)) !== null) {
        const start = from + m.index;
        const end = start + m[0].length;
        builder.add(
          start,
          end,
          Decoration.mark({
            class: 'cm-var-chip',
            attributes: {
              'data-testid': 'var-chip',
              'data-var-name': m[0].slice(1),
            },
          }),
        );
      }
    }
    return builder.finish();
  }

  const varChipPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildVarDecorations(view);
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = buildVarDecorations(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  interface SqlBlockEditorProps {
    value: string;
    onChange: (next: string) => void;
    variables?: Record<string, string>;
  }

  interface PopoverState {
    name: string;
    x: number;
    y: number;
  }

  export function SqlBlockEditor({
    value,
    onChange,
    variables,
  }: SqlBlockEditorProps): JSX.Element {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const [popover, setPopover] = useState<PopoverState | null>(null);

    useEffect(() => {
      if (!hostRef.current) return;
      const formatKey = keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: (view) => {
            const result = formatSql(view.state.doc.toString());
            if (result.diagnostics.length === 0) {
              view.dispatch({
                changes: {
                  from: 0,
                  to: view.state.doc.length,
                  insert: result.formatted,
                },
              });
            }
            return true;
          },
        },
      ]);

      const state = EditorState.create({
        doc: value,
        extensions: [
          sql(),
          oneDark,
          varChipPlugin,
          formatKey,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              onChangeRef.current(u.state.doc.toString());
            }
          }),
        ],
      });

      const view = new EditorView({ state, parent: hostRef.current });
      viewRef.current = view;

      function handleClick(e: MouseEvent): void {
        const target = e.target as HTMLElement | null;
        const chip = target?.closest('.cm-var-chip') as HTMLElement | null;
        if (!chip) {
          setPopover(null);
          return;
        }
        const name = chip.getAttribute('data-var-name') ?? '';
        const rect = chip.getBoundingClientRect();
        const hostRect = hostRef.current!.getBoundingClientRect();
        setPopover({
          name,
          x: rect.left - hostRect.left,
          y: rect.bottom - hostRect.top,
        });
      }
      hostRef.current.addEventListener('click', handleClick);

      return () => {
        hostRef.current?.removeEventListener('click', handleClick);
        view.destroy();
        viewRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keep the external `value` prop in sync if the parent replaces it.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current !== value) {
        view.dispatch({
          changes: { from: 0, to: current.length, insert: value },
        });
      }
    }, [value]);

    return (
      <div className="relative">
        <div
          ref={hostRef}
          data-testid="sql-editor"
          className="cm-host min-h-[6rem] text-sm"
        />
        {popover ? (
          <div
            style={{ position: 'absolute', left: popover.x, top: popover.y }}
          >
            <VarChip
              name={popover.name}
              value={variables?.[popover.name]}
              onClose={() => setPopover(null)}
            />
          </div>
        ) : null}
      </div>
    );
  }
  ```

- [ ] **4.2** Add minimal CSS for the var chip class. Append to
  `frontend-v2/src/styles/tokens.css` (do not overwrite — append a new block at
  the end of the file):
  ```css
  /* M-B2: SQL var chip pill style */
  .cm-var-chip {
    background-color: var(--color-bg-overlay);
    color: var(--color-accent-cyan);
    border-radius: 0.25rem;
    padding: 0 0.2rem;
    cursor: pointer;
  }
  ```
  Verify the addition landed:
  ```bash
  tail -8 /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/styles/tokens.css
  ```
  Expected: the new block is the final content of the file.

- [ ] **4.3** Typecheck:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run typecheck
  ```
  Expected: exits 0.

- [ ] **4.4** Re-run the SqlBlockEditor unit test — it MUST still pass because
  the test mocks the module entirely:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && \
    npm run test -- cell/SqlBlockEditor 2>&1 | tail -10
  ```
  Expected:
  ```
  Test Files  1 passed (1)
       Tests  3 passed (3)
  ```

---

### Step 5 — Implement `PlotBlockEditor` and `ProseBlock`

- [ ] **5.1** Create `frontend-v2/src/components/cell/PlotBlockEditor.tsx`:
  ```tsx
  import { useEffect, useRef } from 'react';
  import { EditorState } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';
  import { oneDark } from '@codemirror/theme-one-dark';

  interface PlotBlockEditorProps {
    value: string;
    onChange: (next: string) => void;
  }

  export function PlotBlockEditor({
    value,
    onChange,
  }: PlotBlockEditorProps): JSX.Element {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
      if (!hostRef.current) return;
      const state = EditorState.create({
        doc: value,
        extensions: [
          oneDark,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      });
      const view = new EditorView({ state, parent: hostRef.current });
      viewRef.current = view;
      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current !== value) {
        view.dispatch({
          changes: { from: 0, to: current.length, insert: value },
        });
      }
    }, [value]);

    return (
      <div
        ref={hostRef}
        data-testid="plot-editor"
        className="cm-host min-h-[4rem] text-sm"
      />
    );
  }
  ```

- [ ] **5.2** Create `frontend-v2/src/components/cell/ProseBlock.tsx`:
  ```tsx
  interface ProseBlockProps {
    value: string;
    onChange: (next: string) => void;
  }

  export function ProseBlock({ value, onChange }: ProseBlockProps): JSX.Element {
    return (
      <textarea
        data-testid="prose-editor"
        className="block w-full resize-y rounded border border-[--color-border] bg-[--color-bg-surface] p-2 text-sm text-[--color-fg-base]"
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  ```

- [ ] **5.3** Typecheck:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run typecheck
  ```
  Expected: exits 0.

---

### Step 6 — Implement `CellHeading` and `CellView`

- [ ] **6.1** Create `frontend-v2/src/components/cell/CellHeading.tsx`:
  ```tsx
  interface CellHeadingProps {
    displayIndex: number;
    alias: string | null;
    status: 'idle' | 'running' | 'error';
    onRun: () => void;
  }

  const STATUS_GLYPH: Record<CellHeadingProps['status'], string> = {
    idle: '▣',
    running: '◐',
    error: '▲',
  };

  export function CellHeading({
    displayIndex,
    alias,
    status,
    onRun,
  }: CellHeadingProps): JSX.Element {
    return (
      <header className="flex h-9 items-center gap-3 border-b border-[--color-border] bg-[--color-bg-surface] px-3">
        <span className="font-mono text-xs text-[--color-fg-muted]">
          #{displayIndex}
        </span>
        <span className="text-sm font-semibold text-[--color-fg-base]">
          {alias ?? '(unnamed)'}
        </span>
        <span
          data-testid="cell-status"
          className="ml-auto inline-flex items-center gap-1 text-xs text-[--color-fg-muted]"
        >
          <span aria-hidden="true">{STATUS_GLYPH[status]}</span>
          <span>{status}</span>
        </span>
        <button
          type="button"
          data-testid="cell-run-button"
          aria-label="Run cell"
          onClick={onRun}
          className="rounded border border-[--color-border] px-2 py-0.5 text-xs text-[--color-fg-base] hover:bg-[--color-bg-overlay]"
        >
          Run
        </button>
      </header>
    );
  }
  ```

- [ ] **6.2** Create `frontend-v2/src/components/cell/CellView.tsx`:
  ```tsx
  import { useState } from 'react';
  import type { Cell, CellBlock, Diagnostic } from '../../services/parser/types';
  import { CellHeading } from './CellHeading';
  import { DiagnosticsStrip } from './DiagnosticsStrip';
  import { SqlBlockEditor } from './SqlBlockEditor';
  import { PlotBlockEditor } from './PlotBlockEditor';
  import { ProseBlock } from './ProseBlock';

  interface CellViewProps {
    cell: Cell;
    variables?: Record<string, string>;
    /** (blockIndex, nextSource) → update for the parent notebook */
    onChange: (blockIndex: number, nextSource: string) => void;
  }

  export function CellView({
    cell,
    variables,
    onChange,
  }: CellViewProps): JSX.Element {
    const [diagnosticsByBlock] = useState<Diagnostic[][]>(
      () => cell.blocks.map(() => []),
    );

    return (
      <article
        data-testid="cell-view"
        data-cell-alias={cell.alias ?? ''}
        className="mb-6 overflow-hidden rounded border border-[--color-border] bg-[--color-bg-base]"
      >
        <CellHeading
          displayIndex={cell.displayIndex}
          alias={cell.alias}
          status="idle"
          onRun={() => {
            /* stub — M-B3 implements execution */
          }}
        />
        <div className="flex flex-col">
          {cell.blocks.map((block, i) => (
            <div key={i} className="border-b border-[--color-border] last:border-b-0">
              {renderBlock(block, i, variables, onChange)}
              <DiagnosticsStrip diagnostics={diagnosticsByBlock[i] ?? []} />
            </div>
          ))}
        </div>
        <div
          data-testid="cell-results"
          className="border-t border-[--color-border] bg-[--color-bg-overlay] px-3 py-2 text-xs text-[--color-fg-muted]"
        >
          (no results yet — run to execute)
        </div>
      </article>
    );
  }

  function renderBlock(
    block: CellBlock,
    index: number,
    variables: Record<string, string> | undefined,
    onChange: (i: number, src: string) => void,
  ): JSX.Element {
    switch (block.kind) {
      case 'sql':
        return (
          <SqlBlockEditor
            value={block.source}
            variables={variables}
            onChange={(src) => onChange(index, src)}
          />
        );
      case 'plot':
        return (
          <PlotBlockEditor
            value={block.source}
            onChange={(src) => onChange(index, src)}
          />
        );
      case 'prose':
        return (
          <ProseBlock
            value={block.source}
            onChange={(src) => onChange(index, src)}
          />
        );
      case 'view':
      case 'macro':
        return (
          <ProseBlock
            value={block.source}
            onChange={(src) => onChange(index, src)}
          />
        );
    }
  }
  ```

- [ ] **6.3** Run CellView tests — they MUST pass:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && \
    npm run test -- cell/CellView 2>&1 | tail -10
  ```
  Expected:
  ```
  Test Files  1 passed (1)
       Tests  6 passed (6)
  ```

---

### Step 7 — Implement `NotebookView`, example notebook, and wire `App.tsx`

- [ ] **7.1** Create `frontend-v2/src/components/notebook/exampleNotebook.ts`:
  ```ts
  import type { Notebook } from '../../services/parser/types';

  export const EXAMPLE_NOTEBOOK: Notebook = {
    frontmatter: {
      version: '2.0',
      title: 'Example',
      variables: { eventType: "'cpu'" },
    },
    cells: [
      {
        displayIndex: 1,
        alias: 'events',
        frontmatter: {},
        blocks: [
          {
            kind: 'sql',
            source: 'select * from events where type = $eventType\n',
          },
        ],
      },
      {
        displayIndex: 2,
        alias: 'notes',
        frontmatter: {},
        blocks: [
          {
            kind: 'prose',
            source: 'Filter cpu samples and join with thread state.\n',
          },
        ],
      },
    ],
  };
  ```

- [ ] **7.2** Create `frontend-v2/src/components/notebook/NotebookView.tsx`:
  ```tsx
  import { useState } from 'react';
  import type { Notebook } from '../../services/parser/types';
  import { CellView } from '../cell/CellView';

  interface NotebookViewProps {
    initial: Notebook;
  }

  export function NotebookView({ initial }: NotebookViewProps): JSX.Element {
    const [notebook, setNotebook] = useState<Notebook>(initial);

    function patchBlock(
      cellIndex: number,
      blockIndex: number,
      nextSource: string,
    ): void {
      setNotebook((nb) => {
        const cells = nb.cells.slice();
        const cell = cells[cellIndex];
        const blocks = cell.blocks.slice();
        blocks[blockIndex] = { ...blocks[blockIndex], source: nextSource };
        cells[cellIndex] = { ...cell, blocks };
        return { ...nb, cells };
      });
    }

    const variables = notebook.frontmatter.variables as
      | Record<string, string>
      | undefined;

    if (notebook.cells.length === 0) {
      return (
        <div
          data-testid="notebook-empty"
          className="m-8 max-w-xl rounded border border-dashed border-[--color-border] p-6 text-center text-sm text-[--color-fg-muted]"
        >
          This notebook has no cells yet.
        </div>
      );
    }

    return (
      <div
        data-testid="notebook-view"
        className="mx-auto max-w-4xl p-6"
      >
        {notebook.cells.map((cell, i) => (
          <CellView
            key={`${cell.displayIndex}-${i}`}
            cell={cell}
            variables={variables}
            onChange={(blockIndex, nextSource) =>
              patchBlock(i, blockIndex, nextSource)
            }
          />
        ))}
      </div>
    );
  }
  ```

- [ ] **7.3** Replace `frontend-v2/src/App.tsx` with the M-B2 wiring (adds the
  "Open example" entry point on the welcome cell so Playwright can reach the
  editor):
  ```tsx
  import { useState } from 'react';
  import { AppShell } from './components/shell/AppShell';
  import { WelcomeCell } from './components/shell/WelcomeCell';
  import { NotebookView } from './components/notebook/NotebookView';
  import { EXAMPLE_NOTEBOOK } from './components/notebook/exampleNotebook';
  import type { Notebook } from './services/parser/types';

  export default function App(): JSX.Element {
    const [notebook, setNotebook] = useState<Notebook | null>(null);

    return (
      <AppShell>
        {notebook ? (
          <NotebookView initial={notebook} />
        ) : (
          <div className="flex flex-col items-start">
            <WelcomeCell />
            <button
              type="button"
              data-testid="open-example"
              onClick={() => setNotebook(EXAMPLE_NOTEBOOK)}
              className="ml-8 mt-2 rounded border border-[--color-border] bg-[--color-bg-surface] px-3 py-1 text-sm text-[--color-fg-base] hover:bg-[--color-bg-overlay]"
            >
              Open example notebook
            </button>
          </div>
        )}
      </AppShell>
    );
  }
  ```

- [ ] **7.4** Run NotebookView tests — they MUST pass:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && \
    npm run test -- notebook/NotebookView 2>&1 | tail -10
  ```
  Expected:
  ```
  Test Files  1 passed (1)
       Tests  3 passed (3)
  ```

- [ ] **7.5** Run the full cell+notebook suite together:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && \
    npm run test -- "(cell|notebook)" 2>&1 | tail -10
  ```
  Expected:
  ```
  Test Files  4 passed (4)
       Tests  16 passed (16)
  ```

- [ ] **7.6** Run the full unit suite to catch regressions in earlier
  milestones:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test 2>&1 | tail -5
  ```
  Expected: zero failures.

- [ ] **7.7** Typecheck:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run typecheck
  ```
  Expected: exits 0.

---

### Step 8 — Implement Playwright E2E tests (Testing Standard Layer 2)

- [ ] **8.1** Replace the first two `test.fixme` blocks in
  `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/e2e/02-vars-and-sigils.spec.ts`
  with implemented tests. The remaining `test.fixme` blocks (global `$$var`,
  live `$!brush`, and chart-dependent tests) stay as-is — they belong to
  later milestones. Final file content:
  ```typescript
  /**
   * E2E: Variables and sigils (M-B2 / M-E* live coupling)
   *
   * Covers: $x cell-scoped vars, $$x global vars, $!brush live vars,
   * var chip rendering in cell editor, var autocomplete, runtime injection.
   */
  import { test, expect } from '@playwright/test';

  test.describe('vars — cell-scoped $x', () => {
    test('$var renders as styled chip in SQL editor', async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('open-example').click();
      // The example notebook seeds a SQL cell already containing $eventType.
      const chip = page
        .locator('[data-testid="var-chip"][data-var-name="eventType"]')
        .first();
      await expect(chip).toBeVisible();
      // Pill background means non-default bg color is applied via .cm-var-chip class.
      await expect(chip).toHaveClass(/cm-var-chip/);
    });

    test('$var chip opens popover with value on click', async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('open-example').click();
      const chip = page
        .locator('[data-testid="var-chip"][data-var-name="eventType"]')
        .first();
      await chip.click();
      const popover = page.getByTestId('var-chip-popover');
      await expect(popover).toBeVisible();
      await expect(popover).toContainText('eventType');
      // Example notebook sets variables.eventType to the string "'cpu'".
      await expect(popover).toContainText(`'cpu'`);
    });
  });

  test.describe('vars — global $$x', () => {
    test.fixme('$$var appears in sidebar global vars panel', async ({ page }) => {
      await page.goto('/');
    });

    test.fixme('$$var value survives notebook reload', async ({ page }) => {
      await page.goto('/');
    });
  });

  test.describe('vars — live coupling $!brush', () => {
    test.fixme('brushing a chart updates $!brush live var', async ({ page }) => {
      await page.goto('/');
    });

    test.fixme('WHERE col IN $!brush filters downstream cell', async ({ page }) => {
      await page.goto('/');
    });

    test.fixme('$!alias.brush syntax wires to named producer', async ({ page }) => {
      await page.goto('/');
    });
  });

  test.describe('vars — a11y @a11y', () => {
    test.fixme('var chips are keyboard-focusable and announce value', async ({ page }) => {
      await page.goto('/');
    });
  });
  ```

- [ ] **8.2** Replace the first `test.fixme` block in
  `/Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/e2e/08-formatter.spec.ts`
  with the implemented `⌘S` test. Leave all other tests as `test.fixme` —
  they target features (`$ai_providers` scrub, plot-DSL reorder, history)
  that are out of M-B2 scope. Final file content:
  ```typescript
  /**
   * E2E: Formatter (M-A5 / M-B*)
   *
   * Covers: SQL auto-format on save, plot DSL key reorder, $ai_providers scrub,
   * idempotency (format twice = same result), interaction history.
   */
  import { test, expect } from '@playwright/test';

  test.describe('formatter — SQL', () => {
    test('SQL cell formats keywords to UPPERCASE on ⌘S', async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('open-example').click();

      // Locate the CM6 editor's content area inside the first sql-editor host.
      const editorHost = page.getByTestId('sql-editor').first();
      const cmContent = editorHost.locator('.cm-content');
      await cmContent.click();

      // Replace the seeded SQL with a lowercase statement, then format.
      await page.keyboard.press('Meta+A');
      await page.keyboard.type('select * from t');
      await page.keyboard.press('Meta+S');

      // Formatter from M-A5 uppercases reserved keywords.
      await expect(cmContent).toContainText('SELECT');
      await expect(cmContent).toContainText('FROM');
    });

    test.fixme('$var placeholders preserved through format', async ({ page }) => {
      await page.goto('/');
    });

    test.fixme('-- @ alias preserved on line 1 after format', async ({ page }) => {
      await page.goto('/');
    });
  });

  test.describe('formatter — plot DSL', () => {
    test.fixme('plot config keys reordered to canonical order on format', async ({ page }) => {
      await page.goto('/');
    });
  });

  test.describe('formatter — security scrub', () => {
    test.fixme('$ai_providers key stripped from frontmatter before save', async ({ page }) => {
      await page.goto('/');
    });
  });

  test.describe('formatter — interaction history', () => {
    test.fixme('⌥H opens interaction history panel', async ({ page }) => {
      await page.goto('/');
      await page.keyboard.press('Alt+h');
      await expect(page.getByRole('region', { name: /history/i })).toBeVisible();
    });

    test.fixme('format action appears in interaction history', async ({ page }) => {
      await page.goto('/');
    });
  });

  test.describe('formatter — a11y @a11y', () => {
    test.fixme('format operation announced to screen reader', async ({ page }) => {
      await page.goto('/');
    });
  });
  ```

- [ ] **8.3** Build the production bundle (Playwright `webServer` runs
  `npm run preview` against `dist/`):
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run build 2>&1 | tail -15
  ```
  Expected: `tsc -b` succeeds, `vite build` emits `dist/`, no errors. CM6
  packages must be bundled without warnings.

- [ ] **8.4** Run the M-B2 E2E specs plus smoke under `--project=dark`:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && \
    npx playwright test \
      tests/e2e/00-smoke.spec.ts \
      tests/e2e/01-shell-and-ingest.spec.ts \
      tests/e2e/02-vars-and-sigils.spec.ts \
      tests/e2e/08-formatter.spec.ts \
      --project=dark 2>&1 | tail -20
  ```
  Expected: smoke (10) + shell (6) + the 2 M-B2 var tests + the 1 M-B2
  formatter test = **19 passed**, plus `test.fixme` blocks reported as
  skipped. Zero failures.

- [ ] **8.5** Run the same set under `--project=light` for parity:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && \
    npx playwright test \
      tests/e2e/00-smoke.spec.ts \
      tests/e2e/01-shell-and-ingest.spec.ts \
      tests/e2e/02-vars-and-sigils.spec.ts \
      tests/e2e/08-formatter.spec.ts \
      --project=light 2>&1 | tail -10
  ```
  Expected: 19 passed.

---

### Step 9 — A11y sweep (Testing Standard Layer 4)

- [ ] **9.1** Run the existing smoke a11y test against the now-mounted
  cell-editor UI. The `@a11y` smoke checks the root page, which now includes
  the "Open example" button:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && \
    npx playwright test tests/e2e/00-smoke.spec.ts --grep @a11y --project=dark 2>&1 | tail -10
  ```
  Expected: no critical axe-core violations. If new violations appear (e.g.
  missing label, low-contrast token), fix the offending component at source
  before proceeding — do not suppress.

- [ ] **9.2** Run the a11y sweep across the full e2e tree to catch any
  inherited regression:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && \
    npx playwright test --grep @a11y --project=dark 2>&1 | tail -10
  ```
  Expected: all `@a11y`-tagged tests that are not `test.fixme` pass; remaining
  ones are skipped.

- [ ] **9.3** Verify keyboard reachability manually via a Playwright Tab walk
  (smoke test already covers focus visibility; this is a spot check). No
  automated assertion needed — visually confirm by running:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && \
    npx playwright test tests/e2e/00-smoke.spec.ts --project=dark --headed --reporter=line 2>&1 | tail -10
  ```
  Expected: still passes; the focus ring shows on every interactive element
  including the new `open-example` button and the `cell-run-button`.

---

### Step 10 — Full gate (Testing Standard layers 1, 2, 4) and commit

- [ ] **10.1** Vitest unit suite:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test 2>&1 | tail -5
  ```
  Expected: zero failures.

- [ ] **10.2** Typecheck:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run typecheck
  ```
  Expected: exits 0.

- [ ] **10.3** Lint:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run lint 2>&1 | tail -10
  ```
  Expected: zero errors. Fix at source — do not disable rules.

- [ ] **10.4** Build:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run build 2>&1 | tail -5
  ```
  Expected: succeeds.

- [ ] **10.5** Final Playwright gate — M-A* smoke + M-B1 shell + M-B2
  (`02` and `08`) under the dark project, the milestone's required gate:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && \
    npx playwright test \
      tests/e2e/00-smoke.spec.ts \
      tests/e2e/01-shell-and-ingest.spec.ts \
      tests/e2e/02-vars-and-sigils.spec.ts \
      tests/e2e/08-formatter.spec.ts \
      --project=dark 2>&1 | tail -10
  ```
  Expected: **19 tests pass**, zero failures. This is the M-B2 Playwright gate.

- [ ] **10.6** Show staged-able changes:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query && git status --short -- \
    frontend-v2/src \
    frontend-v2/tests/e2e/02-vars-and-sigils.spec.ts \
    frontend-v2/tests/e2e/08-formatter.spec.ts \
    frontend-v2/package.json \
    frontend-v2/package-lock.json \
    docs/superpowers/plans/2026-06-23-M-B2-cell-editor.md
  ```
  Expected: modified `App.tsx`, `package.json`, `package-lock.json`,
  `tokens.css`, both spec files; new files under
  `frontend-v2/src/components/cell/`, `frontend-v2/src/components/notebook/`,
  `frontend-v2/src/__tests__/cell/`, `frontend-v2/src/__tests__/notebook/`; the
  plan markdown as new.

- [ ] **10.7** Stage files explicitly (no `git add -A`):
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query && git add \
    frontend-v2/src/App.tsx \
    frontend-v2/src/styles/tokens.css \
    frontend-v2/src/components/cell/CellHeading.tsx \
    frontend-v2/src/components/cell/CellView.tsx \
    frontend-v2/src/components/cell/DiagnosticsStrip.tsx \
    frontend-v2/src/components/cell/PlotBlockEditor.tsx \
    frontend-v2/src/components/cell/ProseBlock.tsx \
    frontend-v2/src/components/cell/SqlBlockEditor.tsx \
    frontend-v2/src/components/cell/VarChip.tsx \
    frontend-v2/src/components/notebook/NotebookView.tsx \
    frontend-v2/src/components/notebook/exampleNotebook.ts \
    frontend-v2/src/__tests__/cell/CellView.test.tsx \
    frontend-v2/src/__tests__/cell/DiagnosticsStrip.test.tsx \
    frontend-v2/src/__tests__/cell/SqlBlockEditor.test.tsx \
    frontend-v2/src/__tests__/notebook/NotebookView.test.tsx \
    frontend-v2/tests/e2e/02-vars-and-sigils.spec.ts \
    frontend-v2/tests/e2e/08-formatter.spec.ts \
    frontend-v2/package.json \
    frontend-v2/package-lock.json \
    docs/superpowers/plans/2026-06-23-M-B2-cell-editor.md
  ```
  Verify:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query && git diff --cached --stat
  ```
  Expected: ~20 files staged.

- [ ] **10.8** Commit:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query && git commit -m "$(cat <<'EOF'
  feat(v2): M-B2 cell editor — CM6 SQL+plot editors, $var chips, diagnostics strip
  EOF
  )"
  ```
  Expected: a commit summary listing all staged files.

- [ ] **10.9** Verify the working tree is clean for M-B2 paths:
  ```bash
  cd /Users/i560383_1/code/experiments/jfr-query && git status --short -- \
    frontend-v2/src/components/cell \
    frontend-v2/src/components/notebook \
    frontend-v2/src/__tests__/cell \
    frontend-v2/src/__tests__/notebook \
    frontend-v2/tests/e2e/02-vars-and-sigils.spec.ts \
    frontend-v2/tests/e2e/08-formatter.spec.ts \
    docs/superpowers/plans/2026-06-23-M-B2-cell-editor.md
  ```
  Expected: no output.

---

## Done criteria

- [ ] CodeMirror 6 (`@codemirror/state` 6.5.2, `@codemirror/view` 6.36.4,
  `@codemirror/lang-sql` 6.8.0, `@codemirror/theme-one-dark` 6.1.2) is
  installed at exact versions.
- [ ] `CellHeading`, `CellView`, `DiagnosticsStrip`, `PlotBlockEditor`,
  `ProseBlock`, `SqlBlockEditor`, `VarChip` exist under
  `src/components/cell/`.
- [ ] `NotebookView` and `exampleNotebook` exist under `src/components/notebook/`.
- [ ] `App.tsx` mounts `<NotebookView>` when the user clicks
  `data-testid="open-example"`; otherwise still mounts `<WelcomeCell>`.
- [ ] SQL editor renders `$var` matches as `.cm-var-chip` mark decorations
  with `data-testid="var-chip"` and `data-var-name`.
- [ ] Clicking a chip opens `data-testid="var-chip-popover"` showing the
  value from `notebook.frontmatter.variables` (or `(unset)`).
- [ ] `Meta+S` inside a SQL editor calls `formatSql` and rewrites the doc.
- [ ] 16 Vitest tests pass under `npm run test -- "(cell|notebook)"`.
- [ ] 19 Playwright tests pass under
  `npx playwright test tests/e2e/00-smoke.spec.ts tests/e2e/01-shell-and-ingest.spec.ts tests/e2e/02-vars-and-sigils.spec.ts tests/e2e/08-formatter.spec.ts --project=dark`.
- [ ] `npx playwright test --grep @a11y --project=dark` reports zero critical
  axe-core violations.
- [ ] `npm run typecheck` exits 0; `npm run lint` exits 0; `npm run build` exits 0.
- [ ] Single git commit on the branch encapsulates the milestone.
