import { describe, it, expect } from 'vitest';
import { parseDollar, isBrushRef, isTupleIndexRef } from '../../components/editor/sql/ast';

describe('parseDollar — single-dollar local variables', () => {
    it('classifies $foo as variableRef', () => {
        expect(parseDollar('$foo')).toEqual({
            kind: 'variableRef', name: 'foo', path: [], raw: '$foo',
        });
    });

    it('preserves underscores and digits in names', () => {
        const p = parseDollar('$cause_thread_2');
        expect(p.kind).toBe('variableRef');
        expect(p.name).toBe('cause_thread_2');
    });

    it('empty bare $ produces variableRef with empty name', () => {
        expect(parseDollar('$')).toEqual({
            kind: 'variableRef', name: '', path: [], raw: '$',
        });
    });
});

describe('parseDollar — double-dollar (notebook-scoped) variables', () => {
    it('classifies $$foo as doubleDollarRef', () => {
        expect(parseDollar('$$foo')).toEqual({
            kind: 'doubleDollarRef', name: 'foo', path: [], raw: '$$foo',
        });
    });

    it('bare $$ produces doubleDollarRef with empty name', () => {
        const p = parseDollar('$$');
        expect(p.kind).toBe('doubleDollarRef');
        expect(p.name).toBe('');
    });

    it('trims a trailing dot off $$foo. so completion is still useful', () => {
        const p = parseDollar('$$foo.');
        expect(p.kind).toBe('doubleDollarRef');
        expect(p.name).toBe('foo');
    });
});

describe('parseDollar — cross-cell references', () => {
    it('classifies $cellName.varName as crossCellRef', () => {
        expect(parseDollar('$gcCell.threshold')).toEqual({
            kind: 'crossCellRef', name: 'gcCell', path: ['threshold'], raw: '$gcCell.threshold',
        });
    });

    it('captures tuple index in path (e.g. $gc.range.0)', () => {
        const p = parseDollar('$gc.range.0');
        expect(p.kind).toBe('crossCellRef');
        expect(p.name).toBe('gc');
        expect(p.path).toEqual(['range', '0']);
    });

    it('handles 1-based tuple indices the same way', () => {
        const p = parseDollar('$gc.range.1');
        expect(p.path).toEqual(['range', '1']);
    });

    it('multi-segment property paths preserved', () => {
        const p = parseDollar('$cell.var.field.0');
        expect(p.kind).toBe('crossCellRef');
        expect(p.path).toEqual(['var', 'field', '0']);
    });

    it('drops empty segments from consecutive dots', () => {
        const p = parseDollar('$cell..var');
        expect(p.path).toEqual(['var']);
    });

    it('trailing dot leaves an empty tail but stays crossCellRef', () => {
        // Mid-type: `$plot.` — completion engine sees crossCellRef and can
        // offer the cell's exported variable names.
        const p = parseDollar('$plot.');
        expect(p.kind).toBe('crossCellRef');
        expect(p.name).toBe('plot');
        expect(p.path).toEqual([]);
    });

    it('case-preserves cell name segments', () => {
        const p = parseDollar('$GC_Cell.myVar');
        expect(p.name).toBe('GC_Cell');
        expect(p.path).toEqual(['myVar']);
    });
});

describe('parseDollar — brush references (subform of crossCellRef)', () => {
    it('classifies $plot.brush as crossCellRef', () => {
        const p = parseDollar('$plot.brush');
        expect(p.kind).toBe('crossCellRef');
        expect(p.name).toBe('plot');
        expect(p.path).toEqual(['brush']);
    });

    it('keeps brush properties (.lo / .hi) in the path', () => {
        expect(parseDollar('$rng.brush.lo').path).toEqual(['brush', 'lo']);
        expect(parseDollar('$rng.brush.hi').path).toEqual(['brush', 'hi']);
    });
});

describe('isBrushRef', () => {
    it('true when first path segment is "brush"', () => {
        expect(isBrushRef(parseDollar('$plot.brush'))).toBe(true);
        expect(isBrushRef(parseDollar('$plot.brush.lo'))).toBe(true);
    });

    it('false for non-brush crossCellRef', () => {
        expect(isBrushRef(parseDollar('$cell.var'))).toBe(false);
        expect(isBrushRef(parseDollar('$cell.var.brush'))).toBe(false); // brush must be at index 0
    });

    it('false for variableRef and doubleDollarRef', () => {
        expect(isBrushRef(parseDollar('$foo'))).toBe(false);
        expect(isBrushRef(parseDollar('$$foo'))).toBe(false);
    });
});

describe('isTupleIndexRef', () => {
    it('true when last path segment is all-digit', () => {
        expect(isTupleIndexRef(parseDollar('$cell.var.0'))).toBe(true);
        expect(isTupleIndexRef(parseDollar('$cell.var.42'))).toBe(true);
    });

    it('false when last path segment is non-numeric', () => {
        expect(isTupleIndexRef(parseDollar('$cell.var'))).toBe(false);
        expect(isTupleIndexRef(parseDollar('$plot.brush.lo'))).toBe(false);
    });

    it('false for variableRef and doubleDollarRef', () => {
        expect(isTupleIndexRef(parseDollar('$foo'))).toBe(false);
        expect(isTupleIndexRef(parseDollar('$$foo'))).toBe(false);
    });

    it('false when path is empty (e.g. $plot.)', () => {
        expect(isTupleIndexRef(parseDollar('$plot.'))).toBe(false);
    });
});

describe('parseDollar — input not starting with $', () => {
    it('returns variableRef shell so callers always get a typed result', () => {
        const p = parseDollar('foo');
        expect(p.kind).toBe('variableRef');
        expect(p.name).toBe('foo');
        expect(p.raw).toBe('foo');
    });
});
