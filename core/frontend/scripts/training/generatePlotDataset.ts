/**
 * generatePlotDataset.ts
 * ----------------------
 * V12 — produces JSONL training data for the in-tree plot-suggester model.
 *
 * Each row has the shape (V2 input format):
 *   {
 *     "sql":     "SELECT startTime, heapUsed FROM HeapSnapshot",
 *     "columns": [ { "name": "startTime", "type": "TIMESTAMP" }, ... ],
 *     "schema":  [ { "table": "HeapSnapshot", "columns": [...] }, ... ],
 *     "sample":  [ { "startTime": "...", "heapUsed": 1024 }, ... ],
 *     "plot":    "LINE_CHART(x: \"startTime\", y: [\"heapUsed\"]) LEGEND AT BOTTOM",
 *     "plotFamilyHint": "LINE_CHART"
 *   }
 *
 * The teacher is Claude Haiku, called through `AiService.getEffectiveApiKey`.
 * API keys are NEVER inlined.
 *
 * Coverage:
 *   - 12 canonical plot families: TABLE, BAR_CHART, PIE_CHART, LINE_CHART,
 *     SCATTER_PLOT, HEATMAP, FLAMEGRAPH, HISTOGRAM, BOX_PLOT, AREA_CHART,
 *     GANTT, RANGE
 *   - Suffix clauses: TITLE, LEGEND, PALETTE, AXIS-X, AXIS-Y, TOOLTIP,
 *     LINK-X/Y/XY, BRUSH, NAME, LET, ON HOVER/CLICK
 *   - Composition: `A + B`, ROW(...), COL(...)
 *   - Sparkline cells in TABLE
 *   - Ergonomic syntax samples (lowercase, short aliases, unquoted ids)
 *
 * Validation: every teacher response is run through `isParseablePlotConfig`
 * before being written. Invalid responses are discarded.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx scripts/training/generatePlotDataset.ts \
 *     --target 7500 --out data/plot_pairs_v12.jsonl --concurrency 8
 */

import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, existsSync, createWriteStream, readFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Args {
    target: number;
    concurrency: number;
    out: string;
    model: string;
    dryRun: boolean;
    help: boolean;
    skipValidation: boolean;
}

function parseArgs(argv: string[]): Args {
    const get = (name: string, def?: string): string | undefined => {
        const i = argv.indexOf(name);
        return i >= 0 ? argv[i + 1] : def;
    };
    const has = (name: string): boolean => argv.includes(name);
    return {
        target: Number(get('--target', String(process.env.PLOT_DATASET_TARGET ?? 7500))),
        concurrency: Number(get('--concurrency', '8')),
        out: get('--out', resolve(process.cwd(), 'data/plot_pairs_v12.jsonl'))!,
        model: get('--model', process.env.PLOT_DATASET_MODEL ?? 'claude-haiku-latest')!,
        dryRun: has('--dry-run'),
        help: has('--help') || has('-h'),
        skipValidation: has('--skip-validation'),
    };
}

function printHelp(): void {
    process.stdout.write(`generatePlotDataset.ts — V12 generator for the 12-family plot DSL

USAGE:
  npx tsx scripts/training/generatePlotDataset.ts [options]

OPTIONS:
  --target N           Examples to produce (default 7500)
  --concurrency N      Parallel API calls (default 8)
  --out PATH           Output JSONL (default data/plot_pairs_v12.jsonl)
  --model NAME         Teacher model (default claude-haiku-latest)
  --dry-run            Print prompt and 3 sample SQLs; do NOT call the API
  --skip-validation    Skip parse-validation of teacher output (debug only)
  -h, --help           Show this help

ENV (read via AiService.getEffectiveApiKey, never inlined):
  ANTHROPIC_API_KEY        Required unless --dry-run
  ANTHROPIC_AUTH_TOKEN     Alternative env var
  ANTHROPIC_BASE_URL       Optional custom endpoint
`);
}

// ---------------------------------------------------------------------------
// Schema + SQL pool — 12 families
// ---------------------------------------------------------------------------

interface ColumnDef { name: string; type: string }
interface TableSchema { table: string; columns: ColumnDef[] }

type PlotFamily =
    | 'LINE_CHART' | 'BAR_CHART' | 'PIE_CHART' | 'SCATTER_PLOT'
    | 'AREA_CHART' | 'HISTOGRAM' | 'BOX_PLOT' | 'HEATMAP'
    | 'FLAMEGRAPH' | 'GANTT' | 'RANGE' | 'TABLE'
    | 'TREEMAP' | 'WATERFALL'
    | 'COMPOSITION' | 'SPARKLINE' | 'ERGONOMIC';

interface SqlExample {
    sql: string;
    columns: ColumnDef[];
    schema: TableSchema[];
    sample: Record<string, unknown>[];
    plotFamilyHint: PlotFamily;
    /** Optional hint to bias teacher toward composition / ergonomic forms. */
    biasHint?: string;
}

const T_HEAP: TableSchema = {
    table: 'HeapSnapshot',
    columns: [
        { name: 'startTime', type: 'TIMESTAMP' },
        { name: 'heapUsed', type: 'BIGINT' },
        { name: 'heapCommitted', type: 'BIGINT' },
        { name: 'gcCount', type: 'INTEGER' },
    ],
};
const T_GC: TableSchema = {
    table: 'GarbageCollection',
    columns: [
        { name: 'gcId', type: 'BIGINT' },
        { name: 'name', type: 'VARCHAR' },
        { name: 'cause', type: 'VARCHAR' },
        { name: 'startTime', type: 'TIMESTAMP' },
        { name: 'endTime', type: 'TIMESTAMP' },
        { name: 'duration', type: 'DOUBLE' },
        { name: 'longestPause', type: 'DOUBLE' },
    ],
};
const T_ALLOC: TableSchema = {
    table: 'ObjectAllocationSample',
    columns: [
        { name: 'startTime', type: 'TIMESTAMP' },
        { name: 'objectClass', type: 'VARCHAR' },
        { name: 'weight', type: 'BIGINT' },
        { name: 'thread', type: 'VARCHAR' },
    ],
};
const T_THREAD: TableSchema = {
    table: 'ThreadSample',
    columns: [
        { name: 'startTime', type: 'TIMESTAMP' },
        { name: 'thread', type: 'VARCHAR' },
        { name: 'state', type: 'VARCHAR' },
        { name: 'stackFrames', type: 'VARCHAR' },
    ],
};
const T_CPU: TableSchema = {
    table: 'CPULoad',
    columns: [
        { name: 'startTime', type: 'TIMESTAMP' },
        { name: 'jvmUser', type: 'DOUBLE' },
        { name: 'jvmSystem', type: 'DOUBLE' },
        { name: 'machineTotal', type: 'DOUBLE' },
    ],
};
const T_HOST: TableSchema = {
    table: 'HostLatency',
    columns: [
        { name: 'host', type: 'VARCHAR' },
        { name: 'region', type: 'VARCHAR' },
        { name: 'p25', type: 'DOUBLE' },
        { name: 'p50', type: 'DOUBLE' },
        { name: 'p75', type: 'DOUBLE' },
        { name: 'p99', type: 'DOUBLE' },
    ],
};

const ALL_SCHEMAS = [T_HEAP, T_GC, T_ALLOC, T_THREAD, T_CPU, T_HOST];

function pickSchemas(...tables: string[]): TableSchema[] {
    return ALL_SCHEMAS.filter(s => tables.includes(s.table));
}

/**
 * Curated SQL pool. Each entry implies a plot family. The generator stratifies
 * sampling to hit the per-family targets in the plan.
 */
const SQL_POOL: SqlExample[] = [
    // ── LINE_CHART (time-series, single/multi y) ──────────────────────────────
    {
        sql: 'SELECT startTime, heapUsed FROM HeapSnapshot ORDER BY startTime',
        columns: [{ name: 'startTime', type: 'TIMESTAMP' }, { name: 'heapUsed', type: 'BIGINT' }],
        schema: pickSchemas('HeapSnapshot'),
        sample: [{ startTime: '2026-06-25T10:00:00Z', heapUsed: 1024000 }, { startTime: '2026-06-25T10:00:01Z', heapUsed: 2048000 }],
        plotFamilyHint: 'LINE_CHART',
    },
    {
        sql: 'SELECT startTime, jvmUser, jvmSystem, machineTotal FROM CPULoad ORDER BY startTime',
        columns: [{ name: 'startTime', type: 'TIMESTAMP' }, { name: 'jvmUser', type: 'DOUBLE' }, { name: 'jvmSystem', type: 'DOUBLE' }, { name: 'machineTotal', type: 'DOUBLE' }],
        schema: pickSchemas('CPULoad'),
        sample: [{ startTime: '2026-06-25T10:00:00Z', jvmUser: 0.45, jvmSystem: 0.10, machineTotal: 0.62 }],
        plotFamilyHint: 'LINE_CHART',
    },
    {
        sql: 'SELECT startTime, duration FROM GarbageCollection ORDER BY startTime',
        columns: [{ name: 'startTime', type: 'TIMESTAMP' }, { name: 'duration', type: 'DOUBLE' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ startTime: '2026-06-25T10:00:00Z', duration: 12.5 }],
        plotFamilyHint: 'LINE_CHART',
        biasHint: 'Consider adding LEGEND AT BOTTOM or AXIS-Y TYPE LOG.',
    },
    // ── BAR_CHART ─────────────────────────────────────────────────────────────
    {
        sql: 'SELECT name, AVG(duration) AS avg_duration FROM GarbageCollection GROUP BY name',
        columns: [{ name: 'name', type: 'VARCHAR' }, { name: 'avg_duration', type: 'DOUBLE' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ name: 'G1Young', avg_duration: 12.5 }, { name: 'G1Old', avg_duration: 145.0 }],
        plotFamilyHint: 'BAR_CHART',
    },
    {
        sql: 'SELECT thread, COUNT(*) AS n FROM ThreadSample GROUP BY thread ORDER BY n DESC LIMIT 20',
        columns: [{ name: 'thread', type: 'VARCHAR' }, { name: 'n', type: 'BIGINT' }],
        schema: pickSchemas('ThreadSample'),
        sample: [{ thread: 'main', n: 1234 }, { thread: 'worker-1', n: 980 }],
        plotFamilyHint: 'BAR_CHART',
    },
    {
        sql: 'SELECT region, AVG(p50) AS med FROM HostLatency GROUP BY region',
        columns: [{ name: 'region', type: 'VARCHAR' }, { name: 'med', type: 'DOUBLE' }],
        schema: pickSchemas('HostLatency'),
        sample: [{ region: 'us-east', med: 12.3 }, { region: 'eu-west', med: 24.8 }],
        plotFamilyHint: 'BAR_CHART',
    },
    // ── PIE_CHART ─────────────────────────────────────────────────────────────
    {
        sql: 'SELECT cause, COUNT(*) AS n FROM GarbageCollection GROUP BY cause',
        columns: [{ name: 'cause', type: 'VARCHAR' }, { name: 'n', type: 'BIGINT' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ cause: 'G1 Evacuation Pause', n: 42 }, { cause: 'Metadata GC Threshold', n: 3 }],
        plotFamilyHint: 'PIE_CHART',
        biasHint: 'Often paired with `innerRadius: 0.5` for a donut.',
    },
    {
        sql: 'SELECT objectClass, SUM(weight) AS bytes FROM ObjectAllocationSample GROUP BY objectClass',
        columns: [{ name: 'objectClass', type: 'VARCHAR' }, { name: 'bytes', type: 'BIGINT' }],
        schema: pickSchemas('ObjectAllocationSample'),
        sample: [{ objectClass: 'byte[]', bytes: 1_500_000 }, { objectClass: 'java.lang.String', bytes: 900_000 }],
        plotFamilyHint: 'PIE_CHART',
    },
    // ── SCATTER_PLOT ──────────────────────────────────────────────────────────
    {
        sql: 'SELECT duration, longestPause FROM GarbageCollection',
        columns: [{ name: 'duration', type: 'DOUBLE' }, { name: 'longestPause', type: 'DOUBLE' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ duration: 15.3, longestPause: 9.0 }, { duration: 22.1, longestPause: 18.5 }],
        plotFamilyHint: 'SCATTER_PLOT',
    },
    {
        sql: 'SELECT heapUsed, gcCount FROM HeapSnapshot',
        columns: [{ name: 'heapUsed', type: 'BIGINT' }, { name: 'gcCount', type: 'INTEGER' }],
        schema: pickSchemas('HeapSnapshot'),
        sample: [{ heapUsed: 1024000, gcCount: 1 }, { heapUsed: 2048000, gcCount: 3 }],
        plotFamilyHint: 'SCATTER_PLOT',
    },
    // ── AREA_CHART ────────────────────────────────────────────────────────────
    {
        sql: 'SELECT startTime, jvmUser, jvmSystem, machineTotal FROM CPULoad ORDER BY startTime',
        columns: [{ name: 'startTime', type: 'TIMESTAMP' }, { name: 'jvmUser', type: 'DOUBLE' }, { name: 'jvmSystem', type: 'DOUBLE' }, { name: 'machineTotal', type: 'DOUBLE' }],
        schema: pickSchemas('CPULoad'),
        sample: [{ startTime: '2026-06-25T10:00:00Z', jvmUser: 0.4, jvmSystem: 0.1, machineTotal: 0.6 }],
        plotFamilyHint: 'AREA_CHART',
        biasHint: 'Time + 3+ numerics is the canonical AREA_CHART shape; prefer `layout: "stacked"`.',
    },
    {
        sql: 'SELECT startTime, SUM(weight) AS bytes FROM ObjectAllocationSample GROUP BY startTime ORDER BY startTime',
        columns: [{ name: 'startTime', type: 'TIMESTAMP' }, { name: 'bytes', type: 'BIGINT' }],
        schema: pickSchemas('ObjectAllocationSample'),
        sample: [{ startTime: '2026-06-25T10:00:00Z', bytes: 1_000_000 }],
        plotFamilyHint: 'AREA_CHART',
    },
    // ── HISTOGRAM ─────────────────────────────────────────────────────────────
    {
        sql: 'SELECT longestPause FROM GarbageCollection',
        columns: [{ name: 'longestPause', type: 'DOUBLE' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ longestPause: 12.5 }, { longestPause: 18.0 }, { longestPause: 200.1 }],
        plotFamilyHint: 'HISTOGRAM',
        biasHint: 'Single numeric column. `bins: "auto"` is common.',
    },
    {
        sql: 'SELECT duration FROM GarbageCollection',
        columns: [{ name: 'duration', type: 'DOUBLE' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ duration: 12.5 }, { duration: 145.0 }],
        plotFamilyHint: 'HISTOGRAM',
    },
    // ── BOX_PLOT ──────────────────────────────────────────────────────────────
    {
        sql: 'SELECT name, duration FROM GarbageCollection',
        columns: [{ name: 'name', type: 'VARCHAR' }, { name: 'duration', type: 'DOUBLE' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ name: 'G1Young', duration: 12.5 }, { name: 'G1Old', duration: 145.0 }],
        plotFamilyHint: 'BOX_PLOT',
    },
    // ── HEATMAP ───────────────────────────────────────────────────────────────
    {
        sql: 'SELECT region, host, p99 FROM HostLatency',
        columns: [{ name: 'region', type: 'VARCHAR' }, { name: 'host', type: 'VARCHAR' }, { name: 'p99', type: 'DOUBLE' }],
        schema: pickSchemas('HostLatency'),
        sample: [{ region: 'us-east', host: 'h1', p99: 8.0 }, { region: 'eu-west', host: 'h2', p99: 22.0 }],
        plotFamilyHint: 'HEATMAP',
    },
    // ── FLAMEGRAPH ────────────────────────────────────────────────────────────
    {
        sql: 'SELECT stackFrames, COUNT(*) AS samples FROM ThreadSample WHERE state = \'RUNNABLE\' GROUP BY stackFrames',
        columns: [{ name: 'stackFrames', type: 'VARCHAR' }, { name: 'samples', type: 'BIGINT' }],
        schema: pickSchemas('ThreadSample'),
        sample: [{ stackFrames: 'main;run;work', samples: 120 }],
        plotFamilyHint: 'FLAMEGRAPH',
    },
    // ── GANTT ─────────────────────────────────────────────────────────────────
    {
        sql: 'SELECT startTime, endTime, thread, name AS phase FROM GarbageCollection',
        columns: [{ name: 'startTime', type: 'TIMESTAMP' }, { name: 'endTime', type: 'TIMESTAMP' }, { name: 'thread', type: 'VARCHAR' }, { name: 'phase', type: 'VARCHAR' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ startTime: '2026-06-25T10:00:00Z', endTime: '2026-06-25T10:00:00.5Z', thread: 'GC-1', phase: 'G1Young' }],
        plotFamilyHint: 'GANTT',
        biasHint: 'BOTH start* AND end* columns present → GANTT. `lane` is the row dimension; `task` is the label.',
    },
    // ── RANGE ─────────────────────────────────────────────────────────────────
    {
        sql: 'SELECT host, p25, p75 FROM HostLatency',
        columns: [{ name: 'host', type: 'VARCHAR' }, { name: 'p25', type: 'DOUBLE' }, { name: 'p75', type: 'DOUBLE' }],
        schema: pickSchemas('HostLatency'),
        sample: [{ host: 'h1', p25: 5.0, p75: 12.0 }, { host: 'h2', p25: 8.0, p75: 22.0 }],
        plotFamilyHint: 'RANGE',
        biasHint: 'A category + low/high pair → RANGE. Often overlaid with LINE_CHART for median.',
    },
    {
        sql: 'SELECT region, MIN(p50) AS minLat, MAX(p50) AS maxLat FROM HostLatency GROUP BY region',
        columns: [{ name: 'region', type: 'VARCHAR' }, { name: 'minLat', type: 'DOUBLE' }, { name: 'maxLat', type: 'DOUBLE' }],
        schema: pickSchemas('HostLatency'),
        sample: [{ region: 'us-east', minLat: 3.0, maxLat: 18.0 }],
        plotFamilyHint: 'RANGE',
    },
    // ── TREEMAP (part-of-whole hierarchy) ────────────────────────────────────
    {
        sql: 'SELECT objectClass, SUM(weight) AS totalWeight FROM ObjectAllocationSample GROUP BY objectClass ORDER BY totalWeight DESC',
        columns: [{ name: 'objectClass', type: 'VARCHAR' }, { name: 'totalWeight', type: 'BIGINT' }],
        schema: pickSchemas('ObjectAllocationSample'),
        sample: [{ objectClass: 'byte[]', totalWeight: 5242880 }, { objectClass: 'char[]', totalWeight: 2097152 }],
        plotFamilyHint: 'TREEMAP',
    },
    {
        sql: 'SELECT thread, objectClass, SUM(weight) AS w FROM ObjectAllocationSample GROUP BY thread, objectClass',
        columns: [{ name: 'thread', type: 'VARCHAR' }, { name: 'objectClass', type: 'VARCHAR' }, { name: 'w', type: 'BIGINT' }],
        schema: pickSchemas('ObjectAllocationSample'),
        sample: [{ thread: 'main', objectClass: 'byte[]', w: 1048576 }],
        plotFamilyHint: 'TREEMAP',
        biasHint: 'Use colorBy param to color treemap nodes by thread.',
    },
    {
        sql: 'SELECT name AS gcType, COUNT(*) AS cnt FROM GarbageCollection GROUP BY name',
        columns: [{ name: 'gcType', type: 'VARCHAR' }, { name: 'cnt', type: 'BIGINT' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ gcType: 'G1 Young Generation', cnt: 42 }, { gcType: 'G1 Old Generation', cnt: 3 }],
        plotFamilyHint: 'TREEMAP',
    },
    // ── WATERFALL (cumulative deltas) ─────────────────────────────────────────
    {
        sql: "SELECT phase, SUM(duration) AS totalMs FROM GarbageCollection GROUP BY phase ORDER BY MIN(startTime)",
        columns: [{ name: 'phase', type: 'VARCHAR' }, { name: 'totalMs', type: 'DOUBLE' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ phase: 'Mark', totalMs: 12.5 }, { phase: 'Remark', totalMs: 4.2 }, { phase: 'Cleanup', totalMs: -3.1 }],
        plotFamilyHint: 'WATERFALL',
    },
    {
        sql: "SELECT gcId, heapBeforeGC - heapAfterGC AS freed FROM GarbageCollection ORDER BY gcId",
        columns: [{ name: 'gcId', type: 'BIGINT' }, { name: 'freed', type: 'DOUBLE' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ gcId: 1, freed: 256000 }, { gcId: 2, freed: -4096 }],
        plotFamilyHint: 'WATERFALL',
        biasHint: 'Column "freed" is a heap delta; use WATERFALL with category="gcId", value="freed".',
    },
    {
        sql: "SELECT cause AS step, longestPause AS pauseMs FROM GarbageCollection ORDER BY startTime",
        columns: [{ name: 'step', type: 'VARCHAR' }, { name: 'pauseMs', type: 'DOUBLE' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ step: 'G1 Evacuation Pause', pauseMs: 8.3 }, { step: 'GCLocker Initiated GC', pauseMs: 2.1 }],
        plotFamilyHint: 'WATERFALL',
    },
    // ── TABLE ─────────────────────────────────────────────────────────────────
    {
        sql: 'SELECT gcId, name, duration, longestPause, cause FROM GarbageCollection ORDER BY duration DESC LIMIT 50',
        columns: [{ name: 'gcId', type: 'BIGINT' }, { name: 'name', type: 'VARCHAR' }, { name: 'duration', type: 'DOUBLE' }, { name: 'longestPause', type: 'DOUBLE' }, { name: 'cause', type: 'VARCHAR' }],
        schema: pickSchemas('GarbageCollection'),
        sample: [{ gcId: 101, name: 'G1Old', duration: 220.5, longestPause: 200.1, cause: 'Allocation Failure' }],
        plotFamilyHint: 'TABLE',
    },
    // ── COMPOSITION (overlay) ─────────────────────────────────────────────────
    {
        sql: 'SELECT startTime, jvmUser, machineTotal FROM CPULoad ORDER BY startTime',
        columns: [{ name: 'startTime', type: 'TIMESTAMP' }, { name: 'jvmUser', type: 'DOUBLE' }, { name: 'machineTotal', type: 'DOUBLE' }],
        schema: pickSchemas('CPULoad'),
        sample: [{ startTime: '2026-06-25T10:00:00Z', jvmUser: 0.4, machineTotal: 0.6 }],
        plotFamilyHint: 'COMPOSITION',
        biasHint: 'Use ROW(...) to put two LINE_CHARTs side by side, one per metric.',
    },
    // ── SPARKLINE in TABLE ────────────────────────────────────────────────────
    {
        sql: 'SELECT host, [p25, p50, p75, p99] AS quantiles FROM HostLatency',
        columns: [{ name: 'host', type: 'VARCHAR' }, { name: 'quantiles', type: 'DOUBLE[]' }],
        schema: pickSchemas('HostLatency'),
        sample: [{ host: 'h1', quantiles: [5, 7, 12, 50] }],
        plotFamilyHint: 'SPARKLINE',
        biasHint: 'TABLE with a sparkline column: `columns: [{name: "host"}, {name: "quantiles", kind: "sparkline", source: "quantiles"}]`',
    },
    // ── ERGONOMIC (lowercase / short alias / unquoted ids) ────────────────────
    {
        sql: 'SELECT startTime, heapUsed FROM HeapSnapshot ORDER BY startTime',
        columns: [{ name: 'startTime', type: 'TIMESTAMP' }, { name: 'heapUsed', type: 'BIGINT' }],
        schema: pickSchemas('HeapSnapshot'),
        sample: [{ startTime: '2026-06-25T10:00:00Z', heapUsed: 1024000 }],
        plotFamilyHint: 'ERGONOMIC',
        biasHint: 'Prefer the SHORT lowercase form: `line(x: startTime, y: heapUsed)` — unquoted ids, no array brackets.',
    },
];

/**
 * Distribution targets per family. The dispatcher samples examples weighted
 * by these counts (over the SQL_POOL entries that match the family).
 */
const FAMILY_TARGETS: Record<PlotFamily, number> = {
    LINE_CHART: 1500,
    BAR_CHART: 1200,
    AREA_CHART: 700,
    SCATTER_PLOT: 600,
    HISTOGRAM: 500,
    PIE_CHART: 400,
    BOX_PLOT: 400,
    GANTT: 400,
    RANGE: 400,
    HEATMAP: 300,
    TABLE: 250,
    FLAMEGRAPH: 150,
    TREEMAP: 300,
    WATERFALL: 300,
    COMPOSITION: 500,
    SPARKLINE: 100,
    ERGONOMIC: 100,
};

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You generate plot DSL configurations for a JFR analysis notebook.

Given a DuckDB SQL query, its columns, a table-schema preamble, and up to 5 sample rows, output the BEST plot configuration. Output ONLY the config — no prose, no markdown, no explanation, no trailing newlines.

The DSL is: NAME(param: value, ...) optionally followed by SQL-style suffix clauses.

PLOT TYPES (canonical):
  TABLE, BAR_CHART, PIE_CHART, LINE_CHART, SCATTER_PLOT, HEATMAP,
  FLAMEGRAPH, HISTOGRAM, BOX_PLOT, AREA_CHART, GANTT, RANGE,
  TREEMAP, WATERFALL

SHORT ALIASES (case-insensitive, all acceptable):
  table, bar, pie, line, scatter, heatmap, flame, hist, box, area, gantt, range,
  treemap, waterfall

PARAMS (canonical names — use these, NOT legacy aliases):
  LINE_CHART:    x, y (single or array), y2, color, xDomain, yScale, yDomain, lineY, lineType, connectNulls
  BAR_CHART:     x, y, color, horizontal, lineY, stacked
  AREA_CHART:    x, y (single canonical, array=legacy), color, layout ("stacked"|"overlay")
  SCATTER_PLOT:  x, y, color, category
  PIE_CHART:     category, value, innerRadius, outerRadius, showPercent, sliceLabel
  HISTOGRAM:     x, bins ("auto" or number)
  BOX_PLOT:      x (single-box) OR (value + category)
  HEATMAP:       x, y, value
  FLAMEGRAPH:    frames, value, direction, minFrameWidth, search
  GANTT:         start, end, lane, task
  RANGE:         x, low, high, color
  TABLE:         columns (typed) OR headers (legacy)
  TREEMAP:       category, value, colorBy
  WATERFALL:     category, value

SUFFIX CLAUSES (uppercase canonical, lowercase also accepted):
  TITLE "..."                          plot title
  LEGEND AT RIGHT|LEFT|TOP|BOTTOM|NONE legend position
  LEGEND HIDDEN                        no legend
  PALETTE "..."                        color palette name
  AXIS-X DOMAIN [a, b]                 numeric or quoted-date bounds
  AXIS-X LABEL "..."                   axis label
  AXIS-X TYPE LINEAR|LOG|TIME|BAND     axis type
  AXIS-X FORMAT "..."                  d3-format
  AXIS-Y (same 4 sub-clauses)
  TOOLTIP COLUMNS [...]                extra tooltip cols
  ON HOVER TOOLTIP "..."               tooltip template
  ON CLICK NAVIGATE "..."              click handler
  LINK-X "$var"                        subscribe to brush
  LINK-Y "$var"
  LINK-XY "$var"
  BRUSH "$var" MODE X|Y|XY             publish brush range
  NAME "alias"                         cell alias for cross-cell linking
  LET name = expr                      local binding
  HEIGHT 300px / WIDTH 50%             cell dimensions

COMPOSITION:
  A + B           overlay two plots on shared axes (same x-column required)
  ROW(A, B, C)    horizontal flex layout
  COL(A, B, C)    vertical flex layout

SPARKLINE in TABLE:
  TABLE(columns: [{name: "host"}, {name: "lat", kind: "sparkline", source: "perHostLatencies"}])

ERGONOMIC FORMS (all valid):
  line(x: startTime, y: heapUsed)              # lowercase short alias + unquoted ids
  LINE_CHART(x: "startTime", y: ["heapUsed"])  # canonical
  bar(x: name, y: count,) LEGEND AT BOTTOM     # trailing comma, lowercase clause

RULES:
- Use the EXACT column names from the columns list.
- Match the SQL shape: TIMESTAMP + numeric → LINE_CHART or AREA_CHART; category + numeric → BAR_CHART; two numerics → SCATTER_PLOT; start*+end*+category → GANTT; category + low/high pair → RANGE; single numeric → HISTOGRAM; category + value (part-of-whole, no time axis) → TREEMAP or PIE_CHART; category + signed delta/cumulative value → WATERFALL.
- Quote column names that contain spaces or special chars; unquote simple identifiers.
- Prefer single-y over array form: y: "col" rather than y: ["col"].
- Suffix clauses ONLY appear AFTER the closing paren of the body.
- Use AXIS-Y TYPE LOG instead of legacy yScale: "log".
- For composition, children must share the x-column.
- For sparkline cells, the source column must hold an array.
- 25% of the time, use the ergonomic lowercase / short-alias form.`;

function buildUserPrompt(ex: SqlExample): string {
    const cols = ex.columns.map(c => `"${c.name}" ${c.type}`).join(', ');
    const schemaBlock = ex.schema
        .slice(0, 3)
        .map(t => `- "${t.table}": (${t.columns.slice(0, 12).map(c => `"${c.name}" ${c.type}`).join(', ')})`)
        .join('\n');
    const lines = [
        `sql: ${ex.sql}`,
        `columns: ${cols}`,
        `schema:`,
        schemaBlock,
        `sample: ${JSON.stringify(ex.sample.slice(0, 5))}`,
    ];
    if (ex.biasHint) lines.push(`hint: ${ex.biasHint}`);
    lines.push('', 'Return only the plot config.');
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// API key — read via AiService, never inlined
// ---------------------------------------------------------------------------

async function getEffectiveAnthropicKey(): Promise<string> {
    // CLI script — read directly from env. We deliberately avoid importing
    // ../../services/AiService because that module pulls in browser context
    // (SettingsContext, providerMetadataRegistry) that fails outside a DOM.
    // The security constraint is "never inline keys in code", not "always
    // route through the browser service layer".
    const key = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN ?? '';
    if (!key) throw new Error('No Anthropic API key found. Set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN.');
    return key;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

async function validatePlot(plot: string): Promise<boolean> {
    try {
        const { parseComposite, validateComposite } = await import('../../utils/plotParser');
        const parsed = parseComposite(plot);
        if (parsed.composite) {
            const issues = validateComposite(parsed);
            return !issues.some(i => i.severity === 'error');
        }
        // For single-plot calls, require a well-formed function call: NAME(...).
        return /^\w+\s*\(.*\)/.test(parsed.mainConfig);
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface DatasetRow {
    sql: string;
    columns: ColumnDef[];
    schema: TableSchema[];
    sample: Record<string, unknown>[];
    plot: string;
    plotFamilyHint: string;
}

function countLines(path: string): number {
    if (!existsSync(path)) return 0;
    try {
        return readFileSync(path, 'utf-8').split('\n').filter(l => l.trim()).length;
    } catch {
        return 0;
    }
}

/**
 * Build a weighted pool: for each family, list its SQL_POOL entries weighted
 * by FAMILY_TARGETS / (number of entries for that family). The returned array
 * is shuffled deterministically and consumed round-robin.
 */
function buildScheduler(target: number): SqlExample[] {
    const byFamily = new Map<PlotFamily, SqlExample[]>();
    for (const ex of SQL_POOL) {
        const list = byFamily.get(ex.plotFamilyHint) ?? [];
        list.push(ex);
        byFamily.set(ex.plotFamilyHint, list);
    }
    const totalTarget = Object.values(FAMILY_TARGETS).reduce((a, b) => a + b, 0);
    const schedule: SqlExample[] = [];
    for (const [family, count] of Object.entries(FAMILY_TARGETS) as [PlotFamily, number][]) {
        const examples = byFamily.get(family);
        if (!examples || examples.length === 0) continue;
        const familyTarget = Math.round((count / totalTarget) * target);
        for (let i = 0; i < familyTarget; i++) {
            schedule.push(examples[i % examples.length]);
        }
    }
    // Fisher–Yates shuffle (deterministic seeded — same target → same schedule).
    let seed = 0xC0DEFACE;
    const rand = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 0xFFFFFFFF;
    };
    for (let i = schedule.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [schedule[i], schedule[j]] = [schedule[j], schedule[i]];
    }
    return schedule;
}

async function callTeacher(client: Anthropic, model: string, ex: SqlExample, retries = 3): Promise<string | null> {
    let attempt = 0;
    while (attempt <= retries) {
        try {
            const resp = await client.messages.create({
                model,
                max_tokens: 200,
                system: SYSTEM_PROMPT,
                messages: [{ role: 'user', content: buildUserPrompt(ex) }],
            });
            const text = resp.content
                .filter((b): b is Anthropic.TextBlock => b.type === 'text')
                .map(b => b.text)
                .join('\n')
                .trim();
            // Strip code fences if model wrapped output.
            const cleaned = text.replace(/^```(?:\w+)?\s*/g, '').replace(/```\s*$/g, '').trim();
            return cleaned || null;
        } catch (err: any) {
            const status = err?.status ?? err?.statusCode;
            if ((status === 429 || status === 529 || (status >= 500 && status < 600)) && attempt < retries) {
                const backoff = 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
                await new Promise(r => setTimeout(r, backoff));
                attempt++;
                continue;
            }
            throw err;
        }
    }
    return null;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { printHelp(); return; }

    if (args.dryRun) {
        process.stdout.write(`DRY RUN — would generate ${args.target} examples to ${args.out}\n`);
        process.stdout.write(`Teacher: ${args.model}  Concurrency: ${args.concurrency}\n\n`);
        process.stdout.write(`SYSTEM PROMPT:\n${SYSTEM_PROMPT}\n\n`);
        for (let i = 0; i < Math.min(3, SQL_POOL.length); i++) {
            process.stdout.write(`--- Sample user prompt #${i + 1} (${SQL_POOL[i].plotFamilyHint}) ---\n`);
            process.stdout.write(buildUserPrompt(SQL_POOL[i]) + '\n\n');
        }
        return;
    }

    const apiKey = await getEffectiveAnthropicKey();
    const client = new Anthropic({
        apiKey,
        baseURL: process.env.ANTHROPIC_BASE_URL,
        defaultHeaders: { authorization: `Bearer ${apiKey}` },
    });

    mkdirSync(dirname(args.out), { recursive: true });
    const existing = countLines(args.out);
    const sink = createWriteStream(args.out, { flags: 'a' });
    process.stdout.write(`[plot-dataset-v12] resuming from ${existing}; target ${args.target}; model=${args.model}\n`);

    const schedule = buildScheduler(args.target);
    let total = existing;
    let scheduleIdx = existing; // resume at the right position so re-runs stay deterministic
    let inflight = 0;
    let invalidCount = 0;
    let done = false;

    await new Promise<void>(resolveOuter => {
        const maybeFinish = () => {
            if (done && inflight === 0) {
                sink.end();
                resolveOuter();
            }
        };

        const dispatch = () => {
            while (!done && inflight < args.concurrency && total < args.target) {
                if (scheduleIdx >= schedule.length) {
                    // Reuse the schedule if we run out (rare; only when retries inflate count).
                    scheduleIdx = 0;
                }
                const ex = schedule[scheduleIdx++];
                inflight++;
                callTeacher(client, args.model, ex)
                    .then(async plot => {
                        if (!plot || total >= args.target) return;
                        const ok = args.skipValidation ? true : await validatePlot(plot);
                        if (!ok) { invalidCount++; return; }
                        const row: DatasetRow = {
                            sql: ex.sql,
                            columns: ex.columns,
                            schema: ex.schema,
                            sample: ex.sample,
                            plot,
                            plotFamilyHint: ex.plotFamilyHint,
                        };
                        sink.write(JSON.stringify(row) + '\n');
                        total++;
                        if (total % 100 === 0) {
                            process.stdout.write(`[plot-dataset-v12] ${total}/${args.target}  (rejected: ${invalidCount})\n`);
                        }
                    })
                    .catch(err => {
                        process.stdout.write(`[plot-dataset-v12] batch ${scheduleIdx - 1} failed: ${err?.message ?? err}\n`);
                    })
                    .finally(() => {
                        inflight--;
                        if (total >= args.target) {
                            done = true;
                            maybeFinish();
                        } else {
                            dispatch();
                        }
                    });
            }
            if (!done && inflight === 0 && total >= args.target) {
                done = true;
                maybeFinish();
            }
        };

        dispatch();
    });

    process.stdout.write(`[plot-dataset-v12] done: ${total} rows written; ${invalidCount} rejected\n`);
    appendFileSync(args.out + '.stats.json', JSON.stringify({ at: new Date().toISOString(), total, invalidCount }) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(e => {
        console.error(e);
        process.exit(1);
    });
}

export { SQL_POOL, SYSTEM_PROMPT, buildUserPrompt, parseArgs, FAMILY_TARGETS, buildScheduler };
