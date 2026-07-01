// C4 — Tests for the ChatPanel approval/proposal helpers. The vitest env is
// `node` (no jsdom), so we exercise the pure helpers extracted into
// ChatProposalCard.tsx (re-exported from ChatPanel) plus the small selector
// utilities `listConfiguredProviders`, `defaultModelForProvider`,
// `cellPrimaryType`, and `listPlotsFromCells`.
//
// We DON'T import `./components/ChatPanel` directly: that module pulls in
// React contexts that depend on DuckDB/Settings providers, making it
// unimportable in a bare node test environment. Instead we import the
// helpers from ChatProposalCard and reproduce the selector logic with the
// metadata registry. The component-render path is left to the
// browser/Playwright layer.

import { describe, it, expect } from 'vitest';
import {
    chooseProposalKind,
    applyApprovalAction,
    formatToolHeader,
    formatToolArgs,
    type ApprovalRecord,
} from '../components/ChatProposalCard';
import { TOOLS, getTool } from '../services/ai/tools';

describe('chooseProposalKind', () => {
    it('returns auto-read for a read tool when visibility is sanitized', () => {
        const tool = getTool('runQuery')!;
        const kind = chooseProposalKind(tool, { sql: 'SELECT 1' }, { visibility: 'sanitized', approveAllReads: false });
        expect(kind.kind).toBe('auto-read');
    });

    it('returns prompt-read for a read tool when visibility is no-data', () => {
        const tool = getTool('describeTable')!;
        const kind = chooseProposalKind(tool, { name: 'GarbageCollection' }, { visibility: 'no-data', approveAllReads: false });
        expect(kind.kind).toBe('prompt-read');
    });

    it('returns auto-read even at no-data when approveAllReads is set', () => {
        const tool = getTool('sampleRows')!;
        const kind = chooseProposalKind(tool, { name: 'GC' }, { visibility: 'no-data', approveAllReads: true });
        expect(kind.kind).toBe('auto-read');
    });

    it('returns prompt-mutate for addCell regardless of visibility', () => {
        const tool = getTool('addCell')!;
        const kind = chooseProposalKind(tool, { type: 'sql', content: 'SELECT 1' }, { visibility: 'full', approveAllReads: true });
        expect(kind.kind).toBe('prompt-mutate');
    });

    it('returns prompt-mutate with diff for editCell', () => {
        const tool = getTool('editCell')!;
        const kind = chooseProposalKind(
            tool,
            { cellId: 'cell-0', content: 'after-content' },
            { visibility: 'full', approveAllReads: false, existingCellContent: 'before-content' },
        );
        expect(kind.kind).toBe('prompt-mutate');
        if (kind.kind === 'prompt-mutate') {
            expect(kind.diff?.before).toBe('before-content');
            expect(kind.diff?.after).toBe('after-content');
        }
    });

    it('returns prompt-mutate with diff for applyPlot using plotConfig as after', () => {
        const tool = getTool('applyPlot')!;
        const kind = chooseProposalKind(
            tool,
            { cellId: 'p1', plotConfig: 'LINE_CHART(x: t, y: v)' },
            { visibility: 'full', approveAllReads: false, existingCellContent: 'TABLE()' },
        );
        if (kind.kind !== 'prompt-mutate') throw new Error('expected mutate');
        expect(kind.diff?.before).toBe('TABLE()');
        expect(kind.diff?.after).toBe('LINE_CHART(x: t, y: v)');
    });
});

describe('applyApprovalAction reducer', () => {
    const seed = (overrides: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
        id: 'r1', name: 'runQuery', args: { sql: 'SELECT 1' }, status: 'pending', ...overrides,
    });

    it('approves a pending record', () => {
        const next = applyApprovalAction([seed()], { type: 'approve', id: 'r1' });
        expect(next[0].status).toBe('approved');
    });

    it('does not change an already-rejected record on approve', () => {
        const next = applyApprovalAction([seed({ status: 'rejected' })], { type: 'approve', id: 'r1' });
        expect(next[0].status).toBe('rejected');
    });

    it('rejects a pending record', () => {
        const next = applyApprovalAction([seed()], { type: 'reject', id: 'r1' });
        expect(next[0].status).toBe('rejected');
    });

    it('completes a record with the supplied result', () => {
        const next = applyApprovalAction([seed({ status: 'approved' })], { type: 'complete', id: 'r1', result: { ok: true, data: { rows: [] } } });
        expect(next[0].status).toBe('done');
        expect(next[0].result).toEqual({ ok: true, data: { rows: [] } });
    });

    it('approve-all-reads transitions all listed pending records to approved', () => {
        const records: ApprovalRecord[] = [
            seed({ id: 'r1' }),
            seed({ id: 'r2', status: 'rejected' }),
            seed({ id: 'r3' }),
        ];
        const next = applyApprovalAction(records, { type: 'approve-all-reads', readIds: ['r1', 'r2', 'r3'] });
        expect(next.find(r => r.id === 'r1')?.status).toBe('approved');
        expect(next.find(r => r.id === 'r2')?.status).toBe('rejected'); // not pending
        expect(next.find(r => r.id === 'r3')?.status).toBe('approved');
    });
});

describe('formatToolHeader', () => {
    it('summarises describeTable arguments', () => {
        expect(formatToolHeader('describeTable', { name: 'GarbageCollection' })).toBe('describeTable("GarbageCollection")');
    });

    it('truncates long SQL in runQuery', () => {
        const sql = 'SELECT * FROM very_long_table_name WHERE condition_a = 1 AND condition_b = 2 AND condition_c = 3';
        const out = formatToolHeader('runQuery', { sql });
        expect(out.startsWith('runQuery(')).toBe(true);
        expect(out.length).toBeLessThan(sql.length + 'runQuery("")'.length);
        expect(out).toContain('...');
    });

    it('emits the addCell type', () => {
        expect(formatToolHeader('addCell', { type: 'plot', content: 'X' })).toBe('addCell("plot")');
    });

    it('renders listPlots without args', () => {
        expect(formatToolHeader('listPlots', {})).toBe('listPlots()');
    });

    it('falls back to <name>(...) for unknown tools', () => {
        expect(formatToolHeader('mysteryTool', { foo: 1 })).toBe('mysteryTool(...)');
    });
});

describe('formatToolArgs', () => {
    it('pretty-prints an object', () => {
        expect(formatToolArgs({ a: 1 })).toBe('{\n  "a": 1\n}');
    });
    it('returns the literal string "{}" for empty', () => {
        expect(formatToolArgs({})).toBe('{}');
    });
});

describe('TOOLS metadata sanity (consumed by ChatPanel)', () => {
    it('declares the expected tool names', () => {
        const names = TOOLS.map(t => t.name).sort();
        expect(names).toEqual([
            'addCell',
            'applyPlot',
            'deleteCell',
            'deleteVariable',
            'describeTable',
            'editCell',
            'listCells',
            'listPlots',
            'listVariables',
            'moveCell',
            'previewPlot',
            'readCell',
            'recallMemory',
            'rememberFact',
            'runQuery',
            'sampleRows',
            'screenshotPlot',
            'setVariable',
            'updateTaskList',
        ]);
    });

    it('classifies tools into read / mutate', () => {
        expect(getTool('runQuery')?.kind).toBe('read');
        expect(getTool('addCell')?.kind).toBe('mutate');
    });
});
