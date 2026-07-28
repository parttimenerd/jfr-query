// Runtime loader for the retrieval-based prompt suggester. Loads the
// embedding matrix (Float32 binary) + aligned metadata, embeds the user's
// current notebook context with MiniLM, and returns the top-K nearest
// prompts. Disabled (returns []) when VITE_USE_LOCAL_ML is off or artifacts
// are absent.

const DIM = 384;
const enabled = (import.meta as any).env?.VITE_USE_LOCAL_ML === 'true';

interface PromptEntry {
    suggestedPrompt: string;
    category: string;
}

interface SuggesterMeta {
    version: number;
    dim: number;
    count: number;
    prompts: PromptEntry[];
}

let _matrix: Float32Array | null = null;
let _prompts: PromptEntry[] | null = null;
let _loadAttempted = false;
let _embedFn: ((s: string) => Promise<Float32Array | null>) | null = null;

function cosine(a: Float32Array, b: Float32Array, offset: number): number {
    let s = 0;
    for (let i = 0; i < DIM; i++) s += a[i] * b[offset + i];
    return s;
}

async function tryLoadArtifacts(): Promise<void> {
    if (_loadAttempted) return;
    _loadAttempted = true;
    if (!enabled) return;
    try {
        const metaMod = await import('./promptSuggestions.json');
        const meta = (metaMod.default ?? metaMod) as SuggesterMeta;
        // Vite emits ?url for arbitrary assets.
        const binUrl = (await import('./promptSuggestions.bin?url')).default as string;
        const resp = await fetch(binUrl);
        const buf = await resp.arrayBuffer();
        _matrix = new Float32Array(buf);
        _prompts = meta.prompts;
    } catch {
        _loadAttempted = false;
        _matrix = null;
        _prompts = null;
    }
}

async function defaultEmbed(text: string): Promise<Float32Array | null> {
    try {
        const { pipeline, env } = await import('@huggingface/transformers');
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        const ext = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            dtype: 'q4',
        });
        const out: any = await ext([text], { pooling: 'mean', normalize: true });
        const flat = out.data as Float32Array;
        return flat.subarray(0, DIM);
    } catch {
        return null;
    }
}

export interface PromptSuggestion {
    prompt: string;
    category: string;
    score: number;
}

export class PromptSuggester {
    static async ensureLoaded(): Promise<void> {
        await tryLoadArtifacts();
    }

    static isAvailable(): boolean {
        return _matrix !== null && _prompts !== null;
    }

    static async suggest(context: string, k = 3): Promise<PromptSuggestion[]> {
        await PromptSuggester.ensureLoaded();
        if (!_matrix || !_prompts) return [];
        const embed = _embedFn ?? defaultEmbed;
        const q = await embed(context);
        if (!q) return [];
        const n = _prompts.length;
        const scored: PromptSuggestion[] = new Array(n);
        for (let i = 0; i < n; i++) {
            scored[i] = {
                prompt: _prompts[i]!.suggestedPrompt,
                category: _prompts[i]!.category,
                score: cosine(q, _matrix, i * DIM),
            };
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, k);
    }

    // Test-only injection: skip dynamic imports and use the supplied arrays.
    static _setForTest(
        matrix: Float32Array | null,
        prompts: PromptEntry[] | null,
        embed?: (s: string) => Promise<Float32Array | null>,
    ): void {
        _matrix = matrix;
        _prompts = prompts;
        _loadAttempted = true;
        _embedFn = embed ?? null;
    }
}
