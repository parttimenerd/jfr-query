// C7 — Pure helpers extracted from InlineChat so they can be unit-tested in
// the bare node vitest environment without pulling in the React component
// tree (which transitively imports DuckDB / browser-only modules).
//
// Keep this file dependency-free except for the small AiService types.

import type { VisibilityMode, RecentResult } from '../services/AiService';

/**
 * Map the legacy `useFullContext` boolean to a visibility mode. Previously
 * `useFullContext=true` forced `'full'`, overriding the dropdown selection.
 * That override is now removed: the `chatVisibility` dropdown always wins.
 * The `useFullContext` parameter is kept for backwards-compat but ignored.
 *
 * @deprecated Pass `dropdownValue` directly; the toggle no longer has effect.
 */
export function resolveVisibility(_useFullContext: boolean, dropdownValue: VisibilityMode): VisibilityMode {
    return dropdownValue;
}

/**
 * Build a `RecentResult` bundle from a raw row array. Returns null when the
 * data isn't an array of row objects. Column types are inferred from the
 * first row's values — sufficient for visibility.ts which uses substring
 * matching (`NUMBER` / `STRING` / fallthrough).
 */
export function buildRecentResultFromRows(rows: any[] | null | undefined): RecentResult | null {
    if (!rows || rows.length === 0) return null;
    const first = rows[0];
    if (!first || typeof first !== 'object') return null;
    const columns = Object.keys(first).map(name => ({
        name,
        type: typeof first[name] === 'number' ? 'DOUBLE'
            : typeof first[name] === 'string' ? 'VARCHAR'
            : 'OTHER',
    }));
    return { columns, rows };
}
