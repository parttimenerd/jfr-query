import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @huggingface/transformers for fast unit testing — we only need to verify
// the BrowserChatService API contract (progress callbacks, message formatting,
// abort handling), not actual model inference.

vi.mock('@huggingface/transformers', () => {
    // Minimal TextStreamer: invokes callback_function for each word in the input text.
    class TextStreamer {
        private opts: any;
        constructor(_tokenizer: any, opts: any) { this.opts = opts; }
        emit(text: string) {
            if (this.opts?.callback_function) this.opts.callback_function(text);
        }
    }

    const fakeTokenizer = (text: string) => ({
        input_ids: [new Array(text.split(' ').length).fill(1)],
    });
    fakeTokenizer.apply_chat_template = (_msgs: any, _opts: any) => 'formatted prompt';

    const fakeModel = {
        generate: vi.fn(async (_inputs: any, opts: any) => {
            // Simulate streaming by pushing tokens via the streamer's emit.
            const streamer: TextStreamer = opts.streamer;
            const words = ['Hello', ' from', ' browser', ' model'];
            for (const w of words) {
                await Promise.resolve();
                (streamer as any).emit(w);
            }
            return [[1, 2, 3]];
        }),
    };

    return {
        AutoTokenizer: {
            from_pretrained: vi.fn(async () => fakeTokenizer),
        },
        AutoModelForCausalLM: {
            from_pretrained: vi.fn(async (_repo: string, opts: any) => {
                // Simulate a progress callback with two increments.
                opts.progress_callback?.({ loaded: 100, total: 200 });
                opts.progress_callback?.({ loaded: 200, total: 200 });
                return fakeModel;
            }),
        },
        TextStreamer,
    };
});

// Reset the module-level singletons before each test so tests don't share state.
beforeEach(async () => {
    vi.resetModules();
});

describe('BrowserChatService', () => {
    it('isBrowserChatReady returns false before loading', async () => {
        const { isBrowserChatReady } = await import('../../services/ai/BrowserChatService');
        expect(isBrowserChatReady()).toBe(false);
    });

    it('getBrowserChatLoadProgress returns 0 before loading', async () => {
        const { getBrowserChatLoadProgress } = await import('../../services/ai/BrowserChatService');
        expect(getBrowserChatLoadProgress()).toBe(0);
    });

    it('ensureBrowserChatLoaded calls onProgress and reaches 1', async () => {
        const { ensureBrowserChatLoaded, getBrowserChatLoadProgress } =
            await import('../../services/ai/BrowserChatService');
        const progressValues: number[] = [];
        await ensureBrowserChatLoaded(p => progressValues.push(p));
        expect(progressValues.length).toBeGreaterThan(0);
        expect(progressValues[progressValues.length - 1]).toBe(1);
        expect(getBrowserChatLoadProgress()).toBe(1);
    });

    it('streamBrowserChat yields text deltas', async () => {
        const { streamBrowserChat, ensureBrowserChatLoaded } =
            await import('../../services/ai/BrowserChatService');
        await ensureBrowserChatLoaded();
        const messages = [
            { role: 'system' as const, content: 'You are helpful.' },
            { role: 'user' as const, content: 'What tables are available?' },
        ];
        const chunks: string[] = [];
        for await (const delta of streamBrowserChat(messages)) {
            chunks.push(delta);
        }
        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks.join('')).toContain('Hello');
    });

    it('streamBrowserChat respects AbortSignal', async () => {
        const { streamBrowserChat, ensureBrowserChatLoaded } =
            await import('../../services/ai/BrowserChatService');
        await ensureBrowserChatLoaded();
        const controller = new AbortController();
        controller.abort();
        const messages = [{ role: 'user' as const, content: 'test' }];
        let threw = false;
        try {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _ of streamBrowserChat(messages, undefined, controller.signal)) {
                // should not reach here
            }
        } catch (e: any) {
            threw = e?.name === 'AbortError';
        }
        expect(threw).toBe(true);
    });

    it('isBrowserChatReady returns true after loading', async () => {
        const { ensureBrowserChatLoaded, isBrowserChatReady } =
            await import('../../services/ai/BrowserChatService');
        await ensureBrowserChatLoaded();
        expect(isBrowserChatReady()).toBe(true);
    });
});
