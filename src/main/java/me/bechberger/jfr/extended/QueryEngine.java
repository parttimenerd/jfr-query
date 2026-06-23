package me.bechberger.jfr.extended;

import me.bechberger.jfr.extended.ast.ASTNodes.*;
import me.bechberger.jfr.extended.JFRTable.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.time.Instant;
import java.time.Duration;

/**
 * Query engine for executing JFR extended queries with caching support
 */
public class QueryEngine {

    /**
     * Query execution result
     */
    public record QueryResult(
        Table result,
        Duration executionTime,
        Optional<String> error,
        Map<String, Object> metadata
    ) {}

    /**
     * Query cache entry
     */
    public record CacheEntry(
        String queryHash,
        QueryResult result,
        Instant createdAt,
        long sizeBytes
    ) {}

    /**
     * Query execution context
     */
    public record ExecutionContext(
        Map<String, Table> variables,
        Map<String, Table> views,
        Set<String> availableEvents,
        Map<String, List<String>> eventFields
    ) {}

    /**
     * GC correlation service for associating events with GC IDs
     */
    public static class GCCorrelationService {
        private final Map<String, List<GCEvent>> gcEvents = new HashMap<>();

        public record GCEvent(long id, Instant startTime, Instant endTime, Duration duration) {}

        public void addGCEvent(String recordingId, GCEvent event) {
            gcEvents.computeIfAbsent(recordingId, k -> new ArrayList<>()).add(event);
        }

        public Optional<Long> getBeforeGCId(String recordingId, Instant eventTime) {
            List<GCEvent> events = gcEvents.get(recordingId);
            if (events == null) return Optional.empty();

            return events.stream()
                .filter(gc -> gc.startTime().isBefore(eventTime))
                .max(Comparator.comparing(GCEvent::startTime))
                .map(GCEvent::id);
        }

        public Optional<Long> getAfterGCId(String recordingId, Instant eventTime) {
            List<GCEvent> events = gcEvents.get(recordingId);
            if (events == null) return Optional.empty();

            return events.stream()
                .filter(gc -> gc.startTime().isAfter(eventTime))
                .min(Comparator.comparing(GCEvent::startTime))
                .map(GCEvent::id);
        }

        public List<Long> getPercentileGCIds(String recordingId, int percentile, String field) {
            List<GCEvent> events = gcEvents.get(recordingId);
            if (events == null) return List.of();

            List<Duration> durations = events.stream()
                .map(GCEvent::duration)
                .sorted()
                .toList();

            if (durations.isEmpty()) return List.of();

            int index = (int) Math.ceil(durations.size() * percentile / 100.0) - 1;
            Duration threshold = durations.get(Math.max(0, index));

            return events.stream()
                .filter(gc -> gc.duration().compareTo(threshold) >= 0)
                .map(GCEvent::id)
                .toList();
        }
    }

    private final Map<String, CacheEntry> queryCache = new ConcurrentHashMap<>();
    private final AtomicLong cacheSize = new AtomicLong(0);
    private final long maxCacheSize;
    private final GCCorrelationService gcService;
    private final Map<String, Table> globalViews;

    public QueryEngine(long maxCacheSizeBytes) {
        this.maxCacheSize = maxCacheSizeBytes;
        this.gcService = new GCCorrelationService();
        this.globalViews = new ConcurrentHashMap<>();
    }

    public QueryEngine() {
        this(100 * 1024 * 1024); // 100MB default cache
    }

    /**
     * Execute a program containing multiple statements
     */
    public QueryResult executeProgram(Program program, ExecutionContext context) {
        Instant startTime = Instant.now();

        try {
            ExecutionContext mutableContext = new ExecutionContext(
                new HashMap<>(context.variables()),
                new HashMap<>(context.views()),
                context.availableEvents(),
                context.eventFields()
            );

            QueryResult lastResult = null;

            for (Statement statement : program.statements()) {
                if (statement instanceof Assignment assignment) {
                    QueryResult assignmentResult = executeQuery(assignment.query(), mutableContext);
                    if (assignmentResult.error().isPresent()) {
                        return assignmentResult;
                    }
                    mutableContext.variables().put(assignment.variable(), assignmentResult.result());
                } else if (statement instanceof Query query) {
                    lastResult = executeQuery(query, mutableContext);
                    if (lastResult.error().isPresent()) {
                        return lastResult;
                    }
                }
            }

            Duration executionTime = Duration.between(startTime, Instant.now());

            if (lastResult == null) {
                return new QueryResult(
                    createEmptyTable(),
                    executionTime,
                    Optional.empty(),
                    Map.of("statements", program.statements().size())
                );
            }

            return new QueryResult(
                lastResult.result(),
                executionTime,
                Optional.empty(),
                Map.of("statements", program.statements().size())
            );

        } catch (Exception e) {
            Duration executionTime = Duration.between(startTime, Instant.now());
            return new QueryResult(
                createEmptyTable(),
                executionTime,
                Optional.of("Execution error: " + e.getMessage()),
                Map.of("error", e.getClass().getSimpleName())
            );
        }
    }

    /**
     * Execute a single query
     */
    public QueryResult executeQuery(Query query, ExecutionContext context) {
        String queryHash = calculateQueryHash(query, context);

        // Check cache first
        CacheEntry cachedResult = queryCache.get(queryHash);
        if (cachedResult != null) {
            return cachedResult.result();
        }

        Instant startTime = Instant.now();

        try {
            QueryResult result = switch (query) {
                case ExtendedQuery extQuery -> executeExtendedQuery(extQuery, context);
                case LegacyQuery legacyQuery -> executeLegacyQuery(legacyQuery, context);
                case ShowQuery showQuery -> executeShowQuery(showQuery, context);
            };

            // Cache the result if successful
            if (result.error().isEmpty()) {
                cacheResult(queryHash, result);
            }

            return result;

        } catch (Exception e) {
            Duration executionTime = Duration.between(startTime, Instant.now());
            return new QueryResult(
                createEmptyTable(),
                executionTime,
                Optional.of("Query execution error: " + e.getMessage()),
                Map.of("queryType", query.getClass().getSimpleName())
            );
        }
    }

    private QueryResult executeExtendedQuery(ExtendedQuery query, ExecutionContext context) {
        Instant startTime = Instant.now();

        // Process variable declarations
        if (query.variables().isPresent()) {
            processVariableDeclarations(query.variables().get(), context);
        }

        // Process WITH clause
        if (query.withClause().isPresent()) {
            processWithClause(query.withClause().get(), context);
        }

        // Execute main query
        Table result = executeSelectQuery(query, context);

        Duration executionTime = Duration.between(startTime, Instant.now());

        return new QueryResult(
            result,
            executionTime,
            Optional.empty(),
            Map.of(
                "queryType", "extended",
                "hasVariables", query.variables().isPresent(),
                "hasWithClause", query.withClause().isPresent(),
                "hasWhere", query.whereClause().isPresent(),
                "hasGroupBy", query.groupByClause().isPresent(),
                "hasOrderBy", query.orderByClause().isPresent(),
                "hasLimit", query.limitClause().isPresent()
            )
        );
    }

    private QueryResult executeLegacyQuery(LegacyQuery query, ExecutionContext context) {
        Instant startTime = Instant.now();

        // For demonstration, we'll create a simple result
        // In a real implementation, this would call the actual JFR query engine
        Table result = createLegacyQueryResult(query.queryText());

        Duration executionTime = Duration.between(startTime, Instant.now());

        return new QueryResult(
            result,
            executionTime,
            Optional.empty(),
            Map.of("queryType", "legacy", "queryText", query.queryText())
        );
    }

    private QueryResult executeShowQuery(ShowQuery query, ExecutionContext context) {
        Instant startTime = Instant.now();

        Table result = switch (query.showType()) {
            case EVENTS -> createEventsTable(context.availableEvents());
            case FIELDS -> query.eventType().isPresent() ?
                createFieldsTable(query.eventType().get(), context.eventFields()) :
                createEmptyTable();
        };

        Duration executionTime = Duration.between(startTime, Instant.now());

        return new QueryResult(
            result,
            executionTime,
            Optional.empty(),
            Map.of("queryType", "show", "showType", query.showType().name())
        );
    }

    private void processVariableDeclarations(VariableDeclarations variables, ExecutionContext context) {
        for (VariableDeclaration varDecl : variables.declarations()) {
            Object value = evaluateExpression(varDecl.value(), context);
            // For simplicity, we'll store as a single-value table
            Table valueTable = createValueTable(varDecl.name(), value);
            context.variables().put(varDecl.name(), valueTable);
        }
    }

    private void processWithClause(WithClause withClause, ExecutionContext context) {
        for (CommonTableExpression cte : withClause.ctes()) {
            QueryResult cteResult = executeQuery(cte.query(), context);
            if (cteResult.error().isEmpty()) {
                context.views().put(cte.name(), cteResult.result());
            }
        }
    }

    private Table executeSelectQuery(ExtendedQuery query, ExecutionContext context) {
        // Get source tables
        List<Table> sourceTables = new ArrayList<>();
        for (TableSource source : query.fromClause().sources()) {
            Table table = getTable(source.name(), context);
            if (table != null) {
                sourceTables.add(table);
            }
        }

        if (sourceTables.isEmpty()) {
            return createEmptyTable();
        }

        // For demonstration, return the first table with some filtering
        Table sourceTable = sourceTables.get(0);

        // Apply WHERE clause
        List<Row> filteredRows = sourceTable.rows();
        if (query.whereClause().isPresent()) {
            filteredRows = applyWhereClause(filteredRows, query.whereClause().get(), sourceTable, context);
        }

        // Apply GROUP BY
        if (query.groupByClause().isPresent()) {
            filteredRows = applyGroupBy(filteredRows, query.groupByClause().get(), sourceTable, context);
        }

        // Apply ORDER BY
        if (query.orderByClause().isPresent()) {
            filteredRows = applyOrderBy(filteredRows, query.orderByClause().get(), sourceTable, context);
        }

        // Apply LIMIT
        if (query.limitClause().isPresent()) {
            int limit = query.limitClause().get().limit();
            filteredRows = filteredRows.stream().limit(limit).toList();
        }

        // Select columns
        List<Column> resultColumns = sourceTable.columns();
        if (!query.selectClause().selectAll()) {
            // For demonstration, keep all columns
            // In a real implementation, this would project only selected columns
        }

        return new Table(
            sourceTable.name() + "_result",
            resultColumns,
            filteredRows,
            Optional.of("Query result"),
            Map.of("originalRows", sourceTable.rows().size(), "filteredRows", filteredRows.size())
        );
    }

    private List<Row> applyWhereClause(List<Row> rows, WhereClause whereClause, Table table, ExecutionContext context) {
        return rows.stream()
            .filter(row -> evaluateCondition(whereClause.condition(), row, table, context))
            .toList();
    }

    private List<Row> applyGroupBy(List<Row> rows, GroupByClause groupBy, Table table, ExecutionContext context) {
        // Simplified grouping - in a real implementation, this would be more sophisticated
        return rows;
    }

    private List<Row> applyOrderBy(List<Row> rows, OrderByClause orderBy, Table table, ExecutionContext context) {
        // Simplified ordering - in a real implementation, this would sort by the specified columns
        return new ArrayList<>(rows);
    }

    private boolean evaluateCondition(Expression condition, Row row, Table table, ExecutionContext context) {
        // Simplified condition evaluation
        // In a real implementation, this would evaluate the full expression tree
        return true;
    }

    private Object evaluateExpression(Expression expression, ExecutionContext context) {
        return switch (expression) {
            case Literal literal -> literal.value();
            case Identifier identifier -> context.variables().get(identifier.name());
            case BinaryExpression binExpr -> evaluateBinaryExpression(binExpr, context);
            case FunctionCall funcCall -> evaluateFunctionCall(funcCall, context);
            default -> null;
        };
    }

    private Object evaluateBinaryExpression(BinaryExpression expression, ExecutionContext context) {
        Object left = evaluateExpression(expression.left(), context);
        Object right = evaluateExpression(expression.right(), context);

        return switch (expression.operator()) {
            case PLUS -> addValues(left, right);
            case MINUS -> subtractValues(left, right);
            case MULTIPLY -> multiplyValues(left, right);
            case DIVIDE -> divideValues(left, right);
            case EQUALS -> Objects.equals(left, right);
            case GREATER_THAN -> compareValues(left, right) > 0;
            case LESS_THAN -> compareValues(left, right) < 0;
            default -> false;
        };
    }

    private Object evaluateFunctionCall(FunctionCall funcCall, ExecutionContext context) {
        return switch (funcCall.name()) {
            case "P99", "P95", "P90" -> evaluatePercentileFunction(funcCall, context);
            case "COUNT" -> evaluateCountFunction(funcCall, context);
            case "AVG" -> evaluateAvgFunction(funcCall, context);
            case "MAX" -> evaluateMaxFunction(funcCall, context);
            case "MIN" -> evaluateMinFunction(funcCall, context);
            default -> null;
        };
    }

    private Object evaluatePercentileFunction(FunctionCall funcCall, ExecutionContext context) {
        // Simplified percentile calculation
        int percentile = switch (funcCall.name()) {
            case "P99" -> 99;
            case "P95" -> 95;
            case "P90" -> 90;
            default -> 50;
        };

        if (funcCall.arguments().size() >= 3) {
            String tableName = ((Identifier) funcCall.arguments().get(0)).name();
            String idField = ((Identifier) funcCall.arguments().get(1)).name();
            String valueField = ((Identifier) funcCall.arguments().get(2)).name();

            return gcService.getPercentileGCIds("default", percentile, valueField);
        }

        return List.of();
    }

    private Object evaluateCountFunction(FunctionCall funcCall, ExecutionContext context) {
        return 0L; // Simplified
    }

    private Object evaluateAvgFunction(FunctionCall funcCall, ExecutionContext context) {
        return 0.0; // Simplified
    }

    private Object evaluateMaxFunction(FunctionCall funcCall, ExecutionContext context) {
        return 0L; // Simplified
    }

    private Object evaluateMinFunction(FunctionCall funcCall, ExecutionContext context) {
        return 0L; // Simplified
    }

    private Table getTable(String name, ExecutionContext context) {
        // Check variables first
        Table table = context.variables().get(name);
        if (table != null) return table;

        // Check views
        table = context.views().get(name);
        if (table != null) return table;

        // Check global views
        table = globalViews.get(name);
        if (table != null) return table;

        // Create mock table for known event types
        if (context.availableEvents().contains(name)) {
            return createMockEventTable(name, context.eventFields().get(name));
        }

        return null;
    }

    private Table createMockEventTable(String eventType, List<String> fields) {
        if (fields == null) fields = List.of("id", "startTime", "duration");

        List<Column> columns = fields.stream()
            .map(field -> new Column(field, inferFieldType(field)))
            .toList();

        // Create some mock data
        List<Row> rows = List.of(
            new Row(columns.stream()
                .map(col -> createMockCell(col.type()))
                .toList())
        );

        return new Table(eventType, columns, rows);
    }

    private CellType inferFieldType(String fieldName) {
        return switch (fieldName.toLowerCase()) {
            case "id", "count" -> CellType.NUMBER;
            case "duration" -> CellType.DURATION;
            case "starttime", "endtime", "timestamp" -> CellType.TIMESTAMP;
            case "size", "allocationsize", "memorysize" -> CellType.MEMORY_SIZE;
            case "rate" -> CellType.RATE;
            case "active", "enabled" -> CellType.BOOLEAN;
            default -> CellType.STRING;
        };
    }

    private Cell createMockCell(CellType type) {
        return switch (type) {
            case STRING -> CellFactory.createString("mock_value");
            case NUMBER -> CellFactory.createNumber(42L);
            case DURATION -> CellFactory.createDuration(Duration.ofMillis(100));
            case TIMESTAMP -> CellFactory.createTimestamp(Instant.now());
            case MEMORY_SIZE -> CellFactory.createMemorySize(1024L);
            case RATE -> CellFactory.createRate(10.0, "s");
            case BOOLEAN -> CellFactory.createBoolean(true);
            case FLOATING_POINT -> CellFactory.createFloatingPoint(3.14);
            case NULL -> CellFactory.createNull();
        };
    }

    private Table createEmptyTable() {
        return new Table("empty", List.of(), List.of());
    }

    private Table createEventsTable(Set<String> events) {
        List<Column> columns = List.of(
            new Column("name", CellType.STRING),
            new Column("count", CellType.NUMBER)
        );

        List<Row> rows = events.stream()
            .map(event -> new Row(List.of(
                CellFactory.createString(event),
                CellFactory.createNumber((long) (Math.random() * 1000))
            )))
            .toList();

        return new Table("events", columns, rows);
    }

    private Table createFieldsTable(String eventType, Map<String, List<String>> eventFields) {
        List<String> fields = eventFields.getOrDefault(eventType, List.of());

        List<Column> columns = List.of(
            new Column("name", CellType.STRING),
            new Column("type", CellType.STRING)
        );

        List<Row> rows = fields.stream()
            .map(field -> new Row(List.of(
                CellFactory.createString(field),
                CellFactory.createString(inferFieldType(field).name())
            )))
            .toList();

        return new Table(eventType + "_fields", columns, rows);
    }

    private Table createValueTable(String name, Object value) {
        List<Column> columns = List.of(new Column("value", CellType.STRING));
        List<Row> rows = List.of(new Row(List.of(CellFactory.createString(String.valueOf(value)))));
        return new Table(name, columns, rows);
    }

    private Table createLegacyQueryResult(String queryText) {
        // Mock legacy query result
        List<Column> columns = List.of(
            new Column("result", CellType.STRING)
        );

        List<Row> rows = List.of(
            new Row(List.of(CellFactory.createString("Legacy query result for: " + queryText)))
        );

        return new Table("legacy_result", columns, rows);
    }

    // Utility methods for value operations
    private Object addValues(Object left, Object right) {
        if (left instanceof Number l && right instanceof Number r) {
            return l.doubleValue() + r.doubleValue();
        }
        return String.valueOf(left) + String.valueOf(right);
    }

    private Object subtractValues(Object left, Object right) {
        if (left instanceof Number l && right instanceof Number r) {
            return l.doubleValue() - r.doubleValue();
        }
        return 0.0;
    }

    private Object multiplyValues(Object left, Object right) {
        if (left instanceof Number l && right instanceof Number r) {
            return l.doubleValue() * r.doubleValue();
        }
        return 0.0;
    }

    private Object divideValues(Object left, Object right) {
        if (left instanceof Number l && right instanceof Number r && r.doubleValue() != 0) {
            return l.doubleValue() / r.doubleValue();
        }
        return 0.0;
    }

    @SuppressWarnings("unchecked")
    private int compareValues(Object left, Object right) {
        if (left instanceof Comparable l && right instanceof Comparable r) {
            return l.compareTo(r);
        }
        return 0;
    }

    // Cache management
    private String calculateQueryHash(Query query, ExecutionContext context) {
        return String.valueOf(Objects.hash(query.toString(), context.variables().keySet()));
    }

    private void cacheResult(String queryHash, QueryResult result) {
        long resultSize = estimateResultSize(result);

        // Evict old entries if necessary
        while (cacheSize.get() + resultSize > maxCacheSize && !queryCache.isEmpty()) {
            evictOldestEntry();
        }

        CacheEntry entry = new CacheEntry(queryHash, result, Instant.now(), resultSize);
        queryCache.put(queryHash, entry);
        cacheSize.addAndGet(resultSize);
    }

    private void evictOldestEntry() {
        Optional<Map.Entry<String, CacheEntry>> oldest = queryCache.entrySet().stream()
            .min(Comparator.comparing(entry -> entry.getValue().createdAt()));

        if (oldest.isPresent()) {
            String key = oldest.get().getKey();
            CacheEntry entry = queryCache.remove(key);
            if (entry != null) {
                cacheSize.addAndGet(-entry.sizeBytes());
            }
        }
    }

    private long estimateResultSize(QueryResult result) {
        // Rough estimation - in practice you'd want more accurate sizing
        return result.result().rows().size() * result.result().columns().size() * 50L;
    }

    // Public API methods
    public void addView(String name, Table view) {
        globalViews.put(name, view);
    }

    public void removeView(String name) {
        globalViews.remove(name);
    }

    public GCCorrelationService getGCService() {
        return gcService;
    }

    public void clearCache() {
        queryCache.clear();
        cacheSize.set(0);
    }

    public Map<String, Object> getCacheStats() {
        return Map.of(
            "size", queryCache.size(),
            "sizeBytes", cacheSize.get(),
            "maxSizeBytes", maxCacheSize,
            "hitRate", 0.0 // Would need to track hits/misses for real implementation
        );
    }
}