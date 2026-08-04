# Built-in Views & Macros

jfr-query ships a large library of canned SQL views and macros over the JFR event tables. This page lists every one bundled with the tool.

Custom views and macros can be added per-notebook via the front matter `views:` and `macros:` fields — see [Notebook Format](notebook-format.md).

## Views

Views are pre-defined SQL result sets. Reference them from any SQL block as if they were tables:

```sql
SELECT * FROM gc-pauses ORDER BY duration_ms DESC LIMIT 10
```

### Recording & System

- `active-recordings`
- `active-settings`
- `recording`
- `system-information`
- `system-processes`
- `system-properties`
- `environment-variables`
- `jvm-flags`
- `jvm-information`
- `jdk-agents`
- `modules`
- `native-libraries`
- `native-library-failures`

### GC & Memory

- `gc`
- `gc-allocation-trigger`
- `gc-concurrent-phases`
- `gc-concurrent-phases-detail`
- `gc-configuration`
- `gc-cpu-time`
- `gc-allocation-by-class`
- `gc-consecutive-full`
- `gc-duration-buckets`
- `gc-efficiency`
- `gc-eden-size`
- `gc-humongous`
- `gc-memory-size`
- `gc-old-gen-growth`
- `gc-object-stats`
- `gc-overhead`
- `gc-parallel-phases`
- `gc-pause-cause-over-time`
- `gc-pause-over-time`
- `gc-pause-distribution`
- `gc-pause-phases`
- `gc-pauses`
- `gc-phase-breakdown`
- `gc-phase-stats`
- `gc-promotion-rate`
- `gc-references`
- `gc-safepoint-distribution`
- `gc-safepoint-summary`
- `gc-throughput`
- `gc-thread-allocation`
- `gc-time-split`
- `gc-top-pauses`
- `gc-young-old-time`
- `gc-young-vs-old`
- `g1-heap-regions` *(conditional — requires `G1HeapSummary` events)*
- `heap-committed-vs-used`
- `heap-configuration`
- `heap-summary-over-time`
- `metaspace-over-time` *(conditional — requires `MetaspaceSummary` events)*
- `blocked-by-system-gc`
- `native-memory-committed`
- `native-memory-reserved`
- `object-statistics`
- `finalizers`
- `tenuring-distribution` *(conditional — requires `TenuringDistribution` events)*
- `tlab-efficiency`
- `tlabs`
- `safepoints`
- `safepoint-overhead`
- `vm-operations`

### CPU & Threads

- `cpu-flamegraph`
- `cpu-information`
- `cpu-load`
- `cpu-load-samples`
- `cpu-time-hot-methods`
- `cpu-time-statistics`
- `cpu-tsc`
- `hot-methods`
- `method-calls`
- `method-timing`
- `native-methods`
- `thread-allocation`
- `thread-count`
- `thread-cpu-load`
- `thread-start`
- `pinned-threads`
- `latencies-by-type`

### I/O & Network

- `file-reads-by-path`
- `file-writes-by-path`
- `socket-reads-by-host`
- `socket-writes-by-host`
- `network-utilization`

### Compiler & JVM

- `compiler-configuration`
- `compiler-phases`
- `compiler-statistics`
- `deoptimizations-by-reason`
- `deoptimizations-by-site`
- `deprecated-methods-for-removal`
- `class-loaders`
- `class-modifications`
- `longest-class-loading`
- `longest-compilations`
- `events-by-count`
- `events-by-name`

### Allocation & Leaks

- `alloc-flamegraph`
- `allocation-by-class`
- `allocation-by-class-detail`
- `allocation-by-site`
- `allocation-by-thread`
- `allocation-rate`
- `memory-leaks-by-class`
- `memory-leaks-by-site`

### Contention & Locks

- `contention-by-address`
- `contention-by-class`
- `contention-by-site`
- `contention-by-thread`
- `lock-flamegraph`
- `monitor-inflation`

### Exceptions

- `exception-by-message`
- `exception-by-site`
- `exception-by-type`
- `exception-count`
- `exception-flamegraph`
- `native-flamegraph`

### Container

- `container-configuration`
- `container-cpu-throttling`
- `container-cpu-usage`
- `container-io-usage`
- `container-memory-usage`

## Macros

Macros are inline SQL fragments. Call them like SQL functions:

```sql
SELECT P95(duration_ms) FROM gc
```

### Statistical

- `P25(col)` — 25th percentile.
- `P50(col)` — 50th percentile (median).
- `P75(col)` — 75th percentile.
- `P90(col)` — 90th percentile.
- `P95(col)` — 95th percentile.
- `P99(col)` — 99th percentile.
- `P999(col)` — 99.9th percentile.
- `normalized(x)` — value normalised to `[0, 1]` over its column range.
- `COUNT_UNIQUE(x)` — distinct count.
- `diff(col)` — difference from previous row (window).
- `rolling_avg(value, window_ms, ts)` — time-windowed rolling average.
- `rolling_sum(value, window_ms, ts)` — time-windowed rolling sum.

### Formatting

- `format_decimals(num, decimals)` — fixed decimal places.
- `format_percentage(num, decimals:=2)` — render as percentage.
- `format_memory(bytes, decimals:=2)` — humanised byte count (B, KB, MB, GB).
- `format_rate(bytes_per_sec, decimals:=2)` — humanised throughput (B/s, KB/s, MB/s, GB/s).
- `format_duration(seconds, decimals:=2)` — humanised duration from seconds.
- `format_human_duration(sec)` — coarse humanised duration.
- `format_hex(i)` — hexadecimal representation.

### Time & GC helpers

- `before_gc(ts)` — GC event immediately before `ts`.
- `after_gc(ts)` — GC event immediately after `ts`.
- `duration_since_last_gc(ts)` — time since previous GC.
- `HEAP_BEFORE_GC(gc_id)` — heap usage in bytes before a GC by id.
- `HEAP_AFTER_GC(gc_id)` — heap usage in bytes after a GC by id.
- `GC_TYPE(gc_id)` — GC type label for an id.
- `reclaim_mb(gc_id)` — megabytes reclaimed by a GC (heap before minus heap after).
- `recording_start()` — timestamp of the first event.
- `recording_end()` — timestamp of the last event.
- `relative_ms(ts)` — milliseconds since `recording_start()`.
- `time_since(prev_ts, ts)` — elapsed time between two timestamps.
- `bucket_ms(ts, width_ms)` — bucket a timestamp into fixed-width windows, returning an epoch integer.
- `bucket_time(ts, width_ms)` — same as `bucket_ms` but returns a `TIMESTAMP`, suitable for time-axis plots.
- `in_range(ts, t_start, t_end)` — boolean range test.

### Event & stack helpers

- `EVENT_TYPE_LABEL(et)` — human-readable label for an event type id.
- `EVENT_NAME_FOR_ID(id)` — event name for an event id.
- `stack_frames(col)` — extracts frame list from a stack-trace column for use with FLAMEGRAPH.

### Introspection

- `view_sql(name)` — return the SQL text of a named view.
- `macro_sql(macro_name)` — return the SQL text of a named macro.

## See also

- [Notebook Format](notebook-format.md)
- [Plot DSL](plot-dsl.md)
- [Variables](variables.md)
