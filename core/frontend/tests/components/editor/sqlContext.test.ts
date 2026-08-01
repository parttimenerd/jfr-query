import { describe, it, expect } from 'vitest';
import { detectClause } from '../../../components/editor/sqlContext';

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
