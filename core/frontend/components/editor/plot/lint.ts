// lint.ts — pure AST-based linter for the plot DSL.
//
// Walks the annotated plot AST (after `parseAndAnnotate` has run) and emits
// CodeMirror `Diagnostic` objects with optional `actions` (fix suggestions).
// Mirrors the shape of `components/editor/sql/lint.ts`: same `Diagnostic[]`
// return type, same `hasHoleAncestor` mid-typing guard, same wiring via
// `components/editor/diagnostics.ts`.
//
// See `plot/holeKinds.ts` for the `PlotDiagnostic` shape that annotators
// (P1) attach to nodes; this linter reads those, plus walks the AST itself
// for rules that need cross-node context (missing required clauses,
// dangling tails, brush-on-unbrushed-plot, …).

import type { Diagnostic, Action } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import { walk, type PlotNode } from './ast';
import { parseAndAnnotate } from './index';
import type { ShapeRegistry } from './annotators/shapeAnnotator';
import type { ColumnSchema } from './ast';
import { KNOWN_SHAPES, UPPERCASE_TAIL_KEYWORDS, LOWERCASE_TAIL_KEYS } from './parser';
import type { PlotScopePlot } from './aiPlotContext';

// ─── Public deps + entry ──────────────────────────────────────────────────────

export interface PlotScopeView {
    /** Named plots in scope (this cell + prior cells). */
    namedPlots: PlotScopePlot[];
}

export interface PlotLintDeps {
    /** Built-in registry + dynamic shape entries from P1. */
    shapeRegistry: ShapeRegistry;
    /** Cell columns (P2 cache). May be null when schema discovery hasn't run. */
    cellColumns: ColumnSchema[] | null;
    /** Cross-plot scope (P3). May be null. */
    notebookScope: PlotScopeView | null;
    /** Number of SQL blocks in the surrounding cell (for query-ref range check). */
    sqlBlockCount: number;
    /** Variable map (cell + workspace, $-prefixed keys without leading $). */
    variables: Record<string, string>;
    /**
     * Current cursor position in the source (byte offset). When provided,
     * `hasMidTypingHoleAncestor` only suppresses lint for hole ancestors that
     * actually contain the cursor — preventing stale suppression after the user
     * moves the cursor away (B-169).
     */
    cursorPos?: number;
}

export function lintPlot(source: string, deps: PlotLintDeps): Diagnostic[] {
    const { root } = parseAndAnnotate({
        src: source,
        resultColumns: deps.cellColumns ?? undefined,
        shapeRegistry: deps.shapeRegistry,
        cursorPos: deps.cursorPos,
    });

    const diagnostics: Diagnostic[] = [];
    const known = new Set(Object.keys(deps.shapeRegistry));
    // Always include parser's KNOWN_SHAPES — those are syntactically recognized
    // even if the registry isn't fully populated.
    for (const s of KNOWN_SHAPES) known.add(s);

    const knownPlotNames = new Set(
        (deps.notebookScope?.namedPlots ?? []).map(p => p.name.toLowerCase()),
    );
    const brushedPlots = new Set(
        (deps.notebookScope?.namedPlots ?? [])
            .filter(p => p.hasBrush)
            .map(p => p.name.toLowerCase()),
    );

    walk(root, (node) => {
        // Mid-typing guard — never emit if we're inside an active clause-key
        // or clause-value hole (the user is still typing).
        if (hasMidTypingHoleAncestor(node, deps.cursorPos)) return;

        switch (node.kind) {
            case 'plotCall':
                lintPlotCall(node, deps, known, diagnostics);
                return;
            case 'clauseRef':
                lintClauseRef(node, deps, diagnostics);
                return;
            case 'tailRef':
                lintTailRef(node, diagnostics);
                return;
            case 'ident':
                lintIdent(node, deps, diagnostics);
                return;
            case 'literal':
                lintLiteral(node, diagnostics);
                return;
            case 'constRef':
                // The constAnnotator already populates structured intent on
                // the legacy diagnostics channel. Surface those as warnings.
                lintConstRef(node, diagnostics);
                return;
            case 'letStatement':
                lintLetStatement(node, diagnostics);
                return;
            case 'queryRef':
                lintQueryRef(node, deps, diagnostics);
                return;
            case 'composite':
                lintComposite(node, diagnostics);
                return;
            case 'tail':
                lintTail(node, deps, knownPlotNames, brushedPlots, diagnostics);
                return;
            case 'varRef':
                lintVarRef(node, deps, brushedPlots, diagnostics);
                return;
        }
    });

    return diagnostics;
}

// ─── Mid-typing guard ─────────────────────────────────────────────────────────

/**
 * True if `node` is inside an active clauseKey / clauseValue / letName /
 * letValue / queryRefTarget hole (i.e. the user is mid-typing). Mirrors the
 * SQL `hasHoleAncestor` guard.
 *
 * When `cursorPos` is provided, a hole only suppresses lint if the cursor
 * is currently within the hole's source range — preventing stale suppression
 * after the user moves the cursor away from a previously-active hole (B-169).
 * When `cursorPos` is omitted, any hole ancestor suppresses (conservative
 * fallback for callers that don't track cursor position).
 */
function hasMidTypingHoleAncestor(node: PlotNode, cursorPos?: number): boolean {
    let cur: PlotNode | undefined = node;
    while (cur) {
        if (cur.kind === 'hole') {
            // If a cursor position is available, only suppress when the cursor
            // is actually inside this hole.  Holes are zero-length tokens
            // (from === to), so the cursor must equal their position exactly.
            if (cursorPos !== undefined) {
                if (cursorPos >= cur.from && cursorPos <= cur.to) return true;
                // Hole exists but cursor isn't here — keep walking up.
            } else {
                // No cursor info — conservative: suppress on any hole ancestor.
                return true;
            }
        }
        cur = cur.parent;
    }
    return false;
}

// ─── Per-node rules ───────────────────────────────────────────────────────────

function lintPlotCall(
    node: PlotNode,
    deps: PlotLintDeps,
    known: Set<string>,
    out: Diagnostic[],
): void {
    const shape = node.shape;
    if (!shape || !node.shapeRaw) return;
    // unknown-shape
    if (!known.has(shape)) {
        const from = node.from;
        const to = node.from + node.shapeRaw.length;
        const closest = closestMatch(shape, [...known]);
        const actions: Action[] = [];
        if (closest) {
            actions.push(replaceAction(`Replace with '${closest.toUpperCase()}'`, from, to, closest.toUpperCase()));
        }
        out.push({
            from,
            to,
            severity: 'error',
            message: `Unknown plot shape '${node.shapeRaw}'.${closest ? ` Did you mean '${closest.toUpperCase()}'?` : ''}`,
            actions,
        });
        return;
    }

    // missing-required-clause — only meaningful if the shape is registered
    const entry = deps.shapeRegistry[shape];
    const resolves = node.annotations.resolves;
    if (!entry || !resolves || resolves.kind !== 'plotShape') return;
    const required = (entry.requiredClauses ?? []).map(s => s.toLowerCase());
    if (required.length === 0) return;
    const usedKeys = node.children
        .filter(c => c.kind === 'clause' && c.key)
        .map(c => c.key!.toLowerCase());
    const missing = required.filter(k => !usedKeys.includes(k));
    if (missing.length === 0) return;
    // Underline the shape name span.
    const shapeFrom = node.from;
    const shapeTo = node.from + node.shapeRaw.length;
    // Find insertion point for fix actions — just before the body close, or
    // at the end of the call if there's no body.
    const insertPos = findClauseInsertPos(node);
    const actions: Action[] = missing.map(key => ({
        name: `Add missing clause '${key}'`,
        apply: (view, _from, _to) => {
            const prefix = needsCommaBefore(node) ? ', ' : '';
            insertAt(view, insertPos, `${prefix}${key}: `);
        },
    }));
    out.push({
        from: shapeFrom,
        to: shapeTo,
        severity: 'warning',
        message: `Shape '${entry.name}' is missing required clause${missing.length > 1 ? 's' : ''}: ${missing.map(k => `'${k}'`).join(', ')}.`,
        actions,
    });
}

function lintClauseRef(node: PlotNode, deps: PlotLintDeps, out: Diagnostic[]): void {
    // Find the enclosing plotCall for context.
    const call = findAncestor(node, 'plotCall');
    if (!call || !call.shape) return;
    const entry = deps.shapeRegistry[call.shape];
    if (!entry) return; // shape itself unknown — covered by lintPlotCall
    const valid = (entry.validClauses ?? []).map(s => s.toLowerCase());
    if (valid.length === 0) return;
    const key = (node.key ?? node.name ?? '').toLowerCase();
    if (!key || valid.includes(key)) return;
    const usedKeys = call.children
        .filter(c => c.kind === 'clause' && c.key)
        .map(c => c.key!.toLowerCase());
    const required = (entry.requiredClauses ?? []).map(s => s.toLowerCase());
    const missingRequired = required.filter(k => !usedKeys.includes(k) && k !== key);
    const closest = closestMatch(key, valid);
    const actions: Action[] = [];
    // Prefer a missing-required suggestion as the primary action.
    if (missingRequired.length > 0) {
        actions.push(replaceAction(`Replace with '${missingRequired[0]}'`, node.from, node.to, missingRequired[0]));
    }
    if (closest && closest !== missingRequired[0]) {
        actions.push(replaceAction(`Replace with '${closest}'`, node.from, node.to, closest));
    }
    const suggestionList = valid.slice(0, 5).join(', ');
    out.push({
        from: node.from,
        to: node.to,
        severity: 'error',
        message: `Unknown clause '${key}' for shape '${entry.name}'. Valid: ${suggestionList}.`,
        actions,
    });
}

function lintTailRef(node: PlotNode, out: Diagnostic[]): void {
    const raw = node.keyRaw ?? node.name ?? node.text ?? '';
    if (!raw) return;
    const upper = raw.toUpperCase();
    const lower = raw.toLowerCase();
    if (UPPERCASE_TAIL_KEYWORDS.has(upper)) return;
    if (LOWERCASE_TAIL_KEYS.has(lower)) return;
    // Pick the right case set based on the original casing.
    const isUpper = raw === raw.toUpperCase() && /[A-Z]/.test(raw);
    const candidates = isUpper ? [...UPPERCASE_TAIL_KEYWORDS] : [...LOWERCASE_TAIL_KEYS];
    const closest = closestMatch(isUpper ? upper : lower, candidates);
    const actions: Action[] = [];
    if (closest) {
        actions.push(replaceAction(`Replace with '${closest}'`, node.from, node.to, closest));
    }
    out.push({
        from: node.from,
        to: node.to,
        severity: 'error',
        message: `Unknown tail keyword '${raw}'.${closest ? ` Did you mean '${closest}'?` : ''}`,
        actions,
    });
}

function lintIdent(node: PlotNode, deps: PlotLintDeps, out: Diagnostic[]): void {
    // unknown-column rule. Only fire when:
    //   1. The ident is inside a column-typed clause (parent.clauseDef.paramType === 'column'),
    //   2. The ident did not resolve to a column (resolves is missing or non-column),
    //   3. deps.cellColumns is non-null (we know what columns exist).
    if (!node.name) return;
    // $variable references are runtime substitutions — skip column validation.
    if (node.name.startsWith('$')) return;
    if (deps.cellColumns === null) {
        // column-without-schema (informational; only emit if we're in a
        // column-typed clause)
        if (!isInColumnClause(node, deps)) return;
        out.push({
            from: node.from,
            to: node.to,
            severity: 'info',
            message: `Column '${node.name}' — cell schema is unknown yet; cannot verify.`,
        });
        return;
    }
    if (node.annotations.resolves?.kind === 'column') return;
    if (!isInColumnClause(node, deps)) return;
    const names = deps.cellColumns.map(c => c.name);
    if (names.some(n => n.toLowerCase() === node.name!.toLowerCase())) return; // matched
    const closest = closestMatch(node.name, names);
    const actions: Action[] = [];
    if (closest) {
        actions.push(replaceAction(`Replace with '${closest}'`, node.from, node.to, closest));
    }
    const top = names.slice(0, 5).join(', ');
    out.push({
        from: node.from,
        to: node.to,
        severity: 'error',
        message: `Unknown column '${node.name}'.${closest ? ` Did you mean '${closest}'?` : ''}${top ? ` Available: ${top}.` : ''}`,
        actions,
    });
}

function lintLiteral(node: PlotNode, out: Diagnostic[]): void {
    // dimension-format — WIDTH 400 / HEIGHT 400 with no unit. Fires when a
    // bare number literal is the direct child of a tail whose key is width
    // or height.
    if (node.literalKind !== 'number') return;
    const parent = node.parent;
    if (!parent || parent.kind !== 'tail') return;
    const tailKey = (parent.key ?? '').toLowerCase();
    if (tailKey !== 'width' && tailKey !== 'height') return;
    out.push({
        from: node.from,
        to: node.to,
        severity: 'warning',
        message: `Dimension should include a unit ('px' or '%'). Got '${node.text}'.`,
        actions: [
            replaceAction(`Add 'px' suffix`, node.from, node.to, `${node.text}px`),
            replaceAction(`Add '%' suffix`, node.from, node.to, `${node.text}%`),
        ],
    });
}

function lintConstRef(node: PlotNode, out: Diagnostic[]): void {
    const diags = node.annotations.diagnostics;
    if (!diags || diags.length === 0) return;
    // Skip if this constRef is the LHS of a letStatement.
    if (node.parent?.kind === 'letStatement' && node.parent.children[0] === node) return;
    for (const d of diags) {
        if (/Forward reference/i.test(d)) {
            out.push({
                from: node.from,
                to: node.to,
                severity: 'warning',
                message: d,
            });
        } else if (/Undefined constant/i.test(d)) {
            out.push({
                from: node.from,
                to: node.to,
                severity: 'error',
                message: d,
            });
        }
    }
}

function lintLetStatement(node: PlotNode, out: Diagnostic[]): void {
    const diags = node.annotations.diagnostics;
    if (!diags || diags.length === 0) return;
    for (const d of diags) {
        if (/Cycle detected/i.test(d)) {
            out.push({
                from: node.from,
                to: node.to,
                severity: 'error',
                message: d,
            });
        } else if (/Redefinition/i.test(d)) {
            // Locate the LHS @name span if possible.
            const lhs = node.children.find(c => c.kind === 'constRef');
            out.push({
                from: lhs?.from ?? node.from,
                to: lhs?.to ?? node.to,
                severity: 'warning',
                message: d,
            });
        }
    }
}

function lintQueryRef(node: PlotNode, deps: PlotLintDeps, out: Diagnostic[]): void {
    // Numeric query refs only — named refs are deferred (P3).
    if (node.queryIndex === undefined) return;
    if (deps.sqlBlockCount <= 0) return; // unknown — be lenient
    if (node.queryIndex < 1 || node.queryIndex > deps.sqlBlockCount) {
        const actions: Action[] = [];
        if (deps.sqlBlockCount >= 1) {
            actions.push(replaceAction(`Change to '#1'`, node.from, node.to, '#1'));
        }
        out.push({
            from: node.from,
            to: node.to,
            severity: 'error',
            message: `Query reference '#${node.queryIndex}' is out of range; cell has ${deps.sqlBlockCount} SQL block${deps.sqlBlockCount === 1 ? '' : 's'}.`,
            actions,
        });
    }
}

function lintComposite(node: PlotNode, out: Diagnostic[]): void {
    // composite-empty — `row {}` or `col {}` with no real children.
    const realChildren = node.children.filter(
        c => c.kind === 'plotCall' || c.kind === 'composite',
    );
    if (realChildren.length > 0) return;
    // Find a sensible insertion point: just after the `{`.
    const open = node.text.indexOf('{');
    if (open < 0) return;
    const insertPos = node.from + open + 1;
    out.push({
        from: node.from,
        to: node.to,
        severity: 'info',
        message: `Empty ${node.direction ?? 'composite'} container — add at least one plot.`,
        actions: [{
            name: 'Add LINE_CHART()',
            apply: (view, _from, _to) => insertAt(view, insertPos, ' LINE_CHART() '),
        }],
    });
}

function lintTail(
    node: PlotNode,
    deps: PlotLintDeps,
    knownPlotNames: Set<string>,
    _brushedPlots: Set<string>,
    out: Diagnostic[],
): void {
    const upperKey = (node.keyRaw ?? node.key ?? '').toUpperCase().replace(/-/g, '_');
    // LINK_X / LINK_Y / LINK_XY / LINK_SCROLL — check args
    if (upperKey.startsWith('LINK_')) {
        const list = node.children.find(c => c.kind === 'list');
        if (!list) return;
        const args = list.children;
        const vars = args.filter(a => a.kind === 'varRef');
        // LINK_Y and LINK_XY take exactly one $variable; LINK_X requires two.
        // LINK_SCROLL takes a group name string, not a $variable at all.
        const requiresTwo = upperKey === 'LINK_X';
        const requiresOne = upperKey === 'LINK_Y' || upperKey === 'LINK_XY';
        if (vars.length === 0 && (requiresTwo || requiresOne)) {
            const example = requiresTwo ? `${upperKey}($a, $b)` : `${upperKey}($a)`;
            const count = requiresTwo ? 'two' : 'one';
            out.push({
                from: list.from,
                to: list.to,
                severity: 'error',
                message: `${upperKey} requires ${requiresTwo ? 'at least two' : 'one'} $variable argument (e.g. '${example}').`,
                actions: [{
                    name: `Add ${count === 'one' ? 'a' : 'two'} variable${count === 'two' ? 's' : ''}`,
                    apply: (view, _from, _to) => insertAt(view, list.from + 1, requiresTwo ? '$a, $b' : '$a'),
                }],
            });
        } else if (requiresTwo && vars.length === 1) {
            // LINK_X with only one arg — suggest adding a second.
            const insertPos = vars[0].to;
            out.push({
                from: list.from,
                to: list.to,
                severity: 'warning',
                message: `${upperKey} usually takes two variables (e.g. '${upperKey}($a, $b)').`,
                actions: [{
                    name: 'Add a second variable',
                    apply: (view, _from, _to) => insertAt(view, insertPos, ', $b'),
                }],
            });
        }
        // Also check bare idents — they must be 'master', 'clamp', or a known plot.
        for (const a of args) {
            if (a.kind !== 'ident' || !a.name) continue;
            const n = a.name.toLowerCase();
            if (n === 'master' || n === 'clamp') continue;
            if (knownPlotNames.has(n)) continue;
            const candidates = [...knownPlotNames, 'master', 'clamp'];
            const closest = closestMatch(n, candidates);
            const actions: Action[] = [];
            if (closest) {
                actions.push(replaceAction(`Replace with '${closest}'`, a.from, a.to, closest));
            }
            out.push({
                from: a.from,
                to: a.to,
                severity: 'error',
                message: `Unknown plot reference '${a.name}'.${candidates.length ? ` Known: ${candidates.slice(0, 5).join(', ')}.` : ''}`,
                actions,
            });
        }
        return;
    }
    // ON — bare idents should resolve to known plot names.
    if (upperKey === 'ON') {
        void deps;
        const list = node.children.find(c => c.kind === 'list');
        if (!list) return;
        for (const a of list.children) {
            if (a.kind !== 'ident' || !a.name) continue;
            const n = a.name.toLowerCase();
            if (knownPlotNames.has(n)) continue;
            const closest = closestMatch(n, [...knownPlotNames]);
            const actions: Action[] = [];
            if (closest) {
                actions.push(replaceAction(`Replace with '${closest}'`, a.from, a.to, closest));
            }
            out.push({
                from: a.from,
                to: a.to,
                severity: 'error',
                message: `Unknown plot reference '${a.name}' in ON.${knownPlotNames.size ? ` Known: ${[...knownPlotNames].slice(0, 5).join(', ')}.` : ''}`,
                actions,
            });
        }
    }
}

function lintVarRef(
    node: PlotNode,
    deps: PlotLintDeps,
    brushedPlots: Set<string>,
    out: Diagnostic[],
): void {
    const dollar = node.dollar;
    if (!dollar) return;
    // brush-on-unbrushed-plot
    if (dollar.kind === 'crossCellRef' && dollar.path && dollar.path[0] === 'brush') {
        const plotName = (dollar.name ?? '').toLowerCase();
        if (plotName && !brushedPlots.has(plotName)) {
            // Only fire if the plot exists at all OR notebookScope is supplied;
            // otherwise we don't know.
            const known = new Set(
                (deps.notebookScope?.namedPlots ?? []).map(p => p.name.toLowerCase()),
            );
            if (known.has(plotName)) {
                out.push({
                    from: node.from,
                    to: node.to,
                    severity: 'info',
                    message: `Plot '${dollar.name}' has no live brush selection yet — interact with it first.`,
                });
            }
        }
        return;
    }
    // undefined-variable — only the simple $name case. Cross-cell refs and
    // $$workspace refs are resolved against richer sources later.
    if (dollar.kind === 'variableRef' && dollar.name) {
        // Variables inside LINK_X/LINK_Y/LINK_XY/LINK_SCROLL are output
        // bindings — the plot *writes* them on interaction, so they don't need
        // to be pre-declared. Skip the undefined check for those.
        // Walk up through any intermediate list/expression nodes until we hit a
        // tail, a plotCall, or the root — a 2-level hard-coded check was fragile
        // against future grammar nesting (B-168).
        let cur: PlotNode | undefined = node.parent;
        while (cur && cur.kind !== 'tail' && cur.kind !== 'plotCall' && cur.kind !== 'script' && cur.kind !== 'composite') {
            cur = cur.parent;
        }
        if (cur?.kind === 'tail') {
            const tailKey = (cur.keyRaw ?? cur.key ?? '').toUpperCase().replace(/-/g, '_');
            if (tailKey.startsWith('LINK_')) return;
        }
        if (deps.variables[dollar.name] !== undefined) return;
        // No info if we have no variable map at all.
        if (Object.keys(deps.variables).length === 0 && !deps.notebookScope) return;
        out.push({
            from: node.from,
            to: node.to,
            severity: 'info',
            message: `Variable '$${dollar.name}' is not defined; substitution may fail.`,
        });
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findAncestor(node: PlotNode, kind: PlotNode['kind']): PlotNode | undefined {
    let cur: PlotNode | undefined = node.parent;
    while (cur) {
        if (cur.kind === kind) return cur;
        cur = cur.parent;
    }
    return undefined;
}

function isInColumnClause(node: PlotNode, deps: PlotLintDeps): boolean {
    let cur: PlotNode | undefined = node.parent;
    while (cur && cur.kind !== 'plotCall' && cur.kind !== 'composite' && cur.kind !== 'script') {
        if (cur.kind === 'clause' && cur.key) {
            const call = findAncestor(cur, 'plotCall');
            const shape = call?.shape;
            if (!shape) return false;
            const entry = deps.shapeRegistry[shape];
            const columnClauses = (entry?.columnClauses ?? []).map(s => s.toLowerCase());
            return columnClauses.includes(cur.key.toLowerCase());
        }
        cur = cur.parent;
    }
    return false;
}

function findClauseInsertPos(call: PlotNode): number {
    // Position just before the closing `)` or `}` of the call body.
    const close = call.text.lastIndexOf(')');
    if (close > 0) return call.from + close;
    const closeBrace = call.text.lastIndexOf('}');
    if (closeBrace > 0) return call.from + closeBrace;
    return call.to;
}

function needsCommaBefore(call: PlotNode): boolean {
    const last = call.children
        .filter(c => c.kind === 'clause')
        .slice(-1)[0];
    return !!last;
}

function replaceAction(name: string, from: number, to: number, replacement: string): Action {
    return {
        name,
        apply: (view: EditorView, _from: number, _to: number) => {
            view.dispatch({ changes: { from, to, insert: replacement } });
        },
    };
}

function insertAt(view: EditorView, pos: number, text: string): void {
    view.dispatch({ changes: { from: pos, to: pos, insert: text } });
}

/**
 * Closest match by Levenshtein distance with a max of 2. Returns undefined
 * if nothing within range.
 */
export function closestMatch(needle: string, candidates: string[]): string | undefined {
    if (candidates.length === 0) return undefined;
    const lc = needle.toLowerCase();
    let best: { name: string; dist: number } | undefined;
    for (const c of candidates) {
        const cLc = c.toLowerCase();
        if (cLc === lc) return c;
        const d = levenshtein(lc, cLc);
        if (d > 2) continue;
        if (!best || d < best.dist) best = { name: c, dist: d };
    }
    return best?.name;
}

function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const dp: number[] = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) dp[j] = j;
    for (let i = 1; i <= a.length; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = dp[j];
            if (a[i - 1] === b[j - 1]) dp[j] = prev;
            else dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
            prev = tmp;
        }
    }
    return dp[b.length];
}
