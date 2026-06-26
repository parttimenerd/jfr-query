/**
 * Build a dependency DAG from a notebook's cells and topologically sort it.
 *
 * A node is a cell id. An edge A → B means cell A depends on cell B (B must
 * run before A). The graph is computed by:
 *   1. For each cell, extracting alias refs from its SQL (or templating
 *      regions, in later phases).
 *   2. Mapping each ref to the cell that produces that alias.
 *
 * Cycles do not prevent producing a topological order; participating cells
 * are sorted to the END and reported in `cycles`. Callers should treat them
 * as in-error and render appropriate diagnostics.
 */
import { extractReferences } from '../services/templating/dependencies';

export interface GraphCell {
    id: string;
    /** Stable handle (`name` or `cell_<idx>`); see utils/cellHandle.ts. */
    handle: string;
    /** Bare aliases this cell produces (empty if none). */
    producedBareAliases: string[];
    /** SQL fragments this cell references (any combination — concatenated for scanning). */
    referencedSql: string;
}

export interface GraphResult {
    /** Topologically sorted cell ids. Cycle participants are appended last. */
    order: string[];
    /** Adjacency: id → set of cell ids it directly depends on. */
    deps: Map<string, Set<string>>;
    /** Reverse adjacency: id → set of cell ids that depend on it. */
    dependents: Map<string, Set<string>>;
    /** Set of cell ids participating in at least one cycle. */
    cycles: Set<string>;
}

/** Build the dependency graph and produce a topological order. */
export const buildExecutionGraph = (cells: GraphCell[]): GraphResult => {
    // Index alias → producer cell id
    const bareProducer = new Map<string, string>();  // bare alias → cell id
    const qualifiedProducer = new Map<string, string>();  // `handle.alias` → cell id
    for (const c of cells) {
        for (const a of c.producedBareAliases) {
            // First producer wins (matches CellAliasContext shadowing model)
            if (!bareProducer.has(a.toLowerCase())) bareProducer.set(a.toLowerCase(), c.id);
            qualifiedProducer.set(`${c.handle.toLowerCase()}.${a.toLowerCase()}`, c.id);
        }
        // Cell handle alone (no alias) → qualified handle.1
        qualifiedProducer.set(`${c.handle.toLowerCase()}.1`, c.id);
    }

    const deps = new Map<string, Set<string>>();
    const dependents = new Map<string, Set<string>>();
    for (const c of cells) {
        deps.set(c.id, new Set());
        dependents.set(c.id, new Set());
    }

    for (const c of cells) {
        if (!c.referencedSql.trim()) continue;
        const refs = extractReferences(c.referencedSql);
        for (const r of refs) {
            let producer: string | undefined;
            if (r.kind === 'bare') {
                producer = bareProducer.get(r.name.toLowerCase());
            } else if (r.kind === 'qualified') {
                producer = qualifiedProducer.get(`${r.handle.toLowerCase()}.${r.alias.toLowerCase()}`);
            }
            if (producer && producer !== c.id) {
                deps.get(c.id)!.add(producer);
                dependents.get(producer)!.add(c.id);
            }
        }
    }

    // Kahn's algorithm with cycle detection
    const order: string[] = [];
    const remaining = new Map<string, number>();
    for (const c of cells) remaining.set(c.id, deps.get(c.id)!.size);
    const ready: string[] = [];
    for (const [id, n] of remaining) if (n === 0) ready.push(id);

    while (ready.length) {
        const id = ready.shift()!;
        order.push(id);
        for (const dep of dependents.get(id)!) {
            const next = remaining.get(dep)! - 1;
            remaining.set(dep, next);
            if (next === 0) ready.push(dep);
        }
    }

    const cycles = new Set<string>();
    for (const [id, n] of remaining) {
        if (n > 0) {
            cycles.add(id);
            order.push(id);
        }
    }

    return { order, deps, dependents, cycles };
};
