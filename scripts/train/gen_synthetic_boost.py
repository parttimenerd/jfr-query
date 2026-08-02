#!/usr/bin/env python3
"""
Generate additional synthetic training examples for underrepresented plot types
(TREEMAP, WATERFALL, GANTT, RANGE, HISTOGRAM, SCATTER_PLOT, VIOLIN_PLOT,
SUNBURST, SANKEY, CROSSTAB) using the existing generator functions from
gen_plot_pairs.py but with template-based outputs (no API key needed).

Appends generated examples to plot_pairs_v19.jsonl → plot_pairs_v19b.jsonl
(or creates v20 baseline if v19 is the current DATA).

Run:
    python3 scripts/train/gen_synthetic_boost.py
"""

import json
import random
import re
import sys
from pathlib import Path
from collections import Counter

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
import gen_plot_pairs as g

random.seed(20260729)


def build_gantt_output(cols: list) -> str:
    start, end, lane = cols[0], cols[1], cols[2]
    if len(cols) >= 4:
        return f'GANTT(start: "{start}", end: "{end}", lane: "{lane}", task: "{cols[3]}")'
    return f'GANTT(start: "{start}", end: "{end}", lane: "{lane}")'


def build_range_output(cols: list) -> str:
    x, low, high = cols[0], cols[1], cols[2]
    if len(cols) >= 4:
        return f'RANGE(x: "{x}", low: "{low}", high: "{high}", center: "{cols[3]}")'
    return f'RANGE(x: "{x}", low: "{low}", high: "{high}")'


def build_treemap_output(cols: list) -> str:
    return f'TREEMAP(label: "{cols[0]}", value: "{cols[1]}")'


def build_waterfall_output(cols: list) -> str:
    return f'WATERFALL(category: "{cols[0]}", value: "{cols[1]}")'


def build_histogram_output(cols: list) -> str:
    return f'HISTOGRAM(x: "{cols[0]}")'


def build_scatter_output(cols: list) -> str:
    if len(cols) >= 3:
        return f'SCATTER_PLOT(x: "{cols[0]}", y: "{cols[1]}", size: "{cols[2]}")'
    return f'SCATTER_PLOT(x: "{cols[0]}", y: "{cols[1]}")'


def build_violin_output(cols: list) -> str:
    if len(cols) >= 2:
        return f'VIOLIN_PLOT(value: "{cols[0]}", category: "{cols[1]}")'
    return f'VIOLIN_PLOT(value: "{cols[0]}")'


def build_sunburst_output(cols: list) -> str:
    # Last col is value; all others form the path
    value = cols[-1]
    path_cols = cols[:-1]
    if len(path_cols) == 1:
        return f'SUNBURST(path: "{path_cols[0]}", value: "{value}")'
    path_arr = ', '.join(f'"{c}"' for c in path_cols)
    return f'SUNBURST(path: [{path_arr}], value: "{value}")'


def build_sankey_output(cols: list) -> str:
    return f'SANKEY(source: "{cols[0]}", target: "{cols[1]}", value: "{cols[2]}")'


def build_crosstab_output(cols: list) -> str:
    agg = random.choice(["SUM", "AVG", "COUNT"])
    return f'CROSSTAB(row: "{cols[0]}", col: "{cols[1]}", value: "{cols[2]}", agg: "{agg}")'


BOOST_GENERATORS = [
    ('TREEMAP',      g.make_treemap_inputs,    build_treemap_output,   500),
    ('WATERFALL',    g.make_waterfall_inputs,  build_waterfall_output, 500),
    ('GANTT',        g.make_gantt_inputs,      build_gantt_output,     400),
    ('RANGE',        g.make_range_inputs,      build_range_output,     400),
    ('HISTOGRAM',    g.make_histogram_inputs,  build_histogram_output, 500),  # boosted from 250 to reduce BOX_PLOT confusion
    ('SCATTER_PLOT', g.make_scatter_inputs,    build_scatter_output,   250),
    # VIOLIN_PLOT, SUNBURST, SANKEY, CROSSTAB excluded: share signals with existing
    # types and cause active mispredictions. Users select these explicitly.
]


def generate_boost(src: Path, dst: Path, eval_src: Path, eval_dst: Path) -> None:
    if not src.exists():
        print(f"  SKIP (not found): {src}")
        return

    # Load existing records
    existing = [json.loads(l) for l in src.read_text().splitlines() if l.strip()]
    existing_eval = [json.loads(l) for l in eval_src.read_text().splitlines() if l.strip()] if eval_src.exists() else []

    new_records = []
    new_eval = []

    for plot_type, make_fn, output_fn, n_train in BOOST_GENERATORS:
        n_eval = max(20, n_train // 10)
        train_count = 0
        eval_count = 0
        attempts = 0

        while (train_count < n_train or eval_count < n_eval) and attempts < (n_train + n_eval) * 3:
            attempts += 1
            try:
                sql, cols = make_fn()
            except Exception:
                continue

            # Deduplicate by SQL
            is_eval = (eval_count < n_eval and train_count >= n_train // 2)

            signals = g.extract_input_signals(sql, cols)
            cols_str = ', '.join(cols) if isinstance(cols[0], str) else ', '.join(c['name'] for c in cols)
            input_str = f"hints: {signals}\nsql: {sql}\ncolumns: {cols_str}"
            output = output_fn(cols)
            record = {'input': input_str, 'output': output, 'plot_type': plot_type}

            if is_eval and eval_count < n_eval:
                new_eval.append(record)
                eval_count += 1
            elif train_count < n_train:
                new_records.append(record)
                train_count += 1

        print(f"  {plot_type}: +{train_count} train, +{eval_count} eval")

    # Write combined files
    all_train = existing + new_records
    all_eval = existing_eval + new_eval

    random.shuffle(all_train)  # shuffle so new examples aren't all at end

    dst.write_text('\n'.join(json.dumps(r) for r in all_train) + '\n')
    eval_dst.write_text('\n'.join(json.dumps(r) for r in all_eval) + '\n')

    # Print distribution
    train_dist = Counter(r['plot_type'] for r in all_train)
    print(f"\nv20 distribution ({len(all_train)} train, {len(all_eval)} eval):")
    for t, c in sorted(train_dist.items()):
        print(f"  {t:<20} {c:5d}")


def main():
    data_dir = REPO_ROOT / 'data'
    src = data_dir / 'plot_pairs_v31.jsonl'
    dst = data_dir / 'plot_pairs_v33.jsonl'
    eval_src = data_dir / 'plot_eval_v31.jsonl'
    eval_dst = data_dir / 'plot_eval_v33.jsonl'

    print("Generating v33 synthetic boost data (new plot types excluded)...")
    print("(No API key needed — uses deterministic template-based outputs)")
    print()
    generate_boost(src, dst, eval_src, eval_dst)
    print()
    print("Done. Next steps:")
    print("  Update run_training.sh DATA/EVAL to v33")
    print("  ./scripts/train/run_training.sh --skip-data")


if __name__ == '__main__':
    main()
