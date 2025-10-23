package me.bechberger.jfr.duckdb;

import jdk.jfr.consumer.RecordedObject;
import me.bechberger.jfr.duckdb.commands.*;
import picocli.CommandLine;

@CommandLine.Command(
        name = "query.jar",
        mixinStandardHelpOptions = true,
        version = "0.1",
        description = "Querying JFR recordings with DuckDB",
        subcommands = {
            ImportCommand.class,
            QueryCommand.class,
            MacrosCommand.class,
            ViewsCommand.class,
            ContextCommand.class,
            CommandLine.HelpCommand.class
        })
public class Main implements Runnable {

    @CommandLine.Spec CommandLine.Model.CommandSpec spec;

    @Override
    public void run() {
        // print usage with picocli
        spec.commandLine().usage(System.out);
    }

    public static void main(String[] args) {
        if (!new Main().checkIfReflectiveAccessOnRecordedObjectIsAvailable()) {
            restartWithAddOpenModules(args);
        } else {
            int exitCode = new CommandLine(new Main()).execute(args);
            System.exit(exitCode);
        }
    }

    private static void restartWithAddOpenModules(String[] args) {
        try {
            String javaHome = System.getProperty("java.home");
            String javaBin = javaHome + "/bin/java";
            String classPath = System.getProperty("java.class.path");
            String className = Main.class.getCanonicalName();

            ProcessBuilder builder =
                    new ProcessBuilder(
                            javaBin,
                            "--add-opens",
                            "jdk.jfr/jdk.jfr.consumer=ALL-UNNAMED",
                            "--add-opens",
                            "jdk.jfr/jdk.jfr=ALL-UNNAMED",
                            "--enable-native-access=ALL-UNNAMED", // for good measure
                            "-cp",
                            classPath,
                            className);
            for (String arg : args) {
                builder.command().add(arg);
            }
            builder.inheritIO();
            Process process = builder.start();
            int exitCode = process.waitFor();
            System.exit(exitCode);
        } catch (Exception e) {
            e.printStackTrace();
            System.exit(1);
        }
    }

    private boolean checkIfReflectiveAccessOnRecordedObjectIsAvailable() {
        try {
            var objectContextField = RecordedObject.class.getDeclaredField("objectContext");
            objectContextField.setAccessible(true);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}