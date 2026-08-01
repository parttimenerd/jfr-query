import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listTemplates, loadTemplate } from '../../services/TemplateService';

// ── wasm mode (no server) ─────────────────────────────────────────────────────

describe('listTemplates — wasm mode', () => {
    it('returns a non-empty array', async () => {
        const list = await listTemplates({ mode: 'wasm' });
        expect(list.length).toBeGreaterThan(0);
    });

    it('returns built-in metas with name and title', async () => {
        const list = await listTemplates({ mode: 'wasm' });
        for (const meta of list) {
            expect(typeof meta.name).toBe('string');
            expect(meta.name.length).toBeGreaterThan(0);
            expect(typeof meta.title).toBe('string');
            expect(meta.title.length).toBeGreaterThan(0);
        }
    });

    it('returns built-in metas with source:builtin', async () => {
        const list = await listTemplates({ mode: 'wasm' });
        for (const meta of list) {
            expect(meta.source).toBe('builtin');
        }
    });

    it('returns same result for mode:null', async () => {
        const wasm = await listTemplates({ mode: 'wasm' });
        const nullMode = await listTemplates({ mode: null });
        expect(nullMode).toEqual(wasm);
    });
});

// ── loadTemplate — wasm mode ─────────────────────────────────────────────────

describe('loadTemplate — wasm mode', () => {
    it('loads body for each listed template', async () => {
        const list = await listTemplates({ mode: 'wasm' });
        for (const meta of list) {
            const body = await loadTemplate(meta.name, { mode: 'wasm' });
            expect(typeof body).toBe('string');
            expect(body.length).toBeGreaterThan(0);
        }
    });

    it('throws for an unknown template name', async () => {
        await expect(loadTemplate('__no_such_template__', { mode: 'wasm' }))
            .rejects.toThrow('__no_such_template__');
    });

    it('throws for unknown template in null mode too', async () => {
        await expect(loadTemplate('__no_such_template__', { mode: null }))
            .rejects.toThrow();
    });
});

// ── server mode — network success ────────────────────────────────────────────

describe('listTemplates — server mode, network success', () => {
    const mockMetas = [{ name: 'srv-tpl', title: 'Server Template', source: 'builtin' as const, tags: [] }];

    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url === '/api/templates') {
                return { ok: true, json: async () => mockMetas };
            }
            return { ok: false, status: 404 };
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns the server response when fetch succeeds', async () => {
        const list = await listTemplates({ mode: 'server' });
        expect(list).toEqual(mockMetas);
    });
});

describe('loadTemplate — server mode, network success', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.startsWith('/api/templates/')) {
                return { ok: true, text: async () => '# Server Template\n```sql\nSELECT 1\n```' };
            }
            return { ok: false, status: 404 };
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns the server body when fetch succeeds', async () => {
        const body = await loadTemplate('some-template', { mode: 'server' });
        expect(body).toContain('SELECT 1');
    });
});

// ── server mode — network failure fallback ────────────────────────────────────

describe('listTemplates — server mode, network failure fallback', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('Network failure');
        }));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('falls back to built-in templates when /api/templates throws', async () => {
        const list = await listTemplates({ mode: 'server' });
        expect(list.length).toBeGreaterThan(0);
        for (const meta of list) expect(meta.source).toBe('builtin');
    });
});

describe('loadTemplate — server mode, network failure fallback', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('Network failure');
        }));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('falls back to built-in body when fetch throws', async () => {
        const list = await listTemplates({ mode: 'wasm' });
        const [first] = list;
        const body = await loadTemplate(first.name, { mode: 'server' });
        expect(typeof body).toBe('string');
        expect(body.length).toBeGreaterThan(0);
    });

    it('throws when fallback also lacks the template', async () => {
        await expect(loadTemplate('__no_such_template__', { mode: 'server' }))
            .rejects.toThrow();
    });
});

describe('listTemplates — server mode, non-ok response fallback', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('falls back to built-in templates on non-ok HTTP response', async () => {
        const list = await listTemplates({ mode: 'server' });
        expect(list.length).toBeGreaterThan(0);
    });
});
