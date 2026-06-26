import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DataContext } from '../context/DuckDBContext';
import { SettingsContext } from '../context/SettingsContext';
import { aiService } from '../services/AiService';

export interface CommandAction {
    id: string;
    label: string;
    hint?: string;
    keywords?: string;
    run: () => void | Promise<void>;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    actions: CommandAction[];
}

// Fuzzy match: every char of `needle` (lowercase) appears in `hay` in order.
function fuzzyMatch(needle: string, hay: string): boolean {
    if (!needle) return true;
    const n = needle.toLowerCase();
    const h = hay.toLowerCase();
    let j = 0;
    for (let i = 0; i < h.length && j < n.length; i++) {
        if (h[i] === n[j]) j++;
    }
    return j === n.length;
}

const CommandPalette: React.FC<Props> = ({ isOpen, onClose, actions }) => {
    const { schema } = useContext(DataContext);
    const { isAiAvailable, isAiEnabled } = useContext(SettingsContext) as any;
    const [query, setQuery] = useState('');
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [mode, setMode] = useState<'actions' | 'ask'>('actions');
    const [askBusy, setAskBusy] = useState(false);
    const [askAnswer, setAskAnswer] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIdx(0);
            setMode('actions');
            setAskAnswer(null);
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [isOpen]);

    const items = useMemo(() => {
        const q = query.trim();
        // Actions
        const actionItems = actions
            .filter(a => fuzzyMatch(q, `${a.label} ${a.keywords ?? ''}`))
            .map(a => ({ kind: 'action' as const, id: a.id, label: a.label, hint: a.hint, action: a }));
        // Table search results when query is meaningful
        const tableItems = (schema?.tables ?? [])
            .filter(t => fuzzyMatch(q, t.name) || t.columns.some(c => fuzzyMatch(q, c.name)))
            .slice(0, 8)
            .map(t => ({
                kind: 'table' as const,
                id: `tbl-${t.name}`,
                label: t.name,
                hint: `${t.columns.length} cols${t.rowCount !== undefined ? ` · ${t.rowCount} rows` : ''}`,
                table: t,
            }));
        return [...actionItems, ...tableItems];
    }, [actions, schema, query]);

    useEffect(() => { setSelectedIdx(0); }, [query, mode]);

    const aiOn = isAiAvailable && isAiEnabled;

    const handleSelect = async (idx: number) => {
        const item = items[idx];
        if (!item) return;
        if (item.kind === 'action') {
            onClose();
            await item.action.run();
        } else if (item.kind === 'table') {
            // Copy table name to clipboard as a useful default.
            try {
                await navigator.clipboard.writeText(item.label);
            } catch { /* ignore */ }
            onClose();
        }
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

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40"
            onClick={onClose}
        >
            <div
                className="w-full max-w-xl bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
                    <button
                        className={`text-xs px-2 py-0.5 rounded ${mode === 'actions' ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400'}`}
                        onClick={() => setMode('actions')}
                    >
                        Actions
                    </button>
                    <button
                        className={`text-xs px-2 py-0.5 rounded ${mode === 'ask' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400'} ${aiOn ? '' : 'opacity-40 cursor-not-allowed'}`}
                        onClick={() => aiOn && setMode('ask')}
                        title={aiOn ? 'Ask the AI assistant' : 'AI is not configured'}
                    >
                        Ask AI
                    </button>
                    <div className="text-[10px] text-gray-600 ml-auto">Esc to close · ↑↓ to navigate · Enter to run</div>
                </div>
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
                    placeholder={mode === 'ask' ? 'Ask anything about your data…' : 'Type a command, table, or column…'}
                    className="w-full bg-transparent text-gray-100 px-4 py-3 outline-none border-b border-gray-800"
                />
                <div className="max-h-96 overflow-y-auto">
                    {mode === 'actions' && items.length === 0 && (
                        <div className="px-4 py-6 text-center text-sm text-gray-500">No matches.</div>
                    )}
                    {mode === 'actions' && items.map((it, idx) => (
                        <button
                            key={it.id}
                            onClick={() => handleSelect(idx)}
                            onMouseEnter={() => setSelectedIdx(idx)}
                            className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left ${idx === selectedIdx ? 'bg-gray-800' : ''}`}
                        >
                            <span className="text-sm text-gray-200 truncate">
                                {it.kind === 'table' ? <span className="text-cyan-400 font-mono mr-1">⌗</span> : <span className="text-gray-500 mr-1">›</span>}
                                {it.label}
                            </span>
                            {it.hint && <span className="text-xs text-gray-500 truncate">{it.hint}</span>}
                        </button>
                    ))}
                    {mode === 'ask' && (
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

export default CommandPalette;
