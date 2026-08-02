#!/usr/bin/env python3
"""
Migrate plot_pairs_v33.jsonl → plot_pairs_v36.jsonl

Signal fix (v15 → v16):
  - Time-named columns (matching time|timestamp|bucket|date|_at$|_ts$|_dt$) are now
    excluded from num/cat counting entirely when no explicit type is available.
  - Previously, a column like "cpu_time" would match both the cpu→numeric pattern
    AND the time-exclusion-from-cat check, resulting in phantom num:N inflation.
  - Fix: skip num/cat counting for time-named untyped columns.

This changes signals for ~LINE/AREA queries where time-bucket aliases have names
like "cpu_time", "gc_time" etc. — they were inflating num:N by 1, making duo+time
LINE queries appear as duo+num:2+cat:0 (indistinguishable from SCATTER).
After fix: duo+time+num:1+cat:0, clearly distinct from SCATTER (duo+num:2+cat:0).

Additionally injects:
  +300 LINE examples with duo+time+num:1 to reinforce LINE fingerprint post-fix.

Run:
    python3 scripts/train/migrate_v33_to_v36.py
Then:
    Update run_training.sh DATA/EVAL to v36
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

random.seed(20260802_36)

JFR_TIME_COLS = ["Time", "startTime", "endTime", "timestamp", "eventTime", "bucket",
                 "sampleTime", "gcTime", "allocTime", "cpu_time", "gc_time", "alloc_time"]
GENERIC_TIME = ["time", "ts", "date", "created_at", "updated_at"]
JFR_NUMERIC_COLS = ["duration", "pauseMs", "allocBytes", "heapUsed", "heapCapacity",
                    "cpuLoad", "gcCount", "threadCount", "samples", "count",
                    "allocRate", "throughput", "latency", "overhead", "weight"]
GENERIC_NUMERIC = ["value", "total", "avg", "sum", "max", "rate", "size", "ms", "pct"]
JFR_VIEWS = ["gc_pauses", "cpu_load", "alloc_in_new_tlab", "thread_cpu",
             "heap_summary", "gc_heap_summary", "object_allocation", "lock_contention",
             "method_profiling", "cpu_hot_methods", "allocation_sites", "jfr_events"]
AGG_FNS = ["AVG", "SUM", "MAX", "MIN"]


# ── Signal extraction v16 (time-name fix) ───────────────────────────────────

NUM_PAT = re.compile(
    r'(?:count|size|ms|mb|kb|rate|pct|load|pause|duration|alloc|heap|cpu|ticks|samples'
    r'|total|avg|max|overhead|throughput|latency|weight|score|p\d+|%$'
    r'|^young$|^old$|^meta$|^eden$|^survivor$)',
    re.I
)
TIME_NAME_PAT = re.compile(r'time|timestamp|bucket|date|_at$|_ts$|_dt$|^ts$|^dt$|^when$')


def extract_v16(sql: str, columns: list) -> str:
    """v16: time-named columns excluded from num/cat counting (fixes phantom num inflation)."""
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
                any(TIME_NAME_PAT.search(n) for n in names))
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
        # v16 fix: skip time-named columns from num/cat counting when untyped
        if TIME_NAME_PAT.search(n) and t == '':
            continue
        if t in NUM_TYPES_SET or (not t and NUM_PAT.search(n)):
            num_count += 1
        elif t in ('VARCHAR', 'TEXT', 'STRING') or (not t and not TIME_NAME_PAT.search(n)):
            cat_count += 1
    tags.append(f'num:{min(num_count, 4)}')
    tags.append(f'cat:{min(cat_count, 4)}')

    time_named = [n for n in names if TIME_NAME_PAT.search(n)]
    if not has_numeric_band and has_range_start and has_range_end and len(time_named) >= 2 and cat_count >= 1:
        tags.append('gantt_span')

    return ' '.join(tags)


def resign_record(rec: dict) -> dict:
    """Re-extract signals with v16 extractor."""
    inp = rec.get('input', '')
    sql_match = re.search(r'^sql:\s*(.+)$', inp, re.MULTILINE)
    cols_match = re.search(r'^columns:\s*(.+)$', inp, re.MULTILINE)
    if not sql_match or not cols_match:
        return rec
    sql = sql_match.group(1).strip()
    cols = [c.strip().strip('"') for c in cols_match.group(1).split(',')]
    new_hints = extract_v16(sql, cols)
    new_inp = re.sub(r'^hints:.*$', f'hints: {new_hints}', inp, flags=re.MULTILINE)
    return {**rec, 'input': new_inp}


def make_record(plot_type: str, config: str, sql: str, cols: list) -> dict:
    hints = extract_v16(sql, cols)
    return {
        "input": f"hints: {hints}\nsql: {sql}\ncolumns: {', '.join(cols)}",
        "output": config,
        "plot_type": plot_type,
        "source": "v36_fix",
    }


# ── Injection: LINE with duo+time+num:1 ────────────────────────────────────
# After the v16 fix, time-named cols no longer inflate num count.
# Add LINE examples to reinforce the corrected duo+time+num:1 fingerprint.

def gen_line_duo_time(n_train: int, n_eval: int):
    train, eval_ = [], []
    attempts = 0
    while (len(train) < n_train or len(eval_) < n_eval) and attempts < (n_train + n_eval) * 5:
        attempts += 1
        time_col = random.choice(JFR_TIME_COLS + GENERIC_TIME)
        num_col = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
        view = random.choice(JFR_VIEWS)
        style = random.random()
        if style < 0.35:
            sql = f'SELECT "{time_col}", "{num_col}" FROM {view} ORDER BY "{time_col}"'
        elif style < 0.7:
            bucket = random.choice([100, 500, 1000])
            agg = random.choice(AGG_FNS)
            sql = (f'SELECT time_bucket("{time_col}", {bucket}) AS "{time_col}", '
                   f'{agg}("{num_col}") AS "{num_col}" '
                   f'FROM {view} GROUP BY "{time_col}" ORDER BY "{time_col}"')
        else:
            sql = f'SELECT "{time_col}", "{num_col}" FROM {view} ORDER BY "{time_col}" LIMIT 1000'
        cols = [time_col, num_col]
        config = f'LINE_CHART(x: "{time_col}", y: ["{num_col}"])'
        rec = make_record("LINE_CHART", config, sql, cols)
        if len(eval_) < n_eval and len(train) >= n_train // 2:
            eval_.append(rec)
        elif len(train) < n_train:
            train.append(rec)
    return train, eval_


def main():
    data_dir = REPO_ROOT / 'data'
    src_train = data_dir / 'plot_pairs_v33.jsonl'
    src_eval  = data_dir / 'plot_eval_v33.jsonl'
    dst_train = data_dir / 'plot_pairs_v36.jsonl'
    dst_eval  = data_dir / 'plot_eval_v36.jsonl'

    print("Re-signaling v33 data with v16 extractor (time-name fix)...")
    existing_train = [resign_record(json.loads(l)) for l in src_train.read_text().splitlines() if l.strip()]
    existing_eval  = [resign_record(json.loads(l)) for l in src_eval.read_text().splitlines() if l.strip()]
    print(f"  Re-signaled {len(existing_train)} train, {len(existing_eval)} eval records")

    print("Injecting LINE duo+time examples...")
    line_train, line_eval = gen_line_duo_time(300, 30)
    print(f"  LINE (duo+time): +{len(line_train)} train, +{len(line_eval)} eval")

    all_train = existing_train + line_train
    all_eval  = existing_eval + line_eval
    random.shuffle(all_train)

    dst_train.write_text('\n'.join(json.dumps(r) for r in all_train) + '\n')
    dst_eval.write_text('\n'.join(json.dumps(r) for r in all_eval) + '\n')

    dist = Counter(r['plot_type'] for r in all_train)
    print(f"\nv36 distribution ({len(all_train)} train, {len(all_eval)} eval):")
    for t, c in sorted(dist.items()):
        print(f"  {t:<20} {c:5d}")

    # Show how many records changed signals
    orig = [json.loads(l) for l in src_train.read_text().splitlines() if l.strip()]
    changed = sum(1 for o, r in zip(orig, existing_train) if o['input'] != r['input'])
    print(f"\nRecords with changed signals: {changed}/{len(orig)}")

    print("\nDone. Next steps:")
    print("  Update run_training.sh DATA/EVAL to v36")
    print("  ./scripts/train/run_training.sh --skip-data --skip-autocomplete")
    print("  bash scripts/train/deploy_v5.sh")


if __name__ == '__main__':
    main()
