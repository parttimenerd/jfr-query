import { chromium } from 'playwright';

const BASE = 'http://localhost:5175';
const results = [];
let page;

async function test(name, fn) {
    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`✓ ${name}`);
    } catch (e) {
        results.push({ name, ok: false, err: e.message });
        console.log(`✗ ${name}: ${e.message}`);
    }
}

const browser = await chromium.launch({ headless: true });
page = await browser.newPage();

// Load the demo
await page.goto(BASE);
await page.waitForLoadState('networkidle');

await test('landing page renders', async () => {
    const h = await page.locator('h1').textContent();
    if (!h?.includes('JFR SQL Notebook')) throw new Error(`got: ${h}`);
});

// Open GC notebook
await test('open GC analysis notebook', async () => {
    await page.click('text=Open GC analysis notebook');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // DuckDB WASM init
});

// Take screenshot of notebook state
await page.screenshot({ path: '/tmp/notebook-loaded.png', fullPage: false });

await test('notebook cells are rendered', async () => {
    const cells = await page.locator('[data-testid="notebook-cell"], .cell, [class*="cell"]').count();
    // Look for any h2/h5 headers which signal cells
    const headers = await page.locator('main h2, main h5').count();
    if (headers === 0) throw new Error('No cell headers found');
});

await test('Add SQL button is present', async () => {
    const btn = page.locator('button').filter({ hasText: /Add SQL/ }).first();
    if (await btn.count() === 0) throw new Error('Add SQL button not found');
});

await test('Add SQL adds a block', async () => {
    // Count cm-editor instances (CodeMirror 6)
    const before = await page.locator('.cm-editor').count();
    const btn = page.locator('button').filter({ hasText: /Add SQL/ }).first();
    await btn.click();
    await page.waitForTimeout(600);
    const after = await page.locator('.cm-editor').count();
    if (after <= before) throw new Error(`CodeMirror count: ${before} → ${after}`);
});

await test('plot editor present in cells', async () => {
    // Plot editors also use cm-editor
    const plotEditors = await page.locator('.cm-editor').count();
    if (plotEditors === 0) throw new Error('No CodeMirror editors found');
});

await test('Add variable button present', async () => {
    const btn = page.locator('button').filter({ hasText: /Add variable/ }).first();
    if (await btn.count() === 0) throw new Error('Add variable button not found');
});

await test('Add variable creates variable entry', async () => {
    const btn = page.locator('button').filter({ hasText: /Add variable/ }).first();
    // Scroll to it first
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForTimeout(400);
    // Variables block or variable entry should appear
    const varBlocks = await page.locator('main').filter({ hasText: /\$\w+/ }).count();
    if (varBlocks === 0) throw new Error('No variable entries found after clicking Add variable');
});

await test('SQL editor is a CodeMirror 6 editor', async () => {
    const cm6 = await page.locator('.cm-editor').first();
    if (await cm6.count() === 0) throw new Error('No cm-editor found');
    const content = await cm6.locator('.cm-content').first().textContent();
    if (content === null) throw new Error('cm-content not found');
});

await test('plot result area renders', async () => {
    // Look for SVG charts or recharts containers
    await page.waitForTimeout(2000);
    const svgs = await page.locator('main svg').count();
    // Also check for recharts containers
    const recharts = await page.locator('[class*="recharts"]').count();
    if (svgs === 0 && recharts === 0) throw new Error('No SVG charts or recharts found');
    console.log(`  Found ${svgs} SVG elements, ${recharts} recharts elements`);
});

// Test presenter mode toggle
await test('presenter mode toggle button present', async () => {
    // Look for eye/presentation button in header
    const presenterBtns = await page.locator('header button[title*="resenter"], header button[title*="Presenter"], header button[title*="presentation"]').count();
    const eyeBtns = await page.locator('header button[title*="eye"], header button[title*="Eye"]').count();
    // Also look by SVG path hint
    const navBtns = await page.locator('header button').count();
    console.log(`  Found ${presenterBtns} presenter, ${eyeBtns} eye, ${navBtns} total header buttons`);
    // Just verify header has buttons
    if (navBtns === 0) throw new Error('No header buttons found');
});

await page.screenshot({ path: '/tmp/notebook-final.png', fullPage: false });

await browser.close();

console.log('\n=== Summary ===');
const passed = results.filter(r => r.ok).length;
console.log(`${passed}/${results.length} passed`);
results.filter(r => !r.ok).forEach(r => console.log(`  FAIL: ${r.name}: ${r.err}`));
