#!/usr/bin/env python3
"""
Migrate plot_pairs_v13.jsonl → plot_pairs_v14.jsonl by adding the v3 input
format: inject a "hints: ..." line before "sql: ..." in each input.

Also migrates plot_eval.jsonl → plot_eval_v14.jsonl.

Run:
    python3 scripts/train/migrate_v13_to_v14.py
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


# ── Signal extraction (mirrors candidates.ts extractInputSignals) ──────────────

def extract_input_signals(sql: str, columns: list) -> str:
    sql_up = sql.upper()
    names = [c.lower() for c in columns]
    all_names = ' '.join(names)

    tags = []

    if re.search(r'\bGROUP\s+BY\b', sql_up): tags.append('agg')
    has_order_by = bool(re.search(r'\bORDER\s+BY\b', sql_up))
    has_limit = bool(re.search(r'\bLIMIT\b', sql_up))
    if has_order_by and has_limit: tags.append('ordered')
    elif has_order_by: tags.append('sorted')

    gb_match = re.search(r'\bGROUP\s+BY\b(.+?)(?:\bHAVING\b|\bORDER\b|\bLIMIT\b|$)', sql, re.I | re.S)
    if gb_match and not has_order_by and ',' in gb_match.group(1): tags.append('cross')

    has_group_by = bool(re.search(r'\bGROUP\s+BY\b', sql_up))
    has_aggr_fn = bool(re.search(r'\b(?:COUNT|SUM|AVG|MIN|MAX)\s*\(', sql_up))
    if not has_group_by and not has_aggr_fn and not has_order_by and has_limit: tags.append('raw')
    if has_aggr_fn and not has_group_by: tags.append('scalar')

    if re.search(r'\bHAVING\b', sql_up): tags.append('having')

    if len(columns) == 1: tags.append('solo')
    if len(columns) == 2: tags.append('duo')
    if len(columns) >= 3: tags.append('wide')

    has_time = any(re.search(r'time|timestamp|bucket|date|_at$|_ts$|_dt$|^ts$|^dt$|^when$', n) for n in names)
    if has_time: tags.append('time')

    has_stack = any(re.search(r'stack|frame|trace', n) for n in names)
    if has_stack: tags.append('stack')

    if (re.search(r'gc|pause|heap|reclai|young|old|survivor|tenur', all_names) or
            re.search(r'GC|Garbage|GARBAGE|HEAP|Heap', sql)):
        tags.append('gc')
    if re.search(r'alloc|tlab|retained|live|object|class', all_names): tags.append('alloc')
    if re.search(r'cpu|thread|method|jvm|machine|load|worker', all_names): tags.append('cpu')
    if re.search(r'delta|change|diff|decrement|increment', all_names): tags.append('delta')
    has_range_start = any(
        re.search(r'start|begin|lower', n) or n in ('low',) or
        re.search(r'^min', n) or
        re.match(r'^p([0-9]|[1-4]\d)$', n)
        for n in names)
    has_range_end = any(
        re.search(r'\bend|finish|upper', n) or n in ('high',) or
        re.search(r'^max', n) or
        re.match(r'^p([5-9]\d|100)$', n) or n in ('p95', 'p99')
        for n in names)
    if has_range_start and has_range_end: tags.append('range')

    # Without type info, infer from name patterns
    num_count = 0
    cat_count = 0
    for n in names:
        if re.search(r'(?:count|size|ms|mb|kb|rate|pct|load|pause|duration|alloc|heap|cpu|ticks|samples|total|avg|max|p\d+)', n, re.I):
            num_count += 1
        elif not re.search(r'time|stamp|date|bucket|_at$|_ts$|_dt$', n):
            cat_count += 1
    tags.append(f'num:{min(num_count, 4)}')
    tags.append(f'cat:{min(cat_count, 4)}')

    return ' '.join(tags)


def migrate_input(old_input: str) -> str:
    """
    Transforms:
        sql: SELECT ...\ncolumns: col1, col2
    to:
        hints: agg time ...\nsql: SELECT ...\ncolumns: col1, col2

    Idempotent: if a hints: line already exists, return unchanged.
    """
    if old_input.startswith('hints:'):
        return old_input  # already v3

    lines = old_input.split('\n')
    sql = ''
    cols_raw = ''
    for line in lines:
        if line.startswith('sql: '):
            sql = line[5:]
        elif line.startswith('columns: '):
            cols_raw = line[9:]

    columns = [c.strip() for c in cols_raw.split(',') if c.strip()]
    signals = extract_input_signals(sql, columns)
    return f"hints: {signals}\n{old_input}"


def migrate_file(src: Path, dst: Path) -> None:
    if not src.exists():
        print(f"  SKIP (not found): {src}")
        return

    lines = src.read_text().splitlines()
    records = [json.loads(l) for l in lines if l.strip()]
    migrated = []
    already_v3 = 0
    for r in records:
        old = r.get('input', '')
        new = migrate_input(old)
        if new == old:
            already_v3 += 1
        r['input'] = new
        migrated.append(r)

    dst.write_text('\n'.join(json.dumps(r) for r in migrated) + '\n')
    print(f"  {src.name} → {dst.name}: {len(migrated)} records "
          f"({already_v3} already v3, {len(migrated) - already_v3} migrated)")


def main():
    data_dir = REPO_ROOT / 'data'
    pairs = [
        (data_dir / 'plot_pairs_v13.jsonl', data_dir / 'plot_pairs_v14.jsonl'),
        (data_dir / 'plot_eval.jsonl',       data_dir / 'plot_eval_v14.jsonl'),
    ]
    print(f"Migrating v13→v14 input format (adding hints: tag line)...")
    for src, dst in pairs:
        migrate_file(src, dst)

    print("\nDone. To retrain:")
    print("  ./scripts/train/run_training.sh --skip-data")


if __name__ == '__main__':
    main()
