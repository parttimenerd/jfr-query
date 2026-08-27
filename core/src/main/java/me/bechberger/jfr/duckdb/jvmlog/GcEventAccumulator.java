package me.bechberger.jfr.duckdb.jvmlog;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.function.Consumer;

public final class GcEventAccumulator {

    private final Consumer<MatchResult> sink;
    private final Deque<MatchResult> buffer = new ArrayDeque<>();

    public GcEventAccumulator(Consumer<MatchResult> sink) {
        this.sink = sink;
    }

    public void accumulate(MatchResult result) {
        buffer.add(result);
    }

    public void flushAll() {
        MatchResult r;
        while ((r = buffer.poll()) != null) {
            sink.accept(r);
        }
    }
}
