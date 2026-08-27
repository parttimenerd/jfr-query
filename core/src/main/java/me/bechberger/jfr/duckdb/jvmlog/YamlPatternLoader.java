package me.bechberger.jfr.duckdb.jvmlog;

import org.yaml.snakeyaml.Yaml;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class YamlPatternLoader {

    private YamlPatternLoader() {}

    /** Load all *.yaml files from a classpath directory using an index.txt file. */
    public static List<LogPattern> fromClasspath(String classpathDir) {
        var results = new ArrayList<LogPattern>();
        String indexPath = classpathDir + "/index.txt";
        try (var indexStream = YamlPatternLoader.class.getClassLoader()
                .getResourceAsStream(indexPath)) {
            if (indexStream == null) return results;
            new String(indexStream.readAllBytes()).lines()
                    .map(String::trim).filter(l -> l.endsWith(".yaml"))
                    .forEach(name -> {
                        String fullPath = classpathDir + "/" + name;
                        try (var s = YamlPatternLoader.class.getClassLoader()
                                .getResourceAsStream(fullPath)) {
                            if (s != null) results.addAll(loadFromStream(s));
                        } catch (IOException ignored) {}
                    });
        } catch (IOException ignored) {}
        return results;
    }

    /** Load all *.yaml files from a filesystem directory. */
    public static List<LogPattern> fromDirectory(Path dir) {
        var results = new ArrayList<LogPattern>();
        if (!Files.isDirectory(dir)) return results;
        try (var paths = Files.list(dir)) {
            paths.filter(p -> p.toString().endsWith(".yaml"))
                 .forEach(p -> {
                     try (var stream = Files.newInputStream(p)) {
                         results.addAll(loadFromStream(stream));
                     } catch (IOException ignored) {}
                 });
        } catch (IOException ignored) {}
        return results;
    }

    /** Load and register a single .yaml file into an existing registry. */
    public static void loadAndRegisterFile(Path yamlFile, PatternRegistry registry) {
        try (var stream = Files.newInputStream(yamlFile)) {
            for (var pattern : loadFromStream(stream)) {
                registry.replaceOrAdd(pattern);
            }
        } catch (IOException ignored) {}
    }

    @SuppressWarnings("unchecked")
    static List<LogPattern> loadFromStream(InputStream stream) {
        var yaml = new Yaml();
        var results = new ArrayList<LogPattern>();
        for (Object doc : yaml.loadAll(stream)) {
            if (doc instanceof List<?> list) {
                for (var item : list) {
                    if (item instanceof Map<?,?> map) {
                        try {
                            results.add(parsePattern((Map<String, Object>) map));
                        } catch (Exception ignored) {}
                    }
                }
            }
        }
        return results;
    }

    @SuppressWarnings("unchecked")
    private static LogPattern parsePattern(Map<String, Object> map) {
        String id = (String) map.get("id");
        List<String> tags = (List<String>) map.get("tags");
        String levelStr = (String) map.getOrDefault("level", "info");
        String pattern = (String) map.get("pattern");
        String table = (String) map.get("table");
        Map<String, String> fieldsMap = (Map<String, String>) map.get("fields");

        LogLevel level = LogLevel.parse(levelStr);
        var fields = new ArrayList<FieldDef>();
        if (fieldsMap != null) {
            for (var entry : fieldsMap.entrySet()) {
                fields.add(FieldDef.of(entry.getKey(), FieldType.fromYaml(entry.getValue())));
            }
        }
        return new YamlLogPattern(id, tags, level, pattern, fields, table);
    }
}
