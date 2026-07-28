/**
 * Plot-mode AI ghost-text orchestrator.
 *
 * Mirrors `aiAutocomplete/index.ts` for SQL but adds AST-validation: every
 * accumulated chunk is re-parsed with the plot parser. If a parse failure
 * occurs after a stable boundary (`)`, `}`, newline, comma), the accumulated
 * text is truncated to the last stable boundary and streaming stops. If parse
 * yields only an empty/garbage result, the suggestion is silently discarded.
 *
 * Reuses the shared LRU cache and ghost-text rendering primitives from W5.
 */

import { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

import {
    setGhostText,
    clearGhostText,
    escapeSuppressionField,
} from '../aiGhostText';
import {
    shouldFire,
    Debouncer,
} from '../aiAutocomplete/triggers';
import { LRUCache, fnv1aHash } from '../aiAutocomplete/cache';
import type { StreamFn } from '../aiAutocomplete';
import type { ResultColumn } from '../aiAutocomplete/contextBuilder';
import { parse as parsePlot } from './parser';
import { walk } from './ast';
import { buildPlotAiContext, type PlotScopePlot } from './aiPlotContext';
import type { PlotRegistration } from '../../plots/plotTypes';

export interface PlotAutocompleteSettings {
    aiAutocompleteEnabled: boolean;
    plotAiAutocompleteEnabled: boolean;
    aiAutocompleteModel: 'off' | 'cloud-tiny' | 'browser';
    /** Debounce in ms; defaults to 250. */
    plotAiAutocompleteDebounceMs?: number;
}

export interface AiPlotSourceDeps {
    getSettings: () => PlotAutocompleteSettings;
    getPriorPlotCellsContent: () => string[];
    getCellResultSchema: () => ResultColumn[] | null;
    getPlotScope?: () => PlotScopePlot[];
    getVariables?: () => Record<string, string> | undefined;
    getShapeRegistry?: () => Record<string, PlotRegistration<any>>;
    stream: StreamFn;
    /** Cap on rendered ghost-text length (chars). Default 320. */
    maxChars?: number;
    /** Called each time a context is built; receives whether prior-cell context was trimmed to fit the token budget. */
    onContextTrimmed?: (trimmed: boolean) => void;
}

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_MAX_CHARS = 320;
const CACHE_CAP = 20;

const STABLE_BOUNDARY_CHARS = new Set([')', '}', '\n', ',']);

/**
 * Set of characters that may legitimately START a plot-DSL continuation. If
 * the first non-whitespace char of `acc` is outside this set, treat the
 * suggestion as garbage and discard before invoking the parser.
 *
 * (Letters, digits, _ for identifiers; ( { [ for argument lists; " ' for
 * string literals; , | : ) } ] for clause/tail separators; $ @ # for
 * variable/constant/query refs; - + . for numeric literals & hyphenated keys.)
 */
const VALID_START_CHARS = new Set([
    '(', ')', '{', '}', '[', ']',
    '"', "'", ',', '|', ':', ';',
    '$', '@', '#',
    '-', '+', '.',
    '\n', '\t', ' ',
]);

function isValidStartChar(ch: string): boolean {
    if (VALID_START_CHARS.has(ch)) return true;
    return /[A-Za-z0-9_]/.test(ch);
}

/**
 * Validate a streamed accumulated suggestion against the plot parser.
 *
 * Result codes:
 *   - 'ok'         — parses cleanly, current accumulation is fine to keep.
 *   - 'incomplete' — parses with hole/incompleteness (still streaming).
 *   - 'truncate'   — parse failed past last stable boundary; caller should
 *                    truncate `acc` to the boundary text (returned in `truncated`).
 *   - 'discard'    — no usable suggestion in the stream; caller should drop entirely.
 */
export type PlotStreamValidation =
    | { status: 'ok' }
    | { status: 'incomplete' }
    | { status: 'truncate'; truncated: string }
    | { status: 'discard' };

/**
 * Returns the position (one past) of the last stable boundary in `s`, or -1
 * if there is none.
 */
function lastStableBoundary(s: string): number {
    for (let i = s.length - 1; i >= 0; i--) {
        if (STABLE_BOUNDARY_CHARS.has(s[i])) return i + 1;
    }
    return -1;
}

/**
 * AST-validate a prefix + accumulated chunk pair. The `prefix` is the buffer
 * already in the editor before the cursor; `acc` is the streamed suggestion so
 * far.
 *
 * Rules from the plan:
 *   1. Try to parse the combined text.
 *   2. If parse fails *and* there's a stable boundary in `acc`, truncate to it.
 *   3. If parse fails *and* there's no stable boundary, treat as incomplete
 *      (still streaming).
 *   4. If parse yields only an empty script with no useful children AND the
 *      accumulator is non-trivial, discard.
 */
export function validatePlotStream(prefix: string, acc: string): PlotStreamValidation {
    // Fast-path garbage filter: any acc that opens with a non-DSL character is
    // discarded outright. This catches models that hallucinate <<bracketed>>
    // narration or other obvious non-DSL output. Whitespace and BOM (U+FEFF) at
    // the start are stripped so leading newlines/spaces stay legal continuations.
    const firstNonWs = acc.replace(/^[\s﻿]+/, '');
    if (firstNonWs.length === 0) return { status: 'discard' };
    if (!isValidStartChar(firstNonWs[0])) {
        return { status: 'discard' };
    }

    const combined = prefix + acc;
    let root;
    try {
        root = parsePlot(combined, { cursorPos: combined.length });
    } catch {
        const boundary = lastStableBoundary(acc);
        if (boundary >= 0) return { status: 'truncate', truncated: acc.slice(0, boundary) };
        return { status: 'discard' };
    }

    // Walk the AST to detect "produced something usable". A usable AST has at
    // least one structural plot-DSL node: plotCall, letStatement, composite,
    // clause, or tail. Bare idents/literals at the top level mean the parser
    // collapsed unrecognized bytes into best-effort fallback nodes — which is
    // exactly what "garbage" looks like.
    let structuralNodes = 0;
    let trailingHoleAtEof = false;
    walk(root, n => {
        if (
            n.kind === 'plotCall' ||
            n.kind === 'composite' ||
            n.kind === 'letStatement' ||
            n.kind === 'clause' ||
            n.kind === 'tail'
        ) {
            structuralNodes++;
        }
        if (n.kind === 'hole' && n.to === combined.length) {
            trailingHoleAtEof = true;
        }
    });

    if (acc.trim().length === 0) return { status: 'discard' };

    if (structuralNodes === 0) {
        const boundary = lastStableBoundary(acc);
        if (boundary >= 0) {
            const truncated = acc.slice(0, boundary).trim();
            if (truncated.length === 0) return { status: 'discard' };
            return { status: 'truncate', truncated };
        }
        return { status: 'discard' };
    }

    // Has structural content. If the last char is at a stable boundary, treat
    // as complete; if there's a trailing hole, we're still in mid-flight.
    const last = acc[acc.length - 1];
    if (last !== undefined && STABLE_BOUNDARY_CHARS.has(last)) {
        return { status: 'ok' };
    }
    if (trailingHoleAtEof) {
        return { status: 'incomplete' };
    }
    return { status: 'ok' };
}

/**
 * Build the CodeMirror extension for plot-mode AI ghost-text.
 *
 * Gates execution on `plotAiAutocompleteEnabled` (separate from SQL ghost-text
 * toggle); the browser model path is a no-op in P5's first cut.
 */
export function aiPlotAutocompleteExtension(deps: AiPlotSourceDeps): Extension {
    const cache = new LRUCache<string>(CACHE_CAP);

    return ViewPlugin.fromClass(
        class {
            private abort: AbortController | null = null;
            private debouncer = new Debouncer();
            private view: EditorView;

            constructor(view: EditorView) {
                this.view = view;
            }

            update(u: ViewUpdate) {
                if (!u.docChanged) return;
                const settings = deps.getSettings();
                if (!this.enabled(settings)) return;
                if (this.abort) {
                    this.abort.abort();
                    this.abort = null;
                }
                const ms =
                    settings.plotAiAutocompleteDebounceMs ?? DEFAULT_DEBOUNCE_MS;
                this.debouncer.schedule(() => this.fire(), ms);
            }

            destroy() {
                this.debouncer.cancel();
                if (this.abort) this.abort.abort();
            }

            private enabled(settings: PlotAutocompleteSettings): boolean {
                if (!settings.plotAiAutocompleteEnabled) return false;
                if (settings.aiAutocompleteModel === 'off') return false;
                return true;
            }

            private async fire() {
                const view = this.view;
                const state = view.state;
                const settings = deps.getSettings();
                if (!this.enabled(settings)) return;

                const head = state.selection.main.head;
                const doc = state.doc.toString();
                const upTo = doc.slice(0, head);
                const after = doc.slice(head);

                const escapeSuppressed = state.field(escapeSuppressionField, false) ?? false;
                if (!shouldFire({ mode: 'plot', upToCursor: upTo, escapeSuppressed })) return;

                const built = buildPlotAiContext({
                    shapeRegistry: deps.getShapeRegistry?.(),
                    cellResultSchema: deps.getCellResultSchema(),
                    plotScope: deps.getPlotScope?.() ?? [],
                    variables: deps.getVariables?.(),
                    priorPlotCellsContent: deps.getPriorPlotCellsContent(),
                    currentCellUpToCursor: upTo,
                    currentCellAfterCursor: after,
                });

                deps.onContextTrimmed?.(built.trimmed);

                const cacheKey = `plot|${settings.aiAutocompleteModel}|${fnv1aHash(
                    built.system + '\x00' + built.user,
                )}`;
                const cached = cache.get(cacheKey);
                if (cached) {
                    if (this.stillAtHead(head)) {
                        view.dispatch({ effects: setGhostText.of({ from: head, text: cached }) });
                    }
                    return;
                }

                this.abort = new AbortController();
                const signal = this.abort.signal;
                const max = deps.maxChars ?? DEFAULT_MAX_CHARS;

                let acc = '';
                try {
                    // After `enabled()`, model is neither 'off'.
                    const model: 'cloud-tiny' | 'browser' =
                        settings.aiAutocompleteModel === 'browser' ? 'browser' : 'cloud-tiny';
                    for await (const tok of deps.stream(
                        built.system,
                        built.user,
                        signal,
                        model,
                    )) {
                        if (signal.aborted) return;
                        acc += tok;
                        if (acc.length > max) acc = acc.slice(0, max);
                        if (!this.stillAtHead(head)) return;

                        const v = validatePlotStream(upTo, acc);
                        if (v.status === 'discard') {
                            // Silent: never show. Clear any prior in-flight ghost.
                            if (this.stillAtHead(head)) {
                                view.dispatch({ effects: clearGhostText.of() });
                            }
                            return;
                        }
                        if (v.status === 'truncate') {
                            acc = v.truncated;
                            if (acc.length > 0 && this.stillAtHead(head)) {
                                view.dispatch({ effects: setGhostText.of({ from: head, text: acc }) });
                            }
                            break;
                        }
                        // 'ok' or 'incomplete' — render progress.
                        view.dispatch({ effects: setGhostText.of({ from: head, text: acc }) });
                        if (acc.length >= max) break;
                    }
                    if (acc) cache.set(cacheKey, acc);
                } catch (e: any) {
                    if (e?.name === 'AbortError') return;
                    if ((import.meta as any).env?.DEV) {
                        console.warn('[ai-plot-autocomplete] stream failed:', e);
                    }
                    if (this.stillAtHead(head)) {
                        view.dispatch({ effects: clearGhostText.of() });
                    }
                }
            }

            private stillAtHead(originalHead: number): boolean {
                return this.view.state.selection.main.head === originalHead;
            }
        },
        { eventHandlers: {} },
    );
}
