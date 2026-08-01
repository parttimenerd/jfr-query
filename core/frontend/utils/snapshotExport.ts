import type { NotebookCellData } from '../types';
import { tokenizeCellContent, parseCellContent } from './notebookParser';
import { substituteVariables, toSqlVariables } from './variableSubstitution';
import { expandBrushOperator } from '../services/variableExpander';

export const SNAPSHOT_ROW_LIMIT = 500;

export interface ExportProgress {
    done: number;
    total: number;
}

/**
 * Re-runs every SQL block across all cells and returns a snapshot map.
 * Keys are `"${cellId}:${blockIndex}"`. Values are rows (≤500) or null on error.
 *
 * Uses the same variable substitution pipeline as the live runQuery path in App.tsx
 * so snapshot results match what the user would see running cells normally.
 */
export async function buildResultSnapshots(
    cells: NotebookCellData[],
    query: (sql: string) => Promise<any[]>,
    variables: Record<string, string> = {},
    onProgress?: (p: ExportProgress) => void,
): Promise<Record<string, any[] | null>> {
    // Collect all SQL blocks across all cells up front so total count is accurate.
    const work: Array<{ cellId: string; sql: string; blockIndex: number; allVars: Record<string, string> }> = [];

    for (const cell of cells) {
        const segments = tokenizeCellContent(cell.content);
        const parsed = parseCellContent(segments);
        // Merge notebook-level vars with cell-level vars (cell vars take precedence).
        const cellVars = { ...variables, ...(parsed.variables ?? {}) };
        parsed.sqlBlocks.forEach((sql, i) => {
            work.push({ cellId: cell.id, sql, blockIndex: i, allVars: cellVars });
        });
    }

    const total = work.length;
    const snapshots: Record<string, any[] | null> = {};

    for (let idx = 0; idx < work.length; idx++) {
        const { cellId, sql, blockIndex, allVars } = work[idx];
        const key = `${cellId}:${blockIndex}`;
        try {
            const expanded = expandBrushOperator(sql, allVars);
            const substituted = substituteVariables(expanded, toSqlVariables(allVars));
            const rows = await query(substituted);
            snapshots[key] = rows.slice(0, SNAPSHOT_ROW_LIMIT);
        } catch {
            snapshots[key] = null;
        }
        onProgress?.({ done: idx + 1, total });
    }

    return snapshots;
}
