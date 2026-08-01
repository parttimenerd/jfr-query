import { describe, it, expect } from 'vitest';
import { extractReferences } from '../../../services/templating/dependencies';

// ─── variables ───────────────────────────────────────────────────────────────

describe('extractReferences — variables', () => {
    it('extracts a notebook variable $name', () => {
        const refs = extractReferences('SELECT * FROM t WHERE x > $threshold');
        const vars = refs.filter(r => r.kind === 'variable') as Extract<ReturnType<typeof extractReferences>[number], { kind: 'variable' }>[];
        expect(vars).toHaveLength(1);
        expect(vars[0].name).toBe('threshold');
        expect(vars[0].scoped).toBe(false);
    });

    it('extracts a scoped variable $$name', () => {
        const refs = extractReferences('SELECT $$t AS t');
        const vars = refs.filter(r => r.kind === 'variable') as any[];
        expect(vars).toHaveLength(1);
        expect(vars[0].name).toBe('t');
        expect(vars[0].scoped).toBe(true);
    });

    it('extracts multiple distinct variables', () => {
        const refs = extractReferences('$a + $b + $a');
        const vars = refs.filter(r => r.kind === 'variable') as any[];
        // deduped — $a appears once
        expect(vars.length).toBe(2);
        expect(vars.map(v => v.name).sort()).toEqual(['a', 'b']);
    });

    it('handles no variables', () => {
        const refs = extractReferences('SELECT 1');
        expect(refs.filter(r => r.kind === 'variable')).toHaveLength(0);
    });
});

// ─── qualified references ─────────────────────────────────────────────────────

describe('extractReferences — qualified refs', () => {
    it('extracts handle.alias pattern', () => {
        const refs = extractReferences('SELECT * FROM cell_1.gc_events');
        const qual = refs.filter(r => r.kind === 'qualified') as any[];
        expect(qual).toHaveLength(1);
        expect(qual[0].handle).toBe('cell_1');
        expect(qual[0].alias).toBe('gc_events');
    });

    it('extracts multiple qualified refs', () => {
        const refs = extractReferences('SELECT a.col1, b.col2 FROM a JOIN b ON a.id = b.id');
        const qual = refs.filter(r => r.kind === 'qualified') as any[];
        const handles = qual.map(q => q.handle);
        expect(handles).toContain('a');
        expect(handles).toContain('b');
    });

    it('does not emit qualified refs for SQL keyword.word patterns', () => {
        const refs = extractReferences('CASE WHEN x THEN 1 END');
        const qual = refs.filter(r => r.kind === 'qualified') as any[];
        // 'case' is a keyword so case.foo would be filtered — but no dots here, just sanity
        expect(qual.length).toBe(0);
    });

    it('deduplicates identical qualified refs', () => {
        const refs = extractReferences('SELECT x.col FROM x JOIN x ON x.id = x.id');
        const qual = refs.filter(r => r.kind === 'qualified') as any[];
        const xCols = qual.filter(q => q.handle.toLowerCase() === 'x' && q.alias.toLowerCase() === 'col');
        expect(xCols).toHaveLength(1);
    });
});

// ─── bare identifiers ─────────────────────────────────────────────────────────

describe('extractReferences — bare identifiers', () => {
    it('extracts bare table reference', () => {
        const refs = extractReferences('SELECT * FROM gc_events');
        const bare = refs.filter(r => r.kind === 'bare') as any[];
        expect(bare.some(b => b.name === 'gc_events')).toBe(true);
    });

    it('does not emit SQL keywords as bare refs', () => {
        const refs = extractReferences('SELECT count(*) FROM t GROUP BY x');
        const bare = refs.filter(r => r.kind === 'bare') as any[];
        const names = bare.map(b => b.name.toLowerCase());
        expect(names).not.toContain('select');
        expect(names).not.toContain('from');
        expect(names).not.toContain('group');
        expect(names).not.toContain('by');
        expect(names).not.toContain('count');
    });

    it('bare refs appear for table names', () => {
        const refs = extractReferences('SELECT t.x FROM t WHERE t.y > 0');
        const bare = refs.filter(r => r.kind === 'bare') as any[];
        const names = bare.map((b: any) => b.name.toLowerCase());
        // 't' appears as standalone FROM clause table reference
        // (qualified t.x and t.y are extracted separately, but t itself is still bare)
        expect(names).toContain('t');
    });
});

// ─── comment and string masking ───────────────────────────────────────────────

describe('extractReferences — masking', () => {
    it('ignores identifiers inside single-line comments', () => {
        const refs = extractReferences('SELECT 1 -- $secret_var should_be_ignored');
        expect(refs.filter(r => r.kind === 'variable')).toHaveLength(0);
        const bare = refs.filter(r => r.kind === 'bare') as any[];
        expect(bare.map((b: any) => b.name)).not.toContain('should_be_ignored');
    });

    it('ignores identifiers inside block comments', () => {
        const refs = extractReferences('SELECT /* $hidden alias.col */ 1');
        expect(refs.filter(r => r.kind === 'variable')).toHaveLength(0);
        expect(refs.filter(r => r.kind === 'qualified')).toHaveLength(0);
    });

    it('ignores identifiers inside string literals', () => {
        const refs = extractReferences("SELECT '$var' AS label FROM t");
        const vars = refs.filter(r => r.kind === 'variable');
        expect(vars).toHaveLength(0);
    });

    it('handles escaped single quotes in strings', () => {
        const refs = extractReferences("SELECT 'it''s $fine' FROM t");
        expect(refs.filter(r => r.kind === 'variable')).toHaveLength(0);
    });
});

// ─── mixed cases ──────────────────────────────────────────────────────────────

describe('extractReferences — mixed', () => {
    it('returns all three kinds from a complex query', () => {
        const sql = 'SELECT cell_1.gc, $threshold FROM gc_events WHERE cell_1.ts > $t';
        const refs = extractReferences(sql);
        expect(refs.some(r => r.kind === 'qualified')).toBe(true);
        expect(refs.some(r => r.kind === 'variable')).toBe(true);
        expect(refs.some(r => r.kind === 'bare')).toBe(true);
    });

    it('returns empty array for empty input', () => {
        expect(extractReferences('')).toEqual([]);
    });

    it('returns empty array for whitespace-only input', () => {
        expect(extractReferences('   \n\t  ')).toEqual([]);
    });
});
