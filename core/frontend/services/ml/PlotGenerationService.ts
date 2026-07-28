import { CANDIDATES, DEFAULT_MODEL_ID, type CandidateModel, type TypedColumn, type TableSchema } from './candidates';
import { getActivePlotModel, type ActivePlotModel } from './plotModelLoader';

interface ModelEntry {
    tokenizer: any;
    model: any;
    warmed: boolean;
    candidate: CandidateModel;
}

const cache = new Map<string, ModelEntry>();
const loading = new Map<string, Promise<void>>();

let _activeModelId = DEFAULT_MODEL_ID;
let _activePlotModel: ActivePlotModel | null = null;
let _activePlotModelInit: Promise<ActivePlotModel> | null = null;

const DEV = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV === true;

function devWarn(msg: string, err?: unknown): void {
    if (DEV) console.warn(`[PlotGenerationService] ${msg}`, err);
}

class AbortError extends Error {
    constructor(msg = 'aborted') { super(msg); this.name = 'AbortError'; }
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AbortError();
}

export function setActiveModel(id: string) {
    _activeModelId = id;
}

export function getActiveModelId(): string {
    return _activeModelId;
}

/**
 * Resolve which plot model to use via plotModelLoader. When the in-tree
 * ONNX artifact is present AND meets the promotion gate (≥95% family
 * accuracy AND ≥85% column-match accuracy), the local-trained model
 * becomes the default; otherwise the current default (HF hub or cloud
 * `tiny` fallback) is kept.
 */
export function initPlotModel(): Promise<ActivePlotModel> {
    if (!_activePlotModelInit) {
        _activePlotModelInit = (async () => {
            try {
                const resolved = await getActivePlotModel();
                _activePlotModel = resolved;
                if (resolved.promoted && resolved.candidateId && CANDIDATES[resolved.candidateId]) {
                    _activeModelId = resolved.candidateId;
                }
                return resolved;
            } catch (err) {
                // Reset so a later call can retry; otherwise we lock in a
                // permanently-rejected promise.
                _activePlotModelInit = null;
                devWarn('initPlotModel failed', err);
                throw err;
            }
        })();
    }
    return _activePlotModelInit;
}

export function getActivePlotModelInfo(): ActivePlotModel | null {
    return _activePlotModel;
}

export function isModelReady(id = _activeModelId): boolean {
    return cache.get(id)?.warmed ?? false;
}

export async function ensureModelLoaded(
    id = _activeModelId,
    onProgress?: (loaded: number, total: number) => void,
    signal?: AbortSignal,
): Promise<void> {
    throwIfAborted(signal);
    if (cache.has(id)) return;

    // Deduplicate concurrent load requests for the SAME model id. Different
    // ids load independently — switching active model mid-load no longer
    // collides because each id has its own entry.
    if (loading.has(id)) {
        await loading.get(id)!;
        throwIfAborted(signal);
        return;
    }

    const candidate = CANDIDATES[id];
    if (!candidate) throw new Error(`Unknown model id: ${id}`);

    const promise = (async () => {
        const { AutoTokenizer, AutoModelForSeq2SeqLM, AutoModelForCausalLM } =
            await import('@huggingface/transformers');

        const tokenizer = await AutoTokenizer.from_pretrained(candidate.repo);
        throwIfAborted(signal);

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
        throwIfAborted(signal);

        cache.set(id, { tokenizer, model, warmed: false, candidate });

        // Warmup: fire a dummy generation to compile the WASM/GPU graph.
        // If warmup fails, evict the entry so a later call can retry from
        // scratch rather than reusing a half-initialised model.
        try {
            await _generate(id, 'warmup', ['x']);
            cache.get(id)!.warmed = true;
        } catch (err) {
            cache.delete(id);
            devWarn(`warmup failed for ${id}`, err);
            throw err;
        }
    })();

    loading.set(id, promise);
    try {
        await promise;
    } finally {
        loading.delete(id);
    }
}

async function _generate(id: string, sql: string, columns: string[] | TypedColumn[], schema?: TableSchema[], signal?: AbortSignal): Promise<string> {
    const entry = cache.get(id);
    if (!entry) throw new Error(`Model ${id} not loaded`);
    const { tokenizer, model, candidate } = entry;

    const inputText = candidate.buildInput(sql, columns, schema);
    throwIfAborted(signal);
    const tokenized = await tokenizer(inputText, {
        return_tensors: 'pt',
        truncation: true,
        max_length: 512,
    });

    const output = await model.generate({ ...tokenized }, {
        // v2 model emits plot body + clauses (TITLE, AXIS-*, LEGEND, etc.);
        // 128 covers the long-clause tail. Eval verified outputs cap around
        // ~140 chars for max sequences. Still completes in ~250ms on CPU,
        // ~50ms on WebGPU per the in-tree T5-small.
        max_new_tokens: 128,
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
    columns: string[] | TypedColumn[],
    id?: string,
    signal?: AbortSignal,
    schema?: TableSchema[],
): Promise<string> {
    if (id === undefined) {
        await initPlotModel();
        id = _activeModelId;
    }
    throwIfAborted(signal);
    await ensureModelLoaded(id, undefined, signal);
    throwIfAborted(signal);
    return _generate(id, sql, columns, schema, signal);
}
