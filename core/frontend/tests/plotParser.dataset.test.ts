import { describe, it, expect } from 'vitest';
import { parsePlotCall } from '../utils/plotParser';

describe('parsePlotCall — DATASET clause', () => {
    it('parses `DATASET <name>` into the dataset field', () => {
        const r = parsePlotCall('LINE_CHART(x: "t", y: "v") DATASET gc_pauses');
        expect(r.dataset).toBe('gc_pauses');
        expect(r.mainConfig).toBe('LINE_CHART(x: "t", y: "v")');
    });

    it('parses a qualified dataset (cell_3.gc_pauses)', () => {
        const r = parsePlotCall('LINE_CHART(x: "t") DATASET cell_3.gc_pauses');
        expect(r.dataset).toBe('cell_3.gc_pauses');
    });

    it('parses a hyphenated dataset (my-handle.alias)', () => {
        const r = parsePlotCall('LINE_CHART(x: "t") DATASET my-handle.alias');
        expect(r.dataset).toBe('my-handle.alias');
    });

    it('leaves dataset undefined when not present', () => {
        const r = parsePlotCall('LINE_CHART(x: "t")');
        expect(r.dataset).toBeUndefined();
    });

    it('DATASET coexists with other clauses', () => {
        const r = parsePlotCall('LINE_CHART(x: "t") WIDTH 500px DATASET gc_pauses TITLE "Pauses"');
        expect(r.dataset).toBe('gc_pauses');
        expect(r.width).toBe('500px');
        expect(r.title).toBe('Pauses');
    });
});
