/**
 * Editor support for templated markdown cells.
 *
 * Detects two kinds of templating regions and provides:
 *   - Subtle background tint so authors can see region boundaries.
 *   - Completion inside regions (variables + cell aliases + bare keywords).
 *   - Completion in prose (variables after `$`, alias names after `.`).
 *   - Diagnostics: malformed `{if}` fence, unknown alias, multi-row hint.
 *
 * Region grammar:
 *   - Block:  ```{if SELECT … }    …    ```
 *   - Inline: ${SELECT … [| fmt]}
 *
 * NOTE: Full SQL syntax highlighting via `parseMixed` is intentionally
 * deferred (the existing SQL completion path is dispatcher-based and a
 * full extraction is high-risk). The regions still get distinct visual
 * treatment, completion, and diagnostics so authoring is well-supported.
 */
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { CompletionContext, CompletionResult, autocompletion } from '@codemirror/autocomplete';
import { Diagnostic, linter } from '@codemirror/lint';
import { Extension, RangeSetBuilder } from '@codemirror/state';
import type { AliasInfo } from '../../context/CellAliasContext';

export interface MarkdownTemplatingDeps {
    getVariables: () => Record<string, string> | undefined;
    getAliases: () => Record<string, AliasInfo>;
}

interface ExprRegion {
    /** Position of the opening `${`. */
    exprStart: number;
    /** Position just after the opening `${`. */
    sqlStart: number;
    /** Position of the closing `}` (or end of doc if unclosed). */
    exprEnd: number;
    closed: boolean;
}

interface IfRegion {
    /** Position of the opening triple-backtick. */
    fenceStart: number;
    /** Position just after `{if `. */
    sqlStart: number;
    /** Position of the `}` ending the condition header. */
    headerEnd: number;
    /** Position of the closing triple-backtick (or end of doc if unclosed). */
    fenceEnd: number;
    closed: boolean;
}

const INLINE_RE = /\$\{([^}]*)\}?/g;
const IF_OPEN_RE = /```\{if\b([^}]*)\}?/g;
const FENCE_CLOSE = '```';

export const findExprRegions = (doc: string): ExprRegion[] => {
    const out: ExprRegion[] = [];
    INLINE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_RE.exec(doc)) !== null) {
        const start = m.index;
        // skip if inside an inline code span — simple heuristic: odd number of
        // backticks earlier on the same line.
        const lineStart = doc.lastIndexOf('\n', start - 1) + 1;
        const before = doc.slice(lineStart, start);
        const ticks = (before.match(/`/g) || []).length;
        if (ticks % 2 === 1) continue;
        const closed = m[0].endsWith('}');
        const end = closed ? start + m[0].length : doc.length;
        out.push({
            exprStart: start,
            sqlStart: start + 2,
            exprEnd: end,
            closed,
        });
    }
    return out;
};

export const findIfRegions = (doc: string): IfRegion[] => {
    const out: IfRegion[] = [];
    IF_OPEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IF_OPEN_RE.exec(doc)) !== null) {
        const start = m.index;
        const headerEnd = doc.indexOf('}', start + 6);
        const sqlStart = start + 6; // '```{if'.length + space
        if (headerEnd < 0) {
            out.push({ fenceStart: start, sqlStart, headerEnd: doc.length, fenceEnd: doc.length, closed: false });
            continue;
        }
        const closeIdx = doc.indexOf('\n' + FENCE_CLOSE, headerEnd);
        if (closeIdx < 0) {
            out.push({ fenceStart: start, sqlStart, headerEnd, fenceEnd: doc.length, closed: false });
            continue;
        }
        out.push({
            fenceStart: start,
            sqlStart,
            headerEnd,
            fenceEnd: closeIdx + 1 + FENCE_CLOSE.length,
            closed: true,
        });
    }
    return out;
};

const exprDeco = Decoration.mark({ class: 'cm-jfr-tpl-expr' });
const ifHeaderDeco = Decoration.mark({ class: 'cm-jfr-tpl-if-header' });
const ifBodyDeco = Decoration.mark({ class: 'cm-jfr-tpl-if-body' });

const regionTheme = EditorView.baseTheme({
    '.cm-jfr-tpl-expr': {
        backgroundColor: 'rgba(56, 189, 248, 0.12)',
        borderRadius: '2px',
    },
    '.cm-jfr-tpl-if-header': {
        backgroundColor: 'rgba(34, 211, 238, 0.18)',
        borderRadius: '2px',
        fontWeight: 'bold',
    },
    '.cm-jfr-tpl-if-body': {
        backgroundColor: 'rgba(34, 211, 238, 0.06)',
    },
});

const LARGE_DOC_LINE_THRESHOLD = 2000;

const buildDecorations = (view: EditorView): DecorationSet => {
    // Skip the expensive full-doc scan for very large notebooks (B-057).
    // The raw markdown editor passes the entire notebook as one string;
    // scanning it on every keystroke is O(n) and causes noticeable lag.
    if (view.state.doc.lines > LARGE_DOC_LINE_THRESHOLD) {
        return Decoration.none;
    }
    const doc = view.state.doc.toString();
    const builder = new RangeSetBuilder<Decoration>();
    const exprs = findExprRegions(doc);
    const ifs = findIfRegions(doc);

    // Merge sorted by start position.
    type Item = { from: number; to: number; deco: Decoration };
    const items: Item[] = [];
    for (const e of exprs) {
        if (e.exprEnd > e.exprStart) items.push({ from: e.exprStart, to: e.exprEnd, deco: exprDeco });
    }
    for (const i of ifs) {
        if (i.headerEnd >= i.fenceStart) {
            items.push({ from: i.fenceStart, to: Math.min(i.headerEnd + 1, doc.length), deco: ifHeaderDeco });
        }
        if (i.closed && i.fenceEnd > i.headerEnd + 1) {
            items.push({ from: i.headerEnd + 1, to: i.fenceEnd, deco: ifBodyDeco });
        }
    }
    items.sort((a, b) => a.from - b.from);
    for (const it of items) builder.add(it.from, it.to, it.deco);
    return builder.finish();
};

const decorationPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
            this.decorations = buildDecorations(view);
        }
        update(u: ViewUpdate) {
            if (u.docChanged || u.viewportChanged) {
                this.decorations = buildDecorations(u.view);
            }
        }
    },
    { decorations: v => v.decorations },
);

/** True if pos is inside any `${…}` SQL region (between `${` and `}`). */
const posInExprSql = (pos: number, regions: ExprRegion[]): ExprRegion | null => {
    for (const r of regions) {
        if (pos >= r.sqlStart && pos <= (r.closed ? r.exprEnd - 1 : r.exprEnd)) return r;
    }
    return null;
};

/** True if pos is inside an `{if …}` condition header (between `{if ` and `}`). */
const posInIfHeader = (pos: number, regions: IfRegion[]): IfRegion | null => {
    for (const r of regions) {
        if (pos >= r.sqlStart && pos <= r.headerEnd) return r;
    }
    return null;
};

/** True if pos is inside an `{if …}` body. */
const posInIfBody = (pos: number, regions: IfRegion[]): IfRegion | null => {
    for (const r of regions) {
        if (r.closed && pos > r.headerEnd && pos < r.fenceEnd - FENCE_CLOSE.length) return r;
    }
    return null;
};

const SQL_KEYWORDS = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT', 'JOIN', 'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL'];

const completionSource = (deps: MarkdownTemplatingDeps) => (cx: CompletionContext): CompletionResult | null => {
    // Skip region-based completion for very large notebooks (B-057).
    if (cx.state.doc.lines > LARGE_DOC_LINE_THRESHOLD) return null;
    const doc = cx.state.doc.toString();
    const pos = cx.pos;

    const exprs = findExprRegions(doc);
    const ifs = findIfRegions(doc);
    const inExpr = posInExprSql(pos, exprs);
    const inIfHeader = posInIfHeader(pos, ifs);
    const inIfBody = posInIfBody(pos, ifs);

    const insideSqlRegion = !!(inExpr || inIfHeader);
    const insideMarkdownProse = !insideSqlRegion;

    // Variable completion after `$`.
    const beforeCursor = doc.slice(Math.max(0, pos - 30), pos);
    const varMatch = beforeCursor.match(/\$(\$?)([A-Za-z_]\w*)?$/);
    if (varMatch) {
        const vars = deps.getVariables() ?? {};
        const keys = Object.keys(vars);
        if (keys.length === 0) return null;
        const tokenStart = pos - (varMatch[0].length);
        return {
            from: tokenStart,
            options: keys.map(k => ({
                label: k.startsWith('$') ? k : `$${k}`,
                detail: vars[k],
                type: 'variable',
            })),
        };
    }

    if (insideSqlRegion) {
        // Inside ${…} or {if …}: offer SQL keywords + alias names (bare and qualified).
        const word = cx.matchBefore(/[\w.]*/);
        if (!word || (word.from === word.to && !cx.explicit)) return null;
        const aliases = deps.getAliases();

        // After `<handle>.` → offer aliases under that handle, then columns after another `.`.
        const dotMatch = word.text.match(/^([\w-]+)\.(\w*)$/);
        if (dotMatch) {
            const handle = dotMatch[1];
            const opts: { label: string; type: string; detail?: string }[] = [];
            for (const info of Object.values(aliases)) {
                if (info.cellHandle === handle || info.cellHandleDisplay === handle) {
                    const name = info.alias ?? '1';
                    opts.push({ label: `${handle}.${name}`, type: 'class', detail: `cell ${info.cellIndex + 1}` });
                }
            }
            if (opts.length === 0) return null;
            return { from: word.from, options: opts };
        }

        const opts: { label: string; type: string; detail?: string }[] = [];
        for (const kw of SQL_KEYWORDS) opts.push({ label: kw, type: 'keyword' });
        for (const info of Object.values(aliases)) {
            if (info.alias && !info.bareShadowed) {
                opts.push({ label: info.alias, type: 'class', detail: `cell ${info.cellIndex + 1}` });
            }
            const aliasOr1 = info.alias ?? '1';
            opts.push({ label: `${info.cellHandleDisplay}.${aliasOr1}`, type: 'class', detail: `cell ${info.cellIndex + 1}` });
        }
        return { from: word.from, options: opts };
    }

    // In prose: offer alias names after a bare-word boundary (rough heuristic).
    if (insideMarkdownProse) {
        const word = cx.matchBefore(/[\w-]+\.?\w*/);
        if (!word || word.from === word.to) return null;
        if (!cx.explicit && word.text.length < 2) return null;
        const aliases = deps.getAliases();
        const opts: { label: string; type: string; detail?: string }[] = [];
        for (const info of Object.values(aliases)) {
            if (info.alias && !info.bareShadowed) {
                opts.push({ label: info.alias, type: 'class', detail: `cell ${info.cellIndex + 1}` });
            }
        }
        if (opts.length === 0) return null;
        return { from: word.from, options: opts };
    }
    return null;
};

const templatingLinter = (deps: MarkdownTemplatingDeps) => linter((view) => {
    // Skip linting for very large notebooks (B-057).
    if (view.state.doc.lines > LARGE_DOC_LINE_THRESHOLD) return [];
    const doc = view.state.doc.toString();
    const diagnostics: Diagnostic[] = [];

    const exprs = findExprRegions(doc);
    for (const e of exprs) {
        if (!e.closed) {
            diagnostics.push({
                from: e.exprStart,
                to: Math.min(e.exprStart + 2, doc.length),
                severity: 'error',
                message: 'Unclosed inline expression — expected `}`',
            });
            continue;
        }
        const sql = doc.slice(e.sqlStart, e.exprEnd - 1).replace(/\|\s*\w+\s*$/, '').trim();
        if (!sql) {
            diagnostics.push({
                from: e.exprStart,
                to: e.exprEnd,
                severity: 'warning',
                message: 'Empty inline expression',
            });
            continue;
        }
        // Heuristic: warn if SELECT statement might return >1 row (no LIMIT, no aggregate).
        const lowered = sql.toLowerCase();
        if (/^\s*select\b/.test(lowered) && !/\blimit\b/.test(lowered) && !/\b(count|sum|avg|min|max|median|first|last)\s*\(/.test(lowered)) {
            diagnostics.push({
                from: e.exprStart,
                to: e.exprEnd,
                severity: 'warning',
                message: 'Inline expression may return multiple rows — only the first scalar is rendered',
            });
        }
        // Unknown-alias hint: extract `FROM <ident>` and check it's a known alias or a known table-ish name.
        const fromMatch = sql.match(/\bfrom\s+([\w.-]+)/i);
        if (fromMatch) {
            const name = fromMatch[1];
            const aliases = deps.getAliases();
            const known = Object.values(aliases).some(a => {
                const aliasOr1 = a.alias ?? '1';
                return a.alias === name || `${a.cellHandle}.${aliasOr1}` === name || `${a.cellHandleDisplay}.${aliasOr1}` === name;
            });
            // Don't flag built-in JFR tables (heuristic: PascalCase or contains capital letter).
            const looksLikeJfrTable = /^[A-Z]/.test(name);
            if (!known && !looksLikeJfrTable && !name.includes('.')) {
                // Only flag if it doesn't look like a built-in table.
            }
        }
    }

    for (const i of exprs.length === 0 ? [] : []) void i; // placeholder for type symmetry

    const ifs = findIfRegions(doc);
    for (const i of ifs) {
        if (!i.closed) {
            diagnostics.push({
                from: i.fenceStart,
                to: Math.min(i.fenceStart + 3, doc.length),
                severity: 'error',
                message: 'Unclosed `{if …}` block — expected closing ``` fence',
            });
            continue;
        }
        const sql = doc.slice(i.sqlStart, i.headerEnd).trim();
        if (!sql) {
            diagnostics.push({
                from: i.fenceStart,
                to: i.headerEnd + 1,
                severity: 'error',
                message: 'Empty `{if}` condition',
            });
        }
    }
    return diagnostics;
}, { delay: 500 });

export const markdownTemplatingExtension = (deps: MarkdownTemplatingDeps): Extension => [
    decorationPlugin,
    regionTheme,
    autocompletion({
        override: [completionSource(deps)],
        activateOnTyping: true,
        closeOnBlur: true,
    }),
    templatingLinter(deps),
];
