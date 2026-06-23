import { describe, it, expect } from 'vitest';
import { extractJson, extractText } from '../services/ai/jsonExtract';

describe('extractJson — well-formed inputs', () => {
    it('parses a clean JSON object', () => {
        expect(extractJson('{"text":"hi","code":null}')).toEqual({ text: 'hi', code: null });
    });

    it('parses a clean JSON array', () => {
        expect(extractJson('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('parses with leading/trailing whitespace', () => {
        expect(extractJson('   {"a":1}\n')).toEqual({ a: 1 });
    });
});

describe('extractJson — markdown-fenced JSON (typical 9B-model output)', () => {
    it('strips ```json fences', () => {
        expect(extractJson('```json\n{"text":"ok"}\n```')).toEqual({ text: 'ok' });
    });

    it('strips ```jsonc fences', () => {
        expect(extractJson('```jsonc\n{"text":"ok"}\n```')).toEqual({ text: 'ok' });
    });

    it('strips bare ``` fences', () => {
        expect(extractJson('```\n{"text":"ok"}\n```')).toEqual({ text: 'ok' });
    });

    it('handles fences with leading model prose', () => {
        const raw = 'Sure, here is the JSON you requested:\n\n```json\n{"text":"ok","code":null}\n```\n';
        expect(extractJson(raw)).toEqual({ text: 'ok', code: null });
    });

    it('handles fences with trailing prose', () => {
        const raw = '```json\n{"x":1}\n```\nLet me know if you need anything else.';
        expect(extractJson(raw)).toEqual({ x: 1 });
    });
});

describe('extractJson — preamble + raw JSON (Qwen3 thinking-mode failure case)', () => {
    it('finds JSON after a chain-of-thought preamble', () => {
        const raw = `<think>\nThe user wants a SQL query. Let me think...\n</think>\n\n{"text":"hello","code":"SELECT 1"}`;
        expect(extractJson(raw)).toEqual({ text: 'hello', code: 'SELECT 1' });
    });

    it('finds JSON after a one-line preamble', () => {
        expect(extractJson('Here is the answer: {"a":42}'))
            .toEqual({ a: 42 });
    });

    it('finds JSON before a trailing explanation', () => {
        const raw = '{"result":"ok"} -- this should work';
        expect(extractJson(raw)).toEqual({ result: 'ok' });
    });

    it('handles preamble + fences + trailing text together', () => {
        const raw = 'Of course! Here you go:\n```json\n{"text":"ok"}\n```\nHope this helps.';
        expect(extractJson(raw)).toEqual({ text: 'ok' });
    });
});

describe('extractJson — string-literal robustness', () => {
    it('does not get fooled by a closing brace inside a string', () => {
        const raw = '{"text":"some } in here","code":null}';
        expect(extractJson(raw)).toEqual({ text: 'some } in here', code: null });
    });

    it('does not get fooled by an opening brace inside a string', () => {
        const raw = 'preamble {"text":"contains { brace","code":"x"}';
        expect(extractJson(raw)).toEqual({ text: 'contains { brace', code: 'x' });
    });

    it('handles escaped quotes', () => {
        const raw = '{"text":"she said \\"hi\\""}';
        expect(extractJson(raw)).toEqual({ text: 'she said "hi"' });
    });

    it('handles backslash-escaped backslashes correctly', () => {
        const raw = '{"text":"a\\\\b"}';
        expect(extractJson(raw)).toEqual({ text: 'a\\b' });
    });
});

describe('extractJson — error paths', () => {
    it('throws on empty input', () => {
        expect(() => extractJson('')).toThrow(/Empty/i);
    });

    it('throws when no JSON object is present', () => {
        expect(() => extractJson('just plain text, no JSON anywhere'))
            .toThrow(/Could not parse/);
    });

    it('throws when JSON is malformed even after slicing', () => {
        // Unmatched brace + invalid syntax
        expect(() => extractJson('{"a": ['))
            .toThrow();
    });

    it('error message includes a sample of the response for debugging', () => {
        try {
            extractJson('this is the response that failed parsing');
        } catch (e: any) {
            expect(e.message).toMatch(/this is the response/);
            return;
        }
        throw new Error('expected extractJson to throw');
    });
});

describe('extractText — stripping fences from plain-text responses', () => {
    it('returns text as-is when no fences', () => {
        expect(extractText('SELECT 1')).toBe('SELECT 1');
    });

    it('strips ```sql fences', () => {
        expect(extractText('```sql\nSELECT 1\n```')).toBe('SELECT 1');
    });

    it('strips ```plot fences', () => {
        expect(extractText('```plot\nLINE_CHART(x: "time")\n```')).toBe('LINE_CHART(x: "time")');
    });

    it('strips bare ``` fences', () => {
        expect(extractText('```\nfoo\n```')).toBe('foo');
    });

    it('trims whitespace', () => {
        expect(extractText('   hello   ')).toBe('hello');
    });

    it('returns empty string for empty input', () => {
        expect(extractText('')).toBe('');
    });
});
