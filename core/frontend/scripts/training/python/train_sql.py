#!/usr/bin/env python3
"""
train_sql.py — Fine-tune t5-small on the SQL completion dataset.

Mirrors train.py (the plot-suggester trainer) but for the SQL completion
dataset produced by scripts/training/generateSqlDataset.ts.

INPUT
-----
JSONL produced by generateSqlDataset.ts. Each row:
  {
    "prefix":  "SELECT date_trunc('hour', \"ts\") AS h, count(*) FROM events GROUP BY ",
    "target":  "h ORDER BY h",
    "schema":  [ { "table": "events", "columns": [...] }, ... ],
    "tier":    "select" | "from" | "where" | ...
  }

OUTPUT
------
ONNX-exported model + tokenizer in
  services/ml/models/sql-suggester/

USAGE
-----
  python scripts/training/python/train_sql.py \\
    --dataset data/sql_pairs_v1.jsonl \\
    --output-dir services/ml/models/sql-suggester \\
    --epochs 6 \\
    --batch-size 16 \\
    --learning-rate 5e-4
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Fine-tune t5-small on the SQL completion dataset and export ONNX.",
    )
    p.add_argument("--dataset", default="data/sql_pairs_v1.jsonl")
    p.add_argument("--base-model", default="t5-small")
    p.add_argument("--output-dir", default="services/ml/models/sql-suggester")
    p.add_argument("--checkpoint-dir", default=".checkpoints/sql-suggester")
    p.add_argument("--epochs", type=int, default=6)
    p.add_argument("--batch-size", type=int, default=16)
    p.add_argument("--learning-rate", type=float, default=5e-4)
    p.add_argument("--max-input-length", type=int, default=512)
    p.add_argument("--max-target-length", type=int, default=64)
    p.add_argument("--split", type=float, default=0.1)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--no-onnx", action="store_true")
    return p.parse_args()


def build_input(row: dict) -> str:
    """Format: schema preamble + prefix. The model emits the continuation."""
    parts: list[str] = []
    schema = row.get("schema") or []
    if schema:
        lines = ["schema:"]
        for tbl in schema[:3]:
            cols = ", ".join(
                f'"{c["name"]}" {c.get("type", "VARCHAR")}'
                for c in tbl.get("columns", [])[:12]
            )
            lines.append(f'- "{tbl["table"]}": ({cols})')
        parts.append("\n".join(lines))
    parts.append(f"prefix: {row['prefix']}")
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
            if isinstance(r, dict) and "prefix" in r and "target" in r:
                rows.append(r)
    return rows


def main() -> int:
    args = parse_args()
    dataset_path = Path(args.dataset)
    output_dir = Path(args.output_dir)
    checkpoint_dir = Path(args.checkpoint_dir)

    if args.dry_run:
        print("[train-sql] DRY RUN")
        print(f"  dataset       = {dataset_path}")
        print(f"  base-model    = {args.base_model}")
        print(f"  output-dir    = {output_dir}")
        print(f"  epochs        = {args.epochs}")
        print(f"  batch-size    = {args.batch_size}")
        print(f"  max-input     = {args.max_input_length}")
        print(f"  max-target    = {args.max_target_length}")
        print(f"  onnx-export   = {not args.no_onnx}")
        return 0

    if not dataset_path.exists():
        print(f"[train-sql] dataset not found: {dataset_path}", file=sys.stderr)
        print(f"[train-sql] run: ANTHROPIC_API_KEY=... npx tsx scripts/training/generateSqlDataset.ts", file=sys.stderr)
        return 1

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
        print(f"[train-sql] missing dependencies: {e}", file=sys.stderr)
        print("[train-sql] install: pip install torch transformers datasets accelerate sentencepiece optimum[onnxruntime]",
              file=sys.stderr)
        return 1

    set_seed(args.seed)

    if torch.cuda.is_available():
        device_kind, use_fp16, use_bf16 = "cuda", True, False
    elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        device_kind, use_fp16, use_bf16 = "mps", False, True
    else:
        device_kind, use_fp16, use_bf16 = "cpu", False, False
        print("[train-sql] WARNING: no GPU/MPS — training will be slow.", file=sys.stderr)
    print(f"[train-sql] device={device_kind} fp16={use_fp16} bf16={use_bf16}")

    rows = load_jsonl(dataset_path)
    if not rows:
        print(f"[train-sql] no usable rows in {dataset_path}", file=sys.stderr)
        return 1
    print(f"[train-sql] loaded {len(rows)} rows")

    n_eval = max(1, int(len(rows) * args.split))
    train_rows = rows[:-n_eval]
    eval_rows = rows[-n_eval:]
    print(f"[train-sql] train={len(train_rows)} eval={len(eval_rows)}")

    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    model = AutoModelForSeq2SeqLM.from_pretrained(args.base_model)

    def tokenize(batch: dict) -> dict:
        inputs = [build_input(r) for r in batch["row"]]
        targets = [r["target"] for r in batch["row"]]
        model_in = tokenizer(inputs, max_length=args.max_input_length, truncation=True, padding=False)
        with tokenizer.as_target_tokenizer():
            labels = tokenizer(targets, max_length=args.max_target_length, truncation=True, padding=False)
        model_in["labels"] = labels["input_ids"]
        return model_in

    train_ds = Dataset.from_dict({"row": train_rows}).map(tokenize, batched=True, remove_columns=["row"])
    eval_ds = Dataset.from_dict({"row": eval_rows}).map(tokenize, batched=True, remove_columns=["row"])

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
    print(f"[train-sql] final metrics: {metrics}")

    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(checkpoint_dir))
    tokenizer.save_pretrained(str(checkpoint_dir))

    if args.no_onnx:
        print("[train-sql] skipping ONNX export (--no-onnx)")
        return 0

    print("[train-sql] exporting to ONNX...")
    try:
        from optimum.onnxruntime import ORTModelForSeq2SeqLM
    except ImportError:
        print("[train-sql] optimum[onnxruntime] not installed — skipping ONNX export.", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    ort_model = ORTModelForSeq2SeqLM.from_pretrained(str(checkpoint_dir), export=True)
    ort_model.save_pretrained(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))

    provenance = {
        "trainedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "baseModel": args.base_model,
        "epochs": args.epochs,
        "datasetRows": len(rows),
        "evalRows": len(eval_rows),
        "metrics": {k: float(v) for k, v in metrics.items() if isinstance(v, (int, float))},
    }
    (output_dir / "provenance.json").write_text(json.dumps(provenance, indent=2))
    print(f"[train-sql] wrote {output_dir}")
    print("[train-sql] next: npx tsx scripts/training/evalSqlModel.ts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
