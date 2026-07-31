import React, { useEffect, useState, useContext } from 'react';
import { DataContext } from '../../context/DuckDBContext';

export type CellFenceType = 'chart' | 'table' | 'flamegraph' | 'sql';

export interface ParsedCellFence {
    type: CellFenceType;
    sql: string;
    plotConfig?: string;
}

export type FencePart =
    | { kind: 'text'; content: string }
    | { kind: 'cell'; content: string };

/** Parse the inner content of a :::cell fence (everything between ::: markers). */
export function parseCellFence(inner: string): ParsedCellFence | null {
    const lines = inner.split('\n');
    const VALID_TYPES = new Set(['chart', 'table', 'flamegraph', 'sql']);
    let type: CellFenceType | null = null;
    let sql: string | null = null;
    let plotConfig: string | undefined;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('type=')) {
            const raw = trimmed.slice('type='.length).trim();
            if (VALID_TYPES.has(raw)) type = raw as CellFenceType;
        } else if (trimmed.startsWith('sql:')) {
            sql = trimmed.slice('sql:'.length).trim(); // sql must be on a single line in the fence
        } else if (trimmed.startsWith('plot:')) {
            plotConfig = trimmed.slice('plot:'.length).trim();
        }
    }

    if (!type || !sql) return null;
    return { type, sql, plotConfig };
}

/** Split a markdown string into alternating text and cell-fence parts. */
export function splitCellFences(text: string): FencePart[] {
    const FENCE_RE = /:::cell[ \t]+([\s\S]*?):::/g;
    const parts: FencePart[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = FENCE_RE.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ kind: 'text', content: text.slice(lastIndex, match.index) });
        }
        parts.push({ kind: 'cell', content: match[1].trim() });
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        parts.push({ kind: 'text', content: text.slice(lastIndex) });
    }

    return parts;
}

// ChatEmbeddedCell component — added in Task 2
export {};
