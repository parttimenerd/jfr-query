import { describe, it, expect } from 'vitest';
import { evaluateCondition, evaluateScalar } from '../../../services/templating/evaluators';

// ─── evaluateCondition ────────────────────────────────────────────────────────

describe('evaluateCondition', () => {
    it('returns ok:false for empty SQL', async () => {
        const result = await evaluateCondition(async () => [], '');
        expect(result).toEqual({ kind: 'ok', value: false });
    });

    it('returns ok:false for whitespace-only SQL', async () => {
        const result = await evaluateCondition(async () => [], '   ');
        expect(result).toEqual({ kind: 'ok', value: false });
    });

    it('returns ok:true when first column is true', async () => {
        const result = await evaluateCondition(async () => [{ val: true }], 'SELECT 1');
        expect(result).toEqual({ kind: 'ok', value: true });
    });

    it('returns ok:false when first column is false', async () => {
        const result = await evaluateCondition(async () => [{ val: false }], 'SELECT 0');
        expect(result).toEqual({ kind: 'ok', value: false });
    });

    it('returns ok:true for non-zero number', async () => {
        const result = await evaluateCondition(async () => [{ n: 42 }], 'SELECT 42');
        expect(result).toEqual({ kind: 'ok', value: true });
    });

    it('returns ok:false for zero', async () => {
        const result = await evaluateCondition(async () => [{ n: 0 }], 'SELECT 0');
        expect(result).toEqual({ kind: 'ok', value: false });
    });

    it('returns ok:true for non-empty string', async () => {
        const result = await evaluateCondition(async () => [{ s: 'yes' }], 'SELECT 1');
        expect(result).toEqual({ kind: 'ok', value: true });
    });

    it('returns ok:false for "false" string', async () => {
        const result = await evaluateCondition(async () => [{ s: 'false' }], 'SELECT 1');
        expect(result).toEqual({ kind: 'ok', value: false });
    });

    it('returns ok:false for "0" string', async () => {
        const result = await evaluateCondition(async () => [{ s: '0' }], 'SELECT 1');
        expect(result).toEqual({ kind: 'ok', value: false });
    });

    it('returns ok:false for BigInt 0n', async () => {
        const result = await evaluateCondition(async () => [{ n: 0n }], 'SELECT 0');
        expect(result).toEqual({ kind: 'ok', value: false });
    });

    it('returns ok:true for BigInt non-zero', async () => {
        const result = await evaluateCondition(async () => [{ n: 1n }], 'SELECT 1');
        expect(result).toEqual({ kind: 'ok', value: true });
    });

    it('returns ok:false for null value', async () => {
        const result = await evaluateCondition(async () => [{ v: null }], 'SELECT NULL');
        expect(result).toEqual({ kind: 'ok', value: false });
    });

    it('returns ok:false when rows is empty', async () => {
        const result = await evaluateCondition(async () => [], 'SELECT 1');
        expect(result).toEqual({ kind: 'ok', value: false });
    });

    it('returns error when query throws', async () => {
        const result = await evaluateCondition(
            async () => { throw new Error('connection error'); },
            'SELECT 1',
        );
        expect(result.kind).toBe('error');
        if (result.kind === 'error') expect(result.message).toContain('connection error');
    });

    it('returns error with stringified non-Error throw', async () => {
        const result = await evaluateCondition(
            async () => { throw 'plain string error'; },
            'SELECT 1',
        );
        expect(result.kind).toBe('error');
    });
});

// ─── evaluateScalar ───────────────────────────────────────────────────────────

describe('evaluateScalar', () => {
    it('returns empty for blank SQL', async () => {
        const result = await evaluateScalar(async () => [], '');
        expect(result).toEqual({ kind: 'empty' });
    });

    it('returns empty when query returns no rows', async () => {
        const result = await evaluateScalar(async () => [], 'SELECT 1');
        expect(result).toEqual({ kind: 'empty' });
    });

    it('returns ok with first column value', async () => {
        const result = await evaluateScalar(async () => [{ v: 42 }], 'SELECT 42');
        expect(result).toEqual({ kind: 'ok', value: 42 });
    });

    it('returns ok with string value', async () => {
        const result = await evaluateScalar(async () => [{ s: 'hello' }], 'SELECT 1');
        expect(result).toEqual({ kind: 'ok', value: 'hello' });
    });

    it('returns empty when first row is undefined first value', async () => {
        const result = await evaluateScalar(async () => [{}], 'SELECT 1');
        expect(result).toEqual({ kind: 'empty' });
    });

    it('returns error when query throws', async () => {
        const result = await evaluateScalar(
            async () => { throw new Error('timeout'); },
            'SELECT 1',
        );
        expect(result.kind).toBe('error');
        if (result.kind === 'error') expect(result.message).toContain('timeout');
    });
});
