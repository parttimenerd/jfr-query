#!/usr/bin/env python3
"""
Migrate plot_pairs_v25.jsonl → plot_pairs_v26.jsonl

Fixes discovered from completion scenario tests (v5 model, 56% pass rate):

  1. SCATTER_PLOT `agg+duo+num:2` — v25 only has `raw+duo+num:2`. Real JFR queries
     often aggregate before scatter (e.g. GROUP BY thread + avg cpu, alloc).
  2. GANTT `ordered+wide+cat:3` — v25 has `sorted+wide+cat:3` but realistic JFR
     queries use ORDER BY (not just sorted). Need `ordered` fingerprint.
  3. HISTOGRAM `raw+solo` and `ordered+solo` — v25 histogram examples lack these
     structural signals. Test queries have LIMIT (→ ordered) or no ORDER BY (→ raw).
  4. TABLE `scalar+duo/wide` — scalar aggregate summaries (COUNT, AVG without GROUP BY)
     go to TABLE but v25 only has 89 scalar examples, most solo.
  5. BAR_CHART `ordered+duo+num:0+cat:1` — pure count bars (no numeric value col)
     getting confused with TREEMAP.

Run:
    python3 scripts/train/migrate_v25_to_v26.py
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

random.seed(20260729_26)

# ── Signal extraction (v12) ──────────────────────────────────────────────────

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
        re.search(r'(^|_)end(_|$)|^end[a-z]|finish|upper', nm) or nm in ('high',) or
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


# ── Constants ────────────────────────────────────────────────────────────────

VIEWS = g.JFR_VIEWS
NUM_COLS = g.JFR_NUMERIC_COLS + g.GENERIC_NUMERIC
CAT_COLS = g.JFR_CAT_COLS + g.GENERIC_CAT

GANTT_TIME_PAIRS = [
    ("start_time", "end_time"),
    ("start_ts", "end_ts"),
    ("begin_time", "finish_time"),
    ("lock_start", "lock_end"),
    ("compile_start", "compile_end"),
    ("jit_start", "jit_end"),
    ("gc_start", "gc_end"),
    ("thread_start", "thread_end"),
    ("event_start", "event_end"),
    ("phase_start", "phase_end"),
]

GANTT_CAT_COLS = [
    "thread_name", "thread_id", "method_name", "event_type", "lock_name",
    "phase", "operation", "task_name", "worker_name", "class_name",
]


def gen_scatter_agg_duo(n: int) -> list[dict]:
    """SCATTER_PLOT with aggregated numeric pair (agg+duo+num:2) — missing from v25."""
    records = []
    aggs = ["avg", "sum", "max", "p99"]
    views_local = ["thread_activity", "method_perf", "gc_summary", "cpu_profile",
                   "alloc_summary"] + VIEWS
    cat_cols = ["thread_name", "method_name", "class_name", "event_type", "thread_id",
                "gc_type", "package_name", "module", "worker"]
    for _ in range(n):
        x_col, y_col = random.sample(NUM_COLS, 2)
        cat = random.choice(cat_cols)
        view = random.choice(VIEWS)
        ax, ay = random.choice(aggs), random.choice(aggs)
        # Pattern: GROUP BY category, SELECT avg(x), avg(y) → SCATTER the result
        sql = (f'SELECT {ax}("{x_col}") AS "{x_col}", {ay}("{y_col}") AS "{y_col}" '
               f'FROM {view} GROUP BY "{cat}"')
        cols = [x_col, y_col]
        output = f'SCATTER_PLOT(x: "{x_col}", y: "{y_col}")'
        records.append(make_record(sql, cols, output, 'SCATTER_PLOT'))
    return records


def gen_scatter_with_category(n: int) -> list[dict]:
    """SCATTER_PLOT with category column (raw+wide+num:2+cat:1) — cluster scatter."""
    records = []
    for _ in range(n):
        x_col, y_col = random.sample(NUM_COLS, 2)
        cat = random.choice(CAT_COLS)
        view = random.choice(VIEWS)
        limit = random.choice([500, 1000, 2000])
        sql = f'SELECT "{x_col}", "{y_col}", "{cat}" FROM {view} LIMIT {limit}'
        cols = [x_col, y_col, cat]
        output = f'SCATTER_PLOT(x: "{x_col}", y: "{y_col}", category: "{cat}")'
        records.append(make_record(sql, cols, output, 'SCATTER_PLOT'))
    return records


def gen_gantt_ordered(n: int) -> list[dict]:
    """GANTT with ORDER BY LIMIT (ordered+wide) — realistic JFR profiling queries."""
    records = []
    for _ in range(n):
        start_col, end_col = random.choice(GANTT_TIME_PAIRS)
        label_cols = random.sample(GANTT_CAT_COLS, random.randint(1, 2))
        view = random.choice(VIEWS)
        limit = random.choice([50, 100, 200, 500])
        order_col = random.choice([start_col, end_col, label_cols[0]])
        all_cols = label_cols + [start_col, end_col]
        col_sql = ', '.join(f'"{c}"' for c in all_cols)
        sql = f'SELECT {col_sql} FROM {view} ORDER BY "{order_col}" LIMIT {limit}'
        cols = all_cols
        output = f'GANTT(label: "{label_cols[0]}", start: "{start_col}", end: "{end_col}")'
        records.append(make_record(sql, cols, output, 'GANTT'))
    return records


def gen_histogram_with_limit(n: int) -> list[dict]:
    """HISTOGRAM with raw (LIMIT only) or ordered (ORDER BY + LIMIT) queries."""
    records = []
    for _ in range(n):
        col = random.choice(NUM_COLS)
        view = random.choice(VIEWS)
        limit = random.choice([1000, 5000, 10000, 50000])
        bins = random.choice([None, 20, 50, 100])
        style = random.random()
        if style < 0.5:
            # raw: just LIMIT, no ORDER BY
            sql = f'SELECT "{col}" FROM {view} LIMIT {limit}'
        elif style < 0.75:
            # ordered: ORDER BY col LIMIT (realistic: get most extreme values)
            sql = f'SELECT "{col}" FROM {view} ORDER BY "{col}" DESC LIMIT {limit}'
        else:
            # ordered with WHERE
            threshold = random.choice([0, 1, 10])
            sql = f'SELECT "{col}" FROM {view} WHERE "{col}" > {threshold} ORDER BY "{col}" LIMIT {limit}'
        cols = [col]
        if bins:
            output = f'HISTOGRAM(value: "{col}", bins: {bins})'
        else:
            output = f'HISTOGRAM(value: "{col}")'
        records.append(make_record(sql, cols, output, 'HISTOGRAM'))
    return records


def gen_table_scalar(n: int) -> list[dict]:
    """TABLE for scalar aggregates (no GROUP BY): scalar+duo/wide."""
    records = []
    scalar_patterns = [
        # scalar+duo: count(*) with another stat
        lambda: (
            f'SELECT COUNT(*) AS "total_events", AVG("{random.choice(NUM_COLS)}") AS "avg_{random.choice(NUM_COLS)}" '
            f'FROM {random.choice(VIEWS)}',
            ["total_events", f"avg_{random.choice(NUM_COLS)}"]
        ),
        # scalar+wide: multiple stats
        lambda: (
            f'SELECT COUNT(*) AS "count", SUM("{random.choice(NUM_COLS)}") AS "total", '
            f'AVG("{random.choice(NUM_COLS)}") AS "average", MAX("{random.choice(NUM_COLS)}") AS "peak" '
            f'FROM {random.choice(VIEWS)}',
            ["count", "total", "average", "peak"]
        ),
        # scalar with domain cols
        lambda v=random.choice(VIEWS), n1=random.choice(NUM_COLS), n2=random.choice(NUM_COLS): (
            f'SELECT COUNT(*) AS "events", SUM("{n1}") AS "total_{n1}", MAX("{n2}") AS "max_{n2}" FROM {v}',
            ["events", f"total_{n1}", f"max_{n2}"]
        ),
    ]
    for _ in range(n):
        pat = random.choice(scalar_patterns)
        sql, cols = pat()
        headers_str = ', '.join(f'"{c}"' for c in cols)
        output = f'TABLE(headers: [{headers_str}])'
        records.append(make_record(sql, cols, output, 'TABLE'))
    return records


def gen_table_wide_ordered(n: int) -> list[dict]:
    """TABLE for wide ordered queries (ordered+wide+time or ordered+wide+cat)."""
    records = []
    time_cols = ["ts", "timestamp", "time", "event_time", "start_time", "created_at"]
    for _ in range(n):
        view = random.choice(VIEWS)
        style = random.choice(["time_ordered", "cat_ordered", "mixed_ordered"])
        if style == "time_ordered":
            time_col = random.choice(time_cols)
            other = random.sample(CAT_COLS + NUM_COLS, random.randint(2, 4))
            cols = [time_col] + other
            limit = random.choice([50, 100, 200])
            col_sql = ', '.join(f'"{c}"' for c in cols)
            sql = f'SELECT {col_sql} FROM {view} ORDER BY "{time_col}" DESC LIMIT {limit}'
        elif style == "cat_ordered":
            cat_col = random.choice(CAT_COLS)
            num_cols = random.sample(NUM_COLS, random.randint(2, 4))
            cols = [cat_col] + num_cols
            limit = random.choice([50, 100])
            col_sql = ', '.join(f'"{c}"' for c in cols)
            sql = f'SELECT {col_sql} FROM {view} ORDER BY "{num_cols[0]}" DESC LIMIT {limit}'
        else:
            mixed = random.sample(CAT_COLS, 2) + random.sample(NUM_COLS, random.randint(2, 3))
            cols = mixed
            limit = random.choice([50, 100])
            col_sql = ', '.join(f'"{c}"' for c in cols)
            sql = f'SELECT {col_sql} FROM {view} ORDER BY "{cols[-1]}" LIMIT {limit}'
        headers_str = ', '.join(f'"{c}"' for c in cols)
        output = f'TABLE(headers: [{headers_str}])'
        records.append(make_record(sql, cols, output, 'TABLE'))
    return records


def gen_bar_ordered_no_numeric(n: int) -> list[dict]:
    """BAR_CHART with pure count (ordered+duo+cnt_agg+num:1+cat:1) — top-N categories."""
    records = []
    cat_cols = ["method_name", "class_name", "thread_name", "event_type", "package",
                "gc_type", "lock_name", "module", "operation", "cause"]
    count_names = ["count", "Count", "n", "total", "events", "occurrences", "cnt"]
    for _ in range(n):
        cat = random.choice(cat_cols)
        count_name = random.choice(count_names)
        view = random.choice(VIEWS)
        limit = random.choice([5, 10, 15, 20, 25])
        sql = (f'SELECT "{cat}", COUNT(*) AS "{count_name}" FROM {view} '
               f'GROUP BY "{cat}" ORDER BY "{count_name}" DESC LIMIT {limit}')
        cols = [cat, count_name]
        output = f'BAR_CHART(x: "{cat}", y: ["{count_name}"])'
        records.append(make_record(sql, cols, output, 'BAR_CHART'))
    return records


def main():
    data_dir = REPO_ROOT / 'data'

    for suffix in [('v25', 'v26')]:
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

        additions = [
            ("SCATTER_PLOT agg+duo (no GROUP BY col in output)", gen_scatter_agg_duo, 300),
            ("SCATTER_PLOT with category col (wide)",            gen_scatter_with_category, 150),
            ("GANTT ordered (ORDER BY LIMIT)",                   gen_gantt_ordered, 400),
            ("HISTOGRAM raw+solo / ordered+solo",                gen_histogram_with_limit, 400),
            ("TABLE scalar aggregates (duo/wide)",               gen_table_scalar, 200),
            ("TABLE wide ordered queries",                       gen_table_wide_ordered, 200),
            ("BAR_CHART ordered+cnt_agg top-N pure count",       gen_bar_ordered_no_numeric, 200),
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
        print(f"\nv26 distribution ({len(all_train)} train, {len(all_eval)} eval):")
        for t, c in sorted(dist.items()):
            print(f"  {t:<20} {c:5d}")

    print("\nDone. To train on v26:")
    print("  Update run_training.sh: DATA=data/plot_pairs_v26.jsonl EVAL=data/plot_eval_v26.jsonl")
    print("  ./scripts/train/run_training.sh --skip-data --skip-autocomplete")


if __name__ == '__main__':
    main()
