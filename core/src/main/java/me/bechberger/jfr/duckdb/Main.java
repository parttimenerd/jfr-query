package me.bechberger.jfr.duckdb;

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
            ServeCommand.class,
            CommandLine.HelpCommand.class
        })
public class Main implements Runnable {

    @CommandLine.Spec CommandLine.Model.CommandSpec spec;

    @Override
    public void run() {
        spec.commandLine().usage(System.out);
    }

    public static void main(String[] args) {
        int exitCode = new CommandLine(new Main()).execute(args);
        System.exit(exitCode);
    }
}
