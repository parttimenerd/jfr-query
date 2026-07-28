import React, { useState, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import Sidebar from './components/Sidebar';
import Notebook from './components/Notebook';
import ChatPanel from './components/ChatPanel';
import ResizablePanel from './components/ResizablePanel';
import FileLoader from './components/FileLoader';
import JFRDropZone from './components/JFRDropZone';
import SettingsModal from './components/SettingsModal';
import TemplateGalleryModal from './components/TemplateGalleryModal';
import CommandPalette, { type CommandAction, type CellEntry } from './components/CommandPalette';
import ToastNotification from './components/ToastNotification';
import { DataContext, DBState } from './context/DuckDBContext';
import type { SourceType } from './context/DuckDBContext';
import { SettingsContext } from './context/SettingsContext';
import { DisplaySettingsProvider } from './context/DisplaySettingsContext';
import { ExecutorProvider } from './context/ExecutorContext';
import { SkillContextProvider } from './context/SkillContext';
import { useHistoryState } from './hooks/useHistoryState';
import { aiService } from './services/AiService';
import type { NotebookCellData, NotebookMetadata } from './types';
import { initialNotebook } from './data/mockData';
import { gcAnalysisNotebook } from './data/gcNotebookTemplate';
import { parseNotebook, reconstructNotebook, tokenizeCellContent, reconstructCellContent, parseCellContent, parseCellDirective } from './utils/notebookParser';
import { formatPlotCode } from './utils/plotFormatter';
import { formatSql } from './utils/sqlFormatter';
import { substituteVariables, findRemainingVariables, toSqlVariables } from './utils/variableSubstitution';
import { expandBrushOperator } from './services/variableExpander';
import { computeSessionVariables } from './components/SessionDateChip';
import SessionDateChip from './components/SessionDateChip';

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
import { DocumentTextIcon } from './components/icons/DocumentTextIcon';
import { EyeIcon } from './components/icons/EyeIcon';
import { BookOpenIcon } from './components/icons/BookOpenIcon';
import * as EmbeddingService from './services/ml/EmbeddingService';
import { initPlotModel } from './services/ml/PlotGenerationService';

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
        dbState, mode, sourceType, errorMessage, serverProbeError, query, refreshSchema, loadFile, loadDemo,
        recordingStart, recordingEnd, schema, importProgress, wasmInitializing,
    } = useContext(DataContext);
    
    const { settings } = useContext(SettingsContext);
    const [isAiAvailable, setIsAiAvailable] = useState(false);
    const hasAiWorkedBefore = useRef(false);
    const [aiFailureMessage, setAiFailureMessage] = useState<string | null>(null);
    const [probeToastDismissed, setProbeToastDismissed] = useState(false);
    const [invalidFileToast, setInvalidFileToast] = useState<string | null>(null);

    const [isAiEnabled, setIsAiEnabled] = usePersistentState('jfr-notebook-ai-enabled', true);
    const isAiFeatureActive = isAiAvailable && isAiEnabled;

    // Incoming channel snapshot from InlineChat "pop to sidebar". ChatPanel consumes it.
    const [incomingChannel, setIncomingChannel] = useState<import('./components/ChatPanel').InlineChatSnapshot | null>(null);

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


    const [notebookMarkdown, setNotebookMarkdown, undo, redo, canUndo, canRedo, flushHistory, resetNotebookHistory] = useHistoryState<string>(initialNotebook, 'jfr-notebook-content');
    const [results, setResults] = useState<Record<string, (any[] | null)[]>>({});
    // Parallel timing state: [cellId][queryIndex] = elapsed ms for the last successful run.
    const [queryTimings, setQueryTimings] = useState<Record<string, (number | null)[]>>({});

    // Per-cell identity cache: reuse the same cell object across renders when
    // id+content+name are unchanged. This ensures arePropsEqual in React.memo'd
    // NotebookCell components short-circuits for cells the user did NOT edit.
    const cellIdentityCacheRef = useRef<Map<string, NotebookCellData>>(new Map());
    // Stable array identity: when no cell object changed (all cache hits), reuse
    // the previous cells array so consumers that check allCells === allCells
    // (arePropsEqual, useMemo deps) short-circuit without any work.
    const prevCellsRef = useRef<NotebookCellData[]>([]);
    const savedMarkdownRef = useRef<string>(notebookMarkdown);

    const loadNotebook = useCallback((source: string) => {
        resetNotebookHistory(source);
        setResults({});
        setQueryTimings({});
        // Mark as saved so beforeunload doesn't fire just from loading a file.
        savedMarkdownRef.current = source;
    }, [resetNotebookHistory]);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = usePersistentState('jfr-ui-sidebarCollapsed', false);
    const [isChatPanelCollapsed, setIsChatPanelCollapsed] = usePersistentState('jfr-ui-chatPanelCollapsed', true);
    const [isAutoRunEnabled, setIsAutoRunEnabled] = usePersistentState('jfr-ui-autoRunEnabled', true);
    const [isMarkdownMode, setIsMarkdownMode] = useState(false);
    const [collapseTrigger, setCollapseTrigger] = useState(0);
    const [allCollapsed, setAllCollapsed] = useState(false);
    const [clearResultsTrigger, setClearResultsTrigger] = useState(0);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [isCmdPaletteOpen, setIsCmdPaletteOpen] = useState(false);
    const [isTemplateGalleryOpen, setIsTemplateGalleryOpen] = useState(false);

    const notebookFileInputRef = useRef<HTMLInputElement>(null);
    // Always-fresh ref so addCellFromTool reads current markdown without stale closures.
    const notebookMarkdownRef = useRef<string>(notebookMarkdown);
    notebookMarkdownRef.current = notebookMarkdown;
    // Cell-title parse cache: same cell object → same title (no re-parse on unrelated cell edits).
    const cellTitleCacheRef = useRef<WeakMap<object, string>>(new WeakMap());

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
                loadNotebook(text);
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
    // JFR/duckdb drops anywhere in the app reload the database.
    const [isMdDragOver, setIsMdDragOver] = useState(false);
    const [pendingJfrFile, setPendingJfrFile] = useState<{ file: File; sizeMb: number } | null>(null);
    const [pendingJfrDepth, setPendingJfrDepth] = useState(10);

    const JFR_MAGIC = [0x46, 0x4c, 0x52, 0x00];
    const DUCKDB_MAGIC = [0x44, 0x55, 0x43, 0x4b];
    const sniffFile = async (f: File): Promise<'jfr' | 'duckdb' | 'unknown'> => {
        const buf = await f.slice(0, 4).arrayBuffer();
        const b = new Uint8Array(buf);
        if (JFR_MAGIC.every((v, i) => b[i] === v)) return 'jfr';
        if (DUCKDB_MAGIC.every((v, i) => b[i] === v)) return 'duckdb';
        return 'unknown';
    };

    useEffect(() => {
        const onDragOver = (e: DragEvent) => {
            if (!e.dataTransfer) return;
            const types = Array.from(e.dataTransfer.types || []);
            // Prevent browser from navigating when a cell drag (text/plain) lands
            // outside a cell drop-zone — without this the browser treats the cell
            // ID string as a URL and navigates to about:blank.
            if (types.includes('text/plain') && !types.includes('Files')) {
                e.preventDefault();
                return;
            }
            // Only react further if the drag actually has files.
            if (!types.includes('Files')) return;
            e.preventDefault();
            setIsMdDragOver(true);
        };
        const onDragLeave = (e: DragEvent) => {
            if (e.relatedTarget) return;
            setIsMdDragOver(false);
        };
        const onDrop = (e: DragEvent) => {
            // Prevent browser navigation when a cell-reorder drag lands outside a cell.
            const types = Array.from(e.dataTransfer?.types || []);
            if (types.includes('text/plain') && !types.includes('Files')) {
                e.preventDefault();
                return;
            }
            setIsMdDragOver(false);
            const files = Array.from(e.dataTransfer?.files || []);
            // Prefer .md over JFR/duckdb if multiple files are dropped.
            const md = files.find(f => /\.(md|markdown)$/i.test(f.name) || f.type === 'text/markdown');
            if (md) {
                e.preventDefault();
                const reader = new FileReader();
                reader.onload = ev => {
                    const text = ev.target?.result;
                    if (typeof text === 'string') loadNotebook(text);
                };
                reader.readAsText(md);
                return;
            }
            // Only handle data-file drops when the notebook is already loaded —
            // JFRDropZone owns the drop target during the landing/import phase.
            if (dbState !== DBState.READY) return;
            const dataFile = files.find(f => /\.(jfr|duckdb|db)$/i.test(f.name));
            if (dataFile) {
                e.preventDefault();
                void (async () => {
                    const kind = await sniffFile(dataFile);
                    if (kind === 'unknown') {
                        setInvalidFileToast(`Unrecognised file: "${dataFile.name}". Drop a .jfr or .duckdb file.`);
                        return;
                    }
                    const sizeMb = dataFile.size / (1024 * 1024);
                    if (kind === 'jfr' && sizeMb > 20) {
                        setPendingJfrFile({ file: dataFile, sizeMb });
                        setPendingJfrDepth(10);
                    } else {
                        void loadFile(dataFile, dataFile.name, 10);
                    }
                })();
            } else if (files.length > 0) {
                e.preventDefault();
                const name = files[0].name;
                setInvalidFileToast(`Unsupported file type: "${name}". Drop a .jfr or .duckdb file.`);
            }
        };
        window.addEventListener('dragover', onDragOver);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('drop', onDrop);
        return () => {
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop', onDrop);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadNotebook, loadFile, dbState]);


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
                    const decoded = new TextDecoder().decode(Uint8Array.from(atob(nb.slice('base64,'.length)), c => c.charCodeAt(0)));
                    loadNotebook(decoded);
                } else {
                    fetch(nb).then(r => {
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        return r.text();
                    }).then(loadNotebook).catch(err => {
                        console.error('Failed to load notebook from URL:', err);
                    });
                }
            } catch (err) {
                console.error('Failed to decode notebook param:', err);
            }
        }
    }, [loadNotebook]);

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

    // Auto-run all queries when the DB becomes ready (if auto-run is enabled or ?run=true).
    const handleRunAllRef = useRef<(() => Promise<void>) | undefined>(undefined);
    useEffect(() => {
        if (urlParamsRef.current.ranAll) return;
        if (dbState !== DBState.READY) return;
        // Mark as ran regardless of whether we actually fire, so that a later
        // toggle of isAutoRunEnabled doesn't trigger a second run.
        urlParamsRef.current.ranAll = true;
        const params = new URLSearchParams(window.location.search);
        if (params.get('run') !== 'true' && !isAutoRunEnabled) return;
        // Small delay so notebook/views from ?notebook= have settled.
        const t = setTimeout(() => { void handleRunAllRef.current?.(); }, 300);
        return () => clearTimeout(t);
    }, [dbState, isAutoRunEnabled]);

    // Warm up the embedding ranker once the DB is ready so autocomplete
    // ranking is available within a few seconds of first use.
    useEffect(() => {
        if (dbState !== DBState.READY) return;
        EmbeddingService.ensureLoaded().catch(() => {
            // Silently ignore — ranker is optional, prefix-match still works.
        });
        initPlotModel().catch(() => {
            // Optional — heuristic + cloud paths remain available.
        });
    }, [dbState]);

    // Global keyboard shortcuts. Cmd-S always intercepts (browser default is
    // unhelpful here); Cmd-Z / Cmd-Shift-Z only fire when focus is outside a
    // CodeMirror instance, so the editor's local history wins inside editors.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const meta = e.metaKey || e.ctrlKey;
            if (!meta) return;
            const inEditor = e.target instanceof HTMLElement && e.target.closest('.cm-editor');
            // Let CodeMirror handle Ctrl+A — it selects within the focused editor only.
            if (inEditor && (e.key === 'a' || e.key === 'A')) return;
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

    // Command palette: Shift-Shift (within 400ms) opens it. Cmd/Ctrl-K or
    // Cmd/Ctrl-Shift-P also work as familiar VSCode-style shortcuts.
    useEffect(() => {
        let lastShiftAt = 0;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { setIsCmdPaletteOpen(false); return; }
            const meta = e.metaKey || e.ctrlKey;
            if (meta && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                setIsCmdPaletteOpen(true);
                return;
            }
            if (meta && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
                e.preventDefault();
                setIsCmdPaletteOpen(true);
                return;
            }
            if (e.key === 'Shift' && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const now = Date.now();
                if (now - lastShiftAt < 400) {
                    // Suppress when focused inside an editable input/textarea
                    // (where rapid shift presses are common during typing).
                    const tag = (document.activeElement?.tagName ?? '').toLowerCase();
                    const editable = tag === 'input' || tag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable;
                    const inEditor = document.activeElement && (document.activeElement.closest?.('.cm-editor') || document.activeElement.closest?.('.CodeMirror'));
                    if (!editable && !inEditor) {
                        setIsCmdPaletteOpen(true);
                    }
                    lastShiftAt = 0;
                } else {
                    lastShiftAt = now;
                }
            } else if (e.key !== 'Shift') {
                lastShiftAt = 0;
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    const { metadata: parsedMetadata, content: cellsContent } = useMemo(() => parseNotebook(notebookMarkdown), [notebookMarkdown]);

    // Stabilize `metadata` identity: only update the reference when the YAML
    // front-matter actually changes, not on every cell keystroke.
    // Comparing the raw front-matter slice of the markdown is cheaper than
    // deep-comparing the parsed object, and sufficient — parseNotebook only
    // produces different metadata when the front-matter text changes.
    const fmEndIdx = notebookMarkdown.indexOf('\n---\n');
    const frontMatterSlice = fmEndIdx === -1 ? '' : notebookMarkdown.slice(0, fmEndIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const metadata = useMemo(() => parsedMetadata, [frontMatterSlice]);

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
    const prevViewNamesRef = useRef<Set<string>>(new Set());
    const prevMacroNamesRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (dbState !== DBState.READY) return;
        let cancelled = false;
        (async () => {
            const vars = metadata.variables || {};
            const sqlVars = toSqlVariables(vars);
            let changed = false;

            const currentViewNames = new Set((metadata.views || []).map(v => v.name).filter(Boolean));
            const currentMacroNames = new Set((metadata.macros || []).map(m => m.name).filter(Boolean));

            // Drop views that were removed from metadata.
            for (const name of prevViewNamesRef.current) {
                if (!currentViewNames.has(name)) {
                    try { await query(`DROP VIEW IF EXISTS "${name.replace(/"/g, '""')}"`); changed = true; } catch {}
                }
            }
            // Drop macros that were removed from metadata.
            for (const name of prevMacroNamesRef.current) {
                if (!currentMacroNames.has(name)) {
                    try { await query(`DROP MACRO IF EXISTS "${name.replace(/"/g, '""')}"`); changed = true; } catch {}
                }
            }

            prevViewNamesRef.current = currentViewNames;
            prevMacroNamesRef.current = currentMacroNames;

            // Topo-sort views by includes dependencies (simple DFS).
            const viewsInOrder = topoSort(metadata.views || [], 'views');
            for (const v of viewsInOrder) {
                if (!v.name || !v.sql) continue;
                const sql = substituteVariables(v.sql, sqlVars);
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
                const body = substituteVariables(m.sql, sqlVars);
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
        // Detect duplicate cell `name=` directives and apply deterministic
        // `-2`, `-3` suffixes so cell handles stay unique.
        const nameCounts: Record<string, number> = {};
        const parsedNames: (string | undefined)[] = cellContents.map(c => {
            const d = parseCellDirective(c);
            return d?.name?.trim() || undefined;
        });
        const finalNames: (string | undefined)[] = parsedNames.map(n => {
            if (!n) return undefined;
            const seen = (nameCounts[n] ?? 0) + 1;
            nameCounts[n] = seen;
            return seen === 1 ? n : `${n}-${seen}`;
        });
        // Use position-based IDs so that editing a cell's content doesn't
        // re-key the React subtree and orphan its results. This still misaligns
        // on insert/delete/reorder, but content-edit churn is the common case
        // and was costing one remount per keystroke (see BUGS.md B-026).
        const cache = cellIdentityCacheRef.current;
        const nextCache = new Map<string, NotebookCellData>();
        let anyNew = false;
        const result = cellContents.map((content, index) => {
            const id = `cell-${index}`;
            const name = finalNames[index];
            const cacheKey = `${id}:${name ?? ''}:${content}`;
            const existing = cache.get(cacheKey);
            if (existing) {
                nextCache.set(cacheKey, existing);
                return existing;
            }
            anyNew = true;
            const cell: NotebookCellData = { id, title: '', content, name };
            nextCache.set(cacheKey, cell);
            return cell;
        });
        cellIdentityCacheRef.current = nextCache;
        // If every cell is a cache hit AND count matches, reuse the previous array
        // so useMemo([cells]) and allCells === allCells checks short-circuit.
        const prev = prevCellsRef.current;
        if (!anyNew && result.length === prev.length) {
            return prev;
        }
        prevCellsRef.current = result;
        return result;
    }, [cellsContent]);

    // Always-fresh ref so cell-mutation callbacks (updateCell, deleteCell, etc.)
    // can read the latest cells without depending on the `cells` state variable,
    // keeping those callbacks stable across content-edit renders.
    const cellsRef = useRef<NotebookCellData[]>(cells);
    cellsRef.current = cells;

    const runQuery = useCallback(async (cellId: string, sql: string, queryIndex: number, allVariables: Record<string,string>) => {
        const runOnce = async (sqlToRun: string) => {
            const subSql = substituteVariables(expandBrushOperator(sqlToRun, allVariables), toSqlVariables(allVariables));
            const remainingVars = findRemainingVariables(subSql);
            if (remainingVars.length > 0) {
                const varList = remainingVars.join(', ');
                throw new Error(`Undefined variable(s) found: ${varList}. Please define them in the cell's 'variables' block or in the notebook settings.`);
            }
            return query(subSql);
        };

        const setTiming = (ms: number | null) => {
            setQueryTimings(prev => {
                const existing = prev[cellId] || [];
                const next: (number | null)[] = [...existing];
                while (next.length <= queryIndex) next.push(null);
                next[queryIndex] = ms;
                return { ...prev, [cellId]: next };
            });
        };

        const t0 = performance.now();
        try {
            const data = await runOnce(sql);
            setTiming(performance.now() - t0);
            setResults(prev => {
                const existing = prev[cellId] || [];
                // Ensure dense array: fill any gap before queryIndex with null so
                // downstream code that iterates by index never sees `undefined` holes.
                const newCellResults: (any[] | null)[] = [...existing];
                while (newCellResults.length <= queryIndex) newCellResults.push(null);
                newCellResults[queryIndex] = data;
                return { ...prev, [cellId]: newCellResults };
            });
        } catch (error: any) {
            setTiming(null);
            const errMsg: string = error.message || String(error);
            // Attempt AI-assisted fix for parse/syntax errors (not for variable errors).
            const looksLikeSyntaxError = /syntax|parse|unexpected|token|unrecognized/i.test(errMsg);
            if (looksLikeSyntaxError && isAiEnabled) {
                const schemaHint = (schemaRef.current?.tables ?? []).map(t =>
                    `${t.name}(${t.columns.map(c => c.name).join(', ')})`
                ).join('\n');
                const fixedSql = await aiService.fixBrokenSql(sql, errMsg, schemaHint);
                if (fixedSql && fixedSql !== sql) {
                    // Patch only the specific cell (not raw markdown replace which
                    // would corrupt the first occurrence if the same SQL appears elsewhere).
                    const newCells = cellsRef.current.map(c =>
                        c.id === cellId ? { ...c, content: c.content.replace(sql, fixedSql) } : c
                    );
                    updateCellsAndMarkdown(newCells);
                    try {
                        const t1 = performance.now();
                        const data = await runOnce(fixedSql);
                        setTiming(performance.now() - t1);
                        setResults(prev => {
                            const existing = prev[cellId] || [];
                            const newCellResults: (any[] | null)[] = [...existing];
                            while (newCellResults.length <= queryIndex) newCellResults.push(null);
                            newCellResults[queryIndex] = data;
                            return { ...prev, [cellId]: newCellResults };
                        });
                        return;
                    } catch {
                        // Fixed SQL also failed — fall through to show original error.
                    }
                }
            }
            setResults(prev => {
                const existing = prev[cellId] || [];
                const newCellResults: (any[] | null)[] = [...existing];
                while (newCellResults.length <= queryIndex) newCellResults.push(null);
                newCellResults[queryIndex] = [{ error: errMsg }];
                return { ...prev, [cellId]: newCellResults };
            });
        }
    }, [query, isAiEnabled]);

    const schemaRef = useRef(schema);
    schemaRef.current = schema;
    const metadataRef = useRef(metadata);
    metadataRef.current = metadata;

    const updateCellsAndMarkdown = useCallback((newCells: NotebookCellData[]) => {
        const newCellsContent = newCells.map(cell => cell.content).join('\n\n---\n\n');
        const newNotebookMarkdown = reconstructNotebook({ metadata: metadataRef.current, content: newCellsContent });
        notebookMarkdownRef.current = newNotebookMarkdown;
        setNotebookMarkdown(newNotebookMarkdown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const addCell = useCallback(() => {
        const newCell: NotebookCellData = {
            id: `cell-${Date.now()}`,
            title: ``,
            content: '## New Cell\n\n'
        };
        updateCellsAndMarkdown([...cellsRef.current, newCell]);
    }, [updateCellsAndMarkdown]);

    /**
     * C7 — Tool-runtime variant of addCell. The AI tool runtime emits
     * `{ type: 'sql' | 'plot' | 'markdown', content, afterCellId? }`; we
     * wrap that shape into a notebook cell and splice it in. Returns the
     * id so the model can subsequently reference it via `editCell` /
     * `applyPlot`. Shared between ChatPanel and InlineChat.
     */
    const addCellFromTool = useCallback((mut: { type: 'sql' | 'plot' | 'markdown'; content: string; afterCellId?: string }): string => {
        flushHistory();
        const id = `cell-${Date.now()}`;
        const fence = mut.type === 'sql' ? '```sql' : mut.type === 'plot' ? '```plot' : null;
        const body = fence ? `${fence}\n${mut.content}\n\`\`\`\n` : `${mut.content}\n`;
        const newCell: NotebookCellData = { id, title: '', content: body };
        // Use the live cells array (has correct positional IDs) rather than
        // re-parsing markdown (which would assign new positional IDs that don't
        // match the afterCellId returned by a previous addCellFromTool call).
        const latestCells = cellsRef.current;
        let inserted = false;
        const next: NotebookCellData[] = [];
        for (const c of latestCells) {
            next.push(c);
            if (!inserted && mut.afterCellId && c.id === mut.afterCellId) { next.push(newCell); inserted = true; }
        }
        if (!inserted) next.push(newCell);
        updateCellsAndMarkdown(next);
        return id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [updateCellsAndMarkdown]);

    const addCellsBatchFromTool = useCallback((muts: { type: 'sql' | 'plot' | 'markdown'; content: string }[]): void => {
        flushHistory();
        const newCells = muts.map((mut, i) => {
            const fence = mut.type === 'sql' ? '```sql' : mut.type === 'plot' ? '```plot' : null;
            const body = fence ? `${fence}\n${mut.content}\n\`\`\`\n` : `${mut.content}\n`;
            return { id: `cell-${Date.now()}-${i}`, title: '', content: body };
        });
        updateCellsAndMarkdown([...cellsRef.current, ...newCells]);
    }, [updateCellsAndMarkdown, flushHistory]);

    const addCellFromAI = useCallback((sql: string, plotConfig: string, title: string, markdownText: string) => {
        const content = reconstructCellContent([
            { type: 'markdown', content: `# ${title}\n\n${markdownText}\n\n` },
            { type: 'sql', content: `\n${sql}\n` },
            { type: 'markdown', content: '\n\n' },
            { type: 'plot', content: `\n${plotConfig}\n` },
        ]);
        const newCell: NotebookCellData = {
            id: `cell-${Date.now()}`,
            title: '',
            content: content,
        };
        updateCellsAndMarkdown([...cellsRef.current, newCell]);
    }, [updateCellsAndMarkdown]);


    const deleteCell = useCallback((cellId: string) => {
        const oldCells = cellsRef.current;
        const deletedIndex = oldCells.findIndex(c => c.id === cellId);
        if (deletedIndex === -1) return;
        const newCells = oldCells.filter(cell => cell.id !== cellId);
        updateCellsAndMarkdown(newCells);
        // Remap results and timings: after deletion, cells at positions > deletedIndex
        // shift down by one (cell-N becomes cell-(N-1)), so their result entries must
        // be moved to the new keys to avoid showing the wrong cell's data.
        setResults(prev => {
            const next: typeof prev = {};
            for (let i = 0; i < newCells.length; i++) {
                const oldId = oldCells[i >= deletedIndex ? i + 1 : i].id;
                if (prev[oldId] !== undefined) next[`cell-${i}`] = prev[oldId];
            }
            return next;
        });
        setQueryTimings(prev => {
            const next: typeof prev = {};
            for (let i = 0; i < newCells.length; i++) {
                const oldId = oldCells[i >= deletedIndex ? i + 1 : i].id;
                if (prev[oldId] !== undefined) next[`cell-${i}`] = prev[oldId];
            }
            return next;
        });
    }, [updateCellsAndMarkdown]);

    const updateCell = useCallback((cellId: string, updatedContent: string) => {
        const newCells = cellsRef.current.map(cell => cell.id === cellId ? { ...cell, content: updatedContent } : cell);
        updateCellsAndMarkdown(newCells);
    }, [updateCellsAndMarkdown]);
    
    const deleteQueryBlock = useCallback((cellId: string, index: number) => {
        const cell = cellsRef.current.find(c => c.id === cellId);
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
        setQueryTimings(prev => {
            const arr = [...(prev[cellId] || [])];
            arr.splice(index, 1);
            return { ...prev, [cellId]: arr };
        });
    }, [updateCell]);

    const moveCell = useCallback((draggedId: string, targetId: string, position: 'before' | 'after') => {
        const draggedIndex = cellsRef.current.findIndex(c => c.id === draggedId);
        const targetIndex = cellsRef.current.findIndex(c => c.id === targetId);
        if (draggedIndex === -1 || targetIndex === -1) return;

        const newCells = [...cellsRef.current];
        const [draggedItem] = newCells.splice(draggedIndex, 1);

        const insertionIndex = position === 'before'
            ? (draggedIndex < targetIndex ? targetIndex - 1 : targetIndex)
            : (draggedIndex < targetIndex ? targetIndex : targetIndex + 1);

        newCells.splice(insertionIndex, 0, draggedItem);
        updateCellsAndMarkdown(newCells);
    }, [updateCellsAndMarkdown]);

    const suggestPlot = useCallback(async (sql: string, customPromptOverride?: string): Promise<string | null> => {
        if (!isAiFeatureActive) return null;
        try {
            return await aiService.getAiSuggestPlot(sql, customPromptOverride);
        } catch (error) {
            console.error("Error suggesting plot:", error);
            return null;
        }
    }, [isAiFeatureActive]);

    const formatCode = useCallback(async (code: string, type: 'sql' | 'plot'): Promise<string | null> => {
        if (type === 'plot') return formatPlotCode(code);
        return formatSql(code);
    }, []);
    
    const runPreviewQuery = useCallback(async (queryToRun: string): Promise<any[]> => {
        try {
            return await query(queryToRun);
        } catch (error) {
            console.error("Preview query failed:", error);
            if (error instanceof Error) {
                return [{ error: error.message }];
            }
            return [{ error: String(error) }];
        }
    }, [query]);
    
    const [isRunningAll, setIsRunningAll] = useState(false);
    const [presenterMode, setPresenterMode] = useState(false);
    const isRunningAllRef = useRef(false);

    const handleRunAll = useCallback(async () => {
        if (isRunningAllRef.current) return;
        isRunningAllRef.current = true;
        setIsRunningAll(true);
        try {
            for (const cell of cellsRef.current) {
                const parsed = parseCellContent(tokenizeCellContent(cell.content));
                const allVariables = { ...metadataRef.current.variables, ...parsed.variables };
                for (let i = 0; i < parsed.sqlBlocks.length; i++) {
                    await runQuery(cell.id, parsed.sqlBlocks[i], i, allVariables);
                }
            }
        } finally {
            isRunningAllRef.current = false;
            setIsRunningAll(false);
        }
    }, [runQuery]);
    handleRunAllRef.current = handleRunAll;

    const handleClearResults = useCallback(() => {
        setResults({});
        setClearResultsTrigger(t => t + 1);
    }, []);

    const formatAllCells = useCallback(() => {
        const newCells = cellsRef.current.map(cell => {
            const segments = tokenizeCellContent(cell.content);
            const formattedSegments = segments.map(seg => {
                if (seg.type === 'sql') return { ...seg, content: formatSql(seg.content) };
                if (seg.type === 'plot') return { ...seg, content: formatPlotCode(seg.content) };
                return seg;
            });
            return { ...cell, content: reconstructCellContent(formattedSegments) };
        });
        updateCellsAndMarkdown(newCells);
    }, [updateCellsAndMarkdown]);

    // Expose a testing API on window for Playwright/e2e tests.
    // Only available when import.meta.env.DEV is true (Vite dev server).
    useEffect(() => {
        if (!import.meta.env.DEV) return;
        (window as any).__notebookApi = {
            /** Replace the entire notebook with raw markdown. */
            setMarkdown: (md: string) => setNotebookMarkdown(md),
            /** Get the current raw notebook markdown. */
            getMarkdown: () => notebookMarkdownRef.current,
            /** Append a new cell. type: 'sql'|'plot'|'markdown', content: string. Returns cell id. */
            addCell: (mut: { type: 'sql' | 'plot' | 'markdown'; content: string; afterCellId?: string }) =>
                addCellFromTool(mut),
            /** Append multiple cells at once. */
            addCells: (muts: { type: 'sql' | 'plot' | 'markdown'; content: string }[]) =>
                addCellsBatchFromTool(muts),
            /** Update a cell by id. */
            updateCell: (cellId: string, content: string) => updateCell(cellId, content),
            /** Delete a cell by id. */
            deleteCell: (cellId: string) => deleteCell(cellId),
            /** Get the current cells array (id + content). */
            getCells: () => cellsRef.current.map(c => ({ id: c.id, content: c.content })),
            /** Run all queries in all cells. Returns a promise. */
            runAll: () => handleRunAll(),
            /** Load a JFR or DuckDB file from a URL (e.g. fetch + ArrayBuffer). */
            loadFileFromUrl: async (url: string, fileName: string) => {
                const resp = await fetch(url);
                if (!resp.ok) throw new Error(`fetch ${url} failed: ${resp.status}`);
                const bytes = new Uint8Array(await resp.arrayBuffer());
                await loadFile(bytes, fileName);
            },
        };
        return () => { delete (window as any).__notebookApi; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setNotebookMarkdown, addCellFromTool, addCellsBatchFromTool, updateCell, deleteCell, handleRunAll, loadFile]);

    const cmdActions: CommandAction[] = useMemo(() => [
        { id: 'format-all', label: 'Format all cells', hint: '⇧⇧ then "format"', keywords: 'beautify pretty indent', run: () => formatAllCells() },
        { id: 'run-all', label: 'Run all queries', hint: 'run every SQL block', keywords: 'execute', run: () => { void handleRunAll(); } },
        { id: 'add-cell', label: 'Add new cell', keywords: 'new insert create', run: () => addCell() },
        { id: 'collapse-all', label: 'Collapse all cells', keywords: 'hide fold', run: () => { setCollapseTrigger(Date.now()); setAllCollapsed(true); } },
        { id: 'expand-all', label: 'Expand all cells', keywords: 'show unfold open', run: () => { setCollapseTrigger(Date.now()); setAllCollapsed(false); } },
        { id: 'clear-results', label: 'Clear all results', keywords: 'reset', run: () => handleClearResults() },
        { id: 'save', label: 'Save notebook', keywords: 'download export', run: () => handleSaveNotebook() },
        { id: 'templates', label: 'Open template gallery', keywords: 'new template load', run: () => setIsTemplateGalleryOpen(true) },
        { id: 'undo', label: 'Undo', keywords: 'revert back', hint: canUndo ? '⌘Z' : '(nothing to undo)', run: () => { if (canUndo) undo(); } },
        { id: 'redo', label: 'Redo', keywords: 'forward', hint: canRedo ? '⇧⌘Z' : '(nothing to redo)', run: () => { if (canRedo) redo(); } },
        { id: 'settings', label: 'Open settings', keywords: 'preferences config api key', run: () => setIsSettingsModalOpen(true) },
        { id: 'toggle-ai', label: `${isAiEnabled ? 'Disable' : 'Enable'} AI features`, keywords: 'llm assistant', run: () => setIsAiEnabled(!isAiEnabled) },
        { id: 'toggle-autorun', label: `${isAutoRunEnabled ? 'Disable' : 'Enable'} auto-run on load`, keywords: 'autorun', run: () => setIsAutoRunEnabled(!isAutoRunEnabled) },
        { id: 'toggle-md', label: `${isMarkdownMode ? 'Exit' : 'Enter'} raw markdown view`, keywords: 'markdown raw', run: () => setIsMarkdownMode(!isMarkdownMode) },
    ], [formatAllCells, handleRunAll, addCell, isAiEnabled, setIsAiEnabled, isAutoRunEnabled, setIsAutoRunEnabled, isMarkdownMode, setIsMarkdownMode, handleClearResults, handleSaveNotebook, canUndo, canRedo, undo, redo, setCollapseTrigger, setAllCollapsed, setIsTemplateGalleryOpen]);

    const cmdCells: CellEntry[] = useMemo(() =>
        cells.map((c, i) => {
            let title = cellTitleCacheRef.current.get(c);
            if (title === undefined) {
                title = parseCellContent(tokenizeCellContent(c.content)).title ?? '';
                cellTitleCacheRef.current.set(c, title);
            }
            return { id: c.id, title, index: i };
        }),
    [cells]);

    const cmdRunQuery = useCallback(async (sql: string) => {
        const rows = await query(sql);
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        return { columns, rows };
    }, [query]);

    const cmdAiAddCell = useCallback(async (description: string) => {
        const tables = schemaRef.current?.tables ?? [];
        const views = schemaRef.current?.views ?? [];
        const macros = schemaRef.current?.macros ?? [];
        const res = await aiService.getAiAgentResponse(
            [{ role: 'user', parts: [{ text: `Create a notebook cell that shows: ${description}` }] }] as any,
            tables, views, macros, undefined, 'no-data', null,
        );
        if (res.code) {
            addCellFromTool({ type: 'sql', content: res.code });
        }
        if (res.plotConfig) {
            addCellFromTool({ type: 'plot', content: res.plotConfig });
        }
        if (!res.code && !res.plotConfig) {
            throw new Error(res.text || 'AI did not return any cell content.');
        }
    }, [addCellFromTool]);

    const cmdAddSqlCell = useCallback((sql: string, plotConfig: string | null) => {
        addCellFromTool({ type: 'sql', content: sql });
        if (plotConfig) {
            addCellFromTool({ type: 'plot', content: plotConfig });
        }
    }, [addCellFromTool]);

    const handleMetadataChange = useCallback(async (newMetadata: NotebookMetadata) => {
        const newNotebookMarkdown = reconstructNotebook({ metadata: newMetadata, content: cellsContent });
        setNotebookMarkdown(newNotebookMarkdown);
        await refreshSchema();
    }, [cellsContent, refreshSchema]);

    const handleNavigateRef = useCallback((ref: string) => {
        const idxMatch = /^(?:cell-|plot-)?(\d+)$/.exec(ref);
        const el = idxMatch
            ? document.querySelector(`[data-cell-idx="${idxMatch[1]}"]`)
            : document.querySelector(`[data-cell-alias="${ref}"], [data-cell-alias="${ref.replace(/^@/, '')}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    const handlePopChatToSidebar = useCallback((snapshot: import('./components/ChatPanel').InlineChatSnapshot) => {
        setIncomingChannel(snapshot);
        setIsChatPanelCollapsed(false);
    }, [setIsChatPanelCollapsed]);

    const handleIncomingChannelConsumed = useCallback(() => setIncomingChannel(null), []);

    const handleToggleSidebar = useCallback(() => setIsSidebarCollapsed(v => !v), [setIsSidebarCollapsed]);
    const handleToggleChatPanel = useCallback(() => setIsChatPanelCollapsed(v => !v), [setIsChatPanelCollapsed]);

    const handleCloseSettingsModal = useCallback(() => setIsSettingsModalOpen(false), []);
    const handleCloseTemplateGallery = useCallback(() => setIsTemplateGalleryOpen(false), []);
    const handleCloseCommandPalette = useCallback(() => setIsCmdPaletteOpen(false), []);
    const handleTemplateInsert = useCallback((merged: string, warnings: string[]) => {
        loadNotebook(merged);
        if (warnings.length > 0) console.warn('Template merge warnings:', warnings);
    }, [loadNotebook]);

    // Seed session_start / session_end variables from recording bounds when a
    // JFR file is loaded OR when a new notebook template is applied (which clears
    // the variables). Re-runs whenever either bound changes OR either var is missing.
    const sessionStartMissing = !metadata.variables?.['$session_start'];
    const sessionEndMissing   = !metadata.variables?.['$session_end'];
    useEffect(() => {
        if (recordingStart == null && recordingEnd == null) return;
        const current = metadata.variables ?? {};
        const seeded = computeSessionVariables(current, recordingStart, recordingEnd);
        if (seeded === current) return; // no-op — already set or no bounds
        const newNotebookMarkdown = reconstructNotebook({
            metadata: { ...metadata, variables: seeded },
            content: cellsContent,
        });
        setNotebookMarkdown(newNotebookMarkdown);
        void refreshSchema();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recordingStart, recordingEnd, sessionStartMissing, sessionEndMissing]);

    if (dbState !== DBState.READY) {
        // Show the drop zone during initial probe (mode still null) so the user sees the UI immediately
        // instead of a blank screen while we wait for the server probe to time out.
        const showDropZone = mode === 'wasm' || (mode === null && dbState === DBState.SCHEMA_LOADING);
        if (showDropZone && (dbState === DBState.NEEDS_FILE || dbState === DBState.IMPORTING || dbState === DBState.SCHEMA_LOADING || dbState === DBState.ERROR)) {
            return (
                <JFRDropZone
                    onFileSelected={(bytes, fileName, stacktraceDepth) => { void loadFile(bytes, fileName, stacktraceDepth); }}
                    isImporting={dbState === DBState.IMPORTING || (mode === 'wasm' && dbState === DBState.SCHEMA_LOADING)}
                    importPhase={dbState === DBState.SCHEMA_LOADING && mode === 'wasm' ? 'Building schema…' :
                        (importProgress ?? 0) < 0.05 ? 'Warming up…' :
                        (importProgress ?? 0) < 0.70 ? `Parsing chunks… ${Math.round((importProgress ?? 0) * 100)}%` :
                        (importProgress ?? 0) < 0.85 ? 'Flushing inserts…' :
                        (importProgress ?? 0) < 0.95 ? 'Merging tables…' :
                        'Registering views…'}
                    importProgress={importProgress}
                    errorMessage={dbState === DBState.ERROR ? errorMessage : null}
                    onLoadDemo={() => { loadNotebook(initialNotebook); void loadDemo(); }}
                    onLoadGcNotebook={() => { loadNotebook(gcAnalysisNotebook); void loadDemo(); }}
                    wasmInitializing={wasmInitializing}
                />
            );
        }
        return <FileLoader dbState={dbState} errorMessage={errorMessage} />;
    }
    
    return (
      <DisplaySettingsProvider value={displaySettings}>
       <SkillContextProvider>
       <ExecutorProvider cells={cells}>
        <div className="flex flex-col h-screen bg-gray-800 text-gray-200 font-sans">
            {isMdDragOver && (
                <div className="fixed inset-0 z-50 bg-cyan-900/30 border-4 border-dashed border-cyan-500/60 flex items-center justify-center pointer-events-none">
                    <div className="px-6 py-3 bg-gray-900/90 rounded-lg text-cyan-300 text-lg font-semibold shadow-xl">
                        Drop .md file to load notebook
                    </div>
                </div>
            )}
            {pendingJfrFile && (
                <div className="fixed inset-0 z-50 bg-gray-900/80 flex items-center justify-center">
                    <div className="bg-gray-800 border border-amber-500/40 rounded-lg p-5 max-w-sm w-full mx-4">
                        <p className="text-amber-300 font-semibold text-sm mb-1">Large file detected</p>
                        <p className="text-gray-400 text-xs mb-4">
                            <span className="text-white font-medium">{pendingJfrFile.file.name}</span> is{' '}
                            {pendingJfrFile.sizeMb.toFixed(0)} MB. Choose how many stack frames to store per event.
                        </p>
                        <p className="text-gray-300 text-xs font-medium mb-2">Stack trace depth</p>
                        <div className="flex flex-col gap-2">
                            {[{value:50,label:'50 frames',description:'Full depth — slowest'},{value:10,label:'10 frames',description:'Default'},{value:5,label:'5 frames',description:'Faster'},{value:0,label:'Skip',description:'No call stack — fastest'}].map(opt => (
                                <label key={opt.value} className={`flex items-center gap-3 p-2.5 rounded border cursor-pointer transition-colors ${pendingJfrDepth===opt.value?'border-cyan-500 bg-cyan-900/20 text-white':'border-gray-600 bg-gray-700/30 text-gray-400 hover:border-gray-500'}`}>
                                    <input type="radio" name="app-depth" value={opt.value} checked={pendingJfrDepth===opt.value} onChange={() => setPendingJfrDepth(opt.value)} className="accent-cyan-400"/>
                                    <span className="text-sm font-medium w-20">{opt.label}</span>
                                    <span className="text-xs text-gray-500">{opt.description}</span>
                                </label>
                            ))}
                        </div>
                        <div className="mt-4 flex gap-3">
                            <button onClick={() => { const f = pendingJfrFile; setPendingJfrFile(null); void loadFile(f.file, f.file.name, pendingJfrDepth); }} className="flex-1 py-2 px-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm font-medium">Import</button>
                            <button onClick={() => setPendingJfrFile(null)} className="py-2 px-4 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm">Cancel</button>
                        </div>
                    </div>
                </div>
            )}
            <SettingsModal isOpen={isSettingsModalOpen} onClose={handleCloseSettingsModal} />
            <TemplateGalleryModal
                isOpen={isTemplateGalleryOpen}
                onClose={handleCloseTemplateGallery}
                currentSource={notebookMarkdown}
                mode={mode}
                onInsert={handleTemplateInsert}
            />
            <CommandPalette isOpen={isCmdPaletteOpen} onClose={handleCloseCommandPalette} actions={cmdActions} cells={cmdCells} onRunQuery={cmdRunQuery} onAiAddCell={cmdAiAddCell} onAddSqlCell={cmdAddSqlCell} isAiAvailable={isAiFeatureActive} />
            {aiFailureMessage && <ToastNotification title="AI Assistant Alert" message={aiFailureMessage} onClose={() => setAiFailureMessage(null)} action={{ label: 'Open Settings →', onClick: () => setIsSettingsModalOpen(true) }} />}
            {serverProbeError && !probeToastDismissed && <ToastNotification title="Running in WASM mode" message={`Server probe failed: ${serverProbeError}. Drop a .jfr or .duckdb file to get started.`} onClose={() => setProbeToastDismissed(true)} duration={5000} />}
            {invalidFileToast && <ToastNotification title="Unsupported file" message={invalidFileToast} onClose={() => setInvalidFileToast(null)} duration={5000} />}

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
                    {recordingStart != null && (
                        <>
                            <div className="w-px h-5 bg-gray-700 mx-1" />
                            <SessionDateChip
                                label="$session_start"
                                value={(metadata.variables ?? {})['$session_start'] ?? ''}
                                onChange={v => void handleMetadataChange({ ...metadata, variables: { ...(metadata.variables ?? {}), '$session_start': v } })}
                                min={recordingStart}
                                max={recordingEnd}
                                defaultIfEmpty={recordingStart}
                            />
                            <SessionDateChip
                                label="$session_end"
                                value={(metadata.variables ?? {})['$session_end'] ?? ''}
                                onChange={v => void handleMetadataChange({ ...metadata, variables: { ...(metadata.variables ?? {}), '$session_end': v } })}
                                min={recordingStart}
                                max={recordingEnd}
                                defaultIfEmpty={recordingEnd}
                            />
                        </>
                    )}
                    <div className="w-px h-5 bg-gray-700 mx-1" />
                    <div className="flex items-center gap-1">
                        <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo" className="p-1.5 rounded-md disabled:opacity-30 text-gray-400 disabled:text-gray-600 hover:enabled:bg-gray-700/50"><ArrowUturnLeftIcon className="w-4 h-4"/></button>
                        <button onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo" className="p-1.5 rounded-md disabled:opacity-30 text-gray-400 disabled:text-gray-600 hover:enabled:bg-gray-700/50"><ArrowUturnRightIcon className="w-4 h-4"/></button>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={() => setIsAutoRunEnabled(!isAutoRunEnabled)} className={`p-1.5 rounded-md transition-colors ${isAutoRunEnabled ? 'text-cyan-300 bg-cyan-900/30' : 'text-gray-400 hover:bg-gray-700/50'}`} title={isAutoRunEnabled ? "Auto-Run enabled — click to disable" : "Auto-Run disabled — click to enable"} aria-label={isAutoRunEnabled ? "Disable Auto-Run" : "Enable Auto-Run"}>
                            {isAutoRunEnabled ? <PauseCircleIcon className="w-4 h-4" /> : <PlayCircleIcon className="w-4 h-4" />}
                        </button>
                        <button onClick={handleRunAll} disabled={isRunningAll} title="Run All Queries" aria-label="Run All Queries" className={`p-1.5 rounded-md disabled:opacity-50 ${isRunningAll ? 'text-green-400 animate-pulse' : 'text-gray-400 hover:text-green-400'}`}>
                            {isRunningAll ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"/> : <PlayIcon className="w-4 h-4"/>}
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => { setCollapseTrigger(Date.now()); setAllCollapsed(true); }} className="p-1.5 rounded-md text-gray-400 hover:text-gray-200" title="Collapse All" aria-label="Collapse All"><ChevronDoubleUpIcon className="w-4 h-4"/></button>
                    <button onClick={() => { setCollapseTrigger(Date.now()); setAllCollapsed(false); }} className="p-1.5 rounded-md text-gray-400 hover:text-gray-200" title="Expand All" aria-label="Expand All"><ChevronDoubleDownIcon className="w-4 h-4"/></button>
                    <button onClick={handleClearResults} className="p-1.5 rounded-md text-gray-400 hover:text-red-400" title="Clear All Results" aria-label="Clear All Results"><TrashIcon className="w-4 h-4"/></button>
                    <div className="w-px h-5 bg-gray-700 mx-1" />
                    <input ref={notebookFileInputRef} type="file" accept=".md,.markdown" className="hidden" onChange={handleLoadNotebook} />
                    <button onClick={() => notebookFileInputRef.current?.click()} className="p-1.5 rounded-md text-gray-400 hover:text-gray-200" title="Load Notebook" aria-label="Load Notebook"><ArrowUpTrayIcon className="w-4 h-4"/></button>
                    <button onClick={() => setIsTemplateGalleryOpen(true)} className="p-1.5 rounded-md text-gray-400 hover:text-cyan-300" title="New from template" aria-label="New from template"><DocumentTextIcon className="w-4 h-4"/></button>
                    <button onClick={() => loadNotebook(gcAnalysisNotebook)} className="p-1.5 rounded-md text-gray-400 hover:text-emerald-400" title="New GC Analysis Notebook" aria-label="New GC Analysis Notebook"><BeakerIcon className="w-4 h-4"/></button>
                    <button onClick={handleSaveNotebook} className="p-1.5 rounded-md text-gray-400 hover:text-gray-200" title="Save Notebook (⌘S)" aria-label="Save Notebook"><ArrowDownTrayIcon className="w-4 h-4"/></button>
                    <button onClick={() => setIsMarkdownMode(!isMarkdownMode)} className={`p-1.5 rounded-md ${isMarkdownMode ? 'text-cyan-300' : 'text-gray-400'} hover:text-cyan-300`} title={isMarkdownMode ? "Switch to Notebook View" : "Edit Raw Markdown (split preview)"} aria-label={isMarkdownMode ? "Switch to Notebook View" : "Edit Raw Markdown"}><CodeBracketIcon className="w-4 h-4"/></button>
                    {isAiAvailable && (
                        <button onClick={() => setIsAiEnabled(!isAiEnabled)} className={`p-1.5 rounded-md ${isAiEnabled ? 'text-yellow-400' : 'text-gray-400'}`} title={isAiEnabled ? "Disable AI Features" : "Enable AI Features"} aria-label={isAiEnabled ? "Disable AI Features" : "Enable AI Features"}>
                            <SparklesIcon className="w-4 h-4"/>
                        </button>
                    )}
                    <div className="w-px h-5 bg-gray-700 mx-1" />
                    <button onClick={() => setPresenterMode(!presenterMode)} className={`p-1.5 rounded-md ${presenterMode ? 'text-cyan-300 bg-cyan-900/30' : 'text-gray-400'} hover:text-cyan-300`} title={presenterMode ? "Exit Presenter Mode" : "Presenter Mode (hide editors)"} aria-label={presenterMode ? "Exit Presenter Mode" : "Presenter Mode"}>
                        <EyeIcon className="w-4 h-4"/>
                    </button>
                    <div className="w-px h-5 bg-gray-700 mx-1" />
                    <a href="https://parttimenerd.github.io/jfr-query/docs/" target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-md text-gray-400 hover:text-gray-200" title="Documentation" aria-label="Documentation"><BookOpenIcon className="w-4 h-4"/></a>
                    <button onClick={() => setIsSettingsModalOpen(true)} className="p-1.5 rounded-md text-gray-400 hover:text-gray-200" title="Settings" aria-label="Settings"><CogIcon className="w-4 h-4"/></button>
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
                    isCollapsed={isSidebarCollapsed || presenterMode}
                    onCollapseToggle={handleToggleSidebar}
                >
                    <Sidebar metadata={metadata} />
                </ResizablePanel>
                
                <main className={`flex-1 bg-gray-800 ${isMarkdownMode ? 'overflow-hidden flex flex-col' : 'overflow-auto'}`}>
                    <div className={isMarkdownMode ? 'flex-1 flex flex-col min-h-0' : undefined}>
                    <Notebook
                        notebookMarkdown={notebookMarkdown}
                        setNotebookMarkdown={setNotebookMarkdown}
                        isMarkdownMode={isMarkdownMode}
                        isAutoRunEnabled={isAutoRunEnabled}
                        cells={cells}
                        metadata={metadata}
                        results={results}
                        queryTimings={queryTimings}
                        collapseTrigger={collapseTrigger}
                        allCollapsed={allCollapsed}
                        clearResultsTrigger={clearResultsTrigger}
                        isAiFeatureActive={isAiFeatureActive}
                        onRunQuery={runQuery}
                        onUpdateCell={updateCell}
                        onDeleteCell={deleteCell}
                        onAddCell={addCell}
                        onAddCellFromTool={addCellFromTool}
                        onMoveCell={moveCell}
                        onSuggestPlot={suggestPlot}
                        onFormatCode={formatCode}
                        onRunPreviewQuery={runPreviewQuery}
                        onMetadataChange={handleMetadataChange}
                        onDeleteQueryBlock={deleteQueryBlock}
                        presenterMode={presenterMode}
                        onPopChatToSidebar={handlePopChatToSidebar}
                        onNavigateRef={handleNavigateRef}
                    />
                    </div>
                </main>

                {isAiFeatureActive && (
                     <ResizablePanel
                        side="right"
                        initialWidth={400}
                        minWidth={300}
                        isCollapsed={isChatPanelCollapsed}
                        onCollapseToggle={handleToggleChatPanel}
                    >
                        <ChatPanel
                            metadata={metadata}
                            onAddCellFromAI={addCellFromAI}
                            cells={cells}
                            onAddCell={addCellFromTool}
                            onAddCellsBatch={addCellsBatchFromTool}
                            onUpdateCell={updateCell}
                            onDeleteCell={deleteCell}
                            onMoveCell={moveCell}
                            onMetadataChange={handleMetadataChange}
                            onUndoLastAction={canUndo ? undo : undefined}
                            onBeforeMutate={flushHistory}
                            incomingChannel={incomingChannel}
                            onIncomingChannelConsumed={handleIncomingChannelConsumed}
                            onNavigateRef={handleNavigateRef}
                        />
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
       </ExecutorProvider>
       </SkillContextProvider>
      </DisplaySettingsProvider>
    );
};

export default App;