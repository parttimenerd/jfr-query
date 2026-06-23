import { CANDIDATES, DEFAULT_MODEL_ID, type CandidateModel } from './candidates';

interface ModelEntry {
    tokenizer: any;
    model: any;
    warmed: boolean;
    candidate: CandidateModel;
}

const cache = new Map<string, ModelEntry>();
const loading = new Map<string, Promise<void>>();

let _activeModelId = DEFAULT_MODEL_ID;

export function setActiveModel(id: string) {
    _activeModelId = id;
}

export function getActiveModelId(): string {
    return _activeModelId;
}

export function isModelReady(id = _activeModelId): boolean {
    return cache.get(id)?.warmed ?? false;
}

export async function ensureModelLoaded(
    id = _activeModelId,
    onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
    if (cache.has(id)) return;

    // Deduplicate concurrent load requests
    if (loading.has(id)) return loading.get(id)!;

    const candidate = CANDIDATES[id];
    if (!candidate) throw new Error(`Unknown model id: ${id}`);

    const promise = (async () => {
        const { AutoTokenizer, AutoModelForSeq2SeqLM, AutoModelForCausalLM } =
            await import('@huggingface/transformers');

        const tokenizer = await AutoTokenizer.from_pretrained(candidate.repo);

        const ModelClass =
            candidate.kind === 'seq2seq' ? AutoModelForSeq2SeqLM : AutoModelForCausalLM;

        const model = await ModelClass.from_pretrained(candidate.repo, {
            dtype: candidate.dtype,
            device: 'webgpu', // falls back to WASM automatically
            progress_callback: onProgress
                ? (p: any) => {
                      const loaded = p.loaded ?? 0;
                      const total = p.total ?? 1;
                      onProgress(loaded, total);
                  }
                : undefined,
        });

        cache.set(id, { tokenizer, model, warmed: false, candidate });

        // Warmup: fire a dummy generation to compile the WASM/GPU graph
        await _generate(id, 'warmup', ['x']);
        cache.get(id)!.warmed = true;
    })();

    loading.set(id, promise);
    try {
        await promise;
    } finally {
        loading.delete(id);
    }
}

async function _generate(id: string, sql: string, columns: string[]): Promise<string> {
    const entry = cache.get(id);
    if (!entry) throw new Error(`Model ${id} not loaded`);
    const { tokenizer, model, candidate } = entry;

    const inputText = candidate.buildInput(sql, columns);
    const tokenized = await tokenizer(inputText, {
        return_tensors: 'pt',
        truncation: true,
        max_length: 256,
    });

    const output = await model.generate({ ...tokenized }, {
        max_new_tokens: 32,
        do_sample: false,
        early_stopping: true,
    });

    // For causal LM, strip the prompt tokens from the output
    const outputIds =
        candidate.kind === 'causal-lm'
            ? output[0].slice(tokenized.input_ids[0].length)
            : output[0];

    const decoded: string = tokenizer.decode(outputIds, { skip_special_tokens: true });
    return candidate.extractOutput(decoded);
}

export async function generate(
    sql: string,
    columns: string[],
    id = _activeModelId,
): Promise<string> {
    await ensureModelLoaded(id);
    return _generate(id, sql, columns);
}
