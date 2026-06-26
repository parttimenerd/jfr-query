import { parseNotebook, reconstructNotebook } from './notebookParser';
import type { NotebookMetadata, CustomView, CustomMacro } from '../types';

export type InsertMode = 'replace' | 'append' | 'insert';

export interface MergeResult {
    notebookSource: string;
    /** Collisions surfaced as warnings; UI may show toasts. */
    warnings: string[];
}

/**
 * Merge a template's markdown source into an existing notebook.
 *
 * - `replace`: discard existing; return the template untouched (front-matter from template wins).
 * - `append`:  union front-matter (current wins on collision); body becomes current + `\n\n---\n\n` + template body.
 *              Cell names that already exist in the current notebook are suffixed `-2`, `-3`, …
 * - `insert`:  same as append but inserts at the given cell index in the current body.
 *              `insertAtIndex` is 0-based among `---`-separated cells.
 */
export function mergeTemplate(
    currentSource: string,
    templateSource: string,
    mode: InsertMode,
    insertAtIndex?: number,
): MergeResult {
    if (mode === 'replace') {
        return { notebookSource: templateSource, warnings: [] };
    }

    const current = parseNotebook(currentSource);
    const template = parseNotebook(templateSource);
    const warnings: string[] = [];

    // Collect existing cell handles for collision detection.
    const existingHandles = collectCellHandles(current.content);
    const renameMap = new Map<string, string>();
    const templateBody = renameCollidingCells(template.content, existingHandles, renameMap, warnings);

    // Union front-matter, current wins on collisions.
    const mergedMeta: NotebookMetadata = {
        ...current.metadata,
        // For each map-shape field, union current ∪ template with current overriding.
        views: unionByName(current.metadata.views ?? [], template.metadata.views ?? [], 'view', warnings),
        macros: unionByName(current.metadata.macros ?? [], template.metadata.macros ?? [], 'macro', warnings),
        variables: unionMap(current.metadata.variables ?? {}, template.metadata.variables ?? {}, 'variable', warnings),
        cellConditions: rekeyAndUnion(
            current.metadata.cellConditions ?? {},
            template.metadata.cellConditions ?? {},
            renameMap,
            warnings,
        ),
    };

    let mergedBody: string;
    if (mode === 'append') {
        mergedBody = `${current.content.trim()}\n\n---\n\n${templateBody.trim()}\n`;
    } else {
        const cells = current.content.split(/\n\n---\n\n/);
        const idx = clamp(insertAtIndex ?? cells.length, 0, cells.length);
        const before = cells.slice(0, idx).join('\n\n---\n\n');
        const after = cells.slice(idx).join('\n\n---\n\n');
        const parts: string[] = [];
        if (before.trim()) parts.push(before.trim());
        parts.push(templateBody.trim());
        if (after.trim()) parts.push(after.trim());
        mergedBody = parts.join('\n\n---\n\n') + '\n';
    }

    const notebookSource = reconstructNotebook({ metadata: mergedMeta, content: mergedBody });
    return { notebookSource, warnings };
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

function collectCellHandles(content: string): Set<string> {
    const result = new Set<string>();
    const cells = content.split(/\n\n---\n\n/);
    cells.forEach((cell, idx) => {
        const m = cell.match(/<!--\s*@cell\s+([^>]*)-->/);
        if (m) {
            const nameMatch = m[1].match(/name=([\w-]+|"[^"]+")/);
            if (nameMatch) {
                result.add(nameMatch[1].replace(/^"|"$/g, ''));
                return;
            }
        }
        result.add(`cell_${idx + 1}`);
    });
    return result;
}

function renameCollidingCells(
    content: string,
    existing: Set<string>,
    renameMap: Map<string, string>,
    warnings: string[],
): string {
    const cells = content.split(/\n\n---\n\n/);
    const renamed = cells.map(cell => {
        return cell.replace(/(<!--\s*@cell\s+[^>]*name=)([\w-]+|"[^"]+")([^>]*-->)/, (_full, p1, p2, p3) => {
            const raw = p2.replace(/^"|"$/g, '');
            if (!existing.has(raw)) {
                existing.add(raw);
                return `${p1}${p2}${p3}`;
            }
            let suffix = 2;
            while (existing.has(`${raw}-${suffix}`)) suffix++;
            const newName = `${raw}-${suffix}`;
            existing.add(newName);
            renameMap.set(raw, newName);
            warnings.push(`Cell name "${raw}" already exists; renamed to "${newName}".`);
            return `${p1}${newName}${p3}`;
        });
    });
    return renamed.join('\n\n---\n\n');
}

function unionByName<T extends { name: string }>(
    a: T[],
    b: T[],
    kind: string,
    warnings: string[],
): T[] {
    const map = new Map<string, T>();
    for (const v of a) map.set(v.name, v);
    for (const v of b) {
        if (map.has(v.name)) {
            warnings.push(`Kept current ${kind} "${v.name}"; template's version was discarded.`);
            continue;
        }
        map.set(v.name, v);
    }
    return Array.from(map.values());
}

function unionMap(
    a: Record<string, string>,
    b: Record<string, string>,
    kind: string,
    warnings: string[],
): Record<string, string> {
    const out: Record<string, string> = { ...a };
    for (const [k, v] of Object.entries(b)) {
        if (k in out) {
            warnings.push(`Kept current ${kind} "${k}"; template's value was discarded.`);
            continue;
        }
        out[k] = v;
    }
    return out;
}

function rekeyAndUnion(
    current: Record<string, string>,
    template: Record<string, string>,
    renameMap: Map<string, string>,
    warnings: string[],
): Record<string, string> {
    const rekeyed: Record<string, string> = {};
    for (const [k, v] of Object.entries(template)) {
        const newKey = renameMap.get(k) ?? k;
        rekeyed[newKey] = v;
    }
    return unionMap(current, rekeyed, 'cellCondition', warnings);
}

export { collectCellHandles as _collectCellHandles, renameCollidingCells as _renameCollidingCells };
