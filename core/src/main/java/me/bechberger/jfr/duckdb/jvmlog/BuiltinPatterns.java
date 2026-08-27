package me.bechberger.jfr.duckdb.jvmlog;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

public final class BuiltinPatterns {

    private BuiltinPatterns() {}

    public static List<LogPattern> all() {
        return List.of(
            // jvmlog_gc_init: GC algorithm (tags: gc only)
            // e.g.: Using G1  /  Using The Z Garbage Collector
            new JavaLogPattern("gc_init_algorithm",
                List.of("gc"), LogLevel.INFO,
                "^Using (.+)$",
                List.of(FieldDef.of("algorithm", FieldType.STRING)),
                "jvmlog_gc_init"),

            // jvmlog_gc_init: JDK version
            new JavaLogPattern("gc_init_version",
                List.of("gc", "init"), LogLevel.INFO,
                "^Version: (.+)$",
                List.of(FieldDef.of("jdkVersion", FieldType.STRING)),
                "jvmlog_gc_init"),

            // jvmlog_gc_init: heap capacities (G1/Parallel style: "Heap Min Capacity: 256M")
            new JavaLogPattern("gc_init_heap_min",
                List.of("gc", "init"), LogLevel.INFO,
                "^Heap Min Capacity: (\\d+[KMG]?)$",
                List.of(FieldDef.of("minHeap", FieldType.BYTES)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_heap_initial",
                List.of("gc", "init"), LogLevel.INFO,
                "^Heap Initial Capacity: (\\d+[KMG]?)$",
                List.of(FieldDef.of("initialHeap", FieldType.BYTES)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_heap_max",
                List.of("gc", "init"), LogLevel.INFO,
                "^Heap Max Capacity: (\\d+[KMG]?)$",
                List.of(FieldDef.of("maxHeap", FieldType.BYTES)),
                "jvmlog_gc_init"),

            // ZGC uses different names: "Min Capacity: 256M"
            new JavaLogPattern("gc_init_heap_min_zgc",
                List.of("gc", "init"), LogLevel.INFO,
                "^Min Capacity: (\\d+[KMG]?)$",
                List.of(FieldDef.of("minHeap", FieldType.BYTES)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_heap_initial_zgc",
                List.of("gc", "init"), LogLevel.INFO,
                "^Initial Capacity: (\\d+[KMG]?)$",
                List.of(FieldDef.of("initialHeap", FieldType.BYTES)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_heap_max_zgc",
                List.of("gc", "init"), LogLevel.INFO,
                "^Max Capacity: (\\d+[KMG]?)$",
                List.of(FieldDef.of("maxHeap", FieldType.BYTES)),
                "jvmlog_gc_init"),

            // jvmlog_gc_init: worker counts (G1/Parallel style)
            new JavaLogPattern("gc_init_parallel_workers",
                List.of("gc", "init"), LogLevel.INFO,
                "^Parallel Workers: (\\d+)$",
                List.of(FieldDef.of("parallelWorkers", FieldType.INT)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_concurrent_workers",
                List.of("gc", "init"), LogLevel.INFO,
                "^Concurrent Workers: (\\d+)$",
                List.of(FieldDef.of("concurrentWorkers", FieldType.INT)),
                "jvmlog_gc_init"),

            // jvmlog_gc_init: G1 debug-level thread counts: "ConcGCThreads: 3 offset 22"
            new JavaLogPattern("gc_init_conc_threads",
                List.of("gc"), LogLevel.DEBUG,
                "^ConcGCThreads: (\\d+).*$",
                List.of(FieldDef.of("concurrentWorkers", FieldType.INT)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_parallel_threads",
                List.of("gc"), LogLevel.DEBUG,
                "^ParallelGCThreads: (\\d+)$",
                List.of(FieldDef.of("parallelWorkers", FieldType.INT)),
                "jvmlog_gc_init"),

            // jvmlog_gc_init: G1 debug heap line — "Minimum heap N  Initial heap N  Maximum heap N"
            new JavaLogPattern("gc_init_heap_debug",
                List.of("gc", "heap"), LogLevel.DEBUG,
                "^Minimum heap (\\d+)\\s+Initial heap (\\d+)\\s+Maximum heap (\\d+)$",
                List.of(
                    FieldDef.of("minHeap", FieldType.BYTES),
                    FieldDef.of("initialHeap", FieldType.BYTES),
                    FieldDef.of("maxHeap", FieldType.BYTES)),
                "jvmlog_gc_init"),

            // jvmlog_gc_init: ZGC-specific init fields
            new JavaLogPattern("gc_init_zgc_name",
                List.of("gc", "init"), LogLevel.INFO,
                "^Initializing The Z Garbage Collector$",
                List.of(FieldDef.constant("algorithm", FieldType.STRING, "ZGC")),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_numa",
                List.of("gc", "init"), LogLevel.INFO,
                "^NUMA Support: (\\S+)$",
                List.of(FieldDef.of("numaSupport", FieldType.STRING)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_cpus",
                List.of("gc", "init"), LogLevel.INFO,
                "^CPUs: (\\d+) total, (\\d+) available$",
                List.of(
                    FieldDef.of("cpuTotal", FieldType.INT),
                    FieldDef.of("cpuAvailable", FieldType.INT)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_memory",
                List.of("gc", "init"), LogLevel.INFO,
                "^Memory: (\\d+[KMG]?)$",
                List.of(FieldDef.of("physicalMemory", FieldType.BYTES)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_large_page",
                List.of("gc", "init"), LogLevel.INFO,
                "^Large Page Support: (\\S+)$",
                List.of(FieldDef.of("largePagingSupport", FieldType.STRING)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_soft_max",
                List.of("gc", "init"), LogLevel.INFO,
                "^Soft Max Capacity: (\\d+[KMG]?)$",
                List.of(FieldDef.of("softMaxCapacity", FieldType.BYTES)),
                "jvmlog_gc_init"),

            // ZGC: "GC Workers for Old Generation: 2 (dynamic)"
            new JavaLogPattern("gc_init_workers_old",
                List.of("gc", "init"), LogLevel.INFO,
                "^GC Workers for Old Generation: (\\d+).*$",
                List.of(FieldDef.of("workersOldGen", FieldType.INT)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_workers_young",
                List.of("gc", "init"), LogLevel.INFO,
                "^GC Workers for Young Generation: (\\d+).*$",
                List.of(FieldDef.of("workersYoungGen", FieldType.INT)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_workers_max",
                List.of("gc", "init"), LogLevel.INFO,
                "^GC Workers Max: (\\d+).*$",
                List.of(FieldDef.of("workersMax", FieldType.INT)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_runtime_workers",
                List.of("gc", "init"), LogLevel.INFO,
                "^Runtime Workers: (\\d+)$",
                List.of(FieldDef.of("runtimeWorkers", FieldType.INT)),
                "jvmlog_gc_init"),

            // jvmlog_gc_init: compressed oops (G1 has "Compressed Oops: Enabled (Zero based)")
            new JavaLogPattern("gc_init_compressed_oops",
                List.of("gc", "init"), LogLevel.INFO,
                "^Compressed Oops: (\\S+).*$",
                List.of(FieldDef.of("compressedOops", FieldType.STRING)),
                "jvmlog_gc_init"),

            // jvmlog_gc_init: G1-specific init fields
            new JavaLogPattern("gc_init_card_table",
                List.of("gc", "init"), LogLevel.INFO,
                "^CardTable entry size: (\\d+)$",
                List.of(FieldDef.of("cardTableEntrySize", FieldType.INT)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_heap_region_size",
                List.of("gc", "init"), LogLevel.INFO,
                "^Heap Region Size: (\\d+[KMG]?)$",
                List.of(FieldDef.of("heapRegionSize", FieldType.BYTES)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_refinement_workers",
                List.of("gc", "init"), LogLevel.INFO,
                "^Concurrent Refinement Workers: (\\d+)$",
                List.of(FieldDef.of("refinementWorkers", FieldType.INT)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_periodic_gc",
                List.of("gc", "init"), LogLevel.INFO,
                "^Periodic GC: (\\S+)$",
                List.of(FieldDef.of("periodicGc", FieldType.STRING)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_pretouch",
                List.of("gc", "init"), LogLevel.INFO,
                "^Pre-touch: (\\S+)$",
                List.of(FieldDef.of("preTouch", FieldType.STRING)),
                "jvmlog_gc_init"),

            // Parallel GC: "Alignments: Space 512K, Generation 512K, Heap 8M"
            new JavaLogPattern("gc_init_alignments",
                List.of("gc", "init"), LogLevel.INFO,
                "^Alignments: Space (\\d+[KMG]?), Generation (\\d+[KMG]?), Heap (\\d+[KMG]?)$",
                List.of(
                    FieldDef.of("alignSpace", FieldType.BYTES),
                    FieldDef.of("alignGeneration", FieldType.BYTES),
                    FieldDef.of("alignHeap", FieldType.BYTES)),
                "jvmlog_gc_init"),

            // ZGC-specific init: address space / reserved space
            new JavaLogPattern("gc_init_address_space",
                List.of("gc", "init"), LogLevel.INFO,
                "^Address Space Size: (.+)$",
                List.of(FieldDef.of("addressSpaceSize", FieldType.STRING)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_reserved_space",
                List.of("gc", "init"), LogLevel.INFO,
                "^Reserved Space Size: (\\d+[KMG]?)$",
                List.of(FieldDef.of("reservedSpaceSize", FieldType.BYTES)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_uncommit",
                List.of("gc", "init"), LogLevel.INFO,
                "^Uncommit: (.+)$",
                List.of(FieldDef.of("uncommitPolicy", FieldType.STRING)),
                "jvmlog_gc_init"),

            new JavaLogPattern("gc_init_page_size_medium",
                List.of("gc", "init"), LogLevel.INFO,
                "^Page Size Medium: (.+)$",
                List.of(FieldDef.of("pageSizeMedium", FieldType.STRING)),
                "jvmlog_gc_init"),

            // jvmlog_gc_event: ZGC-style Garbage Collection (no subtype paren): "GC(0) Garbage Collection (Allocation Rate) 128M(25%)->64M(12%)"
            new JavaLogPattern("gc_zgc_collection",
                List.of("gc"), LogLevel.INFO,
                "^GC\\((\\d+)\\) Garbage Collection \\((.+?)\\)(?:\\s+[\\d.]+[KMG]?\\(\\d+%\\)->[\\d.]+[KMG]?\\(\\d+%\\))?$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("cause", FieldType.STRING),
                    FieldDef.constant("gcType", FieldType.STRING, "Garbage Collection"),
                    FieldDef.nullable("uptimeSecs", FieldType.DOUBLE)),
                "jvmlog_gc_event"),

            // jvmlog_zgc_phases: ZGC non-generational STW pauses (tags: z,gc — more specific than [gc])
            // These must appear BEFORE gc_zgc_concurrent_phase so they claim [z,gc] STW lines first.
            // e.g.: GC(0) Pause Mark Start 0.456ms
            new JavaLogPattern("zgc_pause_mark_start",
                List.of("z", "gc"), LogLevel.INFO,
                "^GC\\((\\d+)\\) Pause Mark Start ([\\d.]+)ms$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("durationMs", FieldType.DOUBLE),
                    FieldDef.constant("phaseName", FieldType.STRING, "Pause Mark Start"),
                    FieldDef.constant("generation", FieldType.STRING, "N/A"),
                    FieldDef.constant("concurrent", FieldType.BOOLEAN, false)),
                "jvmlog_zgc_phases"),

            // e.g.: GC(0) Pause Mark End 0.234ms
            new JavaLogPattern("zgc_pause_mark_end",
                List.of("z", "gc"), LogLevel.INFO,
                "^GC\\((\\d+)\\) Pause Mark End ([\\d.]+)ms$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("durationMs", FieldType.DOUBLE),
                    FieldDef.constant("phaseName", FieldType.STRING, "Pause Mark End"),
                    FieldDef.constant("generation", FieldType.STRING, "N/A"),
                    FieldDef.constant("concurrent", FieldType.BOOLEAN, false)),
                "jvmlog_zgc_phases"),

            // e.g.: GC(0) Pause Relocate Start 0.123ms
            new JavaLogPattern("zgc_pause_relocate_start",
                List.of("z", "gc"), LogLevel.INFO,
                "^GC\\((\\d+)\\) Pause Relocate Start ([\\d.]+)ms$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("durationMs", FieldType.DOUBLE),
                    FieldDef.constant("phaseName", FieldType.STRING, "Pause Relocate Start"),
                    FieldDef.constant("generation", FieldType.STRING, "N/A"),
                    FieldDef.constant("concurrent", FieldType.BOOLEAN, false)),
                "jvmlog_zgc_phases"),

            // ZGC concurrent phases into jvmlog_zgc_phases (must come before gc_zgc_concurrent_phase
            // which uses generic [gc] tags and would steal [z,gc] lines).
            // Longer alternatives first so "Mark Free" beats "Mark".
            new JavaLogPattern("zgc_concurrent_phase_to_zgc_table",
                List.of("z", "gc"), LogLevel.INFO,
                "^GC\\((\\d+)\\) Concurrent (Process Non-Strong References|Reset Relocation Set|Select Relocation Set|Mark Free|Relocate|Mark) ([\\d.]+)ms$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("phaseName", FieldType.STRING),
                    FieldDef.of("durationMs", FieldType.DOUBLE),
                    FieldDef.constant("generation", FieldType.STRING, "N/A"),
                    FieldDef.constant("concurrent", FieldType.BOOLEAN, true)),
                "jvmlog_zgc_phases"),

            // jvmlog_gc_phase: ZGC/G1 concurrent phase (generic [gc] tag, e.g. "GC(0) Concurrent Cycle 145ms")
            new JavaLogPattern("gc_zgc_concurrent_phase",
                List.of("gc"), LogLevel.INFO,
                "^GC\\((\\d+)\\) Concurrent (\\S.*?) ([\\d.]+)ms$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("phaseName", FieldType.STRING),
                    FieldDef.of("durationMs", FieldType.DOUBLE)),
                "jvmlog_gc_phase"),

            // jvmlog_gc_event: GC pause events
            // e.g. (G1): GC(0) Pause Young (Normal) (G1 Evacuation Pause) 10M->5M(256M) 3.14ms
            //      (Parallel): GC(0) Pause Young (Normal) 3.14ms
            // The subtype paren group "(Normal)" is optional; cause is always the last paren group.
            new JavaLogPattern("gc_pause_event",
                List.of("gc"), LogLevel.INFO,
                "^GC\\((\\d+)\\) Pause (\\S+) (?:\\([^)]+\\) )?\\((.+?)\\)(?:\\s+\\d+[KMG]?->\\d+[KMG]?\\(\\d+[KMG]?\\))? ([\\d.]+)ms$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("gcType", FieldType.STRING),
                    FieldDef.of("cause", FieldType.STRING),
                    FieldDef.of("pauseMs", FieldType.DOUBLE),
                    FieldDef.nullable("uptimeSecs", FieldType.DOUBLE)),
                "jvmlog_gc_event"),

            // G1 STW pauses without explicit cause: "GC(5) Pause Remark 1.23ms"
            // e.g. Pause Remark, Pause Cleanup (G1 concurrent cycle STW pauses)
            new JavaLogPattern("gc_pause_event_no_cause",
                List.of("gc"), LogLevel.INFO,
                "^GC\\((\\d+)\\) Pause (Remark|Cleanup) ([\\d.]+)ms$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("gcType", FieldType.STRING),
                    FieldDef.of("pauseMs", FieldType.DOUBLE),
                    FieldDef.nullable("uptimeSecs", FieldType.DOUBLE)),
                "jvmlog_gc_event"),

            // G1 concurrent phase events: "GC(5) Concurrent Cycle 145.123ms" (with [gc] tag, not [gc,phases])
            // Already handled by gc_zgc_concurrent_phase which matches tags=[gc] + "GC(N) Concurrent ... ms"

            // jvmlog_gc_phase: phase timings
            // e.g.: GC(0)   Pre Evacuate Collection Set: 0.01ms
            new JavaLogPattern("gc_phase",
                List.of("gc", "phases"), LogLevel.INFO,
                "^GC\\((\\d+)\\)\\s+(.+?): ([\\d.]+)ms$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("phaseName", FieldType.STRING),
                    FieldDef.of("durationMs", FieldType.DOUBLE)),
                "jvmlog_gc_phase"),

            // jvmlog_heap_snapshot: heap before/after GC
            // e.g.: GC(0) Heap: 128M(256M)->64M(256M)
            new JavaLogPattern("gc_heap_snapshot",
                List.of("gc", "heap"), LogLevel.INFO,
                "^GC\\((\\d+)\\) Heap: (\\d+[KMG]?)\\((\\d+[KMG]?)\\)->(\\d+[KMG]?)\\((\\d+[KMG]?)\\)$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("heapBefore", FieldType.BYTES),
                    FieldDef.of("heapCommittedBefore", FieldType.BYTES),
                    FieldDef.of("heapAfter", FieldType.BYTES),
                    FieldDef.of("heapCommittedAfter", FieldType.BYTES)),
                "jvmlog_heap_snapshot"),

            // jvmlog_g1_ergonomics: heap expand
            // e.g.: Expand the heap. requested expansion amount: 268435456B expansion amount: 268435456B
            new JavaLogPattern("g1_ergo_heap_expand",
                List.of("gc", "ergo", "heap"), LogLevel.DEBUG,
                "^Expand the heap\\. requested expansion amount: (\\d+[KMGkmg]?B?) expansion amount: (\\d+[KMGkmg]?B?)$",
                List.of(
                    FieldDef.of("requestedExpansionBytes", FieldType.BYTES),
                    FieldDef.of("actualExpansionBytes", FieldType.BYTES),
                    FieldDef.constant("decision", FieldType.STRING, "expand")),
                "jvmlog_g1_ergonomics"),

            // jvmlog_g1_ergonomics: heap shrink
            // e.g.: Shrink the heap. requested shrinking amount: 268435456B shrinking amount: 268435456B
            new JavaLogPattern("g1_ergo_heap_shrink",
                List.of("gc", "ergo", "heap"), LogLevel.DEBUG,
                "^Shrink the heap\\. requested shrinking amount: (\\d+[KMGkmg]?B?) shrinking amount: (\\d+[KMGkmg]?B?)$",
                List.of(
                    FieldDef.nullable("requestedExpansionBytes", FieldType.BYTES),
                    FieldDef.of("actualExpansionBytes", FieldType.BYTES),
                    FieldDef.constant("decision", FieldType.STRING, "shrink")),
                "jvmlog_g1_ergonomics"),

            // jvmlog_g1_ergonomics: attempt heap shrink
            // e.g.: Attempt heap shrinking (capacity 10485760). Capacity is at minimum. Won't shrink.
            new JavaLogPattern("g1_ergo_no_shrink",
                List.of("gc", "ergo", "heap"), LogLevel.DEBUG,
                "^Attempt heap shrinking.*Won't shrink\\.$",
                List.of(
                    FieldDef.nullable("requestedExpansionBytes", FieldType.BYTES),
                    FieldDef.nullable("actualExpansionBytes", FieldType.BYTES),
                    FieldDef.constant("decision", FieldType.STRING, "no-shrink")),
                "jvmlog_g1_ergonomics"),

            // jvmlog_zgc_phases: ZGC generational collection boundaries (JDK 21+, tags: z,gc)
            // e.g.: GC(0) Young Collection 45.678ms
            new JavaLogPattern("zgc_young_collection",
                List.of("z", "gc"), LogLevel.INFO,
                "^GC\\((\\d+)\\) Young Collection ([\\d.]+)ms$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("durationMs", FieldType.DOUBLE),
                    FieldDef.constant("phaseName", FieldType.STRING, "Young Collection"),
                    FieldDef.constant("generation", FieldType.STRING, "Young"),
                    FieldDef.constant("concurrent", FieldType.BOOLEAN, true)),
                "jvmlog_zgc_phases"),

            // e.g.: GC(0) Old Collection 123.456ms
            new JavaLogPattern("zgc_old_collection",
                List.of("z", "gc"), LogLevel.INFO,
                "^GC\\((\\d+)\\) Old Collection ([\\d.]+)ms$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("durationMs", FieldType.DOUBLE),
                    FieldDef.constant("phaseName", FieldType.STRING, "Old Collection"),
                    FieldDef.constant("generation", FieldType.STRING, "Old"),
                    FieldDef.constant("concurrent", FieldType.BOOLEAN, true)),
                "jvmlog_zgc_phases"),

            // e.g.: GC(0) Major Collection 200.0ms
            new JavaLogPattern("zgc_major_collection",
                List.of("z", "gc"), LogLevel.INFO,
                "^GC\\((\\d+)\\) Major Collection ([\\d.]+)ms$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("durationMs", FieldType.DOUBLE),
                    FieldDef.constant("phaseName", FieldType.STRING, "Major Collection"),
                    FieldDef.constant("generation", FieldType.STRING, "Old"),
                    FieldDef.constant("concurrent", FieldType.BOOLEAN, true)),
                "jvmlog_zgc_phases"),

            // jvmlog_parallel_sizing: Parallel/Serial GC heap generation sizes (tags: gc,heap)
            // e.g.: GC(0) PSYoungGen: 128M->32M(192M)  /  GC(0) ParOldGen: 64M->72M(192M)
            new JavaLogPattern("parallel_young_gen_sizing",
                List.of("gc", "heap"), LogLevel.INFO,
                "^GC\\((\\d+)\\) (?:PSYoungGen|DefNew|ParNew|NewGen): (\\d+[KMG]?)->\\d+[KMG]?\\((\\d+[KMG]?)\\)$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("youngGenBytes", FieldType.BYTES),
                    FieldDef.of("youngGenCapacity", FieldType.BYTES)),
                "jvmlog_parallel_sizing"),

            new JavaLogPattern("parallel_old_gen_sizing",
                List.of("gc", "heap"), LogLevel.INFO,
                "^GC\\((\\d+)\\) (?:ParOldGen|Tenured|OldGen|PSOldGen): (\\d+[KMG]?)->\\d+[KMG]?\\((\\d+[KMG]?)\\)$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("oldGenBytes", FieldType.BYTES),
                    FieldDef.of("oldGenCapacity", FieldType.BYTES)),
                "jvmlog_parallel_sizing"),

            // Parallel GC throughput from ergo: "Throughput: 99.0"
            new JavaLogPattern("parallel_throughput",
                List.of("gc", "ergo"), LogLevel.DEBUG,
                "^GC\\((\\d+)\\)\\s+Throughput:\\s+([\\d.]+)$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("throughputPct", FieldType.DOUBLE)),
                "jvmlog_parallel_sizing"),

            // jvmlog_zgc_director: ZGC director decisions (tags: gc,director)
            // e.g.: GC(0) Selection: Allocation Rate
            new JavaLogPattern("zgc_director_selection",
                List.of("gc", "director"), LogLevel.DEBUG,
                "^GC\\((\\d+)\\) Selection: (.+)$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("ruleName", FieldType.STRING)),
                "jvmlog_zgc_director"),

            // e.g.: GC(0) Allocation Rate: 125.3 MB/s
            new JavaLogPattern("zgc_director_alloc_rate",
                List.of("gc", "director"), LogLevel.DEBUG,
                "^GC\\((\\d+)\\) Allocation Rate:\\s+([\\d.]+) MB/s$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("allocationRateMbps", FieldType.DOUBLE)),
                "jvmlog_zgc_director"),

            // e.g.: GC(0) Free Heap: 25.0%
            new JavaLogPattern("zgc_director_free_heap",
                List.of("gc", "director"), LogLevel.DEBUG,
                "^GC\\((\\d+)\\) Free Heap:\\s+([\\d.]+)%$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("freeHeapPct", FieldType.DOUBLE)),
                "jvmlog_zgc_director"),

            // e.g.: GC(0) Time Until OOM: 8.3 s
            new JavaLogPattern("zgc_director_time_to_oom",
                List.of("gc", "director"), LogLevel.DEBUG,
                "^GC\\((\\d+)\\) Time Until OOM:\\s+([\\d.]+) s$",
                List.of(
                    FieldDef.of("gcId", FieldType.INT),
                    FieldDef.of("timeUntilOomSecs", FieldType.DOUBLE)),
                "jvmlog_zgc_director")
        );
    }

    /** Build a fully-loaded registry: builtin Java patterns + builtin YAML + optional user YAML. */
    public static PatternRegistry createRegistry(Optional<Path> userPatternsDir) {
        var registry = new PatternRegistry();
        registry.addPatterns(all());
        registry.addPatterns(YamlPatternLoader.fromClasspath("jvmlog-patterns/builtin"));
        userPatternsDir.ifPresent(dir ->
            registry.addPatterns(YamlPatternLoader.fromDirectory(dir)));
        userPatternsDir.ifPresent(registry::startWatching);
        return registry;
    }
}
