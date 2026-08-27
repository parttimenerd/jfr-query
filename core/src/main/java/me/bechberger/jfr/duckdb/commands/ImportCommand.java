package me.bechberger.jfr.duckdb.commands;

import me.bechberger.jfr.duckdb.BasicParallelImporter;
import me.bechberger.jfr.duckdb.Options;
import me.bechberger.jfr.duckdb.jvmlog.FileTypeRouter;
import org.duckdb.DuckDBConnection;
import picocli.CommandLine;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

@CommandLine.Command(
        name = "import",
        mixinStandardHelpOptions = true,
        version = "0.1",
        description = "Import one or more JFR recordings and/or JVM logs into a DuckDB database")
public class ImportCommand implements Runnable {

    @CommandLine.Mixin private Options options;

    @CommandLine.Parameters(
            arity = "2..*",
            description = "Input files (.jfr, .cjfr, .log, .txt) followed by output .duckdb file")
    private List<String> args;

    @Override
    public void run() {
        if (args.size() < 2) {
            System.err.println("Usage: import <input-file(s)> <output.duckdb>");
            System.exit(1);
            return;
        }

        List<Path> inputPaths = args.subList(0, args.size() - 1).stream().map(Path::of).toList();
        Path outputPath = Path.of(args.get(args.size() - 1));

        // Fast path: single JFR/CJFR → use existing optimised importer
        if (inputPaths.size() == 1) {
            FileTypeRouter.FileType type;
            try {
                type = FileTypeRouter.detect(inputPaths.get(0));
            } catch (IllegalArgumentException e) {
                System.err.println("Error: " + e.getMessage());
                System.exit(1);
                return;
            }
            if (type == FileTypeRouter.FileType.JFR || type == FileTypeRouter.FileType.CJFR) {
                try {
                    deleteSilently(outputPath);
                    BasicParallelImporter.createFile(inputPaths.get(0), outputPath, options);
                } catch (Exception e) {
                    e.printStackTrace();
                    System.exit(1);
                }
                return;
            }
        }

        // Multi-file or mixed path: import into memory, then persist
        try {
            deleteSilently(outputPath);
            DuckDBConnection memConn = ServeCommand.openFiles(inputPaths, options, Optional.empty());
            try {
                String escapedOutput = outputPath.toAbsolutePath().toString().replace("'", "''");
                try (var stmt = memConn.createStatement()) {
                    stmt.execute("ATTACH '" + escapedOutput + "' AS _export");
                    stmt.execute("COPY FROM DATABASE memory TO _export");
                    stmt.execute("DETACH _export");
                }
                System.out.println("Written to " + outputPath);
            } finally {
                memConn.close();
            }
        } catch (Exception e) {
            e.printStackTrace();
            System.exit(1);
        }
    }

    private static void deleteSilently(Path path) {
        try { Files.deleteIfExists(path); } catch (IOException ignored) {}
    }
}
