import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LocalAiProvider } from '../services/ai/LocalAiProvider';

// Helper: build a fake fetch that returns the given chat-completion content.
// Matches the OpenAI /v1/chat/completions response shape.
function mockChat(content: string, opts?: { status?: number; body?: any; expectAuth?: boolean; expectMaxTokens?: number; expectModel?: string }) {
    const status = opts?.status ?? 200;
    const body = opts?.body ?? {
        choices: [{ message: { role: 'assistant', content } }],
    };
    return vi.fn(async (url: any, init?: any) => {
        // Capture the request for assertions later
        const reqBody = init?.body ? JSON.parse(init.body) : null;
        if (opts?.expectAuth !== undefined) {
            const hasAuth = !!init?.headers?.Authorization;
            expect(hasAuth).toBe(opts.expectAuth);
        }
        if (opts?.expectMaxTokens !== undefined && reqBody) {
            expect(reqBody.max_tokens).toBe(opts.expectMaxTokens);
        }
        if (opts?.expectModel !== undefined && reqBody) {
            expect(reqBody.model).toBe(opts.expectModel);
        }
        return {
            ok: status >= 200 && status < 300,
            status,
            text: async () => JSON.stringify(body),
            json: async () => body,
        } as any;
    });
}

describe('LocalAiProvider — request shape', () => {
    let originalFetch: typeof fetch;
    beforeEach(() => { originalFetch = globalThis.fetch; });
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('does not send Authorization when api key is empty', async () => {
        const fetchMock = mockChat('{"text":"hi","code":null,"plotConfig":null}', { expectAuth: false });
        globalThis.fetch = fetchMock as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        await p.getAgentResponse([], 'system', 'qwen3:9b');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('sends Authorization when api key is provided', async () => {
        const fetchMock = mockChat('{"text":"hi","code":null,"plotConfig":null}', { expectAuth: true });
        globalThis.fetch = fetchMock as any;
        const p = new LocalAiProvider('sk-secret', 'http://localhost:8080');
        await p.getAgentResponse([], 'system', 'qwen3:9b');
    });

    it('strips trailing slash from base URL', async () => {
        const fetchMock = mockChat('{"text":"hi","code":null,"plotConfig":null}');
        globalThis.fetch = fetchMock as any;
        const p = new LocalAiProvider('', 'http://localhost:8080/');
        await p.getAgentResponse([], 'system', 'qwen3:9b');
        const calledUrl = fetchMock.mock.calls[0][0];
        expect(calledUrl).toBe('http://localhost:8080/v1/chat/completions');
    });

    it('uses the configured max_tokens', async () => {
        const fetchMock = mockChat('{"text":"hi","code":null,"plotConfig":null}', { expectMaxTokens: 4096 });
        globalThis.fetch = fetchMock as any;
        const p = new LocalAiProvider('', 'http://localhost:8080', 4096);
        await p.getAgentResponse([], 'system');
    });

    it('falls back to default max_tokens when 0 / negative passed', async () => {
        const fetchMock = mockChat('{"text":"hi","code":null,"plotConfig":null}', { expectMaxTokens: 2048 });
        globalThis.fetch = fetchMock as any;
        const p = new LocalAiProvider('', 'http://localhost:8080', 0);
        await p.getAgentResponse([], 'system');
    });

    it('passes the model id through', async () => {
        const fetchMock = mockChat('{"text":"hi","code":null,"plotConfig":null}', { expectModel: 'Qwen/Qwen3-1.7B-GGUF:Q8_0' });
        globalThis.fetch = fetchMock as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        await p.getAgentResponse([], 'system', 'Qwen/Qwen3-1.7B-GGUF:Q8_0');
    });

    it('does NOT set response_format (small models choke on it)', async () => {
        const fetchMock = mockChat('{"text":"hi","code":null,"plotConfig":null}');
        globalThis.fetch = fetchMock as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        await p.getAgentResponse([], 'system');
        const reqBody = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
        expect(reqBody).not.toHaveProperty('response_format');
    });

    it('sets enable_thinking=false (Qwen3 speedup hint)', async () => {
        const fetchMock = mockChat('{"text":"hi","code":null,"plotConfig":null}');
        globalThis.fetch = fetchMock as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        await p.getAgentResponse([], 'system');
        const reqBody = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
        expect(reqBody.chat_template_kwargs).toEqual({ enable_thinking: false });
    });
});

describe('LocalAiProvider — response handling for typical 9B-model outputs', () => {
    let originalFetch: typeof fetch;
    beforeEach(() => { originalFetch = globalThis.fetch; });
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('parses agent response wrapped in ```json fences', async () => {
        const content = '```json\n{"text":"hello","code":"SELECT 1","plotConfig":"TABLE()"}\n```';
        globalThis.fetch = mockChat(content) as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        const r = await p.getAgentResponse([], 'system');
        expect(r).toEqual({ text: 'hello', code: 'SELECT 1', plotConfig: 'TABLE()' });
    });

    it('parses agent response with Qwen3 chain-of-thought preamble', async () => {
        const content = '<think>\nThe user wants a query. I should...\n</think>\n\n{"text":"ok","code":null,"plotConfig":null}';
        globalThis.fetch = mockChat(content) as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        const r = await p.getAgentResponse([], 'system');
        expect(r).toEqual({ text: 'ok', code: null, plotConfig: null });
    });

    it('parses inline-suggestion response with trailing prose', async () => {
        const content = '{"text":"updated the LIMIT","code":"SELECT * FROM t LIMIT 10"} Let me know if that works!';
        globalThis.fetch = mockChat(content) as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        const r = await p.getInlineSuggestion('system', 'change limit to 10');
        expect(r).toEqual({ text: 'updated the LIMIT', code: 'SELECT * FROM t LIMIT 10' });
    });

    it('returns raw text from getCodeFormat (strips fences)', async () => {
        globalThis.fetch = mockChat('```sql\nSELECT *\nFROM t\n```') as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        const r = await p.getCodeFormat('select*from t');
        expect(r).toBe('SELECT *\nFROM t');
    });

    it('returns raw text from getSuggestPlot', async () => {
        globalThis.fetch = mockChat('LINE_CHART(x: "time", y: ["cpu"])') as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        const r = await p.getSuggestPlot('system', 'SELECT * FROM cpu');
        expect(r).toBe('LINE_CHART(x: "time", y: ["cpu"])');
    });

    it('parses plot-fix response from a thinking-mode model', async () => {
        const content = 'Of course, here is the fix:\n```json\n{"explanation":"Used the right column name","fixedCode":"LINE_CHART(x: \\"time\\", y: [\\"cpu\\"])"}\n```\nHope this helps.';
        globalThis.fetch = mockChat(content) as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        const r = await p.getPlotFixSuggestion('system');
        expect(r.explanation).toMatch(/right column name/);
        expect(r.fixedCode).toBe('LINE_CHART(x: "time", y: ["cpu"])');
    });
});

describe('LocalAiProvider — error paths', () => {
    let originalFetch: typeof fetch;
    beforeEach(() => { originalFetch = globalThis.fetch; });
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('throws a clear error when the server is unreachable', async () => {
        globalThis.fetch = vi.fn(async () => { throw new Error('fetch failed'); }) as any;
        const p = new LocalAiProvider('', 'http://localhost:9999');
        await expect(p.getAgentResponse([], 'system')).rejects.toThrow(/Cannot reach/);
    });

    it('throws a useful error on 404 (wrong endpoint)', async () => {
        globalThis.fetch = mockChat('', { status: 404, body: {} }) as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        await expect(p.getAgentResponse([], 'system')).rejects.toThrow(/404|not found/i);
    });

    it('throws on 401 with a clear message', async () => {
        globalThis.fetch = mockChat('', { status: 401, body: { error: { message: 'Bad key' } } }) as any;
        const p = new LocalAiProvider('bad-key', 'http://localhost:8080');
        await expect(p.getAgentResponse([], 'system')).rejects.toThrow(/401|key/i);
    });

    it('retries on 503 (service unavailable)', async () => {
        let callCount = 0;
        globalThis.fetch = vi.fn(async () => {
            callCount++;
            if (callCount === 1) {
                return { ok: false, status: 503, text: async () => '', json: async () => ({}) } as any;
            }
            return {
                ok: true, status: 200,
                text: async () => '',
                json: async () => ({ choices: [{ message: { content: '{"text":"ok","code":null,"plotConfig":null}' } }] }),
            } as any;
        }) as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        const r = await p.getAgentResponse([], 'system');
        expect(r.text).toBe('ok');
        expect(callCount).toBe(2);
    }, 5000);

    it('throws when content is empty', async () => {
        globalThis.fetch = mockChat('') as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        await expect(p.getAgentResponse([], 'system')).rejects.toThrow(/empty/i);
    });

    it('throws a parseable error when the model returns gibberish (no JSON)', async () => {
        globalThis.fetch = mockChat('I cannot help with that.') as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        await expect(p.getAgentResponse([], 'system')).rejects.toThrow(/Could not parse/i);
    });
});

describe('LocalAiProvider — verifyCredentials probes /v1/models', () => {
    let originalFetch: typeof fetch;
    beforeEach(() => { originalFetch = globalThis.fetch; });
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('returns true when /v1/models responds 200', async () => {
        const fetchMock = vi.fn(async (url: any) => {
            expect(String(url)).toContain('/v1/models');
            return { ok: true, status: 200, json: async () => ({ data: [] }) } as any;
        });
        globalThis.fetch = fetchMock as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        await expect(p.verifyCredentials()).resolves.toBe(true);
    });

    it('throws when /v1/models is unreachable', async () => {
        globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as any;
        const p = new LocalAiProvider('', 'http://localhost:9999');
        await expect(p.verifyCredentials()).rejects.toThrow(/Cannot reach|reach/i);
    });

    it('throws on 404 (not an OpenAI-compatible server)', async () => {
        globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 } as any)) as any;
        const p = new LocalAiProvider('', 'http://localhost:8080');
        await expect(p.verifyCredentials()).rejects.toThrow(/404|not found/i);
    });
});
