/**
 * Bundles built-in skills into the frontend so WASM-mode users (no server,
 * hence no /api/skills) can still browse and activate skills.
 *
 * Mirrors the pattern of templates-manifest.ts exactly.
 */

import { parseSkillFrontMatter, parseFullSkill, type SkillMeta, type ParsedSkill } from '../../utils/skillParser';

const rawFiles = import.meta.glob('./builtin/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

const entries: { meta: SkillMeta; raw: string; name: string }[] = Object.entries(rawFiles).map(([path, raw]) => {
    const filename = path.split('/').pop() ?? path;
    const name = filename.replace(/\.md$/, '');
    const meta = parseSkillFrontMatter(raw, name);
    return { meta, raw, name };
}).sort((a, b) => a.name.localeCompare(b.name));

export const builtinSkillManifest = {
    list(): SkillMeta[] {
        return entries.map(e => e.meta);
    },
    load(name: string): ParsedSkill | null {
        const found = entries.find(e => e.name === name);
        return found ? parseFullSkill(found.raw, found.name) : null;
    },
};
