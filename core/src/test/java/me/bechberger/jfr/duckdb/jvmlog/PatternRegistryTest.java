package me.bechberger.jfr.duckdb.jvmlog;

import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThat;

class PatternRegistryTest {

    @Test
    void firstMatchWins() {
        var p1 = new JavaLogPattern("p1", List.of("gc"), LogLevel.INFO,
                "Using (\\S+)", List.of(FieldDef.of("algorithm", FieldType.STRING)), "table_a");
        var p2 = new JavaLogPattern("p2", List.of("gc"), LogLevel.INFO,
                "Using (\\S+)", List.of(FieldDef.of("algorithm", FieldType.STRING)), "table_b");
        var registry = new PatternRegistry();
        registry.addPattern(p1);
        registry.addPattern(p2);

        var line = LogLineParser.parse("[0.005s][info][gc] Using G1").get();
        var result = registry.match(line);
        assertThat(result).isPresent();
        assertThat(result.get().tableName()).isEqualTo("table_a");
    }

    @Test
    void noMatchReturnsEmpty() {
        var registry = new PatternRegistry();
        var line = LogLineParser.parse("[0.005s][info][gc] Completely unknown line xyz").get();
        assertThat(registry.match(line)).isEmpty();
    }

    @Test
    void yamlOverrideById() {
        var java = new JavaLogPattern("my_pattern", List.of("gc"), LogLevel.INFO,
                "Version: (\\S+)", List.of(FieldDef.of("ver", FieldType.STRING)), "table_java");
        var yaml = new YamlLogPattern("my_pattern", List.of("gc"), LogLevel.INFO,
                "Version: (\\S+)", List.of(FieldDef.of("ver", FieldType.STRING)), "table_yaml");
        var registry = new PatternRegistry();
        registry.addPattern(java);
        registry.replaceOrAdd(yaml);

        var line = LogLineParser.parse("[0.005s][info][gc,init] Version: 25.0").get();
        var result = registry.match(line);
        assertThat(result).isPresent();
        assertThat(result.get().tableName()).isEqualTo("table_yaml");
    }
}
