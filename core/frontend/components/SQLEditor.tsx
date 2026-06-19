import React, { useEffect, useRef, useState, useContext, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { DataContext } from '../context/DuckDBContext';
import { SchemaTooltipContent } from './SchemaTooltipContent';
import type { TableSchema, ViewSchema, MacroSchema, NotebookMetadata } from '../types';
import { plotRegistry } from './plots/plotRegistry';
import { PlotTooltipContent } from './PlotTooltipContent';
import type { PlotParameter } from './plots/plotTypes';
import { plotClauseDocs } from '../utils/plotClauseDocs';

declare global {
  interface Window {
    CodeMirror: any;
  }
}

// --- Custom CodeMirror Modes ---
if (typeof window !== 'undefined' && window.CodeMirror) {
    if (!window.CodeMirror.modes.variables) {
        window.CodeMirror.defineMode('variables', () => ({
            token: function(stream: any) {
                if (stream.eatSpace()) return null;
                if (stream.match(/^\$\w+/)) return 'local-variable';
                if (stream.match('=')) return 'operator';
                if (stream.match(/"(?:[^"\\]|\\.)*"/)) return 'string';
                if (stream.match(/-?\d*\.?\d+/)) return 'number';
                stream.next();
                return null;
            }
        }));
    }
    if (window.CodeMirror.multiplexingMode && !window.CodeMirror.modes.markdown_with_variables) {
        window.CodeMirror.defineMode('markdown_with_variables', (config: any) => 
            window.CodeMirror.multiplexingMode(
                window.CodeMirror.getMode(config, 'markdown'), {
                    open: '```variables',
                    close: '```',
                    mode: window.CodeMirror.getMode(config, 'variables'),
                    delimStyle: 'comment'
                }
            )
        );
    }
}

interface EditorProps {
  value: string;
  onChange: (value: string, index?: number) => void;
  index?: number;
  mode?: 'sql' | 'markdown' | 'plot';
  fullHeight?: boolean;
  onBlur?: (editor: any) => void;
  autoFocus?: boolean;
  variables?: Record<string, string>;
  onVariableClick?: (variableName: string) => void;
  metadata?: NotebookMetadata;
}

/**
 * Creates a more performant CodeMirror overlay for custom syntax highlighting.
 * It uses pre-compiled regexes for known schema items instead of matching every
 * word and doing a JS lookup.
 */
function createSqlOverlay(schema: { tables: TableSchema[], views: ViewSchema[], macros: MacroSchema[] }) {
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const allTableAndViewNames = [...schema.tables.map(t => t.name), ...schema.views.map(v => v.name)];
    const macroNames = schema.macros.map(m => m.name);

    // For quoted identifiers, use sets for fast, case-insensitive lookup
    const allNamesSet = new Set(allTableAndViewNames.map(n => n.toLowerCase()));
    const macroNamesSet = new Set(macroNames.map(n => n.toLowerCase()));
    
    // For unquoted identifiers, build a more efficient regex
    const tablesAndViewsRegex = allTableAndViewNames.length > 0 ? new RegExp(`^(?:${allTableAndViewNames.map(escapeRegex).join('|')})\\b`, 'i') : null;
    const macrosRegex = macroNames.length > 0 ? new RegExp(`^(?:${macroNames.map(escapeRegex).join('|')})\\b`, 'i') : null;

    return {
        token: function(stream: any) {
            // Handle quoted identifiers separately and efficiently
            if (stream.peek() === '"') {
                if (stream.match(/"[^"]*"/)) { // Consume the whole quoted string
                    const content = stream.current().slice(1, -1).toLowerCase();
                    if (allNamesSet.has(content)) {
                        return 'variable-2';
                    }
                    if (macroNamesSet.has(content)) {
                        return 'macro-name';
                    }
                    // It was a quoted string, but not a schema item. Let the base mode style it.
                    return null;
                }
            }

            // For unquoted, use the pre-compiled regexes
            if (tablesAndViewsRegex && stream.match(tablesAndViewsRegex)) {
                return 'variable-2';
            }
            if (macrosRegex && stream.match(macrosRegex)) {
                return 'macro-name';
            }

            // If nothing matched, advance one character and let the base mode handle it.
            stream.next();
            return null;
        }
    };
}


const SQLEditor: React.FC<EditorProps> = ({ value, onChange, index, mode = 'sql', fullHeight = false, onBlur, autoFocus = false, variables, onVariableClick, metadata }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const codeMirrorInstance = useRef<any>(null);
  const { schema: dbSchema } = useContext(DataContext);
  const [tooltip, setTooltip] = useState<{ visible: boolean; content: React.ReactNode; top: number; left: number } | null>(null);
  
  const overlayRef = useRef<any>(null);
  const variableMarkers = useRef<any[]>([]);
  const variableBookmarks = useRef<any[]>([]);
  const undefinedVariableMarkers = useRef<any[]>([]);
  
  const onBlurRef = useRef(onBlur); onBlurRef.current = onBlur;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const onVariableClickRef = useRef(onVariableClick); onVariableClickRef.current = onVariableClick;
  const valueRef = useRef(value); valueRef.current = value;

  // --- Performance Optimization: Debounce value for expensive effects ---
  const [debouncedValue, setDebouncedValue] = useState(value);
  const debounceTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = window.setTimeout(() => {
        setDebouncedValue(value);
    }, 400); // Delay for re-calculating expensive markers

    return () => {
        if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
        }
    };
  }, [value]);
  // --- End Performance Optimization ---


  const combinedSchema = useMemo(() => {
    if (!dbSchema) return null;
    const customViews = metadata?.views?.map(v => ({ name: v.name, query: v.sql, columns: [], internal: false })) || [];
    const customMacros = metadata?.macros?.map(m => ({ name: m.name, parameters: [], sql: m.sql, returnType: 'any' })) || [];
    
    return {
        tables: dbSchema.tables,
        views: [...dbSchema.views, ...customViews],
        macros: [...dbSchema.macros, ...customMacros]
    };
  }, [dbSchema, metadata]);
  
  const combinedSchemaWithLookups = useMemo(() => {
    if (!combinedSchema) return null;

    const tableMap = new Map<string, TableSchema>();
    combinedSchema.tables.forEach(t => tableMap.set(t.name.toLowerCase(), t));

    const viewMap = new Map<string, ViewSchema>();
    combinedSchema.views.forEach(v => viewMap.set(v.name.toLowerCase(), v));

    const macroMap = new Map<string, MacroSchema>();
    combinedSchema.macros.forEach(m => macroMap.set(m.name.toLowerCase(), m));

    return { ...combinedSchema, tableMap, viewMap, macroMap };
  }, [combinedSchema]);


  useEffect(() => {
    if (editorRef.current && !codeMirrorInstance.current && window.CodeMirror) {
      const effectiveMode = mode === 'markdown' && window.CodeMirror.modes.markdown_with_variables ? 'markdown_with_variables' : mode;
      const editor = window.CodeMirror(editorRef.current, {
        value: value, mode: effectiveMode, theme: 'material-darker', lineNumbers: false,
        lineWrapping: true, viewportMargin: Infinity, extraKeys: { 'Ctrl-Space': 'autocomplete' },
      });
      codeMirrorInstance.current = editor;

      editor.on('change', (instance: any) => { 
        const currentValue = instance.getValue();
        if (currentValue !== valueRef.current) {
            onChangeRef.current(currentValue, index);
        }
      });
      editor.on('blur', (instance: any) => { if (onBlurRef.current) onBlurRef.current(instance); });
      editor.on('mousedown', (instance: any, e: MouseEvent) => {
        const pos = instance.coordsChar({ left: e.clientX, top: e.clientY });
        const markers = instance.findMarksAt(pos);
        const variableMarker = markers.find((m: any) => 
            m.className === 'cm-local-variable-name' ||
            m.className === 'cm-undefined-variable'
        );
        if (variableMarker && onVariableClickRef.current) {
            e.preventDefault();
            const varName = variableMarker.attributes['data-variable-name'];
            onVariableClickRef.current(varName);
        }
      });
      
      editor.on("inputRead", function(editor: any, change: any) {
        if (change.origin !== "+input" || change.text[0] === ";" || mode === 'markdown') {
            return;
        }
        editor.showHint({ completeSingle: false });
      });
    }
  }, []);

  // This is the expensive effect that now runs less frequently.
  useEffect(() => {
    const editor = codeMirrorInstance.current;
    if (!editor) return;
    
    // Clear all previous markers
    variableMarkers.current.forEach(marker => marker.clear());
    variableMarkers.current = [];
    variableBookmarks.current.forEach(bookmark => bookmark.clear());
    variableBookmarks.current = [];
    undefinedVariableMarkers.current.forEach(marker => marker.clear());
    undefinedVariableMarkers.current = [];

    if ((mode !== 'sql' && mode !== 'plot') || !variables) return;

    const newDefinedMarkers: any[] = [];
    const newDefinedBookmarks: any[] = [];
    const newUndefinedMarkers: any[] = [];

    // Find all potential variables in the editor content
    const searchCursor = editor.getSearchCursor(/\$\w+/g);
    
    while (searchCursor.findNext()) {
        const from = searchCursor.from();
        const to = searchCursor.to();
        
        const varName = editor.getRange(from, to);

        if (variables && Object.prototype.hasOwnProperty.call(variables, varName)) {
            // It's a defined variable
            const varValue = variables[varName];
            
            newDefinedMarkers.push(editor.markText(from, to, {
                className: 'cm-local-variable-name',
                attributes: { 'data-variable-name': varName }
            }));
            
            const widgetNode = document.createElement('span');
            widgetNode.textContent = `: ${varValue}`;
            widgetNode.className = 'cm-variable-value-widget';
            newDefinedBookmarks.push(editor.setBookmark(to, { widget: widgetNode }));
        } else {
            // It's an undefined variable
            newUndefinedMarkers.push(editor.markText(from, to, {
                className: 'cm-undefined-variable',
                title: `Undefined variable: ${varName}. Click to define.`,
                attributes: { 'data-variable-name': varName }
            }));
        }
    }

    variableMarkers.current = newDefinedMarkers;
    variableBookmarks.current = newDefinedBookmarks;
    undefinedVariableMarkers.current = newUndefinedMarkers;
  }, [variables, mode, debouncedValue]); // Depends on the debounced value

  useEffect(() => {
    const editor = codeMirrorInstance.current;
    if (!editor) return;

    // This effect manages the SQL overlay lifecycle.
    if (mode === 'sql' && combinedSchema) {
        if (overlayRef.current) {
            editor.removeOverlay(overlayRef.current);
        }
        overlayRef.current = createSqlOverlay(combinedSchema);
        editor.addOverlay(overlayRef.current);
    } else if (overlayRef.current) {
        editor.removeOverlay(overlayRef.current);
        overlayRef.current = null;
    }

    return () => {
        if (editor && overlayRef.current) {
            try { editor.removeOverlay(overlayRef.current); } 
            catch(e) { /* ignore cleanup errors on unmount */ }
        }
    }
  }, [combinedSchema, mode]);
  
  
  useEffect(() => {
    const editor = codeMirrorInstance.current;
    if (!editor) return;
    
    const wrapper = editor.getWrapperElement();
    let hideTimeout: number | null = null;
    let currentTooltipToken: { line: number, ch: number } | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (hideTimeout) clearTimeout(hideTimeout);
      const pos = editor.coordsChar({ left: e.clientX, top: e.clientY });
      const token = editor.getTokenAt(pos);

      if (!token || !token.string.trim() || (currentTooltipToken && currentTooltipToken.line === pos.line && currentTooltipToken.ch >= token.start && currentTooltipToken.ch < token.end)) {
        return;
      }
      currentTooltipToken = { line: pos.line, ch: pos.ch };

      let tooltipContent: React.ReactNode = null;
      
      if (mode === 'sql' && combinedSchemaWithLookups) {
          let item: TableSchema | ViewSchema | MacroSchema | undefined;
          let type: 'table' | 'view' | 'macro' | undefined;
          const cleanedToken = token.string.toLowerCase().replace(/["']/g, '');
          
          item = combinedSchemaWithLookups.tableMap.get(cleanedToken);
          type = item ? 'table' : undefined;

          if (!item) {
              item = combinedSchemaWithLookups.viewMap.get(cleanedToken);
              type = item ? 'view' : undefined;
          }
          if (!item) {
              item = combinedSchemaWithLookups.macroMap.get(cleanedToken);
              type = item ? 'macro' : undefined;
          }

          if (item && type) tooltipContent = React.createElement(SchemaTooltipContent, { item, type });

      } else if (mode === 'plot') {
          if (token.type?.includes('plot-function')) {
            const funcName = token.string.toUpperCase();
            const plotDef = plotRegistry[funcName];
            if (plotDef) tooltipContent = React.createElement(PlotTooltipContent, { item: plotDef, type: 'function' });
          } else if (token.type?.includes('plot-param')) {
            const paramName = token.string;
            const definitions = Object.values(plotRegistry).map(plot => ({ funcName: plot.name, param: plot.params.find(p => p.name === paramName) })).filter(def => def.param) as { funcName: string, param: PlotParameter }[];
            if (definitions.length > 0) tooltipContent = React.createElement(PlotTooltipContent, { item: { name: paramName, definitions }, type: 'parameter' });
          } else if (token.type === 'keyword') {
              const clauseName = token.string.toUpperCase();
              const clauseDoc = plotClauseDocs[clauseName];
              if (clauseDoc) {
                  tooltipContent = React.createElement(PlotTooltipContent, { item: clauseDoc, type: 'clause' });
              }
          }
      }

      if (tooltipContent) {
          const margin = 5;
          const tooltipMaxWidth = 320;
          const tooltipMaxHeight = 250; // Estimate
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;

          let top = e.clientY + margin;
          let left = e.clientX + margin;

          if (top + tooltipMaxHeight > viewportHeight) {
              top = e.clientY - tooltipMaxHeight - margin;
              if (top < 0) top = margin; // prevent going off-screen top
          }
          if (left + tooltipMaxWidth > viewportWidth) {
              left = e.clientX - tooltipMaxWidth - margin;
              if (left < 0) left = margin; // prevent going off-screen left
          }
          setTooltip({ visible: true, content: tooltipContent, top, left });
      } else {
          setTooltip(null);
      }
    };

    const handleMouseOut = () => { 
        currentTooltipToken = null;
        hideTimeout = window.setTimeout(() => setTooltip(null), 200); 
    };

    wrapper.addEventListener('mousemove', handleMouseMove);
    wrapper.addEventListener('mouseout', handleMouseOut);
    return () => {
      wrapper.removeEventListener('mousemove', handleMouseMove);
      wrapper.removeEventListener('mouseout', handleMouseOut);
      if (hideTimeout) clearTimeout(hideTimeout);
    };
  }, [combinedSchemaWithLookups, mode]);


  useEffect(() => {
    const editor = codeMirrorInstance.current;
    if (editor && editor.getValue() !== value) {
      const cursor = editor.getCursor();
      editor.setValue(value);
      editor.setCursor(cursor);
    }
  }, [value]);

  useEffect(() => {
    if (codeMirrorInstance.current && autoFocus) {
        codeMirrorInstance.current.focus();
        codeMirrorInstance.current.setCursor(codeMirrorInstance.current.lineCount(), 0);
    }
  }, [autoFocus]);


  return <>
    <div ref={editorRef} className={`w-full ${fullHeight ? 'h-full' : ''}`} />
    {tooltip?.visible && ReactDOM.createPortal(
      <div style={{ top: tooltip.top, left: tooltip.left }} className="absolute z-[100] p-2 bg-gray-700 border border-gray-600 rounded shadow-lg w-auto max-w-xs animate-fade-in pointer-events-none">
        {tooltip.content}
      </div>,
      document.body
    )}
  </>;
};

export default React.memo(SQLEditor);