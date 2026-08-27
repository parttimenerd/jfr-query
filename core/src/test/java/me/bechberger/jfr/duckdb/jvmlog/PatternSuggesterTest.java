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
                "[0.001s][info][safepoint] Safepoint reached");
        assertThat(s.table()).isEqualTo("jvmlog_unknown_lines");
    }

    @Test
    void idIsDerivedFromTableAndFirstField() {
        var s = PatternSuggester.suggest(
                "[1.234s][info][gc] GC(42) Pause Young 12.34ms");
        assertThat(s.id()).isNotBlank();
        assertThat(s.id()).matches("[a-z][a-z0-9_]*");
    }
}
