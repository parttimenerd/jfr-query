// Service registry for locally-trained ML artifacts. Exposes both models
// behind a single import surface.
//
// AutocompleteRanker: always active — weights are committed in-tree (JSON,
// zero cost to load). No env flag needed.
//
// PromptSuggester: gated behind VITE_USE_LOCAL_ML=true because it fetches a
// 1.8MB binary + downloads MiniLM from HuggingFace on first use.
//
// Both members degrade gracefully when artifacts are absent.

import { AutocompleteRanker } from './AutocompleteRanker';
import { PromptSuggester } from './PromptSuggester';

export const promptSuggesterEnabled: boolean =
    (import.meta as any).env?.VITE_USE_LOCAL_ML === 'true';

export const localMl = {
    autocomplete: AutocompleteRanker,
    prompts: PromptSuggester,
    /** True only when PromptSuggester is also enabled (opt-in). */
    enabled: promptSuggesterEnabled,
    async ensureLoaded(): Promise<void> {
        // AutocompleteRanker loads unconditionally (tiny committed JSON).
        await AutocompleteRanker.ensureLoaded();
        if (promptSuggesterEnabled) {
            await PromptSuggester.ensureLoaded();
        }
    },
} as const;

export { AutocompleteRanker, PromptSuggester };
