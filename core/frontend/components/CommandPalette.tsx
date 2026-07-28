import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DataContext } from '../context/DuckDBContext';
import { aiService } from '../services/AiService';

export interface CommandAction {
    id: string;
    label: string;
    hint?: string;
    keywords?: string;
    group?: string;
    run: () => void | Promise<void>;
}

export interface CellEntry {
    id: string;
    title: string;
    index: number;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    actions: CommandAction[];
    cells?: CellEntry[];
    onRunQuery?: (sql: string) => Promise<{ columns: string[]; rows: any[] }>;
    onAiAddCell?: (description: string) => Promise<void>;
    onAddSqlCell?: (sql: string, plotConfig: string | null) => void;
    isAiAvailable?: boolean;
}

// Fuzzy match: every char of `needle` (lowercase) appears in `hay` in order.
// Returns a score: lower is better. Contiguous runs and prefix matches rank higher.
function fuzzyScore(needle: string, hay: string): number | null {
    if (!needle) return 0;
    const n = needle.toLowerCase();
    const h = hay.toLowerCase();

    const subIdx = h.indexOf(n);
    if (subIdx !== -1) return subIdx === 0 ? -1000 : -500 + subIdx;

    let j = 0;
    let score = 0;
    let lastMatchIdx = -1;
    for (let i = 0; i < h.length && j < n.length; i++) {
        if (h[i] === n[j]) {
            const gap = i - lastMatchIdx - 1;
            score += gap * 2;
            if (lastMatchIdx === -1 || (i > 0 && h[i - 1] === ' ')) score -= 5;
            lastMatchIdx = i;
            j++;
        }
    }
    if (j < n.length) return null;
    return score;
}

function fuzzyMatch(needle: string, hay: string): boolean {
    return fuzzyScore(needle, hay) !== null;
}

type ItemKind = 'action' | 'table' | 'column' | 'cell' | 'special';

interface ResultItem {
    kind: ItemKind;
    id: string;
    label: string;
    hint?: string;
    score: number;
    action?: CommandAction;
    tableName?: string;
    cellId?: string;
    specialKind?: '!' | '!!' | '+';
    specialPayload?: string;
}

const KIND_ORDER: ItemKind[] = ['action', 'cell', 'table', 'column'];
const KIND_LABEL: Record<ItemKind, string> = { action: 'Actions', cell: 'Cells', table: 'Tables', column: 'Columns', special: '' };
const KIND_ICON: Record<ItemKind, string> = { action: '›', cell: '#', table: '⌗', column: '·', special: '' };
const KIND_COLOR: Record<ItemKind, string> = {
    action: 'text-gray-400',
    cell: 'text-purple-400',
    table: 'text-cyan-400',
    column: 'text-emerald-400',
    special: 'text-yellow-400',
};

type SubMode = { kind: '!' | '!!' | '+'; value: string } | null;

// Inline result table for quick queries
const QuickQueryResult: React.FC<{ columns: string[]; rows: any[]; error?: string }> = ({ columns, rows, error }) => {
    const [copied, setCopied] = React.useState(false);
    if (error) return <div className="text-xs text-red-400 font-mono px-2 py-2 whitespace-pre-wrap">{error}</div>;
    if (columns.length === 0) return <div className="text-xs text-gray-500 px-2 py-2">Query returned no columns.</div>;
    const display = rows.slice(0, 20);
    const handleCsvCopy = () => {
        const escape = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
        const lines = [columns.map(escape).join(','), ...rows.map(r => columns.map(c => escape(r[c])).join(','))];
        navigator.clipboard.writeText(lines.join('\n')).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
    };
    return (
        <div className="overflow-x-auto border-t border-gray-800">
            <div className="text-[10px] text-gray-500 px-3 py-1 flex items-center justify-between">
                <span>{rows.length} row{rows.length !== 1 ? 's' : ''}{rows.length > 20 ? ' (showing 20)' : ''}</span>
                <button onClick={handleCsvCopy} className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${copied ? 'text-emerald-400' : 'text-gray-600 hover:text-gray-300'}`}>
                    {copied ? '✓ copied' : 'CSV ↓'}
                </button>
            </div>
            <table className="text-xs w-full">
                <thead>
                    <tr>{columns.map(c => <th key={c} className="px-3 py-1 text-left text-gray-400 border-b border-gray-800 font-normal">{c}</th>)}</tr>
                </thead>
                <tbody>
                    {display.map((r, i) => (
                        <tr key={i} className={i % 2 === 0 ? '' : 'bg-gray-800/40'}>
                            {columns.map(c => <td key={c} className="px-3 py-1 font-mono text-gray-300 max-w-[200px] truncate">{String(r[c] ?? '')}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const HELP_CONTENT = [
    { prefix: '>', desc: 'commands only' },
    { prefix: ':N', desc: 'jump to cell N  (e.g. :3)' },
    { prefix: '!', desc: 'run SQL — preview result in palette' },
    { prefix: '!!', desc: 'run SQL — add as cell (+ AI plot if configured)' },
    { prefix: '+', desc: 'AI: add a cell from description' },
    { prefix: '?', desc: 'show this help' },
];

const CommandPalette: React.FC<Props> = ({ isOpen, onClose, actions, cells, onRunQuery, onAiAddCell, onAddSqlCell, isAiAvailable }) => {
    const { schema } = useContext(DataContext);
    const [query, setQuery] = useState('');
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [mode, setMode] = useState<'actions' | 'ask'>('actions');
    const [askBusy, setAskBusy] = useState(false);
    const [askAnswer, setAskAnswer] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Sub-mode state (for `!` and `+` with empty rest)
    const [subMode, setSubMode] = useState<SubMode>(null);
    const [subValue, setSubValue] = useState('');
    const [subBusy, setSubBusy] = useState(false);
    const subBusyRef = useRef(false);
    // Keep ref in sync so timeout callbacks can read the latest value without stale closure.
    subBusyRef.current = subBusy;
    const [subResult, setSubResult] = useState<{ columns: string[]; rows: any[] } | null>(null);
    const [subError, setSubError] = useState<string | null>(null);
    const subTextareaRef = useRef<HTMLTextAreaElement>(null);
    const [copyFlash, setCopyFlash] = useState<string | null>(null);
    const copyFlashTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (isOpen) {
            if (copyFlashTimerRef.current) { clearTimeout(copyFlashTimerRef.current); copyFlashTimerRef.current = null; }
            setCopyFlash(null);
            setQuery('');
            setSelectedIdx(0);
            setMode('actions');
            setAskAnswer(null);
            setSubMode(null);
            setSubValue('');
            setSubResult(null);
            setSubError(null);
            setSubBusy(false);
            setTimeout(() => inputRef.current?.focus(), 0);
        }
        return () => {
            if (copyFlashTimerRef.current) { clearTimeout(copyFlashTimerRef.current); copyFlashTimerRef.current = null; }
        };
    }, [isOpen]);

    useEffect(() => {
        if (subMode) setTimeout(() => subTextareaRef.current?.focus(), 0);
    }, [subMode]);

    const aiOn = isAiAvailable ?? false;

    // Detect prefix — `!!` must be checked before `!`
    const prefix = useMemo(() => {
        const q = query;
        if (q.startsWith('!!')) return '!!';
        if (q.startsWith('>')) return '>';
        if (q.startsWith('!')) return '!';
        if (q.startsWith('+')) return '+';
        if (q.startsWith('?')) return '?';
        if (/^:\d*$/.test(q)) return ':';
        return null;
    }, [query]);

    const rest = useMemo(() => {
        if (prefix === null) return query.trim();
        return query.slice(prefix.length).trim();
    }, [query, prefix]);

    const placeholder = useMemo(() => {
        if (mode === 'ask') return 'Ask anything about your data…';
        if (prefix === '>') return 'Commands…';
        if (prefix === '!') return 'SQL to preview in palette…';
        if (prefix === '!!') return 'SQL to add as cell (+ auto plot)…';
        if (prefix === '+') return aiOn ? 'Describe a cell to create (AI)…' : 'AI not available';
        if (prefix === ':') return 'Cell number…';
        if (prefix === '?') return 'Help';
        return 'Search commands, cells, tables, columns…';
    }, [prefix, mode, aiOn]);

    const items: ResultItem[] = useMemo(() => {
        if (mode !== 'actions') return [];
        const q = rest;

        // `?` help — no items, rendered separately
        if (prefix === '?') return [];

        // `:N` jump-to-cell
        if (prefix === ':') {
            const n = parseInt(q, 10);
            if (!isNaN(n) && n >= 1 && cells && cells[n - 1]) {
                const c = cells[n - 1];
                return [{ kind: 'cell', id: `jump-${c.id}`, label: c.title || `Cell ${n}`, hint: `cell ${n}`, score: 0, cellId: c.id }];
            }
            // partial: show all cells as a filtered fallback while typing
            if (!q && cells) {
                return cells.map((c, i) => ({ kind: 'cell' as const, id: `cell-nav-${c.id}`, label: c.title || `Cell ${i + 1}`, hint: `cell ${i + 1}`, score: i, cellId: c.id }));
            }
            return [];
        }

        // `>` commands only
        if (prefix === '>') {
            return actions
                .map(a => {
                    const score = fuzzyScore(q, `${a.label} ${a.keywords ?? ''}`);
                    if (score === null) return null;
                    return { kind: 'action' as const, id: a.id, label: a.label, hint: a.hint, score, action: a };
                })
                .filter(Boolean) as ResultItem[];
        }

        // `!` run SQL — preview
        if (prefix === '!') {
            if (!q) return [{ kind: 'special', id: 'run-sql-prompt', label: 'Run SQL…', hint: 'press Enter to open editor', score: 0, specialKind: '!' as const, specialPayload: '' }];
            return [{ kind: 'special', id: 'run-sql-inline', label: `Run: ${q}`, hint: 'Enter to preview', score: 0, specialKind: '!' as const, specialPayload: q }];
        }

        // `!!` run SQL — add as cell
        if (prefix === '!!') {
            if (!q) return [{ kind: 'special', id: 'add-sql-prompt', label: 'Add SQL cell…', hint: 'press Enter to open editor', score: 0, specialKind: '!!' as const, specialPayload: '' }];
            return [{ kind: 'special', id: 'add-sql-inline', label: `Add cell: ${q}`, hint: aiOn ? 'Enter → add + AI plot' : 'Enter to add', score: 0, specialKind: '!!' as const, specialPayload: q }];
        }

        // `+` AI add cell
        if (prefix === '+') {
            if (!aiOn) return [{ kind: 'special', id: 'ai-unavail', label: 'AI not available — configure in ⚙ Settings', hint: '', score: 0 }];
            if (!q) return [{ kind: 'special', id: 'ai-cell-prompt', label: 'Add cell with AI…', hint: 'press Enter to open editor', score: 0, specialKind: '+' as const, specialPayload: '' }];
            return [{ kind: 'special', id: 'ai-cell-inline', label: `Add cell: ${q}`, hint: 'Enter to generate', score: 0, specialKind: '+' as const, specialPayload: q }];
        }

        // Default: actions + cells + tables + columns
        const actionItems: ResultItem[] = actions
            .map(a => {
                const score = fuzzyScore(q, `${a.label} ${a.keywords ?? ''}`);
                if (score === null) return null;
                return { kind: 'action' as const, id: a.id, label: a.label, hint: a.hint, score, action: a };
            })
            .filter(Boolean) as ResultItem[];

        const cellItems: ResultItem[] = (cells ?? [])
            .map(c => {
                const haystack = c.title || `Cell ${c.index + 1}`;
                if (q && !fuzzyMatch(q, haystack)) return null;
                const score = q ? (fuzzyScore(q, haystack) ?? 0) : c.index;
                return { kind: 'cell' as const, id: `cell-nav-${c.id}`, label: haystack, hint: `cell ${c.index + 1}`, score, cellId: c.id };
            })
            .filter(Boolean) as ResultItem[];

        const tableItems: ResultItem[] = (schema?.tables ?? [])
            .map(t => {
                const colMatch = q ? t.columns.some(c => fuzzyMatch(q, c.name)) : false;
                const score = q ? fuzzyScore(q, t.name) : 0;
                if (q && score === null && !colMatch) return null;
                return { kind: 'table' as const, id: `tbl-${t.name}`, label: t.name, hint: `${t.columns.length} cols${(t as any).rowCount !== undefined ? ` · ${(t as any).rowCount} rows` : ''}`, score: score ?? 100 };
            })
            .filter(Boolean) as ResultItem[];

        const columnItems: ResultItem[] = q
            ? (schema?.tables ?? [])
                .flatMap(t => t.columns.map(c => {
                    const score = fuzzyScore(q, c.name);
                    if (score === null) return null;
                    return { kind: 'column' as const, id: `col-${t.name}-${c.name}`, label: c.name, hint: `${t.name} · ${(c as any).type ?? ''}`.replace(/·\s*$/, ''), score, tableName: t.name };
                }).filter(Boolean) as ResultItem[])
                .slice(0, 12)
            : [];

        const grouped = new Map<ItemKind, ResultItem[]>();
        for (const item of [...actionItems, ...cellItems, ...tableItems, ...columnItems]) {
            const list = grouped.get(item.kind) ?? [];
            list.push(item);
            grouped.set(item.kind, list);
        }
        const result: ResultItem[] = [];
        for (const kind of KIND_ORDER) {
            const list = grouped.get(kind);
            if (list && list.length > 0) {
                list.sort((a, b) => a.score - b.score);
                result.push(...list.slice(0, kind === 'table' || kind === 'column' ? 8 : undefined));
            }
        }
        return result;
    }, [actions, schema, rest, prefix, cells, aiOn, mode]);

    useEffect(() => { setSelectedIdx(0); setSubResult(null); setSubError(null); }, [query, mode]);

    // Auto-run `!<sql>` after a short debounce so results appear while typing.
    useEffect(() => {
        if (prefix !== '!' || !rest || !onRunQuery || subBusy) return;
        const t = setTimeout(() => {
            if (!subBusyRef.current) void executeSpecial('!', rest);
        }, 600);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rest, prefix]);

    useEffect(() => {
        const el = listRef.current?.querySelector(`[data-idx="${selectedIdx}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: 'nearest' });
    }, [selectedIdx]);

    const executeSpecial = async (kind: '!' | '!!' | '+', payload: string) => {
        if (kind === '!') {
            if (!onRunQuery) return;
            setSubBusy(true);
            setSubResult(null);
            setSubError(null);
            try {
                const res = await onRunQuery(payload);
                setSubResult(res);
            } catch (e: any) {
                setSubError(e?.message || String(e));
            } finally {
                setSubBusy(false);
            }
        } else if (kind === '!!') {
            if (!onAddSqlCell) return;
            setSubBusy(true);
            setSubError(null);
            try {
                // Optionally get AI plot suggestion
                let plotConfig: string | null = null;
                if (aiOn) {
                    try { plotConfig = await aiService.getAiSuggestPlot(payload); } catch { /* skip plot on failure */ }
                }
                onAddSqlCell(payload, plotConfig);
                setSubBusy(false);
                onClose();
            } catch (e: any) {
                setSubError(e?.message || String(e));
                setSubBusy(false);
            }
        } else {
            if (!onAiAddCell) return;
            setSubBusy(true);
            setSubError(null);
            try {
                await onAiAddCell(payload);
                setSubBusy(false);
                onClose();
            } catch (e: any) {
                setSubError(e?.message || String(e));
                setSubBusy(false);
            }
        }
    };

    const handleSelect = async (idx: number) => {
        const item = items[idx];
        if (!item) return;
        if (item.kind === 'action') {
            onClose();
            await item.action!.run();
        } else if (item.kind === 'table') {
            try {
                await navigator.clipboard.writeText(item.label);
                setCopyFlash(item.label);
                if (copyFlashTimerRef.current) clearTimeout(copyFlashTimerRef.current);
                copyFlashTimerRef.current = window.setTimeout(() => { setCopyFlash(null); copyFlashTimerRef.current = null; onClose(); }, 700);
            } catch { onClose(); }
        } else if (item.kind === 'column') {
            const text = item.tableName ? `${item.tableName}.${item.label}` : item.label;
            try {
                await navigator.clipboard.writeText(text);
                setCopyFlash(text);
                if (copyFlashTimerRef.current) clearTimeout(copyFlashTimerRef.current);
                copyFlashTimerRef.current = window.setTimeout(() => { setCopyFlash(null); copyFlashTimerRef.current = null; onClose(); }, 700);
            } catch { onClose(); }
        } else if (item.kind === 'cell' && item.cellId) {
            onClose();
            setTimeout(() => {
                const el = document.querySelector(`[data-cell-id="${CSS.escape(item.cellId!)}"]`) as HTMLElement | null;
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 80);
        } else if (item.kind === 'special' && item.specialKind) {
            if (!item.specialPayload) {
                // Enter sub-mode
                setSubMode({ kind: item.specialKind, value: '' });
                setSubValue('');
                setSubResult(null);
                setSubError(null);
            } else {
                await executeSpecial(item.specialKind, item.specialPayload);
            }
        }
    };

    const handleSubConfirm = async () => {
        if (!subMode || !subValue.trim() || subBusy) return;
        await executeSpecial(subMode.kind, subValue.trim());
    };

    const handleAsk = async () => {
        if (!aiOn || !query.trim()) return;
        setAskBusy(true);
        setAskAnswer(null);
        try {
            const tables = schema?.tables ?? [];
            const views = schema?.views ?? [];
            const macros = schema?.macros ?? [];
            const res = await aiService.getAiAgentResponse(
                [{ role: 'user', parts: [{ text: query }] }] as any,
                tables, views, macros, undefined, 'no-data', null,
            );
            setAskAnswer(typeof res === 'string' ? res : (res as any)?.explanation ?? (res as any)?.text ?? JSON.stringify(res));
        } catch (e) {
            setAskAnswer('Error: ' + (e instanceof Error ? e.message : String(e)));
        } finally {
            setAskBusy(false);
        }
    };

    // Groups for rendering with headers (only for default mode)
    const groups = useMemo(() => {
        const out: { kind: ItemKind; label: string; start: number; end: number }[] = [];
        if (prefix !== null && prefix !== ':') return out; // special modes render differently
        let i = 0;
        while (i < items.length) {
            const kind = items[i].kind;
            const start = i;
            while (i < items.length && items[i].kind === kind) i++;
            out.push({ kind, label: KIND_LABEL[kind], start, end: i });
        }
        return out;
    }, [items, prefix]);

    const getActionHint = (item: ResultItem) => {
        if (item.kind === 'action') return item.hint ?? 'run';
        if (item.kind === 'table') return 'copy name';
        if (item.kind === 'column') return 'copy table.col';
        if (item.kind === 'cell') return 'jump to cell';
        if (item.kind === 'special') return item.hint ?? '';
        return '';
    };

    if (!isOpen) return null;

    const showHelp = prefix === '?';
    const showSubMode = subMode !== null;
    const useGroups = prefix === null || prefix === ':';

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40" onClick={onClose}>
            <div className="w-full max-w-xl bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
                    {showSubMode ? (
                        <>
                            <button onClick={() => { setSubMode(null); setSubValue(''); setSubResult(null); setSubError(null); inputRef.current?.focus(); }}
                                className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-gray-200 flex items-center gap-1">
                                ← back
                            </button>
                            <span className="text-xs text-gray-400">{subMode.kind === '!' ? 'Preview SQL' : subMode.kind === '!!' ? 'Add SQL cell' : 'Add cell with AI'}</span>
                        </>
                    ) : (
                        <>
                            <button className={`text-xs px-2 py-0.5 rounded ${mode === 'actions' ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400'}`} onClick={() => setMode('actions')}>Actions</button>
                            <button className={`text-xs px-2 py-0.5 rounded ${mode === 'ask' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400'} ${aiOn ? '' : 'opacity-40 cursor-not-allowed'}`}
                                onClick={() => aiOn && setMode('ask')} title={aiOn ? 'Ask the AI assistant' : 'AI is not configured'}>Ask AI</button>
                            <div className="text-[10px] text-gray-600 ml-auto">Esc · ↑↓ · Enter</div>
                        </>
                    )}
                </div>

                {/* Main input (hidden in sub-mode) */}
                {!showSubMode && (
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
                            if (mode === 'ask' && e.key === 'Enter') { e.preventDefault(); void handleAsk(); return; }
                            if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(items.length - 1, i + 1)); return; }
                            if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(0, i - 1)); return; }
                            if (e.key === 'Enter') { e.preventDefault(); void handleSelect(selectedIdx); return; }
                        }}
                        placeholder={placeholder}
                        className="w-full bg-transparent text-gray-100 px-4 py-3 outline-none border-b border-gray-800"
                    />
                )}

                {/* List / content area */}
                <div ref={listRef} className="max-h-96 overflow-y-auto">

                    {/* Sub-mode: textarea + result */}
                    {showSubMode && (
                        <div className="p-3 space-y-2">
                            <textarea
                                ref={subTextareaRef}
                                value={subValue}
                                onChange={e => setSubValue(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Escape') { e.preventDefault(); setSubMode(null); setSubValue(''); setSubResult(null); setSubError(null); inputRef.current?.focus(); return; }
                                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleSubConfirm(); return; }
                                    // For `+` and `!!` (single-line), plain Enter also confirms
                                    if ((subMode?.kind === '+' || subMode?.kind === '!!') && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSubConfirm(); return; }
                                }}
                                placeholder={subMode?.kind === '!' || subMode?.kind === '!!' ? 'SELECT ...' : 'e.g. CPU usage vs GC pause time'}
                                rows={subMode?.kind === '!' || subMode?.kind === '!!' ? 4 : 2}
                                className="w-full bg-gray-950 border border-gray-700 rounded text-sm text-gray-100 font-mono px-3 py-2 outline-none focus:border-cyan-600 resize-none"
                                disabled={subBusy}
                            />
                            <div className="flex items-center gap-2">
                                <button onClick={() => void handleSubConfirm()} disabled={!subValue.trim() || subBusy}
                                    className="text-xs px-3 py-1 rounded bg-cyan-700 text-white hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed">
                                    {subBusy
                                        ? (subMode?.kind === '+' ? 'Generating…' : subMode?.kind === '!!' ? 'Adding…' : 'Running…')
                                        : subMode?.kind === '!' ? '▶ Preview  ⌘↩'
                                        : subMode?.kind === '!!' ? '＋ Add cell  ↩'
                                        : '✦ Generate  ↩'}
                                </button>
                                <span className="text-[10px] text-gray-600">Esc to go back</span>
                            </div>
                            {subBusy && <div className="text-xs text-gray-400">{subMode?.kind === '+' ? 'AI is writing your cell…' : subMode?.kind === '!!' ? `Adding cell${aiOn ? ' + generating plot…' : '…'}` : 'Running query…'}</div>}
                            {subError && <div className="text-xs text-red-400 whitespace-pre-wrap">{subError}</div>}
                            {subResult && <QuickQueryResult columns={subResult.columns} rows={subResult.rows} />}
                        </div>
                    )}

                    {/* Help block */}
                    {!showSubMode && showHelp && (
                        <div className="px-4 py-4 space-y-2">
                            <div className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">Prefix modes</div>
                            {HELP_CONTENT.map(h => (
                                <div key={h.prefix} className="flex gap-3 text-sm">
                                    <span className="font-mono text-cyan-400 w-8 flex-shrink-0">{h.prefix}</span>
                                    <span className="text-gray-400">{h.desc}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Normal actions mode */}
                    {!showSubMode && !showHelp && mode === 'actions' && (
                        <>
                            {copyFlash && (
                                <div className="px-4 py-2 text-xs text-emerald-400 border-b border-gray-800 font-mono">
                                    ✓ Copied: <span className="text-gray-300">{copyFlash}</span>
                                </div>
                            )}
                            {items.length === 0 && !copyFlash && (
                                prefix === null && rest
                                    ? <div className="px-4 py-6 text-center text-sm text-gray-500">No matches for <span className="font-mono text-gray-400">"{rest}"</span>.<br/><span className="text-xs text-gray-600 mt-1 block">Try <span className="font-mono text-cyan-600">?</span> for prefix mode help.</span></div>
                                    : prefix === null
                                    ? <div className="px-4 py-5 text-center">
                                        <div className="text-xs text-gray-600 space-y-1">
                                            {HELP_CONTENT.slice(0, 4).map(h => (
                                                <div key={h.prefix} className="flex justify-center gap-2">
                                                    <span className="font-mono text-cyan-600 w-6 text-right">{h.prefix}</span>
                                                    <span className="text-gray-600">{h.desc}</span>
                                                </div>
                                            ))}
                                            <div className="text-gray-700 pt-1">type <span className="font-mono text-cyan-700">?</span> for full help</div>
                                        </div>
                                      </div>
                                    : <div className="px-4 py-6 text-center text-sm text-gray-500">No matches.</div>
                            )}

                            {/* Special-mode items (!, !!, +) — no group header */}
                            {(prefix === '!' || prefix === '!!' || prefix === '+') && items.map((it, idx) => (
                                <button key={it.id} data-idx={idx} onClick={() => handleSelect(idx)} onMouseEnter={() => setSelectedIdx(idx)}
                                    className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left ${idx === selectedIdx ? 'bg-gray-800' : ''}`}>
                                    <span className="flex items-center gap-2 min-w-0">
                                        <span className="font-mono text-yellow-400 flex-shrink-0">{prefix}</span>
                                        <span className={`text-sm truncate ${subBusy ? 'text-gray-500' : 'text-gray-200'}`}>{it.label}</span>
                                    </span>
                                    {subBusy
                                        ? <span className="text-xs text-gray-500 flex-shrink-0">{prefix === '!' ? 'Running…' : prefix === '!!' ? 'Adding…' : 'Generating…'}</span>
                                        : it.hint && <span className="text-xs text-gray-500 flex-shrink-0">{it.hint}</span>
                                    }
                                </button>
                            ))}
                            {/* Inline result for ! prefix */}
                            {prefix === '!' && subError && (
                                <div className="text-xs text-red-400 px-4 py-2 font-mono whitespace-pre-wrap border-t border-gray-800">{subError}</div>
                            )}
                            {prefix === '!' && subResult && (
                                <QuickQueryResult columns={subResult.columns} rows={subResult.rows} />
                            )}

                            {/* Grouped results (default mode + `:` mode) */}
                            {useGroups && groups.map(g => (
                                <div key={g.kind}>
                                    <div className="px-4 py-1 text-[10px] uppercase tracking-wider text-gray-600 bg-gray-900/80 sticky top-0">{g.label}</div>
                                    {items.slice(g.start, g.end).map((it, localIdx) => {
                                        const globalIdx = g.start + localIdx;
                                        return (
                                            <button key={it.id} data-idx={globalIdx} onClick={() => handleSelect(globalIdx)} onMouseEnter={() => setSelectedIdx(globalIdx)}
                                                className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left ${globalIdx === selectedIdx ? 'bg-gray-800' : ''}`}>
                                                <span className="flex items-center gap-2 min-w-0">
                                                    <span className={`font-mono ${KIND_COLOR[it.kind]} flex-shrink-0`}>{KIND_ICON[it.kind]}</span>
                                                    <span className="text-sm text-gray-200 truncate">{it.label}</span>
                                                    {it.hint && <span className="text-xs text-gray-500 truncate flex-shrink-0">{it.hint}</span>}
                                                </span>
                                                {globalIdx === selectedIdx && (
                                                    <span className="text-[10px] text-gray-600 flex-shrink-0">{getActionHint(it)}</span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            ))}
                        </>
                    )}

                    {/* Ask AI mode */}
                    {!showSubMode && mode === 'ask' && (
                        <div className="p-4 space-y-3">
                            {askBusy && <div className="text-sm text-gray-400">Thinking…</div>}
                            {askAnswer && (
                                <pre className="whitespace-pre-wrap break-words text-sm text-gray-200 bg-gray-950 rounded p-3 border border-gray-800">{askAnswer}</pre>
                            )}
                            {!askBusy && !askAnswer && (
                                <div className="text-xs text-gray-500">Press Enter to send your question to the AI assistant. Your current schema and notebook context are included automatically.</div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default React.memo(CommandPalette);
