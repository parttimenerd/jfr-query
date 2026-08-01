import { describe, it, expect, vi } from 'vitest';
import { buildResultSnapshots, SNAPSHOT_ROW_LIMIT } from '../utils/snapshotExport';
import type { NotebookCellData } from '../types';

// Minimal cell factory — only id and content are used by buildResultSnapshots.
function cell(id: string, content: string): NotebookCellData {
    return { id, content } as NotebookCellData;
}

describe('buildResultSnapshots', () => {
    it('returns empty map for cells with no SQL blocks', async () => {
        const query = vi.fn().mockResolvedValue([]);
        const result = await buildResultSnapshots(
            [cell('cell-0', '# Just markdown\n\nNo queries here.')],
            query,
        );
        expect(result).toEqual({});
        expect(query).not.toHaveBeenCalled();
    });

    it('runs each SQL block and stores rows under cellId:blockIndex key', async () => {
        const rows1 = [{ id: 1 }, { id: 2 }];
        const rows2 = [{ id: 3 }];
        const query = vi.fn()
            .mockResolvedValueOnce(rows1)
            .mockResolvedValueOnce(rows2);

        const result = await buildResultSnapshots(
            [cell('cell-0', '```sql\nSELECT 1\n```\n\n```sql\nSELECT 2\n```')],
            query,
        );
        expect(result['cell-0:0']).toEqual(rows1);
        expect(result['cell-0:1']).toEqual(rows2);
        expect(query).toHaveBeenCalledTimes(2);
    });

    it('stores null for a SQL block that throws', async () => {
        const query = vi.fn().mockRejectedValue(new Error('DB error'));
        const result = await buildResultSnapshots(
            [cell('cell-0', '```sql\nSELECT boom\n```')],
            query,
        );
        expect(result['cell-0:0']).toBeNull();
    });

    it('continues after a failed block and succeeds on the next', async () => {
        const query = vi.fn()
            .mockRejectedValueOnce(new Error('oops'))
            .mockResolvedValueOnce([{ x: 1 }]);

        const result = await buildResultSnapshots(
            [cell('cell-0', '```sql\nSELECT bad\n```\n\n```sql\nSELECT good\n```')],
            query,
        );
        expect(result['cell-0:0']).toBeNull();
        expect(result['cell-0:1']).toEqual([{ x: 1 }]);
    });

    it('caps rows at SNAPSHOT_ROW_LIMIT', async () => {
        const manyRows = Array.from({ length: SNAPSHOT_ROW_LIMIT + 10 }, (_, i) => ({ i }));
        const query = vi.fn().mockResolvedValue(manyRows);

        const result = await buildResultSnapshots(
            [cell('cell-0', '```sql\nSELECT * FROM t\n```')],
            query,
        );
        expect(result['cell-0:0']).toHaveLength(SNAPSHOT_ROW_LIMIT);
    });

    it('handles multiple cells with independent block indices', async () => {
        const query = vi.fn()
            .mockResolvedValueOnce([{ a: 1 }])
            .mockResolvedValueOnce([{ b: 2 }]);

        const result = await buildResultSnapshots(
            [
                cell('cell-0', '```sql\nSELECT a\n```'),
                cell('cell-1', '```sql\nSELECT b\n```'),
            ],
            query,
        );
        expect(result['cell-0:0']).toEqual([{ a: 1 }]);
        expect(result['cell-1:0']).toEqual([{ b: 2 }]);
    });

    it('calls onProgress with incrementing done count and correct total', async () => {
        const query = vi.fn().mockResolvedValue([]);
        const progress: { done: number; total: number }[] = [];

        await buildResultSnapshots(
            [cell('cell-0', '```sql\nSELECT 1\n```\n\n```sql\nSELECT 2\n```')],
            query,
            {},
            (p) => progress.push({ ...p }),
        );

        expect(progress).toEqual([
            { done: 1, total: 2 },
            { done: 2, total: 2 },
        ]);
    });

    it('substitutes notebook-level variables into SQL', async () => {
        const query = vi.fn().mockResolvedValue([]);
        await buildResultSnapshots(
            [cell('cell-0', '```sql\nSELECT * FROM t WHERE id = $myVar\n```')],
            query,
            { myVar: '42' },
        );
        const calledSql: string = query.mock.calls[0][0];
        expect(calledSql).toContain('42');
        expect(calledSql).not.toContain('$myVar');
    });

    it('returns empty map when cells array is empty', async () => {
        const query = vi.fn();
        const result = await buildResultSnapshots([], query);
        expect(result).toEqual({});
        expect(query).not.toHaveBeenCalled();
    });

    it('cell-level variables override notebook-level variables in the SQL', async () => {
        // Cell has its own `myVar = cell-value` in a Variables block, which should
        // take precedence over the `myVar = notebook-value` passed as the third arg.
        const content = '```sql\nSELECT $myVar\n```\n\n```variables\nmyVar=cell-value\n```';
        const query = vi.fn().mockResolvedValue([]);
        await buildResultSnapshots(
            [cell('cell-0', content)],
            query,
            { myVar: 'notebook-value' },
        );
        expect(query).toHaveBeenCalledOnce();
        const calledSql: string = query.mock.calls[0][0];
        expect(calledSql).toContain('cell-value');
        expect(calledSql).not.toContain('notebook-value');
    });
});
