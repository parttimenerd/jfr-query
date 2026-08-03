# JFR GC Analysis — Research Backlog

Generated: 2026-08-03

## What's Already In The Template

The `gc-analysis.md` template shipped with the following cells (before this session):

1. `intro` — overview and required-events summary
2. `overview` — recording start/end/duration
3. `gc-config` — GC & heap configuration (collector, threads, pause target)
4. `pause-summary` — total STW time per cause (bar chart)
5. `long-pauses-section` — long-pause drill-down (conditional on `$$threshold_ms`)
6. `phase-breakdown` — pause percentiles by phase
7. `heap-over-time` — heap used before/after each GC (LINK_X)
8. `allocation-rate` — sampled allocation rate MB/s (LINK_X)
9. `gc-overhead` — GC overhead % per 10s window (LINK_X)
10. `pause-histogram` — pause duration distribution (log bins)
11. `concurrent-phases` — concurrent GC phase Gantt timeline (LINK_X)
12. `gc-allocation-trigger` — application methods triggering GC
13. `gc-references` — Soft/Weak/Phantom/Final reference counts (LINK_X)
14. `system-gc-blockers` — explicit System.gc() callers
15. `metaspace` — metaspace usage over time (LINK_X)
16. `g1-regions` — G1 Eden/Survivor/Old region breakdown (LINK_X)
17. `tenuring` — survivor tenuring distribution
18. `jvm-memory-size` — heap allocated vs peak used
19. `gc-duration-buckets` — pause duration range histogram
20. `gc-phase-stats` — per-phase stats with stddev
21. `pause-vs-concurrent` — STW vs concurrent time split (pie)
22. `object-stats` — total allocation and average rate
23. `cpu-stats` — GC CPU time summary
24. `safepoint-summary` — safepoint STW summary
25. `consecutive-full-gcs` — back-to-back Full GC detection
26. `promotion-rate` — old-gen growth per GC (G1) (LINK_X)
27. `gc-throughput` — application throughput % per 10s window (LINK_X)
28. `parallel-phases` — parallel GC phase stats
29. `tlab-efficiency` — TLAB fill ratio over time (LINK_X)
30. `finalizers` — finalizer queue depth by class

## New Cells Added This Session

| Cell | JFR event dependency | Plots |
|------|----------------------|-------|
| `gc-pause-over-time` | `GarbageCollection` | SCATTER (LINK_X, ZOOM) |
| `gc-young-old-time` | `GarbageCollection` | BAR_CHART grouped + PIE_CHART |
| `gc-pause-cause-over-time` | `GarbageCollection` | AREA_CHART stacked (LINK_X, ZOOM) |
| `gc-eden-size` | `G1HeapSummary` | LINE_CHART (LINK_X, ZOOM) |
| `gc-safepoint-distribution` | `SafepointBegin` + `SafepointEnd` | HISTOGRAM (log bins) |
| `gc-allocation-by-class` | `ObjectAllocationSample` | BAR_CHART horizontal |
| `gc-thread-allocation` | `ObjectAllocationSample` | BAR_CHART horizontal |
| `gc-old-gen-growth` | `G1HeapSummary` | LINE_CHART (LINK_X, ZOOM) |

New SQL views added to `builtinSql.ts` (`CONDITIONAL_VIEWS_SQL`):
`gc-young-old-time`, `gc-pause-over-time`, `gc-humongous`, `gc-pause-cause-over-time`,
`gc-eden-size`, `gc-safepoint-distribution`, `gc-allocation-by-class`,
`gc-thread-allocation`, `gc-old-gen-growth` (9 views).

### Schema corrections applied

The originally-drafted SQL referenced columns that do not exist in this project's
JFR schema. Corrected against the existing views:

- `G1HeapSummary` uses `edenUsedSize` / `survivorUsedSize` / `oldGenUsedSize`
  (not `edenUsed` / `edenSize` / `survivorUsed`). It has no allocated "eden size"
  column, so `gc-eden-size` charts *used* Eden + Survivor only.
- `GCHeapSummary` has **no** `oldSize` column — old-gen figures come from
  `G1HeapSummary.oldGenUsedSize`. `gc-old-gen-growth` was therefore rebased on
  `G1HeapSummary` (and its cellCondition requires `G1HeapSummary`, not
  `GCHeapSummary`).
- `SafepointBegin` has no `duration` / `name`; TTSP is computed as
  `SafepointEnd.startTime - SafepointBegin.startTime` joined on `safepointId`.
- `ObjectAllocationSample.objectClass` is an ID → join `Class._id`;
  `eventThread` is an ID → join `Thread._id`; `weight` is bytes.
- Used the project's `bucket_time(ts, ms)` macro instead of DuckDB
  `time_bucket(INTERVAL ...)` to match the existing GC views and keep a
  TIMESTAMP axis for LINK_X.

## Quick Wins (Views Exist, No Cell Yet)

These views live in `builtinSql.ts` but have no dedicated template cell:

- `gc-humongous` — humongous allocation collections (added this session, no cell yet;
  candidate scatter/timeline cell for G1 fragmentation analysis)
- `heap-committed-vs-used` — committed vs used heap MB over time
- `gc-efficiency` — MB/s reclaimed per GC
- `gc-top-pauses` — 20 longest individual phase pauses
- `allocation-by-site` — allocation pressure by call site (method)
- `object-statistics` — object counts after GC by class
- `gc-time-split` — already surfaced via `pause-vs-concurrent`

## Researched Improvement Ideas

### High Value
- **G1 Evacuation Failure Detection** — JFR events around evacuation failure /
  `PromotionFailed` causes. Signals premature promotion / to-space exhaustion.
  View needed: count per GC, linked to the heap timeline.
- **ZGC Pause Breakdown** — `ZGCPausePhase`-style events. ZGC should have sub-1ms
  pauses; any pause > 1ms warrants investigation.
- **Shenandoah Cycle Analysis** — region state-change events show region state
  transitions during GC cycles.
- **Class Loading Correlation** — `ClassLoad` events correlated with Metaspace
  growth. Class-loader leaks become visible here (`longest-class-loading` view exists).
- **Finalization Queue Depth Over Time** — extend `FinalizerStatistics` into a
  time series rather than a per-class snapshot.
- **Deoptimization Events** — `Deoptimization` correlated with GC pauses
  (deopt can increase allocation and disrupt inlining).

### Medium Value
- **GC Log Rate** — count of GC events per time window as a single GC-pressure metric.
- **Concurrent Phase Stall Detection** — `GCPhaseConcurrent` phases whose duration
  exceeds the concurrent budget, meaning the mutator had to wait.
- **Per-CPU GC Time Timeline** — `GCCPUTime` broken into user/system/real over time
  (currently only a summary table).
- **Native Memory Pressure** — `NativeMemoryUsage` events: total committed vs JVM
  heap; useful for containerized deployments.
- **TLAB Waste Rate** — `ObjectAllocationOutsideTLAB` / total allocation ratio
  (high outside-TLAB = large allocations forcing GC).

### Research / Stretch Goals
- **ML Anomaly Detection on Pause Times** — flag statistically unusual GC pauses
  (z-score > 3 on a rolling window).
- **GC Tuning Advisor** — rule-based suggestions (P99 > 200ms → suggest tuning,
  consecutive Full GCs → alert memory leak, etc.).
- **Comparative Analysis** — load two JFR recordings side-by-side to compare GC
  behavior before/after a change.
- **Humongous Allocation Tracker** — correlate heap-region events to find what
  triggered humongous allocations.
- **G1 Region Heatmap** — visual grid of G1 heap regions colored by state
  (Eden/Survivor/Old/Humongous) over time.

## JFR Event Coverage

| Event | Used | Views |
|-------|------|-------|
| GarbageCollection | Yes | pause-summary, gc-pauses, gc-overhead, gc-young-old-time (new), gc-pause-over-time (new), gc-pause-cause-over-time (new), gc-humongous (new) |
| GCPhasePause | Yes | phase-breakdown, gc-phase-stats, gc-duration-buckets |
| GCPhaseConcurrent | Yes | concurrent-phases, gc-time-split |
| GCPhaseParallel | Yes | gc-parallel-phases |
| GCHeapSummary | Yes | heap-over-time, heap-committed-vs-used, gc-efficiency |
| G1HeapSummary | Yes | g1-heap-regions, gc-promotion-rate, gc-eden-size (new), gc-old-gen-growth (new) |
| MetaspaceSummary | Yes | metaspace-over-time |
| ObjectAllocationSample | Yes | allocation-rate, allocation-by-class, gc-allocation-by-class (new), gc-thread-allocation (new) |
| ObjectAllocationInNewTLAB | Yes | tlab-efficiency, tlabs |
| AllocationRequiringGC | Yes | gc-allocation-trigger |
| SafepointBegin | Yes | safepoint-overhead, gc-safepoint-distribution (new) |
| SafepointEnd | Yes | safepoints, gc-safepoint-summary |
| GCCPUTime | Yes | gc-cpu-time |
| TenuringDistribution | Yes | tenuring-distribution |
| GCHeapConfiguration | Yes | gc-memory-size, heap-configuration |
| GCReferenceStatistics | Yes | gc-references |
| SystemGC | Yes | system-gc-blockers |
| FinalizerStatistics | Yes | finalizers |
| G1_EVACUATION_FAILURE | No | Not yet implemented |
| ZGCPausePhase | No | Not yet implemented |
| ShenandoahHeapRegionStateChange | No | Not yet implemented |
| Deoptimization | No | Not yet implemented |
| NativeMemoryUsage | No | Not yet implemented |
| ObjectAllocationOutsideTLAB | No | Not yet implemented |
