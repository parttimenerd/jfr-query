/**
 * Curated DuckDB builtin functions with signatures and descriptions, used to
 * enrich autocomplete in column/expression contexts. Not exhaustive — covers
 * functions that the JFR notebook user is most likely to type.
 */

export interface SqlFunctionDoc {
  name: string;
  signature: string;
  detail: string;
  /** Higher = sorted earlier in completion list. */
  boost?: number;
}

export const SQL_FUNCTIONS: SqlFunctionDoc[] = [
  // Aggregate
  { name: 'COUNT', signature: 'COUNT(* | expr)', detail: 'Number of non-null values', boost: 3 },
  { name: 'SUM', signature: 'SUM(expr)', detail: 'Sum of values', boost: 3 },
  { name: 'AVG', signature: 'AVG(expr)', detail: 'Average of values', boost: 3 },
  { name: 'MIN', signature: 'MIN(expr)', detail: 'Smallest value', boost: 3 },
  { name: 'MAX', signature: 'MAX(expr)', detail: 'Largest value', boost: 3 },
  { name: 'MEDIAN', signature: 'MEDIAN(expr)', detail: 'Median value', boost: 2 },
  { name: 'QUANTILE', signature: 'QUANTILE(expr, p)', detail: 'p-quantile (0..1)' },
  { name: 'QUANTILE_CONT', signature: 'QUANTILE_CONT(expr, p)', detail: 'Continuous quantile, e.g. QUANTILE_CONT(x, 0.99)', boost: 2 },
  { name: 'QUANTILE_DISC', signature: 'QUANTILE_DISC(expr, p)', detail: 'Discrete quantile (picks an actual value)' },
  { name: 'KURTOSIS', signature: 'KURTOSIS(expr)', detail: 'Excess kurtosis of the distribution' },
  { name: 'SKEWNESS', signature: 'SKEWNESS(expr)', detail: 'Skewness of the distribution' },
  { name: 'VAR_POP', signature: 'VAR_POP(expr)', detail: 'Population variance' },
  { name: 'VAR_SAMP', signature: 'VAR_SAMP(expr)', detail: 'Sample variance' },
  { name: 'STDDEV_POP', signature: 'STDDEV_POP(expr)', detail: 'Population standard deviation' },
  { name: 'ANY_VALUE', signature: 'ANY_VALUE(expr)', detail: 'Any non-null value from the group' },
  { name: 'BIT_AND', signature: 'BIT_AND(expr)', detail: 'Bitwise AND over the group' },
  { name: 'BIT_OR', signature: 'BIT_OR(expr)', detail: 'Bitwise OR over the group' },
  { name: 'BOOL_AND', signature: 'BOOL_AND(expr)', detail: 'True if all values are true' },
  { name: 'BOOL_OR', signature: 'BOOL_OR(expr)', detail: 'True if any value is true' },
  { name: 'STDDEV', signature: 'STDDEV(expr)', detail: 'Sample standard deviation' },
  { name: 'STRING_AGG', signature: "STRING_AGG(expr, sep)", detail: 'Concatenate strings with separator' },
  { name: 'ARRAY_AGG', signature: 'ARRAY_AGG(expr)', detail: 'Collect values into a list' },
  { name: 'FIRST', signature: 'FIRST(expr)', detail: 'First non-null value' },
  { name: 'LAST', signature: 'LAST(expr)', detail: 'Last non-null value' },
  { name: 'APPROX_COUNT_DISTINCT', signature: 'APPROX_COUNT_DISTINCT(expr)', detail: 'HyperLogLog cardinality estimate' },
  { name: 'HISTOGRAM', signature: 'HISTOGRAM(expr)', detail: 'MAP of value → count' },

  // Window-helper / ranking
  { name: 'ROW_NUMBER', signature: 'ROW_NUMBER() OVER (...)', detail: 'Row position within partition' },
  { name: 'RANK', signature: 'RANK() OVER (...)', detail: 'Rank with gaps for ties' },
  { name: 'DENSE_RANK', signature: 'DENSE_RANK() OVER (...)', detail: 'Rank without gaps' },
  { name: 'PERCENT_RANK', signature: 'PERCENT_RANK() OVER (...)', detail: 'Relative rank (0..1)' },
  { name: 'CUME_DIST', signature: 'CUME_DIST() OVER (...)', detail: 'Cumulative distribution' },
  { name: 'NTILE', signature: 'NTILE(n) OVER (...)', detail: 'Divide rows into n buckets' },
  { name: 'LAG', signature: 'LAG(expr [, offset [, default]])', detail: 'Value from previous row' },
  { name: 'LEAD', signature: 'LEAD(expr [, offset [, default]])', detail: 'Value from next row' },
  { name: 'FIRST_VALUE', signature: 'FIRST_VALUE(expr) OVER (...)', detail: 'First value in window' },
  { name: 'LAST_VALUE', signature: 'LAST_VALUE(expr) OVER (...)', detail: 'Last value in window' },
  { name: 'NTH_VALUE', signature: 'NTH_VALUE(expr, n) OVER (...)', detail: 'n-th value in window' },

  // String
  { name: 'LENGTH', signature: 'LENGTH(s)', detail: 'String length in chars' },
  { name: 'UPPER', signature: 'UPPER(s)', detail: 'Uppercase' },
  { name: 'LOWER', signature: 'LOWER(s)', detail: 'Lowercase' },
  { name: 'CONCAT', signature: 'CONCAT(a, b, ...)', detail: 'Concatenate strings' },
  { name: 'CONCAT_WS', signature: 'CONCAT_WS(sep, a, b, ...)', detail: 'Concatenate with separator' },
  { name: 'SUBSTRING', signature: 'SUBSTRING(s FROM start FOR len)', detail: 'Substring of s' },
  { name: 'SUBSTR', signature: 'SUBSTR(s, start, len)', detail: 'Substring (synonym)' },
  { name: 'REPLACE', signature: 'REPLACE(s, from, to)', detail: 'Replace all occurrences' },
  { name: 'TRIM', signature: 'TRIM(s)', detail: 'Strip whitespace' },
  { name: 'SPLIT_PART', signature: 'SPLIT_PART(s, delim, n)', detail: 'n-th piece of split' },
  { name: 'STARTS_WITH', signature: 'STARTS_WITH(s, prefix)', detail: 'True if s starts with prefix' },
  { name: 'CONTAINS', signature: 'CONTAINS(s, sub)', detail: 'True if s contains sub' },
  { name: 'REGEXP_MATCHES', signature: 'REGEXP_MATCHES(s, pattern)', detail: 'True if pattern matches' },
  { name: 'REGEXP_REPLACE', signature: 'REGEXP_REPLACE(s, pattern, repl)', detail: 'Regex replace' },
  { name: 'REGEXP_EXTRACT', signature: 'REGEXP_EXTRACT(s, pattern [, group])', detail: 'Extract regex group' },

  // Date/time
  { name: 'NOW', signature: 'NOW()', detail: 'Current timestamp' },
  { name: 'CURRENT_DATE', signature: 'CURRENT_DATE', detail: 'Today (no parens)' },
  { name: 'DATE_TRUNC', signature: "DATE_TRUNC('unit', ts)", detail: "Truncate to 'day','hour','minute','second'..." , boost: 2 },
  { name: 'DATE_PART', signature: "DATE_PART('unit', ts)", detail: 'Extract a unit from timestamp' },
  { name: 'DATE_DIFF', signature: "DATE_DIFF('unit', a, b)", detail: 'Difference in units' },
  { name: 'DATE_ADD', signature: "DATE_ADD(ts, INTERVAL n UNIT)", detail: 'Add an interval to a timestamp' },
  { name: 'DATE_SUB', signature: "DATE_SUB(ts, INTERVAL n UNIT)", detail: 'Subtract an interval from a timestamp' },
  { name: 'EPOCH', signature: 'EPOCH(ts)', detail: 'Seconds since 1970-01-01' },
  { name: 'EPOCH_MS', signature: 'EPOCH_MS(ts)', detail: 'Milliseconds since 1970-01-01 (also: integer ms → timestamp)', boost: 3 },
  { name: 'TIME_BUCKET', signature: "TIME_BUCKET(INTERVAL 'n unit', ts)", detail: 'Round ts to nearest bucket boundary', boost: 3 },
  { name: 'STRFTIME', signature: 'STRFTIME(ts, format)', detail: 'Format timestamp as string' },
  { name: 'STRPTIME', signature: 'STRPTIME(s, format)', detail: 'Parse string into timestamp' },
  { name: 'AGE', signature: 'AGE(a, b)', detail: 'Interval between two timestamps' },
  { name: 'MAKE_TIMESTAMP', signature: 'MAKE_TIMESTAMP(y, mon, d, h, min, s)', detail: 'Construct a timestamp' },
  { name: 'MAKE_INTERVAL', signature: 'MAKE_INTERVAL(years, months, days, hours, mins, secs)', detail: 'Construct an interval' },
  { name: 'TO_TIMESTAMP', signature: 'TO_TIMESTAMP(unix_seconds)', detail: 'Unix epoch seconds → TIMESTAMP' },

  // JFR / jfr-query macros (always available in any notebook)
  { name: 'recording_start', signature: 'recording_start()', detail: 'Start timestamp of the loaded JFR recording', boost: 3 },
  { name: 'recording_end', signature: 'recording_end()', detail: 'End timestamp of the loaded JFR recording', boost: 3 },
  { name: 'format_duration', signature: 'format_duration(seconds)', detail: 'Human-readable duration string, e.g. "1.23 ms"', boost: 3 },
  { name: 'before_gc', signature: 'before_gc(gcId)', detail: 'Filter to heap summary rows sampled before GC id', boost: 2 },
  { name: 'after_gc', signature: 'after_gc(gcId)', detail: 'Filter to heap summary rows sampled after GC id', boost: 2 },
  { name: 'within_gc', signature: 'within_gc(ts)', detail: 'True if ts falls inside any GC pause window', boost: 2 },
  { name: 'bucket_ms', signature: 'bucket_ms(ts, width_ms)', detail: 'Align ts to width_ms-wide time buckets (returns ms epoch)', boost: 2 },
  { name: 'bucket_time', signature: 'bucket_time(ts, width_ms)', detail: 'Align ts to width_ms-wide buckets (returns TIMESTAMP)', boost: 2 },
  { name: 'relative_ms', signature: 'relative_ms(ts)', detail: 'Milliseconds from recording_start() to ts', boost: 2 },
  { name: 'duration_since_last_gc', signature: 'duration_since_last_gc(ts)', detail: 'ms since the previous GC event before ts', boost: 2 },
  { name: 'view_sql', signature: "view_sql('view_name')", detail: 'Return the SQL definition of a named view', boost: 1 },

  // Math / general
  { name: 'ROUND', signature: 'ROUND(x [, places])', detail: 'Round to N decimal places' },
  { name: 'FLOOR', signature: 'FLOOR(x)', detail: 'Round toward -∞' },
  { name: 'CEIL', signature: 'CEIL(x)', detail: 'Round toward +∞' },
  { name: 'ABS', signature: 'ABS(x)', detail: 'Absolute value' },
  { name: 'SIGN', signature: 'SIGN(x)', detail: '-1, 0, or 1' },
  { name: 'POWER', signature: 'POWER(base, exp)', detail: 'base raised to exp' },
  { name: 'SQRT', signature: 'SQRT(x)', detail: 'Square root' },
  { name: 'LOG', signature: 'LOG(x)', detail: 'Natural logarithm' },
  { name: 'LOG2', signature: 'LOG2(x)', detail: 'Base-2 logarithm' },
  { name: 'LOG10', signature: 'LOG10(x)', detail: 'Base-10 logarithm' },
  { name: 'EXP', signature: 'EXP(x)', detail: 'e^x' },
  { name: 'MOD', signature: 'MOD(x, y)', detail: 'x modulo y' },
  { name: 'GREATEST', signature: 'GREATEST(a, b, ...)', detail: 'Max of arguments' },
  { name: 'LEAST', signature: 'LEAST(a, b, ...)', detail: 'Min of arguments' },
  { name: 'COALESCE', signature: 'COALESCE(a, b, ...)', detail: 'First non-null', boost: 2 },
  { name: 'NULLIF', signature: 'NULLIF(a, b)', detail: 'NULL if a = b else a' },
  { name: 'IF', signature: 'IF(cond, a, b)', detail: 'Shorthand CASE: a if cond else b' },
  { name: 'IFF', signature: 'IFF(cond, a, b)', detail: 'Alias for IF()' },
  { name: 'IFNULL', signature: 'IFNULL(a, b)', detail: 'b if a is NULL, else a' },
  { name: 'CAST', signature: 'CAST(x AS type)', detail: 'Type conversion' },
  { name: 'TRY_CAST', signature: 'TRY_CAST(x AS type)', detail: 'Cast returning NULL on failure' },
  { name: 'CASE', signature: 'CASE WHEN ... THEN ... ELSE ... END', detail: 'Conditional expression' },
  { name: 'PRINTF', signature: "PRINTF(fmt, ...)", detail: 'C-style printf formatting, e.g. PRINTF(\'%.1f\', x)' },
  { name: 'FORMAT', signature: "FORMAT(fmt, ...)", detail: 'Python-style formatting, e.g. FORMAT(\'{:.1f}\', x)' },
  { name: 'GENERATE_SERIES', signature: 'GENERATE_SERIES(start, stop [, step])', detail: 'Table-valued: produce a range of numbers or timestamps' },
  { name: 'RANGE', signature: 'RANGE(start, stop [, step])', detail: 'Like GENERATE_SERIES but exclusive stop' },

  // List/struct/map
  { name: 'LIST', signature: 'LIST(expr)', detail: 'Collect into list (synonym for ARRAY_AGG)' },
  { name: 'UNNEST', signature: 'UNNEST(list)', detail: 'Expand list into rows' },
  { name: 'LEN', signature: 'LEN(list)', detail: 'List length' },
  { name: 'LIST_AGG', signature: 'LIST_AGG(expr [ORDER BY ...])', detail: 'Aggregate values into a list' },
  { name: 'LIST_FILTER', signature: 'LIST_FILTER(list, x -> predicate)', detail: 'Filter list elements by lambda' },
  { name: 'LIST_TRANSFORM', signature: 'LIST_TRANSFORM(list, x -> expr)', detail: 'Map lambda over list elements' },
  { name: 'LIST_DISTINCT', signature: 'LIST_DISTINCT(list)', detail: 'Remove duplicate list elements' },
  { name: 'LIST_SORT', signature: 'LIST_SORT(list [, ASC|DESC])', detail: 'Sort list elements' },
  { name: 'LIST_REVERSE', signature: 'LIST_REVERSE(list)', detail: 'Reverse a list' },
  { name: 'LIST_CONTAINS', signature: 'LIST_CONTAINS(list, value)', detail: 'True if list contains value' },
  { name: 'LIST_POSITION', signature: 'LIST_POSITION(list, value)', detail: '1-based position of value in list, or 0' },
  { name: 'LIST_SLICE', signature: 'LIST_SLICE(list, begin, end)', detail: 'Slice of list[begin..end]' },
  { name: 'LIST_APPEND', signature: 'LIST_APPEND(list, value)', detail: 'Append a value to a list' },
  { name: 'LIST_PREPEND', signature: 'LIST_PREPEND(value, list)', detail: 'Prepend a value to a list' },
  { name: 'FLATTEN', signature: 'FLATTEN(list_of_lists)', detail: 'One level of nested lists flattened' },
  { name: 'STRUCT_PACK', signature: 'STRUCT_PACK(key := val, ...)', detail: 'Construct a STRUCT literal' },
  { name: 'STRUCT_EXTRACT', signature: 'STRUCT_EXTRACT(struct, key)', detail: 'Extract a field from a struct' },
  { name: 'MAP', signature: 'MAP(keys, values)', detail: 'Construct a MAP from key and value lists' },
  { name: 'MAP_KEYS', signature: 'MAP_KEYS(map)', detail: 'List of keys in a map' },
  { name: 'MAP_VALUES', signature: 'MAP_VALUES(map)', detail: 'List of values in a map' },
  { name: 'MAP_EXTRACT', signature: 'MAP_EXTRACT(map, key)', detail: 'Value for key in map (returns list)' },
];

/**
 * SQL keyword groups, with what makes sense to suggest in each clause context.
 */
export const SQL_KEYWORDS_AFTER_SELECT = ['DISTINCT', 'ALL', '*'];
export const SQL_KEYWORDS_AT_TOP = ['SELECT', 'WITH'];
export const SQL_KEYWORDS_AFTER_FROM = [
  'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN',
  'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'QUALIFY', 'LIMIT',
  'USING', 'NATURAL JOIN', 'ASOF JOIN',
];
export const SQL_KEYWORDS_AFTER_WHERE = [
  'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'ILIKE', 'SIMILAR TO',
  'IS NULL', 'IS NOT NULL', 'IS TRUE', 'IS FALSE',
  'EXISTS', 'ANY', 'ALL',
  'GROUP BY', 'HAVING', 'QUALIFY', 'ORDER BY', 'LIMIT',
];
export const SQL_KEYWORDS_AFTER_GROUP_BY = ['HAVING', 'ORDER BY', 'QUALIFY', 'LIMIT'];
export const SQL_KEYWORDS_AFTER_ORDER_BY = [
  'ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST', 'LIMIT',
];
export const SQL_KEYWORDS_AFTER_JOIN_ON = ['AND', 'OR'];
export const SQL_KEYWORDS_WINDOW = [
  'OVER', 'PARTITION BY', 'ORDER BY', 'ROWS BETWEEN', 'RANGE BETWEEN', 'GROUPS BETWEEN',
  'UNBOUNDED PRECEDING', 'CURRENT ROW', 'UNBOUNDED FOLLOWING',
];
export const SQL_KEYWORDS_TYPES = [
  'INTEGER', 'BIGINT', 'DOUBLE', 'FLOAT', 'VARCHAR', 'TEXT', 'BOOLEAN',
  'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE', 'DATE', 'TIME', 'INTERVAL',
  'BLOB', 'HUGEINT', 'UBIGINT', 'UINTEGER', 'SMALLINT', 'TINYINT',
  'DECIMAL', 'NUMERIC', 'JSON', 'LIST', 'STRUCT', 'MAP',
];
