import React from 'react';
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
  return (
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
    />
  );
};

export default React.memo(PlotConfigEditor);
