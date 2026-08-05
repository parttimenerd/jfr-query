// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { NotebookTOC } from '../../components/NotebookTOC';
import type { NotebookCellData } from '../../types';

afterEach(cleanup);

const makeCell = (id: string, title: string): NotebookCellData =>
    ({ id, title, content: `## ${title}\n`, name: null } as any);

describe('NotebookTOC', () => {
    it('renders one entry per cell that has a non-empty title', () => {
        const cells = [
            makeCell('a', 'GC Pause Summary'),
            makeCell('b', 'Heap Usage'),
            makeCell('c', ''),
        ];
        const { getByText, queryByText } = render(
            <NotebookTOC cells={cells} onClose={() => {}} />
        );
        expect(getByText('GC Pause Summary')).toBeTruthy();
        expect(getByText('Heap Usage')).toBeTruthy();
        // Cell with empty title should NOT appear as a navigation button
        expect(queryByText('', { selector: 'button' })).toBeNull();
    });

    it('calls onClose when close button clicked', () => {
        const onClose = vi.fn();
        const { getByLabelText } = render(
            <NotebookTOC cells={[]} onClose={onClose} />
        );
        fireEvent.click(getByLabelText('Close table of contents'));
        expect(onClose).toHaveBeenCalled();
    });

    it('shows "No headings found" when cells list is empty', () => {
        const { getByText } = render(
            <NotebookTOC cells={[]} onClose={() => {}} />
        );
        expect(getByText(/no headings/i)).toBeTruthy();
    });
});
