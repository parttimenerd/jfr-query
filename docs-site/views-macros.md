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
- `gc-efficiency`
- `gc-overhead`
- `gc-parallel-phases`
- `gc-pause-distribution`
- `gc-pause-phases`
- `gc-pauses`
- `gc-phase-breakdown`
- `gc-references`
- `gc-throughput`
- `gc-top-pauses`
- `gc-young-vs-old`
- `heap-committed-vs-used`
- `heap-configuration`
- `heap-summary-over-time`
- `blocked-by-system-gc`
- `native-memory-committed`
- `native-memory-reserved`
- `object-statistics`
- `finalizers`
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
- `native-flamegraph`

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
- `format_memory(bytes, decimals:=2)` — humanised byte count.
- `format_duration(seconds, decimals:=2)` — humanised duration from seconds.
- `format_human_duration(sec)` — coarse humanised duration.
- `format_hex(i)` — hexadecimal representation.

### Time & GC helpers

- `before_gc(ts)` — GC event immediately before `ts`.
- `after_gc(ts)` — GC event immediately after `ts`.
- `duration_since_last_gc(ts)` — time since previous GC.
- `HEAP_BEFORE_GC(gc_id)` — heap usage before a GC by id.
- `HEAP_AFTER_GC(gc_id)` — heap usage after a GC by id.
- `GC_TYPE(gc_id)` — GC type label for an id.
- `recording_start()` — timestamp of the first event.
- `recording_end()` — timestamp of the last event.
- `relative_ms(ts)` — milliseconds since `recording_start()`.
- `time_since(prev_ts, ts)` — elapsed time between two timestamps.
- `time_bucket(ts, width_ms)` — bucket a timestamp into fixed-width windows.
- `in_range(ts, t_start, t_end)` — boolean range test.

### Event & stack helpers

- `EVENT_TYPE_LABEL(et)` — human-readable label for an event type id.
- `EVENT_NAME_FOR_ID(id)` — event name for an event id.
- `stack_frames(methods)` — flatten a stack into a list of frame labels.

### Introspection

- `view_sql(name)` — return the SQL text of a named view.
- `macro_sql(macro_name)` — return the SQL text of a named macro.

## See also

- [Notebook Format](notebook-format.md)
- [Plot DSL](plot-dsl.md)
- [Variables](variables.md)
