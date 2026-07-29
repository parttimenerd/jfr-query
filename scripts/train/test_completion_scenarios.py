#!/usr/bin/env python3
"""
Comprehensive completion scenario tests for the plot suggester ONNX model.

Tests 100+ real-world JFR query patterns across all 14 plot types.
For each scenario, verifies the model predicts the correct plot type.

Usage:
    python scripts/train/test_completion_scenarios.py --onnx onnx/t5-small-q8-arm
    python scripts/train/test_completion_scenarios.py --onnx onnx/t5-small-q8-arm --verbose
    python scripts/train/test_completion_scenarios.py --onnx onnx/t5-small-q8-arm --category LINE_CHART
"""

import argparse
import json
import re
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import NamedTuple

REPO_ROOT = Path(__file__).resolve().parents[2]

# ---------------------------------------------------------------------------
# Signal extraction (v12 logic — mirrors candidates.ts extractInputSignals)
# ---------------------------------------------------------------------------

NUM_PAT = re.compile(
    r'(?:count|size|ms|mb|kb|rate|pct|load|pause|duration|alloc|heap|cpu|ticks|samples'
    r'|total|avg|max|overhead|throughput|latency|weight|score|p\d+|%$)',
    re.I
)


def extract_signals(sql: str, columns: list[str]) -> str:
    sql_up = sql.upper()
    names = [c.lower() for c in columns]
    all_names = ' '.join(names)
    tags = []

    has_group_by = bool(re.search(r'\bGROUP\s+BY\b', sql_up))
    has_aggr_fn = bool(re.search(r'\b(?:COUNT|SUM|AVG|MIN|MAX)\s*\(', sql_up))
    has_order_by = bool(re.search(r'\bORDER\s+BY\b', sql_up))
    has_limit = bool(re.search(r'\bLIMIT\b', sql_up))

    if has_group_by:
        tags.append('agg')
    if has_order_by and has_limit:
        tags.append('ordered')
    elif has_order_by:
        tags.append('sorted')

    gb_match = re.search(r'\bGROUP\s+BY\b(.+?)(?:\bHAVING\b|\bORDER\b|\bLIMIT\b|$)', sql, re.I | re.S)
    if gb_match and not has_order_by and ',' in gb_match.group(1):
        tags.append('cross')

    if not has_group_by and not has_aggr_fn and not has_order_by and has_limit:
        tags.append('raw')
    if has_aggr_fn and not has_group_by:
        tags.append('scalar')
    if re.search(r'\bHAVING\b', sql_up):
        tags.append('having')
    if has_group_by and re.search(r'\bCOUNT\s*\(', sql_up):
        tags.append('cnt_agg')

    n = len(columns)
    if n == 1:
        tags.append('solo')
    elif n == 2:
        tags.append('duo')
    elif n >= 3:
        tags.append('wide')

    has_time = any(re.search(r'time|timestamp|bucket|date|_at$|_ts$|_dt$|^ts$|^dt$|^when$', nm) for nm in names)
    if has_time:
        tags.append('time')

    if any(re.search(r'stack|frame|trace', nm) for nm in names):
        tags.append('stack')

    if (re.search(r'gc|pause|heap|reclai|young|old|survivor|tenur', all_names) or
            re.search(r'GC|Garbage|GARBAGE|HEAP|Heap', sql)):
        tags.append('gc')
    if re.search(r'alloc|tlab|retained|live|object|class', all_names):
        tags.append('alloc')
    if re.search(r'cpu|thread|method|jvm|machine|load|worker', all_names):
        tags.append('cpu')
    if re.search(r'delta|change|diff|decrement|increment', all_names):
        tags.append('delta')

    has_range_start = any(
        re.search(r'start|begin|lower', nm) or nm in ('low',) or
        re.search(r'^min', nm) or re.match(r'^p([0-9]|[1-4]\d)$', nm)
        for nm in names)
    has_range_end = any(
        re.search(r'(^|_)end(_|$)|^end[a-z]|finish|upper', nm) or nm in ('high',) or
        re.search(r'^max', nm) or
        re.match(r'^p([5-9]\d|100)$', nm) or nm in ('p95', 'p99')
        for nm in names)
    if has_range_start and has_range_end:
        tags.append('range')

    has_numeric_band = any(re.match(r'^(min|max)', nm) or re.match(r'^p\d+$', nm) for nm in names)
    if has_time and has_numeric_band:
        tags.append('num_range')

    num_count = sum(1 for nm in names if NUM_PAT.search(nm))
    cat_count = sum(1 for nm in names
                    if not NUM_PAT.search(nm)
                    and not re.search(r'time|stamp|date|bucket|_at$|_ts$|_dt$|^ts$|^dt$', nm))
    tags.append(f'num:{min(num_count, 4)}')
    tags.append(f'cat:{min(cat_count, 4)}')

    return ' '.join(tags)


def make_input(sql: str, columns: list[str]) -> str:
    hints = extract_signals(sql, columns)
    cols_str = ', '.join(columns)
    return f"hints: {hints}\nsql: {sql}\ncolumns: {cols_str}"


# ---------------------------------------------------------------------------
# Scenario definitions
# ---------------------------------------------------------------------------

class Scenario(NamedTuple):
    name: str
    category: str          # expected plot type
    sql: str
    columns: list[str]
    note: str = ""         # optional human-readable description


SCENARIOS: list[Scenario] = [

    # ── LINE_CHART ────────────────────────────────────────────────────────────
    Scenario("line_gc_pause_over_time", "LINE_CHART",
             "SELECT time_bucket('1s', ts) AS bucket, avg(pause_ms) AS avg_pause FROM gc_events GROUP BY bucket ORDER BY bucket",
             ["bucket", "avg_pause"], "GC pause time series"),
    Scenario("line_cpu_usage_timeseries", "LINE_CHART",
             "SELECT time_bucket('5s', ts) AS bucket, avg(cpu_load) AS cpu FROM jfr_events GROUP BY bucket ORDER BY bucket",
             ["bucket", "cpu"], "CPU load over time"),
    Scenario("line_heap_usage", "LINE_CHART",
             "SELECT time_bucket('1s', ts) AS bucket, max(heap_used_mb) AS heap_mb FROM heap_events GROUP BY bucket ORDER BY bucket",
             ["bucket", "heap_mb"], "Heap usage over time"),
    Scenario("line_alloc_rate", "LINE_CHART",
             "SELECT time_bucket('1s', ts) AS bucket, sum(alloc_size_kb) AS alloc_kb FROM alloc_events GROUP BY bucket ORDER BY bucket",
             ["bucket", "alloc_kb"], "Allocation rate over time"),
    Scenario("line_thread_count", "LINE_CHART",
             "SELECT time_bucket('2s', ts) AS bucket, count(*) AS thread_count FROM thread_events GROUP BY bucket ORDER BY bucket",
             ["bucket", "thread_count"], "Thread count over time"),
    Scenario("line_gc_count_timeseries", "LINE_CHART",
             "SELECT time_bucket('10s', ts) AS bucket, count(*) AS gc_count FROM gc_events GROUP BY bucket ORDER BY bucket",
             ["bucket", "gc_count"], "GC event count over time"),
    Scenario("line_method_samples_over_time", "LINE_CHART",
             "SELECT time_bucket('1s', ts) AS bucket, sum(samples) AS total_samples FROM method_samples GROUP BY bucket ORDER BY bucket",
             ["bucket", "total_samples"], "Profiling samples over time"),

    # ── BAR_CHART (ordered/top-N) ─────────────────────────────────────────────
    Scenario("bar_top_methods_by_samples", "BAR_CHART",
             "SELECT method_name, sum(samples) AS total_samples FROM method_samples GROUP BY method_name ORDER BY total_samples DESC LIMIT 20",
             ["method_name", "total_samples"], "Top N methods by sample count"),
    Scenario("bar_top_classes_by_alloc", "BAR_CHART",
             "SELECT class_name, sum(alloc_size_mb) AS alloc_mb FROM alloc_events GROUP BY class_name ORDER BY alloc_mb DESC LIMIT 15",
             ["class_name", "alloc_mb"], "Top allocating classes"),
    Scenario("bar_threads_by_cpu", "BAR_CHART",
             "SELECT thread_name, sum(cpu_ticks) AS cpu FROM cpu_events GROUP BY thread_name ORDER BY cpu DESC LIMIT 10",
             ["thread_name", "cpu"], "Top threads by CPU"),
    Scenario("bar_packages_by_duration", "BAR_CHART",
             "SELECT package_name, avg(duration_ms) AS avg_duration FROM method_events GROUP BY package_name ORDER BY avg_duration DESC LIMIT 20",
             ["package_name", "avg_duration"], "Packages by avg duration"),
    Scenario("bar_gc_by_type", "BAR_CHART",
             "SELECT gc_cause, count(*) AS gc_count FROM gc_events GROUP BY gc_cause ORDER BY gc_count DESC LIMIT 10",
             ["gc_cause", "gc_count"], "GC events by cause"),

    # ── BAR_CHART (cross/no-order — but expect BAR here when ordered) ─────────
    # note: non-ordered 2-col agg → PIE/TREEMAP territory, so keep these as ordered
    Scenario("bar_jvm_flags_count", "BAR_CHART",
             "SELECT flag_name, count(*) AS change_count FROM jvm_flag_changes GROUP BY flag_name ORDER BY change_count DESC LIMIT 10",
             ["flag_name", "change_count"], "JVM flag change frequency"),

    # ── HISTOGRAM ─────────────────────────────────────────────────────────────
    Scenario("histogram_pause_duration", "HISTOGRAM",
             "SELECT pause_ms FROM gc_events ORDER BY pause_ms LIMIT 10000",
             ["pause_ms"], "Distribution of pause durations"),
    Scenario("histogram_alloc_size", "HISTOGRAM",
             "SELECT alloc_size_kb FROM alloc_events LIMIT 5000",
             ["alloc_size_kb"], "Distribution of allocation sizes"),
    Scenario("histogram_method_duration", "HISTOGRAM",
             "SELECT duration_ms FROM method_events LIMIT 10000",
             ["duration_ms"], "Distribution of method execution times"),
    Scenario("histogram_heap_size", "HISTOGRAM",
             "SELECT heap_used_mb FROM heap_snapshots LIMIT 1000",
             ["heap_used_mb"], "Distribution of heap sizes"),
    Scenario("histogram_cpu_load", "HISTOGRAM",
             "SELECT cpu_load FROM cpu_snapshots LIMIT 2000",
             ["cpu_load"], "Distribution of CPU load values"),
    Scenario("histogram_tlab_size", "HISTOGRAM",
             "SELECT tlab_size FROM tlab_events LIMIT 5000",
             ["tlab_size"], "Distribution of TLAB sizes"),

    # ── BOX_PLOT ──────────────────────────────────────────────────────────────
    Scenario("boxplot_pause_by_gc_type", "BOX_PLOT",
             "SELECT gc_type, pause_ms FROM gc_events ORDER BY gc_type LIMIT 10000",
             ["gc_type", "pause_ms"], "GC pause distribution by type"),
    Scenario("boxplot_duration_by_thread", "BOX_PLOT",
             "SELECT thread_name, duration_ms FROM method_events ORDER BY thread_name LIMIT 5000",
             ["thread_name", "duration_ms"], "Method duration by thread"),
    Scenario("boxplot_alloc_by_class", "BOX_PLOT",
             "SELECT class_name, alloc_size_kb FROM alloc_events LIMIT 5000",
             ["class_name", "alloc_size_kb"], "Allocation size by class"),
    Scenario("boxplot_pause_by_cause", "BOX_PLOT",
             "SELECT gc_cause, pause_ms FROM gc_events LIMIT 10000",
             ["gc_cause", "pause_ms"], "Pause by GC cause"),
    Scenario("boxplot_cpu_by_worker", "BOX_PLOT",
             "SELECT worker_type, cpu_ms FROM worker_events LIMIT 3000",
             ["worker_type", "cpu_ms"], "CPU time by worker type"),

    # ── SCATTER_PLOT ──────────────────────────────────────────────────────────
    Scenario("scatter_gc_overhead_vs_alloc", "SCATTER_PLOT",
             "SELECT alloc_rate_mbps, gc_overhead_pct FROM gc_summary GROUP BY thread_name LIMIT 1000",
             ["alloc_rate_mbps", "gc_overhead_pct"], "Alloc rate vs GC overhead"),
    Scenario("scatter_throughput_vs_latency", "SCATTER_PLOT",
             "SELECT throughput, latency_ms FROM benchmark_results LIMIT 500",
             ["throughput", "latency_ms"], "Throughput vs latency"),
    Scenario("scatter_heap_vs_pause", "SCATTER_PLOT",
             "SELECT heap_used_mb, pause_ms FROM gc_events LIMIT 2000",
             ["heap_used_mb", "pause_ms"], "Heap size vs pause duration"),
    Scenario("scatter_cpu_vs_alloc", "SCATTER_PLOT",
             "SELECT cpu_pct, alloc_rate FROM thread_stats GROUP BY thread_id LIMIT 1000",
             ["cpu_pct", "alloc_rate"], "CPU vs allocation rate"),
    Scenario("scatter_samples_vs_duration", "SCATTER_PLOT",
             "SELECT samples, duration_ms FROM method_stats LIMIT 5000",
             ["samples", "duration_ms"], "Sample count vs duration"),

    # ── PIE_CHART ─────────────────────────────────────────────────────────────
    Scenario("pie_gc_events_by_cause", "PIE_CHART",
             "SELECT gc_cause, count(*) AS event_count FROM gc_events GROUP BY gc_cause",
             ["gc_cause", "event_count"], "GC events by cause (count)"),
    Scenario("pie_alloc_by_class_count", "PIE_CHART",
             "SELECT class_name, count(*) AS alloc_count FROM alloc_events GROUP BY class_name",
             ["class_name", "alloc_count"], "Allocation events by class"),
    Scenario("pie_thread_count_by_state", "PIE_CHART",
             "SELECT thread_state, count(*) AS thread_count FROM thread_states GROUP BY thread_state",
             ["thread_state", "thread_count"], "Thread count by state"),
    Scenario("pie_method_calls_by_package", "PIE_CHART",
             "SELECT package_name, count(*) AS call_count FROM method_events GROUP BY package_name",
             ["package_name", "call_count"], "Method calls by package"),
    Scenario("pie_gc_by_type_count", "PIE_CHART",
             "SELECT gc_type, count(*) AS gc_count FROM gc_events GROUP BY gc_type",
             ["gc_type", "gc_count"], "GC events by type (pie)"),

    # ── TREEMAP ───────────────────────────────────────────────────────────────
    Scenario("treemap_alloc_by_class_sum", "TREEMAP",
             "SELECT class_name, sum(alloc_size_mb) AS total_alloc_mb FROM alloc_events GROUP BY class_name",
             ["class_name", "total_alloc_mb"], "Total allocation by class"),
    Scenario("treemap_cpu_by_method", "TREEMAP",
             "SELECT method_name, sum(cpu_ms) AS total_cpu_ms FROM cpu_samples GROUP BY method_name",
             ["method_name", "total_cpu_ms"], "CPU time by method"),
    Scenario("treemap_heap_by_type", "TREEMAP",
             "SELECT object_type, sum(retained_mb) AS retained_mb FROM heap_objects GROUP BY object_type",
             ["object_type", "retained_mb"], "Retained heap by type"),
    Scenario("treemap_duration_by_package", "TREEMAP",
             "SELECT package_name, sum(duration_ms) AS total_duration FROM method_events GROUP BY package_name",
             ["package_name", "total_duration"], "Total duration by package"),

    # ── HEATMAP ───────────────────────────────────────────────────────────────
    Scenario("heatmap_method_cpu_by_thread", "HEATMAP",
             "SELECT thread_name, method_name, sum(cpu_ticks) AS cpu FROM cpu_events GROUP BY thread_name, method_name",
             ["thread_name", "method_name", "cpu"], "CPU heatmap: thread x method"),
    Scenario("heatmap_alloc_class_thread", "HEATMAP",
             "SELECT class_name, thread_name, count(*) AS alloc_count FROM alloc_events GROUP BY class_name, thread_name",
             ["class_name", "thread_name", "alloc_count"], "Allocation heatmap"),
    Scenario("heatmap_gc_cause_by_hour", "HEATMAP",
             "SELECT hour_of_day, gc_cause, count(*) AS gc_count FROM gc_events GROUP BY hour_of_day, gc_cause",
             ["hour_of_day", "gc_cause", "gc_count"], "GC cause by hour"),
    Scenario("heatmap_thread_state_transitions", "HEATMAP",
             "SELECT from_state, to_state, count(*) AS transition_count FROM state_transitions GROUP BY from_state, to_state",
             ["from_state", "to_state", "transition_count"], "Thread state transitions"),

    # ── FLAMEGRAPH ────────────────────────────────────────────────────────────
    Scenario("flamegraph_cpu_stack", "FLAMEGRAPH",
             "SELECT stack_trace, sum(samples) AS sample_count FROM cpu_samples GROUP BY stack_trace ORDER BY sample_count DESC LIMIT 1000",
             ["stack_trace", "sample_count"], "CPU flame graph by stack"),
    Scenario("flamegraph_alloc_frames", "FLAMEGRAPH",
             "SELECT stack_frames, sum(alloc_size_kb) AS alloc_kb FROM alloc_events GROUP BY stack_frames ORDER BY alloc_kb DESC LIMIT 500",
             ["stack_frames", "alloc_kb"], "Allocation flame graph"),
    Scenario("flamegraph_gc_trace", "FLAMEGRAPH",
             "SELECT gc_stack, count(*) AS gc_count FROM gc_trace_events GROUP BY gc_stack ORDER BY gc_count DESC LIMIT 200",
             ["gc_stack", "gc_count"], "GC stack trace flame"),
    Scenario("flamegraph_method_trace", "FLAMEGRAPH",
             "SELECT call_stack, sum(duration_ms) AS total_ms FROM profiling_events GROUP BY call_stack ORDER BY total_ms DESC LIMIT 500",
             ["call_stack", "total_ms"], "Method call stack flame graph"),

    # ── WATERFALL ─────────────────────────────────────────────────────────────
    Scenario("waterfall_heap_delta_by_gc", "WATERFALL",
             "SELECT gc_id, heap_delta_mb FROM gc_events ORDER BY gc_id LIMIT 50",
             ["gc_id", "heap_delta_mb"], "Heap change per GC event"),
    Scenario("waterfall_alloc_delta", "WATERFALL",
             "SELECT phase, alloc_change_mb AS alloc_increment FROM phase_stats ORDER BY phase",
             ["phase", "alloc_increment"], "Allocation change by phase"),
    Scenario("waterfall_memory_diff", "WATERFALL",
             "SELECT region, memory_diff_mb FROM region_stats ORDER BY region LIMIT 20",
             ["region", "memory_diff_mb"], "Memory difference by region"),
    Scenario("waterfall_cpu_delta", "WATERFALL",
             "SELECT snapshot_id, cpu_change_pct FROM cpu_snapshots ORDER BY snapshot_id LIMIT 100",
             ["snapshot_id", "cpu_change_pct"], "CPU change over snapshots"),

    # ── GANTT ─────────────────────────────────────────────────────────────────
    Scenario("gantt_gc_phases", "GANTT",
             "SELECT phase_name, start_time, end_time FROM gc_phases ORDER BY start_time LIMIT 100",
             ["phase_name", "start_time", "end_time"], "GC phase timeline"),
    Scenario("gantt_thread_locks", "GANTT",
             "SELECT thread_name, lock_start, lock_end FROM lock_events ORDER BY lock_start LIMIT 200",
             ["thread_name", "lock_start", "lock_end"], "Thread lock timeline"),
    Scenario("gantt_jvm_events", "GANTT",
             "SELECT event_type, begin_time, finish_time FROM jvm_events ORDER BY begin_time LIMIT 50",
             ["event_type", "begin_time", "finish_time"], "JVM event timeline"),
    Scenario("gantt_compilation_tasks", "GANTT",
             "SELECT method_name, compile_start, compile_end FROM compilation_events ORDER BY compile_start LIMIT 100",
             ["method_name", "compile_start", "compile_end"], "Compilation timeline"),
    Scenario("gantt_concurrent_phases", "GANTT",
             "SELECT phase, start_ts, end_ts FROM concurrent_gc_phases ORDER BY start_ts",
             ["phase", "start_ts", "end_ts"], "Concurrent GC phases"),

    # ── RANGE (numeric band — num_range signal) ───────────────────────────────
    Scenario("range_pause_percentiles", "RANGE",
             "SELECT time_bucket('5s', ts) AS bucket, p25, p50, p75, p95 FROM pause_percentiles ORDER BY bucket",
             ["bucket", "p25", "p50", "p75", "p95"], "Pause percentile bands over time"),
    Scenario("range_heap_minmax", "RANGE",
             "SELECT time_bucket('1s', ts) AS bucket, min_heap_mb, max_heap_mb FROM heap_stats ORDER BY bucket",
             ["bucket", "min_heap_mb", "max_heap_mb"], "Heap min/max band over time"),
    Scenario("range_alloc_rate_band", "RANGE",
             "SELECT time_bucket('2s', ts) AS bucket, p10, p50, p90 FROM alloc_rate_stats ORDER BY bucket",
             ["bucket", "p10", "p50", "p90"], "Allocation rate percentile band"),
    Scenario("range_cpu_percentile_band", "RANGE",
             "SELECT time_bucket('1s', ts) AS bucket, min_cpu, p50, max_cpu FROM cpu_stats ORDER BY bucket",
             ["bucket", "min_cpu", "p50", "max_cpu"], "CPU percentile band over time"),
    Scenario("range_latency_band", "RANGE",
             "SELECT time_bucket('1s', ts) AS bucket, p5, p25, p75, p95 FROM latency_stats ORDER BY bucket",
             ["bucket", "p5", "p25", "p75", "p95"], "Latency distribution band"),

    # ── TABLE (raw / scalar / aggregate) ─────────────────────────────────────
    Scenario("table_raw_gc_events", "TABLE",
             "SELECT ts, gc_type, pause_ms, heap_before_mb, heap_after_mb FROM gc_events ORDER BY ts LIMIT 100",
             ["ts", "gc_type", "pause_ms", "heap_before_mb", "heap_after_mb"], "Raw GC event table"),
    Scenario("table_scalar_heap_stats", "TABLE",
             "SELECT count(*) AS gc_count, avg(pause_ms) AS avg_pause, max(pause_ms) AS max_pause FROM gc_events",
             ["gc_count", "avg_pause", "max_pause"], "Scalar aggregate stats"),
    Scenario("table_raw_alloc", "TABLE",
             "SELECT ts, class_name, thread_name, alloc_size_kb FROM alloc_events ORDER BY ts LIMIT 200",
             ["ts", "class_name", "thread_name", "alloc_size_kb"], "Raw allocation events"),
    Scenario("table_scalar_summary", "TABLE",
             "SELECT sum(cpu_ticks) AS total_cpu, count(*) AS event_count FROM cpu_events",
             ["total_cpu", "event_count"], "Summary stats (scalar)"),
    Scenario("table_jfr_metadata", "TABLE",
             "SELECT event_type, count(*) AS event_count, min(ts) AS first_seen, max(ts) AS last_seen FROM jfr_events GROUP BY event_type ORDER BY event_count DESC",
             ["event_type", "event_count", "first_seen", "last_seen"], "Per-event-type metadata"),
    Scenario("table_thread_list", "TABLE",
             "SELECT thread_name, thread_id, thread_state FROM threads ORDER BY thread_name LIMIT 50",
             ["thread_name", "thread_id", "thread_state"], "Thread listing"),

    # ── AREA_CHART ────────────────────────────────────────────────────────────
    Scenario("area_alloc_stacked", "AREA_CHART",
             "SELECT time_bucket('1s', ts) AS bucket, class_name, sum(alloc_size_kb) AS alloc_kb FROM alloc_events GROUP BY bucket, class_name ORDER BY bucket",
             ["bucket", "class_name", "alloc_kb"], "Stacked alloc area by class (agg+sorted+wide+time+cat:1)"),
    Scenario("area_multi_metric", "AREA_CHART",
             "SELECT time_bucket('1s', ts) AS bucket, avg(heap_young_mb) AS young, avg(heap_old_mb) AS old, avg(heap_meta_mb) AS meta FROM heap_regions GROUP BY bucket ORDER BY bucket",
             ["bucket", "young", "old", "meta"], "Multi-metric heap area chart (agg+sorted+wide+time)"),
    Scenario("area_cpu_regions_stacked", "AREA_CHART",
             "SELECT time_bucket('2s', ts) AS bucket, thread_type, avg(cpu_pct) AS cpu_pct FROM thread_cpu GROUP BY bucket, thread_type ORDER BY bucket",
             ["bucket", "thread_type", "cpu_pct"], "CPU usage stacked by thread type"),

    # ── Edge cases / ambiguous but expected ───────────────────────────────────
    Scenario("edge_histogram_gc_pause_solo", "HISTOGRAM",
             "SELECT pause_ms FROM gc_events LIMIT 10000",
             ["pause_ms"], "Solo numeric, no time — histogram"),
    Scenario("edge_pie_count_agg_duo", "PIE_CHART",
             "SELECT gc_type, count(*) AS n FROM gc_events GROUP BY gc_type",
             ["gc_type", "n"], "Count agg duo — pie"),
    Scenario("edge_treemap_sum_agg_duo", "TREEMAP",
             "SELECT class_name, sum(alloc_mb) AS total FROM alloc_events GROUP BY class_name",
             ["class_name", "total"], "Sum agg duo — treemap"),
    Scenario("edge_bar_ordered_large", "BAR_CHART",
             "SELECT method_name, count(*) AS cnt FROM jfr_events GROUP BY method_name ORDER BY cnt DESC LIMIT 50",
             ["method_name", "cnt"], "Ordered top-N bar"),
    Scenario("edge_heatmap_cross_3col", "HEATMAP",
             "SELECT a, b, sum(val) AS total FROM events GROUP BY a, b",
             ["a", "b", "total"], "3-col cross group-by — heatmap"),
    Scenario("edge_line_time_2col", "LINE_CHART",
             "SELECT ts, avg(val) AS avg_val FROM events GROUP BY ts ORDER BY ts",
             ["ts", "avg_val"], "Time 2-col sorted — line"),
    Scenario("edge_scatter_two_numeric", "SCATTER_PLOT",
             "SELECT cpu_pct, alloc_rate FROM samples LIMIT 1000",
             ["cpu_pct", "alloc_rate"], "Two numeric cols — scatter"),
    Scenario("edge_range_p5_p95", "RANGE",
             "SELECT bucket, p5, p95 FROM latency_bands ORDER BY bucket",
             ["bucket", "p5", "p95"], "Percentile band p5/p95"),
    Scenario("edge_gantt_start_end", "GANTT",
             "SELECT task_name, start_time, end_time FROM tasks ORDER BY start_time",
             ["task_name", "start_time", "end_time"], "Start/end 3-col — gantt"),
    Scenario("edge_waterfall_delta", "WATERFALL",
             "SELECT phase, heap_delta FROM phases ORDER BY phase",
             ["phase", "heap_delta"], "Delta col — waterfall"),
    Scenario("edge_flamegraph_stack", "FLAMEGRAPH",
             "SELECT stack_trace, count(*) AS samples FROM cpu_stacks GROUP BY stack_trace ORDER BY samples DESC LIMIT 100",
             ["stack_trace", "samples"], "Stack col — flamegraph"),
    Scenario("edge_table_scalar_count", "TABLE",
             "SELECT count(*) AS total FROM gc_events",
             ["total"], "Single scalar count — table"),
    Scenario("edge_histogram_duration_raw", "HISTOGRAM",
             "SELECT duration_ms FROM lock_events LIMIT 5000",
             ["duration_ms"], "Duration raw — histogram"),
    Scenario("edge_bar_gc_cause_ordered", "BAR_CHART",
             "SELECT gc_cause, count(*) AS n FROM gc_events GROUP BY gc_cause ORDER BY n DESC LIMIT 10",
             ["gc_cause", "n"], "GC cause ordered — bar"),
    Scenario("edge_heatmap_no_order", "HEATMAP",
             "SELECT thread, phase, avg(dur_ms) AS avg_dur FROM events GROUP BY thread, phase",
             ["thread", "phase", "avg_dur"], "2-group cross no-order — heatmap"),
    # v26 gap-fix tests
    Scenario("edge_scatter_agg_duo", "SCATTER_PLOT",
             "SELECT avg(cpu_pct) AS cpu_pct, avg(alloc_rate) AS alloc_rate FROM cpu_profile GROUP BY thread_name",
             ["cpu_pct", "alloc_rate"], "Agg scatter — two numeric after GROUP BY"),
    Scenario("edge_gantt_ordered_limit", "GANTT",
             "SELECT thread_name, lock_start, lock_end FROM lock_events ORDER BY lock_start LIMIT 500",
             ["thread_name", "lock_start", "lock_end"], "GANTT with ORDER BY LIMIT (ordered)"),
    Scenario("edge_histogram_raw_solo", "HISTOGRAM",
             "SELECT pause_ms FROM gc_events LIMIT 10000",
             ["pause_ms"], "Histogram LIMIT only (raw+solo)"),
    Scenario("edge_histogram_ordered_solo", "HISTOGRAM",
             "SELECT cpu_load FROM cpu_samples ORDER BY cpu_load DESC LIMIT 5000",
             ["cpu_load"], "Histogram ORDER BY LIMIT (ordered+solo)"),
    Scenario("edge_table_scalar_wide", "TABLE",
             "SELECT count(*) AS events, sum(pause_ms) AS total_pause, avg(pause_ms) AS avg_pause, max(pause_ms) AS max_pause FROM gc_events",
             ["events", "total_pause", "avg_pause", "max_pause"], "TABLE scalar wide aggregates"),
    Scenario("edge_scatter_category", "SCATTER_PLOT",
             "SELECT cpu_pct, alloc_rate, thread_name FROM thread_stats LIMIT 2000",
             ["cpu_pct", "alloc_rate", "thread_name"], "Scatter with category (wide+num:2+cat:1)"),
]


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------

def extract_plot_type(generated: str) -> str:
    m = re.match(r'(\w+)\s*\(', generated.strip())
    return m.group(1).upper() if m else ""


def run_scenario(model, tokenizer, scenario: Scenario) -> tuple[bool, str, float]:
    input_text = make_input(scenario.sql, scenario.columns)
    inputs = tokenizer(input_text, return_tensors="pt", truncation=True, max_length=256)
    t0 = time.perf_counter()
    outputs = model.generate(**inputs, max_new_tokens=64, do_sample=False, early_stopping=True)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    generated = tokenizer.decode(outputs[0], skip_special_tokens=True).strip()
    got_type = extract_plot_type(generated)
    ok = got_type == scenario.category
    return ok, generated, elapsed_ms


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", required=True, help="Path to ONNX model dir")
    ap.add_argument("--verbose", "-v", action="store_true", help="Print all results")
    ap.add_argument("--category", help="Only run scenarios for this plot type")
    ap.add_argument("--json-out", help="Write results JSON to this file")
    args = ap.parse_args()

    try:
        from optimum.onnxruntime import ORTModelForSeq2SeqLM
        from transformers import AutoTokenizer
    except ImportError:
        print("pip install optimum[onnxruntime] transformers")
        sys.exit(1)

    print(f"Loading ONNX model from {args.onnx}...")
    tokenizer = AutoTokenizer.from_pretrained(args.onnx)
    model = ORTModelForSeq2SeqLM.from_pretrained(args.onnx)

    scenarios = SCENARIOS
    if args.category:
        scenarios = [s for s in SCENARIOS if s.category == args.category.upper()]
        if not scenarios:
            print(f"No scenarios found for category {args.category!r}")
            print(f"Available: {sorted({s.category for s in SCENARIOS})}")
            sys.exit(1)

    print(f"Running {len(scenarios)} completion scenarios...\n")

    results = []
    per_category: dict[str, list[bool]] = defaultdict(list)
    latencies: list[float] = []
    failures: list[dict] = []

    for i, sc in enumerate(scenarios):
        ok, generated, ms = run_scenario(model, tokenizer, sc)
        per_category[sc.category].append(ok)
        latencies.append(ms)
        results.append({
            "name": sc.name,
            "category": sc.category,
            "ok": ok,
            "generated": generated,
            "got_type": extract_plot_type(generated),
            "latency_ms": ms,
            "note": sc.note,
            "signals": extract_signals(sc.sql, sc.columns),
        })
        if not ok:
            failures.append(results[-1])

        status = "✓" if ok else "✗"
        got = extract_plot_type(generated)
        if args.verbose or not ok:
            print(f"  {status} [{sc.category:<12}] {sc.name}")
            if not ok:
                print(f"      → got: {got!r}  ({generated[:60]})")
        elif (i + 1) % 10 == 0:
            n_ok = sum(r["ok"] for r in results)
            print(f"  {i+1}/{len(scenarios)}  acc={100*n_ok/(i+1):.1f}%  p50={sorted(latencies)[len(latencies)//2]:.0f}ms")

    # Summary
    n_ok = sum(r["ok"] for r in results)
    n = len(results)
    p50 = sorted(latencies)[len(latencies) // 2]
    p95 = sorted(latencies)[int(len(latencies) * 0.95)]

    print(f"\n{'='*60}")
    print(f"RESULTS: {n_ok}/{n} = {100*n_ok/n:.1f}% accuracy")
    print(f"Latency: p50={p50:.0f}ms  p95={p95:.0f}ms  max={max(latencies):.0f}ms")
    print()

    # Per-category table
    cat_rows = []
    for cat in sorted(per_category):
        bools = per_category[cat]
        n_cat_ok = sum(bools)
        n_cat = len(bools)
        pct = 100 * n_cat_ok / n_cat
        flag = "  " if pct >= 80 else "⚠ " if pct >= 50 else "✗ "
        cat_rows.append((flag + cat, n_cat, n_cat_ok, f"{pct:.0f}%"))

    print(f"{'Category':<22}  {'#':<4}  {'OK':<4}  {'Acc'}")
    print("-" * 40)
    for row in cat_rows:
        print(f"  {row[0]:<20}  {row[1]:<4}  {row[2]:<4}  {row[3]}")

    if failures:
        print(f"\nFailures ({len(failures)}):")
        for f in failures:
            print(f"  ✗ [{f['category']:<12}] {f['name']}")
            print(f"      → {f['got_type']!r}  signals: {f['signals'][:60]}")

    if args.json_out:
        out = {
            "accuracy": n_ok / n,
            "n_correct": n_ok,
            "n_total": n,
            "latency_p50_ms": p50,
            "latency_p95_ms": p95,
            "per_category": {cat: sum(v) / len(v) for cat, v in per_category.items()},
            "scenarios": results,
        }
        Path(args.json_out).write_text(json.dumps(out, indent=2))
        print(f"\nResults written to {args.json_out}")

    # Exit code: 0 if ≥80% overall, 1 otherwise
    sys.exit(0 if n_ok / n >= 0.80 else 1)


if __name__ == "__main__":
    main()
