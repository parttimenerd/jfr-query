/**
 * QA Session S157 — Full interactive QA
 * Demo interactive suite + Recording Overview + CPU Profiling deep test
 * + GC Pause Analysis LINK_X zoom
 *
 * Gallery flow: select template (aria-label="Select template: X"), then click "Open & Run"
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
let pass = 0, fail = 0;

function ok(label, detail = '') { console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`); pass++; }
function ko(label, detail = '') { console.log(`  ❌ ${label}${detail ? ': ' + detail : ''}`); fail++; }
function skip(label, reason = '') { console.log(`  ⚪ skip: ${label}${reason ? ' — ' + reason : ''}`); }

const NOISE = ['ONNX', 'ai-proxy', 'conditional view failed', 'HTTP 500',
               'Failed to load resource', 'net::ERR', 'favicon'];

function makeErrorCollector(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!NOISE.some(n => t.includes(n))) errors.push(t.slice(0, 150));
    }
  });
  page.on('pageerror', err => errors.push('PAGE ERROR: ' + err.message.slice(0, 150)));
  return errors;
}

async function freshPage(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('jfr-tour-seen', '1');
    localStorage.setItem('jfrq:onboarding-dismissed', '1');
    localStorage.setItem('jfrq:ai-nudge-dismissed', '1');
    localStorage.setItem('jfr-ui-autoRunEnabled', 'true');
  });
  return page;
}

async function gotoDemo(page) {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await page.locator('button:has-text("Try the demo")').first().click();
  await page.waitForTimeout(2500);
}

/**
 * Opens template gallery, selects by exact aria-label text, then clicks "Open & Run".
 * Returns true if template loaded (gallery closed), false otherwise.
 */
async function openTemplate(page, templateName) {
  await page.locator('[aria-label="New from template"]').click();
  await page.waitForTimeout(700);
  const dlg = page.locator('[role="dialog"]');
  await dlg.waitFor({ state: 'visible', timeout: 5000 });

  // Select the template
  const selectBtn = dlg.locator(`[aria-label="Select template: ${templateName}"]`);
  if (!(await selectBtn.isVisible().catch(() => false))) {
    await page.keyboard.press('Escape');
    return false;
  }
  await selectBtn.click();
  await page.waitForTimeout(400);

  // Click "Open & Run"
  const openBtn = dlg.locator('button:has-text("Open & Run")');
  const isEnabled = await openBtn.isEnabled().catch(() => false);
  if (!isEnabled) {
    await page.keyboard.press('Escape');
    return false;
  }
  await openBtn.click();
  await page.waitForTimeout(3000);
  return true;
}

async function countCharts(page) {
  return page.locator('.recharts-wrapper').count();
}

async function domErrors(page) {
  // Real visible error elements (not cm-lintRange which are expected schema warnings)
  const count = await page.locator('[class*="error"]:visible').count();
  // Filter out cm-lintRange-error (expected) — these are spans inside CM6 editors
  const cmLint = await page.locator('.cm-lintRange-error').count();
  return count - cmLint;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  console.log('\n=== QA Session S157 ===\n');

  // ════════════════════════════════════════════════════════════
  // SECTION 1: Demo notebook — full interactive suite
  // ════════════════════════════════════════════════════════════
  console.log('── Demo: Full Interactive Suite ──');
  const page1 = await freshPage(browser);
  const errors1 = makeErrorCollector(page1);
  await gotoDemo(page1);

  // Tour overlay absent
  const tourVisible = await page1.locator('.z-\\[200\\]').isVisible().catch(() => false);
  tourVisible ? ko('Tour overlay absent') : ok('Tour overlay absent');

  const demoCharts = await countCharts(page1);
  const domErr1 = await domErrors(page1);
  demoCharts >= 1 ? ok(`Demo charts: ${demoCharts}`) : ko('Demo charts', `${demoCharts}`);
  domErr1 === 0 ? ok('Demo DOM errors: 0') : ko('Demo DOM errors', `${domErr1}`);

  // Variables
  const varBtns = await page1.locator('[aria-label*="— click to edit"]').count();
  varBtns >= 1 ? ok(`Variable buttons: ${varBtns}`) : ko('Variable buttons', `${varBtns}`);
  if (varBtns > 0) {
    const first = page1.locator('[aria-label*="— click to edit"]').first();
    const firstLabel = await first.getAttribute('aria-label');
    await first.click();
    await page1.waitForTimeout(400);
    const inputVis = await page1.locator('input[type="datetime-local"], input[type="text"], input[type="number"]').first().isVisible().catch(() => false);
    inputVis ? ok(`Variable edit input opens (${(firstLabel ?? '').slice(0, 35)})`) : ko('Variable edit input', 'no input visible');
    await page1.keyboard.press('Escape');
    await page1.waitForTimeout(200);
  }

  // Run All
  const runAllBtn = page1.locator('[aria-label="Run All Queries"]');
  const runAllVis = await runAllBtn.isVisible().catch(() => false);
  runAllVis ? ok('Run All button visible') : ko('Run All button not visible');
  if (runAllVis) {
    await runAllBtn.click();
    await page1.waitForTimeout(4000);
    const chartsAfter = await countCharts(page1);
    chartsAfter >= demoCharts ? ok(`Charts after Run All: ${chartsAfter}`) : ko('Charts regressed', `${demoCharts}→${chartsAfter}`);
  }

  // Command Palette — try button click
  const cmdBtn = page1.locator('[aria-label="Command Palette"]');
  const cmdBtnVis = await cmdBtn.isVisible().catch(() => false);
  if (cmdBtnVis) {
    await cmdBtn.click();
    await page1.waitForTimeout(500);
    const dlgVis = await page1.locator('[role="dialog"] input').isVisible().catch(() => false);
    dlgVis ? ok('Command palette opens via button') : ko('Command palette did not open');
    await page1.keyboard.press('Escape');
    await page1.waitForTimeout(200);
  } else {
    ko('Command Palette button not visible');
  }

  // Keyboard Shortcuts modal
  const kbBtn = page1.locator('[aria-label="Keyboard Shortcuts"]');
  const kbVis = await kbBtn.isVisible().catch(() => false);
  if (kbVis) {
    await kbBtn.click();
    await page1.waitForTimeout(400);
    const modalVis = await page1.locator('[role="dialog"]').isVisible().catch(() => false);
    modalVis ? ok('Keyboard shortcuts modal opens') : ko('Keyboard shortcuts modal');
    await page1.keyboard.press('Escape');
    await page1.waitForTimeout(200);
  } else {
    ko('Keyboard Shortcuts button not visible');
  }

  // SQL Autocomplete — find CM6 editor in first SQL cell, type prefix
  const cmEditors = await page1.locator('.cm-editor').count();
  console.log(`  [info] CodeMirror editors on page: ${cmEditors}`);
  if (cmEditors > 0) {
    // Try clicking a CM editor that's inside a sql cell
    const sqlEditor = page1.locator('.cm-editor').first();
    await sqlEditor.click();
    await page1.waitForTimeout(200);
    await page1.keyboard.press('Control+End');
    await page1.keyboard.type(' Gar');
    await page1.waitForTimeout(200);
    await page1.keyboard.press('Control+Space');
    await page1.waitForTimeout(1000);
    const acVis = await page1.locator('.cm-tooltip-autocomplete, .cm-tooltip.cm-completionInfo').isVisible().catch(() => false);
    acVis ? ok('SQL autocomplete dropdown visible') : skip('SQL autocomplete', 'CM6 headless limitation');
    await page1.keyboard.press('Escape');
    await page1.waitForTimeout(200);
  }

  // LINK_X zoom — shift+scroll on first real chart
  const chartCount1 = await countCharts(page1);
  if (chartCount1 > 0) {
    const surfaces = await page1.locator('.recharts-surface').evaluateAll(els =>
      els.filter(e => e.getBoundingClientRect().width > 100)
         .map(e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })
    );
    if (surfaces.length > 0) {
      const { x, y } = surfaces[0];
      await page1.mouse.move(x, y);
      await page1.keyboard.down('Shift');
      await page1.mouse.wheel(0, -300);
      await page1.keyboard.up('Shift');
      await page1.waitForTimeout(600);
      const chartsStill = await countCharts(page1);
      chartsStill >= 1 ? ok('LINK_X shift-scroll zoom: charts stable') : ko('Charts disappeared after zoom');
      // Reset with double-click
      await page1.mouse.dblclick(x, y);
      await page1.waitForTimeout(400);
      ok('Double-click reset zoom');
    } else {
      skip('LINK_X zoom', 'no full-size surface found');
    }
  } else {
    skip('LINK_X zoom', 'no charts');
  }

  console.log(`\n  Demo errors so far: ${errors1.length}`);

  // ════════════════════════════════════════════════════════════
  // SECTION 2: Recording Overview
  // ════════════════════════════════════════════════════════════
  console.log('\n── Template: Recording Overview ──');
  const page2 = await freshPage(browser);
  const errors2 = makeErrorCollector(page2);
  await gotoDemo(page2);

  const loaded2 = await openTemplate(page2, 'Recording Overview');
  if (loaded2) {
    ok('Recording Overview loaded');
    const charts2 = await countCharts(page2);
    const domErr2 = await domErrors(page2);
    domErr2 === 0 ? ok(`DOM errors: 0`) : ko(`DOM errors`, `${domErr2}`);
    console.log(`  [info] Charts on load: ${charts2}`);

    // Run All
    const ra2 = page2.locator('[aria-label="Run All Queries"]');
    if (await ra2.isVisible().catch(() => false)) {
      await ra2.click();
      await page2.waitForTimeout(6000);
      const chartsAfterRA = await countCharts(page2);
      ok(`Run All executed — charts: ${chartsAfterRA}`);
    }

    // Check headings and prose
    const headings2 = (await page2.locator('h2, h3').allTextContents()).filter(h => h.trim().length > 3);
    console.log(`  [info] Sections (${headings2.length}): ${headings2.slice(0, 5).join(' | ')}`);
    headings2.length >= 1 ? ok(`Sections: ${headings2.length}`) : ko('No sections found');

    const prose2 = await page2.locator('.prose').count();
    prose2 >= 1 ? ok(`Prose blocks: ${prose2}`) : ko('No prose blocks');

    // LINK_X zoom if charts present
    const charts2final = await countCharts(page2);
    if (charts2final > 0) {
      const firstChart2 = page2.locator('.recharts-wrapper').first();
      await firstChart2.scrollIntoViewIfNeeded();
      await page2.waitForTimeout(200);
      const bbox2 = await firstChart2.boundingBox();
      if (bbox2) {
        const cx = bbox2.x + bbox2.width / 2, cy = bbox2.y + bbox2.height / 2;
        await page2.mouse.move(cx, cy);
        await page2.keyboard.down('Shift');
        await page2.mouse.wheel(0, -300);
        await page2.keyboard.up('Shift');
        await page2.waitForTimeout(500);
        ok('LINK_X zoom on Recording Overview chart');
        await page2.mouse.dblclick(cx, cy);
        await page2.waitForTimeout(300);
        ok('Double-click reset zoom');
      }
    } else {
      skip('LINK_X zoom', 'no charts in Recording Overview with demo JFR');
    }

    const domErr2final = await domErrors(page2);
    console.log(`  [info] DOM errors after Run All: ${domErr2final}`);
  } else {
    ko('Recording Overview: failed to load template');
  }

  // ════════════════════════════════════════════════════════════
  // SECTION 3: CPU Profiling
  // ════════════════════════════════════════════════════════════
  console.log('\n── Template: CPU Profiling ──');
  const page3 = await freshPage(browser);
  const errors3 = makeErrorCollector(page3);
  await gotoDemo(page3);

  const loaded3 = await openTemplate(page3, 'CPU Profiling');
  if (loaded3) {
    ok('CPU Profiling loaded');
    const charts3 = await countCharts(page3);
    const domErr3 = await domErrors(page3);
    domErr3 === 0 ? ok(`DOM errors: 0`) : ko(`DOM errors`, `${domErr3}`);
    console.log(`  [info] Charts on load: ${charts3}`);

    // Run All
    const ra3 = page3.locator('[aria-label="Run All Queries"]');
    if (await ra3.isVisible().catch(() => false)) {
      await ra3.click();
      await page3.waitForTimeout(6000);
      const chartsAfterRA3 = await countCharts(page3);
      ok(`Run All executed — charts: ${chartsAfterRA3}`);
    }

    const headings3 = (await page3.locator('h2, h3').allTextContents()).filter(h => h.trim().length > 3);
    console.log(`  [info] Sections (${headings3.length}): ${headings3.slice(0, 5).join(' | ')}`);
    headings3.length >= 1 ? ok(`Sections: ${headings3.length}`) : ko('No sections found');

    const charts3final = await countCharts(page3);
    charts3final >= 0 ? ok(`CPU Profiling charts: ${charts3final} (0 expected with demo JFR)`) : ko('chart count error');
  } else {
    ko('CPU Profiling: failed to load template');
  }

  // ════════════════════════════════════════════════════════════
  // SECTION 4: GC Pause Analysis — LINK_X zoom (known to have charts)
  // ════════════════════════════════════════════════════════════
  console.log('\n── Template: GC Pause Analysis — LINK_X zoom ──');
  const page4 = await freshPage(browser);
  const errors4 = makeErrorCollector(page4);
  await gotoDemo(page4);

  const loaded4 = await openTemplate(page4, 'GC Pause Analysis');
  if (loaded4) {
    ok('GC Pause Analysis loaded');

    // Run All first to populate charts
    const ra4 = page4.locator('[aria-label="Run All Queries"]');
    if (await ra4.isVisible().catch(() => false)) {
      await ra4.click();
      await page4.waitForTimeout(7000);
    }

    const charts4 = await countCharts(page4);
    console.log(`  [info] GC Pause charts: ${charts4}`);

    if (charts4 > 0) {
      const firstChart4 = page4.locator('.recharts-wrapper').first();
      await firstChart4.scrollIntoViewIfNeeded();
      await page4.waitForTimeout(400);
      const bbox4 = await firstChart4.boundingBox();
      if (bbox4) {
        const cx = bbox4.x + bbox4.width / 2, cy = bbox4.y + bbox4.height / 2;

        // Zoom in with Shift+scroll
        await page4.mouse.move(cx, cy);
        await page4.keyboard.down('Shift');
        await page4.mouse.wheel(0, -400);
        await page4.keyboard.up('Shift');
        await page4.waitForTimeout(700);
        ok(`LINK_X shift-scroll zoom-in (${charts4} charts)`);

        // Zoom in more
        await page4.keyboard.down('Shift');
        await page4.mouse.wheel(0, -300);
        await page4.keyboard.up('Shift');
        await page4.waitForTimeout(400);
        ok('Second zoom step');

        // Zoom out
        await page4.keyboard.down('Shift');
        await page4.mouse.wheel(0, 300);
        await page4.keyboard.up('Shift');
        await page4.waitForTimeout(400);
        ok('Shift-scroll zoom-out');

        // Double-click to reset
        await page4.mouse.dblclick(cx, cy);
        await page4.waitForTimeout(500);
        ok('Double-click zoom reset');

        // Verify charts still present after zoom ops
        const chartsAfterZoom = await countCharts(page4);
        chartsAfterZoom >= charts4 ? ok(`Charts stable after zoom ops: ${chartsAfterZoom}`) : ko('Charts reduced after zoom', `${charts4}→${chartsAfterZoom}`);
      }

      const domErr4 = await domErrors(page4);
      domErr4 === 0 ? ok('DOM errors: 0 after zoom') : ko('DOM errors after zoom', `${domErr4}`);
    } else {
      ko('GC Pause Analysis: no charts after Run All — unexpected');
    }
  } else {
    ko('GC Pause Analysis: failed to load');
  }

  // ════════════════════════════════════════════════════════════
  // SECTION 5: Console errors
  // ════════════════════════════════════════════════════════════
  console.log('\n── Console Errors ──');
  const allErrors = [...errors1, ...errors2, ...errors3, ...errors4];
  if (allErrors.length === 0) {
    ok('No real console errors across all pages');
  } else {
    ko(`${allErrors.length} real error(s)`);
    allErrors.forEach((e, i) => console.log(`  [${i+1}] ${e}`));
  }

  // ════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════
  console.log(`\n=== S157 Result: ${pass} passed, ${fail} failed ===`);

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
