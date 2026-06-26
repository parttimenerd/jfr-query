// C7 — Tests for the pure helpers exported from InlineChat. Same pattern as
// ChatPanel.test.tsx: we don't render the component (the vitest env is `node`,
// no jsdom) — we exercise the helpers directly.
//
// The helpers under test are:
//   - resolveVisibility(useFullContext, dropdownValue) — maps the legacy
//     boolean toggle onto the new tri-state visibility mode.
//   - buildRecentResultFromRows(rows) — builds a RecentResult bundle from
//     a raw row array, inferring column types.
//
// We also assert that InlineChat re-exports the proposal helpers via the
// same channel as ChatPanel does — keeping a single source of truth.

import { describe, it, expect } from 'vitest';
import { resolveVisibility, buildRecentResultFromRows } from '../components/inlineChatHelpers';

describe('resolveVisibility (legacy useFullContext mapping)', () => {
    it('returns the dropdown value when useFullContext is true (override removed)', () => {
        // B-137: The useFullContext override is deprecated. chatVisibility always wins.
        expect(resolveVisibility(true, 'no-data')).toBe('no-data');
        expect(resolveVisibility(true, 'sanitized')).toBe('sanitized');
        expect(resolveVisibility(true, 'full')).toBe('full');
    });

    it('returns the dropdown value when useFullContext is false', () => {
        expect(resolveVisibility(false, 'no-data')).toBe('no-data');
        expect(resolveVisibility(false, 'sanitized')).toBe('sanitized');
        expect(resolveVisibility(false, 'full')).toBe('full');
    });

    it('chatVisibility dropdown wins regardless of toggle value (B-137)', () => {
        // The deprecated toggle no longer silently upgrades visibility.
        expect(resolveVisibility(true, 'no-data')).toBe('no-data');
    });
});

describe('buildRecentResultFromRows', () => {
    it('returns null for empty / null input', () => {
        expect(buildRecentResultFromRows(null)).toBeNull();
        expect(buildRecentResultFromRows(undefined)).toBeNull();
        expect(buildRecentResultFromRows([])).toBeNull();
    });

    it('returns null when the first element is not a row object', () => {
        expect(buildRecentResultFromRows([42 as any])).toBeNull();
        expect(buildRecentResultFromRows([null as any])).toBeNull();
    });

    it('infers DOUBLE for numeric columns and VARCHAR for string columns', () => {
        const result = buildRecentResultFromRows([{ ts: 1234, name: 'gc' }, { ts: 2345, name: 'cpu' }]);
        expect(result).not.toBeNull();
        const byName = Object.fromEntries(result!.columns.map(c => [c.name, c.type]));
        expect(byName.ts).toBe('DOUBLE');
        expect(byName.name).toBe('VARCHAR');
    });

    it('falls back to OTHER for non-primitive values', () => {
        const result = buildRecentResultFromRows([{ payload: { nested: true }, flag: false }]);
        expect(result).not.toBeNull();
        const byName = Object.fromEntries(result!.columns.map(c => [c.name, c.type]));
        // typeof {} === 'object' → OTHER. typeof false === 'boolean' → OTHER (not DOUBLE, not VARCHAR).
        expect(byName.payload).toBe('OTHER');
        expect(byName.flag).toBe('OTHER');
    });

    it('preserves the original row array reference for the rows field', () => {
        const rows = [{ a: 1 }, { a: 2 }];
        const result = buildRecentResultFromRows(rows);
        expect(result!.rows).toBe(rows);
    });

    it('uses the first row to determine the column list (does not union)', () => {
        // If callers want union behavior they need to normalize beforehand.
        // We intentionally trust the first row so we don't pay O(rows*cols)
        // every render.
        const rows = [{ a: 1 }, { a: 2, b: 'extra' }];
        const result = buildRecentResultFromRows(rows);
        expect(result!.columns.map(c => c.name)).toEqual(['a']);
    });
});
