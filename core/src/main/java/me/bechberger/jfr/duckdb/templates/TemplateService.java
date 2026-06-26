package me.bechberger.jfr.duckdb.templates;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Loads notebook templates from the classpath (built-ins under
 * /templates/builtin/) and optionally from a user-supplied directory.
 *
 * Built-ins MUST declare `license: MIT` in their YAML front-matter; otherwise
 * the service throws at startup. User-folder files are accepted as-is and
 * report their declared `license` (or null).
 */
public class TemplateService {

    private static final String BUILTIN_CLASSPATH = "/templates/builtin/";

    private final Map<String, String> bodies = new LinkedHashMap<>();
    private final Map<String, TemplateMeta> metas = new LinkedHashMap<>();

    public TemplateService(Optional<Path> userDir) {
        loadBuiltins();
        userDir.ifPresent(this::loadUserDir);
    }

    public List<TemplateMeta> list() {
        return new ArrayList<>(metas.values());
    }

    public Optional<String> load(String name) {
        return Optional.ofNullable(bodies.get(name));
    }

    private void loadBuiltins() {
        for (String file : listBuiltinFiles()) {
            String body;
            try {
                body = readClasspath(BUILTIN_CLASSPATH + file);
            } catch (IOException e) {
                System.err.println("Failed to read built-in template " + file + ": " + e.getMessage());
                continue;
            }
            String name = file.replaceFirst("\\.md$", "");
            TemplateMeta meta = parseMeta(name, body, "builtin");
            if (!"MIT".equals(meta.license())) {
                throw new IllegalStateException(
                        "Built-in template '" + name + "' must declare `license: MIT` in its front-matter (got: "
                                + meta.license() + ")");
            }
            bodies.put(name, body);
            metas.put(name, meta);
        }
    }

    private void loadUserDir(Path dir) {
        if (!Files.exists(dir)) {
            System.err.println("--templates-dir does not exist: " + dir + " (skipping user templates)");
            return;
        }
        if (!Files.isDirectory(dir)) {
            System.err.println("--templates-dir is not a directory: " + dir + " (skipping user templates)");
            return;
        }
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.md")) {
            for (Path p : stream) {
                if (!Files.isRegularFile(p)) continue;
                String body;
                try {
                    body = Files.readString(p, StandardCharsets.UTF_8);
                } catch (IOException e) {
                    System.err.println("Skipping " + p + ": " + e.getMessage());
                    continue;
                }
                String name = p.getFileName().toString().replaceFirst("\\.md$", "");
                TemplateMeta meta;
                try {
                    meta = parseMeta(name, body, "user");
                } catch (RuntimeException e) {
                    System.err.println("Skipping " + p + ": invalid front-matter: " + e.getMessage());
                    continue;
                }
                bodies.put(name, body);
                metas.put(name, meta);
            }
        } catch (IOException e) {
            System.err.println("Failed to list user templates: " + e.getMessage());
        }
    }

    /**
     * List filenames present under the built-in classpath directory. Works
     * whether the resources are on disk (during tests / from target/classes)
     * or inside a jar.
     */
    private List<String> listBuiltinFiles() {
        List<String> result = new ArrayList<>();
        try {
            Enumeration<URL> urls = getClass().getClassLoader().getResources("templates/builtin");
            while (urls.hasMoreElements()) {
                URL url = urls.nextElement();
                result.addAll(listFilesAtUrl(url));
            }
        } catch (IOException e) {
            System.err.println("Could not scan built-in templates: " + e.getMessage());
        }
        Collections.sort(result);
        return result;
    }

    private List<String> listFilesAtUrl(URL url) throws IOException {
        List<String> files = new ArrayList<>();
        String protocol = url.getProtocol();
        if ("file".equals(protocol)) {
            Path dir;
            try {
                dir = Path.of(url.toURI());
            } catch (Exception e) {
                throw new IOException(e);
            }
            if (!Files.isDirectory(dir)) return files;
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.md")) {
                for (Path p : stream) files.add(p.getFileName().toString());
            }
            return files;
        }
        if ("jar".equals(protocol)) {
            String urlStr = url.toString();
            int sep = urlStr.indexOf("!/");
            String jarUri = urlStr.substring("jar:".length(), sep);
            String inner = urlStr.substring(sep + 2);
            try (FileSystem fs = FileSystems.newFileSystem(URI.create("jar:" + jarUri), Map.of())) {
                Path dir = fs.getPath(inner);
                if (!Files.isDirectory(dir)) return files;
                try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.md")) {
                    for (Path p : stream) files.add(p.getFileName().toString());
                }
            }
            return files;
        }
        return files;
    }

    private String readClasspath(String path) throws IOException {
        try (InputStream in = getClass().getResourceAsStream(path)) {
            if (in == null) throw new IOException("resource not found: " + path);
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                String line;
                boolean first = true;
                while ((line = r.readLine()) != null) {
                    if (!first) sb.append('\n');
                    sb.append(line);
                    first = false;
                }
            }
            return sb.toString();
        }
    }

    private static final Pattern FRONT_MATTER_RE = Pattern.compile("(?s)\\A---\\s*\\n(.*?)\\n---\\s*(?:\\n|$)");
    private static final Pattern LIST_ITEM_RE = Pattern.compile("[\\[\\]\\s,]+");

    /**
     * Minimal YAML front-matter parser: extracts top-level scalar keys
     * (`key: value`) and a single-line flow sequence for `tags: [a, b, c]`.
     * Sufficient for the limited surface the plan requires.
     */
    static TemplateMeta parseMeta(String name, String body, String source) {
        Matcher m = FRONT_MATTER_RE.matcher(body);
        String title = name;
        String description = null;
        List<String> tags = List.of();
        String license = null;
        if (m.find()) {
            String fm = m.group(1);
            for (String raw : fm.split("\\n")) {
                String line = raw.trim();
                if (line.isEmpty() || line.startsWith("#")) continue;
                int colon = line.indexOf(':');
                if (colon < 0) continue;
                String key = line.substring(0, colon).trim();
                String value = line.substring(colon + 1).trim();
                value = stripQuotes(value);
                switch (key) {
                    case "title": title = value; break;
                    case "description": description = value; break;
                    case "license": license = value; break;
                    case "tags": tags = parseFlowList(value); break;
                    default: break;
                }
            }
        }
        return new TemplateMeta(name, title, description, tags, source, license);
    }

    private static String stripQuotes(String v) {
        if (v.length() >= 2) {
            char a = v.charAt(0), b = v.charAt(v.length() - 1);
            if ((a == '"' && b == '"') || (a == '\'' && b == '\'')) {
                return v.substring(1, v.length() - 1);
            }
        }
        return v;
    }

    private static List<String> parseFlowList(String raw) {
        if (raw.isBlank()) return List.of();
        if (!raw.startsWith("[") || !raw.endsWith("]")) return List.of();
        String inner = raw.substring(1, raw.length() - 1);
        if (inner.isBlank()) return List.of();
        List<String> out = new ArrayList<>();
        for (String part : inner.split(",")) {
            String t = stripQuotes(part.trim());
            if (!t.isEmpty()) out.add(t);
        }
        return out;
    }
}
