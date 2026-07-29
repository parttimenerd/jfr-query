#!/usr/bin/env bash
# One-stop retraining script for the plot-config T5-small LoRA model,
# the SQL+plot DSL autocomplete T5-small model, and the view-embedding index.
#
# Run this whenever:
#   - Training data changes (plot config model)
#   - Views are added/removed in ViewCollection.java (embedding index)
#   - The model needs to be updated
#
# Usage:
#   ./scripts/train/run_training.sh                        # train both models + export + embeddings (default)
#   ./scripts/train/run_training.sh --data-only            # only regenerate data
#   ./scripts/train/run_training.sh --skip-data            # skip data gen, retrain only
#   ./scripts/train/run_training.sh --skip-export          # train but don't export ONNX
#   ./scripts/train/run_training.sh --embeddings-only      # only regenerate view embeddings
#   ./scripts/train/run_training.sh --skip-embeddings      # skip view embedding regeneration
#   ./scripts/train/run_training.sh --force-embeddings     # force regenerate embeddings even if up-to-date
#   ./scripts/train/run_training.sh --autocomplete-only    # only train the SQL autocomplete model
#   ./scripts/train/run_training.sh --skip-autocomplete    # skip autocomplete model training
#
# After running:
#   1. Upload onnx/t5-small-q8-arm/ to HuggingFace Hub
#   2. Upload onnx/t5-small-ac-q8-arm/ to HuggingFace Hub  (autocomplete model)
#   3. Update candidates.ts with the new model repos if needed
#   4. Run the bench harness: npm run bench (in core/frontend)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

DO_DATA=true
DO_TRAIN=true
DO_EXPORT=true
DO_EMBEDDINGS=true
DO_AUTOCOMPLETE=true
FORCE_EMBEDDINGS=false

for arg in "$@"; do
  case "$arg" in
    --data-only)          DO_TRAIN=false; DO_EXPORT=false; DO_EMBEDDINGS=false; DO_AUTOCOMPLETE=false ;;
    --skip-data)          DO_DATA=false ;;
    --skip-export)        DO_EXPORT=false ;;
    --embeddings-only)    DO_DATA=false; DO_TRAIN=false; DO_EXPORT=false; DO_AUTOCOMPLETE=false ;;
    --skip-embeddings)    DO_EMBEDDINGS=false ;;
    --force-embeddings)   FORCE_EMBEDDINGS=true ;;
    --autocomplete-only)  DO_TRAIN=false; DO_EXPORT=false; DO_EMBEDDINGS=false ;;
    --skip-autocomplete)  DO_AUTOCOMPLETE=false ;;
    --help|-h)
      head -35 "$0" | tail -32
      exit 0
      ;;
  esac
done

DATA="data/plot_pairs_v14.jsonl"
EVAL="data/plot_eval_v14.jsonl"
CHECKPOINT_DIR="checkpoints/t5-small-latest"
ONNX_OUT="onnx/t5-small-q8-arm"

# ─── Step 1: Data generation ──────────────────────────────────────────────────
if $DO_DATA; then
  echo "=== Generating training data ==="
  # gen_plot_pairs.py produces the Haiku-based examples (requires ANTHROPIC_API_KEY).
  # For quick retraining without new data, use --skip-data.
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    python3 scripts/train/gen_plot_pairs.py \
      --out data/plot_pairs_new.jsonl \
      --count 2000
    echo "New data written to data/plot_pairs_new.jsonl"
    echo "To use it: merge with the existing v10 data and re-run with --skip-data"
  else
    echo "ANTHROPIC_API_KEY not set — skipping Haiku data generation."
    echo "Using existing training data: $DATA"
  fi

  N_TRAIN=$(wc -l < "$DATA")
  N_EVAL=$(wc -l < "$EVAL" 2>/dev/null || echo 0)
  echo "Training data: $N_TRAIN pairs | Eval: $N_EVAL pairs"
fi

if ! $DO_TRAIN; then
  echo "Skipping training (--data-only)."
  # Still run embeddings if requested.
  if $DO_EMBEDDINGS; then
    echo
    echo "=== Regenerating view embedding index ==="
    if $FORCE_EMBEDDINGS; then
      python3 scripts/train/gen_view_embeddings.py --force
    else
      python3 scripts/train/gen_view_embeddings.py
    fi
    echo "View embeddings updated: core/frontend/data/viewEmbeddings.json"
  fi
  exit 0
fi

if [ ! -f "$DATA" ]; then
  echo "ERROR: $DATA not found. Run with no flags to generate it first."
  exit 1
fi

# ─── Step 2: Train ────────────────────────────────────────────────────────────
echo
echo "=== Training T5-small LoRA (plot config generation) ==="
echo "Output: $CHECKPOINT_DIR"
echo "Epochs: 15  Batch: 16  LR: 3e-4  LoRA-r: 16"
python3 scripts/train/train.py \
  --model google-t5/t5-small \
  --out "$CHECKPOINT_DIR" \
  --data "$DATA" \
  --eval "$EVAL" \
  --epochs 15 \
  --batch 16 \
  --lr 3e-4 \
  --lora-r 16

echo
echo "=== Evaluating best checkpoint ==="
python3 scripts/train/eval.py \
  --checkpoint "$CHECKPOINT_DIR" \
  --eval "$EVAL" \
  || echo "(eval.py failed — check checkpoint manually)"

if ! $DO_EXPORT; then
  echo "Skipping ONNX export (--skip-export)."
  # Still run embeddings if requested.
  if $DO_EMBEDDINGS; then
    echo
    echo "=== Regenerating view embedding index ==="
    if $FORCE_EMBEDDINGS; then
      python3 scripts/train/gen_view_embeddings.py --force
    else
      python3 scripts/train/gen_view_embeddings.py
    fi
    echo "View embeddings updated: core/frontend/data/viewEmbeddings.json"
  fi
  exit 0
fi

# ─── Step 3: Export ───────────────────────────────────────────────────────────
echo
echo "=== Exporting to ONNX + ARM64 INT8 ==="
bash scripts/train/export.sh "$CHECKPOINT_DIR" "$ONNX_OUT"

echo
echo "=== Done! ==="
echo "ONNX model: $ONNX_OUT/"
ls -lh "$ONNX_OUT/"*.onnx 2>/dev/null || true
echo
echo "Next steps:"
echo "  1. Verify: python3 scripts/train/eval.py --onnx $ONNX_OUT --eval $EVAL"
echo "  2. Upload: huggingface-cli upload <your-org>/jfr-plot-config-t5-small $ONNX_OUT"
echo "  3. Update candidates.ts with the new model repo ID if needed"
echo "  4. Re-run bench: (cd core/frontend && npm run bench)"

# ─── Step 5: Train SQL+plot DSL autocomplete model ─────────────────────────────
AC_DATA="data/sql_ac_train.jsonl"
AC_EVAL="data/sql_ac_eval.jsonl"
AC_CHECKPOINT="checkpoints/t5-small-autocomplete"
AC_ONNX_OUT="onnx/t5-small-ac-q8-arm"

if $DO_AUTOCOMPLETE; then
  echo
  echo "=== Generating SQL autocomplete training data ==="
  python3 scripts/train/gen_sql_autocomplete_pairs.py \
    --output "$AC_DATA" \
    --eval   "$AC_EVAL" \
    --n-train 5000 \
    --n-eval 500
  echo "Autocomplete training data: $AC_DATA"

  echo
  echo "=== Training T5-small autocomplete model ==="
  python3 scripts/train/train_autocomplete.py \
    --model google-t5/t5-small \
    --out "$AC_CHECKPOINT" \
    --data "$AC_DATA" \
    --eval "$AC_EVAL" \
    --epochs 10 \
    --batch 32 \
    --lr 3e-4 \
    --lora-r 16

  if $DO_EXPORT; then
    echo
    echo "=== Exporting autocomplete model to ONNX + ARM64 INT8 ==="
    bash scripts/train/export.sh "$AC_CHECKPOINT" "$AC_ONNX_OUT"
    echo
    echo "Autocomplete ONNX: $AC_ONNX_OUT/"
    ls -lh "$AC_ONNX_OUT/"*.onnx 2>/dev/null || true
    echo "Upload: huggingface-cli upload <your-org>/jfr-sql-autocomplete-t5-small $AC_ONNX_OUT"
    echo "Then update candidates.ts 't5-small-autocomplete' repo field"
  fi
fi

# ─── Step 4: Regenerate view embeddings ───────────────────────────────────────
if $DO_EMBEDDINGS; then
  echo
  echo "=== Regenerating view embedding index ==="
  if $FORCE_EMBEDDINGS; then
    python3 scripts/train/gen_view_embeddings.py --force
  else
    python3 scripts/train/gen_view_embeddings.py
  fi
  echo "View embeddings updated: core/frontend/data/viewEmbeddings.json"
fi
