import { describe, it, expect } from 'vitest';
import { plotClauseDocs, type ClauseDoc } from '../../utils/plotClauseDocs';

// ── plotClauseDocs registry ───────────────────────────────────────────────────

describe('plotClauseDocs', () => {
    it('is a non-empty record', () => {
        expect(typeof plotClauseDocs).toBe('object');
        expect(Object.keys(plotClauseDocs).length).toBeGreaterThan(0);
    });

    it('every entry has non-empty name, signature, description, and params array', () => {
        for (const [key, doc] of Object.entries(plotClauseDocs)) {
            expect(typeof doc.name).toBe('string');
            expect(doc.name.length).toBeGreaterThan(0);
            expect(typeof doc.signature).toBe('string');
            expect(doc.signature.length).toBeGreaterThan(0);
            expect(typeof doc.description).toBe('string');
            expect(doc.description.length).toBeGreaterThan(0);
            expect(Array.isArray(doc.params)).toBe(true);
        }
    });

    it('contains expected layout clauses', () => {
        expect(plotClauseDocs).toHaveProperty('TITLE');
        expect(plotClauseDocs).toHaveProperty('WIDTH');
        expect(plotClauseDocs).toHaveProperty('HEIGHT');
        expect(plotClauseDocs).toHaveProperty('ON');
    });

    it('contains axis configuration clauses', () => {
        expect(plotClauseDocs).toHaveProperty('AXIS_X');
        expect(plotClauseDocs).toHaveProperty('AXIS_Y');
    });

    it('contains interactive clauses', () => {
        expect(plotClauseDocs).toHaveProperty('BRUSH');
        expect(plotClauseDocs).toHaveProperty('LINK_X');
    });

    it('params entries have name and type fields', () => {
        for (const doc of Object.values(plotClauseDocs)) {
            for (const param of doc.params) {
                expect(typeof param.name).toBe('string');
                expect(param.name.length).toBeGreaterThan(0);
                expect(typeof param.type).toBe('string');
            }
        }
    });

    it('BRUSH clause has a $var_name param', () => {
        const brushDoc = plotClauseDocs['BRUSH'] as ClauseDoc;
        expect(brushDoc).toBeDefined();
        const varParam = brushDoc.params.find(p => p.name === '$var_name');
        expect(varParam).toBeDefined();
    });

    it('AXIS_X doc mentions TYPE and LABEL params', () => {
        const axisDoc = plotClauseDocs['AXIS_X'] as ClauseDoc;
        const paramNames = axisDoc.params.map(p => p.name);
        expect(paramNames).toContain('LABEL');
        expect(paramNames).toContain('TYPE');
    });

    it('TOOLTIP COLUMNS is accessible under both single and compound keys', () => {
        expect(plotClauseDocs['TOOLTIP']).toBeDefined();
        expect(plotClauseDocs['TOOLTIP COLUMNS']).toBeDefined();
    });
});
