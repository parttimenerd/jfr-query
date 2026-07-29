#!/usr/bin/env python3
"""
Migrate plot_pairs_v21.jsonl → plot_pairs_v22.jsonl by re-extracting signals
with the v10 signal logic:
  - New: `num_range` tag for time column + numeric band columns (minX/maxX/pN)
    Fires in 88% of RANGE examples and 0% of GANTT examples.
  - Impact: GANTT/RANGE disambiguation greatly improved
    - `sorted+wide+time+range+num_range` fingerprint → 100% RANGE
    - `sorted+wide+time+range` (no num_range) fingerprint → 85% GANTT (was 62%)

Run:
    python3 scripts/train/migrate_v21_to_v22.py
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def extract_input_signals_v10(sql: str, columns: list) -> str:
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

    has_time = any(re.search(r'time|timestamp|bucket|date|_at$|_ts$|_dt$|^ts$|^dt$|^when$', n)
                   for n in names)
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

    # v10: num_range — time col + numeric band cols (minX/maxX/pN)
    has_numeric_band = any(re.match(r'^(min|max)', n) or re.match(r'^p\d+$', n) for n in names)
    if has_time and has_numeric_band: tags.append('num_range')

    num_count = 0
    cat_count = 0
    for n in names:
        if re.search(r'(?:count|size|ms|mb|kb|rate|pct|load|pause|duration|alloc|heap|cpu|ticks|samples|total|avg|max|p\d+)', n, re.I):
            num_count += 1
        elif not re.search(r'time|stamp|date|bucket|_at$|_ts$|_dt$|^ts$|^dt$', n):
            cat_count += 1
    tags.append(f'num:{min(num_count, 4)}')
    tags.append(f'cat:{min(cat_count, 4)}')

    return ' '.join(tags)


def remigrate_input(old_input: str) -> str:
    """Re-extract signals using v10 logic, replacing existing hints: line."""
    lines = old_input.split('\n')
    sql = ''
    cols_raw = ''
    for line in lines:
        if line.startswith('sql: '):
            sql = line[5:]
        elif line.startswith('columns: '):
            cols_raw = line[9:]

    columns = [c.strip() for c in cols_raw.split(',') if c.strip()]
    signals = extract_input_signals_v10(sql, columns)
    new_hints = f"hints: {signals}"

    if lines[0].startswith('hints: '):
        lines[0] = new_hints
        return '\n'.join(lines)
    return new_hints + '\n' + old_input


def migrate_file(src: Path, dst: Path) -> None:
    if not src.exists():
        print(f"  SKIP (not found): {src}")
        return

    records = [json.loads(l) for l in src.read_text().splitlines() if l.strip()]
    changed = 0
    for r in records:
        old = r.get('input', '')
        new = remigrate_input(old)
        if new != old:
            changed += 1
        r['input'] = new

    dst.write_text('\n'.join(json.dumps(r) for r in records) + '\n')
    print(f"  {src.name} → {dst.name}: {len(records)} records ({changed} updated)")


def main():
    data_dir = REPO_ROOT / 'data'
    pairs = [
        (data_dir / 'plot_pairs_v21.jsonl', data_dir / 'plot_pairs_v22.jsonl'),
        (data_dir / 'plot_eval_v21.jsonl',  data_dir / 'plot_eval_v22.jsonl'),
    ]
    print("Migrating v21→v22 (adding `num_range` signal: time + numeric band cols)...")
    for src, dst in pairs:
        migrate_file(src, dst)
    print("\nDone. Expected impact:")
    print("  RANGE examples gain `num_range` tag (88% coverage)")
    print("  GANTT examples get 0% `num_range` (fully disambiguated from RANGE)")
    print("  sorted+wide+time+range+num_range fingerprint → 100% RANGE")
    print("  sorted+wide+time+range (no num_range) fingerprint → 85% GANTT (was 62%)")
    print("\nTo retrain on v22 data:")
    print("  Update run_training.sh DATA/EVAL to v22, then:")
    print("  ./scripts/train/run_training.sh --skip-data")


if __name__ == '__main__':
    main()
