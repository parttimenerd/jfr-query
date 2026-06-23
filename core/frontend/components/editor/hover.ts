import { hoverTooltip, Tooltip } from '@codemirror/view';
import { EditorView } from '@codemirror/view';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { SchemaTooltipContent } from '../SchemaTooltipContent';
import { PlotTooltipContent } from '../PlotTooltipContent';
import { plotRegistry } from '../plots/plotRegistry';
import { plotClauseDocs } from '../../utils/plotClauseDocs';
import type { PlotParameter } from '../plots/plotTypes';
import type { SchemaForCompletion } from './completions';

export interface HoverDeps {
  mode: 'sql' | 'plot' | 'markdown';
  getSchema: () => SchemaForCompletion | null;
  getVariables: () => Record<string, string> | undefined;
}

function mountReactTooltip(content: React.ReactNode): { dom: HTMLElement; destroy: () => void } {
  const dom = document.createElement('div');
  dom.className = 'cm-jfr-tooltip';
  const root: Root = createRoot(dom);
  root.render(content as any);
  return {
    dom,
    destroy: () => {
      // unmount on the next microtask so React isn't in the middle of a commit
      Promise.resolve().then(() => root.unmount());
    },
  };
}

function readTokenAt(view: EditorView, pos: number): { text: string; from: number; to: number } | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  const ch = pos - line.from;
  if (ch < 0 || ch > text.length) return null;
  // expand to surrounding word chars (and $, @, ", quoted-string contents)
  let start = ch;
  let end = ch;
  const isWordOrPunct = (c: string) => /[\w$@]/.test(c);
  while (start > 0 && isWordOrPunct(text[start - 1])) start--;
  while (end < text.length && isWordOrPunct(text[end])) end++;
  if (start === end) return null;
  return { text: text.slice(start, end), from: line.from + start, to: line.from + end };
}

export function buildHoverTooltip(deps: HoverDeps) {
  return hoverTooltip((view, pos, side): Tooltip | null => {
    const token = readTokenAt(view, pos);
    if (!token || !token.text.trim()) return null;
    const word = token.text;
    const variables = deps.getVariables() || {};
    const schema = deps.getSchema();

    // Variable hover
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

    if (deps.mode === 'plot') {
      const upper = word.toUpperCase();
      const plotDef = plotRegistry[upper];
      if (plotDef) {
        const content = React.createElement(PlotTooltipContent, { item: plotDef, type: 'function' });
        return { pos: token.from, end: token.to, above: true, create: () => mountReactTooltip(content) };
      }
      // parameter name?
      const definitions = Object.values(plotRegistry)
        .map(plot => ({ funcName: plot.name, param: plot.params.find(p => p.name === word) }))
        .filter(d => d.param) as { funcName: string; param: PlotParameter }[];
      if (definitions.length > 0) {
        const content = React.createElement(PlotTooltipContent, {
          item: { name: word, definitions },
          type: 'parameter',
        });
        return { pos: token.from, end: token.to, above: true, create: () => mountReactTooltip(content) };
      }
      const clauseDoc = plotClauseDocs[upper];
      if (clauseDoc) {
        const content = React.createElement(PlotTooltipContent, { item: clauseDoc, type: 'clause' });
        return { pos: token.from, end: token.to, above: true, create: () => mountReactTooltip(content) };
      }
    }
    return null;
  });
}
