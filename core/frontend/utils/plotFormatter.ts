// Deterministic plot DSL formatter built on the plot tokenizer.
//
// Token-driven (not AST-driven): the plot parser is partial and emits hole
// nodes, so re-emitting from it would synthesise text. The token stream
// preserves every significant token. The parser is consulted only as a
// "do no harm" gate: if the formatted text re-tokenizes to a different
// significant-token count than the input, we abandon and return the input
// unchanged.
//
// Limitation: the plot tokenizer drops `//` and `#` line comments at tokenize
// time. The formatter therefore does not preserve them. SQL keeps comments
// as tokens, so its formatter does; this divergence is intentional and
// matches the existing tokenizer contracts.

import { tokenize, type PlotToken, type PlotTokenKind } from '../components/editor/plot/tokens';
import {
    UPPERCASE_TAIL_KEYWORDS,
    LOWERCASE_TAIL_KEYS,
    SHAPE_NORMALIZE,
} from '../components/editor/plot/parser';

export interface PlotFormatOpts {
    indent?: string;
    inlineThreshold?: number;
}

const DEFAULT_INDENT = '  ';
const DEFAULT_INLINE = 60;

const COMPOSITE_KEYWORDS = new Set(['row', 'col']);

export const formatPlotCode = (src: string, opts: PlotFormatOpts = {}): string => {
    if (!src.trim()) return src;
    const indent = opts.indent ?? DEFAULT_INDENT;
    const inlineThreshold = opts.inlineThreshold ?? DEFAULT_INLINE;

    const tokens = tokenize(src).filter(t => t.kind !== 'eof');
    if (tokens.length === 0) return src;

    const out = emit(tokens, indent, inlineThreshold);

    // Validation gate: significant-token count must match. Semicolons are
    // normalised to newlines inside composite bodies, so filter them out of
    // the comparison.
    const inSig = tokens.filter(t => t.kind !== 'semi');
    const outSig = tokenize(out).filter(t => t.kind !== 'eof' && t.kind !== 'semi');
    if (inSig.length !== outSig.length) return src;
    for (let i = 0; i < inSig.length; i++) {
        if (inSig[i].kind !== outSig[i].kind) return src;
    }

    return out;
};

interface EState {
    buf: string;
    level: number;
    indent: string;
    inlineThreshold: number;
    atLineStart: boolean;
    // Stack of paren contexts: 'call' for plotCall args, 'group' for arithmetic.
    parenStack: Array<'call' | 'group'>;
    // Depth of `{ … }` composite bodies — controls between-plot newlines.
    braceDepth: number;
}

function emit(tokens: PlotToken[], indent: string, inlineThreshold: number): string {
    const s: EState = {
        buf: '',
        level: 0,
        indent,
        inlineThreshold,
        atLineStart: true,
        parenStack: [],
        braceDepth: 0,
    };

    for (let i = 0; i < tokens.length; i++) {
        emitToken(s, tokens, i);
    }

    // Trim trailing whitespace per line, drop a trailing newline.
    return s.buf
        .split('\n')
        .map(l => l.replace(/[ \t]+$/, ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s+$/, '');
}

function emitToken(s: EState, tokens: PlotToken[], i: number): void {
    const t = tokens[i];
    const prev = tokens[i - 1];
    const next = tokens[i + 1];

    switch (t.kind) {
        case 'ident': return emitIdent(s, t, prev, next, tokens, i);
        case 'string': return emitString(s, t, prev);
        case 'number':
        case 'boolean':
        case 'dollar':
        case 'constRef':
        case 'hash':
            return writeWithLeadingSpace(s, renderToken(t), prev);
        case 'lparen': return emitLParen(s, t, prev, tokens, i);
        case 'rparen': return emitRParen(s, t);
        case 'lbrace': return emitLBrace(s);
        case 'rbrace': return emitRBrace(s);
        case 'lbracket':
            // Strip trailing space EXCEPT when prev was a colon (key: [value])
            // or equals (LET @x = [value]) where the space is meaningful.
            if (s.buf.endsWith(' ') && !s.buf.endsWith(': ') && !s.buf.endsWith('= ')) s.buf = s.buf.slice(0, -1);
            s.buf += '[';
            return;
        case 'rbracket':
            if (s.buf.endsWith(' ')) s.buf = s.buf.slice(0, -1);
            s.buf += ']';
            return;
        case 'colon':
            if (s.buf.endsWith(' ')) s.buf = s.buf.slice(0, -1);
            s.buf += ': ';
            return;
        case 'comma':
            if (s.buf.endsWith(' ')) s.buf = s.buf.slice(0, -1);
            s.buf += ',';
            // Break onto a new line when comma is inside a plot-call paren and
            // the clause list is long enough; else single space.
            if (shouldBreakCallArgs(s, tokens, i)) {
                newline(s);
                s.buf += s.indent.repeat(s.level + 1);
                s.atLineStart = false;
            } else {
                s.buf += ' ';
            }
            return;
        case 'equals':
            // LET @x = expr — space around.
            writeWithLeadingSpace(s, '=', prev);
            s.buf += ' ';
            return;
        case 'pipe':
            // `|` separates trailing lowercase tails from the previous clause.
            // We normalise it to a newline + indent so each tail is on its own line.
            writeWithLeadingSpace(s, '|', prev);
            return;
        case 'semi':
            // `;` in composite bodies — normalise to newline.
            if (s.buf.endsWith(' ')) s.buf = s.buf.slice(0, -1);
            newline(s);
            indentHere(s);
            return;
        case 'dot':
            if (s.buf.endsWith(' ')) s.buf = s.buf.slice(0, -1);
            s.buf += '.';
            return;
        case 'plus':
            // Overlay `+` (between two complete plot calls) — space around.
            writeWithLeadingSpace(s, '+', prev);
            s.buf += ' ';
            return;
        case 'minus':
        case 'star':
        case 'slash':
        case 'percent':
        case 'concat':
        case 'lt': case 'gt': case 'le': case 'ge': case 'eq': case 'ne':
            writeWithLeadingSpace(s, t.text, prev);
            s.buf += ' ';
            return;
    }
}

function emitIdent(s: EState, t: PlotToken, prev: PlotToken | undefined, next: PlotToken | undefined, tokens: PlotToken[], i: number): void {
    const lc = t.text.toLowerCase();
    const uc = t.text.toUpperCase();

    // LET keyword.
    if (lc === 'let') {
        // LET starts a statement — break to new line.
        if (!s.atLineStart) newline(s);
        indentHere(s);
        s.buf += 'LET';
        return;
    }

    // Composite row/col — lowercase.
    if (COMPOSITE_KEYWORDS.has(lc)) {
        if (!s.atLineStart) {
            if (!s.buf.endsWith(' ') && !s.buf.endsWith('(') && !s.buf.endsWith('\n')) s.buf += ' ';
        }
        s.buf += lc;
        s.atLineStart = false;
        return;
    }

    // Plot shape — uppercase canonical form. Note: SHAPE_NORMALIZE keys are
    // lowercase forms like 'line_chart' / 'line' → values like 'line' / 'bar'.
    // We want to emit the ORIGINAL multi-token form uppercased (LINE_CHART,
    // not LINE) — so check membership in the lowercase key set and emit the
    // input token uppercased.
    if (SHAPE_NORMALIZE[lc] && next && next.kind === 'lparen') {
        // Inside a composite body, separate consecutive plots onto their own
        // lines so a single-line input like `row { table() table() }`
        // reformats to a multi-line, idempotent canonical layout.
        if (s.braceDepth > 0 && !s.atLineStart && prev && (prev.kind === 'rparen' || prev.kind === 'rbrace')) {
            newline(s);
            indentHere(s);
        }
        writeWithLeadingSpace(s, uc, prev);
        return;
    }

    // Clause key (preceding `:`) — lowercase. Checked before tail-keyword
    // matching so e.g. `name: "x"`, `width: 300` stay lowercase even though
    // they're also valid uppercase tail keywords outside calls.
    if (next && next.kind === 'colon') {
        writeWithLeadingSpace(s, lc, prev);
        return;
    }

    // Tail uppercase keyword (TITLE, LINK_X, …). These can appear after a
    // closing `)` of a plotCall — uppercase and put on the same line.
    if (UPPERCASE_TAIL_KEYWORDS.has(uc)) {
        writeWithLeadingSpace(s, uc, prev);
        return;
    }

    // Lowercase tail key (title, name, link-x, …) — emit lowercase. These
    // appear after `|` in the alternative tail syntax.
    if (LOWERCASE_TAIL_KEYS.has(lc)) {
        writeWithLeadingSpace(s, lc, prev);
        return;
    }

    // Other idents — preserve case.
    writeWithLeadingSpace(s, t.text, prev);
}

function emitString(s: EState, t: PlotToken, prev: PlotToken | undefined): void {
    // Keep quoting style and content verbatim.
    writeWithLeadingSpace(s, t.text, prev);
}

function emitLParen(s: EState, t: PlotToken, prev: PlotToken | undefined, tokens: PlotToken[], i: number): void {
    // Function/plot call paren if directly after an ident (no space allowed).
    const isCall = !!prev && prev.kind === 'ident';
    if (!isCall && !s.atLineStart && !s.buf.endsWith(' ') && !s.buf.endsWith('(') && !s.buf.endsWith('\n')) {
        s.buf += ' ';
    }
    s.buf += '(';
    s.parenStack.push(isCall ? 'call' : 'group');
}

function emitRParen(s: EState, t: PlotToken): void {
    const ctx = s.parenStack.pop();
    if (ctx === 'call' && s.buf.includes('\n') && lastLineHasOnlyIndent(s)) {
        // Multi-line call — close on its own line at outer indent.
        // (The opening level was preserved; we just dedent here.)
    }
    if (s.buf.endsWith(' ')) s.buf = s.buf.slice(0, -1);
    s.buf += ')';
}

function emitLBrace(s: EState): void {
    if (!s.atLineStart && !s.buf.endsWith(' ') && !s.buf.endsWith('\n')) s.buf += ' ';
    s.buf += '{';
    newline(s);
    s.level++;
    s.braceDepth++;
    indentHere(s);
}

function emitRBrace(s: EState): void {
    // Close brace on its own line at outer indent.
    if (!s.atLineStart) newline(s);
    s.level = Math.max(0, s.level - 1);
    s.braceDepth = Math.max(0, s.braceDepth - 1);
    indentHere(s);
    s.buf += '}';
}

function shouldBreakCallArgs(s: EState, tokens: PlotToken[], commaIdx: number): boolean {
    // Only break when this comma is inside a 'call' paren AND the call's
    // total inline length exceeds the threshold.
    if (s.parenStack.length === 0 || s.parenStack[s.parenStack.length - 1] !== 'call') return false;
    // Walk back to find the opening `(` first — needed for bracket-depth check too.
    let depth = 0;
    let lparenIdx = -1;
    for (let j = commaIdx - 1; j >= 0; j--) {
        const t = tokens[j];
        if (t.kind === 'rparen') depth++;
        else if (t.kind === 'lparen') {
            if (depth === 0) { lparenIdx = j; break; }
            depth--;
        }
    }
    if (lparenIdx < 0) return false;
    // B-184: only scan from lparenIdx to commaIdx (not from 0) — O(n) per call, not O(n²).
    let bracketDepth = 0;
    for (let j = lparenIdx + 1; j < commaIdx; j++) {
        if (tokens[j].kind === 'lbracket') bracketDepth++;
        else if (tokens[j].kind === 'rbracket') bracketDepth--;
    }
    if (bracketDepth > 0) return false;
    // Walk forward to find matching `)`.
    let depth2 = 1;
    let rparenIdx = tokens.length;
    for (let j = lparenIdx + 1; j < tokens.length; j++) {
        if (tokens[j].kind === 'lparen') depth2++;
        else if (tokens[j].kind === 'rparen') {
            depth2--;
            if (depth2 === 0) { rparenIdx = j; break; }
        }
    }
    // Inline length = sum of raw token text lengths between paren-pair, plus separators.
    let len = 0;
    for (let j = lparenIdx; j <= rparenIdx; j++) {
        len += tokens[j].text.length;
    }
    // Add ~2 chars per significant token for spaces/punctuation.
    len += (rparenIdx - lparenIdx);
    return len > s.inlineThreshold;
}

function writeWithLeadingSpace(s: EState, text: string, prev: PlotToken | undefined): void {
    if (s.atLineStart) {
        s.buf += text;
        s.atLineStart = false;
        return;
    }
    const last = s.buf[s.buf.length - 1];
    if (last !== ' ' && last !== '(' && last !== '[' && last !== '\n' && last !== '.' && last !== '$' && last !== '@') {
        s.buf += ' ';
    }
    s.buf += text;
}

function newline(s: EState): void {
    if (!s.buf.endsWith('\n')) s.buf += '\n';
    s.atLineStart = true;
}

function indentHere(s: EState): void {
    s.buf += s.indent.repeat(s.level);
    s.atLineStart = false;
}

function lastLineHasOnlyIndent(s: EState): boolean {
    const idx = s.buf.lastIndexOf('\n');
    if (idx < 0) return false;
    const tail = s.buf.slice(idx + 1);
    return /^[ \t]*$/.test(tail);
}

function renderToken(t: PlotToken): string {
    return t.text;
}
