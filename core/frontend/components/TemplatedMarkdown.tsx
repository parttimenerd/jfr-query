import React, { useContext, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { DataContext } from '../context/DuckDBContext';
import { useCellAliases } from '../context/CellAliasContext';
import { CellSegment } from '../utils/notebookParser';
import { splitInlineExprs } from '../utils/inlineExpr';
import { evaluateCondition, evaluateScalar } from '../services/templating/evaluators';
import { formatValue, FormatSettings } from '../services/templating/formatValue';
import { substituteVariables, toSqlVariables } from '../utils/variableSubstitution';
import type { NotebookCellData } from '../types';
import { scrollToCell } from './chat/scrollToCell';

/**
 * Convert `@cell:name` references in markdown text to clickable `jfr://cell/…`
 * links before the markdown renderer sees the text. The resulting links are
 * handled by the custom `a` renderer below, which resolves the name against the
 * `allCells` list and scrolls to the target cell on click.
 */
export function preprocessCellLinks(md: string): string {
    return md.replace(/@cell:([\w-]+)/g, (_, name) =>
        `[→ ${name}](#jfr-cell-${encodeURIComponent(name)})`);
}

interface Props {
    /** Segments from `tokenizeCellContent` — must include 'if' and 'markdown'. */
    segments: CellSegment[];
    /** Variables to substitute before SQL evaluation (`$var` / `$$var`). */
    variables: Record<string, string>;
    /** Notebook-level format settings (timeFormat, decimalPlaces). */
    formatSettings?: FormatSettings;
    /** All notebook cells — used to resolve `@cell:name` cross-links. */
    allCells?: NotebookCellData[];
}

/**
 * Renders templated markdown:
 *   - Plain markdown segments are split into inline-expression parts and
 *     scalar-evaluated, with the result formatted via `formatValue`.
 *   - `{if SELECT … }` blocks are evaluated; truthy → body is rendered as
 *     markdown (still with inline-expression evaluation inside); falsy →
 *     block is hidden; error → red badge.
 *
 * All SQL is evaluated against the DuckDB connection from `DataContext`. The
 * component re-renders when any alias in `useCellAliases` bumps its version,
 * so downstream refs pick up new data automatically.
 */
export const TemplatedMarkdown: React.FC<Props> = ({ segments, variables, formatSettings, allCells }) => {
    const { query } = useContext(DataContext);
    const aliases = useCellAliases();

    // Version key — any change here re-runs evaluators. Includes the SQL
    // text itself (which changes when the user edits) plus the alias
    // registry's combined version count.
    const aliasVersionSum = useMemo(
        () => Object.values(aliases).reduce((s, a) => s + a.version, 0),
        [aliases],
    );

    return (
        <div className="space-y-2">
            {segments.map((seg, i) => {
                if (seg.type === 'markdown') {
                    return (
                        <InlineProse
                            key={i}
                            text={seg.content}
                            query={query}
                            variables={variables}
                            formatSettings={formatSettings ?? {}}
                            aliasVersionSum={aliasVersionSum}
                            allCells={allCells}
                        />
                    );
                }
                if (seg.type === 'if') {
                    return (
                        <IfBlock
                            key={i}
                            condition={seg.condition}
                            body={seg.body}
                            query={query}
                            variables={variables}
                            formatSettings={formatSettings ?? {}}
                            aliasVersionSum={aliasVersionSum}
                            allCells={allCells}
                        />
                    );
                }
                return null;
            })}
        </div>
    );
};

interface InlineProseProps {
    text: string;
    query: (sql: string) => Promise<any[]>;
    variables: Record<string, string>;
    formatSettings: FormatSettings;
    aliasVersionSum: number;
    allCells?: NotebookCellData[];
}

const InlineProse: React.FC<InlineProseProps> = ({ text, query, variables, formatSettings, aliasVersionSum, allCells }) => {
    const parts = useMemo(() => splitInlineExprs(text), [text]);
    // Build the rendered markdown by replacing each `${…}` placeholder with
    // its resolved value (or a placeholder while pending / a badge on error).
    const [resolved, setResolved] = useState<Record<number, string>>({});

    useEffect(() => {
        let cancelled = false;
        const exprIndices = parts
            .map((p, i) => (p.type === 'expr' ? i : -1))
            .filter(i => i >= 0);
        if (exprIndices.length === 0) {
            setResolved({});
            return;
        }
        setResolved({});
        (async () => {
            const next: Record<number, string> = {};
            for (const i of exprIndices) {
                const p = parts[i] as { type: 'expr'; sql: string; format?: string };
                const sub = substituteVariables(p.sql, toSqlVariables(variables));
                const isQuery = /^\s*(select|with)\b/i.test(sub);
                const evalSql = isQuery ? sub : `SELECT (${sub})`;
                const r = await evaluateScalar(query, evalSql);
                if (cancelled) return;
                if (r.kind === 'ok') {
                    next[i] = formatValue(r.value, p.format, formatSettings);
                } else if (r.kind === 'empty') {
                    next[i] = '—';
                } else {
                    next[i] = `❌ ${r.message}`;
                }
            }
            if (!cancelled) setResolved(next);
        })();
        return () => { cancelled = true; };
    }, [parts, query, variables, formatSettings, aliasVersionSum]);

    const md = parts.map((p, i) => {
        if (p.type === 'text') return substituteVariables(p.value, variables);
        return resolved[i] ?? '…';
    }).join('');

    const processedMd = preprocessCellLinks(md);

    const mdComponents = useMemo(() => ({
        a: ({ href, children }: any) => {
            if (href?.startsWith('#jfr-cell-')) {
                const cellName = decodeURIComponent(href.replace('#jfr-cell-', ''));
                const target = allCells?.find((c: NotebookCellData) => c.name === cellName);
                return (
                    <button
                        onClick={() => target && scrollToCell(target.id)}
                        className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 cursor-pointer"
                        title={`Jump to: ${cellName}`}>
                        {children}
                    </button>
                );
            }
            return <a href={href as string} target="_blank" rel="noreferrer">{children}</a>;
        },
    }), [allCells]);

    return <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={mdComponents}>{processedMd}</ReactMarkdown>;
};

interface IfBlockProps {
    condition: string;
    body: string;
    query: (sql: string) => Promise<any[]>;
    variables: Record<string, string>;
    formatSettings: FormatSettings;
    aliasVersionSum: number;
    allCells?: NotebookCellData[];
}

const IfBlock: React.FC<IfBlockProps> = ({ condition, body, query, variables, formatSettings, aliasVersionSum, allCells }) => {
    const [state, setState] = useState<'pending' | 'true' | 'false' | { error: string }>('pending');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const sub = substituteVariables(condition, toSqlVariables(variables));
            const r = await evaluateCondition(query, sub);
            if (cancelled) return;
            if (r.kind === 'error') setState({ error: r.message });
            else setState(r.value ? 'true' : 'false');
        })();
        return () => { cancelled = true; };
    }, [condition, query, variables, aliasVersionSum]);

    if (state === 'pending' || state === 'false') return null;
    if (typeof state === 'object' && 'error' in state) {
        return (
            <div className="text-red-400 text-xs px-2 py-1 rounded bg-red-900/30 border border-red-800">
                conditional error: {state.error}
            </div>
        );
    }
    return (
        <InlineProse
            text={body}
            query={query}
            variables={variables}
            formatSettings={formatSettings}
            aliasVersionSum={aliasVersionSum}
            allCells={allCells}
        />
    );
};

export default React.memo(TemplatedMarkdown);
