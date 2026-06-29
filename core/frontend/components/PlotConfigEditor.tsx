import React, { useState, useCallback } from 'react';
import SQLEditor from './SQLEditor';
import type { PlotScopeView } from './editor/plot/notebookPlotScope';

interface PlotConfigEditorProps {
  value: string;
  onChange: (value: string, index?: number) => void;
  index?: number;
  data: any[] | null;
  variables?: Record<string, string>;
  onVariableClick?: (variableName: string) => void;
  /** P2 — preceding SQL block's text, used for plot DSL schema discovery. */
  cellSql?: string | null;
  /** P7 — notebook-wide plot scope view. */
  notebookPlotScope?: PlotScopeView | null;
  /** P7 — current cell id (used as upper-bound for scope filtering). */
  currentCellId?: string | null;
  /** P7 — total SQL block count across notebook (fallback for `#N` hints). */
  sqlBlockCount?: number;
}

const PlotConfigEditor: React.FC<PlotConfigEditorProps> = ({
  value,
  onChange,
  index,
  data,
  variables,
  onVariableClick,
  cellSql,
  notebookPlotScope,
  currentCellId,
  sqlBlockCount,
}) => {
  const [contextTrimmed, setContextTrimmed] = useState(false);
  const handleContextTrimmed = useCallback((trimmed: boolean) => {
    setContextTrimmed(trimmed);
  }, []);

  return (
    <div className="relative">
      <SQLEditor
        value={value}
        onChange={onChange}
        index={index}
        mode="plot"
        variables={variables}
        onVariableClick={onVariableClick}
        hintData={data}
        cellSql={cellSql ?? null}
        notebookPlotScope={notebookPlotScope ?? null}
        currentCellId={currentCellId ?? null}
        sqlBlockCount={sqlBlockCount ?? 0}
        onPlotContextTrimmed={handleContextTrimmed}
      />
      {contextTrimmed && (
        <div
          className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] rounded bg-yellow-900/60 text-yellow-300/80 border border-yellow-700/40 pointer-events-none select-none"
          title="Some prior-cell context was trimmed to fit the AI token budget — earlier cells may not be visible to the AI autocomplete."
        >
          context trimmed
        </div>
      )}
    </div>
  );
};

export default React.memo(PlotConfigEditor);
