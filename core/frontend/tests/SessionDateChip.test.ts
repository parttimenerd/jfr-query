// Unit tests for the SessionDateChip helpers — clamp/format behavior.
// We avoid a full React render test (the project doesn't depend on @testing-library
// or jsdom) and instead exercise the pure helpers extracted from the component.

import { describe, it, expect } from 'vitest';
import {
    epochMsToLocalIso,
    localIsoToEpochMs,
    clampIso,
    computeSessionVariables,
} from '../components/SessionDateChip';

describe('SessionDateChip — epochMsToLocalIso', () => {
    it('returns empty string for null/undefined/NaN', () => {
        expect(epochMsToLocalIso(null)).toBe('');
        expect(epochMsToLocalIso(undefined)).toBe('');
        expect(epochMsToLocalIso(NaN)).toBe('');
    });

    it('formats an epoch-ms as YYYY-MM-DDTHH:mm in local time', () => {
        const ms = new Date(2024, 5, 15, 14, 30).getTime(); // Jun 15 2024 14:30 local
        expect(epochMsToLocalIso(ms)).toBe('2024-06-15T14:30');
    });

    it('zero-pads month/day/hour/minute', () => {
        const ms = new Date(2024, 0, 3, 4, 5).getTime(); // Jan 3 2024 04:05 local
        expect(epochMsToLocalIso(ms)).toBe('2024-01-03T04:05');
    });
});

describe('SessionDateChip — localIsoToEpochMs', () => {
    it('returns null on empty string', () => {
        expect(localIsoToEpochMs('')).toBeNull();
    });

    it('returns null on garbage input', () => {
        expect(localIsoToEpochMs('not a date')).toBeNull();
    });

    it('round-trips with epochMsToLocalIso', () => {
        const original = new Date(2024, 5, 15, 14, 30).getTime();
        const iso = epochMsToLocalIso(original);
        expect(localIsoToEpochMs(iso)).toBe(original);
    });
});

describe('SessionDateChip — clampIso', () => {
    const min = new Date(2024, 0, 1, 0, 0).getTime();
    const max = new Date(2024, 11, 31, 23, 59).getTime();

    it('passes through values inside the range', () => {
        const iso = '2024-06-15T14:30';
        expect(clampIso(iso, min, max)).toBe(iso);
    });

    it('clamps values below min up to min', () => {
        const iso = '2023-06-15T14:30';
        expect(clampIso(iso, min, max)).toBe(epochMsToLocalIso(min));
    });

    it('clamps values above max down to max', () => {
        const iso = '2025-06-15T14:30';
        expect(clampIso(iso, min, max)).toBe(epochMsToLocalIso(max));
    });

    it('is a no-op when min/max are nullish', () => {
        const iso = '2024-06-15T14:30';
        expect(clampIso(iso, null, null)).toBe(iso);
        expect(clampIso(iso, undefined, undefined)).toBe(iso);
    });

    it('applies only the relevant bound when one side is nullish', () => {
        const iso = '2023-06-15T14:30';
        expect(clampIso(iso, min, null)).toBe(epochMsToLocalIso(min));
        expect(clampIso(iso, null, max)).toBe(iso); // below max but no floor
    });

    it('returns the input unchanged when the input is invalid', () => {
        expect(clampIso('', min, max)).toBe('');
        expect(clampIso('garbage', min, max)).toBe('garbage');
    });
});

describe('computeSessionVariables', () => {
    const recordingStart = new Date(2024, 0, 1, 8, 0).getTime();  // 2024-01-01T08:00
    const recordingEnd   = new Date(2024, 0, 1, 18, 0).getTime(); // 2024-01-01T18:00

    it('returns unchanged map (same reference) when both vars are already set', () => {
        const vars = {
            '$session_start': '2024-01-01T08:00',
            '$session_end':   '2024-01-01T18:00',
        };
        expect(computeSessionVariables(vars, recordingStart, recordingEnd)).toBe(vars);
    });

    it('seeds both session_start and session_end when both are empty and range is known', () => {
        const vars = {};
        const result = computeSessionVariables(vars, recordingStart, recordingEnd);
        expect(result).not.toBe(vars);
        expect(result['$session_start']).toBe(epochMsToLocalIso(recordingStart));
        expect(result['$session_end']).toBe(epochMsToLocalIso(recordingEnd));
    });

    it('seeds only the empty variable when one is already set', () => {
        const existingEnd = '2024-01-01T12:00';
        const vars = { '$session_end': existingEnd };
        const result = computeSessionVariables(vars, recordingStart, recordingEnd);
        expect(result['$session_start']).toBe(epochMsToLocalIso(recordingStart));
        expect(result['$session_end']).toBe(existingEnd); // unchanged
    });

    it('returns unchanged map (same reference) when recording range is null (DB not loaded)', () => {
        const vars = {};
        expect(computeSessionVariables(vars, null, null)).toBe(vars);
        // When both bounds are null there is nothing to seed
        expect(computeSessionVariables(vars, undefined, undefined)).toBe(vars);
    });
});
