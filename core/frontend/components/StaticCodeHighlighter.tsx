import React from 'react';
import { Editor } from './editor/Editor';

interface StaticCodeHighlighterProps {
  code: string;
  language: 'sql' | 'plot' | string;
}

const StaticCodeHighlighter: React.FC<StaticCodeHighlighterProps> = ({ code, language }) => {
  const mode: 'sql' | 'plot' = language === 'plot' ? 'plot' : 'sql';
  // Editor reads `value` on mount and re-syncs when prop changes (only when not focused).
  return (
    <div className="cm-jfr-static">
      <Editor value={code} mode={mode} readOnly />
    </div>
  );
};

export default StaticCodeHighlighter;
