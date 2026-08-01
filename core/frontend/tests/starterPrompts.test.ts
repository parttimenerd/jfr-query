import { describe, it, expect } from 'vitest';
import { getDataAwareStarters } from '../utils/starterPrompts';

describe('getDataAwareStarters', () => {
    it('returns the fallback "What\'s in this recording?" when no tables match', () => {
        const starters = getDataAwareStarters([]);
        expect(starters).toHaveLength(1);
        expect(starters[0].label).toContain("What's in this recording?");
    });

    it('matches GC starters by GarbageCollection table name (case-insensitive)', () => {
        const starters = getDataAwareStarters(['GarbageCollection']);
        expect(starters.some(s => s.label.includes('GC pauses'))).toBe(true);
    });

    it('matches GC starters by gcphasepause', () => {
        const starters = getDataAwareStarters(['GCPhasePause']);
        expect(starters.some(s => s.label.includes('GC pauses'))).toBe(true);
    });

    it('matches CPU hotspots by ExecutionSample', () => {
        const starters = getDataAwareStarters(['ExecutionSample']);
        expect(starters.some(s => s.label.includes('CPU hotspots'))).toBe(true);
    });

    it('matches allocation hotspots by ObjectAllocationInNewTLAB', () => {
        const starters = getDataAwareStarters(['ObjectAllocationInNewTLAB']);
        expect(starters.some(s => s.label.includes('Allocation hotspots'))).toBe(true);
    });

    it('matches thread contention by JavaMonitorEnter', () => {
        const starters = getDataAwareStarters(['JavaMonitorEnter']);
        expect(starters.some(s => s.label.includes('Thread contention'))).toBe(true);
    });

    it('matches I/O latency by FileRead', () => {
        const starters = getDataAwareStarters(['FileRead']);
        expect(starters.some(s => s.label.includes('I/O latency'))).toBe(true);
    });

    it('matches I/O latency by SocketWrite', () => {
        const starters = getDataAwareStarters(['SocketWrite', 'ExecutionSample']);
        expect(starters.some(s => s.label.includes('I/O latency'))).toBe(true);
    });

    it('matches memory leaks by OldObjectSample', () => {
        const starters = getDataAwareStarters(['OldObjectSample']);
        expect(starters.some(s => s.label.includes('Memory leaks'))).toBe(true);
    });

    it('caps results at limit=4 by default', () => {
        // All tables present → more than 4 would match, but we cap at 4.
        const tables = [
            'GarbageCollection', 'ExecutionSample',
            'ObjectAllocationInNewTLAB', 'JavaMonitorEnter',
            'FileRead', 'OldObjectSample',
        ];
        const starters = getDataAwareStarters(tables);
        expect(starters.length).toBe(4);
    });

    it('respects a custom limit', () => {
        const tables = ['GarbageCollection', 'ExecutionSample', 'ObjectAllocationInNewTLAB'];
        expect(getDataAwareStarters(tables, 2)).toHaveLength(2);
        expect(getDataAwareStarters(tables, 10)).toHaveLength(4); // only 3 domain + 1 fallback = 4
    });

    it('returns each prompt as a non-empty string', () => {
        const starters = getDataAwareStarters(['ExecutionSample', 'FileRead']);
        for (const s of starters) {
            expect(s.prompt.length).toBeGreaterThan(10);
            expect(s.label.length).toBeGreaterThan(2);
        }
    });

    it('result objects contain only label and prompt keys', () => {
        const starters = getDataAwareStarters(['GarbageCollection']);
        for (const s of starters) {
            expect(Object.keys(s).sort()).toEqual(['label', 'prompt']);
        }
    });
});
