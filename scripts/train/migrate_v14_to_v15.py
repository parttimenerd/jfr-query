#!/usr/bin/env python3
"""
Migrate plot_pairs_v14.jsonl → plot_pairs_v15.jsonl by re-extracting signals
with the improved v4 signal logic:
  - Time: also catches _at, _ts, _dt suffixes, bare ts/dt/when
  - Cat count: excludes _at/_ts/_dt columns from categorical count

This produces better-calibrated hints: tags, especially for LINE_CHART cases
where time columns had generic names like created_at, log_ts, event_ts.

Run:
    python3 scripts/train/migrate_v14_to_v15.py
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def extract_input_signals_v4(sql: str, columns: list) -> str:
    sql_up = sql.upper()
    names = [c.lower() for c in columns]
    all_names = ' '.join(names)

    tags = []

    if re.search(r'\bGROUP\s+BY\b', sql_up): tags.append('agg')
    if re.search(r'\bORDER\s+BY\b', sql_up) and re.search(r'\bLIMIT\b', sql_up): tags.append('ordered')
    if re.search(r'\bHAVING\b', sql_up): tags.append('having')

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
    """Re-extract signals using v4 logic, replacing existing hints: line."""
    lines = old_input.split('\n')
    sql = ''
    cols_raw = ''
    for line in lines:
        if line.startswith('sql: '):
            sql = line[5:]
        elif line.startswith('columns: '):
            cols_raw = line[9:]

    columns = [c.strip() for c in cols_raw.split(',') if c.strip()]
    signals = extract_input_signals_v4(sql, columns)
    new_hints = f"hints: {signals}"

    # Replace existing hints: line if present, else prepend
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
        (data_dir / 'plot_pairs_v14.jsonl', data_dir / 'plot_pairs_v15.jsonl'),
        (data_dir / 'plot_eval_v14.jsonl',  data_dir / 'plot_eval_v15.jsonl'),
    ]
    print("Migrating v14→v15 (improved time/cat signal extraction)...")
    for src, dst in pairs:
        migrate_file(src, dst)
    print("\nDone. To retrain on v15 data:")
    print("  ./scripts/train/run_training.sh --skip-data")
    print("  (update DATA/EVAL variables in run_training.sh to v15 first)")


if __name__ == '__main__':
    main()
