package me.bechberger.jfr.duckdb.jvmlog;

import org.junit.jupiter.api.Test;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class TableSchemaBuilderTest {

    @Test
    void singlePatternDdl() {
        var p = new JavaLogPattern("p1", List.of("gc"), LogLevel.INFO,
                "GC\\((\\d+)\\) Pause (\\S+)",
                List.of(FieldDef.of("gcId", FieldType.INT), FieldDef.of("pauseType", FieldType.STRING)),
                "jvmlog_gc_event");
        var registry = new PatternRegistry();
        registry.addPattern(p);
        var schemas = TableSchemaBuilder.buildSchemas(registry);
        assertThat(schemas).containsKey("jvmlog_gc_event");
        String ddl = schemas.get("jvmlog_gc_event");
        assertThat(ddl).containsIgnoringCase("CREATE TABLE jvmlog_gc_event");
        assertThat(ddl).containsIgnoringCase("gcId INTEGER");
        assertThat(ddl).containsIgnoringCase("pauseType VARCHAR");
    }

    @Test
    void fieldUnionAcrossPatterns() {
        var p1 = new JavaLogPattern("p1", List.of("gc"), LogLevel.INFO, "Foo (\\d+)",
                List.of(FieldDef.of("a", FieldType.INT)), "tbl");
        var p2 = new JavaLogPattern("p2", List.of("gc"), LogLevel.INFO, "Bar (\\S+)",
                List.of(FieldDef.of("b", FieldType.STRING)), "tbl");
        var registry = new PatternRegistry();
        registry.addPattern(p1);
        registry.addPattern(p2);
        var schemas = TableSchemaBuilder.buildSchemas(registry);
        String ddl = schemas.get("tbl");
        assertThat(ddl).containsIgnoringCase("a INTEGER");
        assertThat(ddl).containsIgnoringCase("b VARCHAR");
    }
}
