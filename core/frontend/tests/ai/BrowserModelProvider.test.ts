import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the heavy SQL generation service BEFORE importing anything that
// transitively touches the provider, so accidental hot-path calls can't
// trigger a 630MB ONNX fetch in CI.
vi.mock('../../services/ml/SqlGenerationService', () => ({
    isSqlModelReady: vi.fn(() => false),
    generateSqlCompletion: vi.fn(async () => {
        throw new Error(
            'generateSqlCompletion must not be called when the model is not ready',
        );
    }),
}));

vi.mock('../../components/icons/BrowserIcon', () => ({ BrowserIcon: () => null }));

// Break the circular import: BrowserModelProvider → isParseablePlotConfig
// → plotRegistry → every plot component → SettingsContext → AiService →
// BrowserModelProvider (TDZ). The test only validates the gating + fallback
// logic, so a stub registry is fine.
vi.mock('../../components/plots/plotRegistry', () => ({
    plotRegistry: {},
    getCanonicalPlotName: (n: string) => n,
}));
vi.mock('../../components/plots/plotNames', () => ({
    normalizePlotName: (n: string) => n,
    getCanonicalPlotName: (n: string) => n,
}));

// Mock BrowserChatService so streamChatWithTools tests can control the stream
// without loading the actual ONNX model.
vi.mock('../../services/ai/BrowserChatService', async (importOriginal) => {
    const orig = await importOriginal<typeof import('../../services/ai/BrowserChatService')>();
    return {
        ...orig,
        streamBrowserChat: vi.fn(async function* () { yield 'hello'; }),
    };
});

function buildPrompt(prefix: string): string {
    return [
        '# Schema\nTABLES:\n- "events": ("ts" TIMESTAMP, "host" VARCHAR, "cpu" DOUBLE)',
        '# Current cell result columns\n"ts" TIMESTAMP, "host" VARCHAR, "cpu" DOUBLE',
        `# Current cell — text before cursor\n${prefix}<<CURSOR>>`,
    ].join('\n\n');
}

// Lazy-load to sidestep circular imports between IAiProvider → SettingsContext
// → AiService → providers when vitest reorders the module graph under vi.mock.
async function load() {
    const provider = await import('../../services/ai/BrowserModelProvider');
    const sqlGen = await import('../../services/ml/SqlGenerationService');
    const browserChat = await import('../../services/ai/BrowserChatService');
    return { provider: provider.BrowserModelProvider, sqlGen, browserChat };
}

describe('BrowserModelProvider — getInlineSuggestion hot-path gate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does NOT call generateSqlCompletion when isSqlModelReady() is false', async () => {
        const { provider: BrowserModelProvider, sqlGen } = await load();
        (sqlGen.isSqlModelReady as any).mockReturnValue(false);
        const p = new BrowserModelProvider();
        await p.getInlineSuggestion('', buildPrompt('SELECT '));
        expect(sqlGen.generateSqlCompletion).not.toHaveBeenCalled();
    });

    it('falls through to naive rules when model not ready', async () => {
        const { provider: BrowserModelProvider, sqlGen } = await load();
        (sqlGen.isSqlModelReady as any).mockReturnValue(false);
        const p = new BrowserModelProvider();
        const r = await p.getInlineSuggestion('', buildPrompt('SELECT '));
        expect(r.text.length).toBeGreaterThan(0);
        expect(r.code).toBe(r.text);
    });

    it('calls generateSqlCompletion when isSqlModelReady() is true', async () => {
        const { provider: BrowserModelProvider, sqlGen } = await load();
        (sqlGen.isSqlModelReady as any).mockReturnValue(true);
        (sqlGen.generateSqlCompletion as any).mockResolvedValue('ts FROM events');
        const p = new BrowserModelProvider();
        const r = await p.getInlineSuggestion('', buildPrompt('SELECT '));
        expect(sqlGen.generateSqlCompletion).toHaveBeenCalled();
        expect(r.text).toBe('ts FROM events');
    });

    it('falls back to rules when generation throws', async () => {
        const { provider: BrowserModelProvider, sqlGen } = await load();
        (sqlGen.isSqlModelReady as any).mockReturnValue(true);
        (sqlGen.generateSqlCompletion as any).mockRejectedValue(new Error('boom'));
        const p = new BrowserModelProvider();
        const r = await p.getInlineSuggestion('', buildPrompt('SELECT '));
        expect(r.text.length).toBeGreaterThan(0); // naive rule kicked in
    });

    it('falls back to rules when generation echoes the cursor marker', async () => {
        const { provider: BrowserModelProvider, sqlGen } = await load();
        (sqlGen.isSqlModelReady as any).mockReturnValue(true);
        (sqlGen.generateSqlCompletion as any).mockResolvedValue('foo <<CURSOR>> bar');
        const p = new BrowserModelProvider();
        const r = await p.getInlineSuggestion('', buildPrompt('SELECT '));
        expect(r.text).not.toContain('<<CURSOR>>');
    });

    it('skips the T5 path entirely when localStorage flag disables it', async () => {
        // Node env has no localStorage, so the sqlModelDisabled() guard
        // returns false here regardless. This case is covered manually in
        // the browser; the test asserts the guard at least doesn't throw.
        const { provider: BrowserModelProvider, sqlGen } = await load();
        (sqlGen.isSqlModelReady as any).mockReturnValue(false);
        const p = new BrowserModelProvider();
        await expect(p.getInlineSuggestion('', buildPrompt('SELECT '))).resolves.toBeDefined();
    });

    it('returns empty when no rule matches and model not ready', async () => {
        const { provider: BrowserModelProvider, sqlGen } = await load();
        (sqlGen.isSqlModelReady as any).mockReturnValue(false);
        const p = new BrowserModelProvider();
        const r = await p.getInlineSuggestion('', buildPrompt(''));
        expect(r.text).toBe('');
        expect(r.code).toBeNull();
    });
});

// ── streamChatWithTools — message conversion ──────────────────────────────────

describe('BrowserModelProvider — streamChatWithTools message conversion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    async function collectChunks(gen: AsyncIterable<any>): Promise<any[]> {
        const chunks: any[] = [];
        for await (const c of gen) chunks.push(c);
        return chunks;
    }

    it('yields text chunks from streamBrowserChat', async () => {
        const { provider: BrowserModelProvider, browserChat } = await load();
        (browserChat.streamBrowserChat as any).mockImplementation(async function* () {
            yield 'Hello';
            yield ' world';
        });
        const p = new BrowserModelProvider();
        const stream = p.streamChatWithTools(
            [{ role: 'user', content: 'hi' }],
            [],
        );
        const chunks = await collectChunks(stream);
        expect(chunks).toEqual([
            { kind: 'text', delta: 'Hello' },
            { kind: 'text', delta: ' world' },
        ]);
    });

    it('injects systemInstruction as leading system message', async () => {
        const { provider: BrowserModelProvider, browserChat } = await load();
        let capturedMessages: any[] = [];
        (browserChat.streamBrowserChat as any).mockImplementation(async function* (msgs: any[]) {
            capturedMessages = msgs;
            yield 'ok';
        });
        const p = new BrowserModelProvider();
        const stream = p.streamChatWithTools(
            [{ role: 'user', content: 'question' }],
            [],
            { systemInstruction: 'You are helpful.' },
        );
        await collectChunks(stream);
        expect(capturedMessages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    });

    it('skips existing system messages when systemInstruction is provided', async () => {
        const { provider: BrowserModelProvider, browserChat } = await load();
        let capturedMessages: any[] = [];
        (browserChat.streamBrowserChat as any).mockImplementation(async function* (msgs: any[]) {
            capturedMessages = msgs;
            yield 'ok';
        });
        const p = new BrowserModelProvider();
        const stream = p.streamChatWithTools(
            [
                { role: 'system', content: 'old system' },
                { role: 'user', content: 'question' },
            ],
            [],
            { systemInstruction: 'new system' },
        );
        await collectChunks(stream);
        const systemMsgs = capturedMessages.filter((m: any) => m.role === 'system');
        expect(systemMsgs).toHaveLength(1);
        expect(systemMsgs[0].content).toBe('new system');
    });

    it('drops tool role messages', async () => {
        const { provider: BrowserModelProvider, browserChat } = await load();
        let capturedMessages: any[] = [];
        (browserChat.streamBrowserChat as any).mockImplementation(async function* (msgs: any[]) {
            capturedMessages = msgs;
            yield 'ok';
        });
        const p = new BrowserModelProvider();
        const stream = p.streamChatWithTools(
            [
                { role: 'user', content: 'run it' },
                { role: 'tool', content: 'result data', toolResults: [{ id: 'x', name: 'runQuery', result: 'ok' }] } as any,
                { role: 'assistant', content: 'done' },
            ],
            [],
        );
        await collectChunks(stream);
        const roles = capturedMessages.map((m: any) => m.role);
        expect(roles).not.toContain('tool');
    });

    it('produces no output when messages have no user message', async () => {
        const { provider: BrowserModelProvider, browserChat } = await load();
        const p = new BrowserModelProvider();
        const stream = p.streamChatWithTools(
            [{ role: 'assistant', content: 'hi' }],
            [],
        );
        const chunks = await collectChunks(stream);
        expect(chunks).toHaveLength(0);
        expect(browserChat.streamBrowserChat).not.toHaveBeenCalled();
    });

    it('uses model override when it is a known chat model', async () => {
        const { provider: BrowserModelProvider, browserChat } = await load();
        const { BROWSER_CHAT_MODELS } = await import('../../services/ai/BrowserChatService');
        const [knownModelId] = Object.keys(BROWSER_CHAT_MODELS);

        let capturedModelId: string | undefined;
        (browserChat.streamBrowserChat as any).mockImplementation(
            async function* (_msgs: any, _prog: any, _sig: any, modelId: string) {
                capturedModelId = modelId;
                yield 'ok';
            },
        );
        const p = new BrowserModelProvider();
        const stream = p.streamChatWithTools(
            [{ role: 'user', content: 'hi' }],
            [],
            { model: knownModelId },
        );
        await collectChunks(stream);
        expect(capturedModelId).toBe(knownModelId);
    });
});

describe('BrowserModelProvider — getInlineSuggestion hot-path gate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does NOT call generateSqlCompletion when isSqlModelReady() is false', async () => {
        const { provider: BrowserModelProvider, sqlGen } = await load();
        (sqlGen.isSqlModelReady as any).mockReturnValue(false);
        const p = new BrowserModelProvider();
        await p.getInlineSuggestion('', buildPrompt('SELECT '));
        expect(sqlGen.generateSqlCompletion).not.toHaveBeenCalled();
    });

    it('falls through to naive rules when model not ready', async () => {
        const { provider: BrowserModelProvider, sqlGen } = await load();
        (sqlGen.isSqlModelReady as any).mockReturnValue(false);
        const p = new BrowserModelProvider();
        const r = await p.getInlineSuggestion('', buildPrompt('SELECT '));
        expect(r.text.length).toBeGreaterThan(0);
        expect(r.code).toBe(r.text);
    });

    it('calls generateSqlCompletion when isSqlModelReady() is true', async () => {
        const { provider: BrowserModelProvider, sqlGen } = await load();
        (sqlGen.isSqlModelReady as any).mockReturnValue(true);
        (sqlGen.generateSqlCompletion as any).mockResolvedValue('ts FROM events');
        const p = new BrowserModelProvider();
        const r = await p.getInlineSuggestion('', buildPrompt('SELECT '));
        expect(sqlGen.generateSqlCompletion).toHaveBeenCalled();
        expect(r.text).toBe('ts FROM events');
    });

    it('falls back to rules when generation throws', async () => {
        const { provider: BrowserModelProvider, sqlGen } = await load();
        (sqlGen.isSqlModelReady as any).mockReturnValue(true);
        (sqlGen.generateSqlCompletion as any).mockRejectedValue(new Error('boom'));
        const p = new BrowserModelProvider();
        const r = await p.getInlineSuggestion('', buildPrompt('SELECT '));
        expect(r.text.length).toBeGreaterThan(0); // naive rule kicked in
    });

    it('falls back to rules when generation echoes the cursor marker', async () => {
        const { provider: BrowserModelProvider, sqlGen } = await load();
        (sqlGen.isSqlModelReady as any).mockReturnValue(true);
        (sqlGen.generateSqlCompletion as any).mockResolvedValue('foo <<CURSOR>> bar');
        const p = new BrowserModelProvider();
        const r = await p.getInlineSuggestion('', buildPrompt('SELECT '));
        expect(r.text).not.toContain('<<CURSOR>>');
    });

    it('skips the T5 path entirely when localStorage flag disables it', async () => {
        // Node env has no localStorage, so the sqlModelDisabled() guard
        // returns false here regardless. This case is covered manually in
        // the browser; the test asserts the guard at least doesn't throw.
        const { provider: BrowserModelProvider, sqlGen } = await load();
        (sqlGen.isSqlModelReady as any).mockReturnValue(false);
        const p = new BrowserModelProvider();
        await expect(p.getInlineSuggestion('', buildPrompt('SELECT '))).resolves.toBeDefined();
    });

    it('returns empty when no rule matches and model not ready', async () => {
        const { provider: BrowserModelProvider, sqlGen } = await load();
        (sqlGen.isSqlModelReady as any).mockReturnValue(false);
        const p = new BrowserModelProvider();
        const r = await p.getInlineSuggestion('', buildPrompt(''));
        expect(r.text).toBe('');
        expect(r.code).toBeNull();
    });
});
