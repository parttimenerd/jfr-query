import React from 'react';
import type { TableSchema, ViewSchema, MacroSchema } from '../types';
import { TableIcon } from './icons/TableIcon';
import { ViewIcon } from './icons/ViewIcon';
import { CodeBracketIcon } from './icons/CodeBracketIcon';
import { ClipboardIcon } from './icons/ClipboardIcon';

const SimpleSyntaxHighlighter: React.FC<{ code: string }> = ({ code }) => {
    const keywords = new Set([
        'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'LIMIT', 'AS', 'CASE',
        'WHEN', 'END', 'JOIN', 'ON', 'AND', 'OR', 'IN', 'NOT', 'NULL', 'TRUE', 'FALSE',
        'CREATE', 'REPLACE', 'MACRO', 'VIEW', 'DROP', 'TABLE', 'INSERT', 'INTO', 'VALUES',
        'AS', '->'
    ]);
    const parts = code.split(/(\s+|[(),])/g).filter(Boolean);
    return (
        <pre className="p-2 text-xs overflow-x-auto font-mono whitespace-pre-wrap">
            <code>
                {parts.map((part, i) => {
                    if (keywords.has(part.toUpperCase())) {
                        return <span key={i} className="text-purple-400">{part}</span>;
                    }
                    if (!isNaN(parseFloat(part)) && isFinite(part as any)) {
                        return <span key={i} className="text-yellow-400">{part}</span>;
                    }
                    return <span key={i} className="text-cyan-400">{part}</span>;
                })}
            </code>
        </pre>
    );
};

export const SchemaTooltipContent: React.FC<{ item: TableSchema | ViewSchema | MacroSchema, type: 'table' | 'view' | 'macro' }> = ({ item, type }) => {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = (e: React.MouseEvent, text: string) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    
    const headerContent = React.useMemo(() => {
        if (type === 'macro') {
            const macro = item as MacroSchema;
            return `${macro.name}(${macro.parameters.join(', ')})`;
        }
        return item.name;
    }, [item, type]);

    const icon = {
        table: <TableIcon className="w-4 h-4" />,
        view: <ViewIcon className="w-4 h-4" />,
        macro: <CodeBracketIcon className="w-4 h-4" />,
    }[type];

    return (
        <div className="space-y-2">
            <p className="font-semibold text-cyan-300 flex items-center gap-1.5">{icon}{headerContent}</p>

            {(item as any).comment && (
                 <div className="pt-1">
                    <p className="text-xs text-gray-300 italic">{(item as any).comment}</p>
                </div>
            )}
            
            {type === 'table' && (item as TableSchema).columns && (
                 <ul className="text-xs text-gray-400 mt-1 pl-2 border-l border-gray-500 ml-2">
                    {(item as TableSchema).columns.map(col => <li key={col.name} className="mt-0.5">{col.name}: <span className="text-yellow-400">{col.type}</span></li>)}
                </ul>
            )}

            {(type === 'view' || type === 'macro') && (() => {
                const definition = type === 'view' ? (item as ViewSchema).query : (item as MacroSchema).sql;
                if (!definition) return null;

                return (
                 <div className="relative pt-2">
                     <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Definition</h4>
                     <div className="relative bg-gray-900/70 rounded-md border border-gray-600">
                        <SimpleSyntaxHighlighter code={definition} />
                        <button
                            onClick={(e) => handleCopy(e, definition)}
                            className="absolute top-1 right-1 p-1.5 bg-gray-800 hover:bg-gray-600 rounded-md"
                            title="Copy definition"
                        >
                            <ClipboardIcon className={`w-4 h-4 transition-colors ${copied ? 'text-green-400' : 'text-gray-300'}`} />
                        </button>
                     </div>
                </div>
                );
            })()}
        </div>
    );
};
