// PlotErrorBoundary smoke tests via SSR + direct invocation of its static
// lifecycle. We can't trigger a real render-time throw without jsdom and
// React's reconciler, but we CAN exercise the lifecycle contract directly:
//
//  - getDerivedStateFromError returns { hasError: true } regardless of input
//  - render() returns children when hasError is false
//  - render() returns fallback when hasError is true
//
// Plus an SSR smoke test for the happy path (children render through).

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlotErrorBoundary } from '../components/chat/PlotErrorBoundary';

describe('PlotErrorBoundary', () => {
    it('renders children when no error has been thrown', () => {
        const html = renderToStaticMarkup(
            React.createElement(
                PlotErrorBoundary,
                {
                    fallback: React.createElement('span', {}, 'fallback'),
                    children: React.createElement('div', {}, 'happy path'),
                },
            ),
        );
        expect(html).toContain('happy path');
        expect(html).not.toContain('fallback');
    });

    it('getDerivedStateFromError flips hasError to true on any thrown value', () => {
        // Static lifecycle is callable directly.
        const StaticBoundary = PlotErrorBoundary as unknown as {
            getDerivedStateFromError: (err: unknown) => { hasError: boolean };
        };
        expect(StaticBoundary.getDerivedStateFromError(new Error('boom'))).toEqual({ hasError: true });
        expect(StaticBoundary.getDerivedStateFromError('string error')).toEqual({ hasError: true });
        expect(StaticBoundary.getDerivedStateFromError(undefined)).toEqual({ hasError: true });
    });

    it('renders the fallback once hasError is set on an instance', () => {
        // Construct the component manually and force the error state.
        const fallback = React.createElement('div', { 'data-testid': 'fb' }, 'PLOT FAILED');
        const children = React.createElement('div', {}, 'should not render');
        // React.Component's constructor signature is forgiving; cast to any
        // for the test-only invocation.
        const Boundary: any = PlotErrorBoundary;
        const instance: any = new Boundary({ fallback, children });
        instance.state = { hasError: true };
        const tree = instance.render();
        expect(tree).toBe(fallback);
    });

    it('componentDidCatch logs the error via console.warn (so devs see it)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const Boundary: any = PlotErrorBoundary;
            const instance: any = new Boundary({ fallback: null, children: null });
            instance.componentDidCatch(new Error('display test'));
            expect(warn).toHaveBeenCalled();
            const msg = warn.mock.calls[0]?.[0];
            expect(String(msg)).toMatch(/PlotErrorBoundary/);
        } finally {
            warn.mockRestore();
        }
    });
});
