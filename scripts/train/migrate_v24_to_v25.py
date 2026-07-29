#!/usr/bin/env python3
"""
Migrate plot_pairs_v24.jsonl → plot_pairs_v25.jsonl

Changes:
  1. Add synthetic LINE_CHART examples for `agg+sorted+duo+time` pattern
     (GROUP BY time_bucket + ORDER BY) — the canonical JFR time-series pattern
     that was missing from v24 (only 1 example, a BAR_CHART).
  2. Add PIE_CHART examples for `agg+cnt_agg+duo` without ORDER BY.
     (v24 had PIE mostly with ORDER BY → `ordered` signal, but real queries
      often omit ORDER BY for pie charts.)
  3. Add LINE_CHART examples for `agg+sorted+wide+time` (3+ metric columns).

Run:
    python3 scripts/train/migrate_v24_to_v25.py
"""

import json
import random
import re
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
import gen_plot_pairs as g

random.seed(20260729_25)

# ── Signal extraction (v12 — same as migrate_v23_to_v24.py) ─────────────────

NUM_PAT = re.compile(
    r'(?:count|size|ms|mb|kb|rate|pct|load|pause|duration|alloc|heap|cpu|ticks|samples'
    r'|total|avg|max|overhead|throughput|latency|weight|score|p\d+|%$)',
    re.I
)


def extract_signals_v12(sql: str, columns: list[str]) -> str:
    sql_up = sql.upper()
    names = [c.lower() for c in columns]
    all_names = ' '.join(names)
    tags = []

    has_group_by = bool(re.search(r'\bGROUP\s+BY\b', sql_up))
    has_aggr_fn = bool(re.search(r'\b(?:COUNT|SUM|AVG|MIN|MAX)\s*\(', sql_up))
    has_order_by = bool(re.search(r'\bORDER\s+BY\b', sql_up))
    has_limit = bool(re.search(r'\bLIMIT\b', sql_up))

    if has_group_by: tags.append('agg')
    if has_order_by and has_limit: tags.append('ordered')
    elif has_order_by: tags.append('sorted')

    gb_match = re.search(r'\bGROUP\s+BY\b(.+?)(?:\bHAVING\b|\bORDER\b|\bLIMIT\b|$)', sql, re.I | re.S)
    if gb_match and not has_order_by and ',' in gb_match.group(1): tags.append('cross')

    if not has_group_by and not has_aggr_fn and not has_order_by and has_limit: tags.append('raw')
    if has_aggr_fn and not has_group_by: tags.append('scalar')
    if re.search(r'\bHAVING\b', sql_up): tags.append('having')
    if has_group_by and re.search(r'\bCOUNT\s*\(', sql_up): tags.append('cnt_agg')

    n = len(columns)
    if n == 1: tags.append('solo')
    elif n == 2: tags.append('duo')
    elif n >= 3: tags.append('wide')

    has_time = any(re.search(r'time|timestamp|bucket|date|_at$|_ts$|_dt$|^ts$|^dt$|^when$', nm) for nm in names)
    if has_time: tags.append('time')

    if any(re.search(r'stack|frame|trace', nm) for nm in names): tags.append('stack')
    if (re.search(r'gc|pause|heap|reclai|young|old|survivor|tenur', all_names) or
            re.search(r'GC|Garbage|GARBAGE|HEAP|Heap', sql)):
        tags.append('gc')
    if re.search(r'alloc|tlab|retained|live|object|class', all_names): tags.append('alloc')
    if re.search(r'cpu|thread|method|jvm|machine|load|worker', all_names): tags.append('cpu')
    if re.search(r'delta|change|diff|decrement|increment', all_names): tags.append('delta')

    has_range_start = any(
        re.search(r'start|begin|lower', nm) or nm in ('low',) or
        re.search(r'^min', nm) or re.match(r'^p([0-9]|[1-4]\d)$', nm)
        for nm in names)
    has_range_end = any(
        re.search(r'\bend|finish|upper', nm) or nm in ('high',) or
        re.search(r'^max', nm) or re.match(r'^p([5-9]\d|100)$', nm) or nm in ('p95', 'p99')
        for nm in names)
    if has_range_start and has_range_end: tags.append('range')

    has_numeric_band = any(re.match(r'^(min|max)', nm) or re.match(r'^p\d+$', nm) for nm in names)
    if has_time and has_numeric_band: tags.append('num_range')

    num_count = sum(1 for nm in names if NUM_PAT.search(nm))
    cat_count = sum(1 for nm in names
                    if not NUM_PAT.search(nm)
                    and not re.search(r'time|stamp|date|bucket|_at$|_ts$|_dt$|^ts$|^dt$', nm))
    tags.append(f'num:{min(num_count, 4)}')
    tags.append(f'cat:{min(cat_count, 4)}')
    return ' '.join(tags)


def make_record(sql: str, cols: list[str], output: str, plot_type: str) -> dict:
    signals = extract_signals_v12(sql, cols)
    cols_str = ', '.join(cols)
    input_str = f"hints: {signals}\nsql: {sql}\ncolumns: {cols_str}"
    return {'input': input_str, 'output': output, 'plot_type': plot_type}


# ── New example generators ────────────────────────────────────────────────────

VIEWS = g.JFR_VIEWS
TIME_COLS = ["ts", "time", "bucket", "timestamp", "Time", "Bucket"]
NUM_COLS = g.JFR_NUMERIC_COLS + g.GENERIC_NUMERIC
CAT_COLS = g.JFR_CAT_COLS + g.GENERIC_CAT


def gen_flamegraph_agg_ordered(n: int) -> list[dict]:
    """FLAMEGRAPH with GROUP BY stack + ORDER BY (the realistic query pattern) → agg+ordered+duo+stack"""
    records = []
    stack_cols = ["stackTrace", "stackFrames", "stack", "frames", "stack_trace", "stack_frames", "call_stack"]
    val_cols = ["count", "samples", "Samples", "Count", "weight", "cpu_ticks", "alloc_kb", "duration_ms", "total_ms"]
    views = ["cpu_hot_methods", "allocation_sites", "thread_cpu", "lock_contention",
             "cpu_stacks", "alloc_events", "profiling_events", "jfr_events"]
    for _ in range(n):
        stack_col = random.choice(stack_cols)
        val_col = random.choice(val_cols)
        view = random.choice(views)
        agg_fn = random.choice(["count(*)", "sum", "count"])
        if agg_fn == "count(*)":
            sql = (f'SELECT "{stack_col}", COUNT(*) AS "{val_col}" FROM {view} '
                   f'GROUP BY "{stack_col}" ORDER BY "{val_col}" DESC LIMIT {random.choice([100, 200, 500, 1000])}')
        else:
            sql = (f'SELECT "{stack_col}", {agg_fn}("{val_col}") AS "{val_col}" FROM {view} '
                   f'GROUP BY "{stack_col}" ORDER BY "{val_col}" DESC LIMIT {random.choice([100, 200, 500, 1000])}')
        cols = [stack_col, val_col]
        output = f'FLAMEGRAPH(label: "{stack_col}", value: "{val_col}")'
        records.append(make_record(sql, cols, output, 'FLAMEGRAPH'))
    return records


def gen_area_chart(n: int) -> list[dict]:
    """AREA_CHART: time-series with filled area (sorted or agg+sorted+wide+time)"""
    records = []
    aggs = ["avg", "sum", "max"]
    intervals = [500, 1000, 5000]
    for _ in range(n):
        time_col = random.choice(TIME_COLS)
        num_metrics = random.randint(1, 3)
        metrics = random.sample(NUM_COLS, num_metrics)
        view = random.choice(VIEWS)
        style = random.random()
        if style < 0.4:
            # GROUP BY time_bucket
            agg_fn = random.choice(aggs)
            interval = random.choice(intervals)
            agg_cols = [f'{agg_fn}("{m}") AS "{m}"' for m in metrics]
            sql = (f'SELECT time_bucket("{time_col}", {interval}) AS "Time", {", ".join(agg_cols)} '
                   f'FROM {view} GROUP BY "Time" ORDER BY "Time"')
            cols = ["Time"] + metrics
        elif style < 0.7:
            # With stacked category
            cat = random.choice(CAT_COLS)
            num_col = metrics[0]
            agg_fn = random.choice(aggs)
            interval = random.choice(intervals)
            sql = (f'SELECT time_bucket("{time_col}", {interval}) AS "Time", "{cat}", '
                   f'{agg_fn}("{num_col}") AS "{num_col}" '
                   f'FROM {view} GROUP BY "Time", "{cat}" ORDER BY "Time"')
            cols = ["Time", cat, num_col]
            output = f'AREA_CHART(x: "Time", y: ["{num_col}"], layout: "stacked")'
            records.append(make_record(sql, cols, output, 'AREA_CHART'))
            continue
        else:
            # Raw time column (no GROUP BY)
            col_sql = ', '.join(f'"{m}"' for m in metrics)
            sql = f'SELECT "{time_col}", {col_sql} FROM {view} ORDER BY "{time_col}"'
            cols = [time_col] + metrics
        if num_metrics == 1:
            output = f'AREA_CHART(x: "{cols[0]}", y: ["{metrics[0]}"])'
        else:
            y_arr = ', '.join(f'"{m}"' for m in metrics)
            output = f'AREA_CHART(x: "{cols[0]}", y: [{y_arr}])'
        records.append(make_record(sql, cols, output, 'AREA_CHART'))
    return records


def gen_line_agg_sorted(n: int) -> list[dict]:
    """LINE_CHART with GROUP BY time_bucket + ORDER BY → agg+sorted+duo/wide+time"""
    records = []
    aggs = ["avg", "sum", "max", "min"]
    intervals = [500, 1000, 2000, 5000, 10000]
    for _ in range(n):
        time_col = random.choice(TIME_COLS)
        interval = random.choice(intervals)
        num_metrics = random.randint(1, 3)
        metrics = random.sample(NUM_COLS, num_metrics)
        view = random.choice(VIEWS)
        agg_fn = random.choice(aggs)
        agg_cols = [f'{agg_fn}("{m}") AS "{m}"' for m in metrics]
        sql = (f'SELECT time_bucket("{time_col}", {interval}) AS "Time", {", ".join(agg_cols)} '
               f'FROM {view} GROUP BY "Time" ORDER BY "Time"')
        cols = ["Time"] + metrics
        if num_metrics == 1:
            output = f'LINE_CHART(x: "Time", y: ["{metrics[0]}"])'
        else:
            y_arr = ', '.join(f'"{m}"' for m in metrics)
            output = f'LINE_CHART(x: "Time", y: [{y_arr}])'
        records.append(make_record(sql, cols, output, 'LINE_CHART'))
    return records


def gen_pie_cnt_agg_no_order(n: int) -> list[dict]:
    """PIE_CHART with COUNT(*) GROUP BY (no ORDER BY) → agg+cnt_agg+duo"""
    records = []
    for _ in range(n):
        cat = random.choice(CAT_COLS)
        count_name = random.choice(["count", "Count", "n", "num", "events", "cnt", "cnt_total"])
        view = random.choice(VIEWS)
        sql = f'SELECT "{cat}", COUNT(*) AS "{count_name}" FROM {view} GROUP BY "{cat}"'
        cols = [cat, count_name]
        output = f'PIE_CHART(name: "{cat}", value: "{count_name}")'
        records.append(make_record(sql, cols, output, 'PIE_CHART'))
    return records


def gen_scatter_two_numeric(n: int) -> list[dict]:
    """SCATTER_PLOT with two raw numeric columns (no GROUP BY) → raw+duo+num:2"""
    records = []
    for _ in range(n):
        x, y = random.sample(NUM_COLS, 2)
        view = random.choice(VIEWS)
        sql = f'SELECT "{x}", "{y}" FROM {view} LIMIT {random.choice([500, 1000, 2000, 5000])}'
        cols = [x, y]
        output = f'SCATTER_PLOT(x: "{x}", y: "{y}")'
        records.append(make_record(sql, cols, output, 'SCATTER_PLOT'))
    return records


def gen_boxplot_duo(n: int) -> list[dict]:
    """BOX_PLOT with category + numeric → raw+duo+num:1+cat:1"""
    records = []
    for _ in range(n):
        num_col = random.choice(NUM_COLS)
        cat_col = random.choice(CAT_COLS)
        view = random.choice(VIEWS)
        if random.random() < 0.5:
            sql = f'SELECT "{cat_col}", "{num_col}" FROM {view} LIMIT {random.choice([1000, 5000, 10000])}'
            cols = [cat_col, num_col]
        else:
            sql = f'SELECT "{num_col}", "{cat_col}" FROM {view} ORDER BY "{cat_col}" LIMIT {random.choice([1000, 5000])}'
            cols = [num_col, cat_col]
        output = f'BOX_PLOT(value: "{num_col}", category: "{cat_col}")'
        records.append(make_record(sql, cols, output, 'BOX_PLOT'))
    return records


def gen_table_wide(n: int) -> list[dict]:
    """TABLE with 3-6 mixed columns → wide+time/sorted"""
    records = []
    for _ in range(n):
        view = random.choice(VIEWS)
        style = random.choice(["time_raw", "time_agg", "mixed_raw"])
        if style == "time_raw":
            time_col = random.choice(TIME_COLS)
            other_cols = random.sample(CAT_COLS + NUM_COLS, random.randint(2, 4))
            cols = [time_col] + other_cols
            col_sql = ', '.join(f'"{c}"' for c in cols)
            sql = f'SELECT {col_sql} FROM {view} ORDER BY "{time_col}" LIMIT {random.choice([50, 100, 200])}'
        elif style == "time_agg":
            time_col = random.choice(TIME_COLS)
            cat_col = random.choice(CAT_COLS)
            num_cols = random.sample(NUM_COLS, random.randint(1, 3))
            cols = [cat_col, time_col] + num_cols
            col_sql = ', '.join(f'"{c}"' for c in cols)
            sql = f'SELECT {col_sql} FROM {view} GROUP BY "{cat_col}", "{time_col}" ORDER BY "{time_col}" LIMIT 100'
        else:
            cols = random.sample(CAT_COLS, 1) + random.sample(NUM_COLS, random.randint(2, 4))
            col_sql = ', '.join(f'"{c}"' for c in cols)
            order_col = random.choice([cols[0], cols[1]])
            sql = f'SELECT {col_sql} FROM {view} ORDER BY "{order_col}" LIMIT 100'
        headers_str = ', '.join(f'"{c}"' for c in cols)
        output = f'TABLE(headers: [{headers_str}])'
        records.append(make_record(sql, cols, output, 'TABLE'))
    return records


def main():
    data_dir = REPO_ROOT / 'data'

    for suffix in [('v24', 'v25')]:
        src_pairs = data_dir / f'plot_pairs_{suffix[0]}.jsonl'
        src_eval  = data_dir / f'plot_eval_{suffix[0]}.jsonl'
        dst_pairs = data_dir / f'plot_pairs_{suffix[1]}.jsonl'
        dst_eval  = data_dir / f'plot_eval_{suffix[1]}.jsonl'

        if not src_pairs.exists():
            print(f"SKIP: {src_pairs} not found")
            continue

        existing = [json.loads(l) for l in src_pairs.read_text().splitlines() if l.strip()]
        existing_eval = [json.loads(l) for l in src_eval.read_text().splitlines() if l.strip()] if src_eval.exists() else []

        print(f"Migrating {suffix[0]}→{suffix[1]}: {len(existing)} train, {len(existing_eval)} eval")

        # Generate additions (90% train, 10% eval split)
        additions = [
            ("LINE_CHART agg+sorted+duo/wide+time", gen_line_agg_sorted, 600),
            ("PIE_CHART cnt_agg no-order",           gen_pie_cnt_agg_no_order, 300),
            ("SCATTER_PLOT two-numeric raw",         gen_scatter_two_numeric, 200),
            ("BOX_PLOT duo cat+num",                 gen_boxplot_duo, 200),
            ("TABLE wide",                           gen_table_wide, 150),
            ("AREA_CHART time-series",               gen_area_chart, 500),
            ("FLAMEGRAPH agg+ordered",               gen_flamegraph_agg_ordered, 400),
        ]

        new_train = []
        new_eval = []
        for label, gen_fn, n_total in additions:
            n_eval = max(20, n_total // 10)
            n_train = n_total - n_eval
            all_recs = gen_fn(n_total)
            random.shuffle(all_recs)
            new_train.extend(all_recs[:n_train])
            new_eval.extend(all_recs[n_train:n_train + n_eval])
            print(f"  {label}: +{n_train} train, +{n_eval} eval")

        all_train = existing + new_train
        all_eval = existing_eval + new_eval
        random.shuffle(all_train)

        dst_pairs.write_text('\n'.join(json.dumps(r) for r in all_train) + '\n')
        dst_eval.write_text('\n'.join(json.dumps(r) for r in all_eval) + '\n')

        dist = Counter(r['plot_type'] for r in all_train)
        print(f"\nv25 distribution ({len(all_train)} train, {len(all_eval)} eval):")
        for t, c in sorted(dist.items()):
            print(f"  {t:<20} {c:5d}")

    print("\nDone. To train on v25:")
    print("  Update run_training.sh: DATA=data/plot_pairs_v25.jsonl EVAL=data/plot_eval_v25.jsonl")
    print("  ./scripts/train/run_training.sh --skip-data")


if __name__ == '__main__':
    main()
