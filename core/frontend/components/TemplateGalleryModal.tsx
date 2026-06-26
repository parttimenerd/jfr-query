import React, { useEffect, useMemo, useState } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import ReactMarkdown from 'react-markdown';
import { listTemplates, loadTemplate, type TemplateMeta } from '../services/TemplateService';
import { mergeTemplate, type InsertMode } from '../utils/templateMerge';

interface TemplateGalleryModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Current notebook source — used as the merge base for append/insert. */
    currentSource: string;
    /** Called with the merged notebook source when the user confirms. */
    onInsert: (mergedSource: string, warnings: string[]) => void;
    /** Server vs WASM mode; affects which templates are available. */
    mode: 'server' | 'wasm' | null;
}

const TemplateGalleryModal: React.FC<TemplateGalleryModalProps> = ({
    isOpen, onClose, currentSource, onInsert, mode,
}) => {
    const [templates, setTemplates] = useState<TemplateMeta[]>([]);
    const [selected, setSelected] = useState<TemplateMeta | null>(null);
    const [body, setBody] = useState<string>('');
    const [search, setSearch] = useState('');
    const [tagFilter, setTagFilter] = useState<string | null>(null);
    const [insertMode, setInsertMode] = useState<InsertMode>('append');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        listTemplates({ mode })
            .then(list => { if (!cancelled) setTemplates(list); })
            .catch(e => { if (!cancelled) setError(String(e)); });
        return () => { cancelled = true; };
    }, [isOpen, mode]);

    useEffect(() => {
        if (!selected) { setBody(''); return; }
        let cancelled = false;
        loadTemplate(selected.name, { mode })
            .then(b => { if (!cancelled) setBody(b); })
            .catch(e => { if (!cancelled) setError(String(e)); });
        return () => { cancelled = true; };
    }, [selected, mode]);

    const allTags = useMemo(() => {
        const set = new Set<string>();
        for (const t of templates) for (const tag of t.tags ?? []) set.add(tag);
        return Array.from(set).sort();
    }, [templates]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return templates.filter(t => {
            if (tagFilter && !(t.tags ?? []).includes(tagFilter)) return false;
            if (!q) return true;
            return (
                t.name.toLowerCase().includes(q) ||
                t.title.toLowerCase().includes(q) ||
                (t.description ?? '').toLowerCase().includes(q)
            );
        });
    }, [templates, search, tagFilter]);

    const builtins = filtered.filter(t => t.source === 'builtin');
    const userTemplates = filtered.filter(t => t.source === 'user');

    if (!isOpen) return null;

    const handleInsert = () => {
        if (!selected || !body) return;
        try {
            const { notebookSource, warnings } = mergeTemplate(currentSource, body, insertMode);
            onInsert(notebookSource, warnings);
            onClose();
        } catch (e) {
            setError(`Merge failed: ${String(e)}`);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
             onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-6xl flex flex-col animate-fade-in max-h-[90vh]">
                <header className="flex-shrink-0 p-4 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="text-xl font-semibold text-gray-200">New from template</h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-full" aria-label="Close">
                        <XMarkIcon className="w-6 h-6" />
                    </button>
                </header>

                <div className="flex-grow flex overflow-hidden">
                    {/* Left pane: list */}
                    <div className="w-1/3 border-r border-gray-700 flex flex-col">
                        <div className="p-3 border-b border-gray-700 space-y-2">
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search templates…"
                                className="w-full bg-gray-900 border border-gray-700 text-gray-200 px-3 py-1.5 rounded text-sm"
                            />
                            {allTags.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                    <button
                                        onClick={() => setTagFilter(null)}
                                        className={`text-xs px-2 py-0.5 rounded ${tagFilter === null ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
                                        all
                                    </button>
                                    {allTags.map(t => (
                                        <button key={t}
                                            onClick={() => setTagFilter(t)}
                                            className={`text-xs px-2 py-0.5 rounded ${tagFilter === t ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="overflow-y-auto flex-grow">
                            {builtins.length > 0 && (
                                <>
                                    <div className="px-3 py-1.5 text-xs uppercase tracking-wide text-gray-500 bg-gray-900/50">Built-in</div>
                                    {builtins.map(t => (
                                        <TemplateRow key={t.name} template={t} selected={selected?.name === t.name} onClick={() => setSelected(t)} />
                                    ))}
                                </>
                            )}
                            {userTemplates.length > 0 && (
                                <>
                                    <div className="px-3 py-1.5 text-xs uppercase tracking-wide text-gray-500 bg-gray-900/50">User</div>
                                    {userTemplates.map(t => (
                                        <TemplateRow key={t.name} template={t} selected={selected?.name === t.name} onClick={() => setSelected(t)} />
                                    ))}
                                </>
                            )}
                            {mode === 'wasm' && userTemplates.length === 0 && (
                                <div className="px-3 py-2 text-xs text-gray-500 italic">User templates require server mode.</div>
                            )}
                        </div>
                    </div>

                    {/* Right pane: preview */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {selected ? (
                            <>
                                <div className="p-4 border-b border-gray-700">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h3 className="text-lg font-semibold text-gray-200">{selected.title}</h3>
                                        <span className={`text-xs px-2 py-0.5 rounded ${selected.source === 'builtin' ? 'bg-blue-900/50 text-blue-200' : 'bg-purple-900/50 text-purple-200'}`}>
                                            {selected.source}
                                        </span>
                                        {selected.license && <span className="text-xs text-gray-500">{selected.license}</span>}
                                    </div>
                                    {selected.description && <p className="text-sm text-gray-400">{selected.description}</p>}
                                </div>
                                <div className="flex-grow overflow-y-auto p-4 prose prose-sm prose-invert max-w-none">
                                    {/* Preview does NOT execute SQL — render the body as plain markdown. */}
                                    <ReactMarkdown>{stripFrontMatter(body)}</ReactMarkdown>
                                </div>
                            </>
                        ) : (
                            <div className="flex-grow flex items-center justify-center text-gray-500">Select a template to preview.</div>
                        )}
                    </div>
                </div>

                {error && <div className="px-4 py-2 bg-red-900/40 text-red-300 text-sm">{error}</div>}

                <footer className="flex-shrink-0 p-4 border-t border-gray-700 flex items-center justify-between gap-4">
                    <fieldset className="flex items-center gap-3 text-sm text-gray-300">
                        <label className="flex items-center gap-1.5">
                            <input type="radio" name="insertMode" checked={insertMode === 'replace'} onChange={() => setInsertMode('replace')} />
                            Replace
                        </label>
                        <label className="flex items-center gap-1.5">
                            <input type="radio" name="insertMode" checked={insertMode === 'append'} onChange={() => setInsertMode('append')} />
                            Append
                        </label>
                        <label className="flex items-center gap-1.5">
                            <input type="radio" name="insertMode" checked={insertMode === 'insert'} onChange={() => setInsertMode('insert')} />
                            Insert at top
                        </label>
                    </fieldset>
                    <div className="flex items-center gap-2">
                        <button onClick={onClose} className="px-4 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-200">Cancel</button>
                        <button onClick={handleInsert}
                            disabled={!selected || !body}
                            className="px-4 py-1.5 rounded text-sm bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 text-white">
                            Use template
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};

const TemplateRow: React.FC<{ template: TemplateMeta; selected: boolean; onClick: () => void }> = ({ template, selected, onClick }) => (
    <button onClick={onClick}
        className={`w-full text-left px-3 py-2 hover:bg-gray-700/60 border-l-2 ${selected ? 'bg-gray-700/60 border-cyan-500' : 'border-transparent'}`}>
        <div className="text-sm font-medium text-gray-200">{template.title}</div>
        {template.description && <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{template.description}</div>}
        {template.tags && template.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
                {template.tags.slice(0, 3).map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-900/60 text-gray-400">{t}</span>)}
            </div>
        )}
    </button>
);

function stripFrontMatter(body: string): string {
    return body.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
}

export default TemplateGalleryModal;
