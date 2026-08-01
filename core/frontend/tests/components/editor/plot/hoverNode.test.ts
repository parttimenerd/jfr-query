import { describe, it, expect } from 'vitest';
import { findHoveredPlotNode } from '../../../../components/editor/plot/hoverNode';
import { parse } from '../../../../components/editor/plot/parser';

// ── findHoveredPlotNode ───────────────────────────────────────────────────────

describe('findHoveredPlotNode', () => {
    it('returns null for position outside the root span', () => {
        const root = parse('TABLE()');
        expect(findHoveredPlotNode(root, 1000)).toBeNull();
    });

    it('returns a token node when cursor is inside a keyword token', () => {
        const src = 'TABLE()';
        const root = parse(src);
        // pos=0 is inside the TABLE token
        const node = findHoveredPlotNode(root, 0);
        expect(node).not.toBeNull();
        expect(node?.kind).not.toBe('script');
    });

    it('returns the tightest containing node', () => {
        const src = 'BAR_CHART(x: cause, y: [duration])';
        const root = parse(src);
        // pos inside 'cause' (around offset 13)
        const node = findHoveredPlotNode(root, 13);
        expect(node).not.toBeNull();
        // Should be a tight node — not the entire plotCall
        const plotCallLen = src.length;
        const nodeLen = (node?.to ?? 0) - (node?.from ?? 0);
        expect(nodeLen).toBeLessThan(plotCallLen);
    });

    it('returns null for whitespace position outside any token', () => {
        // In 'TABLE( )' the space inside the parens is between tokens
        const src = 'TABLE()';
        const root = parse(src);
        // Position past end of the source
        expect(findHoveredPlotNode(root, src.length + 5)).toBeNull();
    });

    it('returns null for empty script', () => {
        const root = parse('');
        expect(findHoveredPlotNode(root, 0)).toBeNull();
    });

    it('handles TITLE tail — pos inside the title string', () => {
        const src = 'TABLE() TITLE "GC Data"';
        const root = parse(src);
        // pos=15 is inside "GC Data"
        const node = findHoveredPlotNode(root, 15);
        expect(node).not.toBeNull();
    });
});
