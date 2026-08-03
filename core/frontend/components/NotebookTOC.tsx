import React from 'react';
import type { NotebookCellData } from '../types';
import { scrollToCell } from './chat/scrollToCell';

interface Props {
    cells: NotebookCellData[];
    onClose: () => void;
}

function extractTitle(cell: NotebookCellData): string {
    if (cell.title && cell.title.trim()) return cell.title.trim();
    // Fall back to extracting the first ## heading from raw content
    const m = cell.content?.match(/^\s*#{1,3}\s+(.+)/m);
    return m ? m[1].trim() : '';
}

export const NotebookTOC: React.FC<Props> = ({ cells, onClose }) => {
    const entries = cells
        .map(c => ({ cell: c, title: extractTitle(c) }))
        .filter(e => e.title !== '');

    return (
        <div className="flex flex-col bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-64 max-h-[70vh] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 shrink-0">
                <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Contents</span>
                <button
                    aria-label="Close table of contents"
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-200 text-lg leading-none">×</button>
            </div>
            <div className="overflow-y-auto flex-1 py-1">
                {entries.length === 0 && (
                    <p className="text-xs text-gray-500 px-3 py-2 italic">No headings found.</p>
                )}
                {entries.map(({ cell, title }) => (
                    <button
                        key={cell.id}
                        onClick={() => scrollToCell(cell.id)}
                        className="w-full text-left px-3 py-1 text-xs hover:bg-gray-800 text-gray-300 hover:text-cyan-300 transition-colors truncate"
                        title={title}>
                        {title}
                    </button>
                ))}
            </div>
        </div>
    );
};
