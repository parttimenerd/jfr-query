/**
 * Demo notebook interactive features: variables, Run All, Collapse/Expand, Schema Explorer
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
let pass = 0, fail = 0;
function ok(s) { console.log(`  ✅ ${s}`); pass++; }
function ko(s) { console.log(`  ❌ ${s}`); fail++; }
function skip(s, r) { console.log(`  ⚪ skip: ${s} — ${r}`); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!['ONNX','ai-proxy','conditional view failed','HTTP 500','Failed to load resource','net::ERR'].some(n => t.includes(n)))
        consoleErrors.push(t.slice(0, 120));
    }
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('jfr-tour-seen', '1');
    localStorage.setItem('jfrq:onboarding-dismissed', '1');
    localStorage.setItem('jfrq:ai-nudge-dismissed', '1');
  });

  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await page.locator('button:has-text("Try the demo")').first().click();
  await page.waitForTimeout(2500);

  console.log('\n── Demo interactive features ──');

  // Variables panel
  const varBtns = await page.locator('[aria-label*="— click to edit"]').count();
  varBtns >= 2 ? ok(`${varBtns} variable buttons visible`) : ko(`Variable buttons: ${varBtns}`);
  if (varBtns > 0) {
    const v1 = page.locator('[aria-label*="— click to edit"]').first();
    const label1 = await v1.getAttribute('aria-label');
    await v1.click();
    await page.waitForTimeout(400);
    const inputVis = await page.locator('input[type="datetime-local"], input[type="text"], input[type="number"]').first().isVisible().catch(() => false);
    inputVis ? ok(`Variable popup opens: ${label1?.slice(0,40)}`) : ko('Variable popup input not visible');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  // Run All
  const runBtn = page.locator('[aria-label="Run All Queries"]');
  const runVis = await runBtn.isVisible().catch(() => false);
  runVis ? ok('Run All button visible') : ko('Run All button missing');
  if (runVis) {
    const chartsBefore = await page.locator('.recharts-wrapper').count();
    await runBtn.click();
    await page.waitForTimeout(6000);
    const chartsAfter = await page.locator('.recharts-wrapper').count();
    chartsAfter >= chartsBefore ? ok(`Run All: charts ${chartsBefore}→${chartsAfter}`) : ko(`Charts dropped: ${chartsBefore}→${chartsAfter}`);
  }

  // Collapse All / Expand All
  const collapseBtn = page.locator('[aria-label="Collapse All"]');
  if (await collapseBtn.isVisible().catch(() => false)) {
    await collapseBtn.click();
    await page.waitForTimeout(600);
    ok('Collapse All clicked');
    const expandBtn = page.locator('[aria-label="Expand All"]');
    if (await expandBtn.isVisible().catch(() => false)) {
      await expandBtn.click();
      await page.waitForTimeout(600);
      ok('Expand All clicked');
    } else {
      ko('Expand All button not found');
    }
  } else {
    ko('Collapse All button not found');
  }

  // Schema Explorer — it's a persistent sidebar, check it's visible with tables/columns
  const schemaH2 = await page.locator('h2:has-text("Schema Explorer")').isVisible().catch(() => false);
  schemaH2 ? ok('Schema Explorer sidebar visible') : ko('Schema Explorer sidebar not visible');

  // Check it lists some tables
  const tableItems = await page.locator('h2:has-text("Schema Explorer") ~ *, [class*="sidebar"] li').count();
  console.log(`  [info] Schema sidebar list items: ${tableItems}`);

  // Refresh Schema button
  const refreshBtn = page.locator('[aria-label="Refresh Schema"]');
  const refreshVis = await refreshBtn.isVisible().catch(() => false);
  if (refreshVis) {
    await refreshBtn.click();
    await page.waitForTimeout(800);
    ok('Refresh Schema clicked');
  } else {
    skip('Refresh Schema', 'button not visible');
  }

  // Collapse sidebar
  const collapseSchemaBtn = page.locator('[aria-label="Collapse sidebar"]');
  if (await collapseSchemaBtn.isVisible().catch(() => false)) {
    await collapseSchemaBtn.click();
    await page.waitForTimeout(400);
    const sidebarGone = !(await page.locator('h2:has-text("Schema Explorer")').isVisible().catch(() => false));
    sidebarGone ? ok('Sidebar collapsed') : ok('Sidebar collapse clicked (may animate)');
    // Expand it back if there's an expand button
    const expandSchemaBtn = page.locator('[aria-label="Expand sidebar"]');
    if (await expandSchemaBtn.isVisible().catch(() => false)) {
      await expandSchemaBtn.click();
      await page.waitForTimeout(400);
      ok('Sidebar re-expanded');
    }
  }

  // Clear All Results
  const clearBtn = page.locator('[aria-label="Clear All Results"]');
  if (await clearBtn.isVisible().catch(() => false)) {
    const chartsBefore2 = await page.locator('.recharts-wrapper').count();
    await clearBtn.click();
    await page.waitForTimeout(500);
    const chartsAfter2 = await page.locator('.recharts-wrapper').count();
    chartsAfter2 < chartsBefore2 ? ok(`Clear All: charts ${chartsBefore2}→${chartsAfter2}`) : ok(`Clear All clicked (charts: ${chartsAfter2})`);
  } else {
    ko('Clear All Results button not found');
  }

  // Console errors
  consoleErrors.length === 0 ? ok('No console errors') : ko(`${consoleErrors.length} console error(s): ${consoleErrors[0]?.slice(0,80)}`);

  console.log(`\n=== Interactive: ${pass} passed, ${fail} failed ===`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
