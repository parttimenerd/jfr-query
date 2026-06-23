import React from 'react';
import SQLEditor from './SQLEditor';

interface PlotConfigEditorProps {
  value: string;
  onChange: (value: string, index?: number) => void;
  index?: number;
  data: any[] | null;
  variables?: Record<string, string>;
  onVariableClick?: (variableName: string) => void;
}

const PlotConfigEditor: React.FC<PlotConfigEditorProps> = ({
  value,
  onChange,
  index,
  data,
  variables,
  onVariableClick,
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
    />
  );
};

export default React.memo(PlotConfigEditor);
