import React, { useContext, useEffect, useMemo, useRef } from 'react';
import { DataContext } from '../context/DuckDBContext';
import { SettingsContext } from '../context/SettingsContext';
import { aiService } from '../services/AiService';
import type { TableSchema, ViewSchema, MacroSchema, NotebookMetadata } from '../types';
import { Editor, type EditorHandle } from './editor/Editor';
import type { SchemaForCompletion } from './editor/completions';
import type { RunErrorSpec } from './editor/diagnostics';
import { usePlotSchemaDiscovery } from './editor/plot/schemaProvider';
import type { StreamFn } from './editor/aiAutocomplete';
import type { PlotAutocompleteSettings } from './editor/plot/aiPlotSource';
import type { ResultColumn } from './editor/aiAutocomplete/contextBuilder';
import type { PlotScopeView } from './editor/plot/notebookPlotScope';
import * as EmbeddingService from '../services/ml/EmbeddingService';

interface EditorProps {
  value: string;
  onChange: (value: string, index?: number) => void;
  index?: number;
  mode?: 'sql' | 'markdown' | 'plot';
  fullHeight?: boolean;
  onBlur?: () => void;
  onRun?: () => void;
  autoFocus?: boolean;
  variables?: Record<string, string>;
  onVariableClick?: (variableName: string) => void;
  metadata?: NotebookMetadata;
  focusTrigger?: number;
  hintData?: any[] | null;
  error?: RunErrorSpec | null;
  /** P2 — companion SQL text for plot-mode editors. Used to key the schema-discovery cache; ignored when `mode !== 'plot'`. */
  cellSql?: string | null;
  /** P5 — prior plot cells' raw text (chronological). Used by the plot AI ghost-text context builder. */
  priorPlotCellsContent?: string[];
  /** P5 — current cell's SQL result schema (name+type), if known. */
  cellResultSchema?: ResultColumn[] | null;
  /** P7 — notebook-wide plot scope (named plots, query refs, vars, brushes). */
  notebookPlotScope?: PlotScopeView | null;
  /** P7 — current cell id for hint resolution / scope filtering. */
  currentCellId?: string | null;
  /** P7 — number of SQL blocks in the notebook (fallback for queryRefTarget hints). */
  sqlBlockCount?: number;
}

const SQLEditor: React.FC<EditorProps> = ({
  value,
  onChange,
  index,
  mode = 'sql',
  fullHeight = false,
  onBlur,
  onRun,
  autoFocus = false,
  variables,
  onVariableClick,
  metadata,
  focusTrigger,
  hintData,
  error,
  cellSql,
  priorPlotCellsContent,
  cellResultSchema,
  notebookPlotScope,
  currentCellId,
  sqlBlockCount,
}) => {
  const { schema: dbSchema, query } = useContext(DataContext);
  const { settings } = useContext(SettingsContext);
  const plotSchema = usePlotSchemaDiscovery();
  const handleRef = useRef<EditorHandle | null>(null);

  // P5 — plot AI ghost-text settings (separate toggle from any SQL ghost-text).
  const plotAiAutocompleteSettings = useMemo<PlotAutocompleteSettings>(() => ({
    aiAutocompleteEnabled: false,
    plotAiAutocompleteEnabled: settings.plotAiAutocompleteEnabled,
    aiAutocompleteModel: settings.aiAutocompleteModel,
    plotAiAutocompleteDebounceMs: settings.plotAiAutocompleteDebounceMs,
  }), [
    settings.plotAiAutocompleteEnabled,
    settings.aiAutocompleteModel,
    settings.plotAiAutocompleteDebounceMs,
  ]);

  // P5 — stable adapter that fronts the orchestrator's `StreamFn` shape.
  //
  // The shared `AiService.streamChat` helper has been removed during a parallel
  // refactor, so we fall back to `getAiInlineSuggestion` (request/response) and
  // yield the resulting code as a single chunk. The orchestrator's chunk-based
  // AST validation still works — it just runs once at end-of-stream.
  //
  // Browser-model path: uses the in-tree T5-small plot-suggester (v2) via
  // PlotGenerationService — one-shot, yielded as a single chunk so AST
  // validation runs once at end-of-stream (same shape as the cloud branch).
  const plotAiAutocompleteStream = useMemo<StreamFn>(() => {
    return async function* stream(_system, user, signal, model) {
      if (model === 'browser') {
        const sql = cellSqlRef.current;
        if (!sql) return;
        const cached = plotSchema.getCellResultColumns(sql);
        const cols = cached?.status === 'ok' && cached.columns ? cached.columns : null;
        if (!cols || cols.length === 0) return;
        try {
          const { generate } = await import('../services/ml/PlotGenerationService');
          const typedCols = cols.map(c => ({ name: c.name, type: c.dataType }));
          const result = await generate(sql, typedCols, undefined, signal);
          if (signal.aborted) return;
          const code = result?.trim();
          if (code) yield code;
        } catch (e: any) {
          if (e?.name === 'AbortError') return;
        }
        return;
      }
      if (model !== 'cloud-tiny') return;
      if (!aiService.isInitialized()) return;
      try {
        // We use the user-prompt directly as the `request`; the system prompt is
        // structurally redundant with the context already injected by the
        // orchestrator's prompt builder.
        const resp = await aiService.getAiInlineSuggestion(
          user,
          'plot',
          '',
          '',
          undefined,
          undefined,
          undefined,
          'no-data',
          null,
          'basic',
        );
        if (signal.aborted) return;
        const code = resp?.code?.trim();
        if (code) yield code;
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the latest companion SQL in a ref so the editor extension (mounted
  // once) reads it without rebuilding extensions on every keystroke.
  const cellSqlRef = useRef<string | null>(cellSql ?? null);
  cellSqlRef.current = cellSql ?? null;

  // P7 — notebook plot scope refs (read by completion source/lint via getters).
  const notebookPlotScopeRef = useRef<PlotScopeView | null>(notebookPlotScope ?? null);
  notebookPlotScopeRef.current = notebookPlotScope ?? null;
  const currentCellIdRef = useRef<string | null>(currentCellId ?? null);
  currentCellIdRef.current = currentCellId ?? null;
  const sqlBlockCountRef = useRef<number>(sqlBlockCount ?? 0);
  sqlBlockCountRef.current = sqlBlockCount ?? 0;

  // Stable keys so combinedSchema only rebuilds on real changes.
  const metaViewsKey = useMemo(
    () => JSON.stringify(metadata?.views?.map(v => [v.name, v.sql])),
    [metadata?.views],
  );
  const metaMacrosKey = useMemo(
    () => JSON.stringify(metadata?.macros?.map(m => [m.name, m.sql])),
    [metadata?.macros],
  );

  const schemaForCompletion = useMemo<SchemaForCompletion | null>(() => {
    if (!dbSchema) return null;
    const customViews: ViewSchema[] =
      metadata?.views?.map(v => ({ name: v.name, query: v.sql, columns: [], internal: false })) ?? [];
    const customMacros: MacroSchema[] =
      metadata?.macros?.map(m => ({ name: m.name, parameters: [], sql: m.sql, returnType: 'any' })) ?? [];

    const tables: TableSchema[] = dbSchema.tables;
    const views: ViewSchema[] = [...dbSchema.views, ...customViews];
    const macros: MacroSchema[] = [...dbSchema.macros, ...customMacros];

    const tableMap = new Map<string, TableSchema>();
    tables.forEach(t => tableMap.set(t.name.toLowerCase(), t));
    const viewMap = new Map<string, ViewSchema>();
    views.forEach(v => viewMap.set(v.name.toLowerCase(), v));

    return { tables, views, macros, tableMap, viewMap };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbSchema, metaViewsKey, metaMacrosKey]);

  // Re-focus when focusTrigger increments.
  useEffect(() => {
    if (focusTrigger === undefined || focusTrigger === 0) return;
    handleRef.current?.focus();
  }, [focusTrigger]);

  return (
    <Editor
      ref={handleRef}
      value={value}
      onChange={v => onChange(v, index)}
      onBlur={onBlur}
      onRun={onRun}
      mode={mode}
      autoFocus={autoFocus}
      fullHeight={fullHeight}
      schema={schemaForCompletion}
      variables={variables}
      onVariableClick={onVariableClick}
      plotData={hintData ?? null}
      error={error}
      runQuery={query}
      rankCandidates={EmbeddingService.rankCandidates}
      isRankerReady={EmbeddingService.isReady}
      getPlotCellSql={mode === 'plot' ? () => cellSqlRef.current : null}
      getPlotCellResultColumns={mode === 'plot'
        ? () => {
            const sql = cellSqlRef.current;
            if (!sql) return null;
            const cached = plotSchema.getCellResultColumns(sql);
            return cached?.status === 'ok' && cached.columns ? cached.columns : null;
          }
        : null}
      requestPlotSchemaDiscovery={mode === 'plot' ? plotSchema.requestSchemaDiscovery : null}
      getNotebookPlotScope={mode === 'plot' ? () => notebookPlotScopeRef.current : null}
      getCurrentCellId={mode === 'plot' ? () => currentCellIdRef.current : null}
      getSqlBlockCount={mode === 'plot' ? () => sqlBlockCountRef.current : null}
      plotAiAutocompleteSettings={mode === 'plot' ? plotAiAutocompleteSettings : null}
      plotAiAutocompleteStream={mode === 'plot' ? plotAiAutocompleteStream : null}
      getPlotPriorCellsContent={mode === 'plot' ? () => priorPlotCellsContent ?? [] : null}
      getPlotCellResultSchema={mode === 'plot' ? () => cellResultSchema ?? null : null}
    />
  );
};

export default React.memo(SQLEditor);
