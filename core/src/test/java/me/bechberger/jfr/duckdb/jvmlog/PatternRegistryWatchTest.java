package me.bechberger.jfr.duckdb.jvmlog;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.*;

class PatternRegistryWatchTest {

    @Test
    void hotReloadPicksUpNewYamlFile(@TempDir Path dir) throws Exception {
        PatternRegistry registry = BuiltinPatterns.createRegistry(java.util.Optional.of(dir));

        assertThat(registry.findById("custom_test_pattern")).isEmpty();

        String yaml = """
                - id: custom_test_pattern
                  tags: [gc]
                  level: info
                  pattern: 'GC\\((\\d+)\\) Custom (\\d+)ms'
                  fields:
                    gcId: int
                    customMs: double
                  table: jvmlog_gc_event
                """;
        Files.writeString(dir.resolve("custom_test_pattern.yaml"), yaml);

        // WatchService on macOS can be slow — poll for up to 5 seconds
        long deadline = System.currentTimeMillis() + 5000;
        while (System.currentTimeMillis() < deadline) {
            if (registry.findById("custom_test_pattern").isPresent()) break;
            Thread.sleep(200);
        }

        assertThat(registry.findById("custom_test_pattern"))
                .as("pattern should be hot-reloaded within 5s")
                .isPresent();
    }
}
