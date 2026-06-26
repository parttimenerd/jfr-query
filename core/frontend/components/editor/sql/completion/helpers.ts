// Helpers shared across completion providers and the dispatcher.

import type { Node, NodeKind, SqlClause } from '../ast';
import { findEnclosingAny, walk } from '../ast';

// Quoted-ident wrap: if `force` is true, always quote; otherwise quote only
// when the name isn't a bare identifier.
export function wrap(s: string, force: boolean): string {
    if (force) return `"${s}"`;
    return /^[a-zA-Z_]\w*$/.test(s) ? s : `"${s}"`;
}

export function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) + '…' : s;
}

// Map a clause AST node kind to the simpler `SqlClause` tag.
const CLAUSE_KIND_MAP: Record<string, SqlClause> = {
    selectClause: 'select',
    fromClause: 'from',
    whereClause: 'where',
    havingClause: 'having',
    groupByClause: 'groupBy',
    orderByClause: 'orderBy',
    qualifyClause: 'qualify',
    limitClause: 'limit',
    join: 'join',
    joinCondition: 'on',
};

const CLAUSE_KINDS: NodeKind[] = [
    'selectClause',
    'fromClause',
    'whereClause',
    'havingClause',
    'groupByClause',
    'orderByClause',
    'qualifyClause',
    'limitClause',
    'join',
    'joinCondition',
];

// Walk upward from `node` to find the nearest clause ancestor. Returns the
// clause tag, or null if the cursor isn't inside any clause yet (e.g. an
// empty document or right after the `SELECT` keyword with no children).
export function clauseAtCursor(node: Node): SqlClause | null {
    const found = findEnclosingAny(node, CLAUSE_KINDS);
    if (!found) return null;
    return CLAUSE_KIND_MAP[found.kind] ?? null;
}

// Same as clauseAtCursor but falls back to the rightmost clause whose `.to`
// is at-or-before `offset`. Catches the "cursor parked on trailing whitespace
// after `ORDER BY ts |`" case where the AST cursor node is the script/query
// because no clause's range extends to include trailing whitespace.
export function clauseAtOffset(root: Node, node: Node, offset: number): SqlClause | null {
    const direct = clauseAtCursor(node);
    if (direct) return direct;
    let best: Node | null = null;
    walk(root, (n) => {
        if (!CLAUSE_KINDS.includes(n.kind)) return;
        if (n.to > offset) return;
        if (!best || n.to > best.to) best = n;
    });
    return best ? (CLAUSE_KIND_MAP[(best as Node).kind] ?? null) : null;
}

// Convenience for `Completion.validFor`. CodeMirror keeps the dropdown open
// while typing matches the regex. Pick a generous default that covers
// identifiers + quoted forms.
export const VALID_FOR_IDENT = /^"?[\w]*$/;
export const VALID_FOR_DOLLAR = /^\$\$?[\w.]*$/;
export const VALID_FOR_AT = /^@[\w-]*$/;
