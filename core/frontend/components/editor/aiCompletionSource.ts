/**
 * AI-powered completion source for CodeMirror using the browser-side Qwen 2.5
 * model (loaded via Transformers.js / ONNX Runtime).
 *
 * Strategy:
 *  1. When a completion session opens, kick off an async Qwen inference in the
 *     background. The current keystroke returns immediately with no AI items.
 *  2. On the next keystroke (or the first explicit Ctrl+Space), the cache is
 *     checked. If a result arrived, a single AI completion item is prepended
 *     to the list with a ⚡ icon and distinct styling.
 *  3. The suggestion is a full continuation from the cursor — not just a token.
 *     e.g. for `LINE_CHART(x: |` the AI might suggest `"timestamp", y: ["cpu"]`.
 *
 * This source is activated only when the browser model is available (i.e.
 * `PlotGenerationService.isModelReady()` returns true or the model has been
 * requested to load). It does NOT block the main completion path.
 */

import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';

export type AiInferenceFn = (
  context: string,
  prefix: string,
) => Promise<string | null>;

export interface AiCompletionDeps {
  /**
   * Returns true when the AI model is loaded and ready.
   * If false, the source skips AI inference but can still show cached results.
   */
  isReady: () => boolean;
  /**
   * Fire-and-forget: asks the AI model to complete the given context.
   * Returns a promise that resolves with a completion string or null.
   * Should resolve quickly (< 2s on modern hardware).
   */
  infer: AiInferenceFn;
  /**
   * Which editor mode — 'sql' or 'plot'. Changes the prompt.
   */
  mode: 'sql' | 'plot';
}

// LRU-style cache and in-flight set are created per aiCompletionSource instance
// so multiple editor instances (notebook cells) don't share state and can't
// suppress each other's inference requests with the same context suffix.

function cacheKey(context: string): string {
  return context.slice(-300);
}

function makeKickInference(
  aiCache: Map<string, string | null>,
  inflight: Set<string>,
) {
  return function kickInference(deps: AiCompletionDeps, key: string, fullContext: string, prefix: string): void {
    if (inflight.has(key) || aiCache.has(key)) return;
    if (!deps.isReady()) return;
    inflight.add(key);
    const AI_CACHE_MAX = 50;
    deps.infer(fullContext, prefix)
      .then(result => {
        aiCache.set(key, result);
        while (aiCache.size > AI_CACHE_MAX) {
          const first = aiCache.keys().next().value!;
          aiCache.delete(first);
        }
      })
      .catch(() => {
        aiCache.set(key, null);
      })
      .finally(() => {
        inflight.delete(key);
      });
  };
}

/**
 * Creates a CodeMirror completion source that shows an AI suggestion
 * (from Qwen 2.5 or another browser model) alongside normal completions.
 *
 * The AI suggestion appears as a single item at the TOP of the list with a
 * ⚡ icon. It is filtered out when the partial token doesn't match the start
 * of the suggestion.
 */
export function aiCompletionSource(deps: AiCompletionDeps) {
  // Per-instance state — each editor cell gets its own cache and in-flight set.
  const aiCache = new Map<string, string | null>();
  const inflight = new Set<string>();
  const kickInference = makeKickInference(aiCache, inflight);

  return (cx: CompletionContext): CompletionResult | null => {
    // Only fire on explicit Ctrl+Space or when the user has typed something
    const tokenMatch = cx.matchBefore(/[\w"$@#][^\n]*$/);
    const token = tokenMatch?.text ?? '';
    const from = tokenMatch?.from ?? cx.pos;

    if (!token && !cx.explicit) return null;

    const fullContext = cx.state.doc.toString().slice(0, cx.pos);
    const key = cacheKey(fullContext);

    // Kick async inference — result appears next keystroke
    kickInference(deps, key, fullContext, token);

    const cached = aiCache.get(key);
    if (!cached) return null;
    // Refresh position in the Map so eviction is LRU, not FIFO.
    aiCache.delete(key);
    aiCache.set(key, cached);

    // The cached suggestion is a continuation from the cursor.
    // Trim leading whitespace / quotes that match the current token.
    const suggestion = cached.trim();
    if (!suggestion) return null;

    // Don't show if the suggestion starts with something very different
    // from the current token (avoid confusing suggestions).
    const tokenLower = token.replace(/^"/, '').toLowerCase();
    if (tokenLower && !suggestion.toLowerCase().startsWith(tokenLower) &&
        !suggestion.toLowerCase().includes(tokenLower.slice(0, 3))) {
      return null;
    }

    const label = suggestion.length > 60 ? suggestion.slice(0, 57) + '...' : suggestion;

    const option: Completion = {
      label,
      detail: '⚡ AI',
      type: 'aiSuggestion',
      apply: suggestion,
      boost: 100, // Always at the top
      // Add section separator below this item
      section: { name: 'AI Suggestion', rank: 0 },
    };

    return {
      from,
      options: [option],
      validFor: /^[\w"$@#][^\n]*$/,
    };
  };
}

/**
 * Build the context string passed to the AI for SQL completion.
 * Includes schema info (table names, column names) and the SQL so far.
 */
export function buildSqlAiContext(
  sqlUpToCursor: string,
  tableNames: string[],
  columnNames: string[],
): string {
  const schemaHint = tableNames.length > 0
    ? `-- Tables: ${tableNames.slice(0, 10).join(', ')}\n-- Columns: ${columnNames.slice(0, 20).join(', ')}\n`
    : '';
  return `${schemaHint}${sqlUpToCursor}`;
}

/**
 * Build the context string passed to the AI for plot DSL completion.
 * Includes available column names and the plot config so far.
 */
export function buildPlotAiContext(
  plotUpToCursor: string,
  columnNames: string[],
): string {
  const colHint = columnNames.length > 0
    ? `-- columns: ${columnNames.slice(0, 20).join(', ')}\n`
    : '';
  return `${colHint}${plotUpToCursor}`;
}
