import { describe, it, expect } from 'vitest';
import { cleanPlotConfig } from '../../../services/ml/candidates';

describe('cleanPlotConfig', () => {
    // ─── basic pass-through ──────────────────────────────────────────────────

    it('returns a clean TABLE() call unchanged', () => {
        expect(cleanPlotConfig('TABLE()')).toBe('TABLE()');
    });

    it('returns LINE_CHART with params unchanged', () => {
        expect(cleanPlotConfig('LINE_CHART(x: "time", y: "count")')).toBe('LINE_CHART(x: "time", y: "count")');
    });

    it('trims surrounding whitespace', () => {
        expect(cleanPlotConfig('  TABLE()  ')).toBe('TABLE()');
    });

    // ─── fallback to TABLE() ─────────────────────────────────────────────────

    it('returns TABLE() for empty string', () => {
        expect(cleanPlotConfig('')).toBe('TABLE()');
    });

    it('returns TABLE() when no known plot name is present', () => {
        expect(cleanPlotConfig('some random text')).toBe('TABLE()');
    });

    it('returns TABLE() when parens are unclosed', () => {
        expect(cleanPlotConfig('LINE_CHART(x: "t"')).toBe('TABLE()');
    });

    it('returns TABLE() when plot name has no opening paren', () => {
        expect(cleanPlotConfig('TABLE')).toBe('TABLE()');
    });

    // ─── special token stripping ──────────────────────────────────────────────

    it('strips <|endoftext|>', () => {
        const result = cleanPlotConfig('TABLE()<|endoftext|>');
        expect(result).toBe('TABLE()');
    });

    it('strips <|im_start|> and <|im_end|>', () => {
        const result = cleanPlotConfig('<|im_start|>TABLE()<|im_end|>');
        expect(result).toBe('TABLE()');
    });

    it('strips <s> and </s>', () => {
        const result = cleanPlotConfig('<s>TABLE()</s>');
        expect(result).toBe('TABLE()');
    });

    it('strips <pad>', () => {
        const result = cleanPlotConfig('TABLE()<pad>');
        expect(result).toBe('TABLE()');
    });

    // ─── markdown fence stripping ─────────────────────────────────────────────

    it('strips markdown code fence', () => {
        const result = cleanPlotConfig('```plot\nTABLE()\n```');
        expect(result).toBe('TABLE()');
    });

    it('strips plain triple-backtick fence', () => {
        const result = cleanPlotConfig('```\nTABLE()\n```');
        expect(result).toBe('TABLE()');
    });

    // ─── chain-of-thought (CoT) stripping ────────────────────────────────────

    it('strips <think> block', () => {
        const result = cleanPlotConfig('<think>Some reasoning</think>TABLE()');
        expect(result).toBe('TABLE()');
    });

    it('strips <thinking> block', () => {
        const result = cleanPlotConfig('<thinking>long reasoning</thinking>\nTABLE()');
        expect(result).toBe('TABLE()');
    });

    it('strips unclosed <think> block to end of string', () => {
        const result = cleanPlotConfig('<think>incomplete reasoning');
        expect(result).toBe('TABLE()');
    });

    // ─── quote stripping ──────────────────────────────────────────────────────

    it('strips enclosing double quotes', () => {
        expect(cleanPlotConfig('"TABLE()"')).toBe('TABLE()');
    });

    it('strips enclosing single quotes', () => {
        expect(cleanPlotConfig("'TABLE()'")).toBe('TABLE()');
    });

    it('strips enclosing backticks', () => {
        expect(cleanPlotConfig('`TABLE()`')).toBe('TABLE()');
    });

    // ─── preamble stripping ───────────────────────────────────────────────────

    it('strips leading prose before plot name', () => {
        const result = cleanPlotConfig('Here is the config: TABLE()');
        expect(result).toBe('TABLE()');
    });

    it('strips leading prose before LINE_CHART', () => {
        const result = cleanPlotConfig('Output: LINE_CHART(x: "t")');
        expect(result).toBe('LINE_CHART(x: "t")');
    });

    // ─── tail modifier preservation ───────────────────────────────────────────

    it('preserves DATASET modifier', () => {
        const result = cleanPlotConfig('TABLE() DATASET GarbageCollection');
        expect(result).toContain('DATASET');
    });

    it('preserves TITLE modifier', () => {
        const result = cleanPlotConfig('TABLE() TITLE "My Title"');
        expect(result).toContain('TITLE');
    });

    it('strips trailing prose after closing paren', () => {
        // "more text here" is not a recognised modifier — it should be dropped
        const result = cleanPlotConfig('TABLE() more text here');
        expect(result).toBe('TABLE()');
    });

    // ─── nested parens ────────────────────────────────────────────────────────

    it('handles nested parens inside params', () => {
        const result = cleanPlotConfig('LINE_CHART(x: func("a"))');
        expect(result).toBe('LINE_CHART(x: func("a"))');
    });

    // ─── case-insensitive plot name detection ─────────────────────────────────

    it('recognises lowercase plot names', () => {
        const result = cleanPlotConfig('table()');
        expect(result.toUpperCase()).toContain('TABLE');
    });
});
