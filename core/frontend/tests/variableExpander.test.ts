import { describe, it, expect } from 'vitest';
import { expandBrushOperator } from '../services/variableExpander';
import { substituteVariables } from '../utils/variableSubstitution';

// PlotRenderer.makeBrushVarHandler writes flat string keys:
//   { '$gc.brush.lo': String(lo), '$gc.brush.hi': String(hi) }
// expandBrushOperator checks for the presence of the .lo key to decide
// whether to expand, and expandBrushOperator produces $gc.brush.lo / $gc.brush.hi
// tokens that substituteVariables then resolves.

describe('expandBrushOperator — basic expansion', () => {
    it('expands IN $x.brush to BETWEEN when brush lo/hi are present', () => {
        const vars = { '$gc.brush.lo': '100', '$gc.brush.hi': '200' };
        expect(expandBrushOperator('WHERE ts IN $gc.brush', vars))
            .toBe('WHERE ts BETWEEN $gc.brush.lo AND $gc.brush.hi');
    });

    it('expands when no variables dict provided (no guard)', () => {
        expect(expandBrushOperator('WHERE ts IN $gc.brush'))
            .toBe('WHERE ts BETWEEN $gc.brush.lo AND $gc.brush.hi');
    });

    it('leaves IN $x.brush intact when variables dict provided but brush not set', () => {
        const vars: Record<string, string> = {};
        expect(expandBrushOperator('WHERE ts IN $gc.brush', vars))
            .toBe('WHERE ts IN $gc.brush');
    });

    it('expands multiple brush references when both are set', () => {
        const vars = {
            '$a.brush.lo': '0',
            '$a.brush.hi': '10',
            '$b.brush.lo': '5',
            '$b.brush.hi': '15',
        };
        const sql = 'WHERE x IN $a.brush AND y IN $b.brush';
        expect(expandBrushOperator(sql, vars))
            .toBe('WHERE x BETWEEN $a.brush.lo AND $a.brush.hi AND y BETWEEN $b.brush.lo AND $b.brush.hi');
    });

    it('does NOT expand $gc.brushXY (must end at .brush word boundary)', () => {
        expect(expandBrushOperator('WHERE ts IN $gc.brushXY'))
            .toBe('WHERE ts IN $gc.brushXY');
    });

    it('does NOT expand tokens that are not preceded by IN', () => {
        expect(expandBrushOperator('SELECT $gc.brush FROM t'))
            .toBe('SELECT $gc.brush FROM t');
    });

    it('does not modify SQL without brush references', () => {
        const sql = 'SELECT * FROM t WHERE x > $start';
        const vars = { '$start': '0' };
        expect(expandBrushOperator(sql, vars)).toBe(sql);
    });
});

describe('expandBrushOperator — mixed brush presence', () => {
    it('only expands brushes that are set when variables dict is provided', () => {
        const vars = { '$a.brush.lo': '0', '$a.brush.hi': '10' };
        // $a.brush is set, $b.brush is not
        const sql = 'WHERE x IN $a.brush AND y IN $b.brush';
        const result = expandBrushOperator(sql, vars);
        expect(result).toContain('BETWEEN $a.brush.lo AND $a.brush.hi');
        expect(result).toContain('IN $b.brush');
    });
});

describe('expandBrushOperator + substituteVariables — end-to-end', () => {
    it('resolves brush range fully when lo/hi are in variables', () => {
        const vars = { '$gc.brush.lo': '1000', '$gc.brush.hi': '2000' };
        const sql = 'SELECT * FROM events WHERE ts IN $gc.brush';
        const expanded = expandBrushOperator(sql, vars);
        const substituted = substituteVariables(expanded, vars);
        expect(substituted).toBe('SELECT * FROM events WHERE ts BETWEEN 1000 AND 2000');
    });
});
