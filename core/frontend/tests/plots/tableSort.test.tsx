// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import DataTable from '../../components/DataTable';

const sampleData = [
    { name: 'Alpha', value: 3 },
    { name: 'Beta', value: 1 },
    { name: 'Gamma', value: 2 },
];

describe('DataTable onSortChange callback', () => {
    it('calls onSortChange(col, "asc") on first click', () => {
        const onSortChange = vi.fn();
        const { getAllByRole } = render(<DataTable data={sampleData} onSortChange={onSortChange} />);
        fireEvent.click(getAllByRole('button', { name: /Sort by name/i })[0]);
        expect(onSortChange).toHaveBeenCalledWith('name', 'asc');
    });

    it('calls onSortChange(col, "desc") on second click', () => {
        const onSortChange = vi.fn();
        const { getAllByRole } = render(<DataTable data={sampleData} onSortChange={onSortChange} />);
        const btn = getAllByRole('button', { name: /Sort by name/i })[0];
        fireEvent.click(btn);
        fireEvent.click(btn);
        expect(onSortChange).toHaveBeenNthCalledWith(2, 'name', 'desc');
    });

    it('switching column resets to asc', () => {
        const onSortChange = vi.fn();
        const { getAllByRole } = render(<DataTable data={sampleData} onSortChange={onSortChange} />);
        fireEvent.click(getAllByRole('button', { name: /Sort by name/i })[0]);
        fireEvent.click(getAllByRole('button', { name: /Sort by value/i })[0]);
        expect(onSortChange).toHaveBeenNthCalledWith(2, 'value', 'asc');
    });

    it('does not throw when onSortChange is not provided', () => {
        const { getAllByRole } = render(<DataTable data={sampleData} />);
        expect(() => fireEvent.click(getAllByRole('button', { name: /Sort by name/i })[0])).not.toThrow();
    });
});
