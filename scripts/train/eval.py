#!/usr/bin/env python3
"""
Evaluate a fine-tuned checkpoint or ONNX model against the held-out eval set.

Usage:
    # Checkpoint (LoRA or merged):
    python scripts/train/eval.py --checkpoint checkpoints/t5-small-v4 --eval data/plot_eval_v14.jsonl

    # ONNX model:
    python scripts/train/eval.py --onnx onnx/t5-small-v4-q8-arm --eval data/plot_eval_v14.jsonl

    # Causal-LM ONNX:
    python scripts/train/eval.py --onnx onnx/qwen-coder-q8 --eval data/plot_eval.jsonl --kind causal-lm
"""

import argparse
import json
import time
import re
import sys
from collections import defaultdict
from pathlib import Path


KNOWN_PLOT_TYPES = {
    "TABLE", "LINE_CHART", "BAR_CHART", "PIE_CHART", "SCATTER_PLOT",
    "HISTOGRAM", "HEATMAP", "BOX_PLOT", "FLAMEGRAPH", "WATERFALL", "TREEMAP",
    "GANTT", "RANGE", "AREA_CHART",
}

SIGNAL_TAGS = ["agg", "ordered", "having", "wide", "time", "stack", "gc", "alloc", "cpu", "delta", "range"]


def load_eval(path: str) -> list[dict]:
    rows = []
    with open(path) as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def extract_plot_type(config: str) -> str:
    m = re.match(r'(\w+)\s*\(', config.strip())
    return m.group(1).upper() if m else ""


def is_parseable(config: str) -> bool:
    fn = extract_plot_type(config)
    if fn not in KNOWN_PLOT_TYPES:
        return False
    depth = 0
    for ch in config:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def percentile(vals: list[float], p: int) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    idx = int(len(s) * p / 100)
    return s[min(idx, len(s) - 1)]


def extract_signals_from_input(input_text: str) -> list[str]:
    """Pull the hints: tag set from a v3-format input string."""
    for line in input_text.split("\n"):
        if line.startswith("hints: "):
            return line[7:].split()
    return []


def run_inference(model, tokenizer, row: dict, kind: str) -> tuple[str, float]:
    input_text = row["input"]
    if kind == "causal-lm":
        lines = input_text.split("\n")
        sql = next((l[5:] for l in lines if l.startswith("sql: ")), "")
        cols = next((l[9:] for l in lines if l.startswith("columns: ")), "")
        input_text = (
            "<|im_start|>system\nYou are a plot config generator. "
            "Output ONLY the plot config string, nothing else.\n<|im_end|>\n"
            f"<|im_start|>user\nsql: {sql}\ncolumns: {cols}\n<|im_end|>\n<|im_start|>assistant\n"
        )

    inputs = tokenizer(input_text, return_tensors="pt", truncation=True, max_length=256)

    t0 = time.perf_counter()
    outputs = model.generate(**inputs, max_new_tokens=64, do_sample=False, early_stopping=True)
    elapsed_ms = (time.perf_counter() - t0) * 1000

    if kind == "causal-lm":
        output_ids = outputs[0][inputs["input_ids"].shape[1]:]
    else:
        output_ids = outputs[0]

    generated = tokenizer.decode(output_ids, skip_special_tokens=True).strip()
    if kind == "causal-lm":
        generated = generated.split("\n")[0].strip()
    return generated, elapsed_ms


def print_table(title: str, rows: list[tuple], headers: list[str]) -> None:
    col_widths = [max(len(h), max((len(str(r[i])) for r in rows), default=0)) for i, h in enumerate(headers)]
    sep = "  ".join("-" * w for w in col_widths)
    header = "  ".join(h.ljust(w) for h, w in zip(headers, col_widths))
    print(f"\n{title}")
    print(header)
    print(sep)
    for row in rows:
        print("  ".join(str(v).ljust(w) for v, w in zip(row, col_widths)))


def evaluate(model, tokenizer, rows: list[dict], kind: str, label: str) -> None:
    n = len(rows)
    parseable_count = 0
    type_correct_count = 0
    latencies: list[float] = []
    failures: list[dict] = []

    # Per-type accumulators: {plot_type: [correct, total]}
    per_type: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    # Per-signal accumulators: {tag: [correct, total]}
    per_signal: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    # Confusion matrix: {expected: {got: count}}
    confusion: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    print(f"Evaluating {n} examples...")
    for i, row in enumerate(rows):
        expected_type = row.get("plot_type", extract_plot_type(row.get("output", "")))
        signals = extract_signals_from_input(row["input"])

        generated, elapsed_ms = run_inference(model, tokenizer, row, kind)

        parse_ok = is_parseable(generated)
        got_type = extract_plot_type(generated)
        type_ok = got_type == expected_type

        if parse_ok:
            parseable_count += 1
        if type_ok:
            type_correct_count += 1
        latencies.append(elapsed_ms)

        # Per-type tracking
        per_type[expected_type][1] += 1
        if type_ok:
            per_type[expected_type][0] += 1

        # Confusion matrix
        confusion[expected_type][got_type] += 1

        # Per-signal tracking
        for tag in signals:
            base_tag = tag.split(":")[0]  # "num:2" → "num"
            if base_tag in SIGNAL_TAGS:
                per_signal[base_tag][1] += 1
                if type_ok:
                    per_signal[base_tag][0] += 1

        if not type_ok:
            failures.append({
                "id": i,
                "expected": expected_type,
                "got": got_type,
                "generated": generated,
                "parseable": parse_ok,
                "signals": signals,
            })

        if (i + 1) % 50 == 0:
            acc = 100 * type_correct_count / (i + 1)
            sys.stdout.write(f"\r  {i+1}/{n}  acc={acc:.1f}%  p50={percentile(latencies, 50):.0f}ms    ")
            sys.stdout.flush()

    print()

    # ── Summary ──────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"=== Results: {label} ===")
    print(f"{'='*60}")
    print(f"  Parseable:       {parseable_count}/{n} = {100*parseable_count/n:.1f}%")
    print(f"  Plot-type top-1: {type_correct_count}/{n} = {100*type_correct_count/n:.1f}%")
    print(f"  Latency p50:     {percentile(latencies, 50):.0f}ms")
    print(f"  Latency p95:     {percentile(latencies, 95):.0f}ms")
    print(f"  Latency max:     {max(latencies):.0f}ms")

    # ── Per-plot-type breakdown ───────────────────────────────────────────────
    type_rows = []
    for pt in sorted(per_type.keys()):
        correct, total = per_type[pt]
        pct = 100 * correct / total if total else 0.0
        type_rows.append((pt, total, correct, f"{pct:.1f}%"))
    if type_rows:
        print_table("Per-plot-type accuracy:", type_rows,
                    ["Plot Type", "Total", "Correct", "Accuracy"])

    # ── Confusion matrix (only show rows with errors) ────────────────────────
    confused_types = [t for t in sorted(confusion.keys()) if len(confusion[t]) > 1 or
                      (len(confusion[t]) == 1 and list(confusion[t].keys())[0] != t)]
    if confused_types:
        print("\nConfusion (expected → misclassified as):")
        for expected in confused_types:
            wrong = {got: cnt for got, cnt in confusion[expected].items() if got != expected}
            if wrong:
                wrong_str = ", ".join(f"{g}×{c}" for g, c in sorted(wrong.items(), key=lambda x: -x[1]))
                print(f"  {expected:<20} → {wrong_str}")

    # ── Per-signal-tag breakdown ──────────────────────────────────────────────
    sig_rows = []
    for tag in SIGNAL_TAGS:
        if tag in per_signal:
            correct, total = per_signal[tag]
            pct = 100 * correct / total if total else 0.0
            sig_rows.append((tag, total, correct, f"{pct:.1f}%"))
    if sig_rows:
        print_table("Per-signal-tag accuracy (examples that carry the tag):", sig_rows,
                    ["Tag", "Total", "Correct", "Accuracy"])

    # ── Sample failures ───────────────────────────────────────────────────────
    if failures:
        print(f"\nSample failures ({min(10, len(failures))} of {len(failures)}):")
        for f in failures[:10]:
            sig_str = " ".join(f["signals"][:6]) or "(no hints)"
            print(f"  [{f['id']}] {f['expected']} → {f['got']!r}  parse={f['parseable']}  [{sig_str}]")


def main():
    p = argparse.ArgumentParser()
    source = p.add_mutually_exclusive_group(required=True)
    source.add_argument("--checkpoint", help="LoRA/merged checkpoint directory (HF format)")
    source.add_argument("--onnx",       help="ONNX model directory")
    p.add_argument("--eval",  default="data/plot_eval.jsonl")
    p.add_argument("--kind",  default="auto", choices=["auto", "seq2seq", "causal-lm"])
    args = p.parse_args()

    rows = load_eval(args.eval)

    if args.checkpoint:
        _eval_checkpoint(args.checkpoint, rows, args.kind)
    else:
        _eval_onnx(args.onnx, rows, args.kind)


def _detect_kind(model_dir: str) -> str:
    cfg_path = Path(model_dir) / "config.json"
    if not cfg_path.exists():
        # Try adapter_config.json for LoRA checkpoints
        adapter_path = Path(model_dir) / "adapter_config.json"
        if adapter_path.exists():
            cfg = json.loads(adapter_path.read_text())
            tt = cfg.get("task_type", "")
            return "seq2seq" if "SEQ_2_SEQ" in tt else "causal-lm"
        return "seq2seq"
    cfg = json.loads(cfg_path.read_text())
    arch = cfg.get("architectures", [""])[0].lower()
    return "seq2seq" if any(x in arch for x in ("forcondgeneration", "t5", "bart")) else "causal-lm"


def _eval_checkpoint(checkpoint_dir: str, rows: list[dict], kind_arg: str) -> None:
    try:
        import torch
        from transformers import AutoTokenizer, AutoModelForSeq2SeqLM, AutoModelForCausalLM
        from peft import PeftModel, PeftConfig
    except ImportError:
        print("pip install transformers peft torch")
        raise

    kind = kind_arg if kind_arg != "auto" else _detect_kind(checkpoint_dir)
    print(f"Loading checkpoint ({kind}) from {checkpoint_dir}...")

    # Check if this is a LoRA checkpoint (has adapter_config.json)
    adapter_cfg_path = Path(checkpoint_dir) / "adapter_config.json"
    if adapter_cfg_path.exists():
        peft_cfg = PeftConfig.from_pretrained(checkpoint_dir)
        base_model_id = peft_cfg.base_model_name_or_path
        print(f"  LoRA adapter — base model: {base_model_id}")
        tokenizer = AutoTokenizer.from_pretrained(base_model_id)
        if kind == "seq2seq":
            base = AutoModelForSeq2SeqLM.from_pretrained(base_model_id, torch_dtype=torch.float32)
        else:
            base = AutoModelForCausalLM.from_pretrained(base_model_id, torch_dtype=torch.float32)
        model = PeftModel.from_pretrained(base, checkpoint_dir)
    else:
        tokenizer = AutoTokenizer.from_pretrained(checkpoint_dir)
        if kind == "seq2seq":
            model = AutoModelForSeq2SeqLM.from_pretrained(checkpoint_dir, torch_dtype=torch.float32)
        else:
            model = AutoModelForCausalLM.from_pretrained(checkpoint_dir, torch_dtype=torch.float32)

    model.eval()
    evaluate(model, tokenizer, rows, kind, checkpoint_dir)


def _eval_onnx(model_dir: str, rows: list[dict], kind_arg: str) -> None:
    try:
        from optimum.onnxruntime import ORTModelForSeq2SeqLM, ORTModelForCausalLM
        from transformers import AutoTokenizer
    except ImportError:
        print("pip install optimum[onnxruntime] transformers")
        raise

    kind = kind_arg if kind_arg != "auto" else _detect_kind(model_dir)
    print(f"Loading ONNX ({kind}) from {model_dir}...")
    tokenizer = AutoTokenizer.from_pretrained(model_dir)

    if kind == "seq2seq":
        model = ORTModelForSeq2SeqLM.from_pretrained(model_dir)
    else:
        model = ORTModelForCausalLM.from_pretrained(model_dir)

    evaluate(model, tokenizer, rows, kind, model_dir)


if __name__ == "__main__":
    main()
