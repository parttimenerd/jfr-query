// Richer hole hint discriminated union for the plot DSL.
//
// Phase 4b emitted holes with a coarse `expectedKinds: PlotNodeKind[]`. P1
// upgrades hole annotations with a `PlotHoleHint` — a tagged union telling
// downstream consumers (completions, lint, hover) *exactly* what could
// legally fill the slot. The legacy `expectedKinds` is still populated for
// back-compat.

/**
 * Slot-specific completion hint for a `hole` node. Discriminated by `kind`.
 *
 * - `topLevel` — top of script (suggest shape names, composites, or `LET`).
 * - `clauseKey` — opening of a clause list, no key typed yet.
 * - `clauseValue` — after `key:` waiting for a value.
 * - `tailKey` — start of a new tail (after `|` or a closing brace).
 * - `tailValue` — after a tail keyword, waiting for its argument.
 * - `linkArgs` — inside `LINK_X(...)` / `link-x: [...]`; positional info.
 * - `onArg` — inside `ON …`; query refs or named plots.
 * - `queryRefTarget` — `#` typed, expecting a number or view name.
 * - `letName` — `LET ` typed, expecting a `@name`.
 * - `letValue` — `LET @x = ` typed, expecting an expression.
 */
export type PlotHoleHint =
    | { kind: 'topLevel'; suggest: 'shape' | 'composite' | 'let' }
    | {
        kind: 'clauseKey';
        shape: string;
        usedKeys: string[];
        availableKeys: string[];
        columnKeys: string[];
        requiredMissing: string[];
    }
    | {
        kind: 'clauseValue';
        shape: string;
        clauseKey: string;
        paramType: string;
        columnTyped: boolean;
        options?: string[];
        inList: boolean;
    }
    | { kind: 'tailKey'; allowedTails: string[] }
    | {
        kind: 'tailValue';
        tail: string;
        valueType: 'string' | 'number' | 'dimension' | 'identList' | 'linkArgs';
    }
    | { kind: 'linkArgs'; positional: ('var' | 'master' | 'clamp')[]; consumed: number; keyword?: string }
    | { kind: 'onArg'; expects: ('queryRef' | 'ident')[]; consumedIndexes: number[] }
    | { kind: 'letName' }
    | { kind: 'letValue' }
    | { kind: 'queryRefTarget'; consumedIndexes: number[] };

/**
 * Structured diagnostic — replaces the in-AST `diagnostics: string[]` channel
 * when richer info is needed. The legacy string channel is preserved
 * alongside this for back-compat.
 */
export interface PlotDiagnostic {
    severity: 'error' | 'warning' | 'info';
    /** Stable code e.g. `forward-ref`, `unknown-clause`. */
    code: string;
    message: string;
    /** Optional refinement of the host node's range. */
    from?: number;
    to?: number;
    /**
     * Optional CodeMirror lint actions. Each `apply` is either a literal
     * string (replace the diagnostic's span with this text) or a structured
     * insert. P4 wires these to the editor.
     */
    actions?: {
        name: string;
        apply: string | { insert: string; from?: number; to?: number };
    }[];
    /** Optional user-facing recommendation (e.g. "Did you mean `pause`?"). */
    recommendation?: string;
}
