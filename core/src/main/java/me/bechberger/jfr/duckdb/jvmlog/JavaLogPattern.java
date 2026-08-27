package me.bechberger.jfr.duckdb.jvmlog;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

public final class JavaLogPattern implements LogPattern {

    private final String id;
    private final List<String> requiredTags;
    private final LogLevel minLevel;
    private final Pattern regex;
    private final List<FieldDef> fields;
    private final String tableName;

    public JavaLogPattern(
            String id,
            List<String> requiredTags,
            LogLevel minLevel,
            String regex,
            List<FieldDef> fields,
            String tableName) {
        this.id = id;
        this.requiredTags = requiredTags;
        this.minLevel = minLevel;
        this.regex = Pattern.compile(regex);
        this.fields = fields;
        this.tableName = tableName;
    }

    @Override
    public String id() { return id; }

    @Override
    public String tableName() { return tableName; }

    @Override
    public List<FieldDef> fields() { return fields; }

    @Override
    public boolean matches(LogLine line) {
        if (!line.hasAllTags(requiredTags)) return false;
        if (line.level() != null && minLevel != null &&
                line.level().ordinal() < minLevel.ordinal()) return false;
        return regex.matcher(line.message()).find();
    }

    @Override
    public Optional<MatchResult> extract(LogLine line) {
        var m = regex.matcher(line.message());
        if (!m.find()) return Optional.empty();

        var values = new ArrayList<>();
        int groupIdx = 1;
        for (var field : fields) {
            if (field.constantValue() != null) {
                values.add(field.constantValue());
            } else {
                String raw = groupIdx <= m.groupCount() ? m.group(groupIdx++) : null;
                try {
                    values.add(raw == null ? null : field.type().parse(raw));
                } catch (NumberFormatException e) {
                    values.add(null);
                }
            }
        }
        return Optional.of(new MatchResult(tableName, fields, values));
    }
}
