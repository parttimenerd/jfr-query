import { describe, it, expect } from 'vitest';
import { filterSuggestionBySchema } from '../../components/editor/aiAutocomplete/columnValidation';

const schema = [
    { name: 'ts', type: 'TIMESTAMP' },
    { name: 'duration', type: 'BIGINT' },
    { name: 'thread', type: 'VARCHAR' },
];

describe('filterSuggestionBySchema', () => {
    it('returns suggestion unchanged when all column refs are in schema', () => {
        const s = `LINE_CHART(x: "ts", y: "duration")`;
        expect(filterSuggestionBySchema(s, schema)).toBe(s);
    });

    it('returns empty string when suggestion contains an unknown column ref', () => {
        const s = `LINE_CHART(x: "ts", y: "cpu_usage")`;
        expect(filterSuggestionBySchema(s, schema)).toBe('');
    });

    it('allows DSL keywords even if not in schema', () => {
        const s = `LINE_CHART(x: "ts", y: "duration") TITLE "test"`;
        expect(filterSuggestionBySchema(s, schema)).toBe(s);
    });

    it('returns suggestion unchanged when schema is null (no validation possible)', () => {
        const s = `LINE_CHART(x: "ts", y: "unknown")`;
        expect(filterSuggestionBySchema(s, null)).toBe(s);
    });

    it('returns suggestion unchanged when schema is empty', () => {
        const s = `LINE_CHART(x: "ts", y: "something")`;
        expect(filterSuggestionBySchema(s, [])).toBe(s);
    });

    it('matches column names case-insensitively', () => {
        const s = `LINE_CHART(x: "TS", y: "DURATION")`;
        const mixedSchema = [{ name: 'ts', type: 'TIMESTAMP' }, { name: 'duration', type: 'BIGINT' }];
        expect(filterSuggestionBySchema(s, mixedSchema)).toBe(s);
    });

    it('returns empty string for an empty suggestion', () => {
        expect(filterSuggestionBySchema('', schema)).toBe('');
    });

    it('does not reject color names used as parameter values', () => {
        const s = `LINE_CHART(x: "ts", y: "duration") COLOR "red"`;
        expect(filterSuggestionBySchema(s, schema)).toBe(s);
    });

    it('rejects suggestion when a param value is an unknown column name', () => {
        const s = `LINE_CHART(x: "ts", y: "bogus_col")`;
        expect(filterSuggestionBySchema(s, schema)).toBe('');
    });
});
