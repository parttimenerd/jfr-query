// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { ChatTraceView } from '../../components/chat/ChatTraceView';
import type { TraceStep } from '../../components/chat/ChatTraceView';

const steps: TraceStep[] = [
    {
        tool: 'query_data',
        args: { sql: 'SELECT count(*) FROM GarbageCollection', reason: 'Count GC events', tables: ['GarbageCollection'] },
        result: JSON.stringify({ columns: ['count'], rows: [[14]], totalRows: 14 }),
        durationMs: 32,
        rowCount: 14,
    },
    {
        tool: 'query_data',
        args: { sql: 'SELECT stackTrace, sum(samples) AS n FROM ExecutionSample GROUP BY stackTrace ORDER BY n DESC LIMIT 20', reason: 'Top CPU methods', tables: ['ExecutionSample'] },
        result: JSON.stringify({ columns: ['stackTrace', 'n'], rows: [], totalRows: 20 }),
        durationMs: 118,
        rowCount: 20,
    },
];

describe('ChatTraceView', () => {
    it('renders collapsed by default with step count', () => {
        const { container } = render(React.createElement(ChatTraceView, { steps }));
        expect(container.textContent).toContain('Thinking');
        expect(container.textContent).toContain('2 queries');
    });

    it('does not show step details when collapsed', () => {
        const { container } = render(React.createElement(ChatTraceView, { steps }));
        expect(container.textContent).not.toContain('Count GC events');
    });

    it('shows step details after clicking the header', () => {
        const { container } = render(React.createElement(ChatTraceView, { steps }));
        const btn = container.querySelector('button')!;
        fireEvent.click(btn);
        expect(container.textContent).toContain('Count GC events');
        expect(container.textContent).toContain('Top CPU methods');
    });

    it('shows row count for query_data steps', () => {
        const { container } = render(React.createElement(ChatTraceView, { steps }));
        const btn = container.querySelector('button')!;
        fireEvent.click(btn);
        expect(container.textContent).toContain('14 rows');
        expect(container.textContent).toContain('20 rows');
    });

    it('shows total duration in the header', () => {
        const { container } = render(React.createElement(ChatTraceView, { steps }));
        // total = 32 + 118 = 150ms
        expect(container.textContent).toContain('150ms');
    });

    it('reveals full SQL when "show sql" is toggled', () => {
        const { container } = render(React.createElement(ChatTraceView, { steps }));
        const toggleBtn = container.querySelector('button')!;
        fireEvent.click(toggleBtn);
        const showSqlBtns = Array.from(container.querySelectorAll('button')).filter(b =>
            b.textContent?.toLowerCase().includes('show sql'),
        );
        expect(showSqlBtns.length).toBeGreaterThanOrEqual(1);
        fireEvent.click(showSqlBtns[0]);
        expect(container.textContent).toContain('SELECT count(*)');
    });
});
