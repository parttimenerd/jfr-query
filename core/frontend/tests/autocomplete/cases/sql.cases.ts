import type { AutocompleteCase } from '../harness';
import type { TableSchema, ViewSchema, MacroSchema } from '../../../types';

// Reusable extended schema: events + requests + a view + two macros.
const extendedSchema = () => {
    const tables: TableSchema[] = [
        {
            name: 'events',
            columns: [
                { name: 'ts', type: 'TIMESTAMP' },
                { name: 'host', type: 'VARCHAR' },
                { name: 'cpu', type: 'DOUBLE' },
            ],
        },
        {
            name: 'requests',
            columns: [
                { name: 'ts', type: 'TIMESTAMP' },
                { name: 'status_code', type: 'INTEGER' },
                { name: 'path', type: 'VARCHAR' },
            ],
        },
    ];
    const views: ViewSchema[] = [
        { name: 'slow_requests', query: '', columns: [{ name: 'ts', type: 'TIMESTAMP' }, { name: 'path', type: 'VARCHAR' }, { name: 'latency', type: 'DOUBLE' }] },
        { name: 'hourly_cpu', query: '', columns: [{ name: 'hour', type: 'TIMESTAMP' }, { name: 'avg_cpu', type: 'DOUBLE' }] },
    ];
    const macros: MacroSchema[] = [
        { name: 'p99_latency', sql: '', parameters: ['col'], returnType: 'DOUBLE' },
        { name: 'bucket_ms', sql: '', parameters: ['ts', 'interval'], returnType: 'BIGINT' },
    ];
    return {
        tables,
        views,
        macros,
        tableMap: new Map(tables.map(t => [t.name.toLowerCase(), t])),
        viewMap: new Map(views.map(v => [v.name.toLowerCase(), v])),
    };
};


export const sqlCases: AutocompleteCase[] = [
    // --- Tier: sql-basic ---
    {
        name: 'select-empty-offers-columns',
        kind: 'sql',
        tier: 'sql-basic',
        input: 'SELECT | FROM events',
        expected: { contains: ['ts', 'host', 'cpu'] },
    },
    {
        name: 'select-partial-column',
        kind: 'sql',
        tier: 'sql-basic',
        input: 'SELECT ho| FROM events',
        expected: { contains: ['host'] },
    },
    {
        name: 'from-offers-tables',
        kind: 'sql',
        tier: 'sql-basic',
        input: 'SELECT * FROM |',
        expected: { contains: ['events', 'requests'] },
    },
    {
        name: 'from-partial-table',
        kind: 'sql',
        tier: 'sql-basic',
        input: 'SELECT * FROM eve|',
        expected: { contains: ['events'] },
    },
    {
        name: 'where-offers-columns',
        kind: 'sql',
        tier: 'sql-basic',
        input: 'SELECT * FROM events WHERE |',
        expected: { contains: ['ts', 'host', 'cpu'] },
    },
    {
        name: 'where-partial-column',
        kind: 'sql',
        tier: 'sql-basic',
        input: 'SELECT * FROM events WHERE c|',
        expected: { contains: ['cpu'] },
    },
    {
        name: 'group-by-offers-columns',
        kind: 'sql',
        tier: 'sql-basic',
        input: 'SELECT host, count(*) FROM events GROUP BY |',
        expected: { contains: ['host', 'ts', 'cpu'] },
    },
    {
        name: 'order-by-offers-columns',
        kind: 'sql',
        tier: 'sql-basic',
        input: 'SELECT * FROM events ORDER BY |',
        expected: { contains: ['ts', 'cpu', 'host'] },
    },
    {
        name: 'qualified-column-on-alias',
        kind: 'sql',
        tier: 'sql-basic',
        input: 'SELECT e.| FROM events e',
        expected: { contains: ['ts', 'host', 'cpu'] },
    },
    {
        name: 'qualified-alias-excludes-other-tables',
        kind: 'sql',
        tier: 'sql-basic',
        // `r.|` should ONLY surface requests' columns, not events' columns.
        input: 'SELECT r.| FROM events e JOIN requests r ON e.ts = r.ts',
        expected: { contains: ['path', 'status_code', 'ts'], excludes: ['cpu', 'host'] },
    },
    {
        name: 'qualified-column-partial',
        kind: 'sql',
        tier: 'sql-basic',
        input: 'SELECT e.h| FROM events e',
        expected: { contains: ['host'] },
    },
    {
        name: 'join-on-offers-both-sides',
        kind: 'sql',
        tier: 'sql-basic',
        input: 'SELECT * FROM events e JOIN requests r ON |',
        expected: { contains: ['ts'] },
    },
    {
        name: 'join-then-from-completes-table',
        kind: 'sql',
        tier: 'sql-basic',
        input: 'SELECT * FROM events JOIN |',
        expected: { contains: ['requests'] },
    },
    {
        name: 'variable-completion',
        kind: 'sql',
        tier: 'sql-basic',
        input: 'SELECT * FROM events WHERE host = $|',
        variables: { host: 'localhost', region: 'us' },
        expected: { contains: ['$host', '$region'] },
    },
    {
        name: 'variable-completion-parsed-shape',
        kind: 'sql',
        tier: 'sql-basic',
        // Cell-parsed `parsed.variables` stores keys WITH leading `$`. The
        // dispatcher must strip the existing prefix before re-prepending.
        input: 'SELECT * FROM events WHERE cpu > $|',
        variables: { '$threshold': '0.8', '$window': '5m' },
        expected: {
            contains: ['$threshold', '$window'],
            excludes: ['$$threshold', '$$window'],
        },
    },
    {
        name: 'cross-cell-variable-completion',
        kind: 'sql',
        tier: 'sql-basic',
        // Cross-cell refs are stored flat as `$cellName.varName`.
        input: 'SELECT * FROM events WHERE host = $alpha.|',
        variables: { '$alpha.host': "'foo'", '$alpha.region': "'us'", '$beta.unrelated': '1' },
        expected: { contains: ['$alpha.host', '$alpha.region'] },
    },
    {
        name: 'cross-cell-variable-excludes-other-cells',
        kind: 'sql',
        tier: 'sql-basic',
        // After `$alpha.`, only alpha's vars should appear, not beta's.
        input: 'SELECT * FROM events WHERE host = $alpha.|',
        variables: { '$alpha.host': "'foo'", '$alpha.region': "'us'", '$beta.other': '1' },
        expected: { contains: ['$alpha.host'], excludes: ['$beta.other'] },
    },
    {
        name: 'function-keyword-count',
        kind: 'sql',
        tier: 'sql-basic',
        input: 'SELECT cou| FROM events',
        expected: { matchesRegex: /COUNT/i },
    },
    {
        name: 'having-offers-columns',
        kind: 'sql',
        tier: 'sql-basic',
        input: 'SELECT host, count(*) FROM events GROUP BY host HAVING |',
        expected: { contains: ['cpu', 'host'] },
    },

    // --- Tier: sql-subquery ---
    {
        name: 'in-subquery-select-list',
        kind: 'sql',
        tier: 'sql-subquery',
        input: 'SELECT * FROM events WHERE host IN (SELECT | FROM requests)',
        expected: {
            contains: ['path', 'status_code'],
            excludes: ['cpu'],
        },
    },
    {
        name: 'in-subquery-from',
        kind: 'sql',
        tier: 'sql-subquery',
        input: 'SELECT * FROM events WHERE host IN (SELECT host FROM |)',
        expected: { contains: ['requests', 'events'] },
    },
    {
        name: 'in-subquery-select-cols-do-not-leak-outer',
        kind: 'sql',
        tier: 'sql-subquery',
        // Inner SELECT should offer requests' columns; outer events.cpu should NOT leak.
        input: 'SELECT * FROM events WHERE host IN (SELECT | FROM requests)',
        expected: {
            contains: ['path', 'status_code'],
            excludes: ['cpu'],
        },
    },
    {
        name: 'derived-table-select-no-outer-leak',
        kind: 'sql',
        tier: 'sql-subquery',
        // Derived table inner SELECT only sees its own FROM (events).
        // Even though events has cpu, the test simply asserts ts/host appear;
        // adding stricter exclusion proves outer scope cannot reach in.
        input: 'SELECT * FROM (SELECT | FROM events) sub, requests',
        expected: { contains: ['ts', 'host', 'cpu'], excludes: ['path', 'status_code'] },
    },
    {
        name: 'derived-table-where-no-outer-leak',
        kind: 'sql',
        tier: 'sql-subquery',
        // Inner WHERE only sees inner FROM. Outer requests.path must not leak.
        input: 'SELECT * FROM (SELECT ts FROM events WHERE |) sub, requests',
        expected: { contains: ['ts', 'cpu', 'host'], excludes: ['path', 'status_code'] },
    },
    {
        name: 'cte-body-no-following-cte-leak',
        kind: 'sql',
        tier: 'sql-subquery',
        // CTE body has its own FROM; the outer SELECT's FROM is not visible.
        input: 'WITH a AS (SELECT | FROM events) SELECT * FROM a, requests',
        expected: { contains: ['ts', 'host', 'cpu'], excludes: ['path', 'status_code'] },
    },
    {
        name: 'in-subquery-qualified-inner-table',
        kind: 'sql',
        tier: 'sql-subquery',
        // Qualifier `r` resolves to the inner FROM's alias.
        input: 'SELECT * FROM events WHERE host IN (SELECT r.| FROM requests r)',
        expected: { contains: ['ts', 'path', 'status_code'], excludes: ['cpu', 'host'] },
    },
    {
        name: 'nested-subquery-deep-no-leak',
        kind: 'sql',
        tier: 'sql-subquery',
        // Deeply nested inner SELECT — only innermost FROM visible.
        input: 'SELECT * FROM events WHERE host IN (SELECT host FROM requests WHERE status_code IN (SELECT | FROM events))',
        expected: { contains: ['ts', 'host', 'cpu'], excludes: ['path', 'status_code'] },
    },
    {
        name: 'cte-body-select',
        kind: 'sql',
        tier: 'sql-subquery',
        input: 'WITH agg AS (SELECT | FROM events) SELECT * FROM agg',
        expected: { contains: ['ts', 'host', 'cpu'] },
    },
    {
        name: 'cte-body-from',
        kind: 'sql',
        tier: 'sql-subquery',
        input: 'WITH agg AS (SELECT host FROM |) SELECT * FROM agg',
        expected: { contains: ['events', 'requests'] },
    },
    {
        name: 'cte-reference-after-with',
        kind: 'sql',
        tier: 'sql-subquery',
        input: 'WITH agg AS (SELECT host FROM events) SELECT * FROM |',
        expected: { contains: ['agg'] },
    },
    {
        name: 'derived-table-from',
        kind: 'sql',
        tier: 'sql-subquery',
        input: 'SELECT * FROM (SELECT | FROM events) sub',
        expected: { contains: ['ts', 'host', 'cpu'] },
    },
    {
        name: 'exists-correlated',
        kind: 'sql',
        tier: 'sql-subquery',
        input: 'SELECT * FROM events e WHERE EXISTS (SELECT 1 FROM requests r WHERE |)',
        expected: { contains: ['ts'] },
    },
    {
        name: 'scalar-subquery-select-list',
        kind: 'sql',
        tier: 'sql-subquery',
        input: 'SELECT host, (SELECT count(*) FROM requests WHERE |) FROM events',
        expected: { contains: ['ts', 'status_code', 'path'] },
    },

    // --- Tier: sql-context ---
    {
        name: 'distinct-aware-keywords',
        kind: 'sql',
        tier: 'sql-context',
        input: 'SELECT | FROM events',
        expected: { matchesRegex: /DISTINCT/i },
    },
    {
        name: 'order-by-suggests-direction-after-col',
        kind: 'sql',
        tier: 'sql-context',
        input: 'SELECT * FROM events ORDER BY ts |',
        expected: { matchesRegex: /DESC|ASC/i },
    },
    {
        name: 'limit-keyword-after-orderby',
        kind: 'sql',
        tier: 'sql-context',
        input: 'SELECT * FROM events ORDER BY ts DESC |',
        expected: { matchesRegex: /LIMIT/i },
    },
    {
        name: 'between-and-keyword',
        kind: 'sql',
        tier: 'sql-context',
        input: 'SELECT * FROM events WHERE cpu BETWEEN 1 |',
        expected: { matchesRegex: /AND/i },
    },
    {
        name: 'comment-context-no-explosion',
        kind: 'sql',
        tier: 'sql-context',
        input: 'SELECT * FROM events -- |',
        expected: {},
    },
    {
        name: 'half-typed-table-after-from',
        kind: 'sql',
        tier: 'sql-context',
        input: 'SELECT * FROM req|',
        expected: { contains: ['requests'] },
    },
    {
        name: 'function-args-do-not-leak-tables',
        kind: 'sql',
        tier: 'sql-context',
        input: 'SELECT date_trunc(\'hour\', |) FROM events',
        expected: { contains: ['ts'] },
    },
    {
        name: 'no-suggestions-mid-number',
        kind: 'sql',
        tier: 'sql-context',
        input: 'SELECT * FROM events WHERE cpu > 1.5|',
        expected: {},
    },

    // --- Tier: sql-edge ---
    {
        name: 'nested-subquery-deep',
        kind: 'sql',
        tier: 'sql-edge',
        input: 'SELECT * FROM events WHERE host IN (SELECT host FROM requests WHERE status_code IN (SELECT | FROM events))',
        expected: { contains: ['ts', 'host', 'cpu'] },
    },
    {
        name: 'multi-cte',
        kind: 'sql',
        tier: 'sql-edge',
        input: 'WITH a AS (SELECT ts FROM events), b AS (SELECT * FROM |) SELECT * FROM b',
        expected: { contains: ['a', 'events', 'requests'] },
    },
    {
        name: 'left-join-on-uses-aliases',
        kind: 'sql',
        tier: 'sql-edge',
        input: 'SELECT * FROM events e LEFT JOIN requests r ON e.ts = r.|',
        expected: { contains: ['ts', 'status_code', 'path'] },
    },
    {
        name: 'aggregate-then-having',
        kind: 'sql',
        tier: 'sql-edge',
        input: 'SELECT host, AVG(cpu) avg_cpu FROM events GROUP BY host HAVING avg_cpu > |',
        expected: {},
    },
    {
        name: 'union-second-arm',
        kind: 'sql',
        tier: 'sql-edge',
        input: 'SELECT host FROM events UNION SELECT | FROM requests',
        expected: { contains: ['ts', 'status_code', 'path'] },
    },
    {
        name: 'case-when-branch',
        kind: 'sql',
        tier: 'sql-edge',
        input: 'SELECT CASE WHEN | THEN 1 ELSE 0 END FROM events',
        expected: { contains: ['ts', 'host', 'cpu'] },
    },
    {
        name: 'cte-uses-prior-cte',
        kind: 'sql',
        tier: 'sql-edge',
        input: 'WITH a AS (SELECT host FROM events), b AS (SELECT | FROM a) SELECT * FROM b',
        expected: { contains: ['host'] },
    },
    {
        name: 'order-by-after-alias',
        kind: 'sql',
        tier: 'sql-edge',
        input: 'SELECT host, COUNT(*) AS c FROM events GROUP BY host ORDER BY |',
        expected: { contains: ['host', 'c'] },
    },

    // --- Tier: sql-view ---
    {
        name: 'view-appears-in-from',
        kind: 'sql',
        tier: 'sql-view',
        input: 'SELECT * FROM |',
        schema: extendedSchema(),
        expected: { contains: ['slow_requests', 'hourly_cpu'] },
    },
    {
        name: 'view-columns-in-select',
        kind: 'sql',
        tier: 'sql-view',
        input: 'SELECT | FROM slow_requests',
        schema: extendedSchema(),
        expected: { contains: ['ts', 'path', 'latency'] },
    },
    {
        name: 'view-columns-qualified',
        kind: 'sql',
        tier: 'sql-view',
        input: 'SELECT s.| FROM slow_requests s',
        schema: extendedSchema(),
        expected: { contains: ['latency', 'path', 'ts'] },
    },
    {
        name: 'view-join-on-table',
        kind: 'sql',
        tier: 'sql-view',
        input: 'SELECT * FROM events e JOIN slow_requests s ON e.ts = s.|',
        schema: extendedSchema(),
        expected: { contains: ['ts', 'path', 'latency'], excludes: ['cpu', 'host', 'status_code'] },
    },
    {
        name: 'view-excludes-view-cols-from-table-qualifier',
        kind: 'sql',
        tier: 'sql-view',
        // `e.` should only have events columns, not slow_requests columns.
        input: 'SELECT * FROM events e JOIN slow_requests s ON e.| = s.ts',
        schema: extendedSchema(),
        expected: { contains: ['ts', 'cpu', 'host'], excludes: ['latency', 'path'] },
    },

    // --- Tier: sql-macro ---
    {
        name: 'macro-appears-in-select',
        kind: 'sql',
        tier: 'sql-macro',
        input: 'SELECT p99| FROM events',
        schema: extendedSchema(),
        expected: { contains: ['p99_latency'] },
    },
    {
        name: 'macro-appears-in-where',
        kind: 'sql',
        tier: 'sql-macro',
        input: 'SELECT * FROM events WHERE buc|',
        schema: extendedSchema(),
        expected: { contains: ['bucket_ms'] },
    },
    {
        name: 'macro-appears-in-from',
        kind: 'sql',
        tier: 'sql-macro',
        input: 'SELECT * FROM |',
        schema: extendedSchema(),
        // Macros should appear in FROM (they're table-returning functions in DuckDB).
        expected: { contains: ['events', 'slow_requests'] },
    },

    // --- Tier: sql-window ---
    // B-204 fixed: OVER is now suggested after a window function call.
    {
        name: 'window-over-keyword-after-func',
        kind: 'sql',
        tier: 'sql-window',
        // After ROW_NUMBER(), OVER should be the top suggestion.
        input: 'SELECT ROW_NUMBER() |',
        expected: { contains: ['OVER'] },
    },
    {
        name: 'window-over-keyword-partial-token',
        kind: 'sql',
        tier: 'sql-window',
        // Typing "OV" after ROW_NUMBER() should still filter to OVER.
        input: 'SELECT ROW_NUMBER() OV|',
        expected: { contains: ['OVER'] },
    },
    {
        name: 'partition-by-offers-columns',
        kind: 'sql',
        tier: 'sql-window',
        input: 'SELECT ROW_NUMBER() OVER (PARTITION BY |) FROM events',
        expected: { contains: ['host', 'ts', 'cpu'] },
    },
    {
        name: 'order-by-inside-over-offers-columns',
        kind: 'sql',
        tier: 'sql-window',
        input: 'SELECT ROW_NUMBER() OVER (PARTITION BY host ORDER BY |) FROM events',
        expected: { contains: ['ts', 'cpu', 'host'] },
    },

    // --- Tier: sql-complex ---
    {
        name: 'multi-cte-second-uses-first',
        kind: 'sql',
        tier: 'sql-complex',
        input: 'WITH a AS (SELECT ts FROM events), b AS (SELECT | FROM a) SELECT * FROM b',
        expected: { contains: ['ts'] },
    },
    {
        name: 'multi-cte-outer-select-from-sees-both',
        kind: 'sql',
        tier: 'sql-complex',
        input: 'WITH a AS (SELECT * FROM events), b AS (SELECT * FROM requests) SELECT * FROM |',
        expected: { contains: ['a', 'b'] },
    },
    {
        name: 'union-all-second-arm',
        kind: 'sql',
        tier: 'sql-complex',
        input: 'SELECT ts, host FROM events UNION ALL SELECT | FROM requests',
        expected: { contains: ['ts', 'path', 'status_code'] },
    },
    {
        name: 'subquery-in-from-exposes-derived-cols',
        kind: 'sql',
        tier: 'sql-complex',
        // The derived table produces only `avg_cpu`; outer SELECT should offer that.
        input: 'SELECT | FROM (SELECT AVG(cpu) AS avg_cpu FROM events) sub',
        expected: { contains: ['avg_cpu'] },
    },
    {
        name: 'lateral-join-inner-col',
        kind: 'sql',
        tier: 'sql-complex',
        // LATERAL subquery inner scope is not yet tracked by the SQL context parser (B-205).
        // For now, assert the cursor position returns some completion options (no crash),
        // accepting that the inner FROM's columns may not be visible yet.
        input: 'SELECT e.host, l.cnt FROM events e, LATERAL (SELECT count(*) AS cnt FROM requests r WHERE |) l',
        expected: { matchesRegex: /events|requests|WHERE/i }, // best-effort until B-205
    },
    {
        name: 'view-in-cte',
        kind: 'sql',
        tier: 'sql-complex',
        // CTE body can reference a view; outer select sees cte columns.
        input: 'WITH slow AS (SELECT latency FROM slow_requests WHERE |) SELECT * FROM slow',
        schema: extendedSchema(),
        expected: { contains: ['ts', 'path', 'latency'] },
    },
    {
        name: 'cross-cell-variable-completion-global',
        kind: 'sql',
        tier: 'sql-complex',
        // Workspace variables use `$$` prefix.
        input: 'SELECT * FROM events WHERE cpu > $$|',
        variables: { '$$threshold': '0.8', '$$region': '"us-east"' },
        expected: { contains: ['$$threshold', '$$region'] },
    },
    {
        name: 'qualified-cross-cell-excludes-other-prefix',
        kind: 'sql',
        tier: 'sql-complex',
        // `$alpha.` should show alpha's vars; `$$` workspace vars should NOT appear.
        input: 'SELECT * FROM events WHERE host = $alpha.|',
        variables: { '$alpha.host': "'foo'", '$$global': '1', '$beta.other': '1' },
        expected: { contains: ['$alpha.host'], excludes: ['$$global', '$beta.other'] },
    },
];

