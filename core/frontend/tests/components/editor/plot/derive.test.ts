import { describe, it, expect } from 'vitest';
import { derive } from '../../../../components/editor/plot/derive';
import { parse } from '../../../../components/editor/plot/parser';

// ── helpers ───────────────────────────────────────────────────────────────────

function d(src: string) {
    return derive(parse(src));
}

// ── derive — mainConfig ───────────────────────────────────────────────────────

describe('derive — mainConfig', () => {
    it('extracts mainConfig for an uppercase TABLE()', () => {
        const result = d('TABLE()');
        expect(result.mainConfig).toBe('TABLE()');
    });

    it('extracts mainConfig for a bare TABLE with columns', () => {
        const result = d('TABLE(headers: ["a", "b"])');
        expect(result.mainConfig).toBe('TABLE(headers: ["a", "b"])');
    });

    it('strips a TITLE tail from mainConfig', () => {
        const result = d('TABLE() TITLE "My Title"');
        expect(result.mainConfig).toBe('TABLE()');
        expect(result.title).toBe('My Title');
    });

    it('strips a NAME tail from mainConfig', () => {
        const result = d('TABLE() NAME "myPlot"');
        expect(result.mainConfig).toBe('TABLE()');
        expect(result.plotName).toBe('myPlot');
    });

    it('returns source text for empty/unrecognised script', () => {
        const result = d('');
        expect(typeof result.mainConfig).toBe('string');
    });

    it('handles uppercase BAR_CHART with x and y', () => {
        const result = d('BAR_CHART(x: cause, y: [duration])');
        expect(result.mainConfig).toContain('BAR_CHART');
        expect(result.mainConfig).toContain('cause');
    });
});

// ── derive — tail fields ──────────────────────────────────────────────────────

describe('derive — tail fields', () => {
    it('extracts title from TITLE tail', () => {
        expect(d('TABLE() TITLE "My Title"').title).toBe('My Title');
    });

    it('extracts plotName from NAME tail', () => {
        expect(d('TABLE() NAME "Overview"').plotName).toBe('Overview');
    });

    it('extracts width from WIDTH tail', () => {
        const r = d('TABLE() WIDTH 50%');
        expect(r.width).toBeDefined();
    });

    it('sets disabled=true for DISABLED tail', () => {
        expect(d('TABLE() DISABLED').disabled).toBe(true);
    });

    it('disabled is not set when no DISABLED tail', () => {
        expect(d('TABLE()').disabled).toBeUndefined();
    });

    it('extracts zoom from ZOOM tail', () => {
        const r = d('HISTOGRAM(x: duration) ZOOM 2');
        expect(r.zoom).toBe(2);
    });

    it('extracts on from ON tail with single query index', () => {
        const r = d('TABLE() ON 1');
        expect(r.on).toBeDefined();
        expect(r.on).toContain('1');
    });

    it('extracts multiple tails at once', () => {
        const r = d('TABLE() TITLE "Data" NAME "myName"');
        expect(r.title).toBe('Data');
        expect(r.plotName).toBe('myName');
    });
});

// ── derive — composite ────────────────────────────────────────────────────────

describe('derive — composite', () => {
    it('returns composite with row direction', () => {
        const r = d('ROW { TABLE() TABLE() }');
        expect(r.composite).toBeDefined();
        expect(r.composite?.direction).toBe('row');
    });

    it('returns composite with col direction', () => {
        const r = d('COL { TABLE() TABLE() }');
        expect(r.composite?.direction).toBe('col');
    });

    it('composite children are derivations of each inner plot', () => {
        const r = d('ROW { TABLE() BAR_CHART(x: cause, y: [duration]) }');
        expect(r.composite?.children).toHaveLength(2);
        expect(r.composite?.children[0].mainConfig).toContain('TABLE');
        expect(r.composite?.children[1].mainConfig).toContain('BAR_CHART');
    });
});
