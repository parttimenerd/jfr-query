// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ResizablePlotContainer } from '../../components/ResizablePlotContainer';

describe('ResizablePlotContainer', () => {
    it('renders children', () => {
        const { getByText } = render(
            <ResizablePlotContainer><span>hello</span></ResizablePlotContainer>
        );
        expect(getByText('hello')).toBeTruthy();
    });

    it('renders a resize handle', () => {
        const { container } = render(
            <ResizablePlotContainer><span>x</span></ResizablePlotContainer>
        );
        expect(container.querySelector('[data-resize-handle]')).toBeTruthy();
    });

    it('accepts id and className props', () => {
        const { container } = render(
            <ResizablePlotContainer id="test-id" className="extra">
                <span>x</span>
            </ResizablePlotContainer>
        );
        const el = container.firstChild as HTMLElement;
        expect(el.id).toBe('test-id');
        expect(el.className).toContain('extra');
    });
});
