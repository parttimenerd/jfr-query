import React, { useState, useRef, useCallback, useEffect, useContext, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { TableSchema, ViewSchema, MacroSchema, NotebookMetadata } from '../types';
import { SchemaTooltipContent } from './SchemaTooltipContent';
import { DatabaseIcon } from './icons/DatabaseIcon';
import { TableIcon } from './icons/TableIcon';
import { ViewIcon } from './icons/ViewIcon';
import { CodeBracketIcon } from './icons/CodeBracketIcon';
import { SearchIcon } from './icons/SearchIcon';
import SQLEditor from './SQLEditor';
import { PlayIcon } from './icons/PlayIcon';
import DataTable from './DataTable';
import { DataContext } from '../context/DuckDBContext';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';
import { ViewColumnsIcon } from './icons/ViewColumnsIcon';
import { EyeIcon } from './icons/EyeIcon';
import { SortAZIcon } from './icons/SortAZIcon';
import { ChartBarIcon } from './icons/ChartBarIcon';
import { PencilIcon } from './icons/PencilIcon';
import { ArrowPathIcon } from './icons/ArrowPathIcon';

const HEADER_HEIGHT = 36; // px
const MIN_PANEL_HEIGHT = 40; // px
const RESIZER_HEIGHT = 1; // px
const INITIAL_PANEL_PROPORTIONS = [4, 3, 3, 6]; 
const INITIAL_COLLAPSED_STATES = { tables: false, views: false, macros: false, preview: false };

type SelectedItem = {
    name: string;
    type: 'table' | 'view' | 'macro';
};

function debounce<T extends (...args: any[]) => any>(func: T, delay: number): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return function(this: any, ...args: Parameters<T>) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

interface SidebarProps {
    metadata: NotebookMetadata;
}

const Sidebar: React.FC<SidebarProps> = ({ metadata }) => {
  const { schema, query: runDbQuery, refreshSchema } = useContext(DataContext);
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [previewQuery, setPreviewQuery] = useState(``);
  const [previewQueryResults, setPreviewQueryResults] = useState<any[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [showInternalViews, setShowInternalViews] = useState(false);
  const [isPreviewEditorVisible, setIsPreviewEditorVisible] = useState(() => {
    try { return JSON.parse(localStorage.getItem('jfr-sidebar-editor-visible') || 'false'); } catch { return false; }
  });
  const [isPreviewSearchVisible, setIsPreviewSearchVisible] = useState(false);
  const [tableSort, setTableSort] = useState<'alpha' | 'count'>('alpha');
  const [previewFocusTrigger, setPreviewFocusTrigger] = useState(0);

  const [tooltip, setTooltip] = useState<{ visible: boolean; content: React.ReactNode; top: number; left: number } | null>(null);
  const hideTimeout = useRef<number | null>(null);

  useEffect(() => { try { localStorage.setItem('jfr-sidebar-editor-visible', JSON.stringify(isPreviewEditorVisible)); } catch {} }, [isPreviewEditorVisible]);

  const [collapsedStates, setCollapsedStates] = useState(INITIAL_COLLAPSED_STATES);
  const [panelBasis, setPanelBasis] = useState<number[]>([]);
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);

  const handleCopyName = useCallback((name: string) => {
    navigator.clipboard.writeText(name).then(() => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      setCopiedName(name);
      copyTimeoutRef.current = window.setTimeout(() => setCopiedName(null), 1200);
    }).catch(() => {});
  }, []);
  const activeResizerIndex = useRef<number | null>(null);
  const initialDragState = useRef({ y: 0, basis: [0, 0] });
  const containerRef = useRef<HTMLDivElement>(null);

  const autoSelectedRef = useRef(false);
  useEffect(() => { autoSelectedRef.current = false; }, [schema]);
  const handleItemSelectRef = useRef<typeof handleItemSelect>(null as any);
  useEffect(() => {
    if (!autoSelectedRef.current && schema?.tables && schema.tables.length > 0 && !selectedItem) {
        autoSelectedRef.current = true;
        handleItemSelectRef.current(schema.tables[0].name, 'table');
    }
  }, [schema, selectedItem]);

  useEffect(() => { setTooltip(null); }, [schema]);

  useEffect(() => {
    return () => {
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleShowTooltip = (e: React.MouseEvent, content: React.ReactNode) => {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    
    const margin = 5;
    const tooltipMaxWidth = 320; // max-w-xs
    const tooltipMaxHeight = 250; // A reasonable estimate for height
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = e.clientY + margin;
    let left = e.clientX + margin;
    
    if (top + tooltipMaxHeight > viewportHeight) {
        top = e.clientY - tooltipMaxHeight - margin;
        if (top < 0) top = margin;
    }
    
    if (left + tooltipMaxWidth > viewportWidth) {
        left = e.clientX - tooltipMaxWidth - margin;
        if (left < 0) left = margin;
    }
    
    setTooltip({ visible: true, content, top, left });
  };

  const handleHideTooltip = () => {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    hideTimeout.current = window.setTimeout(() => setTooltip(null), 100);
  };
  
  const runPreviewQuery = useCallback(async (query: string) => {
    setPreviewError(null);
    if (!query.trim() || !runDbQuery) {
        setPreviewQueryResults([]);
        return;
    }
    setIsLoadingPreview(true);
    try {
        const results = await runDbQuery(query);
        setPreviewQueryResults(results);
        if(results.length === 0) {
            setPreviewError("Query returned no results.");
        }
    } catch (error) {
        setPreviewQueryResults([]);
        const errorMsg = error instanceof Error ? error.message : String(error);
        setPreviewError(errorMsg);
    } finally {
        setIsLoadingPreview(false);
    }
  }, [runDbQuery]);
  
  const runPreviewQueryRef = useRef(runPreviewQuery);
  runPreviewQueryRef.current = runPreviewQuery;
  const debouncedRunPreview = useRef(debounce((q: string) => runPreviewQueryRef.current(q), 500)).current;
  const handlePreviewQueryChange = (newQuery: string) => {
    setPreviewQuery(newQuery);
    debouncedRunPreview(newQuery);
  };

  const filteredTables = useMemo(() => {
    const lc = searchTerm.toLowerCase();
    const filtered = (schema?.tables || []).filter(table =>
        table.name.toLowerCase().includes(lc) ||
        table.columns?.some(col => col.name.toLowerCase().includes(lc))
    );

    if (tableSort === 'alpha') {
        filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else if (tableSort === 'count') {
        filtered.sort((a, b) => {
            const countA = a.rowCount ?? -1;
            const countB = b.rowCount ?? -1;
            return countB - countA;
        });
    }

    return filtered;
  }, [schema?.tables, searchTerm, tableSort]);

  const filteredViews = useMemo(() => {
    const lc = searchTerm.toLowerCase();
    return (schema?.views || []).filter(view => {
      const searchMatch = view.name.toLowerCase().includes(lc) ||
          (view.columns?.some(col => col.name.toLowerCase().includes(lc)));
      if (!searchMatch) return false;
      if (!showInternalViews && view.internal) return false;
      return true;
    });
  }, [schema?.views, searchTerm, showInternalViews]);

  const filteredMacros = useMemo(() => {
    const lc = searchTerm.toLowerCase();
    return (schema?.macros || []).filter(macro => macro.name.toLowerCase().includes(lc));
  }, [schema?.macros, searchTerm]);

  const handleItemSelect = (name: string, type: 'table' | 'view' | 'macro', userInitiated: boolean = false) => {
    setSelectedItem({ name, type });
    let defaultQuery;
    if (type === 'macro') {
        const macro = schema?.macros.find(m => m.name === name);
        const paramList = macro?.parameters || [];
        // Use the macro's own parameter names (or numbered placeholders) so the
        // user has a real template to edit. Don't auto-run because the args
        // are placeholders and will always fail.
        const paramNames = paramList.length > 0
            ? paramList.join(', ')
            : '';
        defaultQuery = `SELECT ${name}(${paramNames});`;
        setPreviewQuery(defaultQuery);
        if (userInitiated) {
            setIsPreviewEditorVisible(true);
            setPreviewFocusTrigger(t => t + 1);
        }
        // Skip running — caller has to fill in real arguments first.
        return;
    } else {
        defaultQuery = `SELECT * FROM "${name}" LIMIT 20;`;
    }
    setPreviewQuery(defaultQuery);
    if (userInitiated) {
        setIsPreviewEditorVisible(true);
        setPreviewFocusTrigger(t => t + 1);
    }
    runPreviewQuery(defaultQuery);
  };

  handleItemSelectRef.current = handleItemSelect;

  const initializeLayout = useCallback(() => {
    if (containerRef.current) {
        const numPanels = INITIAL_PANEL_PROPORTIONS.length;
        const numResizers = numPanels - 1;
        const containerHeight = containerRef.current.clientHeight;
        const availableHeight = containerHeight - (numResizers * RESIZER_HEIGHT);
        
        if (availableHeight <= 0) return;

        const totalProportions = INITIAL_PANEL_PROPORTIONS.reduce((a, b) => a + b, 0);
        const initialBasis = INITIAL_PANEL_PROPORTIONS.map(p => (p / totalProportions) * availableHeight);
        
        setPanelBasis(initialBasis);
        setCollapsedStates(INITIAL_COLLAPSED_STATES);
    }
  }, []);

  useEffect(() => {
      initializeLayout();
  }, [initializeLayout]);


  const handleResizeStart = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    activeResizerIndex.current = index;
    initialDragState.current = {
      y: e.clientY,
      basis: [panelBasis[index], panelBasis[index + 1]],
    };
  };

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (activeResizerIndex.current === null) return;

    const index = activeResizerIndex.current;
    const deltaY = e.clientY - initialDragState.current.y;
    const [initialBasis1, initialBasis2] = initialDragState.current.basis;

    let newBasis1 = initialBasis1 + deltaY;
    let newBasis2 = initialBasis2 - deltaY;

    if (newBasis1 < MIN_PANEL_HEIGHT) {
      newBasis2 += newBasis1 - MIN_PANEL_HEIGHT;
      newBasis1 = MIN_PANEL_HEIGHT;
    }
    if (newBasis2 < MIN_PANEL_HEIGHT) {
      newBasis1 += newBasis2 - MIN_PANEL_HEIGHT;
      newBasis2 = MIN_PANEL_HEIGHT;
    }
    
    setPanelBasis(prevBasis =>
      prevBasis.map((b, i) => (i === index ? newBasis1 : i === index + 1 ? newBasis2 : b))
    );
  }, []);

  const handleResizeEnd = useCallback(() => {
    activeResizerIndex.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeEnd);
    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [handleResizeMove, handleResizeEnd]);

  const toggleCollapse = (index: number) => {
    const panelId = ['tables', 'views', 'macros', 'preview'][index] as keyof typeof collapsedStates;
    setCollapsedStates(prev => ({ ...prev, [panelId]: !prev[panelId] }));
  };

  const panelConfigs = [
    { id: 'tables', title: 'Tables', icon: <TableIcon className="w-4 h-4" />, data: filteredTables, component: (
      <ul>
        {filteredTables.map(table => (
        <li 
            key={table.name}
            onMouseEnter={(e) => handleShowTooltip(e, <SchemaTooltipContent item={table} type="table" />)}
            onMouseLeave={handleHideTooltip}
        >
            <button
            onClick={() => handleItemSelect(table.name, 'table', true)}
            onDoubleClick={() => handleCopyName(table.name)}
            title={`Click to preview · Double-click to copy name`}
            className={`w-full text-left py-1 px-2 rounded-md transition-colors text-sm flex items-center gap-2 ${copiedName === table.name ? 'bg-green-600/30 text-green-300' : selectedItem?.name === table.name && selectedItem.type === 'table' ? 'bg-cyan-600/30 text-cyan-300' : 'hover:bg-gray-700/50 text-gray-400'}`}
            >
            <TableIcon className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{table.name}</span>
            <span className="ml-auto text-xs text-gray-500 font-mono pr-2 shrink-0" data-row-count={table.rowCount}>{typeof table.rowCount === 'number' ? table.rowCount.toLocaleString() : '-'}</span>
            </button>
        </li>
        ))}
      </ul>
    )},
    { id: 'views', title: 'Views', icon: <ViewIcon className="w-4 h-4" />, data: filteredViews, component: (
        <ul>
        {filteredViews.map(view => (
        <li 
            key={view.name}
            onMouseEnter={(e) => handleShowTooltip(e, <SchemaTooltipContent item={view} type="view" />)}
            onMouseLeave={handleHideTooltip}
        >
            <button
                onClick={() => handleItemSelect(view.name, 'view', true)}
                onDoubleClick={() => handleCopyName(view.name)}
                title={`Click to preview · Double-click to copy name`}
                className={`w-full text-left py-1 px-2 rounded-md transition-colors text-sm flex items-center gap-2 ${copiedName === view.name ? 'bg-green-600/30 text-green-300' : selectedItem?.name === view.name && selectedItem.type === 'view' ? 'bg-cyan-600/30 text-cyan-300' : 'hover:bg-gray-700/50 text-gray-400'}`}
            >
            <ViewIcon className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{view.name}</span>
            </button>
        </li>
        ))}
    </ul>
    )},
    { id: 'macros', title: 'Macros', icon: <CodeBracketIcon className="w-4 h-4" />, data: filteredMacros, component: (
       <ul>
        {filteredMacros.map(macro => (
        <li 
            key={macro.name}
            onMouseEnter={(e) => handleShowTooltip(e, <SchemaTooltipContent item={macro} type="macro" />)}
            onMouseLeave={handleHideTooltip}
        >
            <button
                onClick={() => handleItemSelect(macro.name, 'macro', true)}
                onDoubleClick={() => handleCopyName(macro.name)}
                title={`Click to preview · Double-click to copy name`}
                className={`w-full text-left py-1 px-2 rounded-md transition-colors text-sm flex items-center gap-2 ${copiedName === macro.name ? 'bg-green-600/30 text-green-300' : selectedItem?.name === macro.name && selectedItem.type === 'macro' ? 'bg-cyan-600/30 text-cyan-300' : 'hover:bg-gray-700/50 text-gray-400'}`}
            >
            <CodeBracketIcon className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{macro.name}</span>
            </button>
        </li>
        ))}
    </ul>
    )},
    { id: 'preview', title: 'Preview', icon: <PlayIcon className="w-4 h-4" />, data: [], component: (
      <div className="h-full flex flex-col">
        {isPreviewEditorVisible && (
            <div className="flex-shrink-0 p-1 animate-fade-in-down">
                <div className="relative border border-gray-700 rounded-md overflow-hidden">
                    <SQLEditor value={previewQuery} onChange={handlePreviewQueryChange} metadata={metadata} focusTrigger={previewFocusTrigger} />
                </div>
            </div>
        )}
        <div className="overflow-auto flex-grow bg-gray-800/50 rounded-b-lg">
        {isLoadingPreview ? (
             <div className="text-center text-gray-500 text-xs p-2">Running...</div>
        ) : previewQueryResults && previewQueryResults.length > 0 ? (
            <DataTable data={previewQueryResults} showSearch={isPreviewSearchVisible} />
        ) : (
            <div className="text-center text-gray-500 text-xs p-2">{previewError || 'Select an item or edit query to preview.'}</div>
        )}
        </div>
      </div>
    )},
  ];
  
  return (
    <div className="w-full h-full flex flex-col bg-gray-900">
      <div className="flex-shrink-0 px-4 py-2 border-b border-gray-700 space-y-2" data-tour="schema-explorer">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <DatabaseIcon className="w-5 h-5" />
                Schema Explorer
            </h2>
            <button onClick={initializeLayout} title="Reset Layout" aria-label="Reset Layout" className="text-gray-400 hover:text-cyan-400 p-1">
                <ViewColumnsIcon className="w-4 h-4" />
            </button>
            <button onClick={() => refreshSchema()} title="Refresh Schema" aria-label="Refresh Schema" className="text-gray-400 hover:text-cyan-400 p-1">
                <ArrowPathIcon className="w-4 h-4" />
            </button>
          </div>
        <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
                type="text"
                placeholder="Search schema..."
                aria-label="Search schema"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); setSearchTerm(''); } }}
                className="w-full bg-gray-800/50 border border-gray-700 rounded-md py-1.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
        </div>
      </div>
      <div className="flex-grow overflow-hidden flex flex-col" ref={containerRef}>
        {panelConfigs.map((panel, index) => {
            const currentPanelKey = panel.id as keyof typeof collapsedStates;
            const nextPanelKey = index < panelConfigs.length - 1 ? panelConfigs[index + 1].id as keyof typeof collapsedStates : null;
            const isCurrentCollapsed = collapsedStates[currentPanelKey];
            const isNextCollapsed = nextPanelKey ? collapsedStates[nextPanelKey] : true;
            const showResizer = index < panelConfigs.length - 1 && !isCurrentCollapsed && !isNextCollapsed;

            const panelStyle: React.CSSProperties = isCurrentCollapsed ? {
                flexGrow: 0,
                flexShrink: 0,
                flexBasis: `${HEADER_HEIGHT}px`,
                overflow: 'hidden',
            } : {
                flexGrow: 1,
                flexShrink: 1,
                flexBasis: `${panelBasis[index] ?? 0}px`,
                minHeight: `${MIN_PANEL_HEIGHT}px`,
                overflow: 'hidden',
            };

            return (
                <React.Fragment key={panel.id}>
                    <div 
                        className="flex flex-col"
                        style={panelStyle}
                    >
                        <div 
                            onClick={() => toggleCollapse(index)}
                            className="h-9 flex-shrink-0 flex items-center justify-between px-3 cursor-pointer bg-gray-800/50 hover:bg-gray-700/50"
                        >
                            <div className="flex items-center gap-2">
                                {panel.icon}
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{panel.title}</h3>
                                {panel.data.length > 0 && <span className="text-xs text-gray-500 font-mono">({panel.data.length})</span>}
                            </div>
                            <div className="flex items-center gap-2">
                                {panel.id === 'tables' && (
                                    <>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); setTableSort('alpha'); }}
                                            title="Sort alphabetically" aria-label="Sort alphabetically"
                                            className={`p-1 rounded-md ${tableSort === 'alpha' ? 'text-cyan-300 bg-cyan-600/20' : 'text-gray-400 hover:text-gray-200'}`}
                                        >
                                            <SortAZIcon className="w-4 h-4" />
                                        </button>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); setTableSort('count'); }}
                                            title="Sort by row count" aria-label="Sort by row count"
                                            className={`p-1 rounded-md ${tableSort === 'count' ? 'text-cyan-300 bg-cyan-600/20' : 'text-gray-400 hover:text-gray-200'}`}
                                        >
                                            <ChartBarIcon className="w-4 h-4" />
                                        </button>
                                    </>
                                )}
                                {panel.id === 'preview' && (
                                    <>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); setIsPreviewSearchVisible(s => !s); }}
                                            title={isPreviewSearchVisible ? "Hide Search" : "Show Search"}
                                            className={`p-1 rounded-md ${isPreviewSearchVisible ? 'text-cyan-300 bg-cyan-600/20' : 'text-gray-400 hover:text-gray-200'}`}
                                        >
                                            <SearchIcon className="w-4 h-4" />
                                        </button>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); setIsPreviewEditorVisible(s => !s); }}
                                            title={isPreviewEditorVisible ? "Hide Query Editor" : "Show Query Editor"}
                                            className={`p-1 rounded-md ${isPreviewEditorVisible ? 'text-cyan-300 bg-cyan-600/20' : 'text-gray-400 hover:text-gray-200'}`}
                                        >
                                            <PencilIcon className="w-4 h-4" />
                                        </button>
                                    </>
                                )}
                                {panel.id === 'views' && (
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); setShowInternalViews(s => !s); }}
                                        title={showInternalViews ? "Hide Internal Views" : "Show Internal Views"}
                                        className={`p-1 rounded-md ${showInternalViews ? 'text-cyan-300 bg-cyan-600/20' : 'text-gray-400 hover:text-gray-200'}`}
                                    >
                                        <EyeIcon className="w-4 h-4" />
                                    </button>
                                )}
                                {isCurrentCollapsed ? <ChevronDownIcon className="w-4 h-4 text-gray-400"/> : <ChevronUpIcon className="w-4 h-4 text-gray-400"/>}
                            </div>
                        </div>
                        <div
                            className="overflow-auto flex-grow px-2 py-1 sidebar-list-font min-h-0"
                        >
                            {panel.component}
                        </div>
                    </div>
                    {showResizer && (
                        <div 
                            onMouseDown={(e) => handleResizeStart(index, e)}
                            className="flex-shrink-0 bg-gray-800 hover:bg-cyan-600 cursor-ns-resize transition-colors"
                            style={{ height: `${RESIZER_HEIGHT}px` }}
                        />
                    )}
                </React.Fragment>
            )
        })}
      </div>
       {tooltip?.visible && ReactDOM.createPortal(
            <div
                style={{ top: tooltip.top, left: tooltip.left, maxHeight: '250px' }}
                className="fixed z-[100] p-2 bg-gray-700 border border-gray-600 rounded shadow-lg w-auto max-w-xs animate-fade-in overflow-y-auto"
                onMouseEnter={() => { if (hideTimeout.current) clearTimeout(hideTimeout.current); }}
                onMouseLeave={handleHideTooltip}
            >
                {tooltip.content}
            </div>,
            document.body
        )}
    </div>
  );
};

export default React.memo(Sidebar);