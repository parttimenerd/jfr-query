// Deterministic SQL formatter built on the partial-DuckDB tokenizer.
//
// Token-driven, not AST-driven: the parser is partial and emits hole nodes,
// so re-emitting from it would synthesise text. The token stream preserves
// every significant token + comments and is trivial to re-emit. The parser
// is consulted only as a "do no harm" gate: if the formatted output
// re-tokenizes to a different significant-token count than the input, we
// abandon the format and return the input unchanged.

import { tokenize, tokenizeSignificant, type Token } from '../components/editor/sql/tokens';

export interface SqlFormatOpts {
    indent?: string;
    maxInlineLen?: number;
}

const DEFAULT_INDENT = '    ';
const DEFAULT_INLINE_LEN = 80;

const TOP_CLAUSE_KEYWORDS = new Set([
    'SELECT', 'FROM', 'WHERE', 'HAVING', 'QUALIFY',
    'LIMIT', 'OFFSET', 'WINDOW', 'RETURNING',
]);
// These need two-token recognition (GROUP BY, ORDER BY).
const TWO_TOKEN_CLAUSE = new Set(['GROUP', 'ORDER']);
const SET_OPS = new Set(['UNION', 'INTERSECT', 'EXCEPT']);

const JOIN_STARTERS = new Set(['JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL', 'ASOF', 'POSITIONAL', 'ANTI', 'SEMI']);

export function formatSql(src: string, opts: SqlFormatOpts = {}): string {
    if (!src.trim()) return src;
    const indent = opts.indent ?? DEFAULT_INDENT;
    const maxInline = opts.maxInlineLen ?? DEFAULT_INLINE_LEN;

    const tokens = tokenize(src);
    const formatted = emit(tokens, src, indent, maxInline);

    // Validation gate: significant-token count must match.
    const inSig = tokenizeSignificant(src).filter(t => t.kind !== 'eof');
    const outSig = tokenizeSignificant(formatted).filter(t => t.kind !== 'eof');
    if (inSig.length !== outSig.length) return src;
    for (let i = 0; i < inSig.length; i++) {
        if (inSig[i].kind !== outSig[i].kind) return src;
    }
    return formatted;
}

// ---- emitter ----

interface EmitterState {
    out: string;
    indentLevel: number;
    indent: string;
    maxInline: number;
    atLineStart: boolean;
    // Depth of paren groups we currently treat as "subquery": a SELECT was
    // seen at the top of the paren group. Keyed by opening paren index in
    // the stack.
    parenStack: Array<{ isSubquery: boolean; isFuncCall: boolean; startLine: boolean }>;
    // True inside a WITH ... CTE definition's args list.
    inCteList: boolean;
}

function emit(tokens: Token[], src: string, indent: string, maxInline: number): string {
    const sig = tokens.filter(t => t.kind !== 'whitespace' && t.kind !== 'eof');
    if (sig.length === 0) return src;

    const s: EmitterState = {
        out: '',
        indentLevel: 0,
        indent,
        maxInline,
        atLineStart: true,
        parenStack: [],
        inCteList: false,
    };

    for (let i = 0; i < sig.length; i++) {
        const t = sig[i];
        const prev = sig[i - 1];
        const next = sig[i + 1];
        emitToken(s, t, prev, next, sig, i, src);
    }

    // Trim trailing whitespace per line; collapse 3+ blank lines to 2.
    return s.out.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '\n').replace(/\n$/, '');
}

function emitToken(s: EmitterState, t: Token, prev: Token | undefined, next: Token | undefined, sig: Token[], i: number, src: string): void {
    // Comments: line comment on its own line (preceded by newline) if prev was
    // on a different source line; else trailing the prior token with two spaces.
    if (t.kind === 'comment') {
        const startsLine = !prev || isOnNewSourceLine(prev, t, src);
        if (startsLine) {
            ensureNewline(s);
            indentLine(s);
            s.out += normalizeComment(t.text);
            newline(s);
        } else {
            // trailing comment
            if (!s.out.endsWith(' ')) s.out += '  ';
            else s.out += ' ';
            s.out += normalizeComment(t.text);
            newline(s);
        }
        return;
    }

    // Punctuation handling.
    if (t.kind === 'punct') {
        emitPunct(s, t, prev, next, sig, i);
        return;
    }

    // Keyword: case + clause-break logic.
    if (t.kind === 'keyword') {
        emitKeyword(s, t, prev, next, sig, i);
        return;
    }

    // Operator / cast / concat / arrow.
    if (t.kind === 'op' || t.kind === 'cast' || t.kind === 'concat' || t.kind === 'arrow') {
        emitOp(s, t, prev);
        return;
    }

    // Identifier — including function-call uppercase.
    if (t.kind === 'ident') {
        // Function-call detection: ident followed by `(` — uppercase the name.
        const isFnCall = next && next.kind === 'punct' && next.value === '(';
        writeWithLeadingSpace(s, isFnCall ? t.text.toUpperCase() : t.text, prev);
        return;
    }

    // Quoted ident / string / number / dollar / unknown — verbatim.
    writeWithLeadingSpace(s, t.text, prev);
}

function emitPunct(s: EmitterState, t: Token, prev: Token | undefined, next: Token | undefined, sig: Token[], i: number): void {
    const ch = t.value;
    switch (ch) {
        case '(': {
            // Function-call paren (preceded by ident/keyword that names a function)
            // vs grouping/subquery paren.
            const isFn = !!prev && (prev.kind === 'ident' || (prev.kind === 'keyword' && isFunctionKeyword(prev.value)));
            // Is this a subquery paren? Look ahead skipping whitespace — next significant token SELECT or WITH means yes.
            const peekIsSelect = !!next && next.kind === 'keyword' && (next.value === 'SELECT' || next.value === 'WITH');
            // Inside WITH cte AS ( … ): also treat as subquery and break.
            const isCteBody = !!prev && prev.kind === 'keyword' && prev.value === 'AS' && s.inCteList;
            const isSubquery = peekIsSelect || isCteBody;
            s.parenStack.push({ isSubquery, isFuncCall: isFn, startLine: isSubquery });
            // No space between fn name and `(`. Space before `(` after an operator/comma is already handled.
            if (!isFn && !s.atLineStart && !s.out.endsWith(' ') && !s.out.endsWith('\n')) {
                s.out += ' ';
            }
            s.out += '(';
            if (isSubquery) {
                newline(s);
                s.indentLevel++;
                // Don't indent here — the next clause break will indent.
            }
            return;
        }
        case ')': {
            const frame = s.parenStack.pop();
            if (frame && frame.isSubquery) {
                newline(s);
                s.indentLevel = Math.max(0, s.indentLevel - 1);
                indentLine(s);
                s.out += ')';
            } else {
                // No space before `)`.
                if (s.out.endsWith(' ')) s.out = s.out.slice(0, -1);
                s.out += ')';
            }
            return;
        }
        case ',': {
            // No space before, behaviour after depends on context.
            if (s.out.endsWith(' ')) s.out = s.out.slice(0, -1);
            s.out += ',';
            // Break-line behaviour:
            //  - inside CTE list (top-level WITH): newline at indent 0.
            //  - inside subquery paren: newline at current indent.
            //  - inside SELECT list (no enclosing paren or paren is subquery):
            //    newline at current indent.
            //  - inside function call: stay inline (single space).
            const top = s.parenStack[s.parenStack.length - 1];
            if (top && top.isFuncCall) {
                s.out += ' ';
            } else if (s.inCteList && !top) {
                newline(s);
                indentLine(s);
            } else if (isInSelectListContext(s, sig, i)) {
                newline(s);
                indentLine(s);
            } else {
                s.out += ' ';
            }
            return;
        }
        case ';': {
            if (s.out.endsWith(' ')) s.out = s.out.slice(0, -1);
            s.out += ';';
            newline(s);
            return;
        }
        case '.': {
            // No space around `.` for qualified idents.
            if (s.out.endsWith(' ')) s.out = s.out.slice(0, -1);
            s.out += '.';
            return;
        }
        case '[':
        case ']':
        case '{':
        case '}': {
            // Brackets used in array/list/struct literals — no spacing rules.
            if (ch === ']' || ch === '}') {
                if (s.out.endsWith(' ')) s.out = s.out.slice(0, -1);
            } else {
                if (!s.atLineStart && !s.out.endsWith(' ') && !s.out.endsWith('\n') && !s.out.endsWith('(') && !s.out.endsWith('[')) s.out += ' ';
            }
            s.out += ch;
            return;
        }
        default:
            writeWithLeadingSpace(s, ch, prev);
    }
}

function emitKeyword(s: EmitterState, t: Token, prev: Token | undefined, next: Token | undefined, sig: Token[], i: number): void {
    const up = t.value.toUpperCase();

    // Two-token clause heads: GROUP BY / ORDER BY.
    if (TWO_TOKEN_CLAUSE.has(up) && next && next.kind === 'keyword' && next.value === 'BY') {
        breakBeforeClause(s);
        s.out += up + ' BY';
        // Mark BY consumed: emitter loop will see BY next and we must skip
        // its own emission. We do this by patching: we set a marker via the
        // shared `sig` reference. Simpler: leave BY to be emitted as a regular
        // keyword — emitKeyword for BY will detect that prev was GROUP/ORDER
        // and become a no-op (we already wrote " BY").
        // To avoid double-write, we replace next in-place to a sentinel.
        (next as Token).value = '__CONSUMED__';
        return;
    }

    if (up === '__CONSUMED__') return;

    // Set ops on their own line at outer indent.
    if (SET_OPS.has(up)) {
        ensureNewline(s);
        s.indentLevel = 0;
        indentLine(s);
        s.out += up;
        // ALL/DISTINCT modifier inline.
        return;
    }

    // Top-level clause starters.
    if (TOP_CLAUSE_KEYWORDS.has(up)) {
        // Inside a function-call paren (e.g. EXTRACT(YEAR FROM ts), POSITION,
        // TRIM, OVERLAY, SUBSTRING), don't treat clause keywords as line
        // breaks — they're function-syntax fillers.
        const insideFnCall = s.parenStack.some(p => p.isFuncCall);
        if (insideFnCall) {
            writeWithLeadingSpace(s, up, prev);
            return;
        }
        // SELECT/FROM/WHERE/HAVING/QUALIFY/LIMIT/OFFSET/WINDOW/RETURNING
        breakBeforeClause(s);
        s.out += up;
        // Special case: SELECT with multiple items → break each onto its own line.
        if (up === 'SELECT' && countSelectListItems(sig, i) > 1) {
            newline(s);
            s.indentLevel++;
            indentLine(s);
            // Record the parenStack depth when we set this so breakBeforeClause
            // inside a nested subquery does NOT consume the outer SELECT's dedent.
            (s as EmitterState & { selectListDedentAtDepth?: number }).selectListDedentAtDepth = s.parenStack.length;
        }
        return;
    }

    // WITH starts a CTE list.
    if (up === 'WITH') {
        ensureNewline(s);
        indentLine(s);
        s.out += up;
        s.inCteList = true;
        return;
    }

    // JOIN family: break to a new line at clause indent.
    if (JOIN_STARTERS.has(up)) {
        // Only break if the next significant tokens form an actual JOIN.
        // Join modifiers (INNER, LEFT, etc.) — break here; the chain stays inline.
        if (!isContinuationOfJoinChain(s, prev)) {
            breakBeforeClause(s);
        } else {
            writeWithLeadingSpace(s, up, prev);
            return;
        }
        s.out += up;
        return;
    }

    // ON inline with JOIN.
    if (up === 'ON') {
        writeWithLeadingSpace(s, up, prev);
        return;
    }

    // AS inline.
    if (up === 'AS') {
        writeWithLeadingSpace(s, up, prev);
        return;
    }

    // Default: uppercase keyword inline with leading space.
    writeWithLeadingSpace(s, up, prev);
}

function emitOp(s: EmitterState, t: Token, prev: Token | undefined): void {
    const op = t.value;
    // Star directly after `(` or `,` is `*` (column wildcard / `count(*)`) — emit verbatim without leading space.
    // Star after `SELECT` or `DISTINCT` is also a wildcard — add a single leading space.
    if (op === '*' && (!prev ||
        (prev.kind === 'punct' && (prev.value === '(' || prev.value === ',' || prev.value === '.')) ||
        (prev.kind === 'keyword' && (prev.value === 'SELECT' || prev.value === 'DISTINCT')))) {
        const needsSpace = !!prev && prev.kind === 'keyword' && !s.out.endsWith(' ') && !s.out.endsWith('\n');
        if (needsSpace) s.out += ' ';
        s.out += '*';
        return;
    }
    // Unary minus/plus detection: previous token is operator-like or open paren or nothing.
    const isUnary = (op === '-' || op === '+') && (!prev ||
        prev.kind === 'op' || prev.kind === 'cast' || prev.kind === 'concat' || prev.kind === 'arrow' ||
        (prev.kind === 'punct' && (prev.value === '(' || prev.value === ',' || prev.value === '[' || prev.value === ';')) ||
        prev.kind === 'keyword');

    if (op === '::') {
        // Cast: no space around.
        if (s.out.endsWith(' ')) s.out = s.out.slice(0, -1);
        s.out += op;
        return;
    }

    if (isUnary) {
        // No space after a unary -/+.
        if (!s.atLineStart && !s.out.endsWith(' ') && !s.out.endsWith('(') && !s.out.endsWith('[') && !s.out.endsWith(',')) s.out += ' ';
        s.out += op;
        return;
    }

    // Binary op: space around.
    if (!s.atLineStart && !s.out.endsWith(' ')) s.out += ' ';
    s.out += op;
    s.out += ' ';
}

// ---- helpers ----

function writeWithLeadingSpace(s: EmitterState, text: string, prev: Token | undefined): void {
    if (s.atLineStart) {
        s.out += text;
        s.atLineStart = false;
        return;
    }
    if (!s.out.endsWith(' ') && !s.out.endsWith('(') && !s.out.endsWith('.') && !s.out.endsWith('[') && !s.out.endsWith('\n')) {
        s.out += ' ';
    }
    s.out += text;
}

function newline(s: EmitterState): void {
    if (!s.out.endsWith('\n')) s.out += '\n';
    s.atLineStart = true;
}

function ensureNewline(s: EmitterState): void {
    if (s.out.length === 0) return;
    if (s.atLineStart) return;
    if (!s.out.endsWith('\n')) s.out += '\n';
    s.atLineStart = true;
}

function indentLine(s: EmitterState): void {
    s.out += s.indent.repeat(s.indentLevel);
    s.atLineStart = false;
}

function breakBeforeClause(s: EmitterState): void {
    // Undo a SELECT-list dedent if one was applied at this exact paren depth.
    // Checking depth prevents an inner subquery's breakBeforeClause from
    // consuming the outer SELECT list's dedent marker.
    const sx = s as EmitterState & { selectListDedentAtDepth?: number };
    if (sx.selectListDedentAtDepth !== undefined && s.parenStack.length === sx.selectListDedentAtDepth) {
        s.indentLevel = Math.max(0, s.indentLevel - 1);
        sx.selectListDedentAtDepth = undefined;
    }
    ensureNewline(s);
    indentLine(s);
}

// Count significant SELECT-list items starting after the SELECT keyword
// at sig[idx]. Stops at a clause terminator at depth 0.
function countSelectListItems(sig: Token[], idx: number): number {
    let depth = 0;
    let commas = 0;
    let sawAny = false;
    for (let j = idx + 1; j < sig.length; j++) {
        const t = sig[j];
        if (t.kind === 'punct') {
            if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
            else if (t.value === ')' || t.value === ']' || t.value === '}') {
                if (depth === 0) break;
                depth--;
            }
            else if (t.value === ',' && depth === 0) commas++;
            else if (t.value === ';' && depth === 0) break;
        }
        if (depth === 0 && t.kind === 'keyword') {
            if (['FROM', 'WHERE', 'GROUP', 'HAVING', 'QUALIFY', 'ORDER', 'LIMIT', 'OFFSET', 'WINDOW', 'RETURNING', 'UNION', 'INTERSECT', 'EXCEPT'].includes(t.value)) break;
        }
        if (depth === 0) sawAny = true;
    }
    return sawAny ? commas + 1 : 0;
}

function isContinuationOfJoinChain(s: EmitterState, prev: Token | undefined): boolean {
    if (!prev) return false;
    if (prev.kind !== 'keyword') return false;
    return JOIN_STARTERS.has(prev.value.toUpperCase());
}

function isFunctionKeyword(kwValue: string): boolean {
    // Some keywords (CAST, COUNT, EXTRACT, NULLIF, COALESCE, etc.) call as functions.
    // Conservatively: any keyword token followed by `(` is treated as a function call site.
    // The caller checks the next token so this is mostly informational.
    return [
        'CAST', 'TRY_CAST', 'COALESCE', 'NULLIF', 'EXTRACT', 'POSITION', 'TRIM',
        'OVERLAY', 'SUBSTRING', 'ARRAY', 'STRUCT', 'MAP', 'LIST', 'COLUMNS',
        'FILTER',
    ].includes(kwValue);
}

function isOnNewSourceLine(prev: Token, t: Token, src: string): boolean {
    return src.slice(prev.to, t.from).includes('\n');
}

function normalizeComment(text: string): string {
    if (text.startsWith('--')) return text.trimEnd();
    return text; // block comment kept verbatim
}

// True if the cursor is inside a SELECT list (between SELECT and the next FROM/clause-terminator).
// Used to decide whether a `,` should break the line.
function isInSelectListContext(s: EmitterState, sig: Token[], idx: number): boolean {
    // If we're inside a function-call paren, never break.
    const top = s.parenStack[s.parenStack.length - 1];
    if (top && top.isFuncCall) return false;
    // Walk backwards: find the most recent SELECT not crossed by FROM/WHERE/etc.
    let depth = 0;
    for (let j = idx - 1; j >= 0; j--) {
        const t = sig[j];
        if (t.kind === 'punct' && t.value === ')') depth++;
        else if (t.kind === 'punct' && t.value === '(') {
            if (depth === 0) {
                // We hit the opening paren of the enclosing group — only count
                // it as SELECT-list if the group itself was a subquery.
                // For top-level SELECT (no enclosing paren), depth never goes below 0.
                return false;
            }
            depth--;
        }
        if (depth !== 0) continue;
        if (t.kind === 'keyword') {
            if (t.value === 'SELECT') return true;
            if (['FROM', 'WHERE', 'GROUP', 'HAVING', 'QUALIFY', 'ORDER', 'LIMIT', 'OFFSET', 'WINDOW', 'RETURNING'].includes(t.value)) {
                return false;
            }
        }
    }
    return false;
}
