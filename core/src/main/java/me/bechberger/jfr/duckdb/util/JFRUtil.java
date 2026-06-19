package me.bechberger.jfr.duckdb.util;

import io.jafar.parser.api.Control;
import io.jafar.parser.api.UntypedJafarParser;
import io.jafar.parser.internal_api.metadata.MetadataClass;
import io.jafar.parser.internal_api.metadata.MetadataField;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.jetbrains.annotations.Nullable;

/**
 * Helpers for reading JFR recordings via {@code io.btrace:jafar-parser} and for working with
 * jafar's untyped event model.
 */
public class JFRUtil {

    /** Annotation type names used to read display metadata off jafar's {@link MetadataClass} / {@link MetadataField}. */
    public static final String LABEL_ANNOTATION = "jdk.jfr.Label";
    public static final String DESCRIPTION_ANNOTATION = "jdk.jfr.Description";
    public static final String CATEGORY_ANNOTATION = "jdk.jfr.Category";

    /** Receiver for jafar untyped events. {@code value} keys are field names. */
    @FunctionalInterface
    public interface EventCallback {
        void accept(MetadataClass type, Map<String, Object> value);
    }

    /**
     * Opens {@code path} with {@link UntypedJafarParser}, registers {@code callback}, and runs the
     * parser to completion.
     */
    public static void runUntyped(Path path, EventCallback callback) throws IOException {
        try (UntypedJafarParser parser = UntypedJafarParser.open(path)) {
            parser.handle(
                    (MetadataClass type, Map<String, Object> value, Control ctl) ->
                            callback.accept(type, value));
            parser.run();
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException("Failed to parse JFR " + path, e);
        }
    }

    public static String decodeBytecodeClassName(String name) {
        if (name == null) {
            return null;
        }

        int depth = 0;
        int len = name.length();
        while (depth < len && name.charAt(depth) == '[') {
            depth++;
        }

        String rest = name.substring(depth);
        String base;

        if (rest.isEmpty()) {
            base = "";
        } else if (rest.charAt(0) == 'L' && rest.endsWith(";")) {
            base = rest.substring(1, rest.length() - 1).replace('/', '.').replace('$', '.');
        } else {
            base =
                    switch (rest) {
                        case "B" -> "byte";
                        case "C" -> "char";
                        case "D" -> "double";
                        case "F" -> "float";
                        case "I" -> "int";
                        case "J" -> "long";
                        case "S" -> "short";
                        case "Z" -> "boolean";
                        case "V" -> "void";
                        default -> rest.replace('/', '.');
                    };
        }

        if (depth == 0) {
            return base;
        }

        StringBuilder sb = new StringBuilder(base);
        sb.append("[]".repeat(depth));
        return sb.toString();
    }

    /**
     * Simplifies a bytecode method descriptor by removing package names and the return type and
     * formatting it into Java style. E.g. (Ljava/lang/String;I)V becomes (String, int) If the
     * descriptor is invalid, returns the original descriptor.
     */
    public static String simplifyDescriptor(String descriptor) {
        if (descriptor == null) {
            return null;
        }
        if (!descriptor.startsWith("(")) {
            return descriptor;
        }
        int endParams = descriptor.indexOf(')');
        if (endParams == -1) {
            return descriptor;
        }
        String params = descriptor.substring(1, endParams);
        StringBuilder sb = new StringBuilder();
        sb.append('(');
        int i = 0;
        boolean first = true;
        while (i < params.length()) {
            if (!first) {
                sb.append(", ");
            } else {
                first = false;
            }
            int arrayDepth = 0;
            while (i < params.length() && params.charAt(i) == '[') {
                arrayDepth++;
                i++;
            }
            if (i >= params.length()) {
                return descriptor;
            }
            char c = params.charAt(i);
            String type;
            if (c == 'L') {
                int semicolonIndex = params.indexOf(';', i);
                if (semicolonIndex == -1) {
                    return descriptor;
                }
                String className = params.substring(i + 1, semicolonIndex);
                if (className.isEmpty()) {
                    return descriptor;
                }
                int lastSlash = className.lastIndexOf('/');
                if (lastSlash != -1) {
                    className = className.substring(lastSlash + 1);
                }
                type = className.replace('$', '.');
                i = semicolonIndex + 1;
            } else {
                type = decodeBytecodeClassName(String.valueOf(c));
                i++;
            }
            sb.append(type);
            sb.append("[]".repeat(Math.max(0, arrayDepth)));
        }
        sb.append(')');
        return sb.toString();
    }

    private static boolean isValidDescriptionPart(String entityName, String part) {
        if (part == null || part.isBlank()) {
            return false;
        }
        if (part.length() < 10) {
            return false;
        }
        String withoutJava = part.replace("Java ", "");
        String[] words = withoutJava.split(" +");
        int wordsInTableName =
                entityName.split("[A-Z]+").length
                        - (Character.isUpperCase(entityName.charAt(0)) ? 1 : 0);
        return words.length > wordsInTableName;
    }

    /**
     * Combines label and description into a single description and returns null if both are null
     * or too simple.
     */
    public static @Nullable String combineDescription(
            String entityName, String label, String description) {
        if ((description == null || description.isBlank()) && (label == null || label.isBlank())) {
            return null;
        }
        List<String> parts = new ArrayList<>();
        if (label != null && !label.isBlank()) {
            parts.add(label);
        }
        if (description != null && !description.isBlank()) {
            parts.add(description);
        }
        String joined =
                parts.stream()
                        .filter(p -> isValidDescriptionPart(entityName, p))
                        .collect(Collectors.joining(". "))
                        .replace("..", ".");
        if (!joined.isBlank()) {
            return joined;
        }
        return null;
    }

    /** Reads label + description annotations off a jafar {@link MetadataClass} and combines them. */
    public static @Nullable String getCombinedTypeDescription(MetadataClass cls) {
        String label = JafarValues.getAnnotationValue(cls, LABEL_ANNOTATION);
        String description = JafarValues.getAnnotationValue(cls, DESCRIPTION_ANNOTATION);
        return combineDescription(cls.getName(), label, description);
    }

    /** Reads label + description annotations off a {@link MetadataField}'s type. */
    public static @Nullable String getCombinedTypeDescription(MetadataField field) {
        return getCombinedTypeDescription(field.getType());
    }
}
