package me.bechberger.jfr.duckdb.jvmlog;

import org.junit.jupiter.api.Test;
import java.util.List;
import static org.assertj.core.api.Assertions.*;

class PatternTokeniserTest {

    @Test
    void tokenisesGcPauseLine() {
        var result = PatternTokeniser.tokenise(
                "GC(42) Pause Young (Normal) 256M->128M(512M) 12.34ms");
        assertThat(result.tokenTypes()).hasSize(5);
        assertThat(result.tokenTypes().get(0)).isEqualTo(PatternTokeniser.TokenType.NUMBER);
        assertThat(result.tokenTypes().get(1)).isEqualTo(PatternTokeniser.TokenType.BYTES);
        assertThat(result.tokenTypes().get(4)).isEqualTo(PatternTokeniser.TokenType.NUMBER);
    }

    @Test
    void patternMatchesOriginalLine() {
        String line = "GC(7) Heap Expand requested 268435456B expansion 268435456B";
        var result = PatternTokeniser.tokenise(line);
        assertThat(line).matches(result.pattern());
    }

    @Test
    void escapesRegexSpecialChars() {
        var result = PatternTokeniser.tokenise("Pause Young (Normal) 12ms");
        assertThat(result.pattern()).contains("\\(Normal\\)");
    }

    @Test
    void hexAddressDetected() {
        var result = PatternTokeniser.tokenise("CodeCache 0x7f3a8c00 used 42M");
        assertThat(result.tokenTypes()).contains(PatternTokeniser.TokenType.ADDRESS);
    }

    @Test
    void plainTextLineHasNoTokens() {
        var result = PatternTokeniser.tokenise("Using G1");
        assertThat(result.tokenTypes()).isEmpty();
        assertThat(result.pattern()).isEqualTo("Using G1");
    }
}
