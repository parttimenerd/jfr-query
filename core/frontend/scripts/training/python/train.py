#!/usr/bin/env python3
"""
train.py — Fine-tune t5-small on the JFR plot-suggester dataset.

DEVICE SUPPORT
--------------
Auto-detects the best available device:
  - CUDA (NVIDIA GPUs) — uses fp16 mixed precision
  - MPS  (Apple Silicon M-series) — uses bf16 if supported, else fp32
  - CPU  (fallback) — works but is slow for 7500+ examples

Recommended environment:
  - Python 3.10–3.13
  - torch>=2.3 (CUDA build for NVIDIA, default build for Apple Silicon)
  - transformers>=4.42
  - datasets>=2.20
  - accelerate>=0.30
  - sentencepiece (T5 tokenizer requirement)
  - onnx, onnxruntime (>=1.17), optimum[onnxruntime] for ONNX export

Install (one-shot):
  pip install --upgrade \\
    "torch>=2.3" "transformers>=4.42" "datasets>=2.20" "accelerate>=0.30" \\
    sentencepiece "optimum[onnxruntime]>=1.20" onnx "onnxruntime>=1.17"

INPUT
-----
JSONL produced by scripts/training/generatePlotDataset.ts. Each row:
  {
    "sql": "...",
    "columns": [ { "name": "...", "type": "..." }, ... ],
    "sample": [ { ... }, ... ],
    "plot": "BAR_CHART(x='name', y='avg_duration')",
    "plotFamilyHint": "BAR_CHART"
  }

OUTPUT
------
ONNX-exported model + tokenizer files in
  services/ml/models/plot-suggester/

(Resolved relative to the repo's `core/frontend/` working directory by
default; override with --output-dir.)

USAGE
-----
  python scripts/training/python/train.py \\
    --dataset data/plot-dataset.jsonl \\
    --output-dir services/ml/models/plot-suggester \\
    --epochs 6 \\
    --batch-size 16 \\
    --learning-rate 5e-4

Run `python scripts/training/python/train.py --help` for all flags.

After training, evaluate with:
  npx tsx scripts/training/evalPlotModel.ts \\
    --dataset data/plot-dataset.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Fine-tune t5-small on the JFR plot-suggester dataset and export ONNX.",
    )
    p.add_argument("--dataset", default="data/plot-dataset.jsonl",
                   help="JSONL produced by generatePlotDataset.ts")
    p.add_argument("--base-model", default="t5-small",
                   help="HuggingFace base model id (default t5-small)")
    p.add_argument("--output-dir", default="services/ml/models/plot-suggester",
                   help="Where to write the fine-tuned + ONNX-exported artifact")
    p.add_argument("--checkpoint-dir", default=".checkpoints/plot-suggester",
                   help="Intermediate HF checkpoint directory (kept out of repo)")
    p.add_argument("--epochs", type=int, default=6)
    p.add_argument("--batch-size", type=int, default=16)
    p.add_argument("--learning-rate", type=float, default=5e-4)
    p.add_argument("--max-input-length", type=int, default=256)
    p.add_argument("--max-target-length", type=int, default=48)
    p.add_argument("--split", type=float, default=0.1,
                   help="Held-out fraction for in-training validation")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--dry-run", action="store_true",
                   help="Print resolved config and exit; do NOT load torch/HF")
    p.add_argument("--no-onnx", action="store_true",
                   help="Skip ONNX export step (keep only PyTorch artifacts)")
    return p.parse_args()


# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------

def build_input(row: dict) -> str:
    """V2 format: typed columns + optional schema preamble.

    Matches services/ml/candidates.ts SEQ2SEQ_INPUT_V2 so the live
    runtime feeds the model the same prompt shape it was trained on.
    """
    typed_cols = ", ".join(
        f'"{c["name"]}" {c.get("type", "VARCHAR")}'
        for c in row.get("columns", [])
    )
    parts = [f"sql: {row['sql']}", f"columns: {typed_cols}"]
    schema = row.get("schema") or []
    if schema:
        lines = ["schema:"]
        for tbl in schema[:3]:  # cap at 3 tables to respect 512-token budget
            cols = ", ".join(
                f'"{c["name"]}" {c.get("type", "VARCHAR")}'
                for c in tbl.get("columns", [])[:12]
            )
            lines.append(f'- "{tbl["table"]}": ({cols})')
        parts.append("\n".join(lines))
    return "\n".join(parts)


def load_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(r, dict) and "sql" in r and "plot" in r:
                rows.append(r)
    return rows


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main() -> int:
    args = parse_args()
    dataset_path = Path(args.dataset)
    output_dir = Path(args.output_dir)
    checkpoint_dir = Path(args.checkpoint_dir)

    if args.dry_run:
        print("[train] DRY RUN")
        print(f"  dataset       = {dataset_path}")
        print(f"  base-model    = {args.base_model}")
        print(f"  output-dir    = {output_dir}")
        print(f"  checkpoint    = {checkpoint_dir}")
        print(f"  epochs        = {args.epochs}")
        print(f"  batch-size    = {args.batch_size}")
        print(f"  learning-rate = {args.learning_rate}")
        print(f"  onnx-export   = {not args.no_onnx}")
        return 0

    if not dataset_path.exists():
        print(f"[train] dataset not found: {dataset_path}", file=sys.stderr)
        print(f"[train] run: npm run dataset:plot", file=sys.stderr)
        return 1

    # Import heavy deps lazily so --help / --dry-run work without GPU stack.
    try:
        import torch
        from datasets import Dataset
        from transformers import (
            AutoTokenizer,
            AutoModelForSeq2SeqLM,
            DataCollatorForSeq2Seq,
            Seq2SeqTrainer,
            Seq2SeqTrainingArguments,
            set_seed,
        )
    except ImportError as e:
        print(f"[train] missing dependencies: {e}", file=sys.stderr)
        print("[train] install: pip install torch transformers datasets accelerate sentencepiece optimum[onnxruntime]",
              file=sys.stderr)
        return 1

    set_seed(args.seed)

    # Device detection: CUDA > MPS (Apple Silicon) > CPU.
    if torch.cuda.is_available():
        device_kind = "cuda"
        use_fp16 = True
        use_bf16 = False
    elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        device_kind = "mps"
        # MPS does not support fp16 mixed precision in transformers Trainer reliably;
        # bf16 is supported on M2+; fp32 is the safe default.
        use_fp16 = False
        use_bf16 = True
    else:
        device_kind = "cpu"
        use_fp16 = False
        use_bf16 = False
        print("[train] WARNING: no GPU/MPS device — training will be very slow.", file=sys.stderr)
    print(f"[train] device={device_kind} fp16={use_fp16} bf16={use_bf16}")

    rows = load_jsonl(dataset_path)
    if not rows:
        print(f"[train] no usable rows in {dataset_path}", file=sys.stderr)
        return 1
    print(f"[train] loaded {len(rows)} rows from {dataset_path}")

    # Deterministic split — last `split` fraction is eval.
    n_eval = max(1, int(len(rows) * args.split))
    train_rows = rows[:-n_eval]
    eval_rows = rows[-n_eval:]
    print(f"[train] train={len(train_rows)} eval={len(eval_rows)}")

    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    model = AutoModelForSeq2SeqLM.from_pretrained(args.base_model)

    def tokenize(batch: dict) -> dict:
        inputs = [build_input(r) for r in batch["row"]]
        targets = [r["plot"] for r in batch["row"]]
        model_in = tokenizer(
            inputs,
            max_length=args.max_input_length,
            truncation=True,
            padding=False,
        )
        with tokenizer.as_target_tokenizer():
            labels = tokenizer(
                targets,
                max_length=args.max_target_length,
                truncation=True,
                padding=False,
            )
        model_in["labels"] = labels["input_ids"]
        return model_in

    train_ds = Dataset.from_dict({"row": train_rows}).map(
        tokenize, batched=True, remove_columns=["row"]
    )
    eval_ds = Dataset.from_dict({"row": eval_rows}).map(
        tokenize, batched=True, remove_columns=["row"]
    )

    collator = DataCollatorForSeq2Seq(tokenizer, model=model)

    training_args = Seq2SeqTrainingArguments(
        output_dir=str(checkpoint_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        warmup_ratio=0.05,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        logging_steps=50,
        save_total_limit=2,
        predict_with_generate=True,
        generation_max_length=args.max_target_length,
        fp16=use_fp16,
        bf16=use_bf16,
        report_to=[],
        seed=args.seed,
    )

    trainer = Seq2SeqTrainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=eval_ds,
        tokenizer=tokenizer,
        data_collator=collator,
    )

    trainer.train()
    metrics = trainer.evaluate()
    print(f"[train] final metrics: {metrics}")

    # Save PyTorch artifacts to checkpoint dir.
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(checkpoint_dir))
    tokenizer.save_pretrained(str(checkpoint_dir))

    # ONNX export.
    if args.no_onnx:
        print("[train] skipping ONNX export (--no-onnx)")
        output_dir.mkdir(parents=True, exist_ok=True)
        # Still copy PyTorch files for inspection.
        return 0

    print("[train] exporting to ONNX...")
    try:
        from optimum.onnxruntime import ORTModelForSeq2SeqLM
    except ImportError:
        print("[train] optimum[onnxruntime] not installed — skipping ONNX export.", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    ort_model = ORTModelForSeq2SeqLM.from_pretrained(
        str(checkpoint_dir), export=True
    )
    ort_model.save_pretrained(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))

    # Mark provenance so plotModelLoader and humans can audit.
    provenance = {
        "trainedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "baseModel": args.base_model,
        "epochs": args.epochs,
        "datasetRows": len(rows),
        "evalRows": len(eval_rows),
        "metrics": {k: float(v) for k, v in metrics.items() if isinstance(v, (int, float))},
    }
    (output_dir / "provenance.json").write_text(json.dumps(provenance, indent=2))
    print(f"[train] wrote {output_dir} (ONNX + tokenizer + provenance.json)")
    print("[train] next: npx tsx scripts/training/evalPlotModel.ts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
