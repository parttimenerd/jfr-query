/**
 * evalSqlModel.ts
 * ---------------
 * Evaluates the in-tree ONNX SQL-suggester artifact on a held-out split of
 * the JSONL dataset produced by `generateSqlDataset.ts`.
 *
 * Writes `services/ml/models/sql-suggester/eval.json`:
 *   {
 *     "usefulCompletionRate": 0.74,
 *     "exactMatchRate":       0.18,
 *     "schemaFidelityRate":   0.91,  // referenced columns exist in row.schema
 *     "noEchoRate":           0.99,  // did NOT restate the prefix
 *     "sampledAt":            "...",
 *     "sampleSize":           N
 *   }
 *
 * Promotion gate (used by BrowserModelProvider): usefulCompletionRate ≥ 0.70.
 * Below gate → fall through to browserSqlRules.ts naive rules.
 *
 * Usage:
 *   npx tsx scripts/training/evalSqlModel.ts --dataset data/sql_pairs_v1.jsonl --split 0.1
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

interface Args {
    dataset: string;
    split: number;
    artifactDir: string;
    out: string;
    limit: number | null;
    help: boolean;
}

function parseArgs(argv: string[]): Args {
    const get = (n: string, d?: string): string | undefined => {
        const i = argv.indexOf(n);
        return i >= 0 ? argv[i + 1] : d;
    };
    const has = (n: string): boolean => argv.includes(n);
    const lim = get('--limit');
    return {
        dataset: resolve(process.cwd(), get('--dataset', 'data/sql_pairs_v1.jsonl')!),
        split: Number(get('--split', '0.1')),
        artifactDir: resolve(process.cwd(), get('--artifact', 'services/ml/models/sql-suggester')!),
        out: resolve(process.cwd(), get('--out', 'services/ml/models/sql-suggester/eval.json')!),
        limit: lim ? Number(lim) : null,
        help: has('--help') || has('-h'),
    };
}

interface ColumnDef { name: string; type: string }
interface SchemaTable { table: string; columns: ColumnDef[] }
interface DatasetRow {
    prefix: string;
    target: string;
    schema?: SchemaTable[];
    tier?: string;
}

function loadJsonl(path: string): DatasetRow[] {
    if (!existsSync(path)) throw new Error(`Dataset not found: ${path}`);
    const raw = readFileSync(path, 'utf-8');
    const rows: DatasetRow[] = [];
    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
            const r = JSON.parse(t);
            if (r && typeof r.prefix === 'string' && typeof r.target === 'string') rows.push(r);
        } catch { /* skip malformed */ }
    }
    return rows;
}

function heldOutSplit(rows: DatasetRow[], split: number): DatasetRow[] {
    const n = Math.max(1, Math.floor(rows.length * split));
    return rows.slice(rows.length - n);
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function extractColumns(text: string): Set<string> {
    const cols = new Set<string>();
    for (const m of text.matchAll(/"([A-Za-z_][A-Za-z0-9_ ]*)"/g)) cols.add(m[1]);
    return cols;
}

function schemaColumns(schema: SchemaTable[] | undefined): Set<string> {
    const out = new Set<string>();
    if (!schema) return out;
    for (const t of schema) {
        out.add(t.table);
        for (const c of t.columns) out.add(c.name);
    }
    return out;
}

/** A completion is "useful" if: non-empty, no <<CURSOR>>, no fences, doesn't echo prefix, and references at least one schema column when columns appear. */
function isUseful(pred: string, prefix: string, schema?: SchemaTable[]): boolean {
    const p = pred.trim();
    if (!p) return false;
    if (p.includes('<<CURSOR>>') || p.includes('```')) return false;
    if (p.startsWith(prefix)) return false;
    const lastWord = prefix.match(/(\w+)\s*$/)?.[1];
    if (lastWord && p.toLowerCase().trim().startsWith(lastWord.toLowerCase() + ' ')) return false;
    const refCols = extractColumns(p);
    if (refCols.size === 0) return true; // pure-keyword completion (e.g. "ORDER BY h") still useful
    const schemaCols = schemaColumns(schema);
    for (const c of refCols) if (schemaCols.has(c)) return true;
    return false;
}

function schemaFidelity(pred: string, schema?: SchemaTable[]): boolean {
    const refCols = extractColumns(pred);
    if (refCols.size === 0) return true;
    const schemaCols = schemaColumns(schema);
    for (const c of refCols) if (!schemaCols.has(c)) return false;
    return true;
}

function noEcho(pred: string, prefix: string): boolean {
    return !pred.trim().startsWith(prefix.trim().slice(-Math.min(20, prefix.length)));
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

async function loadLocalModel(artifactDir: string): Promise<{ tokenizer: any; model: any } | null> {
    if (!existsSync(artifactDir)) return null;
    try {
        const { AutoTokenizer, AutoModelForSeq2SeqLM, env } = await import('@huggingface/transformers');
        (env as any).allowLocalModels = true;
        (env as any).localModelPath = dirname(artifactDir);
        const baseName = artifactDir.split('/').pop()!;
        const tokenizer = await AutoTokenizer.from_pretrained(baseName);
        const model = await AutoModelForSeq2SeqLM.from_pretrained(baseName, { dtype: 'fp32', device: 'cpu' });
        return { tokenizer, model };
    } catch (err: any) {
        process.stdout.write(`[eval-sql] failed to load artifact: ${err?.message ?? err}\n`);
        return null;
    }
}

function buildInput(row: DatasetRow): string {
    const parts: string[] = [];
    if (row.schema && row.schema.length) {
        const lines = ['schema:'];
        for (const tbl of row.schema.slice(0, 3)) {
            const cols = tbl.columns.slice(0, 12).map(c => `"${c.name}" ${c.type || 'VARCHAR'}`).join(', ');
            lines.push(`- "${tbl.table}": (${cols})`);
        }
        parts.push(lines.join('\n'));
    }
    parts.push(`prefix: ${row.prefix}`);
    return parts.join('\n');
}

async function predict(tokenizer: any, model: any, row: DatasetRow): Promise<string> {
    const input = buildInput(row);
    const tokenized = await tokenizer(input, { return_tensors: 'pt', truncation: true, max_length: 512 });
    const output = await model.generate({ ...tokenized }, { max_new_tokens: 64, do_sample: false, early_stopping: true });
    return tokenizer.decode(output[0], { skip_special_tokens: true }).trim();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(`evalSqlModel.ts — evaluate the in-tree SQL-suggester ONNX artifact\n\nUSAGE:\n  npx tsx scripts/training/evalSqlModel.ts [--dataset PATH] [--split FRAC] [--artifact PATH] [--out PATH] [--limit N]\n\nPROMOTION GATE: usefulCompletionRate ≥ 0.70 → in-tree model becomes default browser SQL backend.\n`);
        return;
    }
    const all = loadJsonl(args.dataset);
    let eval_ = heldOutSplit(all, args.split);
    if (args.limit) eval_ = eval_.slice(0, args.limit);
    process.stdout.write(`[eval-sql] loaded ${all.length} rows, evaluating ${eval_.length}\n`);

    const loaded = await loadLocalModel(args.artifactDir);
    if (!loaded) {
        process.stdout.write(`[eval-sql] no artifact at ${args.artifactDir}; skipping (gate stays closed)\n`);
        return;
    }

    let useful = 0, exact = 0, schemaOk = 0, echoFree = 0;
    for (let i = 0; i < eval_.length; i++) {
        const row = eval_[i];
        const pred = await predict(loaded.tokenizer, loaded.model, row);
        if (isUseful(pred, row.prefix, row.schema)) useful++;
        if (pred.trim() === row.target.trim()) exact++;
        if (schemaFidelity(pred, row.schema)) schemaOk++;
        if (noEcho(pred, row.prefix)) echoFree++;
        if ((i + 1) % 20 === 0) process.stdout.write(`[eval-sql] ${i + 1}/${eval_.length}\n`);
    }

    const out = {
        usefulCompletionRate: useful / eval_.length,
        exactMatchRate: exact / eval_.length,
        schemaFidelityRate: schemaOk / eval_.length,
        noEchoRate: echoFree / eval_.length,
        sampledAt: new Date().toISOString(),
        sampleSize: eval_.length,
    };
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(out, null, 2));
    process.stdout.write(`[eval-sql] wrote ${args.out}\n`);
    process.stdout.write(`[eval-sql] useful=${(out.usefulCompletionRate * 100).toFixed(1)}%  exact=${(out.exactMatchRate * 100).toFixed(1)}%  schema-fidelity=${(out.schemaFidelityRate * 100).toFixed(1)}%\n`);
    if (out.usefulCompletionRate < 0.70) {
        process.stdout.write(`[eval-sql] GATE CLOSED (need ≥70%). Browser SQL stays on rule-based fallback.\n`);
    } else {
        process.stdout.write(`[eval-sql] GATE PASSED. Browser SQL can use the in-tree T5 model.\n`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
