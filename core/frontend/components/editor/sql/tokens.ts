// SQL tokenizer for the partial DuckDB parser.
//
// Single pass. Emits a stream of tokens with absolute offsets into the input.
// The tokenizer is forgiving: unterminated strings/comments produce a token
// covering "as much as possible" so the parser still has something to attach
// a hole node to. EOF is always the final token.

export type TokenKind =
    | 'keyword'
    | 'ident'
    | 'quoted_ident'       // "foo bar"
    | 'string'             // 'hello'
    | 'number'
    | 'punct'              // ( ) , ; .
    | 'op'                 // + - * / % = <> < > <= >= ! and friends
    | 'cast'               // ::
    | 'concat'             // ||
    | 'arrow'              // -> or =>
    | 'dollar'             // $foo or $$foo (variable refs)
    | 'whitespace'
    | 'comment'
    | 'unknown'
    | 'eof';

export interface Token {
    kind: TokenKind;
    text: string;
    from: number;
    to: number;
    // For keywords, the canonical uppercase form. For idents, the original case.
    // For strings/quoted_ident, the *raw* text including the surrounding quotes —
    // callers can strip if they want the inner value.
    value: string;
}

// Set of DuckDB SQL keywords we care about. Anything not in here is treated as
// a bare identifier — including DuckDB-specific functions like list_transform,
// which the function annotator looks up separately.
//
// Source: DuckDB's reserved + non-reserved keyword tables, filtered to those
// that change parser behavior (clause starters, operators-as-words, set ops,
// etc.). Adding more is cheap; missing one means it parses as an ident, which
// is usually fine.
export const KEYWORDS = new Set<string>([
    'select', 'from', 'where', 'group', 'by', 'having', 'order', 'limit',
    'offset', 'qualify', 'with', 'recursive', 'as', 'distinct', 'all',
    'union', 'intersect', 'except',
    'join', 'inner', 'left', 'right', 'full', 'outer', 'cross', 'natural',
    'on', 'using', 'lateral', 'asof', 'positional', 'anti', 'semi',
    'and', 'or', 'not', 'in', 'is', 'null', 'true', 'false',
    'between', 'like', 'ilike', 'similar', 'to', 'glob', 'regexp',
    'exists', 'any', 'some',
    'case', 'when', 'then', 'else', 'end',
    'cast', 'try_cast',
    'over', 'partition', 'window', 'filter',
    'rows', 'range', 'groups', 'preceding', 'following', 'current', 'row',
    'unbounded',
    'asc', 'desc', 'nulls', 'first', 'last',
    'columns', 'exclude', 'replace', 'rename', 'star',
    'pivot', 'unpivot',
    'create', 'table', 'view', 'temporary', 'temp',
    'insert', 'into', 'values', 'update', 'delete', 'set',
    'drop', 'alter', 'add', 'column',
    'array', 'struct', 'map', 'list',
    'tinyint', 'smallint', 'integer', 'int', 'bigint', 'hugeint',
    'real', 'double', 'decimal', 'numeric',
    'varchar', 'char', 'text', 'blob',
    'boolean', 'bool', 'date', 'time', 'timestamp', 'timestamptz', 'interval',
    'json', 'uuid',
    'unsigned', 'signed',
    'returning', 'conflict', 'do', 'nothing', 'duplicate', 'key',
    'macro', 'function', 'lambda',
]);

const SINGLE_CHAR_PUNCT = new Set(['(', ')', ',', ';', '.', '[', ']', '{', '}']);

// Operators sorted longest-first so the matcher tries `<=` before `<`.
const OPERATORS = [
    '<=>', '<<=', '>>=',
    '||', '::', '<>', '!=', '<=', '>=', '->>', '->', '=>',
    '<<', '>>', '**',
    '+', '-', '*', '/', '%', '=', '<', '>', '!', '^', '~', '&', '|', '?',
];

export function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const n = source.length;

    while (i < n) {
        const c = source[i];
        const start = i;

        // Whitespace
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
            while (i < n && /\s/.test(source[i])) i++;
            tokens.push({ kind: 'whitespace', text: source.slice(start, i), from: start, to: i, value: '' });
            continue;
        }

        // Line comment --...
        if (c === '-' && source[i + 1] === '-') {
            while (i < n && source[i] !== '\n') i++;
            tokens.push({ kind: 'comment', text: source.slice(start, i), from: start, to: i, value: '' });
            continue;
        }

        // Block comment /* ... */
        if (c === '/' && source[i + 1] === '*') {
            i += 2;
            while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
            if (i < n) i += 2; // consume */
            tokens.push({ kind: 'comment', text: source.slice(start, i), from: start, to: i, value: '' });
            continue;
        }

        // Double-quoted identifier "foo bar" — "" escapes a literal quote.
        if (c === '"') {
            i++;
            while (i < n) {
                if (source[i] === '"') {
                    if (source[i + 1] === '"') { i += 2; continue; } // escaped quote
                    i++; // closing quote
                    break;
                }
                i++;
            }
            const text = source.slice(start, i);
            tokens.push({ kind: 'quoted_ident', text, from: start, to: i, value: text });
            continue;
        }

        // Single-quoted string 'hello' — '' escapes a literal quote.
        if (c === "'") {
            i++;
            while (i < n) {
                if (source[i] === "'") {
                    if (source[i + 1] === "'") { i += 2; continue; }
                    i++;
                    break;
                }
                i++;
            }
            const text = source.slice(start, i);
            tokens.push({ kind: 'string', text, from: start, to: i, value: text });
            continue;
        }

        // Dollar variable: $foo, $$foo, $foo.brush
        // We emit the full run including dots — the parser splits later.
        if (c === '$') {
            i++;
            // double-dollar?
            if (i < n && source[i] === '$') i++;
            while (i < n && /[A-Za-z0-9_.]/.test(source[i])) i++;
            const text = source.slice(start, i);
            tokens.push({ kind: 'dollar', text, from: start, to: i, value: text });
            continue;
        }

        // Number: 123, 12.5, 1e10, 0xff, .5, 1.5e-3
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
            // Hex literal
            if (c === '0' && (source[i + 1] === 'x' || source[i + 1] === 'X')) {
                i += 2;
                while (i < n && /[0-9a-fA-F_]/.test(source[i])) i++;
            } else {
                while (i < n && /[0-9_]/.test(source[i])) i++;
                if (source[i] === '.') {
                    i++;
                    while (i < n && /[0-9_]/.test(source[i])) i++;
                }
                if (source[i] === 'e' || source[i] === 'E') {
                    i++;
                    if (source[i] === '+' || source[i] === '-') i++;
                    while (i < n && /[0-9]/.test(source[i])) i++;
                }
            }
            const text = source.slice(start, i);
            tokens.push({ kind: 'number', text, from: start, to: i, value: text });
            continue;
        }

        // Identifier or keyword
        if (/[A-Za-z_]/.test(c)) {
            while (i < n && /[A-Za-z0-9_]/.test(source[i])) i++;
            const text = source.slice(start, i);
            const lower = text.toLowerCase();
            if (KEYWORDS.has(lower)) {
                tokens.push({ kind: 'keyword', text, from: start, to: i, value: text.toUpperCase() });
            } else {
                tokens.push({ kind: 'ident', text, from: start, to: i, value: text });
            }
            continue;
        }

        // Single-char punctuation
        if (SINGLE_CHAR_PUNCT.has(c)) {
            i++;
            tokens.push({ kind: 'punct', text: c, from: start, to: i, value: c });
            continue;
        }

        // Multi-char operators (longest-first)
        let matched: string | null = null;
        for (const op of OPERATORS) {
            if (source.startsWith(op, i)) { matched = op; break; }
        }
        if (matched) {
            i += matched.length;
            const kind: TokenKind =
                matched === '::' ? 'cast' :
                matched === '||' ? 'concat' :
                (matched === '->' || matched === '=>') ? 'arrow' :
                'op';
            tokens.push({ kind, text: matched, from: start, to: i, value: matched });
            continue;
        }

        // Anything else — single-char unknown so the loop makes progress.
        i++;
        tokens.push({ kind: 'unknown', text: c, from: start, to: i, value: c });
    }

    tokens.push({ kind: 'eof', text: '', from: n, to: n, value: '' });
    return tokens;
}

// Convenience: tokenize and drop whitespace + comments. Most callers want this.
export function tokenizeSignificant(source: string): Token[] {
    return tokenize(source).filter(t => t.kind !== 'whitespace' && t.kind !== 'comment');
}

// True if `t` is a keyword whose canonical (uppercase) form matches `kw`.
export function isKeyword(t: Token, kw: string): boolean {
    return t.kind === 'keyword' && t.value === kw.toUpperCase();
}

// True if `t` is punctuation matching `p` (e.g. '(', ',').
export function isPunct(t: Token, p: string): boolean {
    return t.kind === 'punct' && t.value === p;
}
