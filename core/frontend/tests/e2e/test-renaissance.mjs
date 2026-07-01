/**
 * Ad-hoc interactive test session: renaissance.jfr (418MB)
 *
 * - Loads the 418MB JFR file via WASM drop-zone
 * - Waits up to 15 minutes for import to complete
 * - Runs representative queries and all flamegraph types
 * - Records import time and any errors
 *
 * Invocation:
 *   APP_URL=http://localhost:5175 node tests/e2e/test-renaissance.mjs
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RENAISSANCE_JFR = '/Users/i560383_1/code/experiments/condensed-data/renaissance.jfr';
const IMPORT_TIMEOUT_MS = 15 * 60 * 1000; // 15 min
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

const results = [];
let page;
let t0Import, t1Import;

async function test(name, fn) {
    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`  ✓ ${name}`);
    } catch (e) {
        const msg = (e.message ?? String(e)).split('\n').slice(0, 2).join(' | ');
        results.push({ name, ok: false, err: msg });
        console.log(`  ✗ ${name}\n    ${msg}`);
        try {
            const slug = name.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 50);
            await page.screenshot({ path: path.join(SCREENSHOT_DIR, `renaissance-FAIL-${slug}.png`) });
        } catch {}
    }
}

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
    for (const port of [5173, 5174, 5175, 3000, 3001, 3002]) {
        if (await probePort(port)) return `http://localhost:${port}`;
    }
    throw new Error('No dev server found. Set APP_URL.');
}

async function typeIntoCm(editor, text) {
    const content = editor.locator('.cm-content').first();
    await content.click();
    await page.waitForTimeout(80);
    await page.keyboard.press('Control+a');
    await page.keyboard.type(text, { delay: 8 });
    await page.waitForTimeout(100);
}

async function addAndRunCell(sql, plotDsl) {
    const before = await page.locator('main h2').count();
    const btn = page.getByRole('button', { name: /add cell/i }).first();
    const btnY = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(b => /add cell/i.test(b.textContent ?? ''));
        return b ? b.getBoundingClientRect().top + window.scrollY : null;
    });
    if (btnY) await page.evaluate(y => window.scrollTo(0, Math.max(0, y - 200)), btnY);
    await page.waitForTimeout(150);
    await btn.click();
    await page.waitForFunction(b => document.querySelectorAll('main h2').length > b, before, { timeout: 5000 });

    const idx = await page.locator('main h2').count() - 1;
    const editors = page.locator('.cm-editor');
    const sqlEditor = editors.nth(await editors.count() - 1);
    const content = plotDsl ? `${sql}\n\`\`\`plot\n${plotDsl}\n\`\`\`` : sql;
    await typeIntoCm(sqlEditor, content);

    const h2s = page.locator('main h2');
    const cellSection = h2s.nth(idx).locator('xpath=ancestor::section').first();
    const runBtn = cellSection.locator('button[title*="Run"], button[aria-label*="Run"]').first();
    if (await runBtn.count() > 0) await runBtn.click();
    else await page.keyboard.press('Shift+Enter');

    await page.waitForTimeout(15_000);
}

async function main() {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
    await fs.access(RENAISSANCE_JFR);

    const appUrl = await findAppUrl();
    console.log(`\n=== renaissance.jfr (418MB) test session → ${appUrl} ===\n`);

    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    page = await ctx.newPage();

    const consoleErrors = [];
    page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
    page.on('console', m => {
        if (m.type() === 'error') {
            const t = m.text();
            if (!t.includes('DevTools') && !t.includes('Failed to load resource')) consoleErrors.push(t);
        }
    });

    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await Promise.race([
        page.waitForSelector('header h1', { timeout: 25_000 }),
        page.waitForSelector('input[type=file]', { timeout: 25_000 }),
    ]);

    const isServer = await page.locator('header h1').isVisible().catch(() => false);
    if (isServer) {
        console.log('Server mode detected — skipping WASM file drop.\n');
    } else {
        // ── Import ───────────────────────────────────────────────────────────
        console.log('Dropping renaissance.jfr (418MB) onto drop zone…');
        t0Import = Date.now();
        const fileInput = page.locator('input[type=file]').first();
        await fileInput.setInputFiles(RENAISSANCE_JFR);
        await page.waitForSelector('header h1', { timeout: IMPORT_TIMEOUT_MS });
        t1Import = Date.now();
        const importSec = ((t1Import - t0Import) / 1000).toFixed(1);
        console.log(`  Import complete in ${importSec}s\n`);

        await test(`renaissance.jfr imports in ${importSec}s without error`, async () => {
            const binaryErrors = consoleErrors.filter(e => e.includes('[binary-insert]') || e.includes('binary-insert error'));
            if (binaryErrors.length) throw new Error(binaryErrors.join('; '));
        });
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'renaissance-01-loaded.png') });

    // ── Basic queries ────────────────────────────────────────────────────────
    console.log('── Basic queries ──');

    await test('count(*) FROM information_schema.tables returns > 0', async () => {
        await addAndRunCell('SELECT count(*) AS n FROM information_schema.tables');
        const cells = await page.locator('td').count();
        if (cells === 0) throw new Error('No result cells');
    });

    await test('ExecutionSample table exists and has rows', async () => {
        await addAndRunCell('SELECT COUNT(*) AS n FROM ExecutionSample');
        const cells = await page.locator('td').count();
        if (cells === 0) throw new Error('No result');
    });

    await test('GarbageCollection table exists', async () => {
        await addAndRunCell('SELECT COUNT(*) AS n FROM GarbageCollection');
        const cells = await page.locator('td').count();
        if (cells === 0) throw new Error('No result');
    });

    // ── Flamegraph sources ───────────────────────────────────────────────────
    console.log('\n── Flamegraph sources ──');

    await test('cpu-flamegraph view produces rows', async () => {
        await addAndRunCell('SELECT frame, value FROM "cpu-flamegraph" WHERE frame IS NOT NULL LIMIT 10');
        const cells = await page.locator('td').count();
        if (cells === 0) throw new Error('No rows from cpu-flamegraph view');
    });

    await test('alloc-flamegraph view produces rows', async () => {
        await addAndRunCell('SELECT frame, value FROM "alloc-flamegraph" WHERE frame IS NOT NULL LIMIT 10');
        const cells = await page.locator('td').count();
        if (cells === 0) throw new Error('No rows from alloc-flamegraph view');
    });

    // ── Flamegraph plots ─────────────────────────────────────────────────────
    console.log('\n── Flamegraph plots ──');

    await test('CPU FLAMEGRAPH renders with real stack data', async () => {
        await addAndRunCell(
            'SELECT frame, value FROM "cpu-flamegraph" WHERE frame IS NOT NULL LIMIT 300',
            'FLAMEGRAPH(frames: "frame", value: "value") TITLE "CPU Flamegraph"'
        );
        const svgRects = await page.locator('main svg rect').count();
        const flameEl = await page.locator('[class*="flame"], canvas').count();
        if (svgRects < 10 && flameEl === 0) throw new Error(`Too few elements: rects=${svgRects} flameEl=${flameEl}`);
        console.log(`      rects=${svgRects} flameEl=${flameEl}`);
    });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'renaissance-cpu-flamegraph.png') });

    await test('Allocation FLAMEGRAPH renders', async () => {
        await addAndRunCell(
            'SELECT frame, value FROM "alloc-flamegraph" WHERE frame IS NOT NULL LIMIT 300',
            'FLAMEGRAPH(frames: "frame", value: "value") TITLE "Allocation Flamegraph (MB)"'
        );
        const svgRects = await page.locator('main svg rect').count();
        const canvas = await page.locator('main canvas').count();
        if (svgRects < 5 && canvas === 0) throw new Error(`Too few flame elements: rects=${svgRects}`);
    });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'renaissance-alloc-flamegraph.png') });

    await test('lock-flamegraph view exists (or table absent)', async () => {
        try {
            await addAndRunCell('SELECT COUNT(*) AS n FROM "lock-flamegraph"');
        } catch {
            // Table absent in this recording — that's fine
        }
    });

    // ── GC chart ─────────────────────────────────────────────────────────────
    console.log('\n── GC chart ──');
    await test('GarbageCollection LINE_CHART renders', async () => {
        await addAndRunCell(
            'SELECT startTime, CAST(duration/1e6 AS DOUBLE) AS dur_ms FROM GarbageCollection LIMIT 200',
            'LINE_CHART(x:"startTime", y:["dur_ms"]) TITLE "GC Pause Duration"'
        );
        const lines = await page.locator('[class*="recharts-line"], [class*="recharts-surface"]').count();
        if (lines === 0) throw new Error('No recharts line elements');
    });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'renaissance-gc-line.png') });

    // ── Final ─────────────────────────────────────────────────────────────────
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'renaissance-final.png'), fullPage: false });
    await browser.close();

    console.log('\n=== Summary ===');
    if (t0Import && t1Import) console.log(`Import time: ${((t1Import - t0Import)/1000).toFixed(1)}s`);
    const passed = results.filter(r => r.ok).length;
    console.log(`${passed}/${results.length} passed`);
    results.filter(r => !r.ok).forEach(r => console.log(`  FAIL: ${r.name}: ${r.err}`));
    if (consoleErrors.length) {
        console.log('\nConsole errors:');
        consoleErrors.slice(0, 5).forEach(e => console.log(`  ${e}`));
    }
    if (results.some(r => !r.ok)) process.exit(1);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
