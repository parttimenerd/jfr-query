/**
 * Splits markdown prose into a sequence of literal-text segments and inline
 * `${SELECT … | format?}` expressions.
 *
 * The lexer ignores `${…}` inside backtick code spans (`` `…` ``) and inside
 * triple-backtick code fences. Everywhere else, the FIRST `}` ends the
 * expression — `${SELECT 1}` cannot itself contain a `}` in v1 (string
 * literals containing braces are not supported; use the cell's own SQL block).
 *
 * Each `InlineExpr` carries an optional `format` hint taken from a trailing
 * `| <ident>` inside the braces, e.g. `${SELECT … | bytes}` — provided the
 * ident matches the accepted format list. Otherwise the `|` is left in the
 * SQL (preserving SQL's bitwise-or semantics).
 */

export type ProseSegment =
    | { type: 'text'; value: string }
    | { type: 'expr'; sql: string; format?: string };

const ACCEPTED_FORMATS = new Set([
    'duration_ms', 'duration_ns', 'bytes', 'pct', 'int', 'float', 'time', 'raw',
]);

/** Find the start index of every `${` that is NOT inside a code span / fence. */
const findExprStarts = (markdown: string): number[] => {
    const starts: number[] = [];
    let i = 0;
    const n = markdown.length;
    let inFence = false;
    while (i < n) {
        // Triple-fence detection (start or end). We don't care WHICH fence;
        // just toggle so we skip inline expressions inside any fence.
        if (markdown[i] === '`' && markdown[i + 1] === '`' && markdown[i + 2] === '`') {
            inFence = !inFence;
            i += 3;
            continue;
        }
        if (inFence) { i++; continue; }

        // Inline code span — single or double backtick, ends at matching delimiter
        // on the same line (markdown-style). Walk through.
        if (markdown[i] === '`') {
            if (markdown[i + 1] === '`') {
                // Double-backtick span: walk until `` `` `` or newline.
                i += 2;
                while (i < n && !(markdown[i] === '`' && markdown[i + 1] === '`') && markdown[i] !== '\n') i++;
                if (i < n && markdown[i] === '`') i += 2;
            } else {
                i++;
                while (i < n && markdown[i] !== '`' && markdown[i] !== '\n') i++;
                if (i < n && markdown[i] === '`') i++;
            }
            continue;
        }

        if (markdown[i] === '$' && markdown[i + 1] === '{') {
            starts.push(i);
            i += 2;
            continue;
        }
        i++;
    }
    return starts;
};

/**
 * Splits a markdown string into prose segments. The original text can be
 * reconstructed by concatenating `text` and re-wrapping `expr` as
 * `${expr.sql | expr.format?}`; the lexer is therefore lossy on whitespace
 * inside `${…}` braces and on the choice between `| format` vs. no format.
 */
export const splitInlineExprs = (markdown: string): ProseSegment[] => {
    const starts = findExprStarts(markdown);
    if (starts.length === 0) {
        return markdown.length > 0 ? [{ type: 'text', value: markdown }] : [];
    }

    const out: ProseSegment[] = [];
    let cursor = 0;
    for (const startIdx of starts) {
        if (startIdx < cursor) continue;
        if (startIdx > cursor) {
            out.push({ type: 'text', value: markdown.substring(cursor, startIdx) });
        }
        // Find closing `}` — first one, no nesting in v1.
        const closeIdx = markdown.indexOf('}', startIdx + 2);
        if (closeIdx === -1) {
            // Malformed — surface as text and stop lexing.
            out.push({ type: 'text', value: markdown.substring(startIdx) });
            return out;
        }
        const inner = markdown.substring(startIdx + 2, closeIdx);
        // Trailing `| format` — only when format is in the accepted set.
        let sql = inner;
        let format: string | undefined;
        const pipeIdx = inner.lastIndexOf('|');
        if (pipeIdx > 0) {
            const right = inner.substring(pipeIdx + 1).trim();
            if (ACCEPTED_FORMATS.has(right)) {
                format = right;
                sql = inner.substring(0, pipeIdx);
            }
        }
        out.push({ type: 'expr', sql: sql.trim(), format });
        cursor = closeIdx + 1;
    }
    if (cursor < markdown.length) {
        out.push({ type: 'text', value: markdown.substring(cursor) });
    }
    return out;
};
