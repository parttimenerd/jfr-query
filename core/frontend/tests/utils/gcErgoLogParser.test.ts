import { describe, it, expect } from 'vitest';
import { parseGcErgoLog } from '../../utils/gcErgoLogParser';

const SAMPLE = `
[0.004s][debug][gc,ergo,heap] Expand the heap. requested expansion amount: 67108864B expansion amount: 67108864B
[0.299s][debug][gc,ergo     ] GC(0) Running G1 Clear Bitmap with 1 workers for 1 work units.
[0.300s][debug][gc,ergo,heap] GC(0) Attempt heap shrinking (capacity higher than max desired capacity). Capacity: 67108864B occupancy: 4194304B live: 3440560B maximum_desired_capacity: 13981013B (70 %)
[0.324s][debug][gc,ergo,ihop] Request concurrent cycle initiation (occupancy higher than threshold) occupancy: 6291456B allocation request: 524304B threshold: 6606028B (45.00) source: concurrent humongous allocation
[0.324s][debug][gc,ergo     ] Request concurrent cycle initiation (requested by GC cause). GC cause: G1 Humongous Allocation
[0.324s][debug][gc,ergo     ] GC(1) Initiate concurrent cycle (concurrent cycle initiation requested)
[0.324s][debug][gc,ergo,cset] GC(1) No candidates to reclaim.
[0.325s][debug][gc,ergo,refine] GC(1) GC refinement: goal: 18446744073709551615 + 216 / 20.00ms, actual: 108 / 0.05ms,
[0.329s][info ][gc,ergo       ] Attempting full compaction
`.trim();

describe('parseGcErgoLog', () => {
    it('returns one row per gc+ergo line', () => {
        const rows = parseGcErgoLog(SAMPLE);
        expect(rows.length).toBe(9);
    });

    it('parses uptime_s correctly', () => {
        const rows = parseGcErgoLog(SAMPLE);
        expect(rows[0].uptime_s).toBeCloseTo(0.004);
        expect(rows[1].uptime_s).toBeCloseTo(0.299);
    });

    it('parses level correctly', () => {
        const rows = parseGcErgoLog(SAMPLE);
        expect(rows[0].level).toBe('debug');
        expect(rows[8].level).toBe('info');
    });

    it('normalises tag by stripping trailing whitespace', () => {
        const rows = parseGcErgoLog(SAMPLE);
        // "gc,ergo     " should become "gc,ergo"
        expect(rows[1].tag).toBe('gc,ergo');
        expect(rows[0].tag).toBe('gc,ergo,heap');
        expect(rows[3].tag).toBe('gc,ergo,ihop');
        expect(rows[6].tag).toBe('gc,ergo,cset');
        expect(rows[7].tag).toBe('gc,ergo,refine');
    });

    it('extracts gc_id when present', () => {
        const rows = parseGcErgoLog(SAMPLE);
        // row 0: no GC id
        expect(rows[0].gc_id).toBeNull();
        // row 1: GC(0)
        expect(rows[1].gc_id).toBe(0);
        // row 6: GC(1)
        expect(rows[6].gc_id).toBe(1);
    });

    it('stores the message without the GC(N) prefix', () => {
        const rows = parseGcErgoLog(SAMPLE);
        expect(rows[1].message).toBe('Running G1 Clear Bitmap with 1 workers for 1 work units.');
        expect(rows[0].message).toContain('Expand the heap');
    });

    it('ignores non-gc+ergo lines', () => {
        const mixed = `
[0.001s][debug][gc,phases  ] GC(0) Something else
[0.002s][debug][gc,ergo    ] GC(0) Real ergo line
[0.003s][debug][safepoint  ] Something unrelated
`.trim();
        const rows = parseGcErgoLog(mixed);
        expect(rows.length).toBe(1);
        expect(rows[0].tag).toBe('gc,ergo');
    });

    it('returns empty array for empty input', () => {
        expect(parseGcErgoLog('')).toEqual([]);
        expect(parseGcErgoLog('   \n\n   ')).toEqual([]);
    });

    it('handles lines without GC id (pre-GC events)', () => {
        const line = '[0.324s][debug][gc,ergo,ihop] Request concurrent cycle initiation (occupancy higher than threshold) occupancy: 6291456B allocation request: 524304B threshold: 6606028B (45.00) source: concurrent humongous allocation';
        const [row] = parseGcErgoLog(line);
        expect(row.gc_id).toBeNull();
        expect(row.message).toContain('occupancy: 6291456B');
    });

    it('handles large GC IDs', () => {
        const line = '[1.234s][debug][gc,ergo] GC(1234) Some message';
        const [row] = parseGcErgoLog(line);
        expect(row.gc_id).toBe(1234);
    });
});
