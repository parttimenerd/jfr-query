/**
 * JFR import pipeline benchmark.
 *
 * Loads each JFR file into WASM DuckDB and records:
 *   - File size (bytes)
 *   - Java sync phase (ms)
 *   - Arrow drain phase (ms)
 *   - SQL registration phase (ms)  ← macro + view CREATE statements
 *   - Total import time (ms)
 *
 * Outputs a markdown table so results can be compared across runs
 * (serial baseline vs parallel registration).
 *
 * Usage:
 *   node tests/e2e/benchmark-import.mjs [--serial]
 *
 *   --serial  patch PARALLELISM=1 via window override before each test
 *             (simulates the old serial behaviour for comparison)
 *
 * Requires a running dev server (auto-detected on common ports).
 */

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ALL_FILES = [
  { label: 'small  (1MB)',  path: '/Users/i560383_1/code/experiments/condensed-data/profile.jfr', large: false },
  { label: 'medium (6MB)',  path: path.join(__dirname, '../../../jfr_files/default.jfr'), large: false },
  { label: 'large  (50MB)', path: path.join(__dirname, '../../../jfr_files/metal.jfr'), large: true },
  { label: 'large  (67MB)', path: path.join(__dirname, '../../../jfr_files/container.jfr'), large: true },
];

// renaissance.jfr is opt-in — too large for normal CI runs.
if (process.env.INCLUDE_HUGE) {
  ALL_FILES.push({ label: 'huge  (418MB)', path: '/Users/i560383_1/code/experiments/condensed-data/renaissance.jfr', large: true });
}

// --large opts in to 50MB+ files (skipped by default — they take 1-3 min each).
const INCLUDE_LARGE = process.argv.includes('--large') || !!process.env.INCLUDE_LARGE;

// Filter to files that actually exist and are in-scope (large files require --large).
async function resolveFiles() {
  const available = [];
  const skipped = [];
  for (const f of ALL_FILES) {
    if (f.large && !INCLUDE_LARGE) { skipped.push(`${f.label} (use --large to include)`); continue; }
    try { await fs.access(f.path); available.push(f); }
    catch { skipped.push(`${f.label} (not found)`); }
  }
  if (skipped.length) console.log(`Skipping: ${skipped.join(', ')}`);
  return available;
}

const SERIAL_MODE = process.argv.includes('--serial');
const REPEATS = parseInt(process.env.REPEATS ?? '1', 10);
// Per-file timeout: 15min for huge, 5min for others.
const IMPORT_TIMEOUT_HUGE = 15 * 60 * 1000;
const IMPORT_TIMEOUT_NORMAL = 5 * 60 * 1000;

function probePort(port) {
  return new Promise((resolve) => {
    const req = http.request({ host: 'localhost', port, path: '/', timeout: 800 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      res.on('end', () => resolve(body.includes('JFR') || body.includes('jfr-sql-notebook')));
      res.on('error', () => resolve(false));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function findAppUrl() {
  if (process.env.APP_URL) return process.env.APP_URL;
  for (const port of [5173, 5174, 5175, 5180, 3000, 3001]) {
    if (await probePort(port)) return `http://localhost:${port}`;
  }
  throw new Error('No dev server found. Set APP_URL or start: npm run dev');
}

async function measureFile(browser, appUrl, file, repeatIdx) {
  const timeout = file.label.includes('418') ? IMPORT_TIMEOUT_HUGE : IMPORT_TIMEOUT_NORMAL;

  // Check file exists.
  try { await fs.access(file.path); } catch {
    return { ...file, error: 'file not found', repeatIdx };
  }
  const stat = await fs.stat(file.path);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleLines = [];
  page.on('console', m => {
    if (m.text().startsWith('[jfr-perf]')) consoleLines.push(m.text());
  });
  page.on('pageerror', e => console.error('  PAGE ERROR:', e.message.split('\n')[0]));

  let t0, t1;
  try {
    const pageUrl = SERIAL_MODE ? `${appUrl}?sqlSerial=1` : appUrl;
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type=file]').first().waitFor({ state: 'attached', timeout: 30_000 });

    t0 = Date.now();
    await page.locator('input[type=file]').first().setInputFiles(file.path);

    // Wait for window.__lastJfrPerf to be set — this is written at the end of
    // loadJfrIntoWasm() after Java sync + Arrow drain + SQL registration.
    await page.waitForFunction(
      () => window.__lastJfrPerf && window.__lastJfrPerf.sqlRegMs != null,
      { timeout },
    );
    t1 = Date.now();

    // Extract structured perf data from window.__lastJfrPerf.
    const perf = await page.evaluate(() => window.__lastJfrPerf).catch(() => null);

    return {
      ...file,
      bytes: stat.size,
      totalMs: t1 - t0,
      javaSyncMs: perf?.javaSyncMs ?? null,
      drainMs: perf?.drainMs ?? null,
      sqlRegMs: perf?.sqlRegMs ?? null,
      sqlParallelism: perf?.sqlParallelism ?? null,
      consoleLines,
      repeatIdx,
      error: null,
    };
  } catch (e) {
    return {
      ...file,
      bytes: stat.size,
      totalMs: t1 ? Date.now() - t0 : null,
      error: e.message.split('\n')[0],
      consoleLines,
      repeatIdx,
    };
  } finally {
    await ctx.close();
  }
}

function fmt(ms) {
  if (ms == null) return '     —';
  if (ms < 1000) return `${ms.toFixed(0).padStart(5)}ms`;
  return `${(ms / 1000).toFixed(1).padStart(5)}s `;
}

function fmtBytes(b) {
  if (b == null) return '—';
  if (b >= 1e9) return `${(b / 1e9).toFixed(0)}GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)}MB`;
  return `${(b / 1e3).toFixed(0)}KB`;
}

async function main() {
  const appUrl = await findAppUrl();
  const FILES = await resolveFiles();
  if (FILES.length === 0) {
    console.error('No JFR files available. Cannot run benchmark.');
    process.exit(1);
  }
  const mode = SERIAL_MODE ? 'SERIAL (parallelism=1)' : `PARALLEL (parallelism=4)`;
  console.log(`\n=== JFR Import Benchmark — ${mode} ===`);
  console.log(`Server: ${appUrl}  |  Repeats: ${REPEATS}\n`);

  const browser = await chromium.launch({ headless: true });
  const allResults = [];

  for (const file of FILES) {
    for (let r = 0; r < REPEATS; r++) {
      process.stdout.write(`  Loading ${file.label} (repeat ${r + 1}/${REPEATS})... `);
      const result = await measureFile(browser, appUrl, file, r);
      allResults.push(result);
      if (result.error) {
        console.log(`FAILED: ${result.error}`);
      } else {
        console.log(`done. Total: ${fmt(result.totalMs)}  Java: ${fmt(result.javaSyncMs)}  drain: ${fmt(result.drainMs)}  sqlReg: ${fmt(result.sqlRegMs)}`);
      }
    }
  }

  await browser.close();

  // ── Summary table ──────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`Results (${mode})\n`);
  console.log(`| File           | Size  | Total   | Java sync | Drain   | SQL reg | SQL×  |`);
  console.log(`|----------------|-------|---------|-----------|---------|---------|-------|`);

  // Average across repeats.
  const byFile = new Map();
  for (const r of allResults) {
    if (!byFile.has(r.label)) byFile.set(r.label, []);
    byFile.get(r.label).push(r);
  }

  for (const [label, runs] of byFile) {
    const valid = runs.filter(r => !r.error);
    const avg = (key) => valid.length ? valid.reduce((s, r) => s + (r[key] ?? 0), 0) / valid.length : null;

    const totalMs = avg('totalMs');
    const javaMs = avg('javaSyncMs');
    const drainMs = avg('drainMs');
    const sqlMs = avg('sqlRegMs');
    const parallelism = valid[0]?.sqlParallelism ?? '—';
    const size = fmtBytes(valid[0]?.bytes ?? null);
    const errNote = runs.some(r => r.error) ? ' ⚠' : '';

    console.log(
      `| ${label.padEnd(14)} | ${size.padEnd(5)} | ${fmt(totalMs)} | ${fmt(javaMs)}  | ${fmt(drainMs)} | ${fmt(sqlMs)} | ${String(parallelism).padEnd(5)} |${errNote}`
    );
  }

  console.log(`\nLegend: SQL reg = time to CREATE all ${SERIAL_MODE ? '134' : '134'} macros+views`);
  console.log(`        Java sync = GraalVM WASM parsing (blocks JS thread)`);
  console.log(`        Drain = async Arrow inserts to DuckDB`);
  console.log(`        SQL× = parallelism used for SQL registration\n`);

  // Write JSON results for comparison.
  const outPath = path.join(__dirname, `benchmark-results-${SERIAL_MODE ? 'serial' : 'parallel'}-${Date.now()}.json`);
  await fs.writeFile(outPath, JSON.stringify({ mode, results: allResults }, null, 2));
  console.log(`Full results written to: ${outPath}\n`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
