/**
 * Streaming chat inference using @huggingface/transformers in the browser.
 *
 * Supports Qwen2.5-0.5B-Instruct (~483MB) and SmolLM2-360M-Instruct (~250MB).
 * The primary API is `streamBrowserChat`, which:
 *  1. Loads + warms the model (with progress callback).
 *  2. Formats the conversation using the model's chat template.
 *  3. Streams tokens via TextStreamer, yielding string deltas.
 *
 * Signal-safe: every async step checks `signal.aborted` and throws AbortError.
 */

// Maximum tokens the model may generate per response.
const MAX_NEW_TOKENS = 512;

export interface BrowserChatModelInfo {
    id: string;
    repo: string;
    dtype: string;
    approxSizeMb: number;
    label: string;
}

export const BROWSER_CHAT_MODELS: Record<string, BrowserChatModelInfo> = {
    'qwen2.5-0.5b': {
        id: 'qwen2.5-0.5b',
        repo: 'onnx-community/Qwen2.5-0.5B-Instruct',
        dtype: 'q4',
        approxSizeMb: 483,
        label: 'Qwen2.5-0.5B-Instruct (~483MB)',
    },
    'qwen2.5-coder-0.5b': {
        id: 'qwen2.5-coder-0.5b',
        repo: 'onnx-community/Qwen2.5-Coder-0.5B-Instruct',
        dtype: 'q4',
        approxSizeMb: 490,
        label: 'Qwen2.5-Coder-0.5B (~490MB, code-tuned)',
    },
};

export const DEFAULT_BROWSER_CHAT_MODEL_ID = 'qwen2.5-0.5b';

export interface BrowserChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// Module-level singleton so the model stays loaded across multiple calls.
// Keyed by model ID so switching models reloads cleanly.
let _loadedModelId: string | null = null;
let _tokenizer: any = null;
let _model: any = null;
let _loadingPromise: Promise<void> | null = null;
let _loadProgress = 0;  // 0–1, for external polling if needed

/** Current download progress (0–1). */
export function getBrowserChatLoadProgress(): number {
    return _loadProgress;
}

/** True when the model is loaded and ready. */
export function isBrowserChatReady(): boolean {
    return _tokenizer !== null && _model !== null;
}

class AbortError extends Error {
    constructor(msg = 'aborted') { super(msg); this.name = 'AbortError'; }
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AbortError();
}

/**
 * Load the chat model + tokenizer. Safe to call multiple times; concurrent
 * calls share the same promise. Passes progress (0–1) to `onProgress`.
 * If a different modelId is requested than what's loaded, reloads from scratch.
 */
export async function ensureBrowserChatLoaded(
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
    modelId: string = DEFAULT_BROWSER_CHAT_MODEL_ID,
): Promise<void> {
    throwIfAborted(signal);
    if (_tokenizer && _model && _loadedModelId === modelId) return;

    // Different model requested — drop the previous singleton.
    if (_tokenizer && _loadedModelId !== modelId) {
        _tokenizer = null;
        _model = null;
        _loadedModelId = null;
        _loadingPromise = null;
        _loadProgress = 0;
    }

    if (_loadingPromise) {
        await _loadingPromise;
        throwIfAborted(signal);
        return;
    }

    const modelInfo = BROWSER_CHAT_MODELS[modelId] ?? BROWSER_CHAT_MODELS[DEFAULT_BROWSER_CHAT_MODEL_ID];

    _loadingPromise = (async () => {
        const { AutoTokenizer, AutoModelForCausalLM } =
            await import('@huggingface/transformers');

        _tokenizer = await AutoTokenizer.from_pretrained(modelInfo.repo);
        throwIfAborted(signal);

        _model = await AutoModelForCausalLM.from_pretrained(modelInfo.repo, {
            dtype: modelInfo.dtype as any,
            device: 'webgpu',  // falls back to WASM automatically
            progress_callback: (p: any) => {
                const loaded = p.loaded ?? 0;
                const total = p.total ?? 1;
                _loadProgress = total > 0 ? loaded / total : 0;
                onProgress?.(_loadProgress);
            },
        });
        throwIfAborted(signal);
        _loadedModelId = modelId;
        _loadProgress = 1;
        onProgress?.(1);
    })();

    try {
        await _loadingPromise;
    } catch (err) {
        // Reset so the next call can retry from scratch.
        _tokenizer = null;
        _model = null;
        _loadingPromise = null;
        _loadProgress = 0;
        throw err;
    } finally {
        _loadingPromise = null;
    }
}

/**
 * Stream a chat response from the in-browser model.
 *
 * @param messages  Conversation history (system + user/assistant turns).
 * @param onProgress  Called during model download with progress 0–1.
 * @param signal  AbortSignal to cancel mid-generation.
 * @param modelId  Which browser chat model to use (defaults to Qwen2.5-0.5B).
 * @yields  String deltas (token text) as they are generated.
 */
export async function* streamBrowserChat(
    messages: BrowserChatMessage[],
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
    modelId: string = DEFAULT_BROWSER_CHAT_MODEL_ID,
): AsyncGenerator<string> {
    throwIfAborted(signal);

    await ensureBrowserChatLoaded(onProgress, signal, modelId);
    throwIfAborted(signal);

    const { TextStreamer } = await import('@huggingface/transformers');

    // Format messages with the model's chat template.
    const inputText = _tokenizer.apply_chat_template(messages, {
        tokenize: false,
        add_generation_prompt: true,
    });

    const tokenized = await _tokenizer(inputText, {
        return_tensors: 'pt',
        truncation: true,
        max_length: 2048,
    });
    throwIfAborted(signal);

    // Collect deltas via a queue so we can yield from the async generator.
    const queue: string[] = [];
    let done = false;
    let resolveWaiter: (() => void) | null = null;

    const streamer = new TextStreamer(_tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text: string) => {
            if (signal?.aborted) return;
            if (text) {
                queue.push(text);
                resolveWaiter?.();
                resolveWaiter = null;
            }
        },
    });

    const genPromise = _model.generate(
        { ...tokenized },
        {
            max_new_tokens: MAX_NEW_TOKENS,
            do_sample: true,
            temperature: 0.7,
            top_p: 0.9,
            repetition_penalty: 1.1,
            streamer,
        },
    );

    genPromise
        .then(() => {
            done = true;
            resolveWaiter?.();
            resolveWaiter = null;
        })
        .catch((err: any) => {
            done = true;
            resolveWaiter?.();
            resolveWaiter = null;
            if (err?.name !== 'AbortError' && !signal?.aborted) {
                // Re-surface non-abort errors by flagging them for the generator.
                (genPromise as any).__err = err;
            }
        });

    while (!done || queue.length > 0) {
        throwIfAborted(signal);

        while (queue.length > 0) {
            yield queue.shift()!;
        }

        if (!done) {
            await new Promise<void>(resolve => { resolveWaiter = resolve; });
        }
    }

    // Check for non-abort errors.
    const err = (genPromise as any).__err;
    if (err) throw err;
}
