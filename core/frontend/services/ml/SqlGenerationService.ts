/**
 * SqlGenerationService — load + run the in-tree T5-small SQL completion model.
 *
 * Mirrors PlotGenerationService but for SQL: takes the user's `prefix`
 * (everything before the cursor) and the schema, and returns the predicted
 * completion (next 1–60 tokens).
 *
 * The artifact lives at `services/ml/models/sql-suggester/`. Promotion is
 * gated by `eval.json`: usefulCompletionRate ≥ 0.70.
 */

import type { TableSchema } from './candidates';

interface ModelEntry {
    tokenizer: any;
    model: any;
    warmed: boolean;
}

const cache = new Map<string, ModelEntry>();
const loading = new Map<string, Promise<void>>();

const ARTIFACT_REPO = './services/ml/models/sql-suggester';
const ARTIFACT_ID = 'sql-suggester-local';

const DEV = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV === true;

function devWarn(msg: string, err?: unknown): void {
    if (DEV) console.warn(`[SqlGenerationService] ${msg}`, err);
}

class AbortError extends Error {
    constructor(msg = 'aborted') { super(msg); this.name = 'AbortError'; }
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AbortError();
}

function buildInput(prefix: string, schema?: TableSchema[]): string {
    const parts: string[] = [];
    if (schema && schema.length > 0) {
        const lines = ['schema:'];
        for (const tbl of schema.slice(0, 3)) {
            const cols = tbl.columns.slice(0, 12)
                .map(c => c.type ? `"${c.name}" ${c.type}` : `"${c.name}"`)
                .join(', ');
            lines.push(`- "${tbl.name}": (${cols})`);
        }
        parts.push(lines.join('\n'));
    }
    parts.push(`prefix: ${prefix}`);
    return parts.join('\n');
}

export function isSqlModelReady(): boolean {
    return cache.get(ARTIFACT_ID)?.warmed ?? false;
}

export async function ensureSqlModelLoaded(
    signal?: AbortSignal,
    onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
    throwIfAborted(signal);
    if (cache.has(ARTIFACT_ID)) return;
    if (loading.has(ARTIFACT_ID)) {
        await loading.get(ARTIFACT_ID)!;
        throwIfAborted(signal);
        if (!cache.has(ARTIFACT_ID)) throw new Error('SQL model failed to load');
        return;
    }

    const promise = (async () => {
        const { AutoTokenizer, AutoModelForSeq2SeqLM } = await import('@huggingface/transformers');
        const tokenizer = await AutoTokenizer.from_pretrained(ARTIFACT_REPO);
        throwIfAborted(signal);
        const model = await AutoModelForSeq2SeqLM.from_pretrained(ARTIFACT_REPO, {
            dtype: 'fp32',
            device: 'webgpu',
            progress_callback: onProgress
                ? (p: any) => onProgress(p.loaded ?? 0, p.total ?? 1)
                : undefined,
        });
        throwIfAborted(signal);
        cache.set(ARTIFACT_ID, { tokenizer, model, warmed: false });
        try {
            await _generate('SELECT ', undefined);
            cache.get(ARTIFACT_ID)!.warmed = true;
        } catch (err) {
            cache.delete(ARTIFACT_ID);
            devWarn('warmup failed', err);
            throw err;
        }
    })();
    loading.set(ARTIFACT_ID, promise);
    try {
        await promise;
    } finally {
        loading.delete(ARTIFACT_ID);
    }
}

async function _generate(prefix: string, schema?: TableSchema[], signal?: AbortSignal): Promise<string> {
    const entry = cache.get(ARTIFACT_ID);
    if (!entry) throw new Error('SQL model not loaded');
    const { tokenizer, model } = entry;
    const input = buildInput(prefix, schema);
    throwIfAborted(signal);
    const tokenized = await tokenizer(input, {
        return_tensors: 'pt',
        truncation: true,
        max_length: 512,
    });
    throwIfAborted(signal);
    const output = await model.generate({ ...tokenized }, {
        max_new_tokens: 64,
        do_sample: false,
        early_stopping: true,
    });
    throwIfAborted(signal);
    const decoded: string = tokenizer.decode(output[0], { skip_special_tokens: true });
    return cleanSqlCompletion(decoded, prefix);
}

/**
 * Clean noisy seq2seq output. The model was trained to emit just the
 * continuation, but stray special tokens / fences / echoes still leak.
 */
export function cleanSqlCompletion(raw: string, prefix: string): string {
    let s = (raw ?? '').replace(/<\|?(?:endoftext|im_start|im_end|s|pad|unk|extra_id_\d+)\|?>/gi, '');
    s = s.replace(/<\/?s>/gi, '').replace(/```[a-z]*\n?/gi, '').replace(/```/g, '');
    s = s.replace(/<<CURSOR>>/g, '').trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    // Echo guard: if the model restated the prefix, strip it.
    if (s.startsWith(prefix)) {
        s = s.slice(prefix.length);
    }
    // Echo guard for prefix-ending word.
    const tail = prefix.match(/(\w+)\s*$/)?.[1];
    if (tail && s.toLowerCase().startsWith(tail.toLowerCase() + ' ')) {
        s = s.slice(tail.length + 1);
    }
    return s.trim();
}

export async function generateSqlCompletion(
    prefix: string,
    schema?: TableSchema[],
    signal?: AbortSignal,
): Promise<string> {
    throwIfAborted(signal);
    await ensureSqlModelLoaded(signal);
    throwIfAborted(signal);
    return _generate(prefix, schema, signal);
}
