/**
 * Bundles built-in templates into the frontend so WASM-mode users (no
 * server, hence no /api/templates) can still browse the gallery.
 *
 * Vite's `import.meta.glob` with `{ query: '?raw', import: 'default', eager: true }`
 * inlines the .md file contents as strings at build time.
 */

export interface TemplateMeta {
    name: string;
    title: string;
    description: string | null;
    tags: string[];
    source: 'builtin' | 'user';
    license: string | null;
    priority?: number;
}
// Vite-resolved at build time; in vitest (node env) this still resolves
// because vite-node handles glob.
const rawFiles = import.meta.glob('./builtin/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

function parseFrontMatter(body: string, fallbackName: string): TemplateMeta {
    const fm = body.match(/^---\s*\n([\s\S]*?)\n---/);
    let title = fallbackName;
    let description: string | null = null;
    let tags: string[] = [];
    let license: string | null = null;
    let priority = 50;
    if (fm) {
        for (const raw of fm[1].split('\n')) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            const colon = line.indexOf(':');
            if (colon < 0) continue;
            const key = line.slice(0, colon).trim();
            let value = line.slice(colon + 1).trim();
            value = value.replace(/^['"]|['"]$/g, '');
            switch (key) {
                case 'title': title = value; break;
                case 'description': description = value; break;
                case 'license': license = value; break;
                case 'tags': {
                    if (value.startsWith('[') && value.endsWith(']')) {
                        tags = value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
                    }
                    break;
                }
                case 'priority': priority = parseInt(value, 10) || 50; break;
                default: break;
            }
        }
    }
    return { name: fallbackName, title, description, tags, source: 'builtin', license, priority };
}

const entries: { meta: TemplateMeta; body: string }[] = Object.entries(rawFiles).map(([path, body]) => {
    const filename = path.split('/').pop() ?? path;
    const name = filename.replace(/\.md$/, '');
    return { meta: parseFrontMatter(body, name), body };
}).sort((a, b) => (a.meta.priority ?? 50) - (b.meta.priority ?? 50) || a.meta.name.localeCompare(b.meta.name));

export const builtinManifest = {
    list(): TemplateMeta[] {
        return entries.map(e => e.meta);
    },
    load(name: string): string | null {
        const found = entries.find(e => e.meta.name === name);
        return found ? found.body : null;
    },
};
