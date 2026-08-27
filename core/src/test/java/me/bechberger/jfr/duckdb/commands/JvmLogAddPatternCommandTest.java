package me.bechberger.jfr.duckdb.commands;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import picocli.CommandLine;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Iterator;
import java.util.List;

import static org.assertj.core.api.Assertions.*;

class JvmLogAddPatternCommandTest {

    @Test
    void writesYamlFileFromGcPauseLine(@TempDir Path tmpDir) throws IOException {
        JvmLogAddPatternCommand cmd = new JvmLogAddPatternCommand();
        cmd.outputDirOverride = tmpDir;

        // Responses: raw line, then enter for each field name+type (5 fields = 10 prompts),
        // then id, then table
        Iterator<String> responses = List.of(
                "[1.234s][info][gc] GC(42) Pause Young (Normal) 256M->128M(512M) 12.34ms",
                "", "", "", "", "", "", "", "", "", "",
                "",
                ""
        ).iterator();

        cmd.lineReader = prompt -> responses.hasNext() ? responses.next() : "";

        new CommandLine(cmd).execute();

        List<Path> yamls = Files.list(tmpDir)
                .filter(p -> p.toString().endsWith(".yaml"))
                .toList();
        assertThat(yamls).hasSize(1);

        String content = Files.readString(yamls.get(0));
        assertThat(content)
                .contains("id:")
                .contains("tags: [gc]")
                .contains("pattern:")
                .contains("table: jvmlog_gc_event");
    }

    @Test
    void acceptsCustomFieldNameOverride(@TempDir Path tmpDir) throws IOException {
        JvmLogAddPatternCommand cmd = new JvmLogAddPatternCommand();
        cmd.outputDirOverride = tmpDir;

        // GC(7) Heap 128M->64M(256M) 5ms has 5 fields: gcId, heapBefore, heapAfter, heapCommitted, durationMs
        // 5 fields = 10 prompts (name+type), then id, then table
        Iterator<String> responses = List.of(
                "[1.5s][info][gc] GC(7) Heap 128M->64M(256M) 5ms",
                "myGcId", "int",
                "", "",
                "", "",
                "", "",
                "", "",
                "",
                ""
        ).iterator();
        cmd.lineReader = prompt -> responses.hasNext() ? responses.next() : "";

        new CommandLine(cmd).execute();

        Path yaml = Files.list(tmpDir).findFirst().orElseThrow();
        assertThat(Files.readString(yaml)).contains("myGcId");
    }
}
