import React, { useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { EditorState, Compartment, Extension, Annotation } from '@codemirror/state';
import { EditorView, keymap, drawSelection, dropCursor, highlightActiveLine, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, selectAll } from '@codemirror/commands';
import { autocompletion, completionKeymap, startCompletion } from '@codemirror/autocomplete';
import { searchKeymap } from '@codemirror/search';
import { editorHighlight, editorTheme } from './theme';
import { buildPlotLanguage, buildSqlLanguage, markdownLanguage } from './languages';
import { plotCompletionSource, type SchemaForCompletion } from './completions';
import { dispatchCompletion } from './sql/completion/dispatcher';
import { setVariableSpec, variableExtension } from './variables';
import { buildHoverTooltip } from './hover';
import { diagnosticsExtension, plotLinter, pushRunError, type RunErrorSpec } from './diagnostics';
import { plotRegistry } from '../plots/plotRegistry';
import { aiGhostTextExtension } from './aiGhostText';
import { aiAutocompleteExtension } from './aiAutocomplete';
import {
    aiPlotAutocompleteExtension,
    type AiPlotSourceDeps,
    type PlotAutocompleteSettings,
} from './plot/aiPlotSource';
import type { AutocompleteSettings } from './aiAutocomplete';
import type { PlotScopePlot } from './plot/aiPlotContext';
import type { PlotScopeView } from './plot/notebookPlotScope';
import { markdownTemplatingExtension } from './markdownTemplating';
import type { AliasInfo } from '../../context/CellAliasContext';

// Annotation used to mark programmatic value-sync dispatches so the
// updateListener does not echo them back to React via onChange.
const programmaticChange = Annotation.define<boolean>();
import type { ResultColumn } from './aiAutocomplete/contextBuilder';
import type { StreamFn } from './aiAutocomplete';

export type EditorMode = 'sql' | 'markdown' | 'plot';

export interface EditorHandle {
  view: EditorView | null;
  setError: (err: RunErrorSpec | null) => void;
  focus: () => void;
}

export interface EditorProps {
  value: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  onRun?: () => void;
  mode: EditorMode;
  readOnly?: boolean;
  autoFocus?: boolean;
  fullHeight?: boolean;
  schema?: SchemaForCompletion | null;
  variables?: Record<string, string>;
  onVariableClick?: (name: string) => void;
  plotData?: any[] | null;
  error?: RunErrorSpec | null;
  /** Optional: runs `SELECT DISTINCT col FROM tbl LIMIT 50` on demand. */
  runQuery?: ((sql: string) => Promise<any[]>) | null;
  /** Optional: semantic completion reranker (MiniLM). */
  rankCandidates?: ((queryContext: string, candidates: string[]) => Promise<string[]>) | null;
  isRankerReady?: (() => boolean) | null;
  /**
   * P5 — plot-mode AI ghost-text. When `plotAiAutocompleteSettings.plotAiAutocompleteEnabled`
   * is true and a `plotAiAutocompleteStream` is provided, the editor pushes the
   * streaming orchestrator. All five getters are optional — when omitted they
   * return empty defaults and the prompt simply omits that section.
   */
  plotAiAutocompleteSettings?: PlotAutocompleteSettings | null;
  plotAiAutocompleteStream?: StreamFn | null;
  getPlotPriorCellsContent?: (() => string[]) | null;
  getPlotCellResultSchema?: (() => ResultColumn[] | null) | null;
  getPlotScope?: (() => PlotScopePlot[]) | null;
  /**
   * P2 — plot DSL companion-SQL schema discovery. When provided in plot
   * mode, the plot completion source consults `getPlotCellResultColumns()`
   * for typed columns and calls `requestPlotSchemaDiscovery(sql)` on a
   * cache miss.
   */
  getPlotCellSql?: (() => string | null) | null;
  getPlotCellResultColumns?: (() => import('./plot/ast').ColumnSchema[] | null) | null;
  requestPlotSchemaDiscovery?: ((sql: string) => void) | null;
  /**
   * P7 — Notebook-wide plot scope view (named plots, query refs, vars, brushes)
   * used by the plot DSL completion source. Optional: when absent, the
   * completion source falls back to local-only completions.
   */
  getNotebookPlotScope?: (() => PlotScopeView | null) | null;
  getCurrentCellId?: (() => string | null) | null;
  getSqlBlockCount?: (() => number) | null;
  /**
   * Markdown-mode templating support: provides the current cell-alias snapshot
   * so completion inside `${…}` / `{if …}` regions can offer alias names.
   */
  getCellAliases?: (() => Record<string, AliasInfo>) | null;
  /**
   * SQL-mode AI ghost-text settings and stream. When `sqlAiAutocompleteSettings`
   * is provided and `aiAutocompleteEnabled` is true, the SQL editor shows
   * ghost-text completions from the configured model.
   */
  sqlAiAutocompleteSettings?: AutocompleteSettings | null;
  sqlAiAutocompleteStream?: StreamFn | null;
  /** B-075: called when the plot AI context builder trims prior-cell content to fit the token budget. */
  onPlotContextTrimmed?: ((trimmed: boolean) => void) | null;
}

export const Editor = React.forwardRef<EditorHandle, EditorProps>(function Editor(props, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Refs hold the latest callbacks/state so extensions can read them
  // without being recreated on every render.
  const onChangeRef = useRef(props.onChange);
  const onBlurRef = useRef(props.onBlur);
  const onRunRef = useRef(props.onRun);
  const schemaRef = useRef(props.schema ?? null);
  const variablesRef = useRef(props.variables);
  const plotDataRef = useRef(props.plotData ?? null);
  const runQueryRef = useRef(props.runQuery ?? null);
  const rankCandidatesRef = useRef(props.rankCandidates ?? null);
  const isRankerReadyRef = useRef(props.isRankerReady ?? null);
  // P5 — plot AI ghost-text refs
  const plotAiSettingsRef = useRef(props.plotAiAutocompleteSettings ?? null);
  const plotAiStreamRef = useRef(props.plotAiAutocompleteStream ?? null);
  const getPlotPriorCellsContentRef = useRef(props.getPlotPriorCellsContent ?? null);
  const getPlotCellResultSchemaRef = useRef(props.getPlotCellResultSchema ?? null);
  const getPlotScopeRef = useRef(props.getPlotScope ?? null);
  // P2 — schema discovery refs
  const getPlotCellSqlRef = useRef(props.getPlotCellSql ?? null);
  const getPlotCellResultColumnsRef = useRef(props.getPlotCellResultColumns ?? null);
  const requestPlotSchemaDiscoveryRef = useRef(props.requestPlotSchemaDiscovery ?? null);
  // P7 — notebook plot scope refs.
  const getNotebookPlotScopeRef = useRef(props.getNotebookPlotScope ?? null);
  const getCurrentCellIdRef = useRef(props.getCurrentCellId ?? null);
  const getSqlBlockCountRef = useRef(props.getSqlBlockCount ?? null);
  const getCellAliasesRef = useRef(props.getCellAliases ?? null);
  // SQL AI ghost-text refs
  const sqlAiSettingsRef = useRef(props.sqlAiAutocompleteSettings ?? null);
  const sqlAiStreamRef = useRef(props.sqlAiAutocompleteStream ?? null);
  // B-075: plot context trimmed callback ref
  const onPlotContextTrimmedRef = useRef(props.onPlotContextTrimmed ?? null);

  onChangeRef.current = props.onChange;
  onBlurRef.current = props.onBlur;
  onRunRef.current = props.onRun;
  schemaRef.current = props.schema ?? null;
  variablesRef.current = props.variables;
  plotDataRef.current = props.plotData ?? null;
  runQueryRef.current = props.runQuery ?? null;
  rankCandidatesRef.current = props.rankCandidates ?? null;
  isRankerReadyRef.current = props.isRankerReady ?? null;
  plotAiSettingsRef.current = props.plotAiAutocompleteSettings ?? null;
  plotAiStreamRef.current = props.plotAiAutocompleteStream ?? null;
  getPlotPriorCellsContentRef.current = props.getPlotPriorCellsContent ?? null;
  getPlotCellResultSchemaRef.current = props.getPlotCellResultSchema ?? null;
  getPlotScopeRef.current = props.getPlotScope ?? null;
  getPlotCellSqlRef.current = props.getPlotCellSql ?? null;
  getPlotCellResultColumnsRef.current = props.getPlotCellResultColumns ?? null;
  requestPlotSchemaDiscoveryRef.current = props.requestPlotSchemaDiscovery ?? null;
  getNotebookPlotScopeRef.current = props.getNotebookPlotScope ?? null;
  getCurrentCellIdRef.current = props.getCurrentCellId ?? null;
  getSqlBlockCountRef.current = props.getSqlBlockCount ?? null;
  getCellAliasesRef.current = props.getCellAliases ?? null;
  sqlAiSettingsRef.current = props.sqlAiAutocompleteSettings ?? null;
  sqlAiStreamRef.current = props.sqlAiAutocompleteStream ?? null;
  onPlotContextTrimmedRef.current = props.onPlotContextTrimmed ?? null;

  // Language compartment so we can hot-swap when mode changes (we don't expect
  // mode to change for a given editor instance, but this is cheap insurance).
  const languageCompartment = useMemo(() => new Compartment(), []);
  const readOnlyCompartment = useMemo(() => new Compartment(), []);

  // Build the static extension list once per mode.
  const baseExtensions = useMemo<Extension[]>(() => {
    const exts: Extension[] = [
      history(),
      drawSelection(),
      dropCursor(),
      EditorView.lineWrapping,
      ...(props.fullHeight ? [EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } })] : []),
      editorTheme,
      editorHighlight,
      // P5 — ghost-text rendering primitives (state field + Tab/Escape keys).
      // Always installed so the plot orchestrator can dispatch ghost-text
      // effects. No-op when no orchestrator is wired or when the toggle is off.
      aiGhostTextExtension,
      keymap.of([
        // Intercept Ctrl-A / Cmd-A before defaultKeymap so it selects all text
        // within this editor only — not across all cells.
        { key: 'Mod-a', run: selectAll },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...completionKeymap,
        {
          key: 'Mod-Enter',
          run: () => {
            if (onRunRef.current) {
              onRunRef.current();
              return true;
            }
            return false;
          },
        },
      ]),
      EditorView.updateListener.of(update => {
        if (update.docChanged && onChangeRef.current) {
          // Skip echoing programmatic value-sync dispatches back to React —
          // React already owns the new value; re-calling onChange would trigger
          // a redundant setState inside a CM update cycle (React warning).
          const isProgrammatic = update.transactions.some(tr => tr.annotation(programmaticChange));
          if (!isProgrammatic) {
            // Defer the React setState out of the synchronous CM update cycle.
            // Calling setState synchronously here (while _EditorView.update is on
            // the stack) causes React to attempt a flush inside the CM dispatch,
            // which leads to "Maximum update depth exceeded" when the component
            // tree is complex (e.g. a cell with multiple SQL blocks).
            const newValue = update.state.doc.toString();
            // setTimeout(0) rather than queueMicrotask: microtasks can still
            // fire within React's concurrent-mode reconciliation pass when
            // keystrokes arrive faster than frames, causing "Maximum update
            // depth exceeded". A macrotask (setTimeout) guarantees we're past
            // React's current flush before calling setState.
            setTimeout(() => { onChangeRef.current?.(newValue); }, 0);
          }
        }
        if (update.focusChanged && !update.view.hasFocus && onBlurRef.current) {
          onBlurRef.current();
        }
      }),
      variableExtension,
    ];

    if (props.mode === 'sql') {
      const sqlDeps = {
        getSchema: () => schemaRef.current,
        getVariables: () => variablesRef.current,
        getQueryRunner: () => runQueryRef.current,
        rankCandidates: (q: string, c: string[]) => rankCandidatesRef.current?.(q, c) ?? Promise.resolve([]),
        isRankerReady: () => !!(isRankerReadyRef.current?.()),
        onDistinctValuesReady: () => {
          const v = viewRef.current;
          if (v && v.hasFocus) startCompletion(v);
        },
      };
      exts.push(
        autocompletion({
          override: [
            (cx) => dispatchCompletion(cx, sqlDeps),
          ],
          activateOnTyping: true,
          closeOnBlur: true,
        }),
        buildHoverTooltip({
          mode: 'sql',
          getSchema: () => schemaRef.current,
          getVariables: () => variablesRef.current,
        }),
        diagnosticsExtension,
        // SQL AI ghost-text orchestrator. No-ops when sqlAiAutocompleteSettings
        // is null or aiAutocompleteEnabled is false.
        aiAutocompleteExtension({
          mode: 'sql',
          getSettings: () =>
            sqlAiSettingsRef.current ?? {
              aiAutocompleteEnabled: false,
              aiAutocompleteModel: 'off',
            },
          getPriorCellsContent: () => [],
          getSchema: () => schemaRef.current,
          getVariables: () => variablesRef.current,
          stream: (system, user, signal, model) => {
            const fn = sqlAiStreamRef.current;
            if (!fn) return (async function* () { /* empty */ })();
            return fn(system, user, signal, model);
          },
        }),
      );
    } else if (props.mode === 'plot') {
      exts.push(
        autocompletion({
          override: [plotCompletionSource({
            getData: () => plotDataRef.current,
            getCellSql: () => getPlotCellSqlRef.current?.() ?? null,
            getCellResultColumns: () => getPlotCellResultColumnsRef.current?.() ?? null,
            requestSchemaDiscovery: (sql: string) => requestPlotSchemaDiscoveryRef.current?.(sql),
            getNotebookPlotScope: () => getNotebookPlotScopeRef.current?.() ?? null,
            getCurrentCellId: () => getCurrentCellIdRef.current?.() ?? null,
            getVariables: () => variablesRef.current,
            getSqlBlockCount: () => getSqlBlockCountRef.current?.() ?? 0,
          })],
          activateOnTyping: true,
          closeOnBlur: true,
        }),
        buildHoverTooltip({
          mode: 'plot',
          getSchema: () => schemaRef.current,
          getVariables: () => variablesRef.current,
        }),
        diagnosticsExtension,
        // P4 — plot DSL linter (debounced 500ms). Diagnostic[] surfaces via
        // the standard CM6 lint UI (gutter, tooltip, fix actions).
        plotLinter({
          getShapeRegistry: () => plotRegistry,
          getCellColumns: () => getPlotCellResultColumnsRef.current?.() ?? null,
          getNotebookScope: () => {
            const scope = getNotebookPlotScopeRef.current?.();
            if (scope) return scope;
            const named = getPlotScopeRef.current?.() ?? null;
            return named ? { namedPlots: named } as any : null;
          },
          getSqlBlockCount: () => getSqlBlockCountRef.current?.() ?? 0,
          getVariables: () => variablesRef.current,
        }),
        // P5 — plot-mode AI ghost-text orchestrator. Internally no-ops when the
        // user has not enabled the feature or no stream is wired.
        aiPlotAutocompleteExtension({
          getSettings: () =>
            plotAiSettingsRef.current ?? {
              aiAutocompleteEnabled: false,
              plotAiAutocompleteEnabled: false,
              aiAutocompleteModel: 'off',
            },
          getPriorPlotCellsContent: () => getPlotPriorCellsContentRef.current?.() ?? [],
          getCellResultSchema: () => getPlotCellResultSchemaRef.current?.() ?? null,
          getPlotScope: () => getPlotScopeRef.current?.() ?? [],
          getVariables: () => variablesRef.current,
          getShapeRegistry: () => plotRegistry,
          stream: (system, user, signal, model) => {
            const fn = plotAiStreamRef.current;
            if (!fn) return (async function* () { /* empty */ })();
            return fn(system, user, signal, model);
          },
          onContextTrimmed: (trimmed) => onPlotContextTrimmedRef.current?.(trimmed),
        }),
      );
    } else if (props.mode === 'markdown') {
      exts.push(
        markdownTemplatingExtension({
          getVariables: () => variablesRef.current,
          getAliases: () => getCellAliasesRef.current?.() ?? {},
        }),
        diagnosticsExtension,
      );
    }
    return exts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode, props.fullHeight]);

  // Pick the language extension for this mode.
  const languageExt = useMemo<Extension>(() => {
    if (props.mode === 'sql') return buildSqlLanguage();
    if (props.mode === 'plot') return buildPlotLanguage(plotRegistry);
    return markdownLanguage();
  }, [props.mode]);

  // One-time mount.
  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: props.value,
      extensions: [
        ...baseExtensions,
        languageCompartment.of(languageExt),
        readOnlyCompartment.of(EditorState.readOnly.of(!!props.readOnly)),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    if (props.autoFocus) {
      // Focus on next tick so React has finished mounting siblings.
      requestAnimationFrame(() => view.focus());
    }
    // initial variable spec
    if (props.variables !== undefined || props.onVariableClick) {
      view.dispatch({
        effects: setVariableSpec.of({
          variables: props.variables ?? {},
          onVariableClick: props.onVariableClick,
        }),
      });
    }
    // initial error
    if (props.error !== undefined) {
      pushRunError(view, props.error ?? null);
    }
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync the `value` prop into the editor when it differs from the current doc.
  // The programmaticChange annotation prevents the updateListener from echoing
  // this dispatch back to React as an onChange call, so there is no infinite loop.
  // We intentionally do NOT guard on `view.hasFocus` here: external replacements
  // such as candidate-binding chip clicks or format actions need to apply even
  // when the editor is focused.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === props.value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: props.value },
      annotations: programmaticChange.of(true),
    });
  }, [props.value]);

  // Sync variable spec.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setVariableSpec.of({
        variables: props.variables ?? {},
        onVariableClick: props.onVariableClick,
      }),
    });
  }, [props.variables, props.onVariableClick]);

  // Sync read-only.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(!!props.readOnly)),
    });
  }, [props.readOnly, readOnlyCompartment]);

  // Sync language when mode changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: languageCompartment.reconfigure(languageExt) });
  }, [languageExt, languageCompartment]);

  // Sync error state.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    pushRunError(view, props.error ?? null);
  }, [props.error]);

  useImperativeHandle(
    ref,
    () => ({
      get view() {
        return viewRef.current;
      },
      setError: (err: RunErrorSpec | null) => {
        if (viewRef.current) pushRunError(viewRef.current, err);
      },
      focus: () => viewRef.current?.focus(),
    }),
    [],
  );

  return (
    <div
      ref={hostRef}
      className={`cm-jfr-editor ${props.fullHeight ? 'h-full' : ''} w-full text-sm`}
    />
  );
});

export default Editor;
