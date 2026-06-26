// Partial recursive-descent parser for the plot DSL.
//
// Produces a `PlotNode` tree. Every legal-but-incomplete cursor position emits
// a `hole` with `expectedKinds`. Both uppercase (`LINE_CHART(...) TITLE "x"`)
// and lowercase (`line { x: ts } | title: "x"`) forms parse to the same
// `plotCall` shape with a normalized `shape` field (always lowercased).

import { tokenize, type PlotToken, type PlotTokenKind } from './tokens';
import { makeNode, setParents, parseDollar, type PlotNode } from './ast';
import type { PlotHoleHint } from './holeKinds';

// Normalized shape mapping — keys are the lowercased shape token; the value is
// the canonical lowercase shape used by the rest of the system.
const SHAPE_NORMALIZE: Record<string, string> = {
    line_chart: 'line', line: 'line',
    bar_chart: 'bar', bar: 'bar',
    scatter_plot: 'scatter', scatter: 'scatter',
    heatmap: 'heatmap',
    histogram: 'histogram',
    box_plot: 'boxplot', boxplot: 'boxplot',
    pie_chart: 'pie', pie: 'pie',
    flamegraph: 'flamegraph',
    table: 'table',
    area_chart: 'area', area: 'area',
    gantt_chart: 'gantt', gantt: 'gantt',
    range_plot: 'range', range: 'range',
    range_chart: 'range',
};

// Anything in this set, when seen as the *first* token (case-insensitive), is
// considered a known shape (also used by the lowercase detection in derive).
const KNOWN_SHAPES = new Set(Object.keys(SHAPE_NORMALIZE));

// Tail keywords (uppercase form). These can follow a `)` in uppercase plot
// calls and are *not* arguments.
const UPPERCASE_TAIL_KEYWORDS = new Set([
    'TITLE', 'SUBTITLE', 'NAME', 'ZOOM',
    'WIDTH', 'HEIGHT', 'ON', 'DISABLED',
    'LINK_X', 'LINK_Y', 'LINK_XY', 'LINK_SCROLL',
]);

// Recognised lowercase tail keys (after `|`). Hyphenated `link-x` etc. are
// recognised by the tokenizer as single idents.
const LOWERCASE_TAIL_KEYS = new Set([
    'title', 'subtitle', 'name', 'zoom', 'width', 'height',
    'on', 'disabled', 'link-x', 'link-y', 'link-xy', 'link-scroll',
]);

export interface ParseOptions {
    cursorPos?: number;
}

class PlotParser {
    private tokens: PlotToken[];
    private pos = 0;
    private src: string;
    private cursorPos: number;

    constructor(tokens: PlotToken[], src: string, cursorPos: number) {
        this.tokens = tokens;
        this.src = src;
        this.cursorPos = cursorPos;
    }

    private peek(offset = 0): PlotToken {
        const i = Math.min(this.pos + offset, this.tokens.length - 1);
        return this.tokens[i];
    }

    private consume(): PlotToken {
        const t = this.tokens[this.pos];
        if (this.pos < this.tokens.length - 1) this.pos++;
        return t;
    }

    private at(kind: PlotTokenKind): boolean { return this.peek().kind === kind; }

    private setCursor(node: PlotNode): void {
        if (this.cursorPos >= node.from && this.cursorPos <= node.to) node.hasCursor = true;
    }

    private hole(expectedKinds: PlotNode['kind'][] = [], hint?: PlotHoleHint): PlotNode {
        const p = this.peek().from;
        const n = makeNode('hole', p, p, this.src);
        n.annotations.expectedKinds = expectedKinds;
        if (hint) n.annotations.hint = hint;
        this.setCursor(n);
        return n;
    }

    /** Top entry — returns a 'script' node. */
    parseScript(): PlotNode {
        const start = 0;
        const root = makeNode('script', start, this.src.length, this.src);

        // Skip leading whitespace/junk by relying on tokenizer.
        while (!this.at('eof')) {
            const child = this.parseTopLevel();
            if (child) root.children.push(child);
            else this.consume(); // skip unknown token
        }

        // If the script is empty (no real children), and a cursor was given,
        // emit a top-level hole hinting at shape/composite/let suggestions.
        if (root.children.length === 0 && this.cursorPos >= 0) {
            root.children.push(this.hole(
                ['plotCall', 'composite', 'letStatement'],
                { kind: 'topLevel', suggest: 'shape' },
            ));
        }

        // Set parent links + cursor for root.
        setParents(root);
        if (this.cursorPos >= 0 && this.cursorPos <= root.to) root.hasCursor = true;
        return root;
    }

    private parseTopLevel(): PlotNode | null {
        const t = this.peek();
        if (t.kind === 'eof') return null;

        if (t.kind === 'ident') {
            const upper = t.text.toUpperCase();
            // LET @name = expr
            if (upper === 'LET') return this.parseLet();
            // ROW / COL — composite
            const lc = t.text.toLowerCase();
            if (lc === 'row' || lc === 'col') return this.parseComposite();
            // Plot call (uppercase or lowercase form)
            return this.parsePlotCall();
        }
        return null;
    }

    private parseLet(): PlotNode {
        const startTok = this.consume(); // LET
        const from = startTok.from;
        const node = makeNode('letStatement', from, startTok.to, this.src);

        // @name
        if (this.at('constRef')) {
            const t = this.consume();
            node.letName = t.value;
            const nameNode = makeNode('constRef', t.from, t.to, this.src, { constName: t.value });
            this.setCursor(nameNode);
            node.children.push(nameNode);
            node.to = t.to;
        } else {
            node.children.push(this.hole(['constRef'], { kind: 'letName' }));
        }

        // =
        if (this.at('equals')) this.consume();

        // value
        if (!this.at('eof')) {
            const v = this.parseExpression();
            if (v) {
                node.children.push(v);
                node.to = v.to;
            } else {
                node.children.push(this.hole(
                    ['literal', 'list', 'varRef', 'constRef', 'ident'],
                    { kind: 'letValue' },
                ));
            }
        } else {
            node.children.push(this.hole(
                ['literal', 'list', 'varRef', 'constRef', 'ident'],
                { kind: 'letValue' },
            ));
        }

        node.text = this.src.slice(node.from, node.to);
        this.setCursor(node);
        return node;
    }

    private parseComposite(): PlotNode {
        const startTok = this.consume(); // row/col
        const direction = startTok.text.toLowerCase() as 'row' | 'col';
        const from = startTok.from;
        const node = makeNode('composite', from, startTok.to, this.src, { direction });

        if (this.at('lbrace')) {
            const lbraceTo = this.peek().to;
            this.consume();
            // Children: plotCall | composite, separated by ; (or newlines)
            let first = true;
            while (!this.at('rbrace') && !this.at('eof')) {
                if (this.at('semi') || this.at('comma')) { this.consume(); first = false; continue; }
                const child = this.parseTopLevel();
                if (child) {
                    node.children.push(child);
                    first = false;
                } else {
                    // Avoid infinite loop on unknown — consume one token.
                    this.consume();
                }
            }
            if (this.at('rbrace')) { node.to = this.consume().to; }
            else { node.to = this.peek().from; }
            // If the body is empty and the cursor lies inside it, emit a
            // topLevel hole so completion offers shapes / row / col here.
            if (node.children.length === 0 && this.cursorPos >= lbraceTo && this.cursorPos <= node.to) {
                node.children.push(this.hole(
                    ['plotCall', 'composite'],
                    { kind: 'topLevel', suggest: 'shape' },
                ));
            }
        } else if (this.at('lparen')) {
            // Some uppercase grammars may use parens. Tolerate.
            this.consume();
            while (!this.at('rparen') && !this.at('eof')) {
                if (this.at('semi') || this.at('comma')) { this.consume(); continue; }
                const child = this.parseTopLevel();
                if (child) node.children.push(child);
                else this.consume();
            }
            if (this.at('rparen')) { node.to = this.consume().to; }
        } else {
            // Empty composite — emit a hole hint.
            node.children.push(this.hole(
                ['plotCall', 'composite'],
                { kind: 'topLevel', suggest: 'shape' },
            ));
            node.to = this.peek().from;
        }

        // Tail clauses (uppercase or lowercase forms both legal).
        this.parseTrailingTails(node);

        node.text = this.src.slice(node.from, node.to);
        this.setCursor(node);
        return node;
    }

    private parsePlotCall(): PlotNode {
        const startTok = this.consume(); // shape ident
        const shapeRaw = startTok.text;
        const lcShape = shapeRaw.toLowerCase();
        const normalized = SHAPE_NORMALIZE[lcShape] ?? lcShape;
        const from = startTok.from;
        const node = makeNode('plotCall', from, startTok.to, this.src, {
            shape: normalized,
            shapeRaw,
            form: undefined,
        });

        // Detect uppercase vs lowercase form by next punctuation token.
        if (this.at('lparen')) {
            node.form = 'uppercase';
            this.consume(); // (
            this.parseClauseList(node, 'rparen', normalized);
            if (this.at('rparen')) node.to = this.consume().to;
            else node.to = this.peek().from;
        } else if (this.at('lbrace')) {
            node.form = 'lowercase';
            this.consume(); // {
            this.parseClauseList(node, 'rbrace', normalized);
            if (this.at('rbrace')) node.to = this.consume().to;
            else node.to = this.peek().from;
        } else {
            // No body — bare shape (treat as upper form, no args).
            node.form = shapeRaw === shapeRaw.toUpperCase() ? 'uppercase' : 'lowercase';
            node.to = startTok.to;
        }

        // Tail clauses (both forms allowed).
        this.parseTrailingTails(node);

        node.text = this.src.slice(node.from, node.to);
        this.setCursor(node);
        return node;
    }

    private parseClauseList(parent: PlotNode, terminator: PlotTokenKind, shape: string): void {
        while (!this.at(terminator) && !this.at('eof')) {
            if (this.at('comma') || this.at('semi')) { this.consume(); continue; }

            const usedKeys = parent.children
                .filter(c => c.kind === 'clause' && c.key)
                .map(c => c.key!.toLowerCase());

            // Cursor at start-of-clause with no ident — emit a clauseKey hole.
            if (!this.at('ident')) {
                // If next token is colon, the user is mid-typing — emit a value hole.
                if (this.at('colon')) {
                    const h = this.hole(['ident'], {
                        kind: 'clauseKey',
                        shape,
                        usedKeys,
                        availableKeys: [],
                        columnKeys: [],
                        requiredMissing: [],
                    });
                    parent.children.push(h);
                    this.consume();
                    // Try to parse a value too.
                    const v = this.parseExpression();
                    if (v) parent.children.push(v);
                    else parent.children.push(this.hole(
                        ['literal', 'ident', 'list', 'varRef', 'constRef', 'functionCall'],
                        {
                            kind: 'clauseValue',
                            shape,
                            clauseKey: '',
                            paramType: 'value',
                            columnTyped: false,
                            inList: false,
                        },
                    ));
                    continue;
                }
                // Emit a clauseKey hole for any other non-ident situation
                // (e.g. trailing comma followed by `)` cursor).
                const h = this.hole(['ident'], {
                    kind: 'clauseKey',
                    shape,
                    usedKeys,
                    availableKeys: [],
                    columnKeys: [],
                    requiredMissing: [],
                });
                parent.children.push(h);
                // unknown token — break to avoid infinite loop
                this.consume();
                continue;
            }

            const clause = this.parseClause(shape);
            if (clause) parent.children.push(clause);
        }

        // After the loop, if the cursor sits right at the terminator (e.g.
        // `LINE_CHART(x: "ts", <CURSOR>)`), emit a final clauseKey hole so
        // completions know we want a new key.
        if (this.cursorPos >= 0 && this.at(terminator)) {
            const closer = this.peek();
            if (closer.from === this.cursorPos) {
                const usedKeys = parent.children
                    .filter(c => c.kind === 'clause' && c.key)
                    .map(c => c.key!.toLowerCase());
                // Only emit if not already emitted for this position.
                const last = parent.children[parent.children.length - 1];
                if (!last || last.kind !== 'hole' || last.from !== closer.from) {
                    const h = this.hole(['ident'], {
                        kind: 'clauseKey',
                        shape,
                        usedKeys,
                        availableKeys: [],
                        columnKeys: [],
                        requiredMissing: [],
                    });
                    parent.children.push(h);
                }
            }
        }
        // Loop also exits at EOF (e.g. user typed `LINE_CHART(x: "ts",` and
        // hasn't typed `)` yet). If the cursor is at or past the last position
        // and we're still inside the args, emit a clauseKey hole so completion
        // suggests the next key rather than falling through to outer scope.
        if (
            this.cursorPos >= 0 &&
            this.at('eof') &&
            this.cursorPos >= parent.from &&
            this.cursorPos <= this.peek().from
        ) {
            const usedKeys = parent.children
                .filter(c => c.kind === 'clause' && c.key)
                .map(c => c.key!.toLowerCase());
            const last = parent.children[parent.children.length - 1];
            if (!last || last.kind !== 'hole') {
                const h = this.hole(['ident'], {
                    kind: 'clauseKey',
                    shape,
                    usedKeys,
                    availableKeys: [],
                    columnKeys: [],
                    requiredMissing: [],
                });
                parent.children.push(h);
            }
        }
    }

    private parseClause(shape: string): PlotNode {
        const keyTok = this.consume(); // ident
        const from = keyTok.from;
        const key = keyTok.text.toLowerCase();
        const node = makeNode('clause', from, keyTok.to, this.src, {
            key,
            keyFrom: keyTok.from,
            keyTo: keyTok.to,
        });

        // Emit a `clauseRef` child for the key span.
        const cref = makeNode('clauseRef', keyTok.from, keyTok.to, this.src, {
            key,
            name: keyTok.text,
        });
        this.setCursor(cref);
        node.children.push(cref);

        if (this.at('colon')) {
            const colonTok = this.consume();
            node.colonFrom = colonTok.from;
            const valueStart = this.peek().from;
            node.valueFrom = valueStart;
            const v = this.parseValueWithDimensionFusion();
            if (v) {
                node.children.push(v);
                node.to = v.to;
            } else {
                const h = this.hole(
                    ['literal', 'ident', 'list', 'varRef', 'constRef', 'functionCall'],
                    {
                        kind: 'clauseValue',
                        shape,
                        clauseKey: key,
                        paramType: 'value',
                        columnTyped: false,
                        inList: false,
                    },
                );
                node.children.push(h);
                node.to = h.to;
            }
        } else {
            // Bare ident with no colon — treat as a hole expecting colon+value.
            const h = this.hole(
                ['literal', 'ident', 'list', 'varRef', 'constRef', 'functionCall'],
                {
                    kind: 'clauseValue',
                    shape,
                    clauseKey: key,
                    paramType: 'value',
                    columnTyped: false,
                    inList: false,
                },
            );
            node.children.push(h);
            node.to = h.to;
        }

        node.text = this.src.slice(node.from, node.to);
        this.setCursor(node);
        return node;
    }

    /**
     * Parse value with a special fusion for `400px` / `50%` dimensions.
     * The tokenizer produces `number(400)` then `ident(px)`; fuse those into
     * a single 'literal' node of kind 'dimension'.
     */
    private parseValueWithDimensionFusion(): PlotNode | null {
        if (this.at('number')) {
            const numTok = this.peek();
            const after = this.tokens[this.pos + 1];
            if (after && after.kind === 'ident' && /^(?:px|%)$/.test(after.text) && after.from === numTok.to) {
                this.consume(); // number
                this.consume(); // unit
                const node = makeNode('literal', numTok.from, after.to, this.src, {
                    literalKind: 'dimension',
                    literalValue: `${numTok.text}${after.text}`,
                });
                this.setCursor(node);
                return node;
            }
            if (after && after.kind === 'ident' && after.text === '%' && after.from === numTok.to) {
                // unlikely path; we tokenize '%' as 'percent' not ident
            }
        }
        if (this.at('number')) {
            const numTok = this.peek();
            const after = this.tokens[this.pos + 1];
            if (after && after.kind === 'percent' && after.from === numTok.to) {
                this.consume(); // number
                this.consume(); // %
                const node = makeNode('literal', numTok.from, after.to, this.src, {
                    literalKind: 'dimension',
                    literalValue: `${numTok.text}%`,
                });
                this.setCursor(node);
                return node;
            }
        }
        return this.parseExpression();
    }

    // -----------------------------------------------------------------------
    // Expressions with operator precedence.
    //
    // Precedence (low → high):
    //   || (concat)
    //   comparisons (== != < <= > >=)
    //   + -
    //   * / %
    //   unary -
    //   primary
    // -----------------------------------------------------------------------

    private parseExpression(): PlotNode | null {
        return this.parseConcat();
    }

    private parseConcat(): PlotNode | null {
        let left = this.parseComparison();
        if (!left) return null;
        while (this.at('concat')) {
            const opTok = this.consume();
            const right = this.parseComparison();
            const from = left.from;
            const to = right ? right.to : opTok.to;
            const node = makeNode('binaryExpr', from, to, this.src, { op: '||' });
            node.children.push(left);
            if (right) node.children.push(right);
            this.setCursor(node);
            left = node;
        }
        return left;
    }

    private parseComparison(): PlotNode | null {
        let left = this.parseAdditive();
        if (!left) return null;
        while (this.at('lt') || this.at('gt') || this.at('le') || this.at('ge') || this.at('eq') || this.at('ne')) {
            const opTok = this.consume();
            const right = this.parseAdditive();
            const node = makeNode('binaryExpr', left.from, right ? right.to : opTok.to, this.src, { op: opTok.text });
            node.children.push(left);
            if (right) node.children.push(right);
            this.setCursor(node);
            left = node;
        }
        return left;
    }

    private parseAdditive(): PlotNode | null {
        let left = this.parseMultiplicative();
        if (!left) return null;
        while (this.at('plus') || this.at('minus')) {
            const opTok = this.consume();
            const right = this.parseMultiplicative();
            const node = makeNode('binaryExpr', left.from, right ? right.to : opTok.to, this.src, { op: opTok.text });
            node.children.push(left);
            if (right) node.children.push(right);
            this.setCursor(node);
            left = node;
        }
        return left;
    }

    private parseMultiplicative(): PlotNode | null {
        let left = this.parseUnary();
        if (!left) return null;
        while (this.at('star') || this.at('slash') || this.at('percent')) {
            const opTok = this.consume();
            const right = this.parseUnary();
            const node = makeNode('binaryExpr', left.from, right ? right.to : opTok.to, this.src, { op: opTok.text });
            node.children.push(left);
            if (right) node.children.push(right);
            this.setCursor(node);
            left = node;
        }
        return left;
    }

    private parseUnary(): PlotNode | null {
        if (this.at('minus')) {
            const opTok = this.consume();
            const inner = this.parseUnary();
            const to = inner ? inner.to : opTok.to;
            const node = makeNode('unaryExpr', opTok.from, to, this.src, { op: '-' });
            if (inner) node.children.push(inner);
            this.setCursor(node);
            return node;
        }
        return this.parsePrimary();
    }

    private parsePrimary(): PlotNode | null {
        const t = this.peek();

        if (t.kind === 'eof') return null;

        // List
        if (t.kind === 'lbracket') return this.parseList();

        // Parenthesized expr
        if (t.kind === 'lparen') {
            this.consume();
            const inner = this.parseExpression();
            const start = t.from;
            let end = inner ? inner.to : t.to;
            if (this.at('rparen')) end = this.consume().to;
            const node = makeNode('paren', start, end, this.src);
            if (inner) node.children.push(inner);
            this.setCursor(node);
            return node;
        }

        // Hash + number/ident/string → query ref like #2 or #"viewname"
        if (t.kind === 'hash') {
            this.consume();
            if (this.at('number') || this.at('ident') || this.at('string')) {
                const v = this.consume();
                const node = makeNode('queryRef', t.from, v.to, this.src, {
                    queryTargetFrom: v.from,
                    queryTargetTo: v.to,
                });
                if (v.kind === 'number') {
                    node.queryIndex = parseInt(v.text, 10);
                } else if (v.kind === 'ident') {
                    node.queryName = v.text;
                } else {
                    node.queryName = (v as any).value ?? v.text;
                }
                this.setCursor(node);
                return node;
            }
            return this.hole(['queryRef'], { kind: 'queryRefTarget', consumedIndexes: [] });
        }

        // Number
        if (t.kind === 'number') {
            this.consume();
            const v = parseFloat(t.text.replace(/_/g, ''));
            const node = makeNode('literal', t.from, t.to, this.src, {
                literalKind: 'number',
                literalValue: v,
            });
            this.setCursor(node);
            return node;
        }

        // String
        if (t.kind === 'string') {
            this.consume();
            const node = makeNode('literal', t.from, t.to, this.src, {
                literalKind: 'string',
                literalValue: t.value,
            });
            this.setCursor(node);
            return node;
        }

        // Boolean
        if (t.kind === 'boolean') {
            this.consume();
            const node = makeNode('literal', t.from, t.to, this.src, {
                literalKind: 'boolean',
                literalValue: t.text.toLowerCase() === 'true',
            });
            this.setCursor(node);
            return node;
        }

        // Dollar reference
        if (t.kind === 'dollar') {
            this.consume();
            const node = makeNode('varRef', t.from, t.to, this.src, {
                dollar: parseDollar(t.value),
            });
            this.setCursor(node);
            return node;
        }

        // Constant ref
        if (t.kind === 'constRef') {
            this.consume();
            const node = makeNode('constRef', t.from, t.to, this.src, { constName: t.value });
            this.setCursor(node);
            return node;
        }

        // Ident — could be:
        //   - the keyword 'null' (literal)
        //   - function call (ident '(' args ')')
        //   - bare identifier (column ref)
        if (t.kind === 'ident') {
            const lc = t.text.toLowerCase();
            if (lc === 'null') {
                this.consume();
                const node = makeNode('literal', t.from, t.to, this.src, {
                    literalKind: 'null',
                    literalValue: null,
                });
                this.setCursor(node);
                return node;
            }

            // Tail keyword? Don't consume as a value.
            const upper = t.text.toUpperCase();
            if (UPPERCASE_TAIL_KEYWORDS.has(upper)) {
                return null;
            }

            // Function call?
            const next = this.tokens[this.pos + 1];
            if (next && next.kind === 'lparen') {
                this.consume(); // name
                this.consume(); // (
                const node = makeNode('functionCall', t.from, next.to, this.src, { fnName: t.text });
                while (!this.at('rparen') && !this.at('eof')) {
                    if (this.at('comma')) { this.consume(); continue; }
                    const arg = this.parseExpression();
                    if (arg) node.children.push(arg);
                    else { this.consume(); }
                }
                if (this.at('rparen')) node.to = this.consume().to;
                else node.to = this.peek().from;
                this.setCursor(node);
                return node;
            }

            // Bare ident
            this.consume();
            const node = makeNode('ident', t.from, t.to, this.src, { name: t.text });
            this.setCursor(node);
            return node;
        }

        return null;
    }

    private parseList(): PlotNode {
        const startTok = this.consume(); // [
        const node = makeNode('list', startTok.from, startTok.to, this.src);
        while (!this.at('rbracket') && !this.at('eof')) {
            if (this.at('comma') || this.at('semi')) { this.consume(); continue; }
            const v = this.parseExpression();
            if (v) node.children.push(v);
            else { this.consume(); }
        }
        if (this.at('rbracket')) node.to = this.consume().to;
        else node.to = this.peek().from;
        this.setCursor(node);
        return node;
    }

    // -----------------------------------------------------------------------
    // Tail clauses (both forms).
    //
    // Uppercase tail: KEYWORD value [args]
    //   TITLE "x"
    //   ZOOM 2.0
    //   WIDTH 400px
    //   ON 1, 2, foo
    //   DISABLED         (bare)
    //   LINK_X($a, $b, master)
    //   NAME "gc"
    //
    // Lowercase tail: | key[: value]
    //   | name: gc
    //   | on: #2
    //   | link-x: [$a, $b]
    //   | disabled
    // -----------------------------------------------------------------------

    private parseTrailingTails(parent: PlotNode): void {
        for (;;) {
            const t = this.peek();
            if (t.kind === 'eof') break;
            // Lowercase form: starts with pipe.
            if (t.kind === 'pipe') {
                const tail = this.parseLowercaseTail();
                if (tail) {
                    parent.children.push(tail);
                    parent.to = tail.to;
                    continue;
                }
                break;
            }
            // Uppercase form: starts with a recognised keyword ident.
            if (t.kind === 'ident' && UPPERCASE_TAIL_KEYWORDS.has(t.text.toUpperCase())) {
                const tail = this.parseUppercaseTail();
                if (tail) {
                    parent.children.push(tail);
                    parent.to = tail.to;
                    continue;
                }
                break;
            }
            break;
        }

        // If the cursor is parked at the position immediately after the
        // parent's body, emit a `tailKey` hole so completions know to suggest
        // tail keywords.
        if (this.cursorPos >= 0 && this.cursorPos >= parent.to) {
            const peek = this.peek();
            const cursorInsideIdent = peek.kind === 'ident' &&
                peek.from <= this.cursorPos && this.cursorPos <= peek.to &&
                !UPPERCASE_TAIL_KEYWORDS.has(peek.text.toUpperCase());
            if (peek.kind === 'eof' || peek.from > this.cursorPos || cursorInsideIdent) {
                const allowedTails = [...UPPERCASE_TAIL_KEYWORDS];
                const last = parent.children[parent.children.length - 1];
                if (!last || last.kind !== 'hole' || last.from !== this.cursorPos) {
                    // Only attach if cursor is on whitespace right after parent
                    // or mid-typing a partial tail keyword.
                    if (this.cursorPos > parent.to || parent.hasCursor || cursorInsideIdent) {
                        const h = this.hole(['tail'], { kind: 'tailKey', allowedTails });
                        // Extend hole span to cover the partial ident at cursor
                        // so findHoleAtCursor accepts it.
                        if (cursorInsideIdent) {
                            h.from = peek.from;
                            h.to = peek.to;
                        }
                        parent.children.push(h);
                    }
                }
            }
        }
    }

    private tailValueType(keyword: string): 'string' | 'number' | 'dimension' | 'identList' | 'linkArgs' {
        const u = keyword.toUpperCase();
        if (u === 'TITLE' || u === 'SUBTITLE' || u === 'NAME') return 'string';
        if (u === 'ZOOM') return 'number';
        if (u === 'WIDTH' || u === 'HEIGHT') return 'dimension';
        if (u === 'ON') return 'identList';
        if (u === 'LINK_X' || u === 'LINK_Y' || u === 'LINK_XY' || u === 'LINK_SCROLL') return 'linkArgs';
        return 'string';
    }

    private parseUppercaseTail(): PlotNode | null {
        const kwTok = this.consume();
        const keyword = kwTok.text.toUpperCase();
        const node = makeNode('tail', kwTok.from, kwTok.to, this.src, {
            key: keyword.toLowerCase().replace(/_/g, '-'),
            keyRaw: kwTok.text,
            keyFrom: kwTok.from,
            keyTo: kwTok.to,
        });

        // Emit a `tailRef` child for the keyword span.
        const tref = makeNode('tailRef', kwTok.from, kwTok.to, this.src, {
            key: keyword.toLowerCase().replace(/_/g, '-'),
            keyRaw: kwTok.text,
            name: kwTok.text,
        });
        this.setCursor(tref);
        node.children.push(tref);

        if (keyword === 'DISABLED') {
            this.setCursor(node);
            node.text = this.src.slice(node.from, node.to);
            return node;
        }

        // LINK_X / LINK_Y / LINK_XY / LINK_SCROLL — paren-list
        if (keyword === 'LINK_X' || keyword === 'LINK_Y' || keyword === 'LINK_XY' || keyword === 'LINK_SCROLL') {
            if (this.at('lparen')) {
                const lp = this.consume();
                const argsNode = makeNode('list', lp.from, lp.to, this.src);
                let consumed = 0;
                while (!this.at('rparen') && !this.at('eof')) {
                    if (this.at('comma')) { this.consume(); continue; }
                    const v = this.parseExpression();
                    if (v) { argsNode.children.push(v); consumed++; }
                    else this.consume();
                }
                // If cursor lands inside an empty / partial args list, emit a hole
                // so completion offers brush refs / variables.
                if (this.cursorPos >= lp.to && this.cursorPos <= this.peek().from) {
                    const isOneVar = keyword === 'LINK_Y' || keyword === 'LINK_XY';
                    argsNode.children.push(this.hole(
                        ['varRef', 'ident'],
                        { kind: 'linkArgs', positional: isOneVar ? ['var'] : ['var', 'var', 'master', 'clamp'], consumed, keyword },
                    ));
                }
                if (this.at('rparen')) argsNode.to = this.consume().to;
                else argsNode.to = this.peek().from;
                node.children.push(argsNode);
                node.to = argsNode.to;
            } else {
                node.children.push(this.hole(
                    ['list'],
                    { kind: 'tailValue', tail: keyword, valueType: 'linkArgs' },
                ));
            }
            this.setCursor(node);
            node.text = this.src.slice(node.from, node.to);
            return node;
        }

        // ON: comma-separated value list (no parens, no brackets)
        if (keyword === 'ON') {
            const items: PlotNode[] = [];
            // First value
            const first = this.parseOnValue();
            if (first) items.push(first);
            while (this.at('comma')) {
                this.consume();
                const v = this.parseOnValue();
                if (v) items.push(v);
            }
            if (items.length > 0) {
                const wrap = makeNode('list', items[0].from, items[items.length - 1].to, this.src);
                wrap.children = items;
                node.children.push(wrap);
                node.to = wrap.to;
            } else {
                node.children.push(this.hole(
                    ['queryRef', 'ident'],
                    { kind: 'onArg', expects: ['queryRef', 'ident'], consumedIndexes: [] },
                ));
            }
            this.setCursor(node);
            node.text = this.src.slice(node.from, node.to);
            return node;
        }

        // Other tails (TITLE, SUBTITLE, NAME, ZOOM, WIDTH, HEIGHT) — single value.
        const v = this.parseValueWithDimensionFusion();
        if (v) {
            node.children.push(v);
            node.to = v.to;
        } else {
            node.children.push(this.hole(
                ['literal', 'ident'],
                { kind: 'tailValue', tail: keyword, valueType: this.tailValueType(keyword) },
            ));
        }
        this.setCursor(node);
        node.text = this.src.slice(node.from, node.to);
        return node;
    }

    private parseOnValue(): PlotNode | null {
        // ON values can be: ident, number, #number, or string
        const t = this.peek();
        if (t.kind === 'hash') {
            this.consume();
            if (this.at('number') || this.at('ident') || this.at('string')) {
                const v = this.consume();
                const node = makeNode('queryRef', t.from, v.to, this.src, {
                    queryTargetFrom: v.from,
                    queryTargetTo: v.to,
                });
                if (v.kind === 'number') {
                    node.queryIndex = parseInt(v.text, 10);
                } else if (v.kind === 'ident') {
                    node.queryName = v.text;
                } else {
                    node.queryName = (v as any).value ?? v.text;
                }
                this.setCursor(node);
                return node;
            }
            // Bare `#` with no target — emit a queryRefTarget hole.
            return this.hole(['queryRef'], { kind: 'queryRefTarget', consumedIndexes: [] });
        }
        if (t.kind === 'number') {
            this.consume();
            const node = makeNode('literal', t.from, t.to, this.src, {
                literalKind: 'string',
                literalValue: t.text,
            });
            this.setCursor(node);
            return node;
        }
        if (t.kind === 'ident') {
            this.consume();
            const node = makeNode('ident', t.from, t.to, this.src, { name: t.text });
            this.setCursor(node);
            return node;
        }
        if (t.kind === 'string') {
            this.consume();
            const node = makeNode('literal', t.from, t.to, this.src, {
                literalKind: 'string',
                literalValue: t.value,
            });
            this.setCursor(node);
            return node;
        }
        return null;
    }

    private parseLowercaseTail(): PlotNode | null {
        const pipeTok = this.consume(); // |
        const node = makeNode('tail', pipeTok.from, pipeTok.to, this.src);

        // key (ident, possibly hyphenated)
        if (!this.at('ident')) {
            const allowedTails = [...LOWERCASE_TAIL_KEYS];
            node.children.push(this.hole(
                ['ident', 'tailRef'],
                { kind: 'tailKey', allowedTails },
            ));
            this.setCursor(node);
            node.text = this.src.slice(node.from, node.to);
            return node;
        }
        const keyTok = this.consume();
        node.key = keyTok.text.toLowerCase();
        node.keyRaw = keyTok.text;
        node.keyFrom = keyTok.from;
        node.keyTo = keyTok.to;
        node.to = keyTok.to;

        // Emit a tailRef child for the keyword span.
        const tref = makeNode('tailRef', keyTok.from, keyTok.to, this.src, {
            key: keyTok.text.toLowerCase(),
            keyRaw: keyTok.text,
            name: keyTok.text,
        });
        this.setCursor(tref);
        node.children.push(tref);

        // Bare tail (no colon) — e.g. `| disabled`
        if (!this.at('colon')) {
            this.setCursor(node);
            node.text = this.src.slice(node.from, node.to);
            return node;
        }
        const colonTok = this.consume(); // colon
        node.colonFrom = colonTok.from;
        node.valueFrom = this.peek().from;

        // value (with dimension fusion + hash-prefix support)
        if (this.at('hash')) {
            const hash = this.consume();
            if (this.at('number') || this.at('ident') || this.at('string')) {
                const v = this.consume();
                const qref = makeNode('queryRef', hash.from, v.to, this.src, {
                    queryTargetFrom: v.from,
                    queryTargetTo: v.to,
                });
                if (v.kind === 'number') {
                    qref.queryIndex = parseInt(v.text, 10);
                } else if (v.kind === 'ident') {
                    qref.queryName = v.text;
                } else {
                    qref.queryName = (v as any).value ?? v.text;
                }
                this.setCursor(qref);
                node.children.push(qref);
                node.to = qref.to;
                this.setCursor(node);
                node.text = this.src.slice(node.from, node.to);
                return node;
            } else {
                // bare `#` — hole for query ref target
                const h = this.hole(
                    ['queryRef'],
                    { kind: 'queryRefTarget', consumedIndexes: [] },
                );
                node.children.push(h);
                node.to = h.to;
                this.setCursor(node);
                node.text = this.src.slice(node.from, node.to);
                return node;
            }
        }

        const v = this.parseValueWithDimensionFusion();
        if (v) {
            node.children.push(v);
            node.to = v.to;
        } else {
            const keywordUpper = (node.key ?? '').toUpperCase().replace(/-/g, '_');
            node.children.push(this.hole(
                ['literal', 'ident', 'list', 'varRef'],
                { kind: 'tailValue', tail: keywordUpper, valueType: this.tailValueType(keywordUpper) },
            ));
        }
        this.setCursor(node);
        node.text = this.src.slice(node.from, node.to);
        return node;
    }
}

export function parse(src: string, opts: ParseOptions = {}): PlotNode {
    const tokens = tokenize(src);
    const cursorPos = opts.cursorPos ?? -1;
    const parser = new PlotParser(tokens, src, cursorPos);
    return parser.parseScript();
}

export { KNOWN_SHAPES, SHAPE_NORMALIZE, UPPERCASE_TAIL_KEYWORDS, LOWERCASE_TAIL_KEYS };
