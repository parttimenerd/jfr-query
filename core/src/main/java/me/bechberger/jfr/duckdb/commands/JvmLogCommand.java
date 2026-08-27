package me.bechberger.jfr.duckdb.commands;

import picocli.CommandLine;

@CommandLine.Command(
        name = "jvmlog",
        mixinStandardHelpOptions = true,
        description = "JVM unified log (.log/.txt) utilities",
        subcommands = {
                JvmLogAddPatternCommand.class,
                CommandLine.HelpCommand.class
        })
public class JvmLogCommand implements Runnable {

    @CommandLine.Spec CommandLine.Model.CommandSpec spec;

    @Override
    public void run() {
        spec.commandLine().usage(System.out);
    }
}
