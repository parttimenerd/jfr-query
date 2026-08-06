import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { listTemplates, loadTemplate, type TemplateMeta } from '../services/TemplateService';
import { mergeTemplate, type InsertMode } from '../utils/templateMerge';
import StaticCodeHighlighter from './StaticCodeHighlighter';
import { DataContext } from '../context/DuckDBContext';

interface TemplateGalleryModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Current notebook source — used as the merge base for append/insert. */
    currentSource: string;
    /** Called with the merged notebook source when the user confirms. */
    onInsert: (mergedSource: string, warnings: string[]) => void;
    /** Server vs WASM mode; affects which templates are available. */
    mode: 'server' | 'wasm' | null;
    /** True when a JFR/DuckDB file is already loaded and queries can run. */
    hasLoadedFile?: boolean;
    /** Called after inserting the template to trigger run-all. */
    onRunAll?: () => void;
}

type PreviewTab = 'preview' | 'live';

interface LiveResult {
    sql: string;
    rows: Record<string, unknown>[] | null;
    error: string | null;
    running: boolean;
}

/** Extract all ```sql … ``` blocks from template body (with alias comment stripped). */
function extractSqlBlocks(body: string): string[] {
    const blocks: string[] = [];
    const re = /```sql\s*\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
        // Strip alias comment line(s)
        const sql = m[1].replace(/^--\s*alias\s+\S+.*\n?/gm, '').trim();
        if (sql) blocks.push(sql);
    }
    return blocks;
}

const TemplateGalleryModal: React.FC<TemplateGalleryModalProps> = ({
    isOpen, onClose, currentSource, onInsert, mode, hasLoadedFile, onRunAll,
}) => {
    const { query } = useContext(DataContext);
    const [templates, setTemplates] = useState<TemplateMeta[]>([]);
    const [selected, setSelected] = useState<TemplateMeta | null>(null);
    const [body, setBody] = useState<string>('');
    const [search, setSearch] = useState('');
    const [tagFilter, setTagFilter] = useState<string | null>(null);
    const [insertMode, setInsertMode] = useState<InsertMode>('replace');
    const [error, setError] = useState<string | null>(null);
    const [previewTab, setPreviewTab] = useState<PreviewTab>('preview');
    const [liveResults, setLiveResults] = useState<LiveResult[]>([]);
    const liveRunRef = useRef(0);

    useEffect(() => {
        if (!isOpen) return;
        // Reset volatile state each time the modal opens so stale selections/errors don't persist.
        setSelected(null);
        setBody('');
        setSearch('');
        setTagFilter(null);
        setError(null);
        setInsertMode('replace');
        setPreviewTab('preview');
        setLiveResults([]);
        let cancelled = false;
        listTemplates({ mode })
            .then(list => { if (!cancelled) setTemplates(list); })
            .catch(e => { if (!cancelled) setError(String(e)); });
        return () => { cancelled = true; };
    }, [isOpen, mode]);

    useEffect(() => {
        if (!selected) { setBody(''); return; }
        setBody('');
        setError(null);
        setLiveResults([]);
        let cancelled = false;
        loadTemplate(selected.name, { mode })
            .then(b => { if (!cancelled) setBody(b); })
            .catch(e => { if (!cancelled) setError(String(e)); });
        return () => { cancelled = true; };
    }, [selected, mode]);

    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler, true);
        return () => document.removeEventListener('keydown', handler, true);
    }, [isOpen, onClose]);

    // Run SQL blocks when Live tab is active and body is loaded.
    useEffect(() => {
        if (previewTab !== 'live' || !body || !hasLoadedFile) return;
        const blocks = extractSqlBlocks(body);
        if (blocks.length === 0) return;
        const runId = ++liveRunRef.current;
        const initial: LiveResult[] = blocks.map(sql => ({ sql, rows: null, error: null, running: true }));
        setLiveResults(initial);
        blocks.forEach((sql, i) => {
            query(sql)
                .then(rows => {
                    if (liveRunRef.current !== runId) return;
                    setLiveResults(prev => {
                        const next = [...prev];
                        next[i] = { sql, rows, error: null, running: false };
                        return next;
                    });
                })
                .catch(err => {
                    if (liveRunRef.current !== runId) return;
                    setLiveResults(prev => {
                        const next = [...prev];
                        next[i] = { sql, rows: null, error: String(err), running: false };
                        return next;
                    });
                });
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [previewTab, body, hasLoadedFile]);

    const allTags = useMemo(() => {
        const set = new Set<string>();
        for (const t of templates) for (const tag of t.tags ?? []) set.add(tag);
        return Array.from(set).sort();
    }, [templates]);

    // Primary filter tags shown as buttons — high-level categories only.
    // Sub-tags (performance, latency, leaks, etc.) remain searchable but don't
    // clutter the bar.
    const PRIMARY_TAGS = ['gc', 'cpu', 'io', 'memory', 'threads', 'jvm', 'container', 'allocation', 'exceptions'];
    const filterTags = useMemo(() => PRIMARY_TAGS.filter(t => allTags.includes(t)), [allTags]);

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

    const handleRunWithFile = () => {
        if (!selected || !body) return;
        try {
            const { notebookSource, warnings } = mergeTemplate(currentSource, body, 'replace');
            onInsert(notebookSource, warnings);
            onClose();
            // Defer run-all until after the notebook has re-rendered with the new cells.
            setTimeout(() => onRunAll?.(), 300);
        } catch (e) {
            setError(`Merge failed: ${String(e)}`);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
             onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div role="dialog" aria-modal="true" aria-label="New from template" className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-6xl flex flex-col animate-fade-in max-h-[90vh]">
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
                                aria-label="Search templates"
                                className="w-full bg-gray-900 border border-gray-700 text-gray-200 px-3 py-1.5 rounded text-sm"
                            />
                            {allTags.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                    <button
                                        onClick={() => setTagFilter(null)}
                                        aria-pressed={tagFilter === null}
                                        className={`text-xs px-2 py-0.5 rounded ${tagFilter === null ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
                                        all
                                    </button>
                                    {filterTags.map(t => (
                                        <button key={t}
                                            onClick={() => setTagFilter(t)}
                                            aria-pressed={tagFilter === t}
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
                                    {/* Tab switcher */}
                                    <div className="flex gap-1 mt-3">
                                        <button
                                            onClick={() => setPreviewTab('preview')}
                                            className={`px-3 py-1 text-xs rounded ${previewTab === 'preview' ? 'bg-cyan-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                                            Preview
                                        </button>
                                        <button
                                            onClick={() => setPreviewTab('live')}
                                            disabled={!hasLoadedFile}
                                            title={hasLoadedFile ? 'Run SQL queries against the loaded file and show results' : 'Load a JFR file to enable live preview'}
                                            className={`px-3 py-1 text-xs rounded ${previewTab === 'live' ? 'bg-cyan-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'} disabled:opacity-40 disabled:cursor-not-allowed`}>
                                            Live Preview
                                        </button>
                                    </div>
                                </div>
                                {previewTab === 'preview' ? (
                                    <div className="flex-grow overflow-y-auto p-4 prose prose-sm prose-invert max-w-none">
                                        {/* Preview does NOT execute SQL — render the body as plain markdown. */}
                                        <ReactMarkdown
                                            remarkPlugins={[remarkMath]}
                                            rehypePlugins={[rehypeKatex]}
                                            components={previewMarkdownComponents}
                                        >{stripFrontMatter(body)}</ReactMarkdown>
                                    </div>
                                ) : (
                                    <div className="flex-grow overflow-y-auto p-4 space-y-4">
                                        {liveResults.length === 0 && !body && (
                                            <p className="text-gray-500 text-sm">Loading template…</p>
                                        )}
                                        {liveResults.length === 0 && body && (
                                            <p className="text-gray-500 text-sm">No SQL queries found in this template.</p>
                                        )}
                                        {liveResults.map((r, i) => (
                                            <LiveResultBlock key={i} result={r} index={i} />
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="flex-grow flex items-center justify-center text-gray-500">Select a template to preview.</div>
                        )}
                    </div>
                </div>

                {error && <div className="px-4 py-2 bg-red-900/40 text-red-300 text-sm">{error}</div>}

                <footer className="flex-shrink-0 p-4 border-t border-gray-700 flex items-center justify-between gap-4">
                    <fieldset className="flex items-center gap-3 text-sm text-gray-300">
                        <legend className="sr-only">Insert mode</legend>
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
                        {hasLoadedFile && onRunAll && (
                            <button onClick={handleRunWithFile}
                                disabled={!selected || !body}
                                title="Replace notebook with this template and immediately run all queries against the loaded file"
                                className="px-4 py-1.5 rounded text-sm bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 text-white">
                                Open &amp; Run
                            </button>
                        )}
                        <button onClick={handleInsert}
                            disabled={!selected || !body}
                            className="px-4 py-1.5 rounded text-sm bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 text-white">
                            Insert
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};

const TemplateRow: React.FC<{ template: TemplateMeta; selected: boolean; onClick: () => void }> = ({ template, selected, onClick }) => (
    <button onClick={onClick}
        aria-selected={selected}
        aria-label={`Select template: ${template.title}`}
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

const MAX_LIVE_ROWS = 100;

const LiveResultBlock: React.FC<{ result: LiveResult; index: number }> = ({ result, index }) => {
    if (result.running) {
        return (
            <div className="border border-gray-700 rounded p-3">
                <div className="text-xs text-gray-500 mb-1">Query {index + 1}</div>
                <div className="text-xs text-gray-400 animate-pulse">Running…</div>
            </div>
        );
    }
    if (result.error) {
        return (
            <div className="border border-red-800/40 rounded p-3">
                <div className="text-xs text-gray-500 mb-1">Query {index + 1}</div>
                <div className="text-xs font-mono text-red-400 whitespace-pre-wrap">{result.error}</div>
            </div>
        );
    }
    if (!result.rows || result.rows.length === 0) {
        return (
            <div className="border border-gray-700 rounded p-3">
                <div className="text-xs text-gray-500 mb-1">Query {index + 1}</div>
                <div className="text-xs text-gray-500 italic">No rows returned.</div>
            </div>
        );
    }
    const cols = Object.keys(result.rows[0]);
    const rows = result.rows.slice(0, MAX_LIVE_ROWS);
    const truncated = result.rows.length > MAX_LIVE_ROWS;
    return (
        <div className="border border-gray-700 rounded overflow-hidden">
            <div className="px-3 py-1.5 bg-gray-900/50 text-xs text-gray-500">
                Query {index + 1} — {result.rows.length} row{result.rows.length !== 1 ? 's' : ''}
                {truncated && <span className="ml-1 text-amber-400">(showing first {MAX_LIVE_ROWS})</span>}
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="bg-gray-900/40 border-b border-gray-700">
                            {cols.map(c => (
                                <th key={c} className="px-2 py-1.5 text-left text-gray-400 font-medium whitespace-nowrap">{c}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, ri) => (
                            <tr key={ri} className={ri % 2 === 0 ? '' : 'bg-gray-900/20'}>
                                {cols.map(c => (
                                    <td key={c} className="px-2 py-1 text-gray-300 whitespace-nowrap max-w-[200px] truncate"
                                        title={String(row[c] ?? '')}>
                                        {row[c] === null || row[c] === undefined ? <span className="text-gray-600">null</span> : String(row[c])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

function stripFrontMatter(body: string): string {
    return body
        .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
        .replace(/<!--\s*@cell\b[^>]*-->\s*\n?/g, '');
}

/**
 * ReactMarkdown component overrides for the gallery preview:
 *   - ```` ```sql ```` and ```` ```plot ```` fences render via the
 *     CodeMirror-backed StaticCodeHighlighter, matching the in-notebook look.
 *   - ```` ```{if SELECT … } ```` fences are tagged with `language-if` by the
 *     markdown parser; we surface them as a labeled conditional block so the
 *     author can see the condition without misreading it as runnable SQL.
 *   - Other fences fall through to a plain `<code>`.
 */
const previewMarkdownComponents: any = {
    code: ({ node, className, children, ...props }: any) => {
        const langMatch = /language-(\S+)/.exec(className || '');
        const lang = langMatch?.[1];
        const code = String(children ?? '').replace(/\n$/, '');
        // react-markdown v10 uses hast nodes (type: 'element') for all code blocks;
        // 'inlineCode' is an mdast type that never appears here. Distinguish inline
        // vs block by the presence of a language className (block fences have one).
        const isInline = !className;
        if (isInline) {
            return <code className="bg-gray-700 text-cyan-300 px-1 rounded" {...props}>{children}</code>;
        }
        if (lang === 'sql' || lang === 'plot') {
            return (
                <div className="my-2 border border-gray-700 rounded-md overflow-hidden bg-[#263238] not-prose">
                    <StaticCodeHighlighter code={code} language={lang}/>
                </div>
            );
        }
        if (lang && lang.startsWith('{if')) {
            // Strip the leading `{if ` and trailing `}` from the language token
            // (markdown captures the whole fence after the backticks as language).
            const condition = lang.replace(/^\{if\s*/, '').replace(/\}$/, '').trim();
            return (
                <div className="my-2 border border-cyan-800/40 rounded-md bg-cyan-900/10 p-2 not-prose">
                    <div className="text-[10px] text-cyan-400 font-mono mb-1">{`{if …}`} when:</div>
                    <div className="text-xs font-mono text-cyan-200 mb-2 whitespace-pre-wrap">{condition}</div>
                    <div className="text-xs text-gray-400 whitespace-pre-wrap">{code}</div>
                </div>
            );
        }
        return (
            <div className="my-2"><pre className="bg-gray-900/60 border border-gray-700 rounded p-2 text-xs overflow-x-auto"><code {...props}>{code}</code></pre></div>
        );
    },
};

export default React.memo(TemplateGalleryModal);
