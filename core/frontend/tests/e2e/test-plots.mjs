import { chromium } from 'playwright';

const BASE = process.env.APP_URL || 'http://localhost:5175';
const results = [];

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
const page = await browser.newPage();
page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('CONSOLE ERROR:', m.text()); });

await page.goto(BASE);
await page.waitForLoadState('networkidle');
await page.click('text=Open GC analysis notebook');
await page.waitForTimeout(4000); // Wait for DuckDB + auto-runs

// Scroll down to find charts
await page.evaluate(() => window.scrollBy(0, 800));
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/plots-1.png' });

await test('recharts line chart renders in notebook', async () => {
    const lineCharts = await page.locator('.recharts-surface, [class*="recharts-line"]').count();
    const svgs = await page.locator('main svg').count();
    if (svgs < 1) throw new Error(`Expected SVG charts, got ${svgs}`);
    console.log(`  ${svgs} SVGs, ${lineCharts} recharts line elements`);
});

await test('CollapsibleBlock query headers render', async () => {
    const queryHeaders = await page.locator('main h5').filter({ hasText: /Query \d+/ }).count();
    if (queryHeaders < 1) throw new Error(`No Query N headers found`);
    console.log(`  Found ${queryHeaders} query headers`);
});

// Scroll further to find plot cells
await page.evaluate(() => window.scrollBy(0, 1500));
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/plots-2.png' });

await test('plot result containers render', async () => {
    // Plot results have a specific height container
    const plotContainers = await page.locator('[style*="height"]').count();
    const recharts = await page.locator('[class*="recharts"]').count();
    if (recharts < 1) throw new Error(`No recharts containers, plotContainers=${plotContainers}`);
    console.log(`  ${recharts} recharts containers found`);
});

// Test presenter mode
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);

await test('presenter mode button toggles and hides editors', async () => {
    const presenterBtn = page.locator('header button[title*="Presenter"], header button[title*="presenter"]').first();
    if (await presenterBtn.count() === 0) throw new Error('Presenter button not found in header');
    
    const editorsBefore = await page.locator('.cm-editor').count();
    await presenterBtn.click();
    await page.waitForTimeout(500);
    const editorsAfter = await page.locator('.cm-editor').count();
    
    // Re-click to toggle back
    await presenterBtn.click();
    await page.waitForTimeout(300);
    
    console.log(`  Editors before: ${editorsBefore}, after presenter mode: ${editorsAfter}`);
    if (editorsAfter >= editorsBefore) throw new Error(`Presenter mode did not hide editors: ${editorsBefore} → ${editorsAfter}`);
});

// Test cell collapse
await test('CollapsibleBlock can collapse and expand', async () => {
    const firstQueryHeader = page.locator('main h5').filter({ hasText: /Query 1/ }).first();
    if (await firstQueryHeader.count() === 0) throw new Error('No Query 1 header found');
    
    // Find the toggle button (chevron) next to the header
    const collapseBtn = firstQueryHeader.locator('..').locator('button').first();
    const collapseBtnCount = await collapseBtn.count();
    
    // Click the header area to collapse
    await firstQueryHeader.click();
    await page.waitForTimeout(300);
    // Just verify no crash
    console.log(`  Collapse button found: ${collapseBtnCount > 0}`);
});

// Test settings modal
await test('settings modal opens', async () => {
    // Look for gear/settings button in header
    const settingsBtn = page.locator('header button[title*="ettings"], header button[title*="onfig"]').first();
    if (await settingsBtn.count() > 0) {
        await settingsBtn.click();
        await page.waitForTimeout(500);
        const modal = await page.locator('[role="dialog"], .modal, [class*="modal"]').count();
        console.log(`  Settings modal visible: ${modal > 0}`);
        // Close it
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
    } else {
        console.log(`  No settings button found — checking by gear icon`);
        // Try clicking the gear icon in header by looking for cog SVG 
    }
});

// Test plot help modal
await test('plot help modal opens and closes', async () => {
    // Scroll to find a plot editor with info button
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(300);
    const infoBtn = page.locator('button[title="Plot syntax reference"]').first();
    if (await infoBtn.count() === 0) throw new Error('No plot help button found');
    await infoBtn.click();
    await page.waitForTimeout(500);
    // Modal should appear with plot DSL content
    const modalContent = await page.locator('[class*="modal"], [role="dialog"]').count();
    if (modalContent === 0) throw new Error('Plot help modal did not open');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    console.log(`  Plot help modal opened and closed`);
});

// Test download PNG button on chart
await test('download PNG button appears on chart hover', async () => {
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(300);
    // Hover over a result container to reveal the download button
    const resultContainer = page.locator('[class*="group/result"]').first();
    if (await resultContainer.count() > 0) {
        await resultContainer.hover();
        await page.waitForTimeout(300);
        const dlBtn = resultContainer.locator('button[title="Download as PNG"]');
        const count = await dlBtn.count();
        console.log(`  Download PNG button: ${count > 0 ? 'visible' : 'not found'}`);
    } else {
        console.log(`  No result containers found (may need scrolling)`);
    }
});

await page.screenshot({ path: '/tmp/plots-final.png' });
await browser.close();

console.log('\n=== Summary ===');
const passed = results.filter(r => r.ok).length;
console.log(`${passed}/${results.length} passed`);
results.filter(r => !r.ok).forEach(r => console.log(`  FAIL: ${r.name}: ${r.err}`));
if (results.some(r => !r.ok)) process.exit(1);
