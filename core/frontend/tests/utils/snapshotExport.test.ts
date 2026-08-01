import { describe, it, expect } from 'vitest';
import { buildResultSnapshots, SNAPSHOT_ROW_LIMIT } from '../../utils/snapshotExport';
import type { NotebookCellData } from '../../types';

// Minimal cell data factory
function cell(id: string, content: string): NotebookCellData {
    return { id, content, title: '' };
}

// ─── basic snapshot building ───────────────────────────────────────────────────

describe('buildResultSnapshots — basic', () => {
    it('returns empty object for no cells', async () => {
        const result = await buildResultSnapshots([], async () => []);
        expect(result).toEqual({});
    });

    it('returns empty object for cells with no SQL blocks', async () => {
        const c = cell('cell-0', '# Just markdown\nNo SQL here.');
        const result = await buildResultSnapshots([c], async () => []);
        expect(result).toEqual({});
    });

    it('runs a single SQL block and stores rows', async () => {
        const c = cell('cell-0', '```sql\nSELECT 1\n```\n');
        const result = await buildResultSnapshots(
            [c],
            async () => [{ v: 1 }],
        );
        expect(result).toEqual({ 'cell-0:0': [{ v: 1 }] });
    });

    it('uses key format "cellId:blockIndex"', async () => {
        const c = cell('cell-5', '```sql\nSELECT 1\n```\n');
        const result = await buildResultSnapshots([c], async () => []);
        expect('cell-5:0' in result).toBe(true);
    });

    it('handles multiple SQL blocks in one cell', async () => {
        const c = cell('cell-0', '```sql\nSELECT 1\n```\n\n```sql\nSELECT 2\n```\n');
        let callN = 0;
        const result = await buildResultSnapshots(
            [c],
            async () => [{ n: ++callN }],
        );
        expect('cell-0:0' in result).toBe(true);
        expect('cell-0:1' in result).toBe(true);
    });

    it('handles multiple cells', async () => {
        const cells = [
            cell('cell-0', '```sql\nSELECT 1\n```\n'),
            cell('cell-1', '```sql\nSELECT 2\n```\n'),
        ];
        const result = await buildResultSnapshots(cells, async () => [{ r: 1 }]);
        expect('cell-0:0' in result).toBe(true);
        expect('cell-1:0' in result).toBe(true);
    });
});

// ─── error handling ───────────────────────────────────────────────────────────

describe('buildResultSnapshots — error handling', () => {
    it('stores null for a SQL block that throws', async () => {
        const c = cell('cell-0', '```sql\nBAD SQL\n```\n');
        const result = await buildResultSnapshots(
            [c],
            async () => { throw new Error('parse error'); },
        );
        expect(result['cell-0:0']).toBeNull();
    });

    it('continues processing other cells after an error', async () => {
        const cells = [
            cell('cell-0', '```sql\nBAD\n```\n'),
            cell('cell-1', '```sql\nSELECT 1\n```\n'),
        ];
        let call = 0;
        const result = await buildResultSnapshots(cells, async () => {
            call++;
            if (call === 1) throw new Error('first fails');
            return [{ ok: true }];
        });
        expect(result['cell-0:0']).toBeNull();
        expect(result['cell-1:0']).toEqual([{ ok: true }]);
    });
});

// ─── row limit ─────────────────────────────────────────────────────────────────

describe('buildResultSnapshots — row limit', () => {
    it('caps rows at SNAPSHOT_ROW_LIMIT', async () => {
        const c = cell('cell-0', '```sql\nSELECT 1\n```\n');
        const manyRows = Array.from({ length: SNAPSHOT_ROW_LIMIT + 50 }, (_, i) => ({ i }));
        const result = await buildResultSnapshots([c], async () => manyRows);
        expect(result['cell-0:0']).toHaveLength(SNAPSHOT_ROW_LIMIT);
    });

    it('does not truncate rows below the limit', async () => {
        const c = cell('cell-0', '```sql\nSELECT 1\n```\n');
        const rows = [{ a: 1 }, { a: 2 }];
        const result = await buildResultSnapshots([c], async () => rows);
        expect(result['cell-0:0']).toHaveLength(2);
    });
});

// ─── progress reporting ────────────────────────────────────────────────────────

describe('buildResultSnapshots — progress', () => {
    it('calls onProgress for each SQL block', async () => {
        const cells = [
            cell('cell-0', '```sql\nSELECT 1\n```\n'),
            cell('cell-1', '```sql\nSELECT 2\n```\n'),
        ];
        const progress: Array<{ done: number; total: number }> = [];
        await buildResultSnapshots(cells, async () => [], {}, (p) => progress.push(p));
        expect(progress).toHaveLength(2);
        expect(progress[0]).toEqual({ done: 1, total: 2 });
        expect(progress[1]).toEqual({ done: 2, total: 2 });
    });

    it('does not throw when onProgress is not provided', async () => {
        const c = cell('cell-0', '```sql\nSELECT 1\n```\n');
        await expect(buildResultSnapshots([c], async () => [])).resolves.toBeDefined();
    });
});

// ─── variable substitution ────────────────────────────────────────────────────

describe('buildResultSnapshots — variable substitution', () => {
    it('passes substituted SQL to the query function', async () => {
        const c = cell('cell-0', '```sql\nSELECT * FROM t WHERE x > $limit\n```\n');
        const received: string[] = [];
        await buildResultSnapshots(
            [c],
            async (sql) => { received.push(sql); return []; },
            { $limit: '10' },
        );
        // The substituted SQL should have $limit replaced
        expect(received[0]).toContain('10');
        expect(received[0]).not.toContain('$limit');
    });
});
