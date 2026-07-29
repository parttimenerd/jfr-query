/**
 * Registry of candidate Tier-2 plot-config generation models for benchmarking
 * and deployment. The bench harness and PlotGenerationService both import this.
 *
 * When a model is chosen, set ACTIVE_MODEL_ID in PlotGenerationService.ts to
 * the desired id; only that model is loaded at runtime.
 */

export type ModelKind = 'seq2seq' | 'causal-lm';
export type ModelDtype = 'q4' | 'q8' | 'fp16' | 'q4f16' | 'fp32';

// Typed column metadata for v2 input format. Mirrors the autocomplete/chat
// schema-context shape so the plot model gets the same signal density.
export interface TypedColumn { name: string; type?: string; }
export interface TableSchema { name: string; columns: TypedColumn[]; }

export type InputFormatVersion = 'v1' | 'v2' | 'v3';

export interface CandidateModel {
    id: string;
    label: string;
    repo: string;               // HuggingFace repo id (Xenova/* or onnx-community/*)
    kind: ModelKind;
    dtype: ModelDtype;
    approxSizeMb: number;       // approximate download size
    /**
     * Build input string for the model.
     * v1 entries pass `columns: string[]` (names only) — legacy.
     * v2 entries pass typed columns + an optional schema preamble. Both
     * variants are kept so models trained on v1 datasets keep working until
     * v2-trained artifacts pass the promotion gate.
     */
    buildInput: (sql: string, columns: string[] | TypedColumn[], schema?: TableSchema[]) => string;
    /** Strip any chat-template wrapping from decoded output */
    extractOutput: (decoded: string) => string;
    /** Which input format this candidate expects. Defaults to 'v1'. */
    inputFormat?: InputFormatVersion;
}

const SEQ2SEQ_INPUT = (sql: string, columns: string[] | TypedColumn[]) => {
    const colsStr = (columns as any[]).map(c => typeof c === 'string' ? c : c.name).join(', ');
    return `sql: ${sql}\ncolumns: ${colsStr}`;
};

// V2: typed columns + optional schema preamble. Mirrors the autocomplete
// context shape (cap: 3 tables × 12 cols) so we stay well under T5-small's
// 512-token budget.
const SEQ2SEQ_INPUT_V2 = (sql: string, columns: string[] | TypedColumn[], schema?: TableSchema[]): string => {
    const typed = (columns as any[]).map(c => typeof c === 'string' ? { name: c } as TypedColumn : c as TypedColumn);
    const colsStr = typed.map(c => c.type ? `"${c.name}" ${c.type}` : `"${c.name}"`).join(', ');
    let out = `sql: ${sql}\ncolumns: ${colsStr}`;
    if (schema && schema.length > 0) {
        const capped = schema.slice(0, 3);
        const tableLines = capped.map(t => {
            const colList = t.columns.slice(0, 12).map(c => c.type ? `"${c.name}" ${c.type}` : `"${c.name}"`).join(', ');
            return `- "${t.name}": (${colList})`;
        });
        out += `\nschema:\n${tableLines.join('\n')}`;
    }
    return out;
};

/**
 * Extract compact structural signals from SQL + columns to form a hint prefix.
 *
 * The signal line is a space-separated set of short tags injected before the
 * sql/columns body so the T5 encoder sees a dense summary at position 0
 * (where attention is strongest). Tags:
 *
 *   agg      — has GROUP BY (→ BAR/PIE/HEATMAP/TREEMAP likely)
 *   cross    — GROUP BY 2+ cols, no ORDER BY (→ HEATMAP; 100% coverage, 0% BAR)
 *   ordered  — has ORDER BY + LIMIT (ranked list → BAR_CHART likely)
 *   sorted   — has ORDER BY without LIMIT (BAR_CHART with explicit sort)
 *   raw      — no GROUP/AGG/ORDER, has LIMIT (raw tabular → TABLE; 75% TABLE, ~0% BAR)
 *   scalar   — aggregate fn (COUNT/SUM/etc.) without GROUP BY (single-row → TABLE)
 *   having   — has HAVING clause
 *   time     — timestamp/time-named column (→ LINE_CHART/AREA_CHART likely)
 *   wide     — 3+ result columns
 *   solo     — exactly 1 result column (→ HISTOGRAM: 98% coverage, 0% BAR/PIE/LINE)
 *   duo      — exactly 2 result columns (→ PIE/TREEMAP/WATERFALL/FLAMEGRAPH: 98-100%)
 *   stack    — stack-trace column (→ FLAMEGRAPH likely)
 *   gc       — JFR GC domain (pause, heap, GC*)
 *   alloc    — JFR allocation domain (alloc*, tlab, retained)
 *   cpu      — JFR CPU/thread domain (cpu*, thread*, method*)
 *   delta    — delta/change/diff column (→ WATERFALL likely)
 *   range    — start+end or low+high column pair (→ RANGE/GANTT likely)
 *   num:N    — number of numeric columns (0–4, capped)
 *   cat:N    — number of categorical columns (0–4, capped)
 *
 * Kept short (<80 chars typical) to stay inside T5-small's 512-token budget
 * alongside the sql + columns lines.
 */
export function extractInputSignals(sql: string, columns: string[] | TypedColumn[]): string {
    const sqlUp = sql.toUpperCase();
    const typed = (columns as any[]).map(c =>
        typeof c === 'string' ? { name: c, type: undefined } as TypedColumn : c as TypedColumn,
    );
    const names = typed.map(c => c.name.toLowerCase());
    const types = typed.map(c => (c.type ?? '').toUpperCase());

    const tags: string[] = [];

    // SQL structural flags
    if (/\bGROUP\s+BY\b/.test(sqlUp)) tags.push('agg');
    const hasOrderBy = /\bORDER\s+BY\b/.test(sqlUp);
    const hasLimit = /\bLIMIT\b/.test(sqlUp);
    const hasGroupBy = /\bGROUP\s+BY\b/.test(sqlUp);
    const hasAggrFn = /\b(?:COUNT|SUM|AVG|MIN|MAX)\s*\(/.test(sqlUp);
    if (hasOrderBy && hasLimit) tags.push('ordered');
    else if (hasOrderBy) tags.push('sorted');

    // Cross-dimensional aggregation (GROUP BY 2+ cols, no ORDER BY) → HEATMAP.
    // Fires in 100% of HEATMAP training examples and 0% of BAR_CHART.
    const gbMatch = /\bGROUP\s+BY\b([\s\S]+?)(?:\bHAVING\b|\bORDER\b|\bLIMIT\b|$)/i.exec(sql);
    if (gbMatch && !hasOrderBy && gbMatch[1].includes(',')) tags.push('cross');

    // Raw select: no GROUP BY, no aggregate fn, no ORDER BY, LIMIT present → TABLE.
    // Fires in 75% of TABLE training examples and ~0% of BAR/HISTOGRAM.
    if (!hasGroupBy && !hasAggrFn && !hasOrderBy && hasLimit) tags.push('raw');

    // Scalar aggregate: aggregate fn, no GROUP BY → single-row result → TABLE.
    // Fires in 9% of TABLE, 0% of other plot types.
    if (hasAggrFn && !hasGroupBy) tags.push('scalar');

    if (/\bHAVING\b/.test(sqlUp)) tags.push('having');

    // Column count — exact-count signals complement the wide (3+) tag.
    // solo: exactly 1 col fires 98% HISTOGRAM, 0% BAR/PIE/LINE/HEATMAP.
    // duo:  exactly 2 cols fires 100% PIE/TREEMAP/WATERFALL, 98% FLAMEGRAPH.
    if (typed.length === 1) tags.push('solo');
    if (typed.length === 2) tags.push('duo');
    if (typed.length >= 3) tags.push('wide');

    // Time signal — column names containing time/timestamp/bucket or typed as TIMESTAMP.
    // Use substring match (not word boundary) because camelCase names like
    // "startTime" and "eventTime" should also trigger this.
    // Also catch _at / _ts / _dt suffixes common in generic schemas.
    const hasTimestamp =
        types.some(t => t === 'TIMESTAMP' || t === 'DATE' || t === 'TIMESTAMP_NS' || t === 'TIMESTAMP_MS') ||
        names.some(n => /time|timestamp|bucket|date|_at$|_ts$|_dt$|^ts$|^dt$|^when$/.test(n));
    if (hasTimestamp) tags.push('time');

    // Stack trace signal — FLAMEGRAPH indicator
    const hasStack =
        names.some(n => /stack|frame|trace/.test(n)) ||
        types.some(t => t === 'VARCHAR' && names.some(n => n.includes('stack')));
    if (hasStack) tags.push('stack');

    // JFR domain signals
    const allNames = names.join(' ');
    if (/gc|pause|heap|reclai|young|old|survivor|tenur/.test(allNames) ||
        /GC|Garbage|GARBAGE|HEAP|Heap/i.test(sql)) tags.push('gc');
    if (/alloc|tlab|retained|live|object|class/.test(allNames)) tags.push('alloc');
    if (/cpu|thread|method|jvm|machine|load|worker/.test(allNames)) tags.push('cpu');

    // Delta/change signal → WATERFALL hint
    if (/delta|change|diff|decrement|increment/.test(allNames)) tags.push('delta');

    // Range/interval signal → RANGE or GANTT hint (start+end or low+high columns)
    // Use per-name checks: startTime, endTime, low, high, min, max all qualify.
    const hasRangeStart = names.some(n => /start|begin/.test(n) || n === 'low' || n === 'min' || /lower/.test(n));
    const hasRangeEnd = names.some(n => /\bend/.test(n) || /finish/.test(n) || n === 'high' || n === 'max' || /upper/.test(n));
    if (hasRangeStart && hasRangeEnd) tags.push('range');

    // Count numeric vs categorical columns using type info when available.
    let numCount = 0;
    let catCount = 0;
    const NUM_TYPES = new Set(['INTEGER', 'BIGINT', 'DOUBLE', 'FLOAT', 'DECIMAL', 'NUMERIC',
        'SMALLINT', 'TINYINT', 'REAL', 'HUGEINT', 'INT4', 'INT8', 'FLOAT4', 'FLOAT8']);
    for (let i = 0; i < typed.length; i++) {
        const t = types[i] ?? '';
        const n = names[i] ?? '';
        if (NUM_TYPES.has(t) || (t === '' && /(?:count|size|ms|mb|kb|rate|pct|load|pause|duration|alloc|heap|cpu|ticks|samples|total|avg|max|p\d+)/i.test(n))) {
            numCount++;
        } else if (t === 'VARCHAR' || t === 'TEXT' || t === 'STRING' || (t === '' && !/time|stamp|date|bucket|_at$|_ts$|_dt$/.test(n))) {
            catCount++;
        }
    }
    tags.push(`num:${Math.min(numCount, 4)}`);
    tags.push(`cat:${Math.min(catCount, 4)}`);

    return tags.join(' ');
}

// V3: signals header + typed columns. The compact tag line gives T5 dense
// structural hints at position 0 where attention is strongest.
const SEQ2SEQ_INPUT_V3 = (sql: string, columns: string[] | TypedColumn[], schema?: TableSchema[]): string => {
    const signals = extractInputSignals(sql, columns);
    const typed = (columns as any[]).map(c => typeof c === 'string' ? { name: c } as TypedColumn : c as TypedColumn);
    const colsStr = typed.map(c => c.type ? `"${c.name}" ${c.type}` : `"${c.name}"`).join(', ');
    let out = `hints: ${signals}\nsql: ${sql}\ncolumns: ${colsStr}`;
    if (schema && schema.length > 0) {
        const capped = schema.slice(0, 3);
        const tableLines = capped.map(t => {
            const colList = t.columns.slice(0, 12).map(c => c.type ? `"${c.name}" ${c.type}` : `"${c.name}"`).join(', ');
            return `- "${t.name}": (${colList})`;
        });
        out += `\nschema:\n${tableLines.join('\n')}`;
    }
    return out;
};

// Known plot names — used to find the start of a config inside noisy model output.
// Listed in canonical-uppercase form. Lower/short aliases are recognized via the
// ergonomic-parser short-alias table, so the extractor only needs canonical names
// here.
const PLOT_NAMES = [
    'LINE_CHART', 'BAR_CHART', 'AREA_CHART', 'SCATTER_PLOT', 'PIE_CHART',
    'HISTOGRAM', 'HEATMAP', 'BOX_PLOT', 'TABLE', 'FLAMEGRAPH', 'GANTT', 'RANGE',
    'TREEMAP', 'WATERFALL',
    // Composition primitives.
    'ROW', 'COL',
    // Legacy names still emitted by older artifacts — keep parseable.
    'FLAME_GRAPH', 'GANTT_CHART', 'RANGE_PLOT',
];

// Short aliases the ergonomic parser accepts. Mirrors components/plots/plotRegistry.ts
// (W12). Case-insensitive at parse time, so we match case-insensitively here too.
const PLOT_SHORT_ALIASES = [
    'line', 'bar', 'area', 'scatter', 'pie', 'box', 'hist',
    'heatmap', 'flame', 'gantt', 'range', 'table', 'tree', 'fall',
];

// Regex that finds the FIRST occurrence of any plot name (canonical or short
// alias), case-insensitive, anchored at a word boundary so we don't match inside
// identifiers (e.g. `linear` doesn't match `line`).
const PLOT_NAME_REGEX = new RegExp(
    '(?:^|[^A-Za-z0-9_])(' +
        [...PLOT_NAMES, ...PLOT_SHORT_ALIASES].join('|') +
        ')(?=\\s*\\()',
    'i',
);

/**
 * Pull a plot-config substring out of noisy model output. Handles:
 *   - chain-of-thought blocks (<think>…</think>, <thinking>…</thinking>)
 *   - markdown code fences (```/```plot/```sql)
 *   - leading prose ("Sure, here is the config: …")
 *   - HF special tokens (<pad>, <s>, </s>, <|endoftext|>, <|im_end|>, etc.)
 *   - leading/trailing quotes
 *   - trailing prose after a balanced plot config
 * Returns 'TABLE()' as a safe default when nothing recognisable is found.
 */
export function cleanPlotConfig(raw: string): string {
    let s = raw ?? '';

    // Strip chain-of-thought reasoning blocks emitted by Qwen3 / DeepSeek-R1.
    s = s.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
    s = s.replace(/<think(?:ing)?>[\s\S]*$/i, '');  // unclosed CoT

    // Strip common HF special tokens.
    s = s.replace(/<\|?(?:endoftext|im_start|im_end|s|pad|unk|extra_id_\d+)\|?>/gi, '');
    s = s.replace(/<\/?s>/gi, '');

    // Strip markdown code fences.
    s = s.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');

    s = s.trim();

    // Strip wrapping quotes (single, double, smart).
    if ((s.startsWith('"') && s.endsWith('"')) ||
        (s.startsWith("'") && s.endsWith("'")) ||
        (s.startsWith('`') && s.endsWith('`'))) {
        s = s.slice(1, -1).trim();
    }

    // Find the first occurrence of a known plot name (canonical or short alias),
    // case-insensitively. Word-boundary anchored so `linear` doesn't match `line`.
    const m = PLOT_NAME_REGEX.exec(s);
    if (!m || m.index === undefined) return 'TABLE()';

    // Adjust earliest to the plot-name start, not the boundary char.
    const earliest = m.index + (m[0].length - m[1].length);
    if (earliest > 0) s = s.slice(earliest);

    // Take the first paren-balanced expression starting at the plot name.
    const open = s.indexOf('(');
    if (open === -1) return 'TABLE()';

    let depth = 0;
    let end = -1;
    let inStr: string | null = null;
    let escape = false;
    for (let i = open; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === inStr) inStr = null;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = ch; continue; }
        if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }

    // Unclosed paren — malformed output, return safe default.
    if (end === -1) return 'TABLE()';

    // Only keep recognised trailing modifiers (TITLE, LINK_X, etc.);
    // strip any trailing prose the model may have appended.
    const remainder = s.slice(end + 1).split('\n')[0];
    const modMatch = /^(\s+(?:TITLE|LINK_X|LINK_Y|LINK_XY|LINK_SCROLL|ZOOM|ZOOM_X|BRUSH|PALETTE|WIDTH|HEIGHT|LEGEND|AXIS_X|AXIS_Y|LET|DATASET|TOOLTIP|ON\s+HOVER|DISABLED|NAME)\b.*)/i.exec(remainder);
    s = s.slice(0, end + 1) + (modMatch ? modMatch[1] : '');

    return s.trim() || 'TABLE()';
}

const SEQ2SEQ_EXTRACT = (s: string) => cleanPlotConfig(s);

const INSTRUCT_INPUT = (systemPrompt: string) => (sql: string, columns: string[] | TypedColumn[]) => {
    const colsStr = (columns as any[]).map(c => typeof c === 'string' ? c : c.name).join(', ');
    return `<|system|>\n${systemPrompt}\n<|user|>\nsql: ${sql}\ncolumns: ${colsStr}\n<|assistant|>`;
};

const QWEN_INPUT = (sql: string, columns: string[] | TypedColumn[]) => {
    const colsStr = (columns as any[]).map(c => typeof c === 'string' ? c : c.name).join(', ');
    return `<|im_start|>system\nYou are a plot config generator. Output ONLY the plot config string, nothing else.<|im_end|>\n<|im_start|>user\nsql: ${sql}\ncolumns: ${colsStr}<|im_end|>\n<|im_start|>assistant\n`;
};

// Causal LM models often emit the plot config on the first content line but may
// prefix it with prose ("Here is the config:"), wrap it in quotes, or append a
// special token. Run the full decoded text through the cleaner — it already
// finds the plot config inside surrounding prose / fences / quotes.
const FIRST_LINE = (s: string) => cleanPlotConfig(s);

export const CANDIDATES: Record<string, CandidateModel> = {
    /**
     * In-tree fine-tuned T5-small for plot-config generation. The artifact lives at
     * `services/ml/models/plot-suggester/` and is produced by the reproducible
     * pipeline in `scripts/training/` (generatePlotDataset.ts → python/train.py →
     * evalPlotModel.ts). When `eval.json` shows ≥95% plot-family accuracy AND
     * ≥85% column-match accuracy, `plotModelLoader` promotes it to default.
     * The `repo` value is a local path that Transformers.js resolves as a
     * filesystem artifact via the local-only resolution path.
     */
    'plot-suggester-local': {
        id: 'plot-suggester-local',
        label: 'T5-small plot-suggester v3 (in-tree, ~77MB) — signals header + typed columns',
        repo: './services/ml/models/plot-suggester-v2',
        kind: 'seq2seq',
        dtype: 'fp32',
        approxSizeMb: 77,
        buildInput: SEQ2SEQ_INPUT_V3,
        extractOutput: SEQ2SEQ_EXTRACT,
        inputFormat: 'v3',
    },
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
        inputFormat: 'v1',
    },
    /**
     * V2 entry: same model architecture, retrained on plot_pairs_v12.jsonl with the
     * enriched input format (typed columns + schema preamble). Stays unselected
     * until the v2 artifact is exported and `plotModelLoader` promotes it.
     */
    't5-small-finetuned-v2': {
        id: 't5-small-finetuned-v2',
        label: 'T5-small fine-tuned v2 (60M, seq2seq, ~77MB) — typed columns + schema',
        repo: './services/ml/models/plot-suggester-v2',
        kind: 'seq2seq',
        dtype: 'q8',
        approxSizeMb: 77,
        buildInput: SEQ2SEQ_INPUT_V2,
        extractOutput: SEQ2SEQ_EXTRACT,
        inputFormat: 'v2',
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
