package me.bechberger.jfr.duckdb.jvmlog;

import java.nio.file.Path;
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

    /**
     * Match a line against ALL registered patterns, returning one MatchResult per
     * matching pattern. Patterns that write to the same table are all included.
     * Patterns that produce no result (empty Optional from extract()) are silently skipped.
     */
    public List<MatchResult> matchAll(LogLine line) {
        var results = new ArrayList<MatchResult>();
        for (var pattern : patterns) {
            if (pattern.matches(line)) {
                pattern.extract(line).ifPresent(results::add);
            }
        }
        return results;
    }

    public List<LogPattern> patterns() {
        return List.copyOf(patterns);
    }

    public Optional<LogPattern> findById(String id) {
        return patterns.stream().filter(p -> id.equals(p.id())).findFirst();
    }

    public void startWatching(Path dir) {
        if (dir == null || !dir.toFile().isDirectory()) return;
        Thread watcher = new Thread(() -> {
            try (java.nio.file.WatchService ws = dir.getFileSystem().newWatchService()) {
                dir.register(ws,
                        java.nio.file.StandardWatchEventKinds.ENTRY_CREATE,
                        java.nio.file.StandardWatchEventKinds.ENTRY_MODIFY);
                while (!Thread.currentThread().isInterrupted()) {
                    java.nio.file.WatchKey key = ws.take();
                    for (java.nio.file.WatchEvent<?> event : key.pollEvents()) {
                        if (event.kind() == java.nio.file.StandardWatchEventKinds.OVERFLOW) continue;
                        java.nio.file.Path changed = dir.resolve(
                                (java.nio.file.Path) event.context());
                        if (changed.toString().endsWith(".yaml")) {
                            try {
                                YamlPatternLoader.loadAndRegisterFile(changed, this);
                                System.out.println("[jvmlog] Reloaded pattern: " + changed.getFileName());
                            } catch (Exception e) {
                                System.err.println("[jvmlog] Failed to reload " + changed + ": " + e.getMessage());
                            }
                        }
                    }
                    if (!key.reset()) break;
                }
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            } catch (Exception e) {
                System.err.println("[jvmlog] WatchService error: " + e.getMessage());
            }
        }, "jvmlog-pattern-watcher");
        watcher.setDaemon(true);
        watcher.start();
    }
}
