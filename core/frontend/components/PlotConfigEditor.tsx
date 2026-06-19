import React, { useEffect } from 'react';
import { plotRegistry } from './plots/plotRegistry';
import { registerPlotMode } from '../utils/codemirror-plot-mode';
import SQLEditor from './SQLEditor';
import { plotClauseDocs } from '../utils/plotClauseDocs';

// Register the custom mode once globally.
if (typeof window !== 'undefined' && window.CodeMirror && !window.CodeMirror.modes.plot) {
  registerPlotMode(plotRegistry);
}

interface PlotConfigEditorProps {
  value: string;
  onChange: (value: string, index?: number) => void;
  index?: number;
  data: any[] | null;
  variables?: Record<string, string>;
  onVariableClick?: (variableName: string) => void;
}

const PlotConfigEditor: React.FC<PlotConfigEditorProps> = ({ value, onChange, index, data, variables, onVariableClick }) => {
    
    useEffect(() => {
        if (!window.CodeMirror) return;
        
        const dataKeys = data && data.length > 0 ? Object.keys(data[0]) : [];

        window.CodeMirror.registerHelper('hint', 'plot', (cm: any) => {
            const cursor = cm.getCursor();
            const token = cm.getTokenAt(cursor);
            const line = cm.getLine(cursor.line);
            
            const from = window.CodeMirror.Pos(cursor.line, token.start);
            const to = cursor;
            const currentWord = token.string.trim();

            let suggestions: any[] = [];
            
            const textBeforeCursor = line.substring(0, cursor.ch);
            const textBeforeToken = line.substring(0, token.start);
            
            const funcMatch = textBeforeCursor.match(/(\w+)\s*\(([^)]*)$/);

            if (funcMatch) { // --- CONTEXT: Inside a function call ---
                const funcName = funcMatch[1].toUpperCase();
                const argsStr = funcMatch[2];
                const plotDef = plotRegistry[funcName];

                if (plotDef) {
                    const isTypingValue = /:\s*[\w"']*\s*$/.test(textBeforeCursor);
                    const paramNameMatch = textBeforeCursor.match(/(\w+)\s*:\s*[\w"']*\s*$/);
                    const currentParamName = paramNameMatch ? paramNameMatch[1] : null;
                    const paramDef = currentParamName ? plotDef.params.find(p => p.name === currentParamName) : null;

                    if (isTypingValue && paramDef) { // Suggesting a value for a parameter
                        if (paramDef.type.includes('column')) {
                            dataKeys.forEach(key => suggestions.push({ text: `"${key}"`, displayText: key, className: 'CodeMirror-hint-column' }));
                        }
                        if (paramDef.options) {
                            paramDef.options.forEach(opt => suggestions.push({ text: opt, displayText: opt, className: 'CodeMirror-hint-atom' }));
                        }
                    } else { // Suggesting a parameter name
                        const usedParams = new Set(argsStr.match(/(\w+)\s*:/g)?.map(p => p.slice(0, -1).trim()) || []);
                        plotDef.params.forEach(param => {
                            if (!usedParams.has(param.name)) {
                                suggestions.push({
                                    text: `${param.name}: `,
                                    displayText: `${param.name} (${param.type})${param.required ? ' *' : ''}`,
                                    className: 'CodeMirror-hint-plot-param'
                                });
                            }
                        });
                    }
                }
            } else if (/\)\s*[\w]*$/.test(textBeforeCursor) || (token.type === 'keyword' && token.string.length > 0)) { // --- CONTEXT: After a function call ---
                Object.values(plotClauseDocs).forEach(clause => {
                    suggestions.push({
                        text: `${clause.name} `,
                        displayText: clause.signature,
                        className: 'CodeMirror-hint-plot-function'
                    });
                });
            } else if (/^\s*$/.test(textBeforeToken) || /;\s*$/.test(textBeforeToken.trim())) { // --- CONTEXT: Start of line/config ---
                 Object.values(plotRegistry).forEach(plot => {
                    suggestions.push({ text: plot.template, displayText: `${plot.name} - ${plot.description}`, className: 'CodeMirror-hint-plot-function' });
                });
            }

            // --- GENERIC CONTEXT: Suggest column names for any unrecognized word ---
            if (token.type === 'variable' && !funcMatch) {
                dataKeys.forEach(key => {
                    suggestions.push({ text: `"${key}"`, displayText: key, className: 'CodeMirror-hint-column' });
                });
            }
            
            // Filter suggestions based on what's already typed
            const finalSuggestions = suggestions.filter(s =>
                s.displayText.toLowerCase().includes(currentWord.toLowerCase())
            );

            // Deduplicate
            const uniqueSuggestions = Array.from(new Map(finalSuggestions.map(item => [item.text, item])).values());

            if (uniqueSuggestions.length > 0) {
                 return { list: uniqueSuggestions, from, to };
            }
            return null;
        });
    }, [data]);

  return (
    <SQLEditor
      value={value}
      onChange={onChange}
      index={index}
      mode="plot"
      variables={variables}
      onVariableClick={onVariableClick}
    />
  );
};

export default React.memo(PlotConfigEditor);