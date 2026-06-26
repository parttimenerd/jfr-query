/**
 * Frontend access to the notebook template catalog.
 *
 * In server mode, calls the Javalin endpoints exposed by ServeCommand.
 * In wasm mode, falls back to the bundled built-in manifest — user
 * templates require the server and are unavailable.
 */
import { builtinManifest, type TemplateMeta } from '../data/templates/templates-manifest';

export type { TemplateMeta };

const isServerMode = (): boolean => {
    // Heuristic: if the page is served from a host that exposes /api/status,
    // we're in server mode. The DuckDB context resolves this at runtime;
    // callers pass it in to avoid recomputing.
    return false;
};

export interface TemplateClientOptions {
    mode: 'server' | 'wasm' | null;
}

export async function listTemplates(opts: TemplateClientOptions): Promise<TemplateMeta[]> {
    if (opts.mode === 'server') {
        try {
            const resp = await fetch('/api/templates');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return await resp.json();
        } catch (e) {
            console.warn('Falling back to built-in templates after /api/templates failure:', e);
            return builtinManifest.list();
        }
    }
    return builtinManifest.list();
}

export async function loadTemplate(name: string, opts: TemplateClientOptions): Promise<string> {
    if (opts.mode === 'server') {
        try {
            const resp = await fetch(`/api/templates/${encodeURIComponent(name)}`);
            if (resp.ok) return await resp.text();
        } catch (e) {
            console.warn('Falling back to built-in body after fetch failure:', e);
        }
    }
    const body = builtinManifest.load(name);
    if (body == null) throw new Error(`Template not found: ${name}`);
    return body;
}
