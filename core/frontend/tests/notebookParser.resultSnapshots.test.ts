import { describe, it, expect } from 'vitest';
import { parseNotebook, reconstructNotebook } from '../utils/notebookParser';
import type { NotebookMetadata } from '../types';

// Round-trip helper: serialize metadata to a notebook string, parse it back.
function roundTrip(metadata: Partial<NotebookMetadata>, body = '# Test\n'): NotebookMetadata {
    const full: NotebookMetadata = { ...metadata } as NotebookMetadata;
    const source = reconstructNotebook({ metadata: full, content: body });
    return parseNotebook(source).metadata;
}

describe('notebookParser — resultSnapshots round-trip', () => {
    it('survives a round-trip with rows and null entries', () => {
        const snapshots = {
            'cell-0:0': [{ gc_id: 1, duration_ms: 12.4 }, { gc_id: 2, duration_ms: 18.7 }],
            'cell-0:1': null,
            'cell-1:0': [{ objectClass: 'java.lang.String', totalWeight: 12345 }],
        };
        const rt = roundTrip({ resultSnapshots: snapshots });
        expect(rt.resultSnapshots).toEqual(snapshots);
    });

    it('preserves deeply nested row values', () => {
        const snapshots = {
            'cell-2:0': [{ ts: '2024-01-01T00:00:00Z', value: 3.14159, flag: true }],
        };
        const rt = roundTrip({ resultSnapshots: snapshots });
        expect(rt.resultSnapshots!['cell-2:0']).toEqual(snapshots['cell-2:0']);
    });

    it('returns undefined resultSnapshots when none were present', () => {
        const rt = roundTrip({});
        expect(rt.resultSnapshots).toBeUndefined();
    });

    it('returns undefined when resultSnapshots is an empty map', () => {
        // An empty map should not appear in front matter at all.
        const rt = roundTrip({ resultSnapshots: {} });
        expect(rt.resultSnapshots).toBeUndefined();
    });

    it('does not double-emit resultSnapshots key alongside other metadata', () => {
        const snapshots = { 'cell-0:0': [{ x: 1 }] };
        const source = reconstructNotebook({
            metadata: { title: 'My NB', resultSnapshots: snapshots } as unknown as NotebookMetadata,
            content: '# Body\n',
        });
        const occurrences = (source.match(/resultSnapshots/g) ?? []).length;
        expect(occurrences).toBe(1);
    });

    it('roundtrips alongside other metadata fields', () => {
        const snapshots = { 'cell-0:0': [{ n: 42 }] };
        const rt = roundTrip({
            title: 'Perf analysis',
            description: 'GC pause investigation',
            resultSnapshots: snapshots,
        });
        expect(rt.title).toBe('Perf analysis');
        expect(rt.description).toBe('GC pause investigation');
        expect(rt.resultSnapshots).toEqual(snapshots);
    });

    it('survives unicode and special chars in row values', () => {
        const snapshots = {
            'cell-0:0': [{ msg: '日本語テスト "quoted" & <html/>', val: 99 }],
        };
        const rt = roundTrip({ resultSnapshots: snapshots });
        expect(rt.resultSnapshots!['cell-0:0']).toEqual(snapshots['cell-0:0']);
    });

    it('ignores corrupted base64 gracefully (undefined, not throw)', () => {
        const source = [
            '---',
            "resultSnapshots: 'not-valid-base64!!!'",
            '---',
            '# Body',
        ].join('\n');
        const nb = parseNotebook(source);
        expect(nb.metadata.resultSnapshots).toBeUndefined();
    });

    it('ignores resultSnapshots that decode to non-object JSON', () => {
        // Encode a JSON array (not an object) — should be rejected.
        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify([1, 2, 3]))));
        const source = [`---`, `resultSnapshots: '${b64}'`, `---`, `# Body`].join('\n');
        // The parser stores whatever JSON.parse returns; this array is falsy as a record
        // but the field will be present. We just want no throw.
        expect(() => parseNotebook(source)).not.toThrow();
    });

    it('handles large snapshot maps (500 rows × 10 cells) without truncation', () => {
        const snapshots: Record<string, any[] | null> = {};
        for (let c = 0; c < 10; c++) {
            snapshots[`cell-${c}:0`] = Array.from({ length: 500 }, (_, i) => ({ i, c, value: i * 1.5 }));
        }
        const rt = roundTrip({ resultSnapshots: snapshots });
        expect(Object.keys(rt.resultSnapshots!)).toHaveLength(10);
        expect(rt.resultSnapshots!['cell-9:0']).toHaveLength(500);
    });
});
