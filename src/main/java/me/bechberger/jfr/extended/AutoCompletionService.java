package me.bechberger.jfr.extended;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Auto-completion service for the extended JFR query language
 */
public class AutoCompletionService {

    /**
     * Represents an auto-completion suggestion
     */
    public record CompletionItem(
        String text,
        String type,
        String description,
        int priority,
        String insertText,
        Optional<String> detail
    ) {}

    /**
     * Result of auto-completion request
     */
    public record CompletionResult(
        List<CompletionItem> items,
        int cursorPosition,
        String query
    ) {}

    /**
     * Context information for auto-completion
     */
    public record CompletionContext(
        String query,
        int cursorPosition,
        List<Token> tokens,
        Token currentToken,
        Token previousToken,
        List<String> availableEvents,
        Map<String, List<String>> eventFields
    ) {}

    private final Set<String> availableEvents;
    private final Map<String, List<String>> eventFields;
    private final Map<String, String> eventDescriptions;

    public AutoCompletionService() {
        this.availableEvents = getDefaultEvents();
        this.eventFields = getDefaultEventFields();
        this.eventDescriptions = getDefaultEventDescriptions();
    }

    public AutoCompletionService(Set<String> availableEvents,
                               Map<String, List<String>> eventFields,
                               Map<String, String> eventDescriptions) {
        this.availableEvents = availableEvents;
        this.eventFields = eventFields;
        this.eventDescriptions = eventDescriptions;
    }

    /**
     * Provides auto-completion suggestions for the given query and cursor position
     */
    public CompletionResult getCompletions(String query, int cursorPosition) {
        try {
            Lexer lexer = new Lexer(query);
            List<Token> tokens = lexer.tokenize();

            CompletionContext context = createContext(query, cursorPosition, tokens);
            List<CompletionItem> completions = generateCompletions(context);

            return new CompletionResult(completions, cursorPosition, query);
        } catch (Exception e) {
            return new CompletionResult(List.of(), cursorPosition, query);
        }
    }

    private CompletionContext createContext(String query, int cursorPosition, List<Token> tokens) {
        Token currentToken = null;
        Token previousToken = null;

        for (int i = 0; i < tokens.size(); i++) {
            Token token = tokens.get(i);
            if (token.position() <= cursorPosition &&
                cursorPosition <= token.position() + token.value().length()) {
                currentToken = token;
                if (i > 0) {
                    previousToken = tokens.get(i - 1);
                }
                break;
            }
        }

        return new CompletionContext(
            query,
            cursorPosition,
            tokens,
            currentToken,
            previousToken,
            new ArrayList<>(availableEvents),
            eventFields
        );
    }

    private List<CompletionItem> generateCompletions(CompletionContext context) {
        List<CompletionItem> completions = new ArrayList<>();

        // Add context-specific completions
        addKeywordCompletions(context, completions);
        addEventCompletions(context, completions);
        addFieldCompletions(context, completions);
        addFunctionCompletions(context, completions);
        addOperatorCompletions(context, completions);
        addLiteralCompletions(context, completions);

        // Sort by priority and alphabetically
        completions.sort((a, b) -> {
            int priorityCompare = Integer.compare(b.priority(), a.priority());
            if (priorityCompare != 0) return priorityCompare;
            return a.text().compareToIgnoreCase(b.text());
        });

        return completions;
    }

    private void addKeywordCompletions(CompletionContext context, List<CompletionItem> completions) {
        String[] keywords = {
            "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "LIMIT", "AS",
            "AND", "OR", "NOT", "IN", "LIKE", "BETWEEN", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "FUZZY",
            "ON", "WITH", "SHOW", "EVENTS", "FIELDS", "ASC", "DESC", "HAVING", "FIRST", "LAST"
        };

        for (String keyword : keywords) {
            if (isKeywordApplicable(keyword, context)) {
                completions.add(new CompletionItem(
                    keyword,
                    "keyword",
                    "SQL keyword",
                    getKeywordPriority(keyword, context),
                    keyword,
                    Optional.of("SQL keyword: " + keyword)
                ));
            }
        }

        // Add extended query prefix
        if (context.previousToken() == null || context.previousToken().type() != TokenType.AT) {
            completions.add(new CompletionItem(
                "@",
                "special",
                "Extended query prefix",
                100,
                "@",
                Optional.of("Prefix for extended JFR queries")
            ));
        }
    }

    private void addEventCompletions(CompletionContext context, List<CompletionItem> completions) {
        if (isEventContext(context)) {
            for (String event : availableEvents) {
                String description = eventDescriptions.getOrDefault(event, "JFR event type");
                completions.add(new CompletionItem(
                    event,
                    "event",
                    description,
                    80,
                    event,
                    Optional.of("Event: " + event + " - " + description)
                ));
            }
        }
    }

    private void addFieldCompletions(CompletionContext context, List<CompletionItem> completions) {
        if (isFieldContext(context)) {
            // Get fields from current context
            Set<String> contextFields = getFieldsFromContext(context);

            for (String field : contextFields) {
                completions.add(new CompletionItem(
                    field,
                    "field",
                    "Event field",
                    70,
                    field,
                    Optional.of("Field: " + field)
                ));
            }

            // Add special GC fields
            completions.add(new CompletionItem(
                "before_gc",
                "special",
                "GC ID before this event",
                75,
                "before_gc",
                Optional.of("Special field: GC ID that occurred before this event")
            ));

            completions.add(new CompletionItem(
                "after_gc",
                "special",
                "GC ID after this event",
                75,
                "after_gc",
                Optional.of("Special field: GC ID that occurred after this event")
            ));
        }
    }

    private void addFunctionCompletions(CompletionContext context, List<CompletionItem> completions) {
        if (isFunctionContext(context)) {
            String[] functions = {
                "AVG", "COUNT", "DIFF", "FIRST", "LAST", "LAST_BATCH", "LIST",
                "MAX", "MEDIAN", "MIN", "P90", "P95", "P99", "P999", "STDEV", "SUM", "UNIQUE"
            };

            for (String function : functions) {
                completions.add(new CompletionItem(
                    function,
                    "function",
                    getFunctionDescription(function),
                    85,
                    function + "(",
                    Optional.of("Aggregate function: " + function)
                ));
            }
        }
    }

    private void addOperatorCompletions(CompletionContext context, List<CompletionItem> completions) {
        if (isOperatorContext(context)) {
            String[] operators = {"=", "!=", "<", "<=", ">", ">=", "+", "-", "*", "/", "%", "AND", "OR", "LIKE", "IN"};

            for (String operator : operators) {
                completions.add(new CompletionItem(
                    operator,
                    "operator",
                    "Operator",
                    60,
                    operator,
                    Optional.of("Operator: " + operator)
                ));
            }
        }
    }

    private void addLiteralCompletions(CompletionContext context, List<CompletionItem> completions) {
        if (isLiteralContext(context)) {
            // Duration examples
            completions.add(new CompletionItem("10ms", "duration", "10 milliseconds", 50, "10ms", Optional.of("Duration: 10 milliseconds")));
            completions.add(new CompletionItem("1s", "duration", "1 second", 50, "1s", Optional.of("Duration: 1 second")));
            completions.add(new CompletionItem("5m", "duration", "5 minutes", 50, "5m", Optional.of("Duration: 5 minutes")));

            // Memory examples
            completions.add(new CompletionItem("1MB", "memory", "1 megabyte", 50, "1MB", Optional.of("Memory: 1 megabyte")));
            completions.add(new CompletionItem("512KB", "memory", "512 kilobytes", 50, "512KB", Optional.of("Memory: 512 kilobytes")));
            completions.add(new CompletionItem("1GB", "memory", "1 gigabyte", 50, "1GB", Optional.of("Memory: 1 gigabyte")));

            // Rate examples
            completions.add(new CompletionItem("10/s", "rate", "10 per second", 50, "10/s", Optional.of("Rate: 10 per second")));
            completions.add(new CompletionItem("5/m", "rate", "5 per minute", 50, "5/m", Optional.of("Rate: 5 per minute")));

            // Boolean
            completions.add(new CompletionItem("true", "boolean", "Boolean true", 50, "true", Optional.of("Boolean: true")));
            completions.add(new CompletionItem("false", "boolean", "Boolean false", 50, "false", Optional.of("Boolean: false")));
        }
    }

    private boolean isKeywordApplicable(String keyword, CompletionContext context) {
        // Context-sensitive keyword filtering
        return switch (keyword) {
            case "SELECT" -> context.previousToken() == null || context.previousToken().type() == TokenType.AT;
            case "FROM" -> hasToken(context, TokenType.SELECT);
            case "WHERE" -> hasToken(context, TokenType.FROM);
            case "GROUP BY", "ORDER BY" -> hasToken(context, TokenType.FROM);
            case "LIMIT" -> hasToken(context, TokenType.FROM);
            case "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "FUZZY" -> hasToken(context, TokenType.FROM);
            default -> true;
        };
    }

    private boolean isEventContext(CompletionContext context) {
        return context.previousToken() != null &&
               (context.previousToken().type() == TokenType.FROM ||
                context.previousToken().type() == TokenType.COMMA ||
                context.previousToken().type() == TokenType.JOIN);
    }

    private boolean isFieldContext(CompletionContext context) {
        return context.previousToken() != null &&
               (context.previousToken().type() == TokenType.DOT ||
                context.previousToken().type() == TokenType.SELECT ||
                context.previousToken().type() == TokenType.COMMA ||
                (context.previousToken().type() == TokenType.BY &&
                 hasPreviousToken(context, TokenType.GROUP)) ||
                (context.previousToken().type() == TokenType.BY &&
                 hasPreviousToken(context, TokenType.ORDER)));
    }

    private boolean isFunctionContext(CompletionContext context) {
        return context.previousToken() != null &&
               (context.previousToken().type() == TokenType.SELECT ||
                context.previousToken().type() == TokenType.COMMA ||
                context.previousToken().type() == TokenType.LPAREN);
    }

    private boolean isOperatorContext(CompletionContext context) {
        return context.previousToken() != null &&
               (context.previousToken().type() == TokenType.IDENTIFIER ||
                context.previousToken().type() == TokenType.NUMBER ||
                context.previousToken().type() == TokenType.RPAREN);
    }

    private boolean isLiteralContext(CompletionContext context) {
        return context.previousToken() != null &&
               (context.previousToken().type() == TokenType.EQUALS ||
                context.previousToken().type() == TokenType.NOT_EQUALS ||
                context.previousToken().type() == TokenType.LESS_THAN ||
                context.previousToken().type() == TokenType.LESS_EQUAL ||
                context.previousToken().type() == TokenType.GREATER_THAN ||
                context.previousToken().type() == TokenType.GREATER_EQUAL ||
                context.previousToken().type() == TokenType.LIKE);
    }

    private boolean hasToken(CompletionContext context, TokenType tokenType) {
        return context.tokens().stream().anyMatch(token -> token.type() == tokenType);
    }

    private boolean hasPreviousToken(CompletionContext context, TokenType tokenType) {
        for (int i = context.tokens().size() - 1; i >= 0; i--) {
            if (context.tokens().get(i).type() == tokenType) {
                return true;
            }
        }
        return false;
    }

    private Set<String> getFieldsFromContext(CompletionContext context) {
        Set<String> fields = new HashSet<>();

        // Extract event types from FROM clause
        Set<String> eventTypes = extractEventTypesFromTokens(context.tokens());

        for (String eventType : eventTypes) {
            fields.addAll(eventFields.getOrDefault(eventType, List.of()));
        }

        // Add common fields
        fields.addAll(List.of("startTime", "endTime", "duration", "thread", "stackTrace"));

        return fields;
    }

    private Set<String> extractEventTypesFromTokens(List<Token> tokens) {
        Set<String> eventTypes = new HashSet<>();
        boolean inFromClause = false;

        for (Token token : tokens) {
            if (token.type() == TokenType.FROM) {
                inFromClause = true;
            } else if (token.type() == TokenType.WHERE || token.type() == TokenType.GROUP ||
                      token.type() == TokenType.ORDER || token.type() == TokenType.LIMIT) {
                inFromClause = false;
            } else if (inFromClause && token.type() == TokenType.IDENTIFIER) {
                eventTypes.add(token.value());
            }
        }

        return eventTypes;
    }

    private int getKeywordPriority(String keyword, CompletionContext context) {
        return switch (keyword) {
            case "SELECT" -> 100;
            case "FROM" -> 95;
            case "WHERE" -> 90;
            case "GROUP BY", "ORDER BY" -> 85;
            case "LIMIT" -> 80;
            default -> 70;
        };
    }

    private String getFunctionDescription(String function) {
        return switch (function) {
            case "AVG" -> "Numeric average";
            case "COUNT" -> "Count of values";
            case "DIFF" -> "Difference between last and first value";
            case "FIRST" -> "First value";
            case "LAST" -> "Last value";
            case "LAST_BATCH" -> "Last set of values with same end timestamp";
            case "LIST" -> "All values in comma-separated list";
            case "MAX" -> "Maximum value";
            case "MEDIAN" -> "Median value";
            case "MIN" -> "Minimum value";
            case "P90" -> "90th percentile";
            case "P95" -> "95th percentile";
            case "P99" -> "99th percentile";
            case "P999" -> "99.9th percentile";
            case "STDEV" -> "Standard deviation";
            case "SUM" -> "Sum of values";
            case "UNIQUE" -> "Count of unique values";
            default -> "Aggregate function";
        };
    }

    private static Set<String> getDefaultEvents() {
        return Set.of(
            "jdk.GarbageCollection",
            "jdk.ExecutionSample",
            "jdk.ThreadPark",
            "jdk.ObjectAllocationInNewTLAB",
            "jdk.ObjectAllocationOutsideTLAB",
            "jdk.ThreadStart",
            "jdk.ThreadEnd",
            "jdk.MonitorEnter",
            "jdk.MonitorWait",
            "jdk.JavaMonitorEnter",
            "jdk.JavaMonitorWait",
            "jdk.SystemGC",
            "jdk.AllocationRequiringGC",
            "jdk.ConcurrentModeFailure",
            "jdk.G1GarbageCollection",
            "jdk.ParallelOldGarbageCollection",
            "jdk.SerialOldGarbageCollection",
            "jdk.PSYoungGarbageCollection",
            "jdk.DefNewGarbageCollection"
        );
    }

    private static Map<String, List<String>> getDefaultEventFields() {
        Map<String, List<String>> fields = new HashMap<>();

        fields.put("jdk.GarbageCollection", List.of(
            "gcId", "name", "cause", "sumOfPauses", "longestPause", "startTime", "endTime", "duration"
        ));

        fields.put("jdk.ExecutionSample", List.of(
            "sampledThread", "stackTrace", "state", "startTime", "weight"
        ));

        fields.put("jdk.ThreadPark", List.of(
            "parkedThread", "blocker", "timeout", "until", "startTime", "duration"
        ));

        fields.put("jdk.ObjectAllocationInNewTLAB", List.of(
            "objectClass", "allocationSize", "tlabSize", "startTime", "stackTrace"
        ));

        fields.put("jdk.ThreadStart", List.of(
            "thread", "parentThread", "startTime"
        ));

        fields.put("jdk.MonitorEnter", List.of(
            "monitorClass", "previousOwner", "startTime", "duration"
        ));

        return fields;
    }

    private static Map<String, String> getDefaultEventDescriptions() {
        Map<String, String> descriptions = new HashMap<>();

        descriptions.put("jdk.GarbageCollection", "Garbage collection event");
        descriptions.put("jdk.ExecutionSample", "Execution sample from profiling");
        descriptions.put("jdk.ThreadPark", "Thread parking event");
        descriptions.put("jdk.ObjectAllocationInNewTLAB", "Object allocation in new TLAB");
        descriptions.put("jdk.ObjectAllocationOutsideTLAB", "Object allocation outside TLAB");
        descriptions.put("jdk.ThreadStart", "Thread start event");
        descriptions.put("jdk.ThreadEnd", "Thread end event");
        descriptions.put("jdk.MonitorEnter", "Monitor enter event");
        descriptions.put("jdk.MonitorWait", "Monitor wait event");
        descriptions.put("jdk.SystemGC", "System GC event");

        return descriptions;
    }
}