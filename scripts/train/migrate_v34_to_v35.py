#!/usr/bin/env python3
"""
Migrate plot_pairs_v34.jsonl → plot_pairs_v35.jsonl

Addresses v14 model eval weaknesses:

  1. BAR_CHART 78.0% — BAR→HEATMAP ×35 persists despite v34 ORDER BY anchors
     Root cause: 35 eval BAR examples have `agg+cross+wide` (GROUP BY 2 cats, no ORDER BY)
     = grouped bar charts. Only 8 BAR train examples have `cross`, vs 1049 HEATMAP.
     Model rationally predicts HEATMAP for `cross` because 130× more training examples.
     Fix: +400 grouped BAR examples with `cross` signal (no ORDER BY, layout: "grouped")

  2. LINE_CHART 88.9% — LINE→SCATTER ×13 (duo+num:2+cat:0 or duo+time)
     Signals: duo+time is LINE but duo+num:2+cat:0 is ambiguous with SCATTER.
     Fix: +200 LINE examples with duo+time+num:2 (two numerics, time x-axis) to anchor
     the boundary: time-indexed two-metric queries are LINE, not SCATTER.

  3. BAR→PIE ×14 (new regression from v34)
     Signals: agg+duo patterns — some BAR+duo examples being stolen by PIE.
     Fix: +200 BAR examples with duo+ORDER BY (reinforce that PIE has no ORDER BY).

Run:
    python3 scripts/train/migrate_v34_to_v35.py
Then:
    ./scripts/train/run_training.sh --skip-data --skip-autocomplete
    bash scripts/train/deploy_v5.sh
"""

import json
import random
import re
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))

random.seed(20260802_35)

JFR_TIME_COLS = ["Time", "startTime", "endTime", "timestamp", "eventTime", "bucket",
                 "sampleTime", "gcTime", "allocTime"]
GENERIC_TIME = ["time", "ts", "date", "created_at", "updated_at"]
JFR_NUMERIC_COLS = ["duration", "pauseMs", "allocBytes", "heapUsed", "heapCapacity",
                    "cpuLoad", "gcCount", "threadCount", "samples", "count",
                    "allocRate", "throughput", "latency", "overhead", "weight"]
GENERIC_NUMERIC = ["value", "total", "avg", "sum", "max", "rate", "size", "ms", "pct"]
JFR_CAT_COLS = ["gcName", "gcCause", "threadName", "className", "methodName",
                "packageName", "gcPhase", "allocType", "eventType"]
GENERIC_CAT = ["name", "type", "category", "label", "group", "kind", "source"]
JFR_VIEWS = ["gc_pauses", "cpu_load", "alloc_in_new_tlab", "thread_cpu",
             "heap_summary", "gc_heap_summary", "object_allocation", "lock_contention",
             "method_profiling", "cpu_hot_methods", "allocation_sites", "jfr_events"]
AGG_FNS = ["AVG", "SUM", "MAX", "MIN", "COUNT"]


NUM_PAT = re.compile(
    r'(?:count|size|ms|mb|kb|rate|pct|load|pause|duration|alloc|heap|cpu|ticks|samples'
    r'|total|avg|max|overhead|throughput|latency|weight|score|p\d+|%$'
    r'|^young$|^old$|^meta$|^eden$|^survivor$)',
    re.I
)


def extract_v15(sql: str, columns: list) -> str:
    sql_up = sql.upper()
    names = [(c if isinstance(c, str) else c.get('name', '')).lower() for c in columns]
    types = [('' if isinstance(c, str) else c.get('type', '')).upper() for c in columns]
    all_names = ' '.join(names)
    tags = []
    has_group_by = bool(re.search(r'\bGROUP\s+BY\b', sql_up))
    has_order_by = bool(re.search(r'\bORDER\s+BY\b', sql_up))
    has_limit = bool(re.search(r'\bLIMIT\b', sql_up))
    has_aggr_fn = bool(re.search(r'\b(?:COUNT|SUM|AVG|MIN|MAX)\s*\(', sql_up))
    if has_group_by: tags.append('agg')
    if has_order_by and has_limit and not has_group_by: tags.append('ordered')
    elif has_order_by and not has_limit: tags.append('sorted')
    if has_group_by and has_order_by and has_limit: tags.append('topN')
    gb_match = re.search(r'\bGROUP\s+BY\b(.+?)(?:\bHAVING\b|\bORDER\b|\bLIMIT\b|$)', sql, re.I | re.S)
    if gb_match and not has_order_by and ',' in gb_match.group(1): tags.append('cross')
    if not has_group_by and not has_aggr_fn and not has_order_by and has_limit: tags.append('raw')
    if has_aggr_fn and not has_group_by: tags.append('scalar')
    if re.search(r'\bHAVING\b', sql_up): tags.append('having')
    if has_group_by and re.search(r'\bCOUNT\s*\(', sql_up): tags.append('cnt_agg')
    if has_group_by and re.search(r'\bSUM\s*\(', sql_up): tags.append('sum_agg')
    if len(columns) == 1: tags.append('solo')
    elif len(columns) == 2: tags.append('duo')
    elif len(columns) >= 3: tags.append('wide')
    TIME_TYPES = {'TIMESTAMP', 'DATE', 'TIMESTAMP_NS', 'TIMESTAMP_MS'}
    has_time = (any(t in TIME_TYPES for t in types) or
                any(re.search(r'time|timestamp|bucket|date|_at$|_ts$|_dt$|^ts$|^dt$|^when$', n) for n in names))
    if has_time: tags.append('time')
    if any(re.search(r'stack|frame|trace', n) for n in names): tags.append('stack')
    if (re.search(r'gc|pause|heap|reclai|young|old|survivor|tenur', all_names) or
            re.search(r'GC|Garbage|GARBAGE|HEAP|Heap', sql)): tags.append('gc')
    if re.search(r'alloc|tlab|retained|live|object|class', all_names): tags.append('alloc')
    if re.search(r'cpu|thread|method|jvm|machine|load|worker', all_names): tags.append('cpu')
    if any(re.search(r'(^|_)(delta|change|diff|decrement|increment)(_|$)', n) and
           not re.search(r'(^|_)(change|diff)_(count|rate|id|ratio|percent|total|num|flag)', n) and
           not re.search(r'exchange', n) for n in names): tags.append('delta')
    has_range_start = any(
        re.search(r'start|begin|lower', n) or n in ('low',) or
        re.search(r'^min', n) or re.match(r'^p([0-9]|[1-4]\d)$', n) for n in names)
    has_range_end = any(
        re.search(r'(^|_)end(_|$)|^end[a-z]|finish|upper', n) or n in ('high',) or
        re.search(r'^max', n) or re.match(r'^p([5-9]\d|100)$', n) or n in ('p95', 'p99')
        for n in names)
    if has_range_start and has_range_end: tags.append('range')
    has_numeric_band = any(re.match(r'^(min|max)', n) or re.match(r'^p\d+$', n) for n in names)
    if has_time and has_numeric_band: tags.append('num_range')
    NUM_TYPES_SET = {'INTEGER', 'BIGINT', 'DOUBLE', 'FLOAT', 'DECIMAL', 'NUMERIC',
                     'SMALLINT', 'TINYINT', 'REAL', 'HUGEINT', 'INT4', 'INT8', 'FLOAT4', 'FLOAT8'}
    num_count = cat_count = 0
    for n, t in zip(names, types):
        if t in NUM_TYPES_SET or (not t and NUM_PAT.search(n)): num_count += 1
        elif t in ('VARCHAR', 'TEXT', 'STRING') or (not t and not re.search(r'time|stamp|date|bucket|_at$|_ts$|_dt$', n)): cat_count += 1
    tags.append(f'num:{min(num_count, 4)}')
    tags.append(f'cat:{min(cat_count, 4)}')
    time_named = [n for n in names if re.search(r'time|timestamp|bucket|date|_at$|_ts$|_dt$|^ts$|^dt$|^when$', n)]
    if not has_numeric_band and has_range_start and has_range_end and len(time_named) >= 2 and cat_count >= 1:
        tags.append('gantt_span')
    return ' '.join(tags)


def make_record(plot_type: str, config: str, sql: str, cols: list) -> dict:
    hints = extract_v15(sql, cols)
    return {
        "input": f"hints: {hints}\nsql: {sql}\ncolumns: {', '.join(cols)}",
        "output": config,
        "plot_type": plot_type,
        "source": "v35_fix",
    }


# ── Fix 1: grouped BAR with cross signal (no ORDER BY) ──────────────────────
# These look like HEATMAP to the model. Teaching it that `cross+wide+cat:2+num:1`
# with a dimension column can be a grouped bar.

def gen_bar_grouped_cross(n_train: int, n_eval: int):
    train, eval_ = [], []
    attempts = 0
    while (len(train) < n_train or len(eval_) < n_eval) and attempts < (n_train + n_eval) * 5:
        attempts += 1
        x = random.choice(JFR_CAT_COLS + GENERIC_CAT)
        category = random.choice([c for c in JFR_CAT_COLS + GENERIC_CAT if c != x])
        val = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
        view = random.choice(JFR_VIEWS)
        agg_fn = random.choice(["AVG", "SUM", "MAX", "COUNT"])
        # No ORDER BY → cross signal
        sql = (f'SELECT "{x}", "{category}", {agg_fn}("{val}") AS "{val}" '
               f'FROM {view} GROUP BY "{x}", "{category}"')
        cols = [x, category, val]
        layout = random.choice(["grouped", "stacked"])
        config = f'BAR_CHART(x: "{x}", y: "{val}", category: "{category}", layout: "{layout}")'
        rec = make_record("BAR_CHART", config, sql, cols)
        if len(eval_) < n_eval and len(train) >= n_train // 2:
            eval_.append(rec)
        elif len(train) < n_train:
            train.append(rec)
    return train, eval_


# ── Fix 2: LINE with two numerics on time axis ───────────────────────────────
# duo+num:2+cat:0 is ambiguous with SCATTER. Add duo+time+num:2 LINE examples
# to teach: time-indexed = LINE, not SCATTER.

def gen_line_time_two_num(n_train: int, n_eval: int):
    train, eval_ = [], []
    attempts = 0
    while (len(train) < n_train or len(eval_) < n_eval) and attempts < (n_train + n_eval) * 5:
        attempts += 1
        time_col = random.choice(JFR_TIME_COLS + GENERIC_TIME)
        # Pick a composite numeric col name that registers as 1 num
        num_col = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
        view = random.choice(JFR_VIEWS)
        agg_fn = random.choice(["AVG", "MAX", "SUM"])
        style = random.random()
        if style < 0.5:
            bucket = random.choice([100, 500, 1000])
            sql = (f'SELECT time_bucket("{time_col}", {bucket}) AS "{time_col}", '
                   f'{agg_fn}("{num_col}") AS "{num_col}" '
                   f'FROM {view} GROUP BY "{time_col}" ORDER BY "{time_col}"')
        else:
            sql = f'SELECT "{time_col}", "{num_col}" FROM {view} ORDER BY "{time_col}"'
        cols = [time_col, num_col]
        config = f'LINE_CHART(x: "{time_col}", y: ["{num_col}"])'
        rec = make_record("LINE_CHART", config, sql, cols)
        if len(eval_) < n_eval and len(train) >= n_train // 2:
            eval_.append(rec)
        elif len(train) < n_train:
            train.append(rec)
    return train, eval_


# ── Fix 3: BAR duo with ORDER BY (prevent PIE stealing) ─────────────────────
# PIE and BAR both have agg+duo. PIE has no ORDER BY; BAR has ORDER BY.
# Reinforce the ORDER BY distinction for duo BAR.

def gen_bar_duo_ordered(n_train: int, n_eval: int):
    train, eval_ = [], []
    attempts = 0
    while (len(train) < n_train or len(eval_) < n_eval) and attempts < (n_train + n_eval) * 5:
        attempts += 1
        cat = random.choice(JFR_CAT_COLS + GENERIC_CAT)
        val = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
        view = random.choice(JFR_VIEWS)
        agg_fn = random.choice(["AVG", "SUM", "MAX", "COUNT"])
        style = random.random()
        if style < 0.5:
            limit = random.choice([5, 10, 15, 20])
            sql = (f'SELECT "{cat}", {agg_fn}("{val}") AS "{val}" '
                   f'FROM {view} GROUP BY "{cat}" ORDER BY "{val}" DESC LIMIT {limit}')
        else:
            sql = (f'SELECT "{cat}", {agg_fn}("{val}") AS "{val}" '
                   f'FROM {view} GROUP BY "{cat}" ORDER BY "{val}" DESC')
        cols = [cat, val]
        config = f'BAR_CHART(x: "{cat}", y: "{val}")'
        rec = make_record("BAR_CHART", config, sql, cols)
        if len(eval_) < n_eval and len(train) >= n_train // 2:
            eval_.append(rec)
        elif len(train) < n_train:
            train.append(rec)
    return train, eval_


def main():
    data_dir = REPO_ROOT / 'data'
    src_train = data_dir / 'plot_pairs_v34.jsonl'
    src_eval  = data_dir / 'plot_eval_v34.jsonl'
    dst_train = data_dir / 'plot_pairs_v35.jsonl'
    dst_eval  = data_dir / 'plot_eval_v35.jsonl'

    existing_train = [json.loads(l) for l in src_train.read_text().splitlines() if l.strip()]
    existing_eval  = [json.loads(l) for l in src_eval.read_text().splitlines() if l.strip()]

    generators = [
        ("BAR_CHART (grouped/cross)", gen_bar_grouped_cross,  400, 40),
        ("LINE_CHART (time duo)",     gen_line_time_two_num,  200, 20),
        ("BAR_CHART (duo/ordered)",   gen_bar_duo_ordered,    200, 20),
    ]

    new_train, new_eval = [], []
    for label, fn, n_tr, n_ev in generators:
        tr, ev = fn(n_tr, n_ev)
        print(f"  {label}: +{len(tr)} train, +{len(ev)} eval")
        new_train.extend(tr)
        new_eval.extend(ev)

    all_train = existing_train + new_train
    all_eval  = existing_eval + new_eval
    random.shuffle(all_train)

    dst_train.write_text('\n'.join(json.dumps(r) for r in all_train) + '\n')
    dst_eval.write_text('\n'.join(json.dumps(r) for r in all_eval) + '\n')

    dist = Counter(r['plot_type'] for r in all_train)
    print(f"\nv35 distribution ({len(all_train)} train, {len(all_eval)} eval):")
    for t, c in sorted(dist.items()):
        print(f"  {t:<20} {c:5d}")

    print("\nDone. Next steps:")
    print("  Update run_training.sh DATA/EVAL to v35")
    print("  ./scripts/train/run_training.sh --skip-data --skip-autocomplete")
    print("  bash scripts/train/deploy_v5.sh")


if __name__ == '__main__':
    main()
