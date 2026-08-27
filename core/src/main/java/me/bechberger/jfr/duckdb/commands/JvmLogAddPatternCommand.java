package me.bechberger.jfr.duckdb.commands;

import me.bechberger.jfr.duckdb.jvmlog.PatternSuggester;
import me.bechberger.jfr.duckdb.jvmlog.PatternSuggester.FieldSuggestion;
import me.bechberger.jfr.duckdb.jvmlog.PatternSuggester.SuggestedPattern;
import picocli.CommandLine;

import java.io.PrintWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Scanner;

@CommandLine.Command(
        name = "add-pattern",
        mixinStandardHelpOptions = true,
        description = "Interactively create a YAML pattern from a sample log line")
public class JvmLogAddPatternCommand implements Runnable {

    @CommandLine.Option(
            names = {"--patterns-dir"},
            description = "Output directory for YAML pattern files (default: ~/.jfr-query/patterns/)")
    String patternsDir;

    /** Inject for tests; null = use real console/stdin */
    LineReader lineReader = null;

    /** Inject for tests; null = resolve from patternsDir or default */
    Path outputDirOverride = null;

    @FunctionalInterface
    interface LineReader {
        String readLine(String prompt);
    }

    @Override
    public void run() {
        LineReader reader = lineReader != null ? lineReader : buildConsoleReader();
        PrintWriter out = new PrintWriter(System.out, true);

        out.println("=== JVM Log Pattern Builder ===");
        String rawLine = reader.readLine("Paste a log line: ");
        if (rawLine == null || rawLine.isBlank()) {
            out.println("No input. Exiting.");
            return;
        }

        SuggestedPattern suggestion = PatternSuggester.suggest(rawLine.trim());
        out.println("\nDetected:");
        out.println("  Tags:    " + suggestion.tags());
        out.println("  Level:   " + suggestion.level());
        out.println("  Pattern: " + suggestion.pattern());
        out.println("  Table:   " + suggestion.table());
        out.println("\nSuggested fields:");
        for (int i = 0; i < suggestion.fields().size(); i++) {
            FieldSuggestion f = suggestion.fields().get(i);
            out.printf("  [%d] %s (%s)%n", i + 1, f.name(), f.fieldType());
        }

        out.println("\nPress Enter to accept each field name, or type a new name.");
        List<FieldSuggestion> finalFields = new ArrayList<>();
        for (FieldSuggestion f : suggestion.fields()) {
            String override = reader.readLine("  Field name [" + f.name() + "]: ");
            String rawName = (override == null || override.isBlank()) ? f.name() : override.trim();
            String name = rawName.replaceAll("[^a-zA-Z0-9_]", "_");
            String typeOverride = reader.readLine("  Field type [" + f.fieldType() + "] (int/long/double/string/bytes): ");
            String type = (typeOverride == null || typeOverride.isBlank()) ? f.fieldType() : typeOverride.trim();
            finalFields.add(new FieldSuggestion(name, type));
        }

        String idDefault = suggestion.id();
        String idInput = reader.readLine("\nPattern id [" + idDefault + "]: ");
        String rawPatternId = (idInput == null || idInput.isBlank()) ? idDefault : idInput.trim();
        // Sanitise to prevent path traversal: only allow safe identifier characters
        String patternId = rawPatternId.replaceAll("[^a-z0-9_]", "_");

        String tableInput = reader.readLine("Table [" + suggestion.table() + "]: ");
        String rawTable = (tableInput == null || tableInput.isBlank()) ? suggestion.table() : tableInput.trim();
        String table = rawTable.replaceAll("[^a-zA-Z0-9_]", "_");

        Path outputDir;
        if (outputDirOverride != null) {
            outputDir = outputDirOverride;
        } else if (patternsDir != null && !patternsDir.isBlank()) {
            outputDir = Path.of(patternsDir);
        } else {
            String home = System.getProperty("user.home");
            outputDir = Path.of(home, ".jfr-query", "patterns");
        }

        try {
            Files.createDirectories(outputDir);
            Path outputFile = outputDir.resolve(patternId + ".yaml");
            String yaml = buildYaml(patternId, suggestion.tags(), suggestion.level(),
                    suggestion.pattern(), finalFields, table);
            Files.writeString(outputFile, yaml);
            out.println("\nWritten: " + outputFile);
            out.println("Restart the server (or use --jvmlog-patterns-dir for hot-reload) to apply.");
        } catch (Exception e) {
            out.println("Error writing pattern: " + e.getMessage());
            System.exit(1);
        }
    }

    static String buildYaml(String id, List<String> tags, String level,
                                     String pattern, List<FieldSuggestion> fields, String table) {
        StringBuilder sb = new StringBuilder();
        sb.append("- id: ").append(id).append("\n");
        sb.append("  tags: [").append(String.join(", ", tags)).append("]\n");
        sb.append("  level: ").append(level).append("\n");
        sb.append("  pattern: '").append(pattern.replace("'", "''")).append("'\n");
        sb.append("  fields:\n");
        for (FieldSuggestion f : fields) {
            sb.append("    ").append(f.name()).append(": ").append(f.fieldType()).append("\n");
        }
        sb.append("  table: ").append(table).append("\n");
        return sb.toString();
    }

    private static LineReader buildConsoleReader() {
        java.io.Console console = System.console();
        if (console != null) {
            return prompt -> {
                System.out.print(prompt);
                System.out.flush();
                return console.readLine();
            };
        }
        Scanner scanner = new Scanner(System.in);
        return prompt -> {
            System.out.print(prompt);
            System.out.flush();
            return scanner.hasNextLine() ? scanner.nextLine() : null;
        };
    }
}
