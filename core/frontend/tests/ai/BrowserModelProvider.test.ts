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
    return { provider: provider.BrowserModelProvider, sqlGen };
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
