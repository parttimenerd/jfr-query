// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { ChatPermissionCard } from '../../components/chat/ChatPermissionCard';

const queryArgs = {
    sql: 'SELECT class_name, sum(alloc_size) AS total FROM ObjectAllocationInNewTLAB GROUP BY class_name ORDER BY total DESC LIMIT 20',
    reason: 'Find top allocating classes',
    tables: ['ObjectAllocationInNewTLAB'],
};

describe('ChatPermissionCard — query_data', () => {
    it('shows the reason text', () => {
        const { container } = render(
            React.createElement(ChatPermissionCard, {
                toolName: 'query_data',
                args: queryArgs,
                onAllowSession: vi.fn(),
                onAllowAlways: vi.fn(),
                onDeny: vi.fn(),
            }),
        );
        expect(container.textContent).toContain('Find top allocating classes');
    });

    it('shows table names', () => {
        const { container } = render(
            React.createElement(ChatPermissionCard, {
                toolName: 'query_data',
                args: queryArgs,
                onAllowSession: vi.fn(),
                onAllowAlways: vi.fn(),
                onDeny: vi.fn(),
            }),
        );
        expect(container.textContent).toContain('ObjectAllocationInNewTLAB');
    });

    it('shows truncated SQL', () => {
        const { container } = render(
            React.createElement(ChatPermissionCard, {
                toolName: 'query_data',
                args: queryArgs,
                onAllowSession: vi.fn(),
                onAllowAlways: vi.fn(),
                onDeny: vi.fn(),
            }),
        );
        expect(container.textContent).toContain('SELECT class_name');
    });

    it('calls onAllowSession when "Allow for this session" clicked', () => {
        const onAllowSession = vi.fn();
        const { container } = render(
            React.createElement(ChatPermissionCard, {
                toolName: 'query_data',
                args: queryArgs,
                onAllowSession,
                onAllowAlways: vi.fn(),
                onDeny: vi.fn(),
            }),
        );
        const btn = Array.from(container.querySelectorAll('button')).find(b =>
            b.textContent?.includes('Allow for this session'),
        )!;
        fireEvent.click(btn);
        expect(onAllowSession).toHaveBeenCalledOnce();
    });

    it('calls onAllowAlways when "Always allow" clicked', () => {
        const onAllowAlways = vi.fn();
        const { container } = render(
            React.createElement(ChatPermissionCard, {
                toolName: 'query_data',
                args: queryArgs,
                onAllowSession: vi.fn(),
                onAllowAlways,
                onDeny: vi.fn(),
            }),
        );
        const btn = Array.from(container.querySelectorAll('button')).find(b =>
            b.textContent?.includes('Always allow'),
        )!;
        fireEvent.click(btn);
        expect(onAllowAlways).toHaveBeenCalledOnce();
    });

    it('calls onDeny when Deny clicked', () => {
        const onDeny = vi.fn();
        const { container } = render(
            React.createElement(ChatPermissionCard, {
                toolName: 'query_data',
                args: queryArgs,
                onAllowSession: vi.fn(),
                onAllowAlways: vi.fn(),
                onDeny,
            }),
        );
        const btn = Array.from(container.querySelectorAll('button')).find(b =>
            b.textContent?.includes('Deny'),
        )!;
        fireEvent.click(btn);
        expect(onDeny).toHaveBeenCalledOnce();
    });
});

describe('ChatPermissionCard — notebook mutation', () => {
    it('shows mutation title for add_cell', () => {
        const { container } = render(
            React.createElement(ChatPermissionCard, {
                toolName: 'add_cell',
                args: { type: 'sql', content: 'SELECT 1', afterCellId: 'cell-1' },
                onAllowSession: vi.fn(),
                onAllowAlways: vi.fn(),
                onDeny: vi.fn(),
            }),
        );
        expect(container.textContent).toContain('Allow AI to modify your notebook');
    });

    it('shows action description for add_cell', () => {
        const { container } = render(
            React.createElement(ChatPermissionCard, {
                toolName: 'add_cell',
                args: { type: 'sql', content: 'SELECT 1', afterCellId: 'cell-1' },
                onAllowSession: vi.fn(),
                onAllowAlways: vi.fn(),
                onDeny: vi.fn(),
            }),
        );
        expect(container.textContent).toContain('Add sql cell');
    });
});
