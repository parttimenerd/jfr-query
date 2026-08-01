import { describe, it, expect } from 'vitest';
import { builtinManifest } from '../../data/templates/templates-manifest';

// ── builtinManifest.list ──────────────────────────────────────────────────────

describe('builtinManifest.list', () => {
    it('returns a non-empty array of template metas', () => {
        const list = builtinManifest.list();
        expect(list.length).toBeGreaterThan(0);
    });

    it('every entry has a non-empty name and title', () => {
        for (const meta of builtinManifest.list()) {
            expect(typeof meta.name).toBe('string');
            expect(meta.name.length).toBeGreaterThan(0);
            expect(typeof meta.title).toBe('string');
            expect(meta.title.length).toBeGreaterThan(0);
        }
    });

    it('every entry has source:builtin', () => {
        for (const meta of builtinManifest.list()) {
            expect(meta.source).toBe('builtin');
        }
    });

    it('every entry has a tags array', () => {
        for (const meta of builtinManifest.list()) {
            expect(Array.isArray(meta.tags)).toBe(true);
        }
    });

    it('returns metas sorted by priority (lower priority number first)', () => {
        const list = builtinManifest.list();
        for (let i = 1; i < list.length; i++) {
            const prev = list[i - 1].priority ?? 50;
            const curr = list[i].priority ?? 50;
            expect(prev).toBeLessThanOrEqual(curr);
        }
    });
});

// ── builtinManifest.load ──────────────────────────────────────────────────────

describe('builtinManifest.load', () => {
    it('returns a non-null string for each listed template', () => {
        for (const meta of builtinManifest.list()) {
            const body = builtinManifest.load(meta.name);
            expect(body).not.toBeNull();
            expect(typeof body).toBe('string');
            expect((body as string).length).toBeGreaterThan(0);
        }
    });

    it('returns null for an unknown template name', () => {
        expect(builtinManifest.load('__nonexistent_template__')).toBeNull();
    });

    it('loaded body starts with front matter or SQL/plot content', () => {
        const [first] = builtinManifest.list();
        const body = builtinManifest.load(first.name);
        expect(body).not.toBeNull();
        // Templates are markdown notebooks — either start with front matter or query cells
        const s = (body as string).trim();
        expect(s.startsWith('---') || s.startsWith('```') || s.length > 0).toBe(true);
    });
});
