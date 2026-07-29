// Partial recursive-descent parser for DuckDB SQL.
//
// Design goals:
//  - Never throw. Every malformed input still produces an AST whose nodes
//    span the input gaplessly. Missing/partial pieces become `hole` nodes
//    with `expectedKinds` set so the completion engine can dispatch.
//  - Tokens come from the significant-token stream (no whitespace/comments)
//    via `tokenizeSignificant`, so positions in the AST refer to the
//    original source.
//  - Each nonterminal has a synchronizing-token set. On a mismatch we emit
//    a hole, then skip tokens until we hit one in the sync set or EOF.
//
// This file intentionally does NOT cover every DuckDB feature — only the
// shapes the completion engine needs to know about: top-level SELECT with
// CTEs, FROM with joins/subqueries, WHERE / GROUP / HAVING / QUALIFY /
// ORDER / LIMIT, expressions with operator precedence, function calls
// (including FILTER and OVER), CASE, casts, COLUMNS(), and `*` with
// EXCLUDE/REPLACE/RENAME modifiers. UPDATE/INSERT/DELETE/etc. are parsed
// as a single `query`-typed node whose body is opaque tokens — completion
// inside them falls back to the keyword provider.

import { tokenizeSignificant, type Token, type TokenKind } from './tokens';
import {
    type Node,
    type NodeKind,
    type SqlClause,
    makeNode,
    makeHole,
} from './ast';
import { parseDollar } from './ast';

// -------------------------- public entry point -------------------------------

export interface ParseResult {
    root: Node;
    source: string;
    tokens: Token[];
}

export function parse(source: string): ParseResult {
    const tokens = tokenizeSignificant(source);
    const parser = new Parser(source, tokens);
    const root = parser.parseScript();
    return { root, source, tokens };
}

// ----------------------------- the parser ------------------------------------

// Tokens that can start (or follow) a top-level statement. Used as the
// outermost recovery sync set.
const STMT_SYNC: ReadonlyArray<string> = [
    'SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER',
    'VALUES', 'PIVOT', 'UNPIVOT',
];

// Clause keywords that can end an expression / start a new clause.
const CLAUSE_TERMINATORS: ReadonlyArray<string> = [
    'FROM', 'WHERE', 'GROUP', 'HAVING', 'QUALIFY', 'ORDER', 'LIMIT',
    'OFFSET', 'WINDOW', 'UNION', 'INTERSECT', 'EXCEPT',
    'RETURNING',
];

class Parser {
    private pos = 0;

    constructor(private source: string, private tokens: Token[]) {}

    // -------------------- token cursor helpers --------------------

    private peek(offset = 0): Token { return this.tokens[this.pos + offset] ?? this.eof(); }
    private current(): Token { return this.peek(0); }
    private atEnd(): boolean { return this.current().kind === 'eof'; }

    private eof(): Token {
        return this.tokens[this.tokens.length - 1];
    }

    private advance(): Token {
        const t = this.current();
        if (t.kind !== 'eof') this.pos++;
        return t;
    }

    private isKw(kw: string, offset = 0): boolean {
        const t = this.peek(offset);
        return t.kind === 'keyword' && t.value === kw.toUpperCase();
    }

    private isPunctTok(p: string, offset = 0): boolean {
        const t = this.peek(offset);
        return t.kind === 'punct' && t.value === p;
    }

    private isOp(op: string, offset = 0): boolean {
        const t = this.peek(offset);
        return t.kind === 'op' && t.value === op;
    }

    // Consume the current token if it's a keyword matching kw. Returns true
    // on match. Used for the optional keywords (AS, ASC, …).
    private eatKw(kw: string): boolean {
        if (this.isKw(kw)) { this.advance(); return true; }
        return false;
    }

    private eatPunct(p: string): boolean {
        if (this.isPunctTok(p)) { this.advance(); return true; }
        return false;
    }

    // Skip tokens until one of `syncKeywords` (uppercased) is seen at top
    // bracket-depth, or EOF. Always consumes at least one token to guarantee
    // forward progress, so callers can use this as part of error recovery
    // without risking an infinite loop.
    private syncTo(syncKeywords: ReadonlyArray<string>): void {
        if (this.atEnd()) return;
        // Consume the offending token first so we always make progress.
        this.advance();
        let depth = 0;
        while (!this.atEnd()) {
            const t = this.current();
            if (depth === 0) {
                if (t.kind === 'keyword' && syncKeywords.includes(t.value)) return;
                if (t.kind === 'punct' && syncKeywords.includes(t.value)) return;
                if (t.kind === 'punct' && t.value === ';') return;
            }
            if (t.kind === 'punct' && t.value === '(') depth++;
            else if (t.kind === 'punct' && t.value === ')') {
                if (depth === 0) return;
                depth--;
            }
            this.advance();
        }
    }

    private hole(kinds: NodeKind[]): Node {
        return makeHole(this.current().from, kinds, this.source);
    }

    // ------------------------ entry: script ------------------------

    parseScript(): Node {
        const children: Node[] = [];
        while (!this.atEnd()) {
            // Top of a statement.
            if (this.isPunctTok(';')) { this.advance(); continue; }
            const before = this.pos;
            const stmt = this.parseStatement();
            children.push(stmt);
            // Statement separator.
            while (this.isPunctTok(';')) this.advance();
            // Forward-progress guarantee: if a recursive descent path failed
            // to consume anything, eat one token so the outer loop terminates.
            if (this.pos === before) this.advance();
        }
        return makeNode('script', null, children, this.source, 0);
    }

    private parseStatement(): Node {
        if (this.isKw('WITH') || this.isKw('SELECT') || this.isKw('VALUES')
            || this.isKw('PIVOT') || this.isKw('UNPIVOT') || this.isPunctTok('(')) {
            return this.parseQuery();
        }
        // Non-SELECT statement — gobble tokens until the next sync point
        // and bundle them under a `query` node so spans cover the input.
        const start = this.pos;
        this.syncTo(STMT_SYNC);
        const slice = this.tokens.slice(start, this.pos);
        return makeNode('query', slice.length > 0 ? slice : [this.current()], [], this.source);
    }

    // ------------------------ queries and CTEs ---------------------

    private parseQuery(): Node {
        const startTok = this.current();
        const children: Node[] = [];

        if (this.isKw('WITH')) {
            children.push(this.parseWith());
        }

        // Body — either parenthesized, SELECT, VALUES, or set-op chain.
        const body = this.parseSelectBody();
        children.push(body);

        // Top-level set ops chain.
        while (this.isKw('UNION') || this.isKw('INTERSECT') || this.isKw('EXCEPT')) {
            const opStart = this.pos;
            this.advance(); // UNION/INTERSECT/EXCEPT
            this.eatKw('ALL'); // optional
            this.eatKw('DISTINCT');
            const rhs = this.parseSelectBody();
            const op = makeNode('setOp', this.tokens.slice(opStart, this.pos), [rhs], this.source);
            children.push(op);
        }

        // Trailing ORDER BY / LIMIT can apply to the whole set-op chain.
        if (this.isKw('ORDER')) children.push(this.parseOrderBy());
        if (this.isKw('LIMIT')) children.push(this.parseLimit());

        return makeNode('query', children.length > 0 ? null : [startTok], children, this.source);
    }

    private parseWith(): Node {
        const startPos = this.pos;
        this.advance(); // WITH
        this.eatKw('RECURSIVE');
        const ctes: Node[] = [];
        do {
            ctes.push(this.parseCte());
        } while (this.eatPunct(','));
        return makeNode('with', this.tokens.slice(startPos, this.pos), ctes, this.source);
    }

    private parseCte(): Node {
        const startPos = this.pos;
        const children: Node[] = [];

        // CTE name.
        if (this.current().kind === 'ident' || this.current().kind === 'quoted_ident') {
            children.push(this.makeIdent(this.advance()));
        } else {
            children.push(this.hole(['identifier']));
        }

        // Optional column list.
        if (this.eatPunct('(')) {
            const cols: Node[] = [];
            if (!this.isPunctTok(')')) {
                do {
                    if (this.current().kind === 'ident' || this.current().kind === 'quoted_ident') {
                        cols.push(this.makeIdent(this.advance()));
                    } else {
                        cols.push(this.hole(['identifier']));
                        this.syncTo([',', ')'] as unknown as ReadonlyArray<string>);
                    }
                } while (this.eatPunct(','));
            }
            this.eatPunct(')');
            children.push(makeNode('list', null, cols, this.source, this.current().from));
        }

        if (!this.eatKw('AS')) {
            children.push(this.hole(['query']));
        }
        if (this.eatPunct('(')) {
            children.push(this.parseQuery());
            this.eatPunct(')');
        } else {
            children.push(this.hole(['query']));
        }

        return makeNode('cte', this.tokens.slice(startPos, this.pos), children, this.source);
    }

    // Parses one SELECT or parenthesized query body (without a leading WITH).
    private parseSelectBody(): Node {
        if (this.eatPunct('(')) {
            const inner = this.parseQuery();
            this.eatPunct(')');
            return inner;
        }
        if (!this.isKw('SELECT')) {
            // Gobble until clause terminator or EOF.
            return this.hole(['query']);
        }
        return this.parseSelect();
    }

    private parseSelect(): Node {
        const startPos = this.pos;
        const clauses: Node[] = [];

        clauses.push(this.parseSelectClause());

        if (this.isKw('FROM')) clauses.push(this.parseFromClause());
        if (this.isKw('WHERE')) clauses.push(this.parseWhereClause());
        if (this.isKw('GROUP')) clauses.push(this.parseGroupBy());
        if (this.isKw('HAVING')) clauses.push(this.parseHaving());
        if (this.isKw('QUALIFY')) clauses.push(this.parseQualify());

        return makeNode('query', this.tokens.slice(startPos, this.pos), clauses, this.source);
    }

    private parseSelectClause(): Node {
        const startPos = this.pos;
        this.advance(); // SELECT
        this.eatKw('ALL') || this.eatKw('DISTINCT');
        const projections: Node[] = [];
        if (!this.atEnd() && !this.isClauseStarter()) {
            do {
                projections.push(this.parseProjection());
            } while (this.eatPunct(','));
        } else {
            projections.push(this.hole(['identifier', 'functionCall', 'starExpr', 'literal', 'variableRef']));
        }
        const node = makeNode('selectClause', this.tokens.slice(startPos, this.pos), projections, this.source);
        node.annotations.clause = 'select';
        return node;
    }

    private parseProjection(): Node {
        const startPos = this.pos;
        // `*` or `table.*`
        if (this.isOp('*')) {
            const star = this.parseStarExpr();
            // Optional AS alias is illegal for *, but tolerate it.
            return makeNode('projection', null, [star], this.source);
        }
        // table.* form
        if ((this.current().kind === 'ident' || this.current().kind === 'quoted_ident')
            && this.peek(1).kind === 'punct' && this.peek(1).value === '.'
            && this.peek(2).kind === 'op' && this.peek(2).value === '*') {
            const tbl = this.makeIdent(this.advance());
            this.advance(); // .
            this.advance(); // *
            const star = makeNode('starExpr', this.tokens.slice(startPos, this.pos), [tbl], this.source);
            return makeNode('projection', null, [star], this.source);
        }
        const expr = this.parseExpression();
        const children = [expr];

        // Optional AS alias.
        const aliasTok = this.tryConsumeAlias();
        if (aliasTok) children.push(this.makeIdent(aliasTok));

        return makeNode('projection', this.tokens.slice(startPos, this.pos), children, this.source);
    }

    private parseStarExpr(): Node {
        const startPos = this.pos;
        this.advance(); // *
        const children: Node[] = [];
        // EXCLUDE / REPLACE / RENAME modifiers — accept and skip their bodies.
        while (this.isKw('EXCLUDE') || this.isKw('REPLACE') || this.isKw('RENAME')) {
            this.advance();
            if (this.eatPunct('(')) {
                this.skipBalanced();
            } else {
                // Bare ident-list, e.g. EXCLUDE a, b
                while (this.current().kind === 'ident' && !this.isClauseStarter()) {
                    this.advance();
                    if (!this.eatPunct(',')) break;
                }
            }
        }
        return makeNode('starExpr', this.tokens.slice(startPos, this.pos), children, this.source);
    }

    // After an expression, an alias can be introduced by `AS name`, or by a
    // bare ident that is NOT a clause starter. Returns the ident token or null.
    private tryConsumeAlias(): Token | null {
        if (this.eatKw('AS')) {
            const t = this.current();
            if (t.kind === 'ident' || t.kind === 'quoted_ident' || t.kind === 'string') {
                return this.advance();
            }
            return null;
        }
        const t = this.current();
        if ((t.kind === 'ident' || t.kind === 'quoted_ident') && !this.isClauseStarter() && !this.isPunctTok(',')) {
            return this.advance();
        }
        return null;
    }

    private parseFromClause(): Node {
        const startPos = this.pos;
        this.advance(); // FROM
        const items: Node[] = [];
        items.push(this.parseTableRef());
        // Chain of comma-joined sources, plus explicit JOINs.
        while (true) {
            if (this.eatPunct(',')) {
                items.push(this.parseTableRef());
                continue;
            }
            if (this.isJoinStarter()) {
                items.push(this.parseJoin());
                continue;
            }
            break;
        }
        const node = makeNode('fromClause', this.tokens.slice(startPos, this.pos), items, this.source);
        node.annotations.clause = 'from';
        return node;
    }

    private isJoinStarter(): boolean {
        return this.isKw('JOIN') || this.isKw('INNER') || this.isKw('LEFT')
            || this.isKw('RIGHT') || this.isKw('FULL') || this.isKw('CROSS')
            || this.isKw('NATURAL') || this.isKw('ASOF') || this.isKw('POSITIONAL')
            || this.isKw('SEMI') || this.isKw('ANTI');
    }

    private parseJoin(): Node {
        const startPos = this.pos;
        // Consume join modifiers up to JOIN keyword (or until we hit something
        // unexpected — then bail).
        let safety = 8;
        while (safety-- > 0 && this.isJoinStarter() && !this.isKw('JOIN')) this.advance();
        if (this.isKw('JOIN')) this.advance();
        const children: Node[] = [];
        children.push(this.parseTableRef());
        if (this.eatKw('ON')) {
            const cond = this.parseExpression();
            children.push(makeNode('joinCondition', null, [cond], this.source));
        } else if (this.eatKw('USING')) {
            if (this.eatPunct('(')) {
                const cols: Node[] = [];
                if (!this.isPunctTok(')')) {
                    do {
                        if (this.current().kind === 'ident' || this.current().kind === 'quoted_ident') {
                            cols.push(this.makeIdent(this.advance()));
                        } else {
                            cols.push(this.hole(['identifier']));
                            break;
                        }
                    } while (this.eatPunct(','));
                }
                this.eatPunct(')');
                children.push(makeNode('joinCondition', null, cols, this.source));
            }
        }
        const node = makeNode('join', this.tokens.slice(startPos, this.pos), children, this.source);
        node.annotations.clause = 'join';
        return node;
    }

    private parseTableRef(): Node {
        const startPos = this.pos;
        const children: Node[] = [];

        if (this.eatPunct('(')) {
            // Subquery or join expression.
            if (this.isKw('SELECT') || this.isKw('WITH') || this.isKw('VALUES')) {
                children.push(this.parseQuery());
            } else {
                // Could be a parenthesized join — parse as a table ref recursively.
                children.push(this.parseTableRef());
                while (this.isJoinStarter() || this.isPunctTok(',')) {
                    if (this.eatPunct(',')) children.push(this.parseTableRef());
                    else children.push(this.parseJoin());
                }
            }
            this.eatPunct(')');
        } else if (this.current().kind === 'ident' || this.current().kind === 'quoted_ident') {
            // table-or-function ref, possibly schema-qualified.
            children.push(this.parseQualifiedName());
            if (this.eatPunct('(')) {
                // Table function — consume args opaquely for now.
                this.skipBalanced();
            }
        } else if (this.current().kind === 'dollar') {
            children.push(this.parseDollarRef());
        } else {
            children.push(this.hole(['tableRef']));
            this.syncTo(['JOIN', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', ',']);
        }

        // Optional alias.
        const aliasTok = this.tryConsumeAlias();
        if (aliasTok) {
            const aliasIdent = this.makeIdent(aliasTok);
            // Optional column-name list after alias.
            if (this.eatPunct('(')) {
                const cols: Node[] = [];
                if (!this.isPunctTok(')')) {
                    do {
                        if (this.current().kind === 'ident' || this.current().kind === 'quoted_ident') {
                            cols.push(this.makeIdent(this.advance()));
                        } else break;
                    } while (this.eatPunct(','));
                }
                this.eatPunct(')');
                children.push(makeNode('list', null, [aliasIdent, ...cols], this.source));
            } else {
                children.push(aliasIdent);
            }
        }

        return makeNode('tableRef', this.tokens.slice(startPos, this.pos), children, this.source);
    }

    private parseWhereClause(): Node {
        const startPos = this.pos;
        this.advance(); // WHERE
        const expr = this.parseExpression();
        const node = makeNode('whereClause', this.tokens.slice(startPos, this.pos), [expr], this.source);
        node.annotations.clause = 'where';
        return node;
    }

    private parseGroupBy(): Node {
        const startPos = this.pos;
        this.advance(); // GROUP
        this.eatKw('BY');
        const items: Node[] = [];
        if (this.eatKw('ALL')) {
            // GROUP BY ALL
        } else {
            // Parse at least one item — at end of input this yields a hole,
            // which is what completion needs.
            do { items.push(this.parseExpression()); } while (this.eatPunct(','));
        }
        const node = makeNode('groupByClause', this.tokens.slice(startPos, this.pos), items, this.source);
        node.annotations.clause = 'groupBy';
        return node;
    }

    private parseHaving(): Node {
        const startPos = this.pos;
        this.advance(); // HAVING
        const expr = this.parseExpression();
        const node = makeNode('havingClause', this.tokens.slice(startPos, this.pos), [expr], this.source);
        node.annotations.clause = 'having';
        return node;
    }

    private parseQualify(): Node {
        const startPos = this.pos;
        this.advance(); // QUALIFY
        const expr = this.parseExpression();
        const node = makeNode('qualifyClause', this.tokens.slice(startPos, this.pos), [expr], this.source);
        node.annotations.clause = 'qualify';
        return node;
    }

    private parseOrderBy(): Node {
        const startPos = this.pos;
        this.advance(); // ORDER
        this.eatKw('BY');
        const items: Node[] = [];
        // Always parse at least one item — at end of input this yields a hole
        // child, which is what completion needs so the cursor lands inside an
        // orderBy slot rather than escaping to the script root.
        do {
            const itemStart = this.pos;
            const expr = this.parseExpression();
            const itemChildren: Node[] = [expr];
            if (this.eatKw('ASC') || this.eatKw('DESC')) { /* direction noted in span */ }
            if (this.eatKw('NULLS')) {
                this.eatKw('FIRST') || this.eatKw('LAST');
            }
            items.push(makeNode('orderItem', this.tokens.slice(itemStart, this.pos), itemChildren, this.source));
        } while (this.eatPunct(','));
        const node = makeNode('orderByClause', this.tokens.slice(startPos, this.pos), items, this.source);
        node.annotations.clause = 'orderBy';
        return node;
    }

    private parseLimit(): Node {
        const startPos = this.pos;
        this.advance(); // LIMIT
        const children: Node[] = [];
        if (!this.atEnd()) children.push(this.parseExpression());
        if (this.eatKw('OFFSET')) {
            if (!this.atEnd()) children.push(this.parseExpression());
        }
        const node = makeNode('limitClause', this.tokens.slice(startPos, this.pos), children, this.source);
        node.annotations.clause = 'limit';
        return node;
    }

    // ----------------------- expression grammar -----------------------

    // Precedence (low → high):
    //   OR
    //   AND
    //   NOT
    //   = <> < > <= >= IS BETWEEN LIKE ILIKE IN
    //   || (concat)
    //   + -
    //   * / %
    //   unary + - NOT
    //   :: cast
    //   primary (literal, ident, paren, function call)
    //
    // Parsed iteratively per level. Each operator level returns a binaryExpr.

    private parseExpression(): Node { return this.parseOr(); }

    private parseOr(): Node {
        let left = this.parseAnd();
        while (this.isKw('OR')) {
            const opTok = this.advance();
            const right = this.parseAnd();
            left = makeNode('binaryExpr', null, [left, right], this.source);
            (left as Node).text = this.source.slice(left.from, right.to);
            void opTok;
        }
        return left;
    }

    private parseAnd(): Node {
        let left = this.parseNot();
        while (this.isKw('AND')) {
            this.advance();
            const right = this.parseNot();
            left = makeNode('binaryExpr', null, [left, right], this.source);
        }
        return left;
    }

    private parseNot(): Node {
        if (this.isKw('NOT')) {
            const startPos = this.pos;
            this.advance();
            const expr = this.parseNot();
            return makeNode('unaryExpr', this.tokens.slice(startPos, this.pos), [expr], this.source);
        }
        return this.parseComparison();
    }

    private parseComparison(): Node {
        let left = this.parseConcat();
        while (true) {
            if (this.isOp('=') || this.isOp('<>') || this.isOp('!=')
                || this.isOp('<') || this.isOp('>') || this.isOp('<=') || this.isOp('>=')) {
                this.advance();
                const right = this.parseConcat();
                left = makeNode('binaryExpr', null, [left, right], this.source);
                continue;
            }
            if (this.isKw('IS')) {
                this.advance();
                this.eatKw('NOT');
                const right = this.parseConcat();
                left = makeNode('binaryExpr', null, [left, right], this.source);
                continue;
            }
            if (this.isKw('NOT') && (this.isKw('LIKE', 1) || this.isKw('ILIKE', 1) || this.isKw('IN', 1) || this.isKw('BETWEEN', 1) || this.isKw('GLOB', 1) || this.isKw('REGEXP', 1))) {
                this.advance(); // NOT
                // Re-enter the comparison loop body for the following operator so
                // the positive form is built, then wrap it in a unaryExpr for NOT.
                // We do this by falling into a mini-inline dispatch rather than
                // `continue` (which would discard the NOT from the AST).
                let positive: Node | null = null;
                if (this.isKw('LIKE') || this.isKw('ILIKE') || this.isKw('GLOB') || this.isKw('REGEXP')) {
                    this.advance();
                    const right = this.parseConcat();
                    positive = makeNode('binaryExpr', null, [left, right], this.source);
                } else if (this.isKw('IN')) {
                    this.advance();
                    if (this.eatPunct('(')) {
                        const items: Node[] = [];
                        if (!this.isPunctTok(')')) {
                            do { items.push(this.parseExpression()); } while (this.eatPunct(','));
                        }
                        this.eatPunct(')');
                        positive = makeNode('binaryExpr', null, [left, makeNode('list', null, items, this.source)], this.source);
                    } else {
                        const right = this.parseConcat();
                        positive = makeNode('binaryExpr', null, [left, right], this.source);
                    }
                } else if (this.isKw('BETWEEN')) {
                    this.advance();
                    const lo = this.parseConcat();
                    if (this.isKw('AND')) {
                        this.advance();
                        const hi = this.parseConcat();
                        positive = makeNode('binaryExpr', null, [left, lo, hi], this.source);
                    } else {
                        positive = makeNode('binaryExpr', null, [left, lo], this.source);
                    }
                }
                if (positive) left = makeNode('unaryExpr', null, [positive], this.source);
                continue;
            }
            if (this.isKw('LIKE') || this.isKw('ILIKE') || this.isKw('GLOB') || this.isKw('REGEXP')) {
                this.advance();
                const right = this.parseConcat();
                left = makeNode('binaryExpr', null, [left, right], this.source);
                continue;
            }
            if (this.isKw('IN')) {
                this.advance();
                if (this.eatPunct('(')) {
                    const items: Node[] = [];
                    if (!this.isPunctTok(')')) {
                        do { items.push(this.parseExpression()); } while (this.eatPunct(','));
                    }
                    this.eatPunct(')');
                    left = makeNode('binaryExpr', null, [left, makeNode('list', null, items, this.source)], this.source);
                } else {
                    // $var.brush sugar — just consume an expression.
                    const right = this.parseConcat();
                    left = makeNode('binaryExpr', null, [left, right], this.source);
                }
                continue;
            }
            if (this.isKw('BETWEEN')) {
                this.advance();
                const lo = this.parseConcat();
                if (this.isKw('AND')) {
                    this.advance();
                    const hi = this.parseConcat();
                    left = makeNode('binaryExpr', null, [left, lo, hi], this.source);
                } else {
                    left = makeNode('binaryExpr', null, [left, lo], this.source);
                }
                continue;
            }
            break;
        }
        return left;
    }

    private parseConcat(): Node {
        let left = this.parseAddSub();
        while (this.current().kind === 'concat') {
            this.advance();
            const right = this.parseAddSub();
            left = makeNode('binaryExpr', null, [left, right], this.source);
        }
        return left;
    }

    private parseAddSub(): Node {
        let left = this.parseMulDiv();
        while (this.isOp('+') || this.isOp('-')) {
            this.advance();
            const right = this.parseMulDiv();
            left = makeNode('binaryExpr', null, [left, right], this.source);
        }
        return left;
    }

    private parseMulDiv(): Node {
        let left = this.parseUnary();
        while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
            this.advance();
            const right = this.parseUnary();
            left = makeNode('binaryExpr', null, [left, right], this.source);
        }
        return left;
    }

    private parseUnary(): Node {
        if (this.isOp('+') || this.isOp('-')) {
            const startPos = this.pos;
            this.advance();
            const expr = this.parseUnary();
            return makeNode('unaryExpr', this.tokens.slice(startPos, this.pos), [expr], this.source);
        }
        return this.parseCast();
    }

    private parseCast(): Node {
        let left = this.parsePrimary();
        while (this.current().kind === 'cast') {
            this.advance(); // ::
            // Type name — accept keyword or ident, optionally with (params).
            const typeStart = this.pos;
            if (this.current().kind === 'keyword' || this.current().kind === 'ident') {
                this.advance();
                if (this.eatPunct('(')) this.skipBalanced();
                // Array type tail [] [] ...
                while (this.eatPunct('[')) this.eatPunct(']');
            }
            const typeTokens = this.tokens.slice(typeStart, this.pos);
            const typeNode = typeTokens.length > 0
                ? makeNode('identifier', typeTokens, [], this.source)
                : this.hole(['identifier']);
            left = makeNode('castExpr', null, [left, typeNode], this.source);
        }
        return left;
    }

    private parsePrimary(): Node {
        const t = this.current();
        // Parenthesized expression or subquery.
        if (this.isPunctTok('(')) {
            const startPos = this.pos;
            this.advance();
            if (this.isKw('SELECT') || this.isKw('WITH') || this.isKw('VALUES')) {
                const q = this.parseQuery();
                this.eatPunct(')');
                return makeNode('paren', this.tokens.slice(startPos, this.pos), [q], this.source);
            }
            const items: Node[] = [];
            if (!this.isPunctTok(')')) {
                do { items.push(this.parseExpression()); } while (this.eatPunct(','));
            }
            this.eatPunct(')');
            return makeNode('paren', this.tokens.slice(startPos, this.pos), items, this.source);
        }
        // Bracket list literal: [1, 2, 3]
        if (this.isPunctTok('[')) {
            const startPos = this.pos;
            this.advance();
            const items: Node[] = [];
            if (!this.isPunctTok(']')) {
                do { items.push(this.parseExpression()); } while (this.eatPunct(','));
            }
            this.eatPunct(']');
            return makeNode('list', this.tokens.slice(startPos, this.pos), items, this.source);
        }
        // Literals
        if (t.kind === 'number' || t.kind === 'string' || this.isKw('TRUE') || this.isKw('FALSE') || this.isKw('NULL')) {
            this.advance();
            return makeNode('literal', [t], [], this.source);
        }
        if (this.isKw('CASE')) return this.parseCase();
        if (this.isKw('CAST') || this.isKw('TRY_CAST')) return this.parseCastFunction();
        if (this.isKw('COLUMNS')) return this.parseColumnsExpr();
        if (t.kind === 'dollar') return this.parseDollarRef();
        if (t.kind === 'ident' || t.kind === 'quoted_ident') return this.parseIdentOrCall();

        // Reached an unexpected token at expression position. Emit a hole
        // (zero-width at current pos) and DO NOT advance — the caller's loop
        // will either find an operator we recognize (unlikely) or fall back
        // to the outer recovery via syncTo.
        return this.hole(['identifier', 'functionCall', 'literal', 'variableRef']);
    }

    private parseCase(): Node {
        const startPos = this.pos;
        this.advance(); // CASE
        const children: Node[] = [];
        // Optional scrutinee
        if (!this.isKw('WHEN')) children.push(this.parseExpression());
        while (this.eatKw('WHEN')) {
            const when = this.parseExpression();
            if (this.eatKw('THEN')) {
                const then = this.parseExpression();
                children.push(when, then);
            } else {
                children.push(when, this.hole(['identifier', 'functionCall', 'literal']));
            }
        }
        if (this.eatKw('ELSE')) children.push(this.parseExpression());
        this.eatKw('END');
        return makeNode('caseExpr', this.tokens.slice(startPos, this.pos), children, this.source);
    }

    private parseCastFunction(): Node {
        const startPos = this.pos;
        this.advance(); // CAST or TRY_CAST
        const children: Node[] = [];
        if (this.eatPunct('(')) {
            children.push(this.parseExpression());
            if (this.eatKw('AS')) {
                const typeStart = this.pos;
                if (this.current().kind === 'keyword' || this.current().kind === 'ident') {
                    this.advance();
                    if (this.eatPunct('(')) this.skipBalanced();
                    while (this.eatPunct('[')) this.eatPunct(']');
                }
                children.push(makeNode('identifier', this.tokens.slice(typeStart, this.pos), [], this.source));
            }
            this.eatPunct(')');
        }
        return makeNode('castExpr', this.tokens.slice(startPos, this.pos), children, this.source);
    }

    private parseColumnsExpr(): Node {
        const startPos = this.pos;
        this.advance(); // COLUMNS
        const children: Node[] = [];
        if (this.eatPunct('(')) {
            // Either a regex string or a lambda. Just parse whatever expression appears.
            if (!this.isPunctTok(')')) children.push(this.parseExpression());
            this.eatPunct(')');
        }
        return makeNode('columnsExpr', this.tokens.slice(startPos, this.pos), children, this.source);
    }

    private parseIdentOrCall(): Node {
        const nameStartPos = this.pos;
        const qname = this.parseQualifiedName();
        // Function call?
        if (this.isPunctTok('(')) {
            return this.parseFunctionCall(qname, nameStartPos);
        }
        // Lambda: `x -> body`
        if (this.current().kind === 'arrow') {
            return this.parseLambdaTail(qname);
        }
        return qname;
    }

    // Parse a (possibly qualified) name like `a`, `a.b`, `a.b.c`.
    private parseQualifiedName(): Node {
        const startPos = this.pos;
        const parts: Node[] = [this.makeIdent(this.advance())];
        while (this.isPunctTok('.') && (this.peek(1).kind === 'ident' || this.peek(1).kind === 'quoted_ident')) {
            this.advance(); // .
            parts.push(this.makeIdent(this.advance()));
        }
        if (parts.length === 1) return parts[0];
        return makeNode('qualifiedIdent', this.tokens.slice(startPos, this.pos), parts, this.source);
    }

    private parseFunctionCall(name: Node, nameStartPos?: number): Node {
        const start = nameStartPos ?? this.tokens.findIndex(t => t.from === name.from);
        const startPos = start >= 0 ? start : this.pos;
        this.advance(); // (
        const args: Node[] = [];
        if (this.eatKw('DISTINCT')) { /* note distinct in source span */ }
        if (this.isOp('*') && this.peek(1).kind === 'punct' && this.peek(1).value === ')') {
            // count(*)
            this.advance(); // *
        } else if (!this.isPunctTok(')')) {
            do {
                args.push(this.parseExpression());
            } while (this.eatPunct(','));
        }
        this.eatPunct(')');
        const children: Node[] = [name, ...args];

        // FILTER (WHERE ...)
        if (this.isKw('FILTER')) {
            const fStart = this.pos;
            this.advance(); // FILTER
            if (this.eatPunct('(')) {
                if (this.eatKw('WHERE')) {
                    const filterExpr = this.parseExpression();
                    this.eatPunct(')');
                    children.push(makeNode('filterClause', this.tokens.slice(fStart, this.pos), [filterExpr], this.source));
                } else {
                    this.eatPunct(')');
                }
            }
        }

        // OVER (...)
        if (this.isKw('OVER')) {
            const oStart = this.pos;
            this.advance(); // OVER
            if (this.eatPunct('(')) {
                const winStart = this.pos;
                this.skipBalancedKeepTokens();
                children.push(makeNode('overClause', this.tokens.slice(oStart, this.pos), [], this.source));
                void winStart;
            } else if (this.current().kind === 'ident') {
                this.advance(); // named window
                children.push(makeNode('overClause', this.tokens.slice(oStart, this.pos), [], this.source));
            }
        }

        return makeNode('functionCall', this.tokens.slice(start, this.pos), children, this.source);
    }

    private parseLambdaTail(param: Node): Node {
        this.advance(); // ->
        const body = this.parseExpression();
        return makeNode('lambdaExpr', null, [param, body], this.source);
    }

    private parseDollarRef(): Node {
        const t = this.advance();
        const parsed = parseDollar(t.value);
        // The kind is set from the parsed shape; the variableAnnotator fills
        // in the resolution. We do NOT pre-set `annotations.resolves` here
        // because that would short-circuit the annotator's idempotence guard.
        return makeNode(parsed.kind, [t], [], this.source);
    }

    // ----------------------- helpers -----------------------

    private makeIdent(t: Token): Node {
        const n = makeNode('identifier', [t], [], this.source);
        return n;
    }

    private isClauseStarter(offset = 0): boolean {
        const t = this.peek(offset);
        return t.kind === 'keyword' && CLAUSE_TERMINATORS.includes(t.value);
    }

    // Skip a balanced ( ... ) — assumes the opening `(` was already consumed.
    private skipBalanced(): void {
        let depth = 1;
        while (!this.atEnd() && depth > 0) {
            const t = this.current();
            if (t.kind === 'punct' && t.value === '(') depth++;
            else if (t.kind === 'punct' && t.value === ')') depth--;
            if (depth === 0) { this.advance(); return; }
            this.advance();
        }
    }

    private skipBalancedKeepTokens(): void { this.skipBalanced(); }
}
