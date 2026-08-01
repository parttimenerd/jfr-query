import { describe, it, expect } from 'vitest';
import { buildSqlAiContext, buildPlotAiContext } from '../../../components/editor/aiCompletionSource';

describe('buildSqlAiContext', () => {
    it('prepends schema hint when tables and columns are provided', () => {
        const result = buildSqlAiContext('SELECT ', ['events', 'heap'], ['cause', 'duration']);
        expect(result).toContain('-- Tables: events, heap');
        expect(result).toContain('-- Columns: cause, duration');
        expect(result).toContain('SELECT ');
    });

    it('places SQL after the schema hint', () => {
        const sql = 'SELECT cause FROM events WHERE ';
        const result = buildSqlAiContext(sql, ['events'], ['cause']);
        expect(result.endsWith(sql)).toBe(true);
    });

    it('omits schema hint when table names are empty', () => {
        const result = buildSqlAiContext('SELECT 1', [], ['col']);
        expect(result).not.toContain('-- Tables');
        expect(result).toBe('SELECT 1');
    });

    it('caps table names at 10', () => {
        const tables = Array.from({ length: 15 }, (_, i) => `t${i}`);
        const result = buildSqlAiContext('SELECT 1', tables, []);
        const match = result.match(/-- Tables: (.+)\n/);
        const listed = match?.[1].split(', ') ?? [];
        expect(listed.length).toBeLessThanOrEqual(10);
    });

    it('caps column names at 20', () => {
        const cols = Array.from({ length: 25 }, (_, i) => `col${i}`);
        const result = buildSqlAiContext('SELECT 1', ['t'], cols);
        const match = result.match(/-- Columns: (.+)\n/);
        const listed = match?.[1].split(', ') ?? [];
        expect(listed.length).toBeLessThanOrEqual(20);
    });

    it('handles empty SQL', () => {
        expect(() => buildSqlAiContext('', [], [])).not.toThrow();
    });
});

describe('buildPlotAiContext', () => {
    it('prepends column hint when columns are provided', () => {
        const result = buildPlotAiContext('TABLE(', ['cause', 'duration']);
        expect(result).toContain('-- columns: cause, duration');
        expect(result).toContain('TABLE(');
    });

    it('places plot config after the column hint', () => {
        const plot = 'LINE_CHART(x: ';
        const result = buildPlotAiContext(plot, ['ts']);
        expect(result.endsWith(plot)).toBe(true);
    });

    it('omits column hint when column names are empty', () => {
        const result = buildPlotAiContext('TABLE()', []);
        expect(result).not.toContain('-- columns');
        expect(result).toBe('TABLE()');
    });

    it('caps column names at 20', () => {
        const cols = Array.from({ length: 25 }, (_, i) => `c${i}`);
        const result = buildPlotAiContext('TABLE(', cols);
        const match = result.match(/-- columns: (.+)\n/);
        const listed = match?.[1].split(', ') ?? [];
        expect(listed.length).toBeLessThanOrEqual(20);
    });
});
