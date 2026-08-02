#!/usr/bin/env python3
"""
Generate (sql, columns) → plot_config training pairs using Claude Haiku.
Expanded: ~5300 pairs covering all 13 plot types with advanced DSL features.

Usage:
    export ANTHROPIC_API_KEY=...
    python scripts/train/gen_plot_pairs.py --output data/plot_pairs.jsonl --eval data/plot_eval.jsonl
"""

import anthropic
import json
import random
import argparse
import sys
import re
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

client = anthropic.Anthropic()
MODEL = "claude-haiku-4-5-20251001"

# ── DSL docs ───────────────────────────────────────────────────────────────────

PLOT_DOCS = """
Available plot functions (output EXACTLY one of these):

LINE_CHART(x: "col", y: ["col1", "col2"], y2: ["col3"],
           yScale: "linear"|"log", y2Scale: "linear"|"log",
           yAxisLabel: "...", y2AxisLabel: "...",
           lineType: "line"|"dots", connectNulls: true|false,
           yRefLines: [{value: N, label: "..."}])
  Required: x, y (array). Use for: time-series, trends over time.

BAR_CHART(x: "col", y: ["col1"], lineY: ["col2"],
          layout: "grouped"|"stacked", horizontal: true|false,
          yAxisLabel: "...", logScale: true|false)
  Required: x, y (array). Use for: categorical comparisons, ranked lists.

PIE_CHART(name: "col", value: "col")
  Required: name (category), value (numeric). Use for: proportions by category.

SCATTER_PLOT(x: "col", y: "col", size: "col", category: "col")
  Required: x, y (both numeric). Use for: correlation between two numeric values.

HISTOGRAM(value: "col", bins: N, logBins: true|false)
  Required: value (numeric). Use for: distribution of a single numeric column.

HEATMAP(x: "col", y: "col", value: "col")
  Required: x, y (categories), value (numeric intensity). Use for: 2D grids.

BOX_PLOT(value: "col", category: "col")
  Required: value (numeric). Optional: category. Use for: statistical distribution.

FLAMEGRAPH(label: "col", value: "col")
  Required: label (semicolon-separated stack frames), value (numeric weight).
  Use for: CPU profiling, allocation profiling.

TABLE(headers: ["col1", "col2"], columnWidths: ["50%", 100, -1])
  No required params. Use for: raw tabular data, mixed/wide columns.

WATERFALL(category: "col", value: "col")
  Required: category (step name), value (delta/change numeric).
  Use for: showing incremental changes that sum to a total (GC phase durations, heap deltas).

TREEMAP(label: "col", value: "col")
  Required: label (category), value (size/weight numeric).
  Use for: proportional area by aggregated count or size.

AREA_CHART(x: "col", y: ["col1", "col2"], layout: "stacked"|"overlay")
  Required: x, y (array). Use for: time-series with filled area, stacked proportions over time.
  Prefer over LINE_CHART when showing cumulative stacked values.

GANTT(start: "col", end: "col", lane: "col", color: "col", task: "col")
  Required: start, end (time/numeric), lane (category string).
  Use for: event timelines, phase breakdowns, concurrent activity.

RANGE(x: "col", low: "col", high: "col", center: "col")
  Required: x, low, high. Use for: confidence intervals, min/max bands, percentile ranges.

VIOLIN_PLOT(value: "col", category: "col", bins: N)
  Required: value (numeric). Optional: category (for grouped violins), bins (default 20).
  Use for: showing distribution shape (KDE) of a numeric column, especially across categories.

SUNBURST(path: ["col1", "col2"], value: "col", delimiter: "/")
  Required: path (one or more hierarchy columns, or single delimited column), value (numeric weight).
  Use for: hierarchical proportions (package → class, folder tree, call paths).

SANKEY(source: "col", target: "col", value: "col")
  Required: source (from-node), target (to-node), value (numeric flow weight).
  Use for: flow diagrams — how values pass from sources through targets (call graphs, memory flow).

CROSSTAB(row: "col", col: "col", value: "col", agg: "SUM"|"AVG"|"COUNT"|"MAX"|"MIN")
  Required: row (row category), col (column category), value (numeric).
  Optional: agg (aggregation function, default SUM).
  Use for: pivot tables — cross-tabulation of two categorical dimensions with a numeric metric.

Optional suffix: TITLE "..." or LINK_X($start, $end)

Rules:
- Column names MUST be double-quoted: "Time", "Pause ms"
- y in LINE_CHART and BAR_CHART is ALWAYS an array: y: ["col"]
- name in PIE_CHART (not x)
- Output ONLY the plot config string. No explanation, no backticks.
"""

# ── JFR column pools ───────────────────────────────────────────────────────────

JFR_TIME_COLS = ["startTime", "endTime", "time", "Time", "Bucket", "Timestamp", "bucket",
                 "timestamp", "eventTime", "sampleTime"]
JFR_NUMERIC_COLS = [
    "Used MB", "Heap MB", "Committed MB", "Reserved MB", "usedHeap", "committedHeap",
    "Pause ms", "Duration ms", "duration", "pauseDuration", "pauseMs", "gcDuration",
    "Samples", "Count", "count", "events", "Events",
    "Rate MB/s", "allocationRate", "allocationRateMB", "throughput",
    "GC Overhead %", "gcOverhead", "CPU %", "cpuLoad", "jvmUser", "jvmSystem",
    "machineTotal", "cpuJvmUser", "cpuMachineTotal",
    "Alloc KB", "allocKB", "allocatedBytes", "reclaimedBytes",
    "Total ms", "Avg ms", "Max ms", "p99 ms", "p50 ms", "p99pauseMs", "p50pauseMs",
    "GC ms", "Throughput %", "Size MB", "youngGenSize", "oldGenSize",
    "executionTime", "wallTime", "cpuTime", "contentionTime",
    "retainedSize", "liveObjects",
    "youngGCPause", "oldGCPause",
]
JFR_CAT_COLS = [
    "GC Type", "gcType", "Phase", "phase", "Class", "objectClass", "className",
    "Cause", "cause", "gcCause", "Collector", "collector", "Thread", "thread", "threadName",
    "Method", "methodName", "State", "threadState", "Name", "name",
    "gcId", "GC ID", "eventType", "lockClass", "monitorClass", "vmOperation",
]
JFR_STACK_COLS = ["stackTrace", "stackFrames", "stack", "frames"]
JFR_VIEWS = [
    "gc_pauses", "gc_heap_summary", "gc_phases", "heap_usage", "object_allocation",
    "cpu_load", "cpu_hot_methods", "thread_states", "lock_contention",
    "GarbageCollections", "GCHeapSummary", "CPULoad", "ObjectAllocationInNewTLAB",
]
GENERIC_NUMERIC = ["value", "count", "amount", "size", "weight", "score", "pct", "rate",
                   "duration", "latency", "throughput", "total", "avg", "max", "p50", "p99"]
GENERIC_CAT = ["category", "label", "type", "group", "name", "key", "tag", "phase"]
GENERIC_TIME = ["time", "timestamp", "bucket", "window"]

# ── Input generators ──────────────────────────────────────────────────────────

def make_line_inputs():
    time = random.choice(JFR_TIME_COLS + GENERIC_TIME)
    nums = random.sample(JFR_NUMERIC_COLS + GENERIC_NUMERIC, random.randint(1, 3))
    view = random.choice(JFR_VIEWS)
    style = random.random()
    if style < 0.35:
        # GROUP BY bucket (canonical JFR time-series pattern) → agg+sorted
        agg = random.choice(["avg", "sum", "max", "min"])
        interval = random.choice([500, 1000, 5000, 10000])
        agg_cols = [f'{agg}("{n}") AS "{n}"' for n in nums]
        sql = (f'SELECT time_bucket("{time}", {interval}) AS "Time", {", ".join(agg_cols)} '
               f'FROM {view} GROUP BY "Time" ORDER BY "Time"')
        cols = ["Time"] + nums
    elif style < 0.7:
        # time_bucket without explicit GROUP BY (also common)
        sql = f'SELECT time_bucket("{time}", {random.choice([500,1000,5000])}) AS "Time", {", ".join(chr(34)+c+chr(34) for c in nums)} FROM {view} ORDER BY "Time"'
        cols = ["Time"] + nums
    else:
        # Raw time column
        sql = f'SELECT "{time}", {", ".join(chr(34)+c+chr(34) for c in nums)} FROM {view} ORDER BY "{time}"'
        cols = [time] + nums
    return sql, cols

def make_bar_inputs():
    cat = random.choice(JFR_CAT_COLS + GENERIC_CAT)
    vals = random.sample(JFR_NUMERIC_COLS + GENERIC_NUMERIC, random.randint(1, 3))
    view = random.choice(JFR_VIEWS)
    sql = f'SELECT "{cat}", {", ".join(chr(34)+v+chr(34) for v in vals)} FROM {view} GROUP BY "{cat}" ORDER BY "{vals[0]}" DESC'
    if random.random() < 0.4:
        sql += ' LIMIT 10'
    return sql, [cat] + vals

def make_histogram_inputs():
    col = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
    view = random.choice(JFR_VIEWS)
    sql = f'SELECT "{col}" FROM {view}'
    return sql, [col]

def make_scatter_inputs():
    x, y = random.sample(JFR_NUMERIC_COLS + GENERIC_NUMERIC, 2)
    view = random.choice(JFR_VIEWS)
    extras = []
    cols = [x, y]
    if random.random() < 0.25:
        s = random.choice(JFR_NUMERIC_COLS)
        cols.append(s)
        extras.append(f'"{s}"')
    sql = f'SELECT "{x}", "{y}"{", " + ", ".join(extras) if extras else ""} FROM {view}'
    return sql, cols

def make_pie_inputs():
    cat = random.choice(JFR_CAT_COLS + GENERIC_CAT)
    view = random.choice(JFR_VIEWS)
    style = random.random()
    if style < 0.5:
        # COUNT(*) with GROUP BY — canonical PIE (cnt_agg signal) — no ORDER BY
        col_name = random.choice(["count", "Count", "n", "num", "events", "cnt"])
        sql = f'SELECT "{cat}", COUNT(*) AS "{col_name}" FROM {view} GROUP BY "{cat}"'
        return sql, [cat, col_name]
    elif style < 0.75:
        # SUM agg without ORDER BY
        val = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
        sql = f'SELECT "{cat}", SUM("{val}") AS "{val}" FROM {view} GROUP BY "{cat}"'
        return sql, [cat, val]
    else:
        # With ORDER BY (also valid for PIE)
        val = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
        sql = f'SELECT "{cat}", "{val}" FROM {view} GROUP BY "{cat}" ORDER BY "{val}" DESC LIMIT 8'
        return sql, [cat, val]

def make_heatmap_inputs():
    x = random.choice(JFR_CAT_COLS + GENERIC_CAT)
    y = random.choice([c for c in JFR_CAT_COLS + GENERIC_CAT if c != x])
    val = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
    view = random.choice(JFR_VIEWS)
    sql = f'SELECT "{x}", "{y}", "{val}" FROM {view} GROUP BY "{x}", "{y}"'
    return sql, [x, y, val]

def make_boxplot_inputs():
    val = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
    view = random.choice(JFR_VIEWS)
    if random.random() < 0.6:
        cat = random.choice(JFR_CAT_COLS + GENERIC_CAT)
        sql = f'SELECT "{val}", "{cat}" FROM {view}'
        return sql, [val, cat]
    sql = f'SELECT "{val}" FROM {view}'
    return sql, [val]

def make_flamegraph_inputs():
    label = random.choice(JFR_STACK_COLS)
    val = random.choice(["count", "samples", "Samples", "Count", "weight"])
    view = random.choice(["cpu_hot_methods", "allocation_sites", "thread_cpu", "lock_contention"])
    sql = f'SELECT "{label}", "{val}" FROM {view}'
    return sql, [label, val]

def make_table_inputs():
    style = random.choice(["mixed", "cat", "num", "single", "wide"])
    if style == "single":
        col = random.choice(["count", "Count", "Events"])
        return f'SELECT COUNT(*) AS "{col}" FROM {random.choice(JFR_VIEWS)}', [col]
    elif style == "cat":
        cols = random.sample(JFR_CAT_COLS, random.randint(2, 4))
    elif style == "num":
        cols = random.sample(JFR_NUMERIC_COLS, random.randint(3, 5))
    elif style == "wide":
        cols = random.sample(JFR_CAT_COLS, 2) + random.sample(JFR_NUMERIC_COLS, random.randint(2, 4))
    else:
        cols = random.sample(JFR_CAT_COLS, 1) + random.sample(JFR_NUMERIC_COLS, random.randint(1, 3))
    sql = f'SELECT {", ".join(chr(34)+c+chr(34) for c in cols)} FROM {random.choice(JFR_VIEWS)} LIMIT 20'
    return sql, cols

def make_waterfall_inputs():
    delta_cols = ["delta", "change", "diff", "increment", "decrement",
                  "gcDelta", "heapDelta", "memDelta", "sizeDelta", "durationDelta"]
    step_cols = ["step", "phase", "cause", "name", "label", "stage"]
    step = random.choice(step_cols)
    delta = random.choice(delta_cols)
    view = random.choice(JFR_VIEWS)
    sql = f'SELECT "{step}", "{delta}" FROM {view} ORDER BY "{step}"'
    return sql, [step, delta]

def make_treemap_inputs():
    cat = random.choice(JFR_CAT_COLS + GENERIC_CAT)
    val = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
    view = random.choice(JFR_VIEWS)
    if random.random() < 0.5:
        # With ORDER BY: top-N breakdown (also generated by BAR, so ~50% each)
        sql = f'SELECT "{cat}", "{val}" FROM {view} GROUP BY "{cat}" ORDER BY "{val}" DESC LIMIT 20'
    else:
        # Without ORDER BY: full hierarchy (unique to TREEMAP, not BAR)
        sql = f'SELECT "{cat}", SUM("{val}") as "{val}" FROM {view} GROUP BY "{cat}"'
    return sql, [cat, val]

def make_area_chart_inputs():
    time = random.choice(JFR_TIME_COLS + GENERIC_TIME)
    nums = random.sample(JFR_NUMERIC_COLS + GENERIC_NUMERIC, random.randint(2, 4))
    view = random.choice(JFR_VIEWS)
    sql = f'SELECT "{time}", {", ".join(chr(34)+c+chr(34) for c in nums)} FROM {view} ORDER BY "{time}"'
    cols = [time] + nums
    return sql, cols

def make_gantt_inputs():
    start = random.choice(["startTime", "start", "begin", "startMs", "Start"])
    end = random.choice(["endTime", "end", "finish", "endMs", "End", "stopTime"])
    lane = random.choice(JFR_CAT_COLS + GENERIC_CAT)
    view = random.choice(JFR_VIEWS)
    cols = [start, end, lane]
    if random.random() < 0.4:
        task = random.choice(["name", "label", "description", "vmOperation", "phase"])
        cols.append(task)
    sql = f'SELECT {", ".join(chr(34)+c+chr(34) for c in cols)} FROM {view} ORDER BY "{start}"'
    return sql, cols

def make_range_inputs():
    x = random.choice(JFR_TIME_COLS + GENERIC_TIME)
    low = random.choice(["low", "min", "p5", "p10", "lowerBound", "minPause", "minDuration"])
    high = random.choice(["high", "max", "p95", "p99", "upperBound", "maxPause", "maxDuration"])
    view = random.choice(JFR_VIEWS)
    cols = [x, low, high]
    if random.random() < 0.5:
        center = random.choice(["avg", "median", "p50", "mean", "center"])
        cols.append(center)
    sql = f'SELECT {", ".join(chr(34)+c+chr(34) for c in cols)} FROM {view} ORDER BY "{x}"'
    return sql, cols

def make_violin_inputs():
    val = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
    view = random.choice(JFR_VIEWS)
    if random.random() < 0.5:
        cat = random.choice(JFR_CAT_COLS + GENERIC_CAT)
        sql = f'SELECT "{val}", "{cat}" FROM {view} LIMIT 10000'
        return sql, [val, cat]
    sql = f'SELECT "{val}" FROM {view} LIMIT 10000'
    return sql, [val]

def make_sunburst_inputs():
    view = random.choice(JFR_VIEWS)
    val = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
    style = random.random()
    if style < 0.4:
        # Two-level hierarchy
        p1, p2 = random.sample(JFR_CAT_COLS, 2)
        sql = f'SELECT "{p1}", "{p2}", sum("{val}") AS "{val}" FROM {view} GROUP BY "{p1}", "{p2}"'
        return sql, [p1, p2, val]
    elif style < 0.7:
        # Single path column (slash-delimited)
        path_col = random.choice(["callPath", "packagePath", "className", "methodPath", "stackPath"])
        sql = f'SELECT "{path_col}", sum("{val}") AS "{val}" FROM {view} GROUP BY "{path_col}"'
        return sql, [path_col, val]
    else:
        # Three-level hierarchy
        p1, p2, p3 = random.sample(JFR_CAT_COLS, 3)
        sql = f'SELECT "{p1}", "{p2}", "{p3}", sum("{val}") AS "{val}" FROM {view} GROUP BY "{p1}", "{p2}", "{p3}"'
        return sql, [p1, p2, p3, val]

def make_sankey_inputs():
    view = random.choice(JFR_VIEWS)
    val = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
    source_cols = ["caller", "source", "from_method", "thread", "package", "sourceClass"]
    target_cols = ["callee", "target", "to_method", "lock", "sink", "targetClass"]
    src = random.choice(source_cols)
    tgt = random.choice(target_cols)
    sql = f'SELECT "{src}", "{tgt}", sum("{val}") AS "{val}" FROM {view} GROUP BY "{src}", "{tgt}" ORDER BY "{val}" DESC LIMIT 50'
    return sql, [src, tgt, val]

def make_crosstab_inputs():
    view = random.choice(JFR_VIEWS)
    row = random.choice(JFR_CAT_COLS + GENERIC_CAT)
    col = random.choice([c for c in JFR_CAT_COLS + GENERIC_CAT if c != row])
    val = random.choice(JFR_NUMERIC_COLS + GENERIC_NUMERIC)
    agg = random.choice(["SUM", "AVG", "COUNT", "MAX", "MIN"])
    sql = f'SELECT "{row}", "{col}", {agg}("{val}") AS "{val}" FROM {view} GROUP BY "{row}", "{col}"'
    return sql, [row, col, val]

GENERATORS = [
    ("LINE_CHART",   make_line_inputs,       700),
    ("BAR_CHART",    make_bar_inputs,        700),
    ("HISTOGRAM",    make_histogram_inputs,  450),
    ("SCATTER_PLOT", make_scatter_inputs,    400),
    ("PIE_CHART",    make_pie_inputs,        400),
    ("HEATMAP",      make_heatmap_inputs,    350),
    ("BOX_PLOT",     make_boxplot_inputs,    350),
    ("FLAMEGRAPH",   make_flamegraph_inputs, 300),
    ("TABLE",        make_table_inputs,      350),
    ("WATERFALL",    make_waterfall_inputs,  200),
    ("TREEMAP",      make_treemap_inputs,    200),
    ("AREA_CHART",   make_area_chart_inputs, 200),
    ("GANTT",        make_gantt_inputs,      150),
    ("RANGE",        make_range_inputs,      150),
    ("VIOLIN_PLOT",  make_violin_inputs,     150),
    ("SUNBURST",     make_sunburst_inputs,   150),
    ("SANKEY",       make_sankey_inputs,     150),
    ("CROSSTAB",     make_crosstab_inputs,   150),
]

# ── Haiku calls ────────────────────────────────────────────────────────────────

def generate_pair(sql: str, columns: list) -> str | None:
    prompt = (
        f"Given this SQL query:\n```sql\n{sql}\n```\n"
        f"and these result columns: {json.dumps(columns)}\n\n"
        f"{PLOT_DOCS}\n"
        "Output ONLY the plot config string."
    )
    for attempt in range(3):
        try:
            msg = client.messages.create(
                model=MODEL, max_tokens=120,
                messages=[{"role": "user", "content": prompt}],
            )
            return msg.content[0].text.strip() if msg.content else None
        except anthropic.RateLimitError:
            time.sleep(2 ** attempt)
        except Exception:
            return None
    return None


def judge_pair(sql: str, columns: list, plot_config: str) -> bool:
    prompt = (
        f"SQL: {sql}\nColumns: {json.dumps(columns)}\nPlot config: {plot_config}\n\n"
        "Is this plot config syntactically valid (correct function name, quoted column names, "
        "y is an array for LINE_CHART/BAR_CHART) and a sensible visualization for these columns? "
        "Answer YES or NO on the first line."
    )
    for attempt in range(3):
        try:
            msg = client.messages.create(
                model=MODEL, max_tokens=60,
                messages=[{"role": "user", "content": prompt}],
            )
            return (msg.content[0].text or "").strip().upper().startswith("YES")
        except anthropic.RateLimitError:
            time.sleep(2 ** attempt)
        except Exception:
            return False
    return False


def extract_plot_type(config: str) -> str:
    m = re.match(r"([A-Z_]+)\s*\(", config.strip())
    return m.group(1) if m else ""


def is_valid(config: str) -> bool:
    fn = extract_plot_type(config)
    known = {"LINE_CHART", "BAR_CHART", "PIE_CHART", "SCATTER_PLOT",
             "HISTOGRAM", "HEATMAP", "BOX_PLOT", "FLAMEGRAPH", "TABLE",
             "WATERFALL", "TREEMAP", "GANTT", "RANGE", "AREA_CHART",
             "VIOLIN_PLOT", "SUNBURST", "SANKEY", "CROSSTAB",
             "GANTT_CHART", "RANGE_PLOT"}  # legacy aliases
    if fn not in known:
        return False
    depth = 0
    for ch in config:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


# ── Signal extraction (mirrors candidates.ts extractInputSignals) ──────────────

def extract_input_signals(sql: str, columns: list) -> str:
    """
    Build the compact hints: tag line. Mirrors candidates.ts SEQ2SEQ_INPUT_V3.
    columns is a list of strings (names) or dicts with 'name'/'type' keys.
    """
    sql_up = sql.upper()
    names = [(c if isinstance(c, str) else c.get('name', '')).lower() for c in columns]
    types = [('' if isinstance(c, str) else c.get('type', '')).upper() for c in columns]
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

    TIME_TYPES = {'TIMESTAMP', 'DATE', 'TIMESTAMP_NS', 'TIMESTAMP_MS'}
    has_time = (any(t in TIME_TYPES for t in types) or
                any(re.search(r'time|timestamp|bucket|date|_at$|_ts$|_dt$|^ts$|^dt$|^when$', n) for n in names))
    if has_time: tags.append('time')

    has_stack = any(re.search(r'stack|frame|trace', n) for n in names)
    if has_stack: tags.append('stack')

    if (re.search(r'gc|pause|heap|reclai|young|old|survivor|tenur', all_names) or
            re.search(r'GC|Garbage|GARBAGE|HEAP|Heap', sql)):
        tags.append('gc')
    if re.search(r'alloc|tlab|retained|live|object|class', all_names): tags.append('alloc')
    if re.search(r'cpu|thread|method|jvm|machine|load|worker', all_names): tags.append('cpu')
    if any(re.search(r'(^|_)(delta|change|diff|decrement|increment)(_|$)', n) and
           not re.search(r'(^|_)(change|diff)_(count|rate|id|pct|ratio|percent|total|num|flag)', n) and
           not re.search(r'exchange', n)
           for n in names): tags.append('delta')
    has_range_start = any(
        re.search(r'start|begin|lower', n) or n in ('low',) or
        re.search(r'^min', n) or
        re.match(r'^p([0-9]|[1-4]\d)$', n)
        for n in names)
    has_range_end = any(
        re.search(r'(^|_)end(_|$)|^end[a-z]|finish|upper', n) or n in ('high',) or
        re.search(r'^max', n) or
        re.match(r'^p([5-9]\d|100)$', n) or n in ('p95', 'p99')
        for n in names)
    if has_range_start and has_range_end: tags.append('range')

    # Numeric-range signal: time col + numeric band cols (minX/maxX/pN).
    # 88% RANGE coverage, 0% GANTT coverage.
    has_numeric_band = any(re.match(r'^(min|max)', n) or re.match(r'^p\d+$', n) for n in names)
    if has_time and has_numeric_band: tags.append('num_range')

    # cnt_agg: COUNT() with GROUP BY → strong PIE indicator.
    # In agg+duo+cnt_agg (no order): 84% PIE, 16% TREEMAP.
    if has_group_by and re.search(r'\bCOUNT\s*\(', sql_up): tags.append('cnt_agg')

    NUM_TYPES = {'INTEGER', 'BIGINT', 'DOUBLE', 'FLOAT', 'DECIMAL', 'NUMERIC',
                 'SMALLINT', 'TINYINT', 'REAL', 'HUGEINT', 'INT4', 'INT8', 'FLOAT4', 'FLOAT8'}
    num_count = 0
    cat_count = 0
    for n, t in zip(names, types):
        if t in NUM_TYPES or (not t and re.search(r'(?:count|size|ms|mb|kb|rate|pct|load|pause|duration|alloc|heap|cpu|ticks|samples|total|avg|max|overhead|throughput|latency|weight|score|p\d+|%$)', n, re.I)):
            num_count += 1
        elif t in ('VARCHAR', 'TEXT', 'STRING') or (not t and not re.search(r'time|stamp|date|bucket|_at$|_ts$|_dt$', n)):
            cat_count += 1
    tags.append(f'num:{min(num_count, 4)}')
    tags.append(f'cat:{min(cat_count, 4)}')

    # GANTT span signal: category col + two time-named cols forming a start+end span, no numeric band.
    time_named = [n for n in names if re.search(r'time|timestamp|bucket|date|_at$|_ts$|_dt$|^ts$|^dt$|^when$', n)]
    if not has_numeric_band and has_range_start and has_range_end and len(time_named) >= 2 and cat_count >= 1:
        tags.append('gantt_span')

    return ' '.join(tags)


def build_v3_input(sql: str, columns: list) -> str:
    signals = extract_input_signals(sql, columns)
    cols_str = ', '.join(columns) if isinstance(columns[0], str) else ', '.join(c.get('name', '') for c in columns)
    return f"hints: {signals}\nsql: {sql}\ncolumns: {cols_str}"


# ── Worker ────────────────────────────────────────────────────────────────────

def generate_one(plot_type: str, gen_fn) -> dict | None:
    try:
        sql, columns = gen_fn()
        config = generate_pair(sql, columns)
        if not config or not is_valid(config):
            return None
        actual_type = extract_plot_type(config)
        return {
            "input": build_v3_input(sql, columns),
            "output": config,
            "plot_type": actual_type,
            "num_columns": len(columns),
            "target_type": plot_type,
        }
    except Exception:
        return None


def generate_batch(plot_type: str, gen_fn, n_target: int, parallelism: int) -> list:
    accepted = []
    attempts = 0
    max_attempts = n_target * 5

    with ThreadPoolExecutor(max_workers=parallelism) as pool:
        while len(accepted) < n_target and attempts < max_attempts:
            batch_size = min(parallelism * 2, max_attempts - attempts, (n_target - len(accepted)) * 3)
            if batch_size <= 0:
                break
            futures = [pool.submit(generate_one, plot_type, gen_fn) for _ in range(batch_size)]
            attempts += batch_size
            for f in as_completed(futures):
                result = f.result()
                if result:
                    accepted.append(result)
            sys.stdout.write(f"\r  {len(accepted)}/{n_target} accepted, {attempts} attempts    ")
            sys.stdout.flush()

    print()
    return accepted


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data/plot_pairs.jsonl")
    parser.add_argument("--eval",   default="data/plot_eval.jsonl")
    parser.add_argument("--eval-n", type=int, default=500)
    parser.add_argument("--parallelism", type=int, default=6)
    args = parser.parse_args()

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)

    all_pairs: list[dict] = []
    total_target = sum(n for _, _, n in GENERATORS)
    print(f"Generating ~{total_target} pairs (parallelism={args.parallelism})")

    for plot_type, gen_fn, n_target in GENERATORS:
        print(f"\n=== {plot_type} (target {n_target}) ===", flush=True)
        batch = generate_batch(plot_type, gen_fn, n_target, parallelism=args.parallelism)
        all_pairs.extend(batch)
        print(f"  Accepted {len(batch)}/{n_target}", flush=True)

    random.shuffle(all_pairs)

    eval_pairs = random.sample(all_pairs, min(args.eval_n, len(all_pairs)))
    eval_ids   = {id(p) for p in eval_pairs}
    train_pairs = [p for p in all_pairs if id(p) not in eval_ids]

    # Write without target_type (not needed for training)
    with open(args.output, "w") as f:
        for p in train_pairs:
            f.write(json.dumps({k: v for k, v in p.items() if k != "target_type"}) + "\n")
    with open(args.eval, "w") as f:
        for p in eval_pairs:
            f.write(json.dumps({k: v for k, v in p.items() if k != "target_type"}) + "\n")

    from collections import Counter
    train_counts = Counter(p["plot_type"] for p in train_pairs)
    eval_counts  = Counter(p["plot_type"] for p in eval_pairs)
    print(f"\n{'Plot Type':<20} {'Train':>6} {'Eval':>5}")
    print("-" * 34)
    for pt, _, _ in GENERATORS:
        print(f"{pt:<20} {train_counts[pt]:>6} {eval_counts[pt]:>5}")
    print(f"\nTotal: train={len(train_pairs)}, eval={len(eval_pairs)}")
    print(f"Files: {args.output}, {args.eval}")


if __name__ == "__main__":
    main()
