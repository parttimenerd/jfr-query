/**
 * generateSqlDataset.ts
 * ---------------------
 * Generates JSONL training pairs for an in-tree SQL-completion T5-small model.
 *
 * Each row has the shape:
 *   {
 *     "prefix":  "SELECT date_trunc('hour', \"ts\") AS h, count(*) FROM events GROUP BY ",
 *     "target":  "h ORDER BY h",
 *     "schema":  [ { "table": "events", "columns": [...] }, ... ],
 *     "tier":    "select" | "from" | "where" | "groupBy" | "orderBy" | "join" | "cte" | "subquery"
 *   }
 *
 * Teacher: Claude Haiku via the Anthropic SDK.
 * Coverage: SELECT list, FROM, WHERE, GROUP BY / HAVING, ORDER BY / LIMIT,
 *   JOIN ON, CTE body, derived table, scalar subquery, window function.
 *
 * Validation: each generated target is checked to be a non-empty plausible
 *   completion (no <<CURSOR>>, no fences, no restatement of the prefix).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx scripts/training/generateSqlDataset.ts \
 *     --target 3000 --out data/sql_pairs_v1.jsonl --concurrency 8
 *
 * The script streams JSONL rows to disk so a partial run can be resumed.
 */

import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, existsSync, createWriteStream, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

interface Args {
    target: number;
    concurrency: number;
    out: string;
    model: string;
    dryRun: boolean;
    help: boolean;
}

function parseArgs(argv: string[]): Args {
    const get = (name: string, def?: string): string | undefined => {
        const i = argv.indexOf(name);
        return i >= 0 ? argv[i + 1] : def;
    };
    const has = (name: string): boolean => argv.includes(name);
    return {
        target: Number(get('--target', String(process.env.SQL_DATASET_TARGET ?? 3000))),
        concurrency: Number(get('--concurrency', '8')),
        out: get('--out', resolve(process.cwd(), 'data/sql_pairs_v1.jsonl'))!,
        model: get('--model', process.env.SQL_DATASET_MODEL ?? 'claude-haiku-4-5-20251001')!,
        dryRun: has('--dry-run'),
        help: has('--help') || has('-h'),
    };
}

type Tier =
    | 'select' | 'from' | 'where' | 'groupBy' | 'orderBy'
    | 'join' | 'having' | 'cte' | 'subquery' | 'window';

const TIERS: Tier[] = ['select', 'from', 'where', 'groupBy', 'orderBy', 'join', 'having', 'cte', 'subquery', 'window'];

interface SchemaTable { table: string; columns: { name: string; type: string }[]; }

const FAKE_SCHEMAS: SchemaTable[][] = [
    [
        { table: 'events', columns: [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'host', type: 'VARCHAR' },
            { name: 'cpu', type: 'DOUBLE' },
            { name: 'mem', type: 'DOUBLE' },
        ]},
        { table: 'requests', columns: [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'status_code', type: 'INTEGER' },
            { name: 'path', type: 'VARCHAR' },
            { name: 'duration_ms', type: 'INTEGER' },
        ]},
    ],
    [
        { table: 'gc_events', columns: [
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'duration', type: 'BIGINT' },
            { name: 'cause', type: 'VARCHAR' },
            { name: 'heapUsedBefore', type: 'BIGINT' },
            { name: 'heapUsedAfter', type: 'BIGINT' },
        ]},
        { table: 'threads', columns: [
            { name: 'tid', type: 'BIGINT' },
            { name: 'name', type: 'VARCHAR' },
            { name: 'state', type: 'VARCHAR' },
        ]},
    ],
    [
        { table: 'orders', columns: [
            { name: 'order_id', type: 'BIGINT' },
            { name: 'user_id', type: 'BIGINT' },
            { name: 'amount', type: 'DECIMAL' },
            { name: 'created_at', type: 'TIMESTAMP' },
        ]},
        { table: 'users', columns: [
            { name: 'user_id', type: 'BIGINT' },
            { name: 'email', type: 'VARCHAR' },
            { name: 'created_at', type: 'TIMESTAMP' },
        ]},
    ],
    [
        { table: 'jfr_allocations', columns: [
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'thread', type: 'VARCHAR' },
            { name: 'stackTrace', type: 'VARCHAR' },
            { name: 'allocationSize', type: 'BIGINT' },
            { name: 'objectClass', type: 'VARCHAR' },
        ]},
        { table: 'jfr_cpu_load', columns: [
            { name: 'startTime', type: 'TIMESTAMP' },
            { name: 'jvmUser', type: 'FLOAT' },
            { name: 'jvmSystem', type: 'FLOAT' },
            { name: 'machineTotal', type: 'FLOAT' },
        ]},
    ],
    [
        { table: 'spans', columns: [
            { name: 'trace_id', type: 'VARCHAR' },
            { name: 'span_id', type: 'VARCHAR' },
            { name: 'parent_span_id', type: 'VARCHAR' },
            { name: 'service', type: 'VARCHAR' },
            { name: 'operation', type: 'VARCHAR' },
            { name: 'start_ns', type: 'BIGINT' },
            { name: 'duration_ns', type: 'BIGINT' },
        ]},
        { table: 'logs', columns: [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'level', type: 'VARCHAR' },
            { name: 'msg', type: 'VARCHAR' },
            { name: 'service', type: 'VARCHAR' },
            { name: 'trace_id', type: 'VARCHAR' },
        ]},
    ],
    [
        { table: 'metrics', columns: [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'name', type: 'VARCHAR' },
            { name: 'value', type: 'DOUBLE' },
            { name: 'labels', type: 'VARCHAR' },
        ]},
    ],
    [
        { table: 'sessions', columns: [
            { name: 'session_id', type: 'UUID' },
            { name: 'user_id', type: 'BIGINT' },
            { name: 'started_at', type: 'TIMESTAMP' },
            { name: 'ended_at', type: 'TIMESTAMP' },
            { name: 'pages_viewed', type: 'INTEGER' },
        ]},
        { table: 'page_views', columns: [
            { name: 'session_id', type: 'UUID' },
            { name: 'url', type: 'VARCHAR' },
            { name: 'viewed_at', type: 'TIMESTAMP' },
            { name: 'dwell_ms', type: 'INTEGER' },
        ]},
    ],
    [
        { table: 'products', columns: [
            { name: 'sku', type: 'VARCHAR' },
            { name: 'name', type: 'VARCHAR' },
            { name: 'price', type: 'DECIMAL' },
            { name: 'category', type: 'VARCHAR' },
            { name: 'stock', type: 'INTEGER' },
        ]},
        { table: 'inventory_moves', columns: [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'sku', type: 'VARCHAR' },
            { name: 'delta', type: 'INTEGER' },
            { name: 'warehouse', type: 'VARCHAR' },
        ]},
    ],
    [
        { table: 'flights', columns: [
            { name: 'flight_no', type: 'VARCHAR' },
            { name: 'origin', type: 'VARCHAR' },
            { name: 'destination', type: 'VARCHAR' },
            { name: 'departure', type: 'TIMESTAMP' },
            { name: 'arrival', type: 'TIMESTAMP' },
            { name: 'delay_min', type: 'INTEGER' },
        ]},
        { table: 'airports', columns: [
            { name: 'code', type: 'VARCHAR' },
            { name: 'city', type: 'VARCHAR' },
            { name: 'country', type: 'VARCHAR' },
            { name: 'lat', type: 'DOUBLE' },
            { name: 'lon', type: 'DOUBLE' },
        ]},
    ],
    [
        { table: 'sensor_readings', columns: [
            { name: 'sensor_id', type: 'VARCHAR' },
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'temperature_c', type: 'DOUBLE' },
            { name: 'humidity_pct', type: 'DOUBLE' },
            { name: 'pressure_hpa', type: 'DOUBLE' },
        ]},
    ],
    [
        { table: 'github_commits', columns: [
            { name: 'sha', type: 'VARCHAR' },
            { name: 'author', type: 'VARCHAR' },
            { name: 'committed_at', type: 'TIMESTAMP' },
            { name: 'additions', type: 'INTEGER' },
            { name: 'deletions', type: 'INTEGER' },
            { name: 'repo', type: 'VARCHAR' },
        ]},
        { table: 'pull_requests', columns: [
            { name: 'pr_id', type: 'BIGINT' },
            { name: 'repo', type: 'VARCHAR' },
            { name: 'author', type: 'VARCHAR' },
            { name: 'opened_at', type: 'TIMESTAMP' },
            { name: 'merged_at', type: 'TIMESTAMP' },
            { name: 'state', type: 'VARCHAR' },
        ]},
    ],
    [
        { table: 'kafka_topics', columns: [
            { name: 'topic', type: 'VARCHAR' },
            { name: 'partition', type: 'INTEGER' },
            { name: 'offset', type: 'BIGINT' },
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'payload_bytes', type: 'INTEGER' },
        ]},
    ],
    [
        { table: 'trades', columns: [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'symbol', type: 'VARCHAR' },
            { name: 'side', type: 'VARCHAR' },
            { name: 'price', type: 'DECIMAL' },
            { name: 'quantity', type: 'INTEGER' },
            { name: 'venue', type: 'VARCHAR' },
        ]},
        { table: 'quotes', columns: [
            { name: 'ts', type: 'TIMESTAMP' },
            { name: 'symbol', type: 'VARCHAR' },
            { name: 'bid', type: 'DECIMAL' },
            { name: 'ask', type: 'DECIMAL' },
        ]},
    ],
];

const SYSTEM = `You generate DuckDB SQL completion training pairs.

Each pair is a (prefix, target) tuple where:
- prefix: a partial DuckDB SQL statement ending where the user would press TAB to complete.
- target: the next 1–60 tokens that would naturally continue the prefix.

CRITICAL RULES:
- target MUST NOT restate any part of the prefix.
- target MUST NOT contain <<CURSOR>> or any cursor marker.
- target MUST NOT be wrapped in fences or quotes.
- target MUST start where the cursor is (no leading repetition of the trailing prefix word).
- Output STRICT JSON array of objects, no prose, no markdown.
- Each object has exactly: {"prefix": string, "target": string}.

Use the provided schema. Vary cursor positions across the tier you are asked to produce.`;

function buildUserPrompt(tier: Tier, n: number, schema: SchemaTable[]): string {
    const schemaText = schema.map(t => {
        const cols = t.columns.map(c => `"${c.name}" ${c.type}`).join(', ');
        return `- ${t.table}(${cols})`;
    }).join('\n');
    const tierHint = {
        select: 'cursor inside the SELECT projection list (after SELECT, after a comma, mid-expression)',
        from: 'cursor right after FROM or a JOIN clause where a table name is expected',
        where: 'cursor inside a WHERE predicate (after column, after operator, after AND/OR)',
        groupBy: 'cursor in a GROUP BY column list',
        orderBy: 'cursor in an ORDER BY list (column, direction, NULLS FIRST/LAST, LIMIT)',
        join: 'cursor in a JOIN condition (after ON, after JOIN type, after table.col =)',
        having: 'cursor in HAVING with an aggregate predicate',
        cte: 'cursor inside a CTE body (WITH name AS (SELECT ...|...))',
        subquery: 'cursor inside a correlated subquery (EXISTS, IN, scalar)',
        window: 'cursor inside a window-function expression (OVER PARTITION BY / ORDER BY / frame)',
    }[tier];
    return `Schema:
${schemaText}

Tier: ${tier}
Cursor hint: ${tierHint}

Generate ${n} (prefix, target) pairs as a JSON array.`;
}

interface Pair { prefix: string; target: string; }

function parsePairs(raw: string): Pair[] {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '');
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start < 0 || end < 0) return [];
    try {
        const arr = JSON.parse(cleaned.slice(start, end + 1));
        if (!Array.isArray(arr)) return [];
        return arr.filter((p): p is Pair =>
            p && typeof p.prefix === 'string' && typeof p.target === 'string'
            && p.prefix.length > 0 && p.target.length > 0
            && !p.target.includes('<<CURSOR>>')
            && !p.target.includes('```'));
    } catch {
        return [];
    }
}

// Light validity gate: ensure prefix doesn't already contain target verbatim,
// reject obvious echoes. The trained model handles deeper validation.
function validate(p: Pair): boolean {
    if (p.target.startsWith(p.prefix)) return false;
    const lastWord = p.prefix.match(/(\w+)\s*$/)?.[1];
    if (lastWord && p.target.toLowerCase().trim().startsWith(lastWord.toLowerCase() + ' ')) {
        // Target begins by repeating the prefix's trailing word — likely echo.
        return false;
    }
    return true;
}

function loadExisting(path: string): number {
    if (!existsSync(path)) return 0;
    try {
        return readFileSync(path, 'utf8').split('\n').filter(l => l.trim().length > 0).length;
    } catch { return 0; }
}

async function generateBatch(client: Anthropic, model: string, tier: Tier, n: number, schema: SchemaTable[]): Promise<Pair[]> {
    const resp = await client.messages.create({
        model,
        max_tokens: 4096,
        system: SYSTEM,
        messages: [{ role: 'user', content: buildUserPrompt(tier, n, schema) }],
    });
    const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n');
    return parsePairs(text).filter(validate);
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(`generateSqlDataset.ts — SQL completion training pairs\n\nUSAGE:\n  npx tsx scripts/training/generateSqlDataset.ts [--target N] [--concurrency N] [--out FILE] [--dry-run]\n`);
        return;
    }
    if (args.dryRun) {
        const schema = FAKE_SCHEMAS[0];
        for (const tier of TIERS) {
            const prompt = buildUserPrompt(tier, 5, schema);
            process.stdout.write(`\n--- tier: ${tier} ---\n${prompt}\n`);
        }
        return;
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const baseURL = process.env.ANTHROPIC_BASE_URL;
    if (!apiKey && !authToken) throw new Error('ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN not set');

    mkdirSync(dirname(args.out), { recursive: true });
    const client = new Anthropic({
        ...(apiKey ? { apiKey } : {}),
        ...(authToken ? { authToken } : {}),
        ...(baseURL ? { baseURL } : {}),
    } as any);
    const existing = loadExisting(args.out);
    console.log(`Resuming from ${existing} existing rows; target ${args.target}`);
    const sink = createWriteStream(args.out, { flags: 'a' });

    let total = existing;
    const batchSize = 20;
    const perTierTarget = Math.ceil(args.target / TIERS.length);

    const inflight: Promise<void>[] = [];
    let tierIdx = 0;
    let schemaIdx = 0;

    while (total < args.target) {
        if (inflight.length >= args.concurrency) {
            await Promise.race(inflight);
        }
        if (total >= args.target) break;
        const tier = TIERS[tierIdx % TIERS.length];
        const schema = FAKE_SCHEMAS[schemaIdx % FAKE_SCHEMAS.length];
        tierIdx++;
        schemaIdx++;

        const task = (async () => {
            try {
                const pairs = await generateBatch(client, args.model, tier, batchSize, schema);
                for (const p of pairs) {
                    sink.write(JSON.stringify({ ...p, schema, tier }) + '\n');
                    total++;
                    if (total >= args.target) break;
                }
                console.log(`[${tier}] +${pairs.length} → ${total}/${args.target}`);
            } catch (err) {
                console.warn(`[${tier}] batch failed:`, err instanceof Error ? err.message : err);
                await new Promise(r => setTimeout(r, 2000));
            }
        })();
        inflight.push(task);
        task.finally(() => {
            const i = inflight.indexOf(task);
            if (i >= 0) inflight.splice(i, 1);
        });
    }
    await Promise.all(inflight);
    sink.end();
    console.log(`Done. Wrote ${total} rows to ${args.out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
