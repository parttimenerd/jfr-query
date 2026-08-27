package me.bechberger.jfr.duckdb.jvmlog;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class PatternSuggesterTest {

    @Test
    void suggestsGcPauseLine() {
        var s = PatternSuggester.suggest(
                "[1.234s][info][gc] GC(42) Pause Young (Normal) 256M->128M(512M) 12.34ms");
        assertThat(s.tags()).contains("gc");
        assertThat(s.table()).isEqualTo("jvmlog_gc_event");
        assertThat(s.fields()).isNotEmpty();
        assertThat(s.fields().get(0).name()).isEqualTo("gcId");
        assertThat(s.fields().get(0).fieldType()).isEqualTo("int");
    }

    @Test
    void gcInitLineRoutedToInitTable() {
        var s = PatternSuggester.suggest(
                "[0.008s][info][gc,init] Heap Min Capacity: 256M");
        assertThat(s.table()).isEqualTo("jvmlog_gc_init");
    }

    @Test
    void gcRegionLineRoutedToRegionsTable() {
        var s = PatternSuggester.suggest(
                "[1.5s][debug][gc,region] GC(10) Eden regions: 5->3(10)");
        assertThat(s.table()).isEqualTo("jvmlog_g1_regions");
    }

    @Test
    void unknownTagsRoutedToUnknownTable() {
        var s = PatternSuggester.suggest(
                "[0.001s][info][jit] Method compiled successfully");
        assertThat(s.table()).isEqualTo("jvmlog_unknown_lines");
    }

    @Test
    void idIsDerivedFromTableAndFirstField() {
        var s = PatternSuggester.suggest(
                "[1.234s][info][gc] GC(42) Pause Young 12.34ms");
        assertThat(s.id()).isNotBlank();
        assertThat(s.id()).matches("[a-z][a-z0-9_]*");
    }

    @Test
    void gcMetaspaceRoutedToMetaspaceTable() {
        var s = PatternSuggester.suggest(
                "[0.502s][info][gc,metaspace] GC(0) Metaspace: 45678K->45678K(1056768K)");
        assertThat(s.table()).isEqualTo("jvmlog_metaspace");
    }

    @Test
    void gcStringDedupRoutedToStringDedupTable() {
        var s = PatternSuggester.suggest(
                "[1.234s][info][gc,stringdedup] GC(3) Savings: 12345 bytes in 678 objects");
        assertThat(s.table()).isEqualTo("jvmlog_stringdedup");
    }

    @Test
    void gcDirectorRoutedToZgcDirectorTable() {
        var s = PatternSuggester.suggest(
                "[1.000s][debug][gc,director] GC(0) Selection: Allocation Rate");
        assertThat(s.table()).isEqualTo("jvmlog_zgc_director");
    }

    @Test
    void shenandoahTagRoutedToInitTable() {
        var s = PatternSuggester.suggest(
                "[0.002s][info][gc,shenandoah] Shenandoah GC Mode: Saturation");
        assertThat(s.table()).isEqualTo("jvmlog_gc_init");
    }

    @Test
    void safepointTagRoutedToSafepointTable() {
        var s = PatternSuggester.suggest(
                "[1.234s][info][safepoint] Safepoint \"G1CollectForAllocation\", time 15.234 ms, reaching threads in 1.234 ms");
        assertThat(s.table()).isEqualTo("jvmlog_safepoint");
    }
}
