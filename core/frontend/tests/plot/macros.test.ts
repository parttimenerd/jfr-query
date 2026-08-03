import { describe, it, expect } from 'vitest';
import { BUILTIN_MACROS_SQL, CONDITIONAL_VIEWS_SQL } from '../../data/builtinSql';

describe('BUILTIN_MACROS_SQL — P-family completeness', () => {
    it('defines P50', () => {
        expect(BUILTIN_MACROS_SQL.some(s => s.includes('MACRO P50'))).toBe(true);
    });
    it('defines P25', () => {
        expect(BUILTIN_MACROS_SQL.some(s => s.includes('MACRO P25'))).toBe(true);
    });
    it('defines P75', () => {
        expect(BUILTIN_MACROS_SQL.some(s => s.includes('MACRO P75'))).toBe(true);
    });
    it('P50 uses quantile 0.50', () => {
        const sql = BUILTIN_MACROS_SQL.find(s => s.includes('MACRO P50'))!;
        expect(sql).toContain('0.50');
    });
    it('P25 uses quantile 0.25', () => {
        const sql = BUILTIN_MACROS_SQL.find(s => s.includes('MACRO P25'))!;
        expect(sql).toContain('0.25');
    });
    it('P75 uses quantile 0.75', () => {
        const sql = BUILTIN_MACROS_SQL.find(s => s.includes('MACRO P75'))!;
        expect(sql).toContain('0.75');
    });
});

describe('BUILTIN_MACROS_SQL — bucket_time', () => {
    it('defines bucket_time', () => {
        expect(BUILTIN_MACROS_SQL.some(s => s.includes('MACRO bucket_time'))).toBe(true);
    });
    it('bucket_time uses epoch_ms twice (round-trip to TIMESTAMP)', () => {
        const sql = BUILTIN_MACROS_SQL.find(s => s.includes('MACRO bucket_time'))!;
        const matches = (sql.match(/epoch_ms/g) || []).length;
        expect(matches).toBeGreaterThanOrEqual(2);
    });
});

describe('BUILTIN_MACROS_SQL — format_rate', () => {
    it('defines format_rate', () => {
        expect(BUILTIN_MACROS_SQL.some(s => s.includes('MACRO format_rate'))).toBe(true);
    });
    it('format_rate handles GB/s, MB/s, KB/s, B/s tiers', () => {
        const sql = BUILTIN_MACROS_SQL.find(s => s.includes('MACRO format_rate'))!;
        expect(sql).toContain('GB/s');
        expect(sql).toContain('MB/s');
        expect(sql).toContain('KB/s');
        expect(sql).toContain('B/s');
    });
});

describe('BUILTIN_MACROS_SQL — reclaim_mb', () => {
    it('defines reclaim_mb', () => {
        expect(BUILTIN_MACROS_SQL.some(s => s.includes('MACRO reclaim_mb'))).toBe(true);
    });
    it('reclaim_mb divides by 1048576', () => {
        const sql = BUILTIN_MACROS_SQL.find(s => s.includes('MACRO reclaim_mb'))!;
        expect(sql).toContain('1048576');
    });
    it('reclaim_mb calls HEAP_BEFORE_GC and HEAP_AFTER_GC', () => {
        const sql = BUILTIN_MACROS_SQL.find(s => s.includes('MACRO reclaim_mb'))!;
        expect(sql).toContain('HEAP_BEFORE_GC');
        expect(sql).toContain('HEAP_AFTER_GC');
    });
});

describe('CONDITIONAL_VIEWS_SQL — new GC views', () => {
    const findView = (name: string) =>
        CONDITIONAL_VIEWS_SQL.find(e => {
            const sql = typeof e === 'string' ? e : (e as any).sql ?? '';
            return sql.includes(`"${name}"`);
        });

    it('defines metaspace-over-time view', () => {
        expect(findView('metaspace-over-time')).toBeDefined();
    });
    it('metaspace-over-time requires MetaspaceSummary', () => {
        const entry = CONDITIONAL_VIEWS_SQL.find(e => {
            const sql = typeof e === 'string' ? e : (e as any).sql ?? '';
            return sql.includes('"metaspace-over-time"');
        }) as any;
        expect(entry?.requires).toBe('MetaspaceSummary');
    });
    it('defines g1-heap-regions view', () => {
        expect(findView('g1-heap-regions')).toBeDefined();
    });
    it('g1-heap-regions requires G1HeapSummary', () => {
        const entry = CONDITIONAL_VIEWS_SQL.find(e => {
            const sql = typeof e === 'string' ? e : (e as any).sql ?? '';
            return sql.includes('"g1-heap-regions"');
        }) as any;
        expect(entry?.requires).toBe('G1HeapSummary');
    });
    it('defines tenuring-distribution view', () => {
        expect(findView('tenuring-distribution')).toBeDefined();
    });
    it('tenuring-distribution requires TenuringDistribution', () => {
        const entry = CONDITIONAL_VIEWS_SQL.find(e => {
            const sql = typeof e === 'string' ? e : (e as any).sql ?? '';
            return sql.includes('"tenuring-distribution"');
        }) as any;
        expect(entry?.requires).toBe('TenuringDistribution');
    });
});
