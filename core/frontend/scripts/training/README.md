# Local ML Training

Pipeline for training two local models that power JFR Query:

1. **Autocomplete ranker** — reranks SQL completion candidates produced by the partial DuckDB parser.
2. **Prompt suggester** — retrieval index that picks likely follow-up prompts for the AI completion row.

Generation uses the Anthropic Haiku (`claude-haiku-4-5-20251001`) model to synthesise the training corpus. The Haiku calls are paid; the local training step is free.

## Environment

```bash
export ANTHROPIC_API_KEY=sk-ant-...           # required for generate-* steps
export AUTOCOMPLETE_TARGET=5000               # optional; default 5000
export PROMPT_TARGET=3000                     # optional; default 3000
```

Run from the repo root (the scripts resolve paths relative to `process.cwd()`).

## Pipeline

```bash
# 1. Generate autocomplete corpus (~5000 rows, streamed to data/autocomplete-train.jsonl)
npx tsx core/frontend/scripts/training/generateAutocompleteData.ts

# 2. Generate prompt-suggestion corpus (~3000 rows)
npx tsx core/frontend/scripts/training/generatePromptSuggestions.ts

# 3. Train the autocomplete ranker (grid-search weights, writes JSON)
npx tsx core/frontend/scripts/training/trainAutocompleteRanker.ts

# 4. Build the retrieval index for prompt suggestions
npx tsx core/frontend/scripts/training/trainPromptSuggester.ts
```

Each generation script appends to its JSONL file and resumes from existing rows; safe to Ctrl-C and re-run.

## Cost estimate

Haiku 4.5 pricing (Jun 2026): roughly $1 / 1M input tokens, $5 / 1M output tokens.

* Autocomplete: ~5000 examples / 25 per batch = 200 calls. Each call ≈ 500 input + 1500 output tokens → 0.1M input + 0.3M output total → **~$1.60**.
* Prompt suggestions: ~3000 / 20 per batch = 150 calls × (500 in + 1500 out) → 0.075M in + 0.225M out → **~$1.20**.

Budget ~**$3** end-to-end. Real numbers vary with retries and response length.

## Output artifacts

| File | Size | Purpose |
|------|------|---------|
| `data/autocomplete-train.jsonl` | ~3 MB | Raw autocomplete examples (gitignored) |
| `data/prompt-suggestions.jsonl` | ~2 MB | Raw prompt examples (gitignored) |
| `core/frontend/services/ml/autocompleteRanker.json` | ~1 KB | Learned linear weights |
| `core/frontend/services/ml/promptSuggestions.bin` | ~4 MB | Float32 embedding matrix (3000 × 384) |
| `core/frontend/services/ml/promptSuggestions.json` | ~0.5 MB | Prompt metadata aligned with matrix rows |

## Runtime loading

Both artifacts load lazily behind the `VITE_USE_LOCAL_ML` env flag (default `false`). When the flag is off, the loaders return identity / empty results so the UI keeps working even if artifacts are missing.

* `core/frontend/services/ml/AutocompleteRanker.ts` — `rank(context, cursorPos, candidates, scenario)`.
* `core/frontend/services/ml/PromptSuggester.ts` — `suggest(context, k = 3)`.

Enable locally with:

```bash
VITE_USE_LOCAL_ML=true npm run dev
```

## Dependencies

The generators require `@anthropic-ai/sdk` (not currently in `package.json`):

```bash
npm install --save @anthropic-ai/sdk
npm install --save-dev tsx
```

`@huggingface/transformers` is already a runtime dependency.

---

## Plot-suggester pipeline (C6)

Reproducible in-tree fine-tune of `t5-small` for plot-config generation.
Replaces the externally-trained `t5-small-finetuned` HF artifact with an
artifact that lives at `services/ml/models/plot-suggester/` and is loaded
by `services/ml/plotModelLoader.ts`.

### Files

| Step | File | Tooling |
|------|------|---------|
| 1. Dataset | `scripts/training/generatePlotDataset.ts` | tsx + Claude Haiku via AiService |
| 2. Train   | `scripts/training/python/train.py`        | Python + HF Transformers (GPU) |
| 3. Eval    | `scripts/training/evalPlotModel.ts`       | tsx + Transformers.js (CPU/WASM) |

### Step 1 — Generate the dataset

```bash
# 5000 examples, ~$2 in Haiku tokens, ~10 minutes wall-clock.
ANTHROPIC_API_KEY=sk-ant-... npm run dataset:plot -- --target 5000

# Or use a custom output path / concurrency:
npm run dataset:plot -- --target 5000 --concurrency 8 --out data/plot-dataset.jsonl

# Dry-run to inspect the prompt template, no API calls:
npm run dataset:plot -- --dry-run

# All options:
npm run dataset:plot -- --help
```

API keys are read via `AiService.getEffectiveApiKey` — never inlined in the
script. The script appends to its JSONL and resumes safely; Ctrl-C and re-run
to top up.

### Step 2 — Train (requires GPU)

Run on a CUDA-capable machine. CPU works but is impractically slow.

```bash
# One-time deps (in a venv):
pip install "torch>=2.3" "transformers>=4.42" "datasets>=2.20" \
            "accelerate>=0.30" sentencepiece \
            "optimum[onnxruntime]>=1.20" onnx "onnxruntime>=1.17"

# Default config — t5-small, 6 epochs, batch 16, ONNX export:
npm run train:plot -- \
  --dataset data/plot-dataset.jsonl \
  --output-dir services/ml/models/plot-suggester

# Inspect resolved config without loading torch:
npm run train:plot -- --dry-run

# All options:
npm run train:plot -- --help
```

The Python script writes the ONNX-exported model + tokenizer files to
`services/ml/models/plot-suggester/`. A `provenance.json` records the base
model, epoch count, dataset size, and final training metrics.

### Step 3 — Evaluate (no GPU required)

```bash
npm run eval:plot -- --dataset data/plot-dataset.jsonl --split 0.1
npm run eval:plot -- --help
```

Writes `services/ml/models/plot-suggester/eval.json`:

```json
{
  "accuracy": 0.91,
  "plotShapeAccuracy": 0.96,
  "columnMatchAccuracy": 0.88,
  "sampledAt": "2026-06-25T10:00:00.000Z",
  "sampleSize": 500
}
```

### Promotion gate

`plotModelLoader.getActivePlotModel()` reads `eval.json` and promotes the
in-tree artifact to the default plot-suggestion model when BOTH:

- `plotShapeAccuracy ≥ 0.95`  (plot family — LINE_CHART / BAR_CHART / …)
- `columnMatchAccuracy ≥ 0.85`

Below threshold the loader keeps the cloud `tiny` model as the default;
the in-tree artifact remains available but is not auto-selected.

### Wiring

- `services/ml/PlotGenerationService.ts` calls `initPlotModel()` on first
  use, which delegates to `plotModelLoader.getActivePlotModel()`.
- `services/ml/candidates.ts` exposes the in-tree artifact as the
  `plot-suggester-local` candidate; `repo` points to the local directory.
- When the artifact is missing, `plotModelLoader` falls back to the HF Hub
  via the existing `t5-small-finetuned` candidate (or `flan-t5-small` if
  even that is unavailable).

