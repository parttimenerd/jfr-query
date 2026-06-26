// Tests for jsonExtract.ts — the resilience layer between local LLM output
// and our typed return values. Small quantized models violate "return only
// JSON" in many creative ways; this suite locks in the recoveries.

import { describe, it, expect } from 'vitest';
import { extractJson, extractText, stripReasoningBlocks } from '../../services/ai/jsonExtract';
import { cleanPlotConfig } from '../../services/ml/candidates';

describe('stripReasoningBlocks', () => {
    it('strips a balanced <think>…</think> block', () => {
        const raw = '<think>let me think about this</think>The answer is 42';
        expect(stripReasoningBlocks(raw)).toBe('The answer is 42');
    });

    it('strips a <thinking>…</thinking> block', () => {
        const raw = 'Prefix <thinking>reasoning</thinking> suffix';
        expect(stripReasoningBlocks(raw)).toBe('Prefix  suffix');
    });

    it('strips multiple think blocks', () => {
        const raw = '<think>a</think>B<think>c</think>D';
        expect(stripReasoningBlocks(raw)).toBe('BD');
    });

    it('strips an unclosed <think> block at the end', () => {
        const raw = 'Real answer here<think>this is unfinished CoT...';
        expect(stripReasoningBlocks(raw)).toBe('Real answer here');
    });

    it('is case-insensitive', () => {
        expect(stripReasoningBlocks('<THINK>x</THINK>y')).toBe('y');
    });

    it('passes through input with no reasoning block', () => {
        expect(stripReasoningBlocks('plain text')).toBe('plain text');
        expect(stripReasoningBlocks('')).toBe('');
    });
});

describe('extractJson — recovers JSON from messy local LLM output', () => {
    it('parses well-formed JSON directly', () => {
        expect(extractJson<{ x: number }>('{"x":1}')).toEqual({ x: 1 });
    });

    it('strips a <think>…</think> preamble before the JSON', () => {
        const raw = '<think>I should return JSON</think>\n{"text":"hi","code":null}';
        expect(extractJson<{ text: string; code: null }>(raw)).toEqual({ text: 'hi', code: null });
    });

    it('strips ```json fences', () => {
        const raw = '```json\n{"text":"x","code":null}\n```';
        expect(extractJson<{ text: string }>(raw)).toEqual({ text: 'x', code: null });
    });

    it('strips ```jsonc fences with comments inside', () => {
        const raw = '```jsonc\n{\n  // a comment\n  "text": "x",\n  "code": null\n}\n```';
        expect(extractJson<{ text: string }>(raw)).toEqual({ text: 'x', code: null });
    });

    it('slices a JSON object out of surrounding prose', () => {
        const raw = 'Here is the JSON you asked for: {"text":"hi","code":null} Let me know if you need more.';
        expect(extractJson<{ text: string }>(raw)).toEqual({ text: 'hi', code: null });
    });

    it('handles JSON with trailing commas', () => {
        const raw = '{"text":"hi","code":null,}';
        expect(extractJson<{ text: string }>(raw)).toEqual({ text: 'hi', code: null });
    });

    it('handles JSON with // line comments', () => {
        const raw = '{\n  "text": "hi", // explanation\n  "code": null\n}';
        expect(extractJson<{ text: string }>(raw)).toEqual({ text: 'hi', code: null });
    });

    it('handles JSON with /* block * / comments', () => {
        const raw = '{ /* leading note */ "text": "hi", "code": null }';
        expect(extractJson<{ text: string }>(raw)).toEqual({ text: 'hi', code: null });
    });

    it('converts single-quoted JSON when no double quotes are present', () => {
        const raw = "{'text': 'hi', 'code': null}";
        expect(extractJson<{ text: string }>(raw)).toEqual({ text: 'hi', code: null });
    });

    it('normalises smart quotes from markdown rendering', () => {
        const raw = '{“text”: “hi”, “code”: null}';
        expect(extractJson<{ text: string }>(raw)).toEqual({ text: 'hi', code: null });
    });

    it('handles JSON arrays', () => {
        expect(extractJson<number[]>('[1,2,3]')).toEqual([1, 2, 3]);
        expect(extractJson<number[]>('Prefix [1,2,3] suffix')).toEqual([1, 2, 3]);
    });

    it('handles nested JSON with string-literal braces', () => {
        // The substring `{not-json}` is inside a string — must not be picked
        // up as the start of a balanced object.
        const raw = '{"text":"foo {not-json}","code":null}';
        expect(extractJson<{ text: string }>(raw)).toEqual({ text: 'foo {not-json}', code: null });
    });

    it('throws on empty input', () => {
        expect(() => extractJson('')).toThrow(/Empty response/);
    });

    it('throws a useful error on unrecoverable garbage', () => {
        expect(() => extractJson('this is not json at all'))
            .toThrow(/Could not parse LLM response as JSON/);
    });

    it('survives a Qwen3 reasoning preamble with a fenced JSON body', () => {
        const raw = '<think>The user wants a SQL completion.\nLet me write valid JSON.</think>\n\n```json\n{"text":"SELECT * FROM gc","code":"SELECT * FROM gc"}\n```';
        expect(extractJson<{ text: string; code: string }>(raw))
            .toEqual({ text: 'SELECT * FROM gc', code: 'SELECT * FROM gc' });
    });
});

describe('extractText — clean plain-text extraction', () => {
    it('strips <think>…</think> before the answer', () => {
        expect(extractText('<think>reasoning</think>TABLE()')).toBe('TABLE()');
    });

    it('returns content inside a ``` fence', () => {
        expect(extractText('```sql\nSELECT 1\n```')).toBe('SELECT 1');
    });

    it('strips HF special tokens', () => {
        expect(extractText('SELECT 1<|endoftext|>')).toBe('SELECT 1');
        expect(extractText('<pad>SELECT 1</s>')).toBe('SELECT 1');
    });

    it('trims whitespace', () => {
        expect(extractText('   SELECT 1   ')).toBe('SELECT 1');
    });

    it('returns empty string for empty / whitespace-only input', () => {
        expect(extractText('')).toBe('');
        expect(extractText('   ')).toBe('');
    });

    it('survives a Qwen3 reasoning preamble around a fenced answer', () => {
        const raw = '<think>let me think</think>\n```\nSELECT * FROM gc\n```';
        expect(extractText(raw)).toBe('SELECT * FROM gc');
    });
});

describe('cleanPlotConfig — strips chain-of-thought before recovering plot', () => {
    it('strips <think>…</think> from Qwen3 output', () => {
        const raw = '<think>I should suggest a line chart</think>LINE_CHART(x: "ts", y: ["cpu"])';
        expect(cleanPlotConfig(raw)).toBe('LINE_CHART(x: "ts", y: ["cpu"])');
    });

    it('strips an unclosed <think> block at end (truncated CoT)', () => {
        const raw = 'BAR_CHART(x: "host", y: ["count"])<think>maybe I should ad';
        expect(cleanPlotConfig(raw)).toBe('BAR_CHART(x: "host", y: ["count"])');
    });

    it('strips <think> combined with markdown fences', () => {
        const raw = '<think>reasoning</think>```\nHISTOGRAM(value: "pauseMs")\n```';
        expect(cleanPlotConfig(raw)).toBe('HISTOGRAM(value: "pauseMs")');
    });
});
