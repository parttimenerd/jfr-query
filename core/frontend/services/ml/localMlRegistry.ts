// Service registry for locally-trained ML artifacts. Exposes both models
// behind a single import surface and a shared feature-flag check so call
// sites don't need to know about VITE_USE_LOCAL_ML directly.
//
// Both members degrade gracefully when artifacts are absent (the loaders
// return identity / empty results), so importing this file is always safe.

import { AutocompleteRanker } from './AutocompleteRanker';
import { PromptSuggester } from './PromptSuggester';

export const localMlEnabled: boolean =
    (import.meta as any).env?.VITE_USE_LOCAL_ML === 'true';

export const localMl = {
    autocomplete: AutocompleteRanker,
    prompts: PromptSuggester,
    enabled: localMlEnabled,
    async ensureLoaded(): Promise<void> {
        if (!localMlEnabled) return;
        await Promise.all([
            AutocompleteRanker.ensureLoaded(),
            PromptSuggester.ensureLoaded(),
        ]);
    },
} as const;

export { AutocompleteRanker, PromptSuggester };
