// Interfaces for the AST-driven completion provider registry.
//
// A `CompletionProvider` declares which AST cursor positions it handles via
// `matches(node, ctx)`, then produces completion items via `provide(node, ctx)`.
// The dispatcher (`dispatcher.ts`) walks providers in priority order, merges
// their results, deduplicates by label, and runs the reranker.

import type { Completion } from '@codemirror/autocomplete';
import type { Node, SqlClause } from '../ast';
import type { Scope } from '../scope';
import type { ScopeMap } from '../annotators/aliasAnnotator';
import type { SchemaForCompletion } from '../../completions';
import type { DistinctValuesRunner } from '../../distinctValues';

// Per-call context passed to each provider. Built once per keystroke by the
// dispatcher: parse → annotate → find cursor node → assemble.
export interface ProviderContext {
    schema: SchemaForCompletion;
    variables: Record<string, string>;
    runner: DistinctValuesRunner | null;
    // Full document and the slice up to the cursor.
    source: string;
    upTo: string;
    pos: number;
    // Parsed + annotated AST and scope map.
    root: Node;
    scopes: ScopeMap;
    // The deepest node containing the cursor (always defined).
    cursorNode: Node;
    // The nearest enclosing query's scope, or null when the cursor is outside
    // any query (e.g. an empty document).
    scope: Scope | null;
    // The text matched immediately before the cursor by the CodeMirror token
    // regex (`$$?\w*|"..."|word(.word?)?`).
    token: string;
    tokenFrom: number;
    // Whether the user explicitly invoked completion (Ctrl-Space) vs. typing.
    explicit: boolean;
    // The SQL clause enclosing the cursor, if any. Computed by walking up
    // through clause-kind ancestors.
    enclosingClause: SqlClause | null;
}

// What each provider returns. `from` overrides the dispatcher's default
// (`tokenFrom`); the highest-priority provider's `from` wins on conflict.
export interface ProviderResult {
    items: Completion[];
    from?: number;
    validFor?: RegExp;
}

export interface CompletionProvider {
    name: string;
    // Higher priority providers run first; their `from`/`validFor` win on tie.
    priority: number;
    matches(node: Node, ctx: ProviderContext): boolean;
    provide(node: Node, ctx: ProviderContext): ProviderResult;
}
