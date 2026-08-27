package me.bechberger.jfr.duckdb.templates;

import org.junit.jupiter.api.Test;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import static org.assertj.core.api.Assertions.*;

class GcLogTemplateTest {

    private static final String TEMPLATE_PATH = "/templates/builtin/gc-log-analysis.md";

    private String loadTemplate() throws IOException {
        try (InputStream is = getClass().getResourceAsStream(TEMPLATE_PATH)) {
            assertThat(is).as("Template not found at: " + TEMPLATE_PATH).isNotNull();
            return new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    void templateExists() throws IOException {
        assertThat(loadTemplate()).isNotBlank();
    }

    @Test
    void hasFrontmatter() throws IOException {
        String c = loadTemplate();
        assertThat(c).startsWith("---")
                .contains("title: GC Log Analysis")
                .contains("cellConditions:");
    }

    @Test
    void hasExpectedCellConditions() throws IOException {
        String c = loadTemplate();
        assertThat(c)
                .contains("has-heap-snapshot")
                .contains("has-gc-phase")
                .contains("has-g1-regions")
                .contains("has-zgc")
                .contains("has-jfr-correlation");
    }

    @Test
    void hasFourteenCells() throws IOException {
        Matcher m = Pattern.compile("<!-- @cell").matcher(loadTemplate());
        int count = 0;
        while (m.find()) count++;
        assertThat(count).as("expected 14 cells").isEqualTo(14);
    }

    @Test
    void allSqlBlocksAreNonEmpty() throws IOException {
        Matcher m = Pattern.compile("```sql\\s*\\n([^`]+)```", Pattern.DOTALL).matcher(loadTemplate());
        while (m.find()) {
            assertThat(m.group(1).trim()).as("empty SQL block").isNotBlank();
        }
    }
}
