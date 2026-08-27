package me.bechberger.jfr.duckdb.jvmlog;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;

public final class PatternRegistry {

    private final CopyOnWriteArrayList<LogPattern> patterns = new CopyOnWriteArrayList<>();

    public void addPattern(LogPattern p) {
        patterns.add(p);
    }

    public void addPatterns(List<LogPattern> ps) {
        patterns.addAll(ps);
    }

    public void replaceOrAdd(LogPattern p) {
        var updated = new ArrayList<LogPattern>();
        boolean replaced = false;
        for (var existing : patterns) {
            if (existing.id().equals(p.id())) {
                updated.add(p);
                replaced = true;
            } else {
                updated.add(existing);
            }
        }
        if (!replaced) updated.add(p);
        patterns.clear();
        patterns.addAll(updated);
    }

    public Optional<MatchResult> match(LogLine line) {
        for (var pattern : patterns) {
            if (pattern.matches(line)) {
                return pattern.extract(line);
            }
        }
        return Optional.empty();
    }

    public List<LogPattern> patterns() {
        return List.copyOf(patterns);
    }

    public Optional<LogPattern> findById(String id) {
        return patterns.stream().filter(p -> id.equals(p.id())).findFirst();
    }
}
