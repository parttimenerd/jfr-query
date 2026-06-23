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
import type { SourceType } from './context/DuckDBContext';
import { SettingsContext } from './context/SettingsContext';
import { DisplaySettingsProvider } from './context/DisplaySettingsContext';
import { useHistoryState } from './hooks/useHistoryState';
import { aiService } from './services/AiService';
import type { NotebookCellData, NotebookMetadata } from './types';
import { initialNotebook } from './data/mockData';
import { gcAnalysisNotebook } from './data/gcNotebookTemplate';
import { parseNotebook, reconstructNotebook, tokenizeCellContent, reconstructCellContent, parseCellContent } from './utils/notebookParser';
import { formatPlotCode } from './utils/plotFormatter';
import { substituteVariables, findRemainingVariables } from './utils/variableSubstitution';

import { ArrowUturnLeftIcon } from './components/icons/ArrowUturnLeftIcon';
import { ArrowUturnRightIcon } from './components/icons/ArrowUturnRightIcon';
import { PlayCircleIcon } from './components/icons/PlayCircleIcon';
import { PlayIcon } from './components/icons/PlayIcon';
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
import { TrashIcon } from './components/icons/TrashIcon';
import { BeakerIcon } from './components/icons/BeakerIcon';
import * as EmbeddingService from './services/ml/EmbeddingService';

function topoSort<T extends { name: string; includes?: string[] }>(items: T[], _label: string): T[] {
    const nameSet = new Set(items.map(i => i.name));
    const visited = new Set<string>();
    const result: T[] = [];
    const visit = (item: T, ancestors: Set<string> = new Set()) => {
        if (visited.has(item.name)) return;
        if (ancestors.has(item.name)) return; // cycle guard
        ancestors.add(item.name);
        for (const dep of (item.includes || [])) {
            if (!nameSet.has(dep)) continue;
            const depItem = items.find(i => i.name === dep);
            if (depItem) visit(depItem, new Set(ancestors));
        }
        visited.add(item.name);
        result.push(item);
    };
    items.forEach(item => visit(item));
    return result;
}


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
        dbState, mode, sourceType, errorMessage, serverProbeError, query, refreshSchema, loadFile
    } = useContext(DataContext);
    
    const { settings } = useContext(SettingsContext);
    const [isAiAvailable, setIsAiAvailable] = useState(false);
    const hasAiWorkedBefore = useRef(false);
    const [aiFailureMessage, setAiFailureMessage] = useState<string | null>(null);
    const [probeToastDismissed, setProbeToastDismissed] = useState(false);

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
    const savedMarkdownRef = useRef<string>(notebookMarkdown);

    // Warn before tab close if the notebook has unsaved changes (not yet downloaded).
    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (notebookMarkdown !== savedMarkdownRef.current) {
                e.preventDefault();
            }
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [notebookMarkdown]);

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
        savedMarkdownRef.current = notebookMarkdown;
    };

    // Drag-and-drop .md anywhere in the app loads it as the notebook.
    // (JFR/duckdb files are still handled by JFRDropZone on the initial screen.)
    const [isMdDragOver, setIsMdDragOver] = useState(false);
    useEffect(() => {
        const hasMd = (e: DragEvent) =>
            Array.from(e.dataTransfer?.items || []).some(it =>
                it.kind === 'file' && (
                    it.type === 'text/markdown' ||
                    /\.(md|markdown)$/i.test((it as any).getAsFile?.()?.name || '')
                ),
            );
        const onDragOver = (e: DragEvent) => {
            if (!e.dataTransfer) return;
            // Only react if the drag actually has files (avoid blocking text drags within editors).
            const types = Array.from(e.dataTransfer.types || []);
            if (!types.includes('Files')) return;
            e.preventDefault();
            setIsMdDragOver(true);
        };
        const onDragLeave = (e: DragEvent) => {
            if (e.relatedTarget) return;
            setIsMdDragOver(false);
        };
        const onDrop = (e: DragEvent) => {
            const files = Array.from(e.dataTransfer?.files || []);
            const md = files.find(f => /\.(md|markdown)$/i.test(f.name) || f.type === 'text/markdown');
            if (!md) return;
            e.preventDefault();
            setIsMdDragOver(false);
            const reader = new FileReader();
            reader.onload = ev => {
                const text = ev.target?.result;
                if (typeof text === 'string') setNotebookMarkdown(text);
            };
            reader.readAsText(md);
        };
        window.addEventListener('dragover', onDragOver);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('drop', onDrop);
        return () => {
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop', onDrop);
        };
    }, [setNotebookMarkdown]);


    //   ?notebook=<https-url>          fetch markdown notebook
    //   ?notebook=base64,<base64-md>   inline markdown (base64 prefix disambiguates from URL)
    //   ?jfr=<https-url>               auto-load a JFR/duckdb file (WASM mode)
    //   ?run=true                      run all queries once the DB is ready
    // Each runs at most once per page load.
    const urlParamsRef = useRef<{ notebookLoaded: boolean; jfrLoaded: boolean; ranAll: boolean }>({
        notebookLoaded: false,
        jfrLoaded: false,
        ranAll: false,
    });
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const nb = params.get('notebook');
        if (nb && !urlParamsRef.current.notebookLoaded) {
            urlParamsRef.current.notebookLoaded = true;
            try {
                if (nb.startsWith('base64,')) {
                    const decoded = decodeURIComponent(escape(atob(nb.slice('base64,'.length))));
                    setNotebookMarkdown(decoded);
                } else {
                    fetch(nb).then(r => {
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        return r.text();
                    }).then(setNotebookMarkdown).catch(err => {
                        console.error('Failed to load notebook from URL:', err);
                    });
                }
            } catch (err) {
                console.error('Failed to decode notebook param:', err);
            }
        }
    }, [setNotebookMarkdown]);

    // Auto-load JFR: only relevant in WASM mode, only if no DB yet.
    useEffect(() => {
        if (urlParamsRef.current.jfrLoaded) return;
        if (mode !== 'wasm') return;
        if (dbState !== DBState.NEEDS_FILE) return;
        const params = new URLSearchParams(window.location.search);
        const jfrUrl = params.get('jfr');
        if (!jfrUrl) return;
        urlParamsRef.current.jfrLoaded = true;
        (async () => {
            try {
                const r = await fetch(jfrUrl);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const bytes = new Uint8Array(await r.arrayBuffer());
                const fileName = jfrUrl.split('/').pop() || 'remote.jfr';
                void loadFile(bytes, fileName);
            } catch (err) {
                console.error('Failed to auto-load JFR from URL:', err);
            }
        })();
    }, [mode, dbState, loadFile]);

    // Auto-run all queries when ?run=true and the DB becomes ready.
    useEffect(() => {
        if (urlParamsRef.current.ranAll) return;
        if (dbState !== DBState.READY) return;
        const params = new URLSearchParams(window.location.search);
        if (params.get('run') !== 'true') return;
        urlParamsRef.current.ranAll = true;
        // Small delay so notebook/views from ?notebook= have settled.
        const t = setTimeout(() => { void handleRunAll(); }, 300);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dbState]);

    // Warm up the embedding ranker once the DB is ready so autocomplete
    // ranking is available within a few seconds of first use.
    useEffect(() => {
        if (dbState !== DBState.READY) return;
        EmbeddingService.ensureLoaded().catch(() => {
            // Silently ignore — ranker is optional, prefix-match still works.
        });
    }, [dbState]);

    // Global keyboard shortcuts. Cmd-S always intercepts (browser default is
    // unhelpful here); Cmd-Z / Cmd-Shift-Z only fire when focus is outside a
    // CodeMirror instance, so the editor's local history wins inside editors.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const meta = e.metaKey || e.ctrlKey;
            if (!meta) return;
            const inEditor = e.target instanceof HTMLElement && e.target.closest('.CodeMirror');
            if (e.key === 's' || e.key === 'S') {
                e.preventDefault();
                handleSaveNotebook();
                return;
            }
            if (!inEditor && (e.key === 'z' || e.key === 'Z')) {
                if (e.shiftKey) {
                    if (canRedo) { e.preventDefault(); redo(); }
                } else {
                    if (canUndo) { e.preventDefault(); undo(); }
                }
                return;
            }
            if (!inEditor && (e.key === 'y' || e.key === 'Y')) {
                if (canRedo) { e.preventDefault(); redo(); }
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [notebookMarkdown, undo, redo, canUndo, canRedo]);

    const { metadata, content: cellsContent } = useMemo(() => parseNotebook(notebookMarkdown), [notebookMarkdown]);

    const displaySettings = useMemo(() => ({
        timeFormat: metadata.timeFormat || settings.timeFormat,
        decimalPlaces: metadata.decimalPlaces ?? settings.decimalPlaces,
    }), [metadata, settings]);

    // Register front-matter views and macros into DuckDB whenever they (or
    // notebook-scope variables) change. Variables are substituted into the SQL
    // before registration so that custom views/macros can reference them.
    const customViewsKey = useMemo(() => JSON.stringify(metadata.views || []), [metadata.views]);
    const customMacrosKey = useMemo(() => JSON.stringify(metadata.macros || []), [metadata.macros]);
    const customVarsKey = useMemo(() => JSON.stringify(metadata.variables || {}), [metadata.variables]);
    useEffect(() => {
        if (dbState !== DBState.READY) return;
        let cancelled = false;
        (async () => {
            const vars = metadata.variables || {};
            let changed = false;

            // Topo-sort views by includes dependencies (simple DFS).
            const viewsInOrder = topoSort(metadata.views || [], 'views');
            for (const v of viewsInOrder) {
                if (!v.name || !v.sql) continue;
                const sql = substituteVariables(v.sql, vars);
                try {
                    let stmt: string;
                    if (v.params && v.params.length > 0) {
                        const paramList = v.params.map(p => `${p.name} ${p.type}${p.default !== undefined ? ` DEFAULT ${p.default}` : ''}`).join(', ');
                        stmt = `CREATE OR REPLACE MACRO "${v.name.replace(/"/g, '""')}"(${paramList}) AS TABLE (${sql})`;
                    } else {
                        stmt = `CREATE OR REPLACE VIEW "${v.name.replace(/"/g, '""')}" AS ${sql}`;
                    }
                    await query(stmt);
                    changed = true;
                } catch (e) {
                    console.warn(`Failed to register custom view "${v.name}":`, e);
                }
            }

            const macrosInOrder = topoSort(metadata.macros || [], 'macros');
            for (const m of macrosInOrder) {
                if (!m.name || !m.sql) continue;
                const body = substituteVariables(m.sql, vars);
                // The macro body must start with a parameter list: "(a, b) AS expr".
                // Without an explicit param list the macro body has nothing to bind
                // free identifiers to, so DuckDB will reject it. Skip silently to
                // tolerate legacy notebook fixtures.
                if (!/^\s*\(/.test(body)) continue;
                const stmt = `CREATE OR REPLACE MACRO "${m.name.replace(/"/g, '""')}"${body}`;
                try {
                    await query(stmt);
                    changed = true;
                } catch (e) {
                    console.warn(`Failed to register custom macro "${m.name}":`, e);
                }
            }

            if (!cancelled && changed) {
                await refreshSchema();
            }
        })();
        return () => { cancelled = true; };
    }, [dbState, customViewsKey, customMacrosKey, customVarsKey, query, refreshSchema]);

    const cells = useMemo(() => {
        const cellContents = cellsContent.split(/\n\n---\n\n/);
        // Use position-based IDs so that editing a cell's content doesn't
        // re-key the React subtree and orphan its results. This still misaligns
        // on insert/delete/reorder, but content-edit churn is the common case
        // and was costing one remount per keystroke (see BUGS.md B-026).
        return cellContents.map((content, index) => ({
            id: `cell-${index}`,
            title: '',
            content,
        }));
    }, [cellsContent]);

    const runQuery = useCallback(async (cellId: string, sql: string, queryIndex: number, allVariables: Record<string,string>) => {
        try {
            const subSql = substituteVariables(sql, allVariables);

            const remainingVars = findRemainingVariables(subSql);
            if (remainingVars.length > 0) {
                 const varList = remainingVars.join(', ');
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
        // Remove the result at `index` and compact the array so remaining results
        // don't show under the wrong query slot after the deletion.
        setResults(prev => {
            const arr = [...(prev[cellId] || [])];
            arr.splice(index, 1);
            return { ...prev, [cellId]: arr };
        });
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
    
    const [isRunningAll, setIsRunningAll] = useState(false);
    const isRunningAllRef = useRef(false);

    const handleRunAll = useCallback(async () => {
        if (isRunningAllRef.current) return;
        isRunningAllRef.current = true;
        setIsRunningAll(true);
        try {
            for (const cell of cells) {
                const parsed = parseCellContent(tokenizeCellContent(cell.content));
                const allVariables = { ...metadata.variables, ...parsed.variables };
                for (let i = 0; i < parsed.sqlBlocks.length; i++) {
                    await runQuery(cell.id, parsed.sqlBlocks[i], i, allVariables);
                }
            }
        } finally {
            isRunningAllRef.current = false;
            setIsRunningAll(false);
        }
    }, [cells, metadata, runQuery]);

    const handleClearResults = useCallback(() => { setResults({}); }, []);

    const handleMetadataChange = async (newMetadata: NotebookMetadata) => {
        const newNotebookMarkdown = reconstructNotebook({ metadata: newMetadata, content: cellsContent });
        setNotebookMarkdown(newNotebookMarkdown);
        await refreshSchema();
    };

    if (dbState !== DBState.READY) {
        if (mode === 'wasm' && (dbState === DBState.NEEDS_FILE || dbState === DBState.IMPORTING || dbState === DBState.ERROR)) {
            return (
                <JFRDropZone
                    onFileSelected={(bytes, fileName) => { void loadFile(bytes, fileName); }}
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
            {isMdDragOver && (
                <div className="fixed inset-0 z-50 bg-cyan-900/30 border-4 border-dashed border-cyan-500/60 flex items-center justify-center pointer-events-none">
                    <div className="px-6 py-3 bg-gray-900/90 rounded-lg text-cyan-300 text-lg font-semibold shadow-xl">
                        Drop .md file to load notebook
                    </div>
                </div>
            )}
            <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />
            {aiFailureMessage && <ToastNotification title="AI Assistant Alert" message={aiFailureMessage} onClose={() => setAiFailureMessage(null)} action={{ label: 'Open Settings →', onClick: () => setIsSettingsModalOpen(true) }} />}
            {serverProbeError && !probeToastDismissed && <ToastNotification title="Running in WASM mode" message={`Server probe failed: ${serverProbeError}. Drop a .jfr or .duckdb file to get started.`} onClose={() => setProbeToastDismissed(true)} duration={12000} />}

            <header className="flex-shrink-0 h-12 bg-gray-900/80 border-b border-gray-700/80 flex items-center justify-between px-4 z-30">
                <div className="flex items-center gap-3">
                    <h1 className="text-sm font-semibold text-gray-200 tracking-tight">JFR Query Notebook</h1>
                    {mode && (
                        <span
                            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                                errorMessage
                                    ? 'border-red-500/50 text-red-400 bg-red-900/20'
                                    : mode === 'wasm'
                                    ? 'border-gray-600 text-gray-500 bg-transparent'
                                    : 'border-green-600/40 text-green-400 bg-green-900/20'
                            }`}
                            title={errorMessage ? `Error: ${errorMessage}` : mode === 'wasm' ? 'Running in-browser via DuckDB-WASM' : 'Connected to a jfr-query server'}
                        >
                            {errorMessage ? '⚠ ' : ''}{mode === 'wasm' ? 'WASM' : 'Server'}
                        </span>
                    )}
                    {sourceType && (
                        <span
                            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                                sourceType === 'jfr'
                                    ? 'border-cyan-700/60 text-cyan-400 bg-cyan-900/20'
                                    : 'border-blue-700/60 text-blue-400 bg-blue-900/20'
                            }`}
                            title={sourceType === 'jfr' ? 'JFR recording' : 'DuckDB database'}
                        >
                            {sourceType === 'jfr' ? 'JFR' : 'DuckDB'}
                        </span>
                    )}
                    <div className="w-px h-5 bg-gray-700 mx-1" />
                    <div className="flex items-center gap-1">
                        <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z)" className="p-1.5 rounded-md disabled:opacity-30 text-gray-400 disabled:text-gray-600 hover:enabled:bg-gray-700/50"><ArrowUturnLeftIcon className="w-4 h-4"/></button>
                        <button onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)" className="p-1.5 rounded-md disabled:opacity-30 text-gray-400 disabled:text-gray-600 hover:enabled:bg-gray-700/50"><ArrowUturnRightIcon className="w-4 h-4"/></button>
                    </div>
                    <div className="w-px h-5 bg-gray-700 mx-1" />
                    <div className="flex items-center gap-1">
                        <button onClick={() => setIsAutoRunEnabled(!isAutoRunEnabled)} className={`p-1.5 rounded-md ${isAutoRunEnabled ? 'text-cyan-300' : 'text-gray-400'}`} title={isAutoRunEnabled ? "Disable Auto-Run" : "Enable Auto-Run"}>
                            {isAutoRunEnabled ? <PauseCircleIcon className="w-4 h-4" /> : <PlayCircleIcon className="w-4 h-4" />}
                        </button>
                        <button onClick={handleRunAll} disabled={isRunningAll} title="Run All Queries" className={`p-1.5 rounded-md disabled:opacity-50 ${isRunningAll ? 'text-green-400 animate-pulse' : 'text-gray-400 hover:text-green-400'}`}>
                            {isRunningAll ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"/> : <PlayIcon className="w-4 h-4"/>}
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => { setCollapseTrigger(Date.now()); setAllCollapsed(true); }} className="p-1.5 rounded-md text-gray-400 hover:text-gray-200" title="Collapse All"><ChevronDoubleUpIcon className="w-4 h-4"/></button>
                    <button onClick={() => { setCollapseTrigger(Date.now()); setAllCollapsed(false); }} className="p-1.5 rounded-md text-gray-400 hover:text-gray-200" title="Expand All"><ChevronDoubleDownIcon className="w-4 h-4"/></button>
                    <button onClick={handleClearResults} className="p-1.5 rounded-md text-gray-400 hover:text-red-400" title="Clear All Results"><TrashIcon className="w-4 h-4"/></button>
                    <div className="w-px h-5 bg-gray-700 mx-1" />
                    <input ref={notebookFileInputRef} type="file" accept=".md,.markdown" className="hidden" onChange={handleLoadNotebook} />
                    <button onClick={() => notebookFileInputRef.current?.click()} className="p-1.5 rounded-md text-gray-400 hover:text-gray-200" title="Load Notebook"><ArrowUpTrayIcon className="w-4 h-4"/></button>
                    <button onClick={() => setNotebookMarkdown(gcAnalysisNotebook)} className="p-1.5 rounded-md text-gray-400 hover:text-emerald-400" title="New GC Analysis Notebook"><BeakerIcon className="w-4 h-4"/></button>
                    <button onClick={handleSaveNotebook} className="p-1.5 rounded-md text-gray-400 hover:text-gray-200" title="Save Notebook (⌘S)"><ArrowDownTrayIcon className="w-4 h-4"/></button>
                    <button onClick={() => setIsMarkdownMode(!isMarkdownMode)} className={`p-1.5 rounded-md ${isMarkdownMode ? 'text-cyan-300' : 'text-gray-400'} hover:text-cyan-300`} title={isMarkdownMode ? "Switch to Notebook View" : "Edit Raw Markdown"}><CodeBracketIcon className="w-4 h-4"/></button>
                    {isAiAvailable && (
                        <button onClick={() => setIsAiEnabled(!isAiEnabled)} className={`p-1.5 rounded-md ${isAiEnabled ? 'text-yellow-400' : 'text-gray-400'}`} title={isAiEnabled ? "Disable AI Features" : "Enable AI Features"}>
                            <SparklesIcon className="w-4 h-4"/>
                        </button>
                    )}
                    <div className="w-px h-5 bg-gray-700 mx-1" />
                    <button onClick={() => setIsSettingsModalOpen(true)} className="p-1.5 rounded-md text-gray-400 hover:text-gray-200" title="Settings"><CogIcon className="w-4 h-4"/></button>
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