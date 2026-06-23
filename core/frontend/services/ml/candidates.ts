/**
 * Registry of candidate Tier-2 plot-config generation models for benchmarking
 * and deployment. The bench harness and PlotGenerationService both import this.
 *
 * When a model is chosen, set ACTIVE_MODEL_ID in PlotGenerationService.ts to
 * the desired id; only that model is loaded at runtime.
 */

export type ModelKind = 'seq2seq' | 'causal-lm';
export type ModelDtype = 'q4' | 'q8' | 'fp16' | 'q4f16';

export interface CandidateModel {
    id: string;
    label: string;
    repo: string;               // HuggingFace repo id (Xenova/* or onnx-community/*)
    kind: ModelKind;
    dtype: ModelDtype;
    approxSizeMb: number;       // approximate download size
    /** Build input string for the model (seq2seq just uses the text directly) */
    buildInput: (sql: string, columns: string[]) => string;
    /** Strip any chat-template wrapping from decoded output */
    extractOutput: (decoded: string) => string;
}

const SEQ2SEQ_INPUT = (sql: string, columns: string[]) =>
    `sql: ${sql}\ncolumns: ${columns.join(', ')}`;

const SEQ2SEQ_EXTRACT = (s: string) => s.trim();

const INSTRUCT_INPUT = (systemPrompt: string) => (sql: string, columns: string[]) =>
    `<|system|>\n${systemPrompt}\n<|user|>\nsql: ${sql}\ncolumns: ${columns.join(', ')}\n<|assistant|>`;

const QWEN_INPUT = (sql: string, columns: string[]) =>
    `<|im_start|>system\nYou are a plot config generator. Output ONLY the plot config string, nothing else.<|im_end|>\n<|im_start|>user\nsql: ${sql}\ncolumns: ${columns.join(', ')}<|im_end|>\n<|im_start|>assistant\n`;

// Strip everything after a newline or special token — model may emit trailing text
const FIRST_LINE = (s: string) => s.split('\n')[0].trim();

export const CANDIDATES: Record<string, CandidateModel> = {
    /**
     * Fine-tuned T5-small LoRA (v10) — trained specifically on plot config generation.
     * 96% accuracy on 24-case test suite. ~77MB ARM64 INT8 quantized.
     * Repo: publish to HuggingFace Hub before deploying.
     * Local export: onnx/t5-small-q8-arm (run scripts/train/run_training.sh to rebuild).
     */
    't5-small-finetuned': {
        id: 't5-small-finetuned',
        label: 'T5-small fine-tuned (60M, seq2seq, ~77MB) — 96% plot accuracy',
        repo: 'YOUR_HF_ORG/jfr-plot-config-t5-small-q8-arm',  // update after HF upload
        kind: 'seq2seq',
        dtype: 'q8',
        approxSizeMb: 77,
        buildInput: SEQ2SEQ_INPUT,
        extractOutput: SEQ2SEQ_EXTRACT,
    },
    'flan-t5-small': {
        id: 'flan-t5-small',
        label: 'FLAN-T5-small (77M, seq2seq, ~97MB)',
        repo: 'Xenova/flan-t5-small',
        kind: 'seq2seq',
        dtype: 'q8',
        approxSizeMb: 97,
        buildInput: SEQ2SEQ_INPUT,
        extractOutput: SEQ2SEQ_EXTRACT,
    },
    't5-small': {
        id: 't5-small',
        label: 'T5-small (60M, seq2seq, ~32MB)',
        repo: 'Xenova/t5-small',
        kind: 'seq2seq',
        dtype: 'q8',
        approxSizeMb: 32,
        buildInput: SEQ2SEQ_INPUT,
        extractOutput: SEQ2SEQ_EXTRACT,
    },
    'qwen2.5-0.5b': {
        id: 'qwen2.5-0.5b',
        label: 'Qwen2.5-0.5B-Instruct (0.5B, decoder, ~483MB)',
        repo: 'onnx-community/Qwen2.5-0.5B-Instruct',
        kind: 'causal-lm',
        dtype: 'q4',
        approxSizeMb: 483,
        buildInput: QWEN_INPUT,
        extractOutput: FIRST_LINE,
    },
    'qwen2.5-coder-0.5b': {
        id: 'qwen2.5-coder-0.5b',
        label: 'Qwen2.5-Coder-0.5B-Instruct (0.5B, decoder, code-pretrained, ~490MB)',
        repo: 'onnx-community/Qwen2.5-Coder-0.5B-Instruct',
        kind: 'causal-lm',
        dtype: 'q4',
        approxSizeMb: 490,
        buildInput: QWEN_INPUT,
        extractOutput: FIRST_LINE,
    },
    'smollm2-360m': {
        id: 'smollm2-360m',
        label: 'SmolLM2-360M-Instruct (360M, decoder, ~250MB)',
        repo: 'onnx-community/SmolLM2-360M-Instruct',
        kind: 'causal-lm',
        dtype: 'q4',
        approxSizeMb: 250,
        buildInput: QWEN_INPUT,
        extractOutput: FIRST_LINE,
    },
    't5-base': {
        id: 't5-base',
        label: 'T5-base (220M, seq2seq, ~210MB) — rescue option',
        repo: 'Xenova/t5-base',
        kind: 'seq2seq',
        dtype: 'q8',
        approxSizeMb: 210,
        buildInput: SEQ2SEQ_INPUT,
        extractOutput: SEQ2SEQ_EXTRACT,
    },
};

export const DEFAULT_MODEL_ID = 't5-small-finetuned';
