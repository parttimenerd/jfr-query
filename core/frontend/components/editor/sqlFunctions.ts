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
  { name: 'LAG', signature: 'LAG(expr [, offset])', detail: 'Value from previous row' },
  { name: 'LEAD', signature: 'LEAD(expr [, offset])', detail: 'Value from next row' },

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
  { name: 'EPOCH', signature: 'EPOCH(ts)', detail: 'Seconds since 1970-01-01' },
  { name: 'EPOCH_MS', signature: 'EPOCH_MS(ts)', detail: 'Milliseconds since 1970-01-01' },
  { name: 'STRFTIME', signature: 'STRFTIME(ts, format)', detail: 'Format timestamp as string' },
  { name: 'STRPTIME', signature: 'STRPTIME(s, format)', detail: 'Parse string into timestamp' },
  { name: 'AGE', signature: 'AGE(a, b)', detail: 'Interval between two timestamps' },

  // Math / general
  { name: 'ROUND', signature: 'ROUND(x [, places])', detail: 'Round to N decimal places' },
  { name: 'FLOOR', signature: 'FLOOR(x)', detail: 'Round toward -∞' },
  { name: 'CEIL', signature: 'CEIL(x)', detail: 'Round toward +∞' },
  { name: 'ABS', signature: 'ABS(x)', detail: 'Absolute value' },
  { name: 'GREATEST', signature: 'GREATEST(a, b, ...)', detail: 'Max of arguments' },
  { name: 'LEAST', signature: 'LEAST(a, b, ...)', detail: 'Min of arguments' },
  { name: 'COALESCE', signature: 'COALESCE(a, b, ...)', detail: 'First non-null', boost: 2 },
  { name: 'NULLIF', signature: 'NULLIF(a, b)', detail: 'NULL if a = b else a' },
  { name: 'CAST', signature: 'CAST(x AS type)', detail: 'Type conversion' },
  { name: 'TRY_CAST', signature: 'TRY_CAST(x AS type)', detail: 'Cast returning NULL on failure' },
  { name: 'CASE', signature: 'CASE WHEN ... THEN ... ELSE ... END', detail: 'Conditional expression' },

  // List/struct
  { name: 'LIST', signature: 'LIST(expr)', detail: 'Collect into list (synonym for ARRAY_AGG)' },
  { name: 'UNNEST', signature: 'UNNEST(list)', detail: 'Expand list into rows' },
  { name: 'LEN', signature: 'LEN(list)', detail: 'List length' },
];

/**
 * SQL keyword groups, with what makes sense to suggest in each clause context.
 */
export const SQL_KEYWORDS_AFTER_SELECT = ['DISTINCT', 'ALL', '*'];
export const SQL_KEYWORDS_AT_TOP = ['SELECT', 'WITH'];
export const SQL_KEYWORDS_AFTER_FROM = ['INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT'];
export const SQL_KEYWORDS_AFTER_WHERE = ['AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'ILIKE', 'IS NULL', 'IS NOT NULL', 'EXISTS', 'GROUP BY', 'ORDER BY', 'LIMIT'];
export const SQL_KEYWORDS_AFTER_GROUP_BY = ['HAVING', 'ORDER BY', 'LIMIT'];
export const SQL_KEYWORDS_AFTER_ORDER_BY = ['ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST', 'LIMIT'];
export const SQL_KEYWORDS_AFTER_JOIN_ON = ['AND', 'OR'];
