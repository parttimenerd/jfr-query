import { describe, it, expect } from 'vitest';
import { mergeDatasets } from '../components/PlotRenderer';

describe('mergeDatasets', () => {
    it('returns single dataset unchanged (no __source)', () => {
        const data = [{ ts: 1, v: 10 }, { ts: 2, v: 20 }];
        const result = mergeDatasets([{ ref: 'only', data }]);
        expect(result).toHaveLength(2);
        expect(result[0].__source).toBeUndefined();
    });

    it('merges two datasets with __source discriminator', () => {
        const a = [{ ts: 1, v: 10 }, { ts: 2, v: 20 }];
        const b = [{ ts: 3, v: 30 }];
        const result = mergeDatasets([
            { ref: 'p50', data: a },
            { ref: 'p99', data: b },
        ]);
        expect(result).toHaveLength(3);
        expect(result[0].__source).toBe('p50');
        expect(result[1].__source).toBe('p50');
        expect(result[2].__source).toBe('p99');
    });

    it('returns empty array for empty sources', () => {
        expect(mergeDatasets([])).toHaveLength(0);
    });

    it('preserves all original row fields', () => {
        const data = [{ x: 1, y: 2, z: 3 }];
        const result = mergeDatasets([{ ref: 'q1', data }, { ref: 'q2', data }]);
        expect(result[0]).toMatchObject({ x: 1, y: 2, z: 3, __source: 'q1' });
        expect(result[1]).toMatchObject({ x: 1, y: 2, z: 3, __source: 'q2' });
    });
});
