// Smoke-test InlinePreview's runQuery (SQL + DataTable) and previewPlot
// (SQL/DSL + PlotRenderer) branches via SSR. The actual chart rendering
// runs in the browser; here we just assert the two branches mount without
// throwing and emit the expected scaffold elements.

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InlinePreview } from '../components/chat/InlinePreview';

function render(props: React.ComponentProps<typeof InlinePreview>): string {
    return renderToStaticMarkup(React.createElement(InlinePreview, props));
}

describe('InlinePreview', () => {
    describe('runQuery branch', () => {
        const args = { sql: 'SELECT gc_id, duration_ms FROM gc LIMIT 3' };
        const result = {
            columns: [
                { name: 'gc_id', type: 'INTEGER' },
                { name: 'duration_ms', type: 'DOUBLE' },
            ],
            rows: [
                { gc_id: 1, duration_ms: 12.4 },
                { gc_id: 2, duration_ms: 18.7 },
                { gc_id: 3, duration_ms: 9.1 },
            ],
        };

        it('renders the SQL + row count + a DataTable with the row values', () => {
            const html = render({ toolName: 'runQuery', args, result, onAddToNotebook: () => {} });
            expect(html).toContain('Show SQL');
            expect(html).toContain('3 rows');
            expect(html).toContain('SELECT gc_id');
            // DataTable column headers come from result.columns.
            expect(html).toContain('gc_id');
            expect(html).toContain('duration_ms');
            // First row value should be present.
            expect(html).toContain('12.4');
            // The promote button is wired.
            expect(html).toContain('Add to Notebook');
        });

        it('renders nothing (null) when no rows came back', () => {
            const html = render({
                toolName: 'runQuery',
                args,
                result: { columns: result.columns, rows: [] },
                onAddToNotebook: () => {},
            });
            expect(html).toBe('');
        });

        it('hides the promote button when onAddToNotebook is not provided', () => {
            const html = render({ toolName: 'runQuery', args, result });
            expect(html).not.toContain('Add to Notebook');
        });
    });

    describe('previewPlot branch', () => {
        const args = {
            sql: 'SELECT objectClass, totalWeight FROM allocations',
            plotConfig: 'BAR_CHART(x: "objectClass", y: ["totalWeight"]) TITLE "Top classes"',
        };
        const result = {
            previewId: 'preview-abc',
            columns: [
                { name: 'objectClass', type: 'VARCHAR' },
                { name: 'totalWeight', type: 'BIGINT' },
            ],
            rows: [
                { objectClass: 'java.lang.String', totalWeight: 12345 },
                { objectClass: 'byte[]', totalWeight: 9876 },
            ],
            plotConfig: args.plotConfig,
            total: 2,
            limit: 200,
        };

        it('renders the plot header, SQL/DSL toggle, the previewId, and the promote button', () => {
            const html = render({
                toolName: 'previewPlot',
                args,
                result,
                onAddToNotebook: () => {},
            });
            expect(html).toContain('Plot ·');
            expect(html).toContain('2 rows');
            expect(html).toContain('data-preview-id="preview-abc"');
            expect(html).toContain('Show SQL / DSL');
            expect(html).toContain('BAR_CHART');
            expect(html).toContain('Add to Notebook');
        });

        it('falls back to args.plotConfig when result.plotConfig is missing', () => {
            const html = render({
                toolName: 'previewPlot',
                args,
                result: { previewId: 'preview-xyz', rows: [], plotConfig: undefined },
            });
            expect(html).toContain('data-preview-id="preview-xyz"');
            expect(html).toContain('BAR_CHART');
        });

        it('returns null for unknown tool names', () => {
            const html = render({ toolName: 'somethingElse', args: {}, result: {} });
            // renderToStaticMarkup of null is the empty string.
            expect(html).toBe('');
        });
    });
});
