package me.bechberger.jfr.duckdb.jvmlog;

import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class GcEventAccumulatorTest {

    @Test
    void sameGcIdMergesRows() {
        var flushed = new ArrayList<MatchResult>();
        var acc = new GcEventAccumulator(flushed::add);
        var fields = List.of(FieldDef.of("gcId", FieldType.INT), FieldDef.of("phaseName", FieldType.STRING), FieldDef.of("durationMs", FieldType.DOUBLE));
        acc.accumulate(new MatchResult("jvmlog_gc_phase", fields, List.of(42, "Mark", 1.2)));
        acc.accumulate(new MatchResult("jvmlog_gc_phase", fields, List.of(42, "Sweep", 0.5)));
        acc.flushAll();
        assertThat(flushed).hasSize(2);
    }

    @Test
    void flushAllEmptiesBuffer() {
        var flushed = new ArrayList<MatchResult>();
        var acc = new GcEventAccumulator(flushed::add);
        var fields = List.of(FieldDef.of("gcId", FieldType.INT));
        acc.accumulate(new MatchResult("t", fields, List.of(1)));
        acc.flushAll();
        assertThat(flushed).hasSize(1);
        flushed.clear();
        acc.flushAll();
        assertThat(flushed).isEmpty();
    }
}
