import React, { useEffect, useRef } from 'react';
import { registerPlotMode } from '../utils/codemirror-plot-mode';
import { plotRegistry } from './plots/plotRegistry';

// Register the custom mode once globally to ensure it's available.
if (typeof window !== 'undefined' && window.CodeMirror && !window.CodeMirror.modes.plot) {
  registerPlotMode(plotRegistry);
}

declare global {
  interface Window {
    CodeMirror: any;
  }
}

interface StaticCodeHighlighterProps {
  code: string;
  language: 'sql' | 'plot' | string;
}

const StaticCodeHighlighter: React.FC<StaticCodeHighlighterProps> = ({ code, language }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const codeMirrorInstance = useRef<any>(null);

  useEffect(() => {
    if (editorRef.current && !codeMirrorInstance.current && window.CodeMirror) {
      const editor = window.CodeMirror(editorRef.current, {
        value: code,
        mode: language === 'plot' ? 'plot' : 'sql',
        theme: 'material-darker',
        readOnly: true, // Makes it read-only but allows selection
        lineWrapping: true,
        viewportMargin: Infinity, // Important for auto-sizing height with the CSS
      });
      codeMirrorInstance.current = editor;

      // Refresh helps with layout issues, especially when initially rendered inside a collapsed element.
      setTimeout(() => {
        editor.refresh();
      }, 1);
    }
  }, []); // Only runs on mount to initialize the editor

  useEffect(() => {
    // Update the content if the code prop changes
    if (codeMirrorInstance.current && codeMirrorInstance.current.getValue() !== code) {
      codeMirrorInstance.current.setValue(code);
      setTimeout(() => {
        codeMirrorInstance.current.refresh();
      }, 1);
    }
  }, [code]);

  // The wrapper div gets the theme class to provide a consistent background.
  return <div ref={editorRef} className="cm-s-material-darker" />;
};

export default StaticCodeHighlighter;