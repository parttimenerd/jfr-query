package me.bechberger.jfr.duckdb.jvmlog;

import java.nio.file.Path;

public final class FileTypeRouter {

    public enum FileType { JFR, CJFR, JVMLOG, DUCKDB }

    public static FileType detect(Path path) {
        String name = path.getFileName().toString().toLowerCase();
        if (name.endsWith(".jfr"))    return FileType.JFR;
        if (name.endsWith(".cjfr"))   return FileType.CJFR;
        if (name.endsWith(".log"))    return FileType.JVMLOG;
        if (name.endsWith(".txt"))    return FileType.JVMLOG;
        if (name.endsWith(".duckdb")) return FileType.DUCKDB;
        if (name.endsWith(".db"))     return FileType.DUCKDB;
        int dot = name.lastIndexOf('.');
        String ext = dot >= 0 ? name.substring(dot) : name;
        throw new IllegalArgumentException("Unrecognised file extension: " + ext);
    }

    private FileTypeRouter() {}
}
