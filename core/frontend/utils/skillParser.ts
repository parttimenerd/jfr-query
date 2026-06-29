/**
 * Skill parser: front-matter extraction + body section splitting for skill .md files.
 *
 * Skill files follow the same YAML front-matter pattern as templates, with these extras:
 *   - `commands:` — a YAML sequence of { name, description, cells[] } objects
 *   - `icon:` — optional emoji / short string
 *   - `templates:` — optional list of template names the skill can reference
 *
 * The body after the front-matter has two named H2 sections:
 *   ## System Prompt   — injected into the AI system prompt when the skill is active
 *   ## Cells           — contains skill-cell blocks delimited by <!-- @skill-cell name=... -->
 */

export interface SkillCommand {
    name: string;
    description: string;
    /** Cell names (keys in ParsedSkill.cells) to insert when this command runs. */
    cells: string[];
    /** Template names (from builtinManifest) to insert when this command runs. */
    templates?: string[];
}

export interface SkillMeta {
    /** File stem, e.g. "gc-analysis". Used as the slash command name. */
    name: string;
    title: string;
    description: string | null;
    tags: string[];
    commands: SkillCommand[];
    source: 'builtin' | 'user';
    license: string | null;
    icon?: string;
    /** Template names this skill can reference (optional). */
    templates?: string[];
}

export interface ParsedSkill {
    meta: SkillMeta;
    /** Markdown text injected into the AI system prompt when the skill is active. */
    systemPrompt: string;
    /** Skill cell name → raw markdown content (the block between @skill-cell markers). */
    cells: Map<string, string>;
    raw: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Minimal inline YAML sequence parser for the `commands:` block.
 * Only handles the fixed two-level schema (list of objects with scalar/array values).
 * Returns [] on any parse failure so callers always get a valid array.
 */
function parseCommandsBlock(yamlSection: string): SkillCommand[] {
    const lines = yamlSection.split('\n');
    const commands: SkillCommand[] = [];
    let current: Partial<SkillCommand> | null = null;

    for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line.trim()) continue;

        // New list item
        if (/^\s{2}-\s+name:/.test(line)) {
            if (current?.name) {
                commands.push({
                    name: current.name,
                    description: current.description ?? '',
                    cells: current.cells ?? [],
                    templates: current.templates ?? [],
                });
            }
            current = { name: extractScalar(line, 'name'), cells: [], templates: [] };
            continue;
        }

        if (!current) continue;

        if (/^\s{4}description:/.test(line)) {
            current.description = extractScalar(line, 'description');
        } else if (/^\s{4}cells:/.test(line)) {
            current.cells = parseInlineArray(line);
        } else if (/^\s{4}templates:/.test(line)) {
            current.templates = parseInlineArray(line);
        }
    }

    if (current?.name) {
        commands.push({
            name: current.name,
            description: current.description ?? '',
            cells: current.cells ?? [],
            templates: current.templates ?? [],
        });
    }

    return commands;
}

function extractScalar(line: string, key: string): string {
    const m = new RegExp(`${key}:\\s*(.*)$`).exec(line);
    if (!m) return '';
    return m[1].trim().replace(/^['"]|['"]$/g, '');
}

function parseInlineArray(line: string): string[] {
    // Matches: cells: [foo, bar, baz]
    const m = /\[([^\]]*)\]/.exec(line);
    if (!m) return [];
    return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseSkillFrontMatter(raw: string, fallbackName: string): SkillMeta {
    const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    let title = fallbackName;
    let description: string | null = null;
    let tags: string[] = [];
    let license: string | null = null;
    let icon: string | undefined;
    let templates: string[] = [];
    let commands: SkillCommand[] = [];

    if (fmMatch) {
        const fm = fmMatch[1];
        // Find the commands: block (multi-line YAML list)
        const commandsMatch = fm.match(/^(commands:\s*\n(?:[ \t]+.*\n?)*)/m);
        if (commandsMatch) {
            commands = parseCommandsBlock(commandsMatch[1]);
        }
        // Find the templates: block
        const templatesLineMatch = fm.match(/^templates:\s*\[([^\]]*)\]/m);
        if (templatesLineMatch) {
            templates = templatesLineMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
        }

        for (const rawLine of fm.split('\n')) {
            const line = rawLine.trimEnd();
            if (!line.trim() || line.startsWith('#') || line.startsWith('-')) continue;
            // Skip multi-line block keys (commands:, templates:) and their indented children
            if (/^(commands|templates):/.test(line)) continue;
            // Skip indented lines (they belong to nested YAML blocks like commands)
            if (/^\s+/.test(line)) continue;
            const colon = line.indexOf(':');
            if (colon < 0) continue;
            const key = line.trim().slice(0, line.trim().indexOf(':')).trim();
            let value = line.trim().slice(line.trim().indexOf(':') + 1).trim().replace(/^['"]|['"]$/g, '');
            switch (key) {
                case 'title': title = value; break;
                case 'description': description = value || null; break;
                case 'license': license = value || null; break;
                case 'icon': icon = value || undefined; break;
                case 'tags': {
                    if (value.startsWith('[') && value.endsWith(']')) {
                        tags = value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
                    }
                    break;
                }
            }
        }
    }

    return { name: fallbackName, title, description, tags, commands, source: 'builtin', license, icon, templates };
}

export function parseSkillBody(raw: string): { systemPrompt: string; cells: Map<string, string> } {
    // Strip front-matter
    const body = raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');

    // Extract ## System Prompt section
    const sysMatch = body.match(/^## System Prompt\s*\n([\s\S]*?)(?=^## |\z)/m);
    const systemPrompt = sysMatch ? sysMatch[1].trim() : '';

    // Extract ## Cells section
    const cellsMatch = body.match(/^## Cells\s*\n([\s\S]*)$/m);
    const cellsSection = cellsMatch ? cellsMatch[1] : '';

    // Split on <!-- @skill-cell name=<name> --> markers
    const cells = new Map<string, string>();
    const markerRe = /<!--\s*@skill-cell\s+name=([\w-]+)\s*-->\s*\n([\s\S]*?)(?=<!--\s*@skill-cell|$)/g;
    let m: RegExpExecArray | null;
    while ((m = markerRe.exec(cellsSection)) !== null) {
        const cellName = m[1];
        const cellContent = m[2].trim();
        cells.set(cellName, cellContent);
    }

    return { systemPrompt, cells };
}

export function parseFullSkill(raw: string, name: string): ParsedSkill {
    const meta = parseSkillFrontMatter(raw, name);
    const { systemPrompt, cells } = parseSkillBody(raw);
    return { meta, systemPrompt, cells, raw };
}
