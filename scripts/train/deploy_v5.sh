#!/usr/bin/env bash
# Deploy a trained v5 model after training completes:
#   1. Export ONNX
#   2. Run eval on v25 eval set
#   3. Check promotion gate
#   4. Copy to in-tree artifact directory if promoted
#   5. Update eval.json with new metrics
#
# Usage:
#   ./scripts/train/deploy_v5.sh                    # use checkpoints/t5-small-latest
#   ./scripts/train/deploy_v5.sh checkpoints/my-run  # use specific checkpoint
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

CHECKPOINT="${1:-checkpoints/t5-small-latest}"
ONNX_OUT="onnx/t5-small-q8-arm"
EVAL_DATA="${EVAL_DATA:-data/plot_eval_v31.jsonl}"
IN_TREE_DIR="core/frontend/services/ml/models/plot-suggester-v2"

PLOT_SHAPE_THRESHOLD=0.75
COL_MATCH_THRESHOLD=0.70

echo "=== Deploy v5 plot-suggester ==="
echo "Checkpoint: ${CHECKPOINT}"
echo "ONNX out:   ${ONNX_OUT}"
echo "Eval data:  ${EVAL_DATA}"
echo

# ─── Step 1: Export ONNX ─────────────────────────────────────────────────────
echo "--- Exporting ONNX ---"
bash scripts/train/export.sh "${CHECKPOINT}" "${ONNX_OUT}"
echo "ONNX exported to ${ONNX_OUT}"
ls -lh "${ONNX_OUT}"/*.onnx 2>/dev/null || true

# ─── Step 2: Evaluate on v25 eval set ────────────────────────────────────────
echo
echo "--- Evaluating on ${EVAL_DATA} ---"
EVAL_OUT="/tmp/eval_v5_results.json"
python3 scripts/train/eval.py \
  --onnx "${ONNX_OUT}" \
  --eval "${EVAL_DATA}" \
  | tee /tmp/eval_v5.log

# Parse eval results from log
PLOT_SHAPE=$(grep "plotShapeAccuracy:" /tmp/eval_v5.log | tail -1 | awk '{print $NF}')
COL_MATCH=$(grep "columnMatchAccuracy:" /tmp/eval_v5.log | tail -1 | awk '{print $NF}')

echo
echo "=== Evaluation Results ==="
echo "  plotShapeAccuracy:   ${PLOT_SHAPE}"
echo "  columnMatchAccuracy: ${COL_MATCH}"
echo "  Thresholds:          ${PLOT_SHAPE_THRESHOLD} / ${COL_MATCH_THRESHOLD}"

# ─── Step 3: Check promotion gate ────────────────────────────────────────────
PROMOTED=false
if python3 -c "
import sys
ps, cm = float('${PLOT_SHAPE}'), float('${COL_MATCH}')
thresh_ps, thresh_cm = ${PLOT_SHAPE_THRESHOLD}, ${COL_MATCH_THRESHOLD}
if ps >= thresh_ps and cm >= thresh_cm:
    print('PROMOTED')
    sys.exit(0)
else:
    print(f'NOT PROMOTED (ps={ps:.4f}<{thresh_ps} or cm={cm:.4f}<{thresh_cm})')
    sys.exit(1)
" 2>&1; then
    PROMOTED=true
    echo
    echo "✓ PROMOTED: model meets both accuracy thresholds"
else
    echo
    echo "✗ NOT PROMOTED: below thresholds — manual override needed to deploy"
    echo "  To force deploy anyway, rerun with FORCE_DEPLOY=1"
fi

if [ "${PROMOTED}" = "false" ] && [ "${FORCE_DEPLOY:-0}" != "1" ]; then
    echo "Stopping. Use FORCE_DEPLOY=1 to override."
    exit 1
fi

# ─── Step 4: Copy to in-tree artifact ────────────────────────────────────────
echo
echo "--- Copying to ${IN_TREE_DIR} ---"
cp "${ONNX_OUT}"/*.onnx "${IN_TREE_DIR}/"
cp "${ONNX_OUT}"/tokenizer* "${IN_TREE_DIR}/" 2>/dev/null || true
cp "${ONNX_OUT}"/config* "${IN_TREE_DIR}/" 2>/dev/null || true
cp "${ONNX_OUT}"/special_tokens* "${IN_TREE_DIR}/" 2>/dev/null || true
cp "${ONNX_OUT}"/generation_config* "${IN_TREE_DIR}/" 2>/dev/null || true

# ─── Step 5: Update eval.json ────────────────────────────────────────────────
python3 - <<PYEOF
import json
from pathlib import Path

p = Path("${IN_TREE_DIR}/eval.json")
existing = json.loads(p.read_text()) if p.exists() else {}
existing.update({
    "plotShapeAccuracy": float("${PLOT_SHAPE}"),
    "columnMatchAccuracy": float("${COL_MATCH}"),
    "trainedOn": "${EVAL_DATA/eval/pairs}",
    "evalOn": "${EVAL_DATA}",
    "checkpoint": "${CHECKPOINT}",
})
p.write_text(json.dumps(existing, indent=2) + "\n")
print(f"Updated {p}")
PYEOF

# ─── Step 6: Run completion scenario test ────────────────────────────────────
echo
echo "--- Running completion scenario tests ---"
python3 scripts/train/test_completion_scenarios.py \
  --onnx "${ONNX_OUT}" \
  --json-out /tmp/completion_scenarios_v5.json \
  || echo "(scenario tests failed — check /tmp/completion_scenarios_v5.json)"

echo
echo "=== Deployment complete ==="
echo "  Model:    ${IN_TREE_DIR}/"
echo "  eval.json: plotShapeAccuracy=${PLOT_SHAPE}, columnMatchAccuracy=${COL_MATCH}"
echo
echo "Next steps:"
echo "  1. Review /tmp/completion_scenarios_v5.json for scenario breakdown"
echo "  2. Upload to HuggingFace: huggingface-cli upload <org>/jfr-plot-config-t5-small ${ONNX_OUT}"
echo "  3. Run bench: (cd core/frontend && npm run bench)"
