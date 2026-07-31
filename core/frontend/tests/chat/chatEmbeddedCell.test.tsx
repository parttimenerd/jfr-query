// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCellFence, splitCellFences } from '../../components/chat/ChatEmbeddedCell';
import { render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { ChatEmbeddedCell } from '../../components/chat/ChatEmbeddedCell';
import { DataContext } from '../../context/DuckDBContext';

describe('parseCellFence', () => {
    it('parses a chart fence', () => {
        const fence = `type=chart
sql: SELECT bucket, avg(pause_ms) AS p FROM gc GROUP BY bucket ORDER BY bucket
plot: LINE_CHART(x: "bucket", y: ["p"])`;
        const result = parseCellFence(fence);
        expect(result).toEqual({
            type: 'chart',
            sql: 'SELECT bucket, avg(pause_ms) AS p FROM gc GROUP BY bucket ORDER BY bucket',
            plotConfig: 'LINE_CHART(x: "bucket", y: ["p"])',
        });
    });

    it('parses a table fence (no plot)', () => {
        const fence = `type=table\nsql: SELECT * FROM gc_events LIMIT 10`;
        const result = parseCellFence(fence);
        expect(result).toEqual({ type: 'table', sql: 'SELECT * FROM gc_events LIMIT 10', plotConfig: undefined });
    });

    it('parses a flamegraph fence', () => {
        const fence = `type=flamegraph\nsql: SELECT stackTrace, sum(samples) AS n FROM ExecutionSample GROUP BY stackTrace ORDER BY n DESC LIMIT 500`;
        const result = parseCellFence(fence);
        expect(result?.type).toBe('flamegraph');
        expect(result?.sql).toContain('ExecutionSample');
    });

    it('returns null for malformed fence (no sql)', () => {
        const fence = `type=chart\nplot: LINE_CHART(x: "x", y: ["y"])`;
        expect(parseCellFence(fence)).toBeNull();
    });

    it('returns null for unknown type', () => {
        const fence = `type=unknown\nsql: SELECT 1`;
        expect(parseCellFence(fence)).toBeNull();
    });
});

describe('splitCellFences', () => {
    it('splits text with one fence into text + cell parts', () => {
        const text = `Here is the chart:\n:::cell type=chart\nsql: SELECT 1\n:::\nDone.`;
        const parts = splitCellFences(text);
        expect(parts).toHaveLength(3);
        expect(parts[0]).toEqual({ kind: 'text', content: 'Here is the chart:\n' });
        expect(parts[1]).toEqual({ kind: 'cell', content: 'type=chart\nsql: SELECT 1' });
        expect(parts[2]).toEqual({ kind: 'text', content: '\nDone.' });
    });

    it('handles multiple fences', () => {
        const text = `A\n:::cell type=table\nsql: SELECT 1\n:::\nB\n:::cell type=chart\nsql: SELECT 2\nplot: BAR_CHART(x: "x", y: "y")\n:::\nC`;
        const parts = splitCellFences(text);
        expect(parts.filter(p => p.kind === 'cell')).toHaveLength(2);
        expect(parts.filter(p => p.kind === 'text')).toHaveLength(3);
    });

    it('returns single text part when no fences', () => {
        const text = 'Just plain text.';
        const parts = splitCellFences(text);
        expect(parts).toHaveLength(1);
        expect(parts[0]).toEqual({ kind: 'text', content: 'Just plain text.' });
    });

    it('handles fence at start of text', () => {
        const text = `:::cell type=table\nsql: SELECT 1\n:::\nAfter`;
        const parts = splitCellFences(text);
        expect(parts[0].kind).toBe('cell');
        expect(parts[1]).toEqual({ kind: 'text', content: '\nAfter' });
    });
});

const mockQuery = vi.fn();
const wrapper = ({ children }: { children: React.ReactNode }) => (
    React.createElement(DataContext.Provider, { value: { query: mockQuery } as any }, children)
);

describe('ChatEmbeddedCell', () => {
    beforeEach(() => {
        mockQuery.mockResolvedValue([{ bucket: '2024-01-01', avg_pause: 12 }]);
    });

    it('executes sql on mount', async () => {
        render(
            React.createElement(ChatEmbeddedCell, { type: 'table', sql: 'SELECT 1', onAddToNotebook: vi.fn() }),
            { wrapper },
        );
        await waitFor(() => expect(mockQuery).toHaveBeenCalledWith('SELECT 1'));
    });

    it('shows type badge', () => {
        const { container } = render(
            React.createElement(ChatEmbeddedCell, { type: 'table', sql: 'SELECT 1', onAddToNotebook: vi.fn() }),
            { wrapper },
        );
        expect(container.textContent).toContain('TABLE');
    });

    it('shows truncated sql label', () => {
        const { container } = render(
            React.createElement(ChatEmbeddedCell, {
                type: 'table',
                sql: 'SELECT bucket FROM gc_events LIMIT 10',
                onAddToNotebook: vi.fn(),
            }),
            { wrapper },
        );
        expect(container.textContent).toContain('SELECT bucket FROM gc_events');
    });

    it('calls onAddToNotebook when button clicked', () => {
        const onAdd = vi.fn();
        const { container } = render(
            React.createElement(ChatEmbeddedCell, { type: 'table', sql: 'SELECT 1', onAddToNotebook: onAdd }),
            { wrapper },
        );
        const button = container.querySelector('button')!;
        fireEvent.click(button);
        expect(onAdd).toHaveBeenCalledOnce();
    });

    it('shows error when query fails', async () => {
        mockQuery.mockRejectedValue(new Error('Table not found'));
        const { container } = render(
            React.createElement(ChatEmbeddedCell, { type: 'table', sql: 'SELECT 1', onAddToNotebook: vi.fn() }),
            { wrapper },
        );
        await waitFor(() => expect(container.textContent).toContain('Table not found'));
    });
});

import { ChatMarkdownView } from '../../components/chat/ChatMarkdownView';

describe('ChatMarkdownView with cell fences', () => {
    beforeEach(() => {
        mockQuery.mockResolvedValue([{ n: 1 }]);
    });

    it('renders plain text without cell fences unchanged', () => {
        const { container } = render(
            React.createElement(ChatMarkdownView, { text: 'Hello world' }),
        );
        expect(container.textContent).toContain('Hello world');
    });

    it('renders a :::cell fence as ChatEmbeddedCell (shows TABLE badge)', async () => {
        const text = 'Here:\n:::cell type=table\nsql: SELECT 1\n:::\nDone.';
        const { container } = render(
            React.createElement(ChatMarkdownView, { text }),
            { wrapper },
        );
        await waitFor(() => expect(container.textContent).toContain('TABLE'));
    });

    it('calls onAddToNotebook with correct args when button clicked', async () => {
        const onAdd = vi.fn();
        const text = ':::cell type=table\nsql: SELECT 42\n:::';
        const { container } = render(
            React.createElement(ChatMarkdownView, { text, onAddToNotebook: onAdd }),
            { wrapper },
        );
        await waitFor(() => expect(container.textContent).toContain('TABLE'));
        // Find the first button in the embedded cell area
        const buttons = container.querySelectorAll('button');
        const addBtn = Array.from(buttons).find(b => b.textContent?.includes('Add'));
        if (addBtn) {
            fireEvent.click(addBtn);
        }
        expect(onAdd).toHaveBeenCalledWith('SELECT 42', 'table', undefined);
    });

    it('renders text before and after a fence', async () => {
        const text = 'Before\n:::cell type=table\nsql: SELECT 1\n:::\nAfter';
        const { container } = render(
            React.createElement(ChatMarkdownView, { text }),
            { wrapper },
        );
        expect(container.textContent).toContain('Before');
        expect(container.textContent).toContain('After');
        await waitFor(() => expect(container.textContent).toContain('TABLE'));
    });
});
