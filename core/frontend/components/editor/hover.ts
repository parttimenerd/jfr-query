import { hoverTooltip, Tooltip } from '@codemirror/view';
import { EditorView } from '@codemirror/view';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { SchemaTooltipContent } from '../SchemaTooltipContent';
import { PlotTooltipContent } from '../PlotTooltipContent';
import { plotRegistry } from '../plots/plotRegistry';
import { normalizePlotName } from '../plots/plotNames';
import { plotClauseDocs } from '../../utils/plotClauseDocs';
import type { PlotParameter, PlotRegistration } from '../plots/plotTypes';
import type { SchemaForCompletion } from './completions';
import { parseAndAnnotate } from './plot';
import { findHoveredPlotNode } from './plot/hoverNode';
import type { ColumnSchema, PlotNode, ResolvedPlotSymbol } from './plot/ast';
import type { ShapeRegistry } from './plot/annotators/shapeAnnotator';
import { getHoverContent as getSqlHoverContent, type SqlHoverContent } from './sqlHover';

// ─── Plot scope view (P3 will expand this; minimal shape for hover) ──────────
// A minimal cross-cell scope projection consumed by the plot hover adapter.
// Sufficient for the `crossPlot` / `queryRef` variants of `PlotHoverContent`.
export interface PlotScopeView {
  /** Named plots in prior cells, referenceable in `ON name` / `LINK_X` master. */
  plots?: Array<{
    name: string;
    shape?: string;
    cellId?: string;
  }>;
  /** Prior SQL cells, referenceable by `#index` or `#viewName`. */
  queries?: Array<{
    index: number;
    name?: string;
    sql?: string;
    columns?: ColumnSchema[];
  }>;
}

// ─── PlotHoverContent — discriminated union, render-agnostic ─────────────────
export type PlotHoverContent =
  | { kind: 'shape'; name: string; description: string; requiredClauses: string[]; from: number; to: number }
  | {
      kind: 'clauseDef';
      clauseKey: string;
      shape: string;
      paramType: string;
      description?: string;
      required: boolean;
      options?: string[];
      from: number;
      to: number;
    }
  | { kind: 'column'; name: string; dataType?: string; clauseKey?: string; from: number; to: number }
  | { kind: 'constant'; name: string; valueText: string; from: number; to: number }
  | {
      kind: 'variable';
      name: string;
      raw: string;
      scope: 'cellLocal' | 'workspace' | 'crossCell' | 'gesture' | 'brush' | 'undefined';
      value?: string;
      dataType?: string;
      from: number;
      to: number;
    }
  | { kind: 'tail'; keyword: string; description: string; from: number; to: number }
  | { kind: 'crossPlot'; plotName: string; shape: string; cellId?: string; from: number; to: number }
  | {
      kind: 'queryRef';
      index: number;
      targetSql?: string;
      targetColumns?: ColumnSchema[];
      from: number;
      to: number;
    };

export interface PlotHoverDeps {
  schema: SchemaForCompletion | null;
  variables: Record<string, string>;
  shapeRegistry: ShapeRegistry;
  cellColumns: ColumnSchema[] | null;
  notebookScope: PlotScopeView | null;
}

// ─── Module-level cache (P1/W3 pattern) ──────────────────────────────────────
// Keyed on identity of (source, schema, variables, scope, registry, columns).
// Reset deterministically through `_resetPlotHoverCacheForTests`.
interface PlotHoverCacheEntry {
  src: string;
  schema: SchemaForCompletion | null;
  variables: Record<string, string>;
  shapeRegistry: ShapeRegistry;
  cellColumns: ColumnSchema[] | null;
  notebookScope: PlotScopeView | null;
  root: PlotNode;
}
let plotHoverCache: PlotHoverCacheEntry | null = null;

function getAnnotatedPlotRoot(source: string, deps: PlotHoverDeps): PlotNode {
  if (
    plotHoverCache &&
    plotHoverCache.src === source &&
    plotHoverCache.schema === deps.schema &&
    plotHoverCache.variables === deps.variables &&
    plotHoverCache.shapeRegistry === deps.shapeRegistry &&
    plotHoverCache.cellColumns === deps.cellColumns &&
    plotHoverCache.notebookScope === deps.notebookScope
  ) {
    return plotHoverCache.root;
  }
  const { root } = parseAndAnnotate({
    src: source,
    resultColumns: deps.cellColumns ?? undefined,
    shapeRegistry: deps.shapeRegistry,
  });
  plotHoverCache = { src: source, ...deps, root };
  return root;
}

export function _resetPlotHoverCacheForTests(): void {
  plotHoverCache = null;
}

// ─── Variable scope classification ───────────────────────────────────────────
type VariableScope = 'cellLocal' | 'workspace' | 'crossCell' | 'gesture' | 'brush' | 'undefined';

function classifyVariableScope(
  raw: string,
  parsed: ResolvedPlotSymbol & { kind: 'variable' },
  variables: Record<string, string>,
  notebookScope: PlotScopeView | null,
): { scope: VariableScope; value?: string; dataType?: string } {
  const p = parsed.parsed;
  // Brush gestures: $cell.brush(.lo|.hi)
  if (p.kind === 'crossCellRef' && p.path[0] === 'brush') {
    return { scope: 'brush', dataType: 'timestamp' };
  }
  // Other cross-cell refs (paths, tuple indices) → 'crossCell' / 'gesture'.
  if (p.kind === 'crossCellRef') {
    // We use 'crossCell' generically; tuple-index style is also 'crossCell'.
    const cellMatch = notebookScope?.plots?.find(pl => pl.name === p.name);
    if (cellMatch) {
      // Treat references that select a brush/gesture export of a known plot
      // as cross-cell — brush already handled above.
      return { scope: 'crossCell' };
    }
    return { scope: 'crossCell' };
  }
  // $$globals
  if (p.kind === 'doubleDollarRef') {
    const v = variables[raw];
    return { scope: 'workspace', value: v };
  }
  // Bare $foo — cell-local if defined in `variables`, else undefined.
  const v = variables[raw];
  if (v !== undefined) {
    return { scope: 'cellLocal', value: v };
  }
  return { scope: 'undefined' };
}

// ─── Pure adapter — testable, render-agnostic ────────────────────────────────
export function getPlotHoverContent(
  source: string,
  pos: number,
  deps: PlotHoverDeps,
): PlotHoverContent | null {
  const root = getAnnotatedPlotRoot(source, deps);
  const node = findHoveredPlotNode(root, pos);
  if (!node) return null;

  // 1. plotCall → shape
  if (node.kind === 'plotCall') {
    const r = node.annotations.resolves;
    if (r?.kind === 'plotShape') {
      const entry = deps.shapeRegistry[r.name];
      const description = entry?.description ?? r.description ?? '';
      // Restrict the hover span to the shape token itself so the tooltip
      // attaches over the shape keyword rather than the whole call.
      const tokenTo = Math.min(node.to, node.from + (node.shapeRaw?.length ?? r.name.length));
      return {
        kind: 'shape',
        name: r.name,
        description,
        requiredClauses: r.requiredClauses ?? [],
        from: node.from,
        to: tokenTo,
      };
    }
  }

  // 2. clauseRef → clauseDef
  if (node.kind === 'clauseRef') {
    const r = node.annotations.resolves;
    if (r?.kind === 'clauseDef') {
      return {
        kind: 'clauseDef',
        clauseKey: r.clauseKey,
        shape: r.shape,
        paramType: r.paramType,
        description: r.description,
        required: r.required,
        options: r.options,
        from: node.from,
        to: node.to,
      };
    }
  }

  // 3. ident → column (resolved by columnAnnotator) or cross-plot reference
  if (node.kind === 'ident') {
    const r = node.annotations.resolves;
    if (r?.kind === 'column') {
      // Find enclosing clause key if any.
      let clauseKey: string | undefined;
      let p = node.parent;
      while (p) {
        if (p.kind === 'clause' && p.key) { clauseKey = p.key; break; }
        if (p.kind === 'plotCall') break;
        p = p.parent;
      }
      return {
        kind: 'column',
        name: r.name,
        dataType: r.dataType,
        clauseKey,
        from: node.from,
        to: node.to,
      };
    }
    // Cross-plot reference (e.g. `ON gc_pauses`) — bare ident inside a tail
    // whose keyword is `on` / `link_x` / `link_scroll`.
    const tailKw = enclosingTailKeyword(node);
    if (tailKw && /^(on|link_x|link_scroll|link-x|link-scroll)$/i.test(tailKw)) {
      const match = deps.notebookScope?.plots?.find(pl => pl.name === node.name);
      if (match) {
        return {
          kind: 'crossPlot',
          plotName: match.name,
          shape: match.shape ?? 'unknown',
          cellId: match.cellId,
          from: node.from,
          to: node.to,
        };
      }
    }
  }

  // 4. constRef → constant
  if (node.kind === 'constRef') {
    const r = node.annotations.resolves;
    if (r?.kind === 'constant') {
      return {
        kind: 'constant',
        name: r.name,
        valueText: r.valueText,
        from: node.from,
        to: node.to,
      };
    }
  }

  // 5. varRef → variable
  if (node.kind === 'varRef' && node.dollar) {
    const r = node.annotations.resolves;
    if (r?.kind === 'variable') {
      const classified = classifyVariableScope(node.dollar.raw, r, deps.variables, deps.notebookScope);
      return {
        kind: 'variable',
        name: r.parsed.name,
        raw: r.parsed.raw,
        scope: classified.scope,
        value: classified.value,
        dataType: classified.dataType ?? (r as any).dataType,
        from: node.from,
        to: node.to,
      };
    }
  }

  // 6. tailRef → tail keyword
  if (node.kind === 'tailRef') {
    const keyword = (node.keyRaw ?? node.key ?? '').toUpperCase();
    const doc = plotClauseDocs[keyword];
    if (doc) {
      return {
        kind: 'tail',
        keyword,
        description: doc.description,
        from: node.from,
        to: node.to,
      };
    }
    return null;
  }

  // 7. queryRef
  if (node.kind === 'queryRef') {
    const idx = node.queryIndex;
    if (typeof idx === 'number') {
      const match = deps.notebookScope?.queries?.find(q => q.index === idx);
      return {
        kind: 'queryRef',
        index: idx,
        targetSql: match?.sql,
        targetColumns: match?.columns,
        from: node.from,
        to: node.to,
      };
    }
  }

  return null;
}

function enclosingTailKeyword(node: PlotNode): string | undefined {
  let n: PlotNode | undefined = node.parent;
  while (n) {
    if (n.kind === 'tail') return (n.keyRaw ?? n.key ?? '');
    if (n.kind === 'plotCall' || n.kind === 'script') return undefined;
    n = n.parent;
  }
  return undefined;
}

// ─── DOM rendering ───────────────────────────────────────────────────────────
export interface HoverDeps {
  mode: 'sql' | 'plot' | 'markdown';
  getSchema: () => SchemaForCompletion | null;
  getVariables: () => Record<string, string> | undefined;
  getShapeRegistry?: () => Record<string, PlotRegistration<any>>;
  getCellColumns?: () => ColumnSchema[] | null;
  getNotebookScope?: () => PlotScopeView | null;
}

function mountReactTooltip(content: React.ReactNode): { dom: HTMLElement; destroy: () => void } {
  const dom = document.createElement('div');
  dom.className = 'cm-jfr-tooltip';
  const root: Root = createRoot(dom);
  root.render(content as any);
  return {
    dom,
    destroy: () => {
      root.unmount();
    },
  };
}

function readTokenAt(view: EditorView, pos: number): { text: string; from: number; to: number } | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  const ch = pos - line.from;
  if (ch < 0 || ch > text.length) return null;
  let start = ch;
  let end = ch;
  const isWordOrPunct = (c: string) => /[\w$@]/.test(c);
  while (start > 0 && isWordOrPunct(text[start - 1])) start--;
  while (end < text.length && isWordOrPunct(text[end])) end++;
  if (start === end) return null;
  return { text: text.slice(start, end), from: line.from + start, to: line.from + end };
}

// Build a registry suitable for the plot annotators from the user-facing
// `PlotRegistration` map. Kept in this module because the plot hover adapter
// expects the annotator-shaped registry.
function adaptShapeRegistry(reg: Record<string, PlotRegistration<any>>): ShapeRegistry {
  const out: ShapeRegistry = {};
  for (const [k, v] of Object.entries(reg)) {
    const requiredClauses = v.params.filter(p => p.required).map(p => p.name.toLowerCase());
    const validClauses = v.params.map(p => p.name.toLowerCase());
    const columnClauses = v.params
      .filter(p => /column/.test(p.type))
      .map(p => p.name.toLowerCase());
    out[k.toLowerCase()] = {
      name: k.toLowerCase(),
      validClauses,
      columnClauses,
      requiredClauses,
      description: v.description,
      clauseDefs: v.params.map(p => ({
        key: p.name.toLowerCase(),
        paramType: p.type,
        required: !!p.required,
        options: p.options,
        description: p.description,
      })),
    };
  }
  return out;
}

function renderSqlHoverContent(
  c: SqlHoverContent,
  schema: SchemaForCompletion,
): React.ReactNode | null {
  if (c.kind === 'table') {
    const tbl = schema.tableMap?.get(c.name.toLowerCase());
    if (tbl) return React.createElement(SchemaTooltipContent, { item: tbl, type: 'table' });
    return React.createElement(
      'div',
      { className: 'p-2 space-y-1' },
      React.createElement('div', { className: 'font-mono text-cyan-300 font-semibold' }, c.name),
      c.rowCount !== undefined
        ? React.createElement('div', { className: 'text-xs text-gray-400' }, `${c.rowCount} rows`)
        : null,
    );
  }
  if (c.kind === 'view') {
    const vw = schema.viewMap?.get(c.name.toLowerCase());
    if (vw) return React.createElement(SchemaTooltipContent, { item: vw, type: 'view' });
    return null;
  }
  if (c.kind === 'cte') {
    return React.createElement(
      'div',
      { className: 'p-2 space-y-1' },
      React.createElement(
        'div',
        { className: 'flex items-center gap-2' },
        React.createElement('span', { className: 'font-mono text-emerald-300 font-semibold' }, c.name),
        React.createElement(
          'span',
          { className: 'text-[10px] px-1.5 py-0.5 rounded bg-emerald-700/60 text-emerald-200' },
          'CTE',
        ),
      ),
    );
  }
  if (c.kind === 'column') {
    return React.createElement(
      'div',
      { className: 'p-2 space-y-1' },
      React.createElement(
        'div',
        { className: 'flex items-center gap-2' },
        React.createElement('span', { className: 'font-mono text-cyan-300 font-semibold' }, c.name),
        React.createElement('span', { className: 'text-xs text-gray-400' }, c.dataType),
      ),
      React.createElement(
        'div',
        { className: 'text-xs text-gray-400' },
        React.createElement('span', { className: 'text-gray-500' }, 'from: '),
        React.createElement('span', { className: 'font-mono text-gray-300' }, c.table),
      ),
    );
  }
  if (c.kind === 'function') {
    return React.createElement(
      'div',
      { className: 'p-2 space-y-1' },
      React.createElement('div', { className: 'font-mono text-purple-300 font-semibold' }, c.name + '()'),
      React.createElement('div', { className: 'text-xs text-gray-300 font-mono' }, c.signature),
    );
  }
  if (c.kind === 'variable') {
    return React.createElement(
      'div',
      { className: 'p-2 space-y-1' },
      React.createElement(
        'div',
        { className: 'flex items-center gap-2' },
        React.createElement('span', { className: 'font-mono text-cyan-300 font-semibold text-sm' }, c.name),
        React.createElement(
          'span',
          {
            className: `text-[10px] px-1.5 py-0.5 rounded font-medium ${
              c.source === 'workspace'
                ? 'bg-purple-700/60 text-purple-200'
                : c.source === 'gesture'
                  ? 'bg-amber-700/60 text-amber-200'
                  : 'bg-cyan-800/60 text-cyan-200'
            }`,
          },
          c.source ?? 'undefined',
        ),
      ),
      c.value !== undefined
        ? React.createElement(
            'div',
            { className: 'text-xs text-gray-300' },
            React.createElement('span', { className: 'text-gray-500' }, 'value: '),
            React.createElement('span', { className: 'font-mono text-yellow-300' }, String(c.value)),
          )
        : React.createElement('div', { className: 'text-xs text-yellow-500 italic' }, 'undefined'),
    );
  }
  if (c.kind === 'alias') {
    return React.createElement(
      'div',
      { className: 'p-2 space-y-1' },
      React.createElement(
        'div',
        { className: 'flex items-center gap-2' },
        React.createElement('span', { className: 'font-mono text-cyan-300 font-semibold' }, c.alias),
        React.createElement('span', { className: 'text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-300' }, 'alias'),
      ),
      React.createElement(
        'div',
        { className: 'text-xs text-gray-400' },
        React.createElement('span', { className: 'text-gray-500' }, '→ '),
        React.createElement('span', { className: 'font-mono text-gray-200' }, c.target),
      ),
    );
  }
  return null;
}

function renderPlotHoverContent(c: PlotHoverContent): React.ReactNode | null {
  if (c.kind === 'shape') {
    const plot = plotRegistry[normalizePlotName(c.name)] ?? Object.values(plotRegistry).find(p => p.name.toLowerCase() === c.name.toLowerCase());
    if (plot) {
      return React.createElement(PlotTooltipContent, { item: plot, type: 'function' });
    }
    return null;
  }
  if (c.kind === 'clauseDef') {
    // Synthesize a `parameter`-shaped descriptor reusing PlotTooltipContent.
    const plot = Object.values(plotRegistry).find(p => p.name.toLowerCase() === c.shape.toLowerCase());
    const param: PlotParameter | undefined = plot?.params.find(p => p.name.toLowerCase() === c.clauseKey.toLowerCase());
    if (param) {
      const item = { name: c.clauseKey, definitions: [{ funcName: c.shape, param }] };
      return React.createElement(PlotTooltipContent, { item, type: 'parameter' });
    }
    // Fallback inline render — minimal but informative.
    return React.createElement(
      'div',
      { className: 'p-2 text-sm space-y-1' },
      React.createElement('div', { className: 'font-mono text-purple-300' }, c.clauseKey),
      React.createElement('div', { className: 'text-xs text-gray-400' }, `${c.paramType}${c.required ? ' (required)' : ''}`),
      c.description ? React.createElement('div', { className: 'text-xs text-gray-300 italic' }, c.description) : null,
    );
  }
  if (c.kind === 'tail') {
    const doc = plotClauseDocs[c.keyword.toUpperCase()];
    if (doc) return React.createElement(PlotTooltipContent, { item: doc, type: 'clause' });
    return null;
  }
  if (c.kind === 'column') {
    return React.createElement(
      'div',
      { className: 'p-2 text-sm space-y-1' },
      React.createElement('div', { className: 'font-mono text-cyan-300 font-semibold' }, c.name),
      c.dataType ? React.createElement('div', { className: 'text-xs text-yellow-300' }, c.dataType) : null,
      c.clauseKey ? React.createElement('div', { className: 'text-[10px] text-gray-400' }, `column for clause "${c.clauseKey}"`) : null,
    );
  }
  if (c.kind === 'constant') {
    return React.createElement(
      'div',
      { className: 'p-2 text-sm space-y-1' },
      React.createElement('div', { className: 'font-mono text-purple-300 font-semibold' }, `@${c.name}`),
      React.createElement(
        'div',
        { className: 'text-xs text-gray-300' },
        React.createElement('span', { className: 'text-gray-500' }, 'value: '),
        React.createElement('span', { className: 'font-mono text-yellow-300' }, c.valueText),
      ),
    );
  }
  if (c.kind === 'variable') {
    const isWorkspace = c.scope === 'workspace';
    const badge = c.scope;
    return React.createElement(
      'div',
      { className: 'p-2 space-y-1' },
      React.createElement(
        'div',
        { className: 'flex items-center gap-2' },
        React.createElement('span', { className: 'font-mono text-cyan-300 font-semibold text-sm' }, c.raw),
        React.createElement(
          'span',
          {
            className: `text-[10px] px-1.5 py-0.5 rounded font-medium ${isWorkspace ? 'bg-purple-700/60 text-purple-200' : 'bg-cyan-800/60 text-cyan-200'}`,
          },
          badge,
        ),
      ),
      c.value !== undefined
        ? React.createElement(
            'div',
            { className: 'text-xs text-gray-300' },
            React.createElement('span', { className: 'text-gray-500' }, 'value: '),
            React.createElement('span', { className: 'font-mono text-yellow-300' }, String(c.value)),
          )
        : React.createElement(
            'div',
            { className: 'text-xs text-yellow-500 italic' },
            c.scope === 'undefined' ? 'undefined — click to define' : `[${c.scope}]`,
          ),
      c.dataType ? React.createElement('div', { className: 'text-[10px] text-gray-400' }, `type: ${c.dataType}`) : null,
    );
  }
  if (c.kind === 'crossPlot') {
    return React.createElement(
      'div',
      { className: 'p-2 text-sm space-y-1' },
      React.createElement('div', { className: 'font-mono text-cyan-300 font-semibold' }, c.plotName),
      React.createElement('div', { className: 'text-xs text-gray-400' }, `shape: ${c.shape}`),
      c.cellId ? React.createElement('div', { className: 'text-[10px] text-gray-500' }, `cell: ${c.cellId}`) : null,
    );
  }
  if (c.kind === 'queryRef') {
    return React.createElement(
      'div',
      { className: 'p-2 text-sm space-y-1' },
      React.createElement('div', { className: 'font-mono text-cyan-300 font-semibold' }, `#${c.index}`),
      c.targetColumns && c.targetColumns.length > 0
        ? React.createElement(
            'div',
            { className: 'text-xs text-gray-300' },
            c.targetColumns.slice(0, 8).map(col => col.name).join(', '),
          )
        : null,
    );
  }
  return null;
}

export function buildHoverTooltip(deps: HoverDeps) {
  return hoverTooltip((view, pos, _side): Tooltip | null => {
    const variables = deps.getVariables() || {};

    if (deps.mode === 'plot') {
      const source = view.state.doc.toString();
      const rawRegistry = deps.getShapeRegistry?.() ?? plotRegistry;
      const adapted = adaptShapeRegistry(rawRegistry);
      const content = getPlotHoverContent(source, pos, {
        schema: deps.getSchema(),
        variables,
        shapeRegistry: adapted,
        cellColumns: deps.getCellColumns?.() ?? null,
        notebookScope: deps.getNotebookScope?.() ?? null,
      });
      if (!content) return null;
      const dom = renderPlotHoverContent(content);
      if (!dom) return null;
      return { pos: content.from, end: content.to, above: true, create: () => mountReactTooltip(dom) };
    }

    // SQL / markdown — fall back to the legacy token-based logic.
    const token = readTokenAt(view, pos);
    if (!token || !token.text.trim()) return null;
    const word = token.text;
    const schema = deps.getSchema();

    // Variable hover (works in SQL + markdown).
    if (/^\$\$?\w+$/.test(word)) {
      const isGlobal = word.startsWith('$$');
      const value = variables[word];
      const defined = value !== undefined;
      const content = React.createElement(
        'div',
        { className: 'p-2 space-y-1' },
        React.createElement(
          'div',
          { className: 'flex items-center gap-2' },
          React.createElement('span', { className: 'font-mono text-cyan-300 font-semibold text-sm' }, word),
          React.createElement(
            'span',
            {
              className: `text-[10px] px-1.5 py-0.5 rounded font-medium ${isGlobal ? 'bg-purple-700/60 text-purple-200' : 'bg-cyan-800/60 text-cyan-200'}`,
            },
            isGlobal ? 'notebook' : 'cell-local',
          ),
        ),
        defined
          ? React.createElement(
              'div',
              { className: 'text-xs text-gray-300' },
              React.createElement('span', { className: 'text-gray-500' }, 'value: '),
              React.createElement('span', { className: 'font-mono text-yellow-300' }, String(value)),
            )
          : React.createElement('div', { className: 'text-xs text-yellow-500 italic' }, 'undefined — click to define'),
      );
      return { pos: token.from, end: token.to, above: true, create: () => mountReactTooltip(content) };
    }

    if (deps.mode === 'sql' && schema) {
      // AST-driven hover: resolves columns, functions, aliases, CTEs, and
      // variables. Falls through to the legacy token-based table/view/macro
      // branch below if the adapter doesn't pin anything.
      const source = view.state.doc.toString();
      const ast = getSqlHoverContent(source, pos, {
        schema,
        variables,
      });
      if (ast) {
        const dom = renderSqlHoverContent(ast, schema);
        if (dom) {
          return { pos: ast.from, end: ast.to, above: true, create: () => mountReactTooltip(dom) };
        }
      }

      const clean = word.toLowerCase().replace(/["']/g, '');
      const tbl = schema.tableMap?.get(clean);
      const vw = schema.viewMap?.get(clean);
      const macroMap = new Map(schema.macros.map(m => [m.name.toLowerCase(), m]));
      const macro = macroMap.get(clean);
      if (tbl) {
        const content = React.createElement(SchemaTooltipContent, { item: tbl, type: 'table' });
        return { pos: token.from, end: token.to, above: true, create: () => mountReactTooltip(content) };
      }
      if (vw) {
        const content = React.createElement(SchemaTooltipContent, { item: vw, type: 'view' });
        return { pos: token.from, end: token.to, above: true, create: () => mountReactTooltip(content) };
      }
      if (macro) {
        const content = React.createElement(SchemaTooltipContent, { item: macro, type: 'macro' });
        return { pos: token.from, end: token.to, above: true, create: () => mountReactTooltip(content) };
      }
    }

    return null;
  });
}
