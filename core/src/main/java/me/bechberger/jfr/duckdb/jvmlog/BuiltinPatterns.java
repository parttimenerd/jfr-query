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

            // jvmlog_gc_init: worker counts
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
                    FieldDef.of("pauseMs", FieldType.DOUBLE)),
                "jvmlog_gc_event"),

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
                "jvmlog_g1_ergonomics")
        );
    }

    /** Build a fully-loaded registry: builtin Java patterns + builtin YAML + optional user YAML. */
    public static PatternRegistry createRegistry(Optional<Path> userPatternsDir) {
        var registry = new PatternRegistry();
        registry.addPatterns(all());
        registry.addPatterns(YamlPatternLoader.fromClasspath("jvmlog-patterns/builtin"));
        userPatternsDir.ifPresent(dir ->
            registry.addPatterns(YamlPatternLoader.fromDirectory(dir)));
        return registry;
    }
}
