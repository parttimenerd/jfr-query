import React, { useContext, useEffect, useMemo, useRef } from 'react';
import { DataContext } from '../context/DuckDBContext';
import type { TableSchema, ViewSchema, MacroSchema, NotebookMetadata } from '../types';
import { Editor, type EditorHandle } from './editor/Editor';
import type { SchemaForCompletion } from './editor/completions';
import type { RunErrorSpec } from './editor/diagnostics';
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
}) => {
  const { schema: dbSchema, query } = useContext(DataContext);
  const handleRef = useRef<EditorHandle | null>(null);

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
    />
  );
};

export default React.memo(SQLEditor);
