// Markdown renderer for chat output. Uses react-markdown + remark-gfm so we
// get GitHub-Flavored Markdown features (tables, strikethrough, task lists,
// autolinks) for free — but we override the renderers to keep the dark theme
// and to recognise our chat-specific reference tokens ([[alias]], @cell-name,
// #plot-N, #cell-N) so the user can click to navigate.

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMarkdownViewProps {
    text: string;
    onNavigateRef?: (ref: string) => void;
    /** Extra class on the wrapper. Defaults to `text-sm leading-relaxed`. */
    className?: string;
}

export const ChatMarkdownView: React.FC<ChatMarkdownViewProps> = ({ text, onNavigateRef, className }) => {
    return (
        <div className={className ?? 'text-sm leading-relaxed'}>
            {renderMarkdown(text, onNavigateRef)}
        </div>
    );
};

const REF_RE = /(\[\[[^\]]+\]\]|@[\w-]+|#(?:plot|cell)-\d+)/g;

function renderRefTokens(text: string, onRef?: (ref: string) => void): React.ReactNode[] {
    if (!onRef) {
        // Still split so [[alias]] etc render distinctly even without nav.
    }
    const parts = text.split(REF_RE);
    return parts.map((p, i) => {
        if ((p.startsWith('[[') && p.endsWith(']]')) || p.startsWith('@') || /^#(plot|cell)-\d+/.test(p)) {
            const label = p.startsWith('[[') ? p.slice(2, -2) : p.slice(1);
            return (
                <button
                    key={i}
                    onClick={() => onRef?.(label)}
                    className="inline-flex items-center gap-0.5 px-1 py-0 rounded text-xs font-mono text-cyan-400 bg-cyan-900/30 border border-cyan-700/40 hover:bg-cyan-800/50 hover:text-cyan-200 transition-colors cursor-pointer"
                    title={`Navigate to ${label}`}
                >
                    {p}
                </button>
            );
        }
        return <React.Fragment key={i}>{p}</React.Fragment>;
    });
}

/** Walk react-markdown children and apply ref-token highlighting to plain strings. */
function withRefs(children: React.ReactNode, onRef?: (ref: string) => void): React.ReactNode {
    if (typeof children === 'string') {
        return renderRefTokens(children, onRef);
    }
    if (Array.isArray(children)) {
        return children.map((c, i) => (
            <React.Fragment key={i}>{withRefs(c, onRef)}</React.Fragment>
        ));
    }
    return children;
}

export function renderMarkdown(text: string, onRef?: (ref: string) => void): React.ReactNode {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
                h1: ({ children }) => <p className="font-bold text-gray-100 text-sm mt-2 mb-1">{withRefs(children, onRef)}</p>,
                h2: ({ children }) => <p className="font-semibold text-gray-100 text-sm mt-2 mb-0.5">{withRefs(children, onRef)}</p>,
                h3: ({ children }) => <p className="font-semibold text-gray-100 text-xs mt-2 mb-0.5">{withRefs(children, onRef)}</p>,
                p: ({ children }) => <p className="my-1">{withRefs(children, onRef)}</p>,
                ul: ({ children }) => <ul className="list-disc list-inside my-1 space-y-0.5">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside my-1 space-y-0.5">{children}</ol>,
                li: ({ children }) => <li className="text-gray-200">{withRefs(children, onRef)}</li>,
                strong: ({ children }) => <strong className="font-semibold text-white">{withRefs(children, onRef)}</strong>,
                em: ({ children }) => <em className="italic">{withRefs(children, onRef)}</em>,
                code: ({ className, children, ...props }: any) => {
                    const inline = !className;
                    if (inline) {
                        return <code className="px-1 py-0.5 bg-gray-800 rounded text-xs font-mono text-cyan-300">{children}</code>;
                    }
                    return <code className={className} {...props}>{children}</code>;
                },
                pre: ({ children }) => (
                    <pre className="my-1 p-2 bg-gray-900 rounded text-xs text-cyan-300 overflow-x-auto font-mono whitespace-pre">{children}</pre>
                ),
                a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noreferrer" className="text-cyan-400 underline hover:text-cyan-300">{withRefs(children, onRef)}</a>
                ),
                table: ({ children }) => (
                    <div className="my-2 overflow-x-auto">
                        <table className="border-collapse text-xs">{children}</table>
                    </div>
                ),
                thead: ({ children }) => <thead className="bg-gray-800/50">{children}</thead>,
                th: ({ children, style }) => (
                    <th style={style} className="border border-gray-700 px-2 py-1 text-left font-semibold text-gray-100">{withRefs(children, onRef)}</th>
                ),
                td: ({ children, style }) => (
                    <td style={style} className="border border-gray-700 px-2 py-1 text-gray-200 align-top">{withRefs(children, onRef)}</td>
                ),
                blockquote: ({ children }) => (
                    <blockquote className="my-1 pl-3 border-l-2 border-gray-600 text-gray-300">{children}</blockquote>
                ),
                hr: () => <hr className="my-2 border-gray-700" />,
                del: ({ children }) => <del className="text-gray-500">{withRefs(children, onRef)}</del>,
            }}
        >
            {text}
        </ReactMarkdown>
    );
}
