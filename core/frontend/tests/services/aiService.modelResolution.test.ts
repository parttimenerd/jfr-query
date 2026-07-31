import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the plot registry to prevent its module load chain (Pie/BarChart etc.)
// from pulling SettingsContext, which itself imports AiService and creates
// a circular initialization order under Vitest's worker loader.
vi.mock('../../components/plots/plotRegistry', () => ({
    plotRegistry: {},
}));

// Mock SettingsContext to a pure type module — we only need the `Settings`
// shape, and AiService.ts pulls it for type info only.
vi.mock('../../context/SettingsContext', () => ({
    SettingsContext: {} as any,
    SettingsProvider: ({ children }: any) => children,
}));

import {
    aiService,
    AiOfflineEnforcedError,
    providerMetadataRegistry,
} from '../../services/AiService';
import type { AiProviderType } from '../../services/ai/IAiProvider';

// Type-only — we redefine the shape we need locally to avoid pulling
// SettingsContext (and its plot-registry transitive imports) during this test.
type Settings = any;

// Build a Settings object with sensible defaults. Tests override specific fields.
function makeSettings(overrides: Partial<Settings> = {}): Settings {
    const base: Settings = {
        aiProvider: 'google',
        googleApiKey: 'fake-google-key',
        openaiApiKey: 'fake-openai-key',
        gardenerApiKey: 'fake-gardener-key',
        localApiKey: '',
        localBaseUrl: 'http://localhost:8080',
        localMaxTokens: 2048,
        googleBasicModel: providerMetadataRegistry.google.defaultModels.basic,
        googleGoodModel: providerMetadataRegistry.google.defaultModels.advanced,
        googleTinyModel: providerMetadataRegistry.google.defaultModels.tiny,
        openaiBasicModel: providerMetadataRegistry.openai.defaultModels.basic,
        openaiGoodModel: providerMetadataRegistry.openai.defaultModels.advanced,
        openaiTinyModel: providerMetadataRegistry.openai.defaultModels.tiny,
        gardenerBasicModel: providerMetadataRegistry.gardener.defaultModels.basic,
        gardenerGoodModel: providerMetadataRegistry.gardener.defaultModels.advanced,
        gardenerTinyModel: providerMetadataRegistry.gardener.defaultModels.tiny,
        localBasicModel: providerMetadataRegistry.local.defaultModels.basic,
        localGoodModel: providerMetadataRegistry.local.defaultModels.advanced,
        localTinyModel: providerMetadataRegistry.local.defaultModels.tiny,
        browserTinyModel: providerMetadataRegistry.browser.defaultModels.tiny,
        browserModelId: providerMetadataRegistry.browser.defaultModels.tiny,
        customSystemPrompt: '',
        timeFormat: 'HH:mm:ss.SS',
        decimalPlaces: 6,
        autocompleteModelOverride: 'tiny',
        autocompleteCustomModel: '',
        plotSuggestModelOverride: 'tiny',
        plotSuggestCustomModel: '',
        plotSuggestSource: 'auto',
        autocompleteOfflineOnly: false,
        plotSuggestOfflineOnly: false,
        aiDefaultVisibility: 'no-data',
        visibilityFullRowLimit: 50,
        aiAutocompleteModel: 'off',
        plotAiAutocompleteEnabled: false,
        plotAiAutocompleteDebounceMs: 250,
        plotSchemaDiscoveryEnabled: true,
        autoPlotSuggestionEnabled: true,
        suppressDeprecationWarnings: false,
        aiPermQueryData: 'ask',
        aiPermAddCell: 'ask',
        aiPermUpdateCell: 'ask',
        aiPermDeleteCell: 'ask',
        localModelName: '',
        localRoutingPreference: 'auto',
        localToolAccess: 'read-only',
    };
    return { ...base, ...overrides };
}

// Helper to capture the `model` argument the provider receives.
function captureModel() {
    let captured: string | undefined;
    const stub = {
        getInlineSuggestion: vi.fn(async (_sys: string, _req: string, model?: string) => {
            captured = model;
            return { text: 'ok', code: null };
        }),
        getSuggestPlot: vi.fn(async (_sys: string, _sql: string, model?: string) => {
            captured = model;
            return 'TABLE()';
        }),
        getAgentResponse: vi.fn(),
        getCodeFormat: vi.fn(),
        getPlotFixSuggestion: vi.fn(),
        verifyCredentials: vi.fn(async () => true),
    };
    return {
        stub,
        getModel: () => captured,
    };
}

// Install a stub provider into aiService.
function withStubProvider(settings: Settings, stub: any): void {
    aiService.initialize(settings);
    // Replace the private `provider` with our stub. The test only relies on
    // model selection logic, not on real network calls.
    (aiService as any).provider = stub;
    (aiService as any).settings = settings;
}

describe('AiService.getModelFor — tier resolution per provider', () => {
    const providers: AiProviderType[] = ['google', 'openai', 'gardener', 'local', 'browser'];

    for (const provider of providers) {
        it(`returns correct tiny model for provider=${provider}`, async () => {
            const meta = providerMetadataRegistry[provider];
            const { stub, getModel } = captureModel();
            // tier='tiny' via override
            const settingsTiny = makeSettings({
                aiProvider: provider,
                autocompleteModelOverride: 'tiny',
            });
            withStubProvider(settingsTiny, stub);
            await aiService.getAiInlineSuggestion('r', 'sql', 't', 'ctx', undefined, undefined, undefined, 'no-data', null, 'advanced');
            expect(getModel()).toBe(meta.defaultModels.tiny);
        });
    }

    // The cloud + local providers each have a distinct basic model; browser only
    // exposes one model id so we test basic-tier only on multi-tier providers.
    const multiTierProviders: AiProviderType[] = ['google', 'openai', 'gardener', 'local'];
    for (const provider of multiTierProviders) {
        it(`returns correct basic model via override for provider=${provider}`, async () => {
            const meta = providerMetadataRegistry[provider];
            const { stub, getModel } = captureModel();
            const settings = makeSettings({
                aiProvider: provider,
                autocompleteModelOverride: 'basic',
            });
            withStubProvider(settings, stub);
            await aiService.getAiInlineSuggestion('r', 'sql', 't', 'ctx', undefined, undefined, undefined, 'no-data', null, 'advanced');
            expect(getModel()).toBe(meta.defaultModels.basic);
        });
    }
});

describe('AiService.getModelFor — fallback and overrides', () => {
    it('falls back to basic when tiny model is empty', async () => {
        const { stub, getModel } = captureModel();
        const settings = makeSettings({
            aiProvider: 'google',
            googleTinyModel: '', // empty — should fall back
            autocompleteModelOverride: 'tiny',
        });
        withStubProvider(settings, stub);
        await aiService.getAiInlineSuggestion('r', 'sql', 't', 'ctx', undefined, undefined, undefined, 'no-data', null, 'advanced');
        expect(getModel()).toBe(providerMetadataRegistry.google.defaultModels.basic);
    });

    it('autocompleteModelOverride=custom returns autocompleteCustomModel', async () => {
        const { stub, getModel } = captureModel();
        const settings = makeSettings({
            aiProvider: 'google',
            autocompleteModelOverride: 'custom',
            autocompleteCustomModel: 'my-custom-tuned-model',
        });
        withStubProvider(settings, stub);
        await aiService.getAiInlineSuggestion('r', 'sql', 't', 'ctx', undefined, undefined, undefined, 'no-data', null, 'advanced');
        expect(getModel()).toBe('my-custom-tuned-model');
    });

    it('plotSuggestModelOverride=custom returns plotSuggestCustomModel', async () => {
        const { stub, getModel } = captureModel();
        const settings = makeSettings({
            aiProvider: 'google',
            plotSuggestModelOverride: 'custom',
            plotSuggestCustomModel: 'plot-tuned-model',
        });
        withStubProvider(settings, stub);
        await aiService.getAiSuggestPlot('SELECT * FROM t');
        expect(getModel()).toBe('plot-tuned-model');
    });

    it('throws for unknown provider', async () => {
        const { stub } = captureModel();
        const settings = makeSettings({ aiProvider: 'mystery' as AiProviderType });
        withStubProvider(settings, stub);
        await expect(
            aiService.getAiInlineSuggestion('r', 'sql', 't', 'ctx', undefined, undefined, undefined, 'no-data', null, 'advanced')
        ).rejects.toThrow(/Unknown AI provider/);
    });
});

describe('AiService.assertOfflineAllowed — autocomplete offline switch', () => {
    it('autocompleteOfflineOnly=true + cloud provider → throws AiOfflineEnforcedError', async () => {
        const { stub } = captureModel();
        const settings = makeSettings({
            aiProvider: 'google',
            autocompleteOfflineOnly: true,
        });
        withStubProvider(settings, stub);
        await expect(
            aiService.getAiInlineSuggestion('r', 'sql', 't', 'ctx', undefined, undefined, undefined, 'no-data', null, 'advanced')
        ).rejects.toBeInstanceOf(AiOfflineEnforcedError);
    });

    it('autocompleteOfflineOnly=true + browser provider → succeeds', async () => {
        const { stub } = captureModel();
        const settings = makeSettings({
            aiProvider: 'browser',
            autocompleteOfflineOnly: true,
        });
        withStubProvider(settings, stub);
        const result = await aiService.getAiInlineSuggestion('r', 'sql', 't', 'ctx', undefined, undefined, undefined, 'no-data', null, 'advanced');
        expect(result).toEqual({ text: 'ok', code: null });
    });

    it('autocompleteOfflineOnly=true + local provider → succeeds', async () => {
        const { stub } = captureModel();
        const settings = makeSettings({
            aiProvider: 'local',
            autocompleteOfflineOnly: true,
        });
        withStubProvider(settings, stub);
        const result = await aiService.getAiInlineSuggestion('r', 'sql', 't', 'ctx', undefined, undefined, undefined, 'no-data', null, 'advanced');
        expect(result).toEqual({ text: 'ok', code: null });
    });
});

describe('AiService.assertOfflineAllowed — plotSuggest offline switch', () => {
    it('plotSuggestOfflineOnly=true + cloud provider → throws AiOfflineEnforcedError', async () => {
        const { stub } = captureModel();
        const settings = makeSettings({
            aiProvider: 'openai',
            plotSuggestOfflineOnly: true,
        });
        withStubProvider(settings, stub);
        await expect(aiService.getAiSuggestPlot('SELECT 1')).rejects.toBeInstanceOf(AiOfflineEnforcedError);
    });

    it('plotSuggestOfflineOnly=true + browser provider → succeeds', async () => {
        const { stub } = captureModel();
        const settings = makeSettings({
            aiProvider: 'browser',
            plotSuggestOfflineOnly: true,
        });
        withStubProvider(settings, stub);
        const result = await aiService.getAiSuggestPlot('SELECT 1');
        expect(result).toBe('TABLE()');
    });

    it('does NOT affect autocomplete (only plotSuggest gate fires)', async () => {
        const { stub } = captureModel();
        const settings = makeSettings({
            aiProvider: 'google',
            plotSuggestOfflineOnly: true,
            autocompleteOfflineOnly: false,
        });
        withStubProvider(settings, stub);
        const result = await aiService.getAiInlineSuggestion('r', 'sql', 't', 'ctx', undefined, undefined, undefined, 'no-data', null, 'advanced');
        expect(result).toEqual({ text: 'ok', code: null });
    });
});

describe('AiService.assertOfflineAllowed — chat is never offline-gated', () => {
    it('chat (agent response) is not blocked even when both offline flags are on', async () => {
        // The offline gate only applies to autocomplete + plotSuggest. Chat (getAiAgentResponse)
        // never calls assertOfflineAllowed. Verify by invoking the agent path.
        const stub = {
            getAgentResponse: vi.fn(async () => ({ text: 'hi', code: null, plotConfig: null })),
            getInlineSuggestion: vi.fn(),
            getCodeFormat: vi.fn(),
            getSuggestPlot: vi.fn(),
            getPlotFixSuggestion: vi.fn(),
            verifyCredentials: vi.fn(),
        };
        const settings = makeSettings({
            aiProvider: 'google',
            autocompleteOfflineOnly: true,
            plotSuggestOfflineOnly: true,
        });
        withStubProvider(settings, stub);
        const res = await aiService.getAiAgentResponse([], [], [], []);
        expect(res.text).toBe('hi');
        expect(stub.getAgentResponse).toHaveBeenCalled();
    });
});

describe('AiService.streamChatWithTools — per-call provider/model overrides', () => {
    it('modelOverride takes precedence over tier-resolved model', async () => {
        let observedModel: string | undefined;
        const stub: any = {
            streamChatWithTools: vi.fn((_msgs: any, _tools: any, opts: any) => {
                observedModel = opts.model;
                return (async function* () { /* empty stream */ })();
            }),
            verifyCredentials: vi.fn(async () => true),
        };
        const settings = makeSettings({ aiProvider: 'google' });
        withStubProvider(settings, stub);
        const stream = aiService.streamChatWithTools(
            [{ role: 'user', content: 'hi' }] as any,
            null,
            [] as any,
            {
                duckdbQuery: async () => [],
                listCells: () => [],
                mutateCells: { addCell: () => undefined, editCell: () => false, applyPlot: () => false },
                listPlotsInNotebook: () => [],
                requireApproval: async () => true,
            } as any,
            { visibility: 'no-data', tier: 'advanced', feature: 'chat', modelOverride: 'custom-model-xyz' },
        );
        for await (const _ of stream) { /* drain */ }
        expect(observedModel).toBe('custom-model-xyz');
    });

    it('empty modelOverride falls back to tier-resolved model', async () => {
        let observedModel: string | undefined;
        const stub: any = {
            streamChatWithTools: vi.fn((_msgs: any, _tools: any, opts: any) => {
                observedModel = opts.model;
                return (async function* () { /* empty stream */ })();
            }),
            verifyCredentials: vi.fn(async () => true),
        };
        const settings = makeSettings({ aiProvider: 'google' });
        withStubProvider(settings, stub);
        const stream = aiService.streamChatWithTools(
            [{ role: 'user', content: 'hi' }] as any,
            null,
            [] as any,
            {
                duckdbQuery: async () => [],
                listCells: () => [],
                mutateCells: { addCell: () => undefined, editCell: () => false, applyPlot: () => false },
                listPlotsInNotebook: () => [],
                requireApproval: async () => true,
            } as any,
            { visibility: 'no-data', tier: 'advanced', feature: 'chat', modelOverride: '   ' },
        );
        for await (const _ of stream) { /* drain */ }
        expect(observedModel).toBe(providerMetadataRegistry.google.defaultModels.advanced);
    });
});
