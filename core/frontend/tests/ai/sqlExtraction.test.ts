import { describe, it, expect } from 'vitest';
import { extractPrefix, extractSchema } from '../../services/ai/browserSqlRules';
import { cleanSqlCompletion } from '../../services/ml/SqlGenerationService';

describe('browserSqlRules — extractPrefix', () => {
    it('returns text before <<CURSOR>>', () => {
        const prompt = '# Current cell — text before cursor\nSELECT * FROM <<CURSOR>>events';
        expect(extractPrefix(prompt)).toBe('SELECT * FROM ');
    });

    it('returns null when no cursor marker', () => {
        expect(extractPrefix('# Current cell — text before cursor\nSELECT *')).toBeNull();
    });

    it('returns null when no current-cell section', () => {
        expect(extractPrefix('# Schema\nTABLES:\n- "events"')).toBeNull();
    });

    it('handles multi-line prefix', () => {
        const prompt = '# Current cell — text before cursor\nSELECT\n  *\nFROM <<CURSOR>>';
        expect(extractPrefix(prompt)).toBe('SELECT\n  *\nFROM ');
    });
});

describe('browserSqlRules — extractSchema', () => {
    it('parses a single table with typed columns', () => {
        const prompt = '# Schema\nTABLES:\n- "events": ("ts" TIMESTAMP, "host" VARCHAR, "cpu" DOUBLE)\n\n# Current cell — text before cursor\nSELECT <<CURSOR>>';
        const tables = extractSchema(prompt);
        expect(tables).toEqual([{
            name: 'events',
            columns: [
                { name: 'ts', type: 'TIMESTAMP' },
                { name: 'host', type: 'VARCHAR' },
                { name: 'cpu', type: 'DOUBLE' },
            ],
        }]);
    });

    it('parses multiple tables', () => {
        const prompt = '# Schema\nTABLES:\n- "events": ("ts" TIMESTAMP)\n- "requests": ("ts" TIMESTAMP, "status" INTEGER)\n\n# Current cell — text before cursor\n<<CURSOR>>';
        const tables = extractSchema(prompt);
        expect(tables.map(t => t.name)).toEqual(['events', 'requests']);
        expect(tables[1].columns).toEqual([
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'status', type: 'INTEGER' },
        ]);
    });

    it('returns empty array when no schema block', () => {
        expect(extractSchema('# Current cell — text before cursor\n<<CURSOR>>')).toEqual([]);
    });

    it('returns empty array on malformed schema', () => {
        // No table lines match the regex.
        expect(extractSchema('# Schema\nTABLES:\nfoo bar\n\n# Current')).toEqual([]);
    });
});

describe('SqlGenerationService — cleanSqlCompletion', () => {
    it('strips <<CURSOR>> markers', () => {
        expect(cleanSqlCompletion('foo <<CURSOR>> bar', '')).toBe('foo  bar');
    });

    it('strips markdown fences', () => {
        expect(cleanSqlCompletion('```sql\nFROM events\n```', '')).toBe('FROM events');
    });

    it('strips HF special tokens', () => {
        expect(cleanSqlCompletion('<pad>FROM events</s>', '')).toBe('FROM events');
    });

    it('echo-guards full prefix repetition', () => {
        const prefix = 'SELECT * FROM ';
        expect(cleanSqlCompletion('SELECT * FROM events', prefix)).toBe('events');
    });

    it('echo-guards trailing-word repetition', () => {
        // Model repeated the last word "FROM" then continued.
        const prefix = 'SELECT * FROM ';
        expect(cleanSqlCompletion('from events', prefix)).toBe('events');
    });

    it('strips wrapping double quotes', () => {
        expect(cleanSqlCompletion('"events"', 'SELECT * FROM ')).toBe('events');
    });

    it('strips wrapping single quotes', () => {
        expect(cleanSqlCompletion("'events'", 'SELECT * FROM ')).toBe('events');
    });

    it('handles empty input', () => {
        expect(cleanSqlCompletion('', 'SELECT ')).toBe('');
    });

    it('preserves valid completions verbatim', () => {
        expect(cleanSqlCompletion('events ORDER BY ts DESC LIMIT 10', 'SELECT * FROM ')).toBe('events ORDER BY ts DESC LIMIT 10');
    });
});
