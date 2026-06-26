import { Diagnostic, linter, setDiagnostics, diagnosticCount } from '@codemirror/lint';
import { EditorView, Decoration, DecorationSet } from '@codemirror/view';
import { StateField, StateEffect, type Extension } from '@codemirror/state';
import { lintPlot, type PlotScopeView } from './plot/lint';
import type { ShapeRegistry } from './plot/annotators/shapeAnnotator';
import type { ColumnSchema } from './plot/ast';

export interface RunErrorSpec {
  message: string;
  /** 1-based line if the DB error message includes it; otherwise underline whole doc */
  line?: number;
  /** 1-based column if available */
  column?: number;
}

export const setRunError = StateEffect.define<RunErrorSpec | null>();

const runErrorField = StateField.define<RunErrorSpec | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setRunError)) return e.value;
    return value;
  },
});

/**
 * Resolve a RunErrorSpec to a doc range. Tries hard to land on the offending
 * token; falls back to the last non-empty line.
 */
function specToRange(spec: RunErrorSpec, doc: { length: number; lines: number; line: (n: number) => { from: number; to: number; length: number; text: string } }):
  { from: number; to: number } {
  if (spec.line && spec.line > 0 && spec.line <= doc.lines) {
    const ln = doc.line(spec.line);
    const col = Math.max(0, Math.min((spec.column ?? 1) - 1, ln.length));
    let from = ln.from + col;
    // Widen to the next whitespace/punctuation so the underline is visible.
    const tail = ln.text.slice(col);
    const m = tail.match(/^[\w$"\.]+/);
    const to = from + (m ? m[0].length : Math.min(8, ln.length - col || 1));
    return { from, to: Math.max(to, from + 1) };
  }
  // No line info: underline the last non-empty line.
  let n = doc.lines;
  while (n > 1 && doc.line(n).length === 0) n--;
  const last = doc.line(n);
  return { from: last.from, to: Math.max(last.to, last.from + 1) };
}

/**
 * Underline decoration applied directly from a StateField (no debounce).
 * This is what makes the squiggly visible immediately on error.
 */
const errorMark = Decoration.mark({ class: 'cm-jfr-error-underline' });

const errorDecoField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    // If the doc changed, drop any old decoration — wait for the next setRunError.
    if (tr.docChanged) value = Decoration.none;
    for (const e of tr.effects) {
      if (e.is(setRunError)) {
        if (!e.value) return Decoration.none;
        const { from, to } = specToRange(e.value, tr.state.doc as any);
        if (from < to && to <= tr.state.doc.length) {
          return Decoration.set([errorMark.range(from, to)]);
        }
        return Decoration.none;
      }
    }
    return value;
  },
  provide: f => EditorView.decorations.from(f),
});

/** Inline style for the underline (squiggly red). */
const errorTheme = EditorView.baseTheme({
  '.cm-jfr-error-underline': {
    textDecoration: 'underline wavy var(--cm-error-color, #f87171)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
});

/**
 * Imperative helper: set/clear the run-error AND immediately dispatch
 * matching lint diagnostics so the hover tooltip is available without
 * waiting on the lint debounce.
 */
export function pushRunError(view: EditorView, spec: RunErrorSpec | null) {
  // Update inline underline state first (single tick).
  view.dispatch({ effects: setRunError.of(spec) });
  // Then sync diagnostics so the hover tooltip + gutter marker show without debounce.
  if (spec) {
    const { from, to } = specToRange(spec, view.state.doc as any);
    const diag: Diagnostic = { from, to, severity: 'error', message: spec.message };
    view.dispatch(setDiagnostics(view.state, [diag]));
  } else if (diagnosticCount(view.state) > 0) {
    view.dispatch(setDiagnostics(view.state, []));
  }
}

export const diagnosticsExtension = [runErrorField, errorDecoField, errorTheme];

// ─── Plot DSL linter wiring ──────────────────────────────────────────────────
//
// P4: wraps the pure `lintPlot()` function as a CM6 `linter()` extension. The
// editor pushes this into the plot-mode extension list. Lookups (registry,
// columns, scope, sqlBlockCount, variables) are pulled lazily via the getters
// so the editor doesn't need to rebuild the extension when state changes.

export interface PlotLinterDeps {
  getShapeRegistry: () => ShapeRegistry;
  getCellColumns: () => ColumnSchema[] | null;
  getNotebookScope: () => PlotScopeView | null;
  getSqlBlockCount: () => number;
  getVariables: () => Record<string, string> | undefined;
}

export function plotLinter(deps: PlotLinterDeps): Extension {
  return linter((view) => {
    const source = view.state.doc.toString();
    if (!source.trim()) return [];
    try {
      return lintPlot(source, {
        shapeRegistry: deps.getShapeRegistry(),
        cellColumns: deps.getCellColumns(),
        notebookScope: deps.getNotebookScope(),
        sqlBlockCount: deps.getSqlBlockCount(),
        variables: deps.getVariables() ?? {},
      });
    } catch (err) {
      if ((import.meta as any).env?.DEV) console.warn('[plotLinter] failed:', err);
      return [];
    }
  }, { delay: 500 });
}
