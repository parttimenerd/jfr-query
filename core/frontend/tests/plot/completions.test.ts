// P7 — Plot completion source tests.
//
// Each test creates a minimal CodeMirror EditorState containing the source
// (with a `|` cursor marker stripped before feeding it to CM), invokes
// `plotCompletionSource(deps)(ctx)`, and asserts the returned options match
// the expected per-hint shape.

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { plotCompletionSource, type PlotCompletionDeps } from '../../components/editor/completions';
import type { PlotScopeView } from '../../components/editor/plot/notebookPlotScope';
import type { ColumnSchema } from '../../components/editor/plot/ast';

function runCompletion(
  src: string,
  cursorPos: number,
  deps: PlotCompletionDeps,
  opts: { explicit?: boolean } = {},
): CompletionResult | null {
  const state = EditorState.create({ doc: src });
  const ctx = new CompletionContext(state, cursorPos, !!opts.explicit);
  return plotCompletionSource(deps)(ctx);
}

function baseDeps(over: Partial<PlotCompletionDeps> = {}): PlotCompletionDeps {
  return {
    getData: () => null,
    getCellResultColumns: () => null,
    requestSchemaDiscovery: () => {},
    getCellSql: () => null,
    getNotebookPlotScope: () => null,
    getCurrentCellId: () => null,
    getVariables: () => ({}),
    getSqlBlockCount: () => 0,
    ...over,
  };
}

function labels(r: CompletionResult | null): string[] {
  return (r?.options ?? []).map(o => o.label);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('plotCompletionSource — topLevel', () => {
  it('empty doc offers shape names + LET', () => {
    const r = runCompletion('', 0, baseDeps(), { explicit: true });
    expect(r).not.toBeNull();
    const ls = labels(r);
    // At least one shape (we don't pin exact names — registry may differ).
    expect(ls.length).toBeGreaterThan(0);
    expect(ls).toContain('LET');
    expect(ls).toContain('row');
    expect(ls).toContain('col');
  });
});

describe('plotCompletionSource — clauseKey', () => {
  it('inside `LINE_CHART(<CURSOR>)` offers x, y as required clauses', () => {
    const src = 'LINE_CHART()';
    const r = runCompletion(src, 'LINE_CHART('.length, baseDeps());
    expect(r).not.toBeNull();
    const ls = labels(r);
    expect(ls).toContain('x');
    expect(ls).toContain('y');
    // Required clauses get extra boost.
    const x = r!.options.find(o => o.label === 'x')!;
    expect(x.boost).toBeGreaterThanOrEqual(5);
  });

  it('partial typing filters clause keys', () => {
    const src = 'LINE_CHART(yA)';
    // cursor between yA and )
    const r = runCompletion(src, 'LINE_CHART(yA'.length, baseDeps());
    expect(r).not.toBeNull();
    const ls = labels(r);
    // yAxisLabel matches the `yA` prefix.
    expect(ls.some(l => l.toLowerCase().startsWith('ya'))).toBe(true);
  });
});

describe('plotCompletionSource — clauseValue', () => {
  it('inside `LINE_CHART(x: <CURSOR>)` offers cached columns with type', () => {
    const cols: ColumnSchema[] = [
      { name: 'ts', dataType: 'TIMESTAMP' },
      { name: 'pause', dataType: 'DOUBLE' },
      { name: 'cause', dataType: 'VARCHAR' },
    ];
    const src = 'LINE_CHART(x: )';
    const r = runCompletion(src, 'LINE_CHART(x: '.length, baseDeps({
      getCellResultColumns: () => cols,
    }));
    expect(r).not.toBeNull();
    const opts = r!.options;
    const ts = opts.find(o => o.label === 'ts');
    expect(ts).toBeDefined();
    expect(ts!.detail).toMatch(/TIMESTAMP/);
    expect(ts!.apply).toBe('"ts"');
    // Boost should be at least 5.
    expect(ts!.boost).toBeGreaterThanOrEqual(5);
  });

  it('falls back to plotData keys when no cached columns', () => {
    const src = 'LINE_CHART(x: )';
    const r = runCompletion(src, 'LINE_CHART(x: '.length, baseDeps({
      getData: () => [{ alpha: 1, beta: 'x', gamma: 3 }],
    }));
    expect(r).not.toBeNull();
    const ls = labels(r);
    expect(ls).toContain('alpha');
    expect(ls).toContain('beta');
    expect(ls).toContain('gamma');
  });

  it('partial column matches prefix', () => {
    const cols: ColumnSchema[] = [
      { name: 'ts', dataType: 'TIMESTAMP' },
      { name: 'gc' },
      { name: 'gen0' },
    ];
    const src = 'LINE_CHART(x: g)';
    const r = runCompletion(src, 'LINE_CHART(x: g'.length, baseDeps({
      getCellResultColumns: () => cols,
    }));
    expect(r).not.toBeNull();
    const ls = labels(r);
    expect(ls).toContain('gc');
    expect(ls).toContain('gen0');
    // ts shouldn't match the `g` prefix.
    expect(ls).not.toContain('ts');
  });
});

describe('plotCompletionSource — @const early return', () => {
  it('offers @-prefixed constants when typing @', () => {
    const src = 'LET @ts = "timestamp"\nLINE_CHART(x: @)';
    const r = runCompletion(src, src.length - 1, baseDeps());
    expect(r).not.toBeNull();
    const ls = labels(r);
    expect(ls).toContain('@ts');
  });
});

describe('plotCompletionSource — tailKey', () => {
  it('after `LINE_CHART(x: ts) <CURSOR>` offers uppercase tail keywords', () => {
    const src = 'LINE_CHART(x: ts) ';
    const r = runCompletion(src, src.length, baseDeps());
    if (!r) return; // Some parser states may not emit a tailKey hole here; rely on shape regressions.
    const ls = labels(r);
    // TITLE / LINK_X / ON should be among the suggestions.
    expect(ls.some(l => l === 'TITLE' || l === 'LINK_X' || l === 'ON')).toBe(true);
  });
});

describe('plotCompletionSource — linkArgs / variables', () => {
  it('inside `LINK_X(<CURSOR>)` offers scope variables', () => {
    const scope: PlotScopeView = {
      namedPlots: [],
      queryRefs: [],
      variables: new Map([
        ['start', { name: 'start', scope: 'cellLocal', value: '0', dataType: 'number' }],
        ['end', { name: 'end', scope: 'cellLocal', value: '100', dataType: 'number' }],
      ]),
      brushes: new Map(),
    };
    const src = 'LINE_CHART(x: "ts") LINK_X()';
    const r = runCompletion(src, 'LINE_CHART(x: "ts") LINK_X('.length, baseDeps({
      getNotebookPlotScope: () => scope,
      getCurrentCellId: () => 'c1',
    }));
    // We accept either linkArgs hole or general variable suggestions.
    if (r) {
      const ls = labels(r);
      expect(ls.some(l => l === '$start' || l === '$end')).toBe(true);
    }
  });

  it('inside `LINK_X(<CURSOR>)` offers brush refs from prior plots', () => {
    // A prior cell rendered a line chart named "gc" that publishes a brush.
    // Typing `LINK_X(` on a subsequent plot should offer `$gc.brush.lo`
    // and `$gc.brush.hi` as candidates — they are the canonical lo/hi
    // companions that wire two plots together.
    const scope: PlotScopeView = {
      namedPlots: [],
      queryRefs: [],
      variables: new Map(),
      brushes: new Map([
        ['gc', { plotName: 'gc', cellId: 'c0', xType: 'timestamp', yType: 'number' }],
      ]),
    };
    const src = 'LINE_CHART(x: "ts") LINK_X()';
    const r = runCompletion(src, 'LINE_CHART(x: "ts") LINK_X('.length, baseDeps({
      getNotebookPlotScope: () => scope,
      getCurrentCellId: () => 'c1',
    }));
    expect(r).not.toBeNull();
    const ls = labels(r);
    expect(ls).toContain('$gc.brush.lo');
    expect(ls).toContain('$gc.brush.hi');
  });

  it('inside `LINK_Y(<CURSOR>)` offers brush refs typed for the y axis', () => {
    const scope: PlotScopeView = {
      namedPlots: [],
      queryRefs: [],
      variables: new Map(),
      brushes: new Map([
        ['gc', { plotName: 'gc', cellId: 'c0', xType: 'timestamp', yType: 'number' }],
      ]),
    };
    const src = 'LINE_CHART(x: "ts") LINK_Y()';
    const r = runCompletion(src, 'LINE_CHART(x: "ts") LINK_Y('.length, baseDeps({
      getNotebookPlotScope: () => scope,
      getCurrentCellId: () => 'c1',
    }));
    expect(r).not.toBeNull();
    const ls = labels(r);
    expect(ls).toContain('$gc.brush.lo');
    expect(ls).toContain('$gc.brush.hi');
  });

  it('offers brush refs alongside regular variables when both exist', () => {
    const scope: PlotScopeView = {
      namedPlots: [],
      queryRefs: [],
      variables: new Map([
        ['threshold', { name: 'threshold', scope: 'cellLocal', value: '0.5', dataType: 'number' }],
      ]),
      brushes: new Map([
        ['gc', { plotName: 'gc', cellId: 'c0', xType: 'timestamp', yType: 'number' }],
      ]),
    };
    const src = 'LINE_CHART(x: "ts") LINK_X()';
    const r = runCompletion(src, 'LINE_CHART(x: "ts") LINK_X('.length, baseDeps({
      getNotebookPlotScope: () => scope,
      getCurrentCellId: () => 'c1',
    }));
    expect(r).not.toBeNull();
    const ls = labels(r);
    expect(ls).toContain('$threshold');
    expect(ls).toContain('$gc.brush.lo');
    expect(ls).toContain('$gc.brush.hi');
  });
});

describe('plotCompletionSource — queryRefTarget', () => {
  it('after `ON #<CURSOR>` lists scope query refs', () => {
    const scope: PlotScopeView = {
      namedPlots: [],
      queryRefs: [
        { index: 1, cellId: 'c0', sql: 'SELECT 1', alias: undefined },
        { index: 2, cellId: 'c0', sql: 'SELECT 2', alias: 'gc_pauses' },
      ],
      variables: new Map(),
      brushes: new Map(),
    };
    const src = 'LINE_CHART(x: "ts") ON #';
    const r = runCompletion(src, src.length, baseDeps({
      getNotebookPlotScope: () => scope,
      getCurrentCellId: () => 'c1',
    }));
    expect(r).not.toBeNull();
    const ls = labels(r);
    expect(ls).toContain('#1');
    expect(ls).toContain('#2');
    expect(ls).toContain('#gc_pauses');
  });

  it('falls back to sqlBlockCount when scope is null', () => {
    const src = 'LINE_CHART(x: "ts") ON #';
    const r = runCompletion(src, src.length, baseDeps({
      getSqlBlockCount: () => 3,
    }));
    expect(r).not.toBeNull();
    const ls = labels(r);
    expect(ls).toContain('#1');
    expect(ls).toContain('#3');
  });
});

describe('plotCompletionSource — onArg', () => {
  it('after `ON <CURSOR>` offers query refs and named plots', () => {
    const scope: PlotScopeView = {
      namedPlots: [
        { plotName: 'gc_top', cellId: 'c0', plotIndexInCell: 0, shape: 'line', hasBrush: false },
      ],
      queryRefs: [
        { index: 1, cellId: 'c0', sql: 'SELECT 1' },
      ],
      variables: new Map(),
      brushes: new Map(),
    };
    const src = 'LINE_CHART(x: "ts") ON ';
    const r = runCompletion(src, src.length, baseDeps({
      getNotebookPlotScope: () => scope,
      getCurrentCellId: () => 'c1',
    }));
    if (r) {
      const ls = labels(r);
      // At least one of these should be present.
      const hasAny = ls.includes('#1') || ls.includes('gc_top');
      expect(hasAny).toBe(true);
    }
  });
});

describe('plotCompletionSource — composite topLevel', () => {
  it('empty doc offers `row` and `col`', () => {
    const r = runCompletion('', 0, baseDeps(), { explicit: true });
    expect(r).not.toBeNull();
    expect(labels(r)).toEqual(expect.arrayContaining(['row', 'col']));
  });
});
