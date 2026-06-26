import { describe, it, expect } from 'vitest';
import { suggestNaiveSql } from '../../services/ai/browserSqlRules';

// Mirror the prompt format produced by aiAutocomplete/contextBuilder.ts.
function buildPrompt(opts: {
    tables?: { name: string; cols: { name: string; type: string }[] }[];
    resultCols?: { name: string; type: string }[];
    prefix: string;
    after?: string;
}): string {
    const sections: string[] = [];
    if (opts.tables && opts.tables.length > 0) {
        const lines = opts.tables.map(t => {
            const cols = t.cols.map(c => `"${c.name}" ${c.type}`).join(', ');
            return `- "${t.name}": (${cols})`;
        }).join('\n');
        sections.push(`# Schema\nTABLES:\n${lines}`);
    }
    if (opts.resultCols && opts.resultCols.length > 0) {
        const cols = opts.resultCols.map(c => `"${c.name}" ${c.type}`).join(', ');
        sections.push(`# Current cell result columns\n${cols}`);
    }
    sections.push(
        `# Current cell — text before cursor\n${opts.prefix}<<CURSOR>>${opts.after ?? ''}`,
    );
    return sections.join('\n\n');
}

describe('browserSqlRules — suggestNaiveSql', () => {
    const events = {
        name: 'events',
        cols: [{ name: 'ts', type: 'TIMESTAMP' }, { name: 'host', type: 'VARCHAR' }, { name: 'cpu', type: 'DOUBLE' }],
    };
    const requests = {
        name: 'requests',
        cols: [{ name: 'ts', type: 'TIMESTAMP' }, { name: 'status_code', type: 'INTEGER' }],
    };

    it('SELECT-list opener: suggests first result column', () => {
        const out = suggestNaiveSql(buildPrompt({
            tables: [events],
            resultCols: [{ name: 'ts', type: 'TIMESTAMP' }, { name: 'host', type: 'VARCHAR' }],
            prefix: 'SELECT ',
        }));
        expect(out).toBe('"ts"');
    });

    it('SELECT comma: suggests second result column', () => {
        const out = suggestNaiveSql(buildPrompt({
            resultCols: [{ name: 'ts', type: 'TIMESTAMP' }, { name: 'host', type: 'VARCHAR' }],
            prefix: 'SELECT ts,',
        }));
        expect(out).toBe(' "host"');
    });

    it('FROM: suggests first schema table', () => {
        const out = suggestNaiveSql(buildPrompt({
            tables: [events, requests],
            prefix: 'SELECT * FROM ',
        }));
        expect(out).toBe('events');
    });

    it('WHERE after identifier: suggests `= `', () => {
        const out = suggestNaiveSql(buildPrompt({
            tables: [events],
            resultCols: [{ name: 'ts', type: 'TIMESTAMP' }],
            prefix: 'SELECT * FROM events WHERE host ',
        }));
        expect(out).toBe('= ');
    });

    it('ORDER BY: suggests first result column', () => {
        const out = suggestNaiveSql(buildPrompt({
            resultCols: [{ name: 'ts', type: 'TIMESTAMP' }, { name: 'host', type: 'VARCHAR' }],
            prefix: 'SELECT * FROM events ORDER BY ',
        }));
        expect(out).toBe('"ts"');
    });

    it('GROUP BY: suggests first result column', () => {
        const out = suggestNaiveSql(buildPrompt({
            resultCols: [{ name: 'host', type: 'VARCHAR' }],
            prefix: 'SELECT host, count(*) FROM events GROUP BY ',
        }));
        expect(out).toBe('"host"');
    });

    it('JOIN: suggests first schema table', () => {
        const out = suggestNaiveSql(buildPrompt({
            tables: [events, requests],
            prefix: 'SELECT * FROM events JOIN ',
        }));
        expect(out).toBe('events');
    });

    it('empty prompt section returns null', () => {
        expect(suggestNaiveSql('# Current cell — text before cursor\n<<CURSOR>>')).toBeNull();
    });

    it('no schema and no result-cols returns null', () => {
        expect(suggestNaiveSql(buildPrompt({ prefix: 'SELECT ' }))).toBeNull();
    });

    it('falls back to `*` when no result cols but tables present', () => {
        const out = suggestNaiveSql(buildPrompt({
            tables: [events],
            prefix: 'SELECT ',
        }));
        expect(out).toBe('*');
    });

    it('missing cursor marker returns null', () => {
        expect(suggestNaiveSql('# Current cell — text before cursor\nSELECT * FROM ')).toBeNull();
    });

    it('subquery prefix — still produces a column suggestion at the inner SELECT', () => {
        const out = suggestNaiveSql(buildPrompt({
            tables: [events, requests],
            resultCols: [{ name: 'host', type: 'VARCHAR' }],
            prefix: 'SELECT * FROM events WHERE host IN (SELECT ',
        }));
        expect(out).toBe('"host"');
    });

    it('mid-identifier (no trailing space) returns null', () => {
        // Rules only fire after whitespace or comma — partial identifiers
        // are the sync provider's responsibility.
        const out = suggestNaiveSql(buildPrompt({
            tables: [events],
            prefix: 'SELECT * FROM ev',
        }));
        expect(out).toBeNull();
    });
});
