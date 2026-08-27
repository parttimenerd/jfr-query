package me.bechberger.jfr.duckdb.jvmlog;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

public final class PatternSuggester {

    public record FieldSuggestion(String name, String fieldType) {}

    public record SuggestedPattern(
            String id,
            List<String> tags,
            String level,
            String pattern,
            List<FieldSuggestion> fields,
            String table
    ) {}

    public static SuggestedPattern suggest(String rawLine) {
        // LogLineParser.parse() returns Optional<LogLine> — handle that
        Optional<LogLine> parsedOpt = LogLineParser.parse(rawLine);
        List<String> tags;
        String level;
        String body;
        if (parsedOpt.isPresent()) {
            LogLine parsed = parsedOpt.get();
            tags = parsed.tags() != null ? parsed.tags() : List.of();
            level = parsed.level() != null ? parsed.level().name().toLowerCase() : "info";
            body = parsed.message();
        } else {
            // Fall back: treat whole line as body
            tags = List.of();
            level = "info";
            body = rawLine;
        }

        PatternTokeniser.TokenisedLine tokenised = PatternTokeniser.tokenise(body);
        List<FieldSuggestion> fields = suggestFields(tokenised, body);
        String table = tableHeuristic(tags);
        String id = idFromTableAndFields(table, fields);

        return new SuggestedPattern(id, tags, level, tokenised.pattern(), fields, table);
    }

    private static List<FieldSuggestion> suggestFields(
            PatternTokeniser.TokenisedLine tokenised, String body) {
        List<FieldSuggestion> result = new ArrayList<>();
        List<PatternTokeniser.TokenType> types = tokenised.tokenTypes();

        boolean isGcLine = body.contains("GC(");
        boolean firstDone = false;
        boolean sawArrow = false;

        for (int i = 0; i < types.size(); i++) {
            PatternTokeniser.TokenType t = types.get(i);
            String name;
            String fieldType;

            switch (t) {
                case NUMBER -> {
                    if (isGcLine && !firstDone) {
                        name = "gcId";
                        fieldType = "int";
                        firstDone = true;
                    } else if (body.contains("ms") && i == types.size() - 1) {
                        name = body.contains("Pause") ? "pauseMs" : "durationMs";
                        fieldType = "double";
                    } else {
                        name = "value" + (i + 1);
                        fieldType = "double";
                    }
                }
                case BYTES -> {
                    if (!sawArrow) {
                        name = "heapBefore";
                        sawArrow = true;
                    } else if (i + 1 < types.size()
                            && types.get(i + 1) == PatternTokeniser.TokenType.BYTES) {
                        name = "heapAfter";
                    } else {
                        name = "heapCommitted";
                    }
                    fieldType = "bytes";
                }
                case ADDRESS -> {
                    name = "address" + (i + 1);
                    fieldType = "string";
                }
                case STRING -> {
                    name = "label" + (i + 1);
                    fieldType = "string";
                }
                default -> {
                    name = "field" + (i + 1);
                    fieldType = "string";
                }
            }
            result.add(new FieldSuggestion(name, fieldType));
        }
        return result;
    }

    private static String tableHeuristic(List<String> tags) {
        Set<String> tagSet = Set.copyOf(tags);
        if (tagSet.contains("gc") && tagSet.contains("init"))        return "jvmlog_gc_init";
        if (tagSet.contains("gc") && tagSet.contains("region"))      return "jvmlog_g1_regions";
        if (tagSet.contains("gc") && tagSet.contains("ergo"))        return "jvmlog_g1_ergonomics";
        if (tagSet.contains("gc") && tagSet.contains("phases"))      return "jvmlog_gc_phase";
        if (tagSet.contains("gc") && tagSet.contains("director"))    return "jvmlog_zgc_director";
        if (tagSet.contains("gc") && tagSet.contains("metaspace"))   return "jvmlog_metaspace";
        if (tagSet.contains("gc") && tagSet.contains("stringdedup")) return "jvmlog_stringdedup";
        if (tagSet.contains("gc") && tagSet.contains("shenandoah"))  return "jvmlog_gc_init";
        if (tagSet.contains("z")  && tagSet.contains("gc"))          return "jvmlog_zgc_phases";
        if (tagSet.contains("gc"))                                    return "jvmlog_gc_event";
        if (tagSet.contains("safepoint"))                             return "jvmlog_safepoint";
        return "jvmlog_unknown_lines";
    }

    private static String idFromTableAndFields(String table, List<FieldSuggestion> fields) {
        String base = table.replace("jvmlog_", "");
        String suffix = fields.isEmpty() ? "pattern"
                : fields.get(Math.min(1, fields.size() - 1)).name().toLowerCase();
        return (base + "_" + suffix).replaceAll("[^a-z0-9_]", "_");
    }

    private PatternSuggester() {}
}
