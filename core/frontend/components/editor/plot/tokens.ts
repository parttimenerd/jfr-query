// Tokenizer for the plot DSL.
//
// A single-pass tokenizer producing tokens with `from`/`to` offsets into the
// original source. The dollar handling differs from the SQL tokenizer in that
// `$cell.var.path` becomes a single `dollar` token whose `value` carries the
// full reference (matching the SQL tokenizer's contract). `@name` becomes a
// `constRef` token. `//` and `#` line comments are skipped (they do not emit
// tokens). Unknown chars are skipped silently.

export type PlotTokenKind =
    | 'ident'
    | 'string'
    | 'number'
    | 'boolean'
    | 'dollar'
    | 'constRef'      // @name
    | 'hash'          // # (used in `#2` query refs)
    | 'lparen'
    | 'rparen'
    | 'lbrace'
    | 'rbrace'
    | 'lbracket'
    | 'rbracket'
    | 'colon'
    | 'comma'
    | 'equals'
    | 'pipe'
    | 'semi'
    | 'dot'
    | 'plus' | 'minus' | 'star' | 'slash' | 'percent'
    | 'concat'        // ||
    | 'lt' | 'gt' | 'le' | 'ge' | 'eq' | 'ne'
    | 'eof';

export interface PlotToken {
    kind: PlotTokenKind;
    text: string;       // raw text in the source
    value: string;      // canonical value (e.g. unquoted string, or full $cell.var path)
    from: number;
    to: number;
}

export function tokenize(src: string): PlotToken[] {
    const tokens: PlotToken[] = [];
    let i = 0;
    const n = src.length;

    const push = (kind: PlotTokenKind, from: number, to: number, value?: string) => {
        const text = src.slice(from, to);
        tokens.push({ kind, text, value: value ?? text, from, to });
    };

    while (i < n) {
        const ch = src[i];

        // Whitespace
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { i++; continue; }

        // Line comments — // and #
        if (ch === '/' && src[i + 1] === '/') {
            while (i < n && src[i] !== '\n') i++;
            continue;
        }
        if (ch === '#') {
            // Lookahead to distinguish #digit / #ident / #"view" / # (bare,
            // used in mid-typing) from #-line-comments. The plot DSL uses
            // `#2`, `#viewname`, `#"viewname"` as query refs; a `#` at EOL
            // followed by whitespace is conventionally a line comment.
            const next = src[i + 1];
            if (next === undefined || /[0-9A-Za-z_"]/.test(next)) {
                push('hash', i, i + 1);
                i++;
                continue;
            }
            // Else: line comment.
            while (i < n && src[i] !== '\n') i++;
            continue;
        }

        // Single-char punctuation
        switch (ch) {
            case '(': push('lparen', i, i + 1); i++; continue;
            case ')': push('rparen', i, i + 1); i++; continue;
            case '{': push('lbrace', i, i + 1); i++; continue;
            case '}': push('rbrace', i, i + 1); i++; continue;
            case '[': push('lbracket', i, i + 1); i++; continue;
            case ']': push('rbracket', i, i + 1); i++; continue;
            case ':': push('colon', i, i + 1); i++; continue;
            case ',': push('comma', i, i + 1); i++; continue;
            case '=': {
                if (src[i + 1] === '=') { push('eq', i, i + 2); i += 2; }
                else { push('equals', i, i + 1); i++; }
                continue;
            }
            case '|': {
                if (src[i + 1] === '|') { push('concat', i, i + 2); i += 2; }
                else { push('pipe', i, i + 1); i++; }
                continue;
            }
            case ';': push('semi', i, i + 1); i++; continue;
            case '+': push('plus', i, i + 1); i++; continue;
            case '*': push('star', i, i + 1); i++; continue;
            case '/': push('slash', i, i + 1); i++; continue;
            case '%': push('percent', i, i + 1); i++; continue;
            case '<': {
                if (src[i + 1] === '=') { push('le', i, i + 2); i += 2; }
                else { push('lt', i, i + 1); i++; }
                continue;
            }
            case '>': {
                if (src[i + 1] === '=') { push('ge', i, i + 2); i += 2; }
                else { push('gt', i, i + 1); i++; }
                continue;
            }
            case '!': {
                if (src[i + 1] === '=') { push('ne', i, i + 2); i += 2; }
                else { i++; }
                continue;
            }
        }

        // Minus: always emit as operator token; parseUnary handles negation.
        if (ch === '-') { push('minus', i, i + 1); i++; continue; }

        // Dot — either standalone or start of decimal number (rare)
        if (ch === '.') {
            const next = src[i + 1];
            if (next !== undefined && /[0-9]/.test(next)) {
                const start = i;
                i++; // .
                while (i < n && /[0-9_]/.test(src[i])) i++;
                if (src[i] === 'e' || src[i] === 'E') {
                    i++;
                    if (src[i] === '+' || src[i] === '-') i++;
                    while (i < n && /[0-9]/.test(src[i])) i++;
                }
                push('number', start, i);
                continue;
            }
            push('dot', i, i + 1); i++; continue;
        }

        // Dollar reference
        if (ch === '$') {
            const start = i;
            i++;
            // optional second $
            let prefix = '$';
            if (src[i] === '$') { prefix += '$'; i++; }
            // ident
            while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
            // optional .ident segments (numeric segments allowed too)
            while (src[i] === '.' && i + 1 < n && /[A-Za-z0-9_]/.test(src[i + 1])) {
                i++; // dot
                while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
            }
            const raw = src.slice(start, i);
            push('dollar', start, i, raw);
            continue;
        }

        // Constant reference: @name
        if (ch === '@') {
            const start = i;
            i++;
            while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
            const raw = src.slice(start, i);
            // value is the name without the leading @
            push('constRef', start, i, raw.slice(1));
            continue;
        }

        // Quoted string (single or double)
        if (ch === '"' || ch === "'") {
            const quote = ch;
            const start = i;
            i++;
            let value = '';
            while (i < n && src[i] !== quote && src[i] !== '\n') {
                if (src[i] === '\\' && i + 1 < n) {
                    // simple escape passthrough
                    value += src[i + 1];
                    i += 2;
                } else {
                    value += src[i];
                    i++;
                }
            }
            if (src[i] === quote) i++;
            push('string', start, i, value);
            continue;
        }

        // Number
        if (/[0-9]/.test(ch)) {
            const start = i;
            while (i < n && /[0-9_]/.test(src[i])) i++;
            if (src[i] === '.' && i + 1 < n && /[0-9]/.test(src[i + 1])) {
                i++;
                while (i < n && /[0-9_]/.test(src[i])) i++;
            }
            if (src[i] === 'e' || src[i] === 'E') {
                i++;
                if (src[i] === '+' || src[i] === '-') i++;
                while (i < n && /[0-9]/.test(src[i])) i++;
            }
            push('number', start, i);
            continue;
        }

        // Identifier — letters, digits (not leading), _, -. Hyphenated idents are
        // recognised (`link-x`, `link-y`, etc.); we only accept a `-` when both
        // surrounding characters are word chars to avoid colliding with the
        // arithmetic minus.
        if (/[A-Za-z_]/.test(ch)) {
            const start = i;
            while (i < n) {
                const c = src[i];
                if (/[A-Za-z0-9_]/.test(c)) { i++; continue; }
                if (c === '-' && i + 1 < n && /[A-Za-z_]/.test(src[i + 1])) { i++; continue; }
                break;
            }
            const text = src.slice(start, i);
            const lc = text.toLowerCase();
            if (lc === 'true' || lc === 'false') {
                push('boolean', start, i);
            } else {
                push('ident', start, i);
            }
            continue;
        }

        // Unknown char — skip silently.
        i++;
    }

    tokens.push({ kind: 'eof', text: '', value: '', from: n, to: n });
    return tokens;
}
