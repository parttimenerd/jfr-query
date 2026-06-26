/**
 * AI ghost-text autocomplete orchestrator. Wires the CM ViewPlugin to:
 *  - the context builder (priors, schema, current cell)
 *  - the trigger gates (debounce, comment, escape suppression)
 *  - the LRU cache
 *  - the streaming provider (cloud-tiny via AiService, or browser path)
 *
 * Public surface:
 *   `aiAutocompleteExtension(deps)` returns a CM Extension you push into the
 *   editor's extension list AFTER `aiGhostTextExtension`.
 */

import { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

import {
  setGhostText,
  clearGhostText,
  ghostTextField,
  escapeSuppressionField,
} from '../aiGhostText';
import {
  buildAutocompleteContext,
  type AutocompleteMode,
  type ResultColumn,
} from './contextBuilder';
import {
  shouldFire,
  isInSqlComment,
  debounceMsFor,
  Debouncer,
  type TriggerMode,
} from './triggers';
import { LRUCache, fnv1aHash, InflightRegistry, reuseCachedPrefix } from './cache';
import type { SchemaForCompletion } from '../completions';

export interface AutocompleteSettings {
  aiAutocompleteEnabled: boolean;
  aiAutocompleteModel: 'off' | 'cloud-tiny' | 'browser';
  aiAutocompleteSqlDebounceMs?: number;
  aiAutocompleteMdDebounceMs?: number;
  /**
   * Hard offline-only gate (C1). When true and the active provider is a cloud
   * provider, the orchestrator short-circuits before issuing any request —
   * quieter failure mode than letting AiService throw AiOfflineEnforcedError on
   * every keystroke.
   */
  autocompleteOfflineOnly?: boolean;
  /** Active AI provider id — used to evaluate the offline gate. */
  aiProvider?: string;
}

export interface StreamFn {
  (
    system: string,
    user: string,
    signal: AbortSignal,
    model: 'cloud-tiny' | 'browser',
  ): AsyncIterable<string>;
}

export interface AiAutocompleteDeps {
  mode: TriggerMode;
  /** Called every keystroke; cheap getters. */
  getSettings: () => AutocompleteSettings;
  getPriorCellsContent: () => string[];
  getFollowingCellContent?: () => string;
  getSchema: () => SchemaForCompletion | null;
  getCellResultSchema?: () => ResultColumn[] | null;
  getVariables?: () => Record<string, string> | undefined;
  /** Streams suggestion tokens for the given prompt. Caller wires this to AiService or the browser model. */
  stream: StreamFn;
  /** Optional: cap on rendered ghost-text length (chars). */
  maxChars?: number;
}

const MAX_CHARS_DEFAULT = 240;

export function aiAutocompleteExtension(deps: AiAutocompleteDeps): Extension {
  const cache = new LRUCache<string>(30);
  const inflight = new InflightRegistry<string>();
  // Sidecar tracking the most recent (upTo, suggestion) pair so we can serve
  // prefix-extended keystrokes from cache without burning a round-trip. Reset
  // whenever the cursor moves backward or the editor switches modes.
  let recent: { upTo: string; suggestion: string } | null = null;

  return ViewPlugin.fromClass(class {
    private abort: AbortController | null = null;
    private debouncer = new Debouncer();
    private view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
    }

    update(u: ViewUpdate) {
      if (!u.docChanged) return;
      const settings = deps.getSettings();
      if (!settings.aiAutocompleteEnabled || settings.aiAutocompleteModel === 'off') {
        return;
      }
      // Offline-only short-circuit: when autocompleteOfflineOnly is on AND the
      // active provider is a cloud provider, skip autocomplete entirely. This
      // is the "quieter failure mode" (no toast, no network) that the plan
      // calls for. The AiService still has a hard assertOfflineAllowed gate.
      if (
        settings.autocompleteOfflineOnly &&
        settings.aiProvider &&
        settings.aiProvider !== 'browser' &&
        settings.aiProvider !== 'local'
      ) {
        return;
      }
      // Abort any in-flight stream — the doc is no longer the one we asked about.
      if (this.abort) {
        this.abort.abort();
        this.abort = null;
      }
      // Wipe any ghost text right away (the state field will also nuke it on docChanged,
      // but dispatching explicitly here is cheap and makes intent clear).
      // (Skipped: docChanged already cleared the field; avoid an extra dispatch.)

      const ms = u.view.state.facet ? this.computeDebounce(settings) : this.computeDebounce(settings);
      this.debouncer.schedule(() => this.fire(), ms);
    }

    destroy() {
      this.debouncer.cancel();
      if (this.abort) this.abort.abort();
    }

    private computeDebounce(settings: AutocompleteSettings): number {
      if (deps.mode === 'markdown') {
        return settings.aiAutocompleteMdDebounceMs ?? debounceMsFor('markdown');
      }
      return settings.aiAutocompleteSqlDebounceMs ?? debounceMsFor('sql');
    }

    private async fire() {
      const view = this.view;
      const state = view.state;
      const settings = deps.getSettings();
      if (!settings.aiAutocompleteEnabled || settings.aiAutocompleteModel === 'off') return;
      if (
        settings.autocompleteOfflineOnly &&
        settings.aiProvider &&
        settings.aiProvider !== 'browser' &&
        settings.aiProvider !== 'local'
      ) {
        return;
      }

      const head = state.selection.main.head;
      const doc = state.doc.toString();
      const upTo = doc.slice(0, head);
      const after = doc.slice(head);

      const escapeSuppressed = state.field(escapeSuppressionField, false) ?? false;
      if (!shouldFire({ mode: deps.mode, upToCursor: upTo, escapeSuppressed })) return;

      const inComment = deps.mode !== 'markdown' && isInSqlComment(upTo);
      const built = buildAutocompleteContext({
        mode: deps.mode === 'plot' ? 'plot' : (deps.mode as AutocompleteMode),
        priorCellsContent: deps.getPriorCellsContent(),
        followingCellContent: deps.getFollowingCellContent?.(),
        currentCellUpToCursor: upTo,
        currentCellAfterCursor: after,
        schema: deps.getSchema(),
        cellResultSchema: deps.getCellResultSchema?.() ?? null,
        variables: deps.getVariables?.(),
        inComment,
      });

      // Trivial-input no-op: avoid burning a network round-trip on prompts
      // with effectively no signal. `upTo` having <2 non-whitespace chars
      // is almost never enough context to produce a useful completion.
      const trimmedUpTo = upTo.replace(/\s+/g, '');
      if (trimmedUpTo.length < 2) return;

      const cacheKey = `${deps.mode}|${settings.aiAutocompleteModel}|${fnv1aHash(built.system + '\x00' + built.user)}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        if (this.stillAtHead(head)) {
          view.dispatch({ effects: setGhostText.of({ from: head, text: cached }) });
        }
        return;
      }

      // Prefix-aware reuse: if the user typed forward into a recently-served
      // suggestion (same prefix, extended by 1+ chars), serve the tail without
      // a network call. Cheaper than waiting for the next debounce + stream.
      if (recent && upTo.startsWith(recent.upTo) && upTo.length > recent.upTo.length) {
        const typedSince = upTo.slice(recent.upTo.length);
        const tail = reuseCachedPrefix(recent.suggestion, typedSince);
        if (tail) {
          if (this.stillAtHead(head)) {
            view.dispatch({ effects: setGhostText.of({ from: head, text: tail }) });
          }
          return;
        }
        // Typed-through diverged from cached suggestion — drop the sidecar so
        // we don't keep checking it.
        recent = null;
      }

      this.abort = new AbortController();
      const signal = this.abort.signal;
      const max = deps.maxChars ?? MAX_CHARS_DEFAULT;

      // In-flight dedup: if a stream for the same key is already running,
      // attach to its promise and serve the result when it lands.
      if (inflight.has(cacheKey)) {
        try {
          const result = await inflight.start(cacheKey, () => Promise.resolve(''));
          if (result && this.stillAtHead(head)) {
            view.dispatch({ effects: setGhostText.of({ from: head, text: result }) });
            recent = { upTo, suggestion: result };
          }
        } catch { /* swallow */ }
        return;
      }

      let acc = '';
      const activeModel = settings.aiAutocompleteModel as 'cloud-tiny' | 'browser';
      const streamPromise = (async () => {
        try {
          for await (const tok of deps.stream(built.system, built.user, signal, activeModel)) {
            if (signal.aborted) return acc;
            acc += tok;
            if (acc.length > max) { acc = acc.slice(0, max); }
            // Only update if the cursor hasn't moved.
            if (!this.stillAtHead(head)) return acc;
            view.dispatch({ effects: setGhostText.of({ from: head, text: acc }) });
            if (acc.length >= max) break;
          }
          if (acc) cache.set(cacheKey, acc);
          return acc;
        } catch (e: any) {
          if (e?.name === 'AbortError') return acc;
          if ((import.meta as any).env?.DEV) {
            console.warn('[ai-autocomplete] stream failed:', e);
          }
          if (this.stillAtHead(head)) {
            view.dispatch({ effects: clearGhostText.of() });
          }
          return acc;
        }
      })();

      try {
        const result = await inflight.start(cacheKey, () => streamPromise);
        if (result) recent = { upTo, suggestion: result };
      } catch { /* swallow */ }
      return;
    }

    /** True iff the cursor hasn't moved away from where we issued the request. */
    private stillAtHead(originalHead: number): boolean {
      return this.view.state.selection.main.head === originalHead;
    }
  }, {
    eventHandlers: {},
  });
}

/** Re-export for callers that want the field/effects directly. */
export { ghostTextField } from '../aiGhostText';
