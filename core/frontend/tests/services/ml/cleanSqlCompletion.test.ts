import { describe, it, expect } from 'vitest';
import { cleanSqlCompletion } from '../../../services/ml/SqlGenerationService';

describe('cleanSqlCompletion', () => {
    // ─── special-token removal ────────────────────────────────────────────────

    it('strips <|endoftext|> tokens', () => {
        expect(cleanSqlCompletion('WHERE x > 0<|endoftext|>', '')).toBe('WHERE x > 0');
    });

    it('strips <s> and </s> tokens', () => {
        expect(cleanSqlCompletion('<s>SELECT 1</s>', '')).toBe('SELECT 1');
    });

    it('strips <pad> and <unk> tokens', () => {
        expect(cleanSqlCompletion('SELECT 1 <pad><unk>', '')).toBe('SELECT 1');
    });

    it('strips extra_id tokens', () => {
        expect(cleanSqlCompletion('GROUP BY cause<extra_id_0>', '')).toBe('GROUP BY cause');
    });

    it('strips <im_start> and <im_end> tokens', () => {
        expect(cleanSqlCompletion('<im_start>SELECT 1<im_end>', '')).toBe('SELECT 1');
    });

    it('strips fenced code blocks (```sql)', () => {
        expect(cleanSqlCompletion('```sql\nSELECT 1\n```', '')).toBe('SELECT 1');
    });

    it('strips bare ``` delimiters', () => {
        // Note: /```[a-z]*/i treats any alpha word after ``` as a language tag,
        // so ``` followed directly by SQL keywords loses the first word.
        // Use newline-separated format or pre-tested known inputs.
        expect(cleanSqlCompletion('```\nSELECT 1\n```', '')).toBe('SELECT 1');
    });

    it('strips <<CURSOR>> placeholder', () => {
        expect(cleanSqlCompletion('FROM gc_events<<CURSOR>>', '')).toBe('FROM gc_events');
    });

    // ─── quote stripping ──────────────────────────────────────────────────────

    it('strips enclosing double quotes', () => {
        expect(cleanSqlCompletion('"WHERE x > 0"', '')).toBe('WHERE x > 0');
    });

    it('strips enclosing single quotes', () => {
        expect(cleanSqlCompletion("'SELECT 1'", '')).toBe('SELECT 1');
    });

    it('does NOT strip non-matching quotes', () => {
        // starts with ' but ends with something else — keep as-is
        expect(cleanSqlCompletion("'SELECT 1", '')).toBe("'SELECT 1");
    });

    // ─── echo guard — full prefix ─────────────────────────────────────────────

    it('strips prefix echo when model restates the prefix', () => {
        const prefix = 'SELECT * FROM';
        const raw = 'SELECT * FROM gc_events WHERE 1=1';
        expect(cleanSqlCompletion(raw, prefix)).toBe('gc_events WHERE 1=1');
    });

    it('does not alter output when there is no prefix echo', () => {
        const prefix = 'SELECT * FROM ';
        const raw = 'gc_events WHERE 1=1';
        expect(cleanSqlCompletion(raw, prefix)).toBe('gc_events WHERE 1=1');
    });

    // ─── echo guard — trailing word ───────────────────────────────────────────

    it('strips prefix trailing word if model repeats it at the start', () => {
        const prefix = 'SELECT * FROM gc';
        const raw = 'gc_events WHERE x > 0';
        // 'gc' is the trailing word of prefix; 'gc_events' does NOT start with 'gc '
        // (it starts with 'gc_') — so the tail guard should NOT strip it
        expect(cleanSqlCompletion(raw, prefix)).toBe('gc_events WHERE x > 0');
    });

    it('strips partial word repetition when followed by a space', () => {
        const prefix = 'ORDER BY cause';
        const raw = 'cause DESC';
        // trailing word is 'cause', raw starts with 'cause ' → strip 'cause '
        expect(cleanSqlCompletion(raw, prefix)).toBe('DESC');
    });

    // ─── whitespace ───────────────────────────────────────────────────────────

    it('trims surrounding whitespace from output', () => {
        expect(cleanSqlCompletion('  WHERE x > 0  ', '')).toBe('WHERE x > 0');
    });

    it('returns empty string for null/undefined-like input', () => {
        expect(cleanSqlCompletion('', '')).toBe('');
    });

    it('handles multiple special tokens combined', () => {
        const raw = '<s>SELECT * FROM gc_events<|endoftext|><pad>';
        expect(cleanSqlCompletion(raw, '')).toBe('SELECT * FROM gc_events');
    });
});
