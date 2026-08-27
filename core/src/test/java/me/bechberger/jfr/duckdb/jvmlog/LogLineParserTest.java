package me.bechberger.jfr.duckdb.jvmlog;

import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThat;

class LogLineParserTest {

    @Test
    void fullDecorators() {
        var line = "[2026-08-11T16:35:59.744+0200][0.005s][info ][gc,init          ] Using G1";
        var result = LogLineParser.parse(line);
        assertThat(result).isPresent();
        var l = result.get();
        assertThat(l.timestamp()).isNotNull();
        assertThat(l.uptimeSecs()).isEqualTo(0.005);
        assertThat(l.level()).isEqualTo(LogLevel.INFO);
        assertThat(l.tags()).containsExactly("gc", "init");
        assertThat(l.message()).isEqualTo("Using G1");
    }

    @Test
    void missingTimestamp() {
        var line = "[0.005s][info][gc] Using G1";
        var result = LogLineParser.parse(line);
        assertThat(result).isPresent();
        var l = result.get();
        assertThat(l.timestamp()).isNull();
        assertThat(l.uptimeSecs()).isEqualTo(0.005);
        assertThat(l.level()).isEqualTo(LogLevel.INFO);
        assertThat(l.tags()).containsExactly("gc");
        assertThat(l.message()).isEqualTo("Using G1");
    }

    @Test
    void missingTimestampAndUptime() {
        var line = "[info][gc,init] Version: 25.0";
        var result = LogLineParser.parse(line);
        assertThat(result).isPresent();
        var l = result.get();
        assertThat(l.timestamp()).isNull();
        assertThat(l.uptimeSecs()).isNull();
        assertThat(l.level()).isEqualTo(LogLevel.INFO);
        assertThat(l.tags()).containsExactly("gc", "init");
        assertThat(l.message()).isEqualTo("Version: 25.0");
    }

    @Test
    void debugLevelPadded() {
        var line = "[0.005s][debug][gc,ergo,heap     ] Expand the heap.";
        var result = LogLineParser.parse(line);
        assertThat(result).isPresent();
        assertThat(result.get().level()).isEqualTo(LogLevel.DEBUG);
        assertThat(result.get().tags()).containsExactly("gc", "ergo", "heap");
    }

    @Test
    void notALogLine() {
        assertThat(LogLineParser.parse("This is not a log line")).isEmpty();
        assertThat(LogLineParser.parse("")).isEmpty();
    }
}
