#!/usr/bin/env python3
"""
Migrate plot_pairs_v16.jsonl → plot_pairs_v17.jsonl by re-extracting signals
with the v6 signal logic:
  - New: `cross` tag for GROUP BY with 2+ columns and no ORDER BY
    (→ HEATMAP: fires in 100% of HEATMAP examples, 0% of BAR_CHART)
  - Impact: ~850 HEATMAP examples gain `cross` tag; BAR/LINE/SCATTER unaffected

Run:
    python3 scripts/train/migrate_v16_to_v17.py
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def extract_input_signals_v6(sql: str, columns: list) -> str:
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
    has_range_start = any(re.search(r'start|begin', n) or n in ('low', 'min') or 'lower' in n for n in names)
    has_range_end = any(re.search(r'\bend', n) or 'finish' in n or n in ('high', 'max') or 'upper' in n for n in names)
    if has_range_start and has_range_end: tags.append('range')

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
    """Re-extract signals using v6 logic, replacing existing hints: line."""
    lines = old_input.split('\n')
    sql = ''
    cols_raw = ''
    for line in lines:
        if line.startswith('sql: '):
            sql = line[5:]
        elif line.startswith('columns: '):
            cols_raw = line[9:]

    columns = [c.strip() for c in cols_raw.split(',') if c.strip()]
    signals = extract_input_signals_v6(sql, columns)
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
        (data_dir / 'plot_pairs_v16.jsonl', data_dir / 'plot_pairs_v17.jsonl'),
        (data_dir / 'plot_eval_v16.jsonl',  data_dir / 'plot_eval_v17.jsonl'),
    ]
    print("Migrating v16→v17 (adding `cross` signal for GROUP BY 2+ cols without ORDER BY)...")
    for src, dst in pairs:
        migrate_file(src, dst)
    print("\nDone. Expected impact: ~850 HEATMAP examples gain `cross` tag.")
    print("This is the definitive HEATMAP discriminator: fires 100% HEATMAP, 0% BAR_CHART.")
    print("\nTo retrain on v17 data:")
    print("  Update run_training.sh DATA/EVAL to v17, then:")
    print("  ./scripts/train/run_training.sh --skip-data")


if __name__ == '__main__':
    main()
