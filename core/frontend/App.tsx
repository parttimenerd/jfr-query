import React, { useState, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import Sidebar from './components/Sidebar';
import Notebook from './components/Notebook';
import ChatPanel from './components/ChatPanel';
import ResizablePanel from './components/ResizablePanel';
import FileLoader from './components/FileLoader';
import JFRDropZone from './components/JFRDropZone';
import SettingsModal from './components/SettingsModal';
import ToastNotification from './components/ToastNotification';
import { DataContext, DBState } from './context/DuckDBContext';
import { SettingsContext } from './context/SettingsContext';
import { DisplaySettingsProvider } from './context/DisplaySettingsContext';
import { useHistoryState } from './hooks/useHistoryState';
import { aiService } from './services/AiService';
import type { NotebookCellData, NotebookMetadata } from './types';
import { initialNotebook } from './data/mockData';
import { parseNotebook, reconstructNotebook, tokenizeCellContent, reconstructCellContent, parseCellContent } from './utils/notebookParser';
import { formatPlotCode } from './utils/plotFormatter';

import { ArrowUturnLeftIcon } from './components/icons/ArrowUturnLeftIcon';
import { ArrowUturnRightIcon } from './components/icons/ArrowUturnRightIcon';
import { PlayCircleIcon } from './components/icons/PlayCircleIcon';
import { PauseCircleIcon } from './components/icons/PauseCircleIcon';
import { ChevronDoubleRightIcon } from './components/icons/ChevronDoubleRightIcon';
import { ChevronDoubleLeftIcon } from './components/icons/ChevronDoubleLeftIcon';
import { ChevronDoubleUpIcon } from './components/icons/ChevronDoubleUpIcon';
import { ChevronDoubleDownIcon } from './components/icons/ChevronDoubleDownIcon';
import { CogIcon } from './components/icons/CogIcon';
import { ArrowUpTrayIcon } from './components/icons/ArrowUpTrayIcon';
import { SparklesIcon } from './components/icons/SparklesIcon';
import { CodeBracketIcon } from './components/icons/CodeBracketIcon';
import { ArrowDownTrayIcon } from './components/icons/ArrowDownTrayIcon';


function usePersistentState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [state, setState] = useState<T>(() => {
        try {
            const storedValue = localStorage.getItem(key);
            return storedValue !== null ? JSON.parse(storedValue) : defaultValue;
        } catch (error) {
            console.warn(`Error reading localStorage key "${key}":`, error);
            return defaultValue;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem(key, JSON.stringify(state));
        } catch (error) {
            console.warn(`Error setting localStorage key "${key}":`, error);
        }
    }, [key, state]);

    return [state, setState];
}


const App: React.FC = () => {
    const {
        dbState, mode, errorMessage, query, refreshSchema, loadJfrFile
    } = useContext(DataContext);
    
    const { settings } = useContext(SettingsContext);
    const [isAiAvailable, setIsAiAvailable] = useState(false);
    const hasAiWorkedBefore = useRef(false);
    const [aiFailureMessage, setAiFailureMessage] = useState<string | null>(null);

    const [isAiEnabled, setIsAiEnabled] = usePersistentState('jfr-notebook-ai-enabled', true);
    
    const isAiFeatureActive = isAiAvailable && isAiEnabled;

    useEffect(() => {
        let isMounted = true;
        const initializeAndVerifyAI = async () => {
            const isInitialized = aiService.initialize(settings);
            if (isInitialized) {
                try {
                    const isVerified = await aiService.verifyCredentials();
                    if (isMounted && isVerified) {
                        setIsAiAvailable(true);
                        hasAiWorkedBefore.current = true;
                    }
                } catch (error) {
                    console.warn("AI verification failed on startup:", error);
                }
            }
        };

        aiService.registerErrorCallback(() => {
            if (isMounted) {
                setIsAiAvailable(false);
                if (hasAiWorkedBefore.current) {
                    setAiFailureMessage("AI features disabled due to an API error (e.g., invalid key or quota exceeded).");
                    hasAiWorkedBefore.current = false; 
                }
            }
        });
        
        initializeAndVerifyAI();
        return () => {
            isMounted = false;
            aiService.registerErrorCallback(null); // clear stale callback
        };
    }, [settings]);


    const [notebookMarkdown, setNotebookMarkdown, undo, redo, canUndo, canRedo] = useHistoryState<string>(initialNotebook, 'jfr-notebook-content');
    const [results, setResults] = useState<Record<string, (any[] | null)[]>>({});
    const [isSidebarCollapsed, setIsSidebarCollapsed] = usePersistentState('jfr-ui-sidebarCollapsed', false);
    const [isChatPanelCollapsed, setIsChatPanelCollapsed] = usePersistentState('jfr-ui-chatPanelCollapsed', true);
    const [isAutoRunEnabled, setIsAutoRunEnabled] = usePersistentState('jfr-ui-autoRunEnabled', true);
    const [isMarkdownMode, setIsMarkdownMode] = usePersistentState('jfr-ui-markdownMode', false);
    const [collapseTrigger, setCollapseTrigger] = useState(0);
    const [allCollapsed, setAllCollapsed] = useState(false);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

    const notebookFileInputRef = useRef<HTMLInputElement>(null);

    const handleLoadNotebook = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result;
            if (typeof text === 'string') {
                setNotebookMarkdown(text);
            }
        };
        reader.readAsText(file);
        // Reset so the same file can be re-loaded
        e.target.value = '';
    };

    const handleSaveNotebook = () => {
        const blob = new Blob([notebookMarkdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'notebook.md';
        a.click();
        URL.revokeObjectURL(url);
    };

    const { metadata, content: cellsContent } = useMemo(() => parseNotebook(notebookMarkdown), [notebookMarkdown]);

    const displaySettings = useMemo(() => ({
        timeFormat: metadata.timeFormat || settings.timeFormat,
        decimalPlaces: metadata.decimalPlaces ?? settings.decimalPlaces,
    }), [metadata, settings]);

    const cells = useMemo(() => {
        const cellContents = cellsContent.split(/\n\n---\n\n/);
        return cellContents.map((content, index) => {
            // Generate a stable ID based on content hash to avoid index-shifting bugs.
            // Use a simple hash of the first 100 chars + index as tiebreaker.
            const hashBase = content.substring(0, 100) + index;
            let hash = 0;
            for (let i = 0; i < hashBase.length; i++) {
                hash = ((hash << 5) - hash) + hashBase.charCodeAt(i);
                hash |= 0;
            }
            return {
                id: `cell-${Math.abs(hash).toString(36)}`,
                title: '',
                content: content,
            };
        });
    }, [cellsContent]);

    const runQuery = useCallback(async (cellId: string, sql: string, queryIndex: number, allVariables: Record<string,string>) => {
        try {
            let subSql = sql;
            for (const v in allVariables) {
                // Ensure we don't replace parts of words, e.g., $v in $v2.
                subSql = subSql.replace(new RegExp(`\\${v}(?!\\w)`, 'g'), allVariables[v]);
            }
            
            const remainingVars = subSql.match(/\$\w+/g);
            if (remainingVars && remainingVars.length > 0) {
                 const uniqueRemaining = [...new Set(remainingVars)];
                 const varList = uniqueRemaining.join(', ');
                 throw new Error(`Undefined variable(s) found: ${varList}. Please define them in the cell's 'variables' block or in the notebook settings.`);
            }

            const data = await query(subSql);
            setResults(prev => {
                const newCellResults = [...(prev[cellId] || [])];
                newCellResults[queryIndex] = data;
                return { ...prev, [cellId]: newCellResults };
            });
        } catch (error: any) {
            setResults(prev => {
                const newCellResults = [...(prev[cellId] || [])];
                newCellResults[queryIndex] = [{ error: error.message || String(error) }];
                return { ...prev, [cellId]: newCellResults };
            });
        }
    }, [query]);

    const updateCellsAndMarkdown = (newCells: NotebookCellData[]) => {
        const newCellsContent = newCells.map(cell => cell.content).join('\n\n---\n\n');
        const newNotebookMarkdown = reconstructNotebook({ metadata, content: newCellsContent });
        setNotebookMarkdown(newNotebookMarkdown);
    };

    const addCell = () => {
        const newCell: NotebookCellData = {
            id: `cell-${Date.now()}`,
            title: ``,
            content: '# New Cell\n\n'
        };
        const newCells = [...cells, newCell];
        updateCellsAndMarkdown(newCells);
    };
    
    const addCellFromAI = (sql: string, plotConfig: string, title: string, markdownText: string) => {
        const content = reconstructCellContent([
            { type: 'markdown', content: `# ${title}\n\n${markdownText}` },
            { type: 'markdown', content: '\n\n' },
            { type: 'sql', content: `\n${sql}\n` },
            { type: 'markdown', content: '\n\n' },
            { type: 'plot', content: `\n${plotConfig}\n` },
        ]);
        const newCell: NotebookCellData = {
            id: `cell-${Date.now()}`,
            title: '',
            content: content,
        };
        const newCells = [...cells, newCell];
        updateCellsAndMarkdown(newCells);
    };


    const deleteCell = (cellId: string) => {
        const newCells = cells.filter(cell => cell.id !== cellId);
        updateCellsAndMarkdown(newCells);
        setResults(prev => {
            const next = { ...prev };
            delete next[cellId];
            return next;
        });
    };

    const updateCell = (cellId: string, updatedContent: string) => {
        const newCells = cells.map(cell => cell.id === cellId ? { ...cell, content: updatedContent } : cell);
        updateCellsAndMarkdown(newCells);
    };
    
    const deleteQueryBlock = (cellId: string, index: number) => {
        const cell = cells.find(c => c.id === cellId);
        if (!cell) return;

        const segments = tokenizeCellContent(cell.content);
        let sqlBlockCount = -1;
        let sqlSegmentIndex = -1;
        
        for(let i = 0; i < segments.length; i++) {
            if (segments[i].type === 'sql') {
                sqlBlockCount++;
                if (sqlBlockCount === index) {
                    sqlSegmentIndex = i;
                    break;
                }
            }
        }
        if (sqlSegmentIndex === -1) return;

        let plotSegmentIndex = -1;
        for (let i = sqlSegmentIndex + 1; i < segments.length; i++) {
            if (segments[i].type === 'plot') {
                plotSegmentIndex = i;
                break;
            }
            if (segments[i].type === 'sql') break;
        }

        const newSegments = [...segments];
        // Remove plot first (if it exists) to not mess up indices
        if(plotSegmentIndex !== -1) newSegments.splice(plotSegmentIndex, 1);
        newSegments.splice(sqlSegmentIndex, 1);
        
        const updatedContent = reconstructCellContent(newSegments);
        updateCell(cellId, updatedContent);
    };

    const moveCell = (draggedId: string, targetId: string, position: 'before' | 'after') => {
        const draggedIndex = cells.findIndex(c => c.id === draggedId);
        const targetIndex = cells.findIndex(c => c.id === targetId);
        if (draggedIndex === -1 || targetIndex === -1) return;

        const newCells = [...cells];
        const [draggedItem] = newCells.splice(draggedIndex, 1);

        const insertionIndex = position === 'before'
            ? (draggedIndex < targetIndex ? targetIndex - 1 : targetIndex)
            : (draggedIndex < targetIndex ? targetIndex : targetIndex + 1);
        
        newCells.splice(insertionIndex, 0, draggedItem);
        updateCellsAndMarkdown(newCells);
    };

    const suggestPlot = async (sql: string, customPromptOverride?: string): Promise<string | null> => {
        if (!isAiFeatureActive) return null;
        try {
            return await aiService.getAiSuggestPlot(sql, customPromptOverride);
        } catch (error) {
            console.error("Error suggesting plot:", error);
            return null;
        }
    };

    const formatCode = async (code: string, type: 'sql' | 'plot'): Promise<string | null> => {
        if (type === 'plot') {
            return formatPlotCode(code);
        }
        if (!isAiFeatureActive) return code;
        try {
            return await aiService.getAiCodeFormat(code);
        } catch (error) {
            console.error("Error formatting code:", error);
            return code;
        }
    };
    
    const runPreviewQuery = async (queryToRun: string): Promise<any[]> => {
        try {
            return await query(queryToRun);
        } catch (error) {
            console.error("Preview query failed:", error);
            if (error instanceof Error) {
                return [{ error: error.message }];
            }
            return [{ error: String(error) }];
        }
    };
    
    const handleMetadataChange = async (newMetadata: NotebookMetadata) => {
        const newNotebookMarkdown = reconstructNotebook({ metadata: newMetadata, content: cellsContent });
        setNotebookMarkdown(newNotebookMarkdown);
        await refreshSchema();
    };

    if (dbState !== DBState.READY) {
        if (mode === 'wasm' && (dbState === DBState.NEEDS_FILE || dbState === DBState.IMPORTING || dbState === DBState.ERROR)) {
            return (
                <JFRDropZone
                    onFileSelected={(bytes) => { void loadJfrFile(bytes); }}
                    isImporting={dbState === DBState.IMPORTING}
                    errorMessage={dbState === DBState.ERROR ? errorMessage : null}
                />
            );
        }
        return <FileLoader dbState={dbState} errorMessage={errorMessage} />;
    }
    
    return (
      <DisplaySettingsProvider value={displaySettings}>
        <div className="flex flex-col h-screen bg-gray-800 text-gray-200 font-sans">
            <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />
            {aiFailureMessage && <ToastNotification message={aiFailureMessage} onClose={() => setAiFailureMessage(null)} action={{ label: 'Open Settings →', onClick: () => setIsSettingsModalOpen(true) }} />}

            <header className="flex-shrink-0 h-14 bg-gray-900/50 border-b border-gray-700 flex items-center justify-between px-4 z-30">
                <div className="flex items-center gap-4">
                    <h1 className="text-lg font-semibold text-gray-200">JFR Query Notebook</h1>
                    {mode && (
                        <span
                            className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                mode === 'wasm'
                                    ? 'border-cyan-500/40 text-cyan-300 bg-cyan-900/20'
                                    : 'border-gray-600 text-gray-400 bg-gray-800/40'
                            }`}
                            title={mode === 'wasm' ? 'Running in-browser via DuckDB-WASM' : 'Connected to a jfr-query server'}
                        >
                            {mode === 'wasm' ? 'WASM' : 'Server'} mode
                        </span>
                    )}
                    <div className="flex items-center gap-2">
                        <button onClick={undo} disabled={!canUndo} className="p-1.5 rounded-md disabled:opacity-50 text-gray-400 disabled:text-gray-600 hover:enabled:bg-gray-700/50"><ArrowUturnLeftIcon className="w-5 h-5"/></button>
                        <button onClick={redo} disabled={!canRedo} className="p-1.5 rounded-md disabled:opacity-50 text-gray-400 disabled:text-gray-600 hover:enabled:bg-gray-700/50"><ArrowUturnRightIcon className="w-5 h-5"/></button>
                        <div className="w-px h-6 bg-gray-700 mx-2" />
                        <button onClick={() => setIsAutoRunEnabled(!isAutoRunEnabled)} className={`p-1.5 rounded-md ${isAutoRunEnabled ? 'text-cyan-300' : 'text-gray-400'}`} title={isAutoRunEnabled ? "Disable Auto-Run" : "Enable Auto-Run"}>
                            {isAutoRunEnabled ? <PauseCircleIcon className="w-5 h-5" /> : <PlayCircleIcon className="w-5 h-5" />}
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => { setCollapseTrigger(Date.now()); setAllCollapsed(true); }} className="p-1.5 rounded-md text-gray-400 hover:text-cyan-300" title="Collapse All"><ChevronDoubleUpIcon className="w-5 h-5"/></button>
                    <button onClick={() => { setCollapseTrigger(Date.now()); setAllCollapsed(false); }} className="p-1.5 rounded-md text-gray-400 hover:text-cyan-300" title="Expand All"><ChevronDoubleDownIcon className="w-5 h-5"/></button>
                    <div className="w-px h-6 bg-gray-700 mx-2" />
                    <input ref={notebookFileInputRef} type="file" accept=".md,.txt" className="hidden" onChange={handleLoadNotebook} />
                    <button onClick={() => notebookFileInputRef.current?.click()} className="p-1.5 rounded-md text-gray-400 hover:text-cyan-300" title="Load Notebook"><ArrowUpTrayIcon className="w-5 h-5"/></button>
                    <button onClick={handleSaveNotebook} className="p-1.5 rounded-md text-gray-400 hover:text-cyan-300" title="Save Notebook"><ArrowDownTrayIcon className="w-5 h-5"/></button>
                    <button onClick={() => setIsMarkdownMode(!isMarkdownMode)} className={`p-1.5 rounded-md ${isMarkdownMode ? 'text-cyan-300' : 'text-gray-400'} hover:text-cyan-300`} title={isMarkdownMode ? "Switch to Notebook View" : "Edit Raw Markdown"}><CodeBracketIcon className="w-5 h-5"/></button>
                    {isAiAvailable && (
                        <button onClick={() => setIsAiEnabled(!isAiEnabled)} className={`p-1.5 rounded-md ${isAiEnabled ? 'text-yellow-400' : 'text-gray-400'}`} title={isAiEnabled ? "Disable AI Features" : "Enable AI Features"}>
                            <SparklesIcon className="w-5 h-5"/>
                        </button>
                    )}
                    <button onClick={() => setIsSettingsModalOpen(true)} className="p-1.5 rounded-md text-gray-400 hover:text-cyan-300" title="Settings"><CogIcon className="w-5 h-5"/></button>
                </div>
            </header>

            <div className="flex flex-row flex-1 overflow-hidden relative">
                {isSidebarCollapsed && (
                    <button
                        onClick={() => setIsSidebarCollapsed(false)}
                        className="absolute top-1/2 left-2 -translate-y-1/2 z-20 p-1.5 bg-gray-700/50 hover:bg-cyan-600/50 rounded-full"
                        title="Expand Sidebar"
                    >
                        <ChevronDoubleRightIcon className="w-5 h-5" />
                    </button>
                )}
                <ResizablePanel
                    side="left"
                    initialWidth={320}
                    minWidth={250}
                    isCollapsed={isSidebarCollapsed}
                    onCollapseToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                >
                    <Sidebar metadata={metadata} />
                </ResizablePanel>
                
                <main className="flex-1 overflow-auto bg-gray-800">
                    <Notebook
                        notebookMarkdown={notebookMarkdown}
                        setNotebookMarkdown={setNotebookMarkdown}
                        isMarkdownMode={isMarkdownMode}
                        isAutoRunEnabled={isAutoRunEnabled}
                        cells={cells}
                        metadata={metadata}
                        results={results}
                        collapseTrigger={collapseTrigger}
                        allCollapsed={allCollapsed}
                        isAiFeatureActive={isAiFeatureActive}
                        onRunQuery={runQuery}
                        onUpdateCell={updateCell}
                        onDeleteCell={deleteCell}
                        onAddCell={addCell}
                        onMoveCell={moveCell}
                        onSuggestPlot={suggestPlot}
                        onFormatCode={formatCode}
                        onRunPreviewQuery={runPreviewQuery}
                        onMetadataChange={handleMetadataChange}
                        onDeleteQueryBlock={(cellId, index) => deleteQueryBlock(cellId, index)}
                    />
                </main>
                
                {isAiFeatureActive && (
                     <ResizablePanel
                        side="right"
                        initialWidth={400}
                        minWidth={300}
                        isCollapsed={isChatPanelCollapsed}
                        onCollapseToggle={() => setIsChatPanelCollapsed(!isChatPanelCollapsed)}
                    >
                        <ChatPanel metadata={metadata} onAddCellFromAI={addCellFromAI} />
                    </ResizablePanel>
                )}
                {isAiFeatureActive && isChatPanelCollapsed && (
                    <button
                        onClick={() => setIsChatPanelCollapsed(false)}
                        className="absolute top-1/2 right-2 -translate-y-1/2 z-20 p-1.5 bg-gray-700/50 hover:bg-cyan-600/50 rounded-full"
                        title="Expand Assistant"
                    >
                        <ChevronDoubleLeftIcon className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
      </DisplaySettingsProvider>
    );
};

export default App;