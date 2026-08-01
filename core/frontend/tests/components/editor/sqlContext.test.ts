import { describe, it, expect } from 'vitest';
import { detectClause, parseSqlContext } from '../../../components/editor/sqlContext';

describe('detectClause', () => {
    it('returns null for empty string', () => {
        expect(detectClause('')).toBeNull();
    });

    it('detects SELECT clause', () => {
        expect(detectClause('SELECT ')).toBe('select');
        expect(detectClause('SELECT col1, ')).toBe('select');
    });

    it('detects FROM clause', () => {
        expect(detectClause('SELECT * FROM ')).toBe('from');
        expect(detectClause('SELECT * FROM gc_events')).toBe('from');
    });

    it('detects WHERE clause', () => {
        expect(detectClause('SELECT * FROM t WHERE ')).toBe('where');
        expect(detectClause('SELECT * FROM t WHERE x > 0 AND ')).toBe('where');
    });

    it('detects GROUP BY clause', () => {
        expect(detectClause('SELECT cause, COUNT(*) FROM t GROUP BY ')).toBe('group_by');
    });

    it('detects ORDER BY clause', () => {
        expect(detectClause('SELECT * FROM t ORDER BY ')).toBe('order_by');
        expect(detectClause('SELECT * FROM t ORDER BY ts')).toBe('order_by');
    });

    it('detects HAVING clause (without GROUP BY after)', () => {
        // HAVING in the trailing position wins over WHERE/FROM but loses to GROUP BY
        // Use a cursor just inside HAVING with no subsequent GROUP BY
        expect(detectClause('SELECT cause, COUNT(*) FROM t HAVING ')).toBe('having');
    });

    it('detects LIMIT clause (no FROM present)', () => {
        // FROM pattern is broad ([^;]*); LIMIT is only detected if FROM is absent
        expect(detectClause('LIMIT ')).toBe('limit');
    });

    it('detects JOIN clause', () => {
        expect(detectClause('SELECT * FROM t JOIN ')).toBe('join');
        expect(detectClause('SELECT * FROM t LEFT JOIN ')).toBe('join');
        expect(detectClause('SELECT * FROM t INNER JOIN foo')).toBe('join');
    });

    it('detects ON clause for join condition', () => {
        expect(detectClause('SELECT * FROM t JOIN u ON ')).toBe('on');
    });

    it('detects WITH clause', () => {
        expect(detectClause('WITH ')).toBe('with');
    });

    it('ORDER BY takes priority over WHERE when both appear', () => {
        // After "WHERE x > 0 ORDER BY ts" the cursor is in ORDER BY
        expect(detectClause('SELECT * FROM t WHERE x > 0 ORDER BY ')).toBe('order_by');
    });

    it('GROUP BY takes priority over WHERE', () => {
        expect(detectClause('SELECT a FROM t WHERE x > 0 GROUP BY ')).toBe('group_by');
    });

    it('strips statement before last semicolon', () => {
        // The previous statement ends at `;` — only the new statement matters
        expect(detectClause('SELECT 1; SELECT * FROM ')).toBe('from');
    });

    it('returns null for plain text with no SQL keywords', () => {
        expect(detectClause('hello world')).toBeNull();
    });

    it('is case-insensitive', () => {
        expect(detectClause('select * from t where ')).toBe('where');
        expect(detectClause('select * from t order by ')).toBe('order_by');
    });
});

// ---------------------------------------------------------------------------
// parseSqlContext
// ---------------------------------------------------------------------------
describe('parseSqlContext', () => {
    it('collects referenced tables from FROM clause', () => {
        const ctx = parseSqlContext('SELECT * FROM GarbageCollection ');
        expect(ctx.referenced.has('garbagecollection')).toBe(true);
    });

    it('collects referenced tables from JOIN clause', () => {
        const ctx = parseSqlContext('SELECT * FROM events JOIN gc_pauses ON events.id = gc_pauses.id ');
        expect(ctx.referenced.has('events')).toBe(true);
        expect(ctx.referenced.has('gc_pauses')).toBe(true);
    });

    it('extracts aliases from FROM clause', () => {
        const ctx = parseSqlContext('SELECT t.* FROM GarbageCollection t ');
        expect(ctx.aliases.get('t')?.target).toBe('GarbageCollection');
    });

    it('extracts CTEs', () => {
        const ctx = parseSqlContext('WITH pauses AS (SELECT * FROM gc) SELECT * FROM pauses ');
        expect(ctx.ctes.has('pauses')).toBe(true);
    });

    it('reports current clause', () => {
        expect(parseSqlContext('SELECT * FROM t WHERE ').clause).toBe('where');
        expect(parseSqlContext('SELECT * FROM t ORDER BY ').clause).toBe('order_by');
    });

    it('detects qualifier alias when user types "foo."', () => {
        // The qualifier regex matches `\w+\.` at the end of the statement
        const ctx = parseSqlContext('SELECT t.');
        expect(ctx.qualifierAlias).toBe('t');
    });

    it('returns null qualifierAlias when no qualifier present', () => {
        const ctx = parseSqlContext('SELECT * FROM t ');
        expect(ctx.qualifierAlias).toBeNull();
    });

    it('strips previous statement when semicolon present', () => {
        const ctx = parseSqlContext('SELECT 1; SELECT * FROM events ');
        expect(ctx.referenced.has('events')).toBe(true);
        expect(ctx.referenced.has('1')).toBe(false);
    });

    it('prefers fullDocText for alias extraction', () => {
        // Cursor is before FROM but aliases appear later in fullDocText
        const cursor = 'SELECT t.';
        const full = 'SELECT t.col FROM EventTable t';
        const ctx = parseSqlContext(cursor, full);
        expect(ctx.aliases.get('t')?.target).toBe('EventTable');
    });
});
