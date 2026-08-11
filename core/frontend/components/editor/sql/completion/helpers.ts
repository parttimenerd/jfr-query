// Helpers shared across completion providers and the dispatcher.

import type { Node, NodeKind, SqlClause } from '../ast';
import { walk } from '../ast';

// Quoted-ident wrap: if `force` is true, always quote; otherwise quote only
// when the name isn't a bare identifier.
export function wrap(s: string, force: boolean): string {
    if (force) return `"${s}"`;
    if (!s) return `"${s}"`;
    // Fast char-code path: must start with letter/underscore, rest must be alphanumeric/underscore.
    let c = s.charCodeAt(0);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95)) return `"${s}"`;
    for (let i = 1; i < s.length; i++) {
        c = s.charCodeAt(i);
        if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95)) return `"${s}"`;
    }
    return s;
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

const CLAUSE_KINDS_SET = new Set<NodeKind>(CLAUSE_KINDS);

// Walk upward from `node` to find the nearest clause ancestor. Returns the
// clause tag, or null if the cursor isn't inside any clause yet (e.g. an
// empty document or right after the `SELECT` keyword with no children).
export function clauseAtCursor(node: Node): SqlClause | null {
    let n: Node | undefined = node;
    while (n) {
        if (CLAUSE_KINDS_SET.has(n.kind)) return CLAUSE_KIND_MAP[n.kind] ?? null;
        n = n.parent;
    }
    return null;
}

// Single-entry cache for the walk-based fallback path in clauseAtOffset.
// The root reference is stable within a parse cache hit (same source = same root object),
// so this is warm on re-queries triggered by embedding rank updates.
let _caoRoot: Node | null = null;
let _caoOffset: number = -1;
let _caoResult: SqlClause | null = null;

// Same as clauseAtCursor but falls back to the rightmost clause whose `.to`
// is at-or-before `offset`. Catches the "cursor parked on trailing whitespace
// after `ORDER BY ts |`" case where the AST cursor node is the script/query
// because no clause's range extends to include trailing whitespace.
export function clauseAtOffset(root: Node, node: Node, offset: number): SqlClause | null {
    const direct = clauseAtCursor(node);
    if (direct) return direct;
    if (root === _caoRoot && offset === _caoOffset) return _caoResult;
    let best: Node | null = null;
    walk(root, (n) => {
        // Skip entire subtrees that start after the cursor — no clause in them can qualify.
        if (n.from > offset) return false;
        if (!CLAUSE_KINDS_SET.has(n.kind)) return;
        if (n.to > offset) return;
        if (!best || n.to > best.to) best = n;
    });
    const result = best ? (CLAUSE_KIND_MAP[(best as Node).kind] ?? null) : null;
    _caoRoot = root;
    _caoOffset = offset;
    _caoResult = result;
    return result;
}

// Convenience for `Completion.validFor`. CodeMirror keeps the dropdown open
// while typing matches the regex. Pick a generous default that covers
// identifiers + quoted forms.
export const VALID_FOR_IDENT = /^"?[\w]*$/;
export const VALID_FOR_DOLLAR = /^\$\$?[\w.]*$/;
export const VALID_FOR_AT = /^@[\w-]*$/;
