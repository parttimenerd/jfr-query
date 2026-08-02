#!/usr/bin/env python3
"""
Migrate plot_pairs_v33.jsonl → plot_pairs_v34.jsonl

Addresses v13 model eval weaknesses:

  1. AREA_CHART 73.3% — confused with LINE_CHART ×24
     Signals: both use sorted+wide+time. LINE is duo+time, AREA is wide+time.
     But when AREA has only 1 numeric col (rare in generator but present in eval),
     signals overlap. Also, AREA with AVG/SUM agg gets `agg+sorted+wide+time`
     which the model hasn't seen enough of.
     Fix: +400 AREA examples with explicit AVG/SUM aggregation, always wide (2+ num cols)
     Fix: +200 LINE examples explicitly duo+time (reinforce fingerprint)

  2. BAR_CHART 81.2% — confused with HEATMAP ×35
     Signals: BAR→HEATMAP on `agg+cross+wide`. BAR generator always uses ORDER BY,
     but Haiku-generated eval examples sometimes omit it, generating `cross` signal.
     Fix: +400 BAR examples with ORDER BY always present, varied domain signals
     Fix: +200 HEATMAP examples to anchor the `cross` pattern firmly

Run:
    python3 scripts/train/migrate_v33_to_v34.py
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

random.seed(20260802_34)

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
AGG_FNS = ["AVG", "SUM", "MAX", "MIN"]


# ── Signal extraction (v15, unchanged) ──────────────────────────────────────

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
            re.search(r'GC|Garbage|GARBAGE|HEAP|Heap', sql)):
        tags.append('gc')
    if re.search(r'alloc|tlab|retained|live|object|class', all_names): tags.append('alloc')
    if re.search(r'cpu|thread|method|jvm|machine|load|worker', all_names): tags.append('cpu')

    if any(re.search(r'(^|_)(delta|change|diff|decrement|increment)(_|$)', n) and
           not re.search(r'(^|_)(change|diff)_(count|rate|id|ratio|percent|total|num|flag)', n) and
           not re.search(r'exchange', n)
           for n in names): tags.append('delta')

    has_range_start = any(
        re.search(r'start|begin|lower', n) or n in ('low',) or
        re.search(r'^min', n) or re.match(r'^p([0-9]|[1-4]\d)$', n)
        for n in names)
    has_range_end = any(
        re.search(r'(^|_)end(_|$)|^end[a-z]|finish|upper', n) or n in ('high',) or
        re.search(r'^max', n) or re.match(r'^p([5-9]\d|100)$', n) or n in ('p95', 'p99')
        for n in names)
    if has_range_start and has_range_end: tags.append('range')

    has_numeric_band = any(re.match(r'^(min|max)', n) or re.match(r'^p\d+$', n) for n in names)
    if has_time and has_numeric_band: tags.append('num_range')

    NUM_TYPES_SET = {'INTEGER', 'BIGINT', 'DOUBLE', 'FLOAT', 'DECIMAL', 'NUMERIC',
                     'SMALLINT', 'TINYINT', 'REAL', 'HUGEINT', 'INT4', 'INT8', 'FLOAT4', 'FLOAT8'}
    num_count = 0
    cat_count = 0
    for n, t in zip(names, types):
        if t in NUM_TYPES_SET or (not t and NUM_PAT.search(n)):
            num_count += 1
        elif t in ('VARCHAR', 'TEXT', 'STRING') or (not t and not re.search(r'time|stamp|date|bucket|_at$|_ts$|_dt$', n)):
            cat_count += 1
    tags.append(f'num:{min(num_count, 4)}')
    tags.append(f'cat:{min(cat_count, 4)}')

    time_named = [n for n in names if re.search(r'time|timestamp|bucket|date|_at$|_ts$|_dt$|^ts$|^dt$|^when$', n)]
    if not has_numeric_band and has_range_start and has_range_end and len(time_named) >= 2 and cat_count >= 1:
        tags.append('gantt_span')

    return ' '.join(tags)


def make_record(plot_type: str, config: str, sql: str, cols: list) -> dict:
    hints = extract_v15(sql, cols)
    cols_str = ', '.join(cols)
    return {
        "input": f"hints: {hints}\nsql: {sql}\ncolumns: {cols_str}",
        "output": config,
        "plot_type": plot_type,
        "source": "v34_fix",
    }


# ── Fix 1: AREA_CHART with explicit aggregation ──────────────────────────────
# These have `agg+sorted+wide+time` — clearly distinct from LINE (which lacks agg
# in non-grouped cases, or has duo when grouped). Anchors AREA in the agg+sorted+wide
# region that was bleeding into LINE.

def gen_area_agg(n_train: int, n_eval: int):
    train, eval_ = [], []
    attempts = 0
    while (len(train) < n_train or len(eval_) < n_eval) and attempts < (n_train + n_eval) * 5:
        attempts += 1
        time_col = random.choice(JFR_TIME_COLS + GENERIC_TIME)
        nums = random.sample(JFR_NUMERIC_COLS + GENERIC_NUMERIC, random.randint(2, 4))
        view = random.choice(JFR_VIEWS)
        agg_fn = random.choice(AGG_FNS)
        bucket_size = random.choice([100, 500, 1000, 5000])
        # Always use time_bucket grouping + ORDER BY time → agg+sorted+wide+time
        agg_cols = [f'{agg_fn}("{n}") AS "{n}"' for n in nums]
        sql = (f'SELECT time_bucket("{time_col}", {bucket_size}) AS "{time_col}", '
               f'{", ".join(agg_cols)} '
               f'FROM {view} GROUP BY "{time_col}" ORDER BY "{time_col}"')
        cols = [time_col] + nums
        y_part = ', '.join(f'"{n}"' for n in nums)
        config = f'AREA_CHART(x: "{time_col}", y: [{y_part}])'
        rec = make_record("AREA_CHART", config, sql, cols)
        if len(eval_) < n_eval and len(train) >= n_train // 2:
            eval_.append(rec)
        elif len(train) < n_train:
            train.append(rec)
    return train, eval_


# ── Fix 2: LINE_CHART explicit duo+time ─────────────────────────────────────
# Reinforce the duo+time fingerprint for LINE to prevent AREA from stealing it.

def gen_line_duo(n_train: int, n_eval: int):
    train, eval_ = [], []
    attempts = 0
    while (len(train) < n_train or len(eval_) < n_eval) and attempts < (n_train + n_eval) * 5:
        attempts += 1
        time_col = random.choice(JFR_TIME_COLS + GENERIC_TIME)
        num_col = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
        view = random.choice(JFR_VIEWS)
        style = random.random()
        if style < 0.4:
            # Simple sorted duo: SELECT time, val FROM view ORDER BY time
            sql = f'SELECT "{time_col}", "{num_col}" FROM {view} ORDER BY "{time_col}"'
        elif style < 0.7:
            # Aggregated duo: GROUP BY time_bucket ORDER BY time
            bucket_size = random.choice([100, 500, 1000])
            agg_fn = random.choice(AGG_FNS)
            sql = (f'SELECT time_bucket("{time_col}", {bucket_size}) AS "{time_col}", '
                   f'{agg_fn}("{num_col}") AS "{num_col}" '
                   f'FROM {view} GROUP BY "{time_col}" ORDER BY "{time_col}"')
        else:
            # Raw time series with LIMIT
            sql = f'SELECT "{time_col}", "{num_col}" FROM {view} ORDER BY "{time_col}" LIMIT 1000'
        cols = [time_col, num_col]
        config = f'LINE_CHART(x: "{time_col}", y: ["{num_col}"])'
        rec = make_record("LINE_CHART", config, sql, cols)
        if len(eval_) < n_eval and len(train) >= n_train // 2:
            eval_.append(rec)
        elif len(train) < n_train:
            train.append(rec)
    return train, eval_


# ── Fix 3: BAR_CHART always with ORDER BY ───────────────────────────────────
# Reinforce that BAR always has ordered/topN — not cross. These anchor the
# `agg+ordered/topN+duo/wide` fingerprint and train away from cross→HEATMAP drift.

def gen_bar_ordered(n_train: int, n_eval: int):
    train, eval_ = [], []
    attempts = 0
    while (len(train) < n_train or len(eval_) < n_eval) and attempts < (n_train + n_eval) * 5:
        attempts += 1
        cat = random.choice(JFR_CAT_COLS + GENERIC_CAT)
        vals = random.sample(JFR_NUMERIC_COLS + GENERIC_NUMERIC, random.randint(1, 3))
        view = random.choice(JFR_VIEWS)
        agg_fn = random.choice(AGG_FNS)
        style = random.random()
        if style < 0.5:
            # topN: GROUP BY + ORDER BY + LIMIT
            limit = random.choice([5, 10, 15, 20])
            agg_exprs = [f'{agg_fn}("{v}") AS "{v}"' for v in vals]
            sql = (f'SELECT "{cat}", {", ".join(agg_exprs)} '
                   f'FROM {view} GROUP BY "{cat}" ORDER BY "{vals[0]}" DESC LIMIT {limit}')
        else:
            # sorted: GROUP BY + ORDER BY, no LIMIT
            agg_exprs = [f'{agg_fn}("{v}") AS "{v}"' for v in vals]
            sql = (f'SELECT "{cat}", {", ".join(agg_exprs)} '
                   f'FROM {view} GROUP BY "{cat}" ORDER BY "{vals[0]}" DESC')
        cols = [cat] + vals
        if len(vals) == 1:
            config = f'BAR_CHART(x: "{cat}", y: "{vals[0]}")'
        else:
            y_part = ', '.join(f'"{v}"' for v in vals)
            config = f'BAR_CHART(x: "{cat}", y: [{y_part}])'
        rec = make_record("BAR_CHART", config, sql, cols)
        if len(eval_) < n_eval and len(train) >= n_train // 2:
            eval_.append(rec)
        elif len(train) < n_train:
            train.append(rec)
    return train, eval_


# ── Fix 4: HEATMAP anchor ───────────────────────────────────────────────────
# More HEATMAP with `cross` to reinforce that cross+no-ORDER-BY = HEATMAP,
# complementing the BAR examples above.

def gen_heatmap_anchor(n_train: int, n_eval: int):
    train, eval_ = [], []
    attempts = 0
    while (len(train) < n_train or len(eval_) < n_eval) and attempts < (n_train + n_eval) * 5:
        attempts += 1
        x = random.choice(JFR_CAT_COLS + GENERIC_CAT)
        y = random.choice([c for c in JFR_CAT_COLS + GENERIC_CAT if c != x])
        val = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
        view = random.choice(JFR_VIEWS)
        agg_fn = random.choice(AGG_FNS)
        # Explicitly no ORDER BY — this is the `cross` fingerprint
        sql = f'SELECT "{x}", "{y}", {agg_fn}("{val}") AS "{val}" FROM {view} GROUP BY "{x}", "{y}"'
        cols = [x, y, val]
        config = f'HEATMAP(x: "{x}", y: "{y}", value: "{val}")'
        rec = make_record("HEATMAP", config, sql, cols)
        if len(eval_) < n_eval and len(train) >= n_train // 2:
            eval_.append(rec)
        elif len(train) < n_train:
            train.append(rec)
    return train, eval_


def main():
    data_dir = REPO_ROOT / 'data'
    src_train = data_dir / 'plot_pairs_v33.jsonl'
    src_eval  = data_dir / 'plot_eval_v33.jsonl'
    dst_train = data_dir / 'plot_pairs_v34.jsonl'
    dst_eval  = data_dir / 'plot_eval_v34.jsonl'

    existing_train = [json.loads(l) for l in src_train.read_text().splitlines() if l.strip()]
    existing_eval  = [json.loads(l) for l in src_eval.read_text().splitlines() if l.strip()]

    generators = [
        ("AREA_CHART (agg)",   gen_area_agg,      400, 40),
        ("LINE_CHART (duo)",   gen_line_duo,       200, 20),
        ("BAR_CHART (ordered)", gen_bar_ordered,   400, 40),
        ("HEATMAP (anchor)",   gen_heatmap_anchor, 200, 20),
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
    print(f"\nv34 distribution ({len(all_train)} train, {len(all_eval)} eval):")
    for t, c in sorted(dist.items()):
        print(f"  {t:<20} {c:5d}")

    print("\nDone. Next steps:")
    print("  Update run_training.sh DATA/EVAL to v34")
    print("  ./scripts/train/run_training.sh --skip-data --skip-autocomplete")
    print("  bash scripts/train/deploy_v5.sh")


if __name__ == '__main__':
    main()
