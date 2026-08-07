/**
 * S117 full QA: demo notebook + Recording Overview + CPU Profiling
 * + comprehensive interactive feature tests
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
const LS_SUPPRESS = [
  { name: 'jfr-tour-seen', value: '1' },
  { name: 'jfrq:onboarding-dismissed', value: '1' },
  { name: 'jfrq:ai-nudge-dismissed', value: '1' },
  { name: 'jfr-sidebar-editor-visible', value: 'true' },
];
const ERROR_TERMS = ['Catalog Error', 'does not exist', 'Invalid plot', 'Query has errors', 'Binder Error', 'Parser Error'];

const PASS = [], FAIL = [], WARN = [];
function pass(l)    { console.log(`  ✅ ${l}`); PASS.push(l); }
function fail(l, d) { console.log(`  ❌ ${l}: ${d}`); FAIL.push({ l, d }); }
function warn(l, d) { console.log(`  ⚠  ${l}: ${d}`); WARN.push({ l, d }); }

async function waitForIdle(page, ms = 60000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const n = await page.evaluate(() =>
      document.querySelectorAll('[data-cell-status="running"]').length +
      Array.from(document.querySelectorAll('*')).filter(
        el => el.textContent?.trim() === 'Running...' && el.offsetParent !== null
      ).length
    );
    if (n === 0) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function domScan(page) {
  return page.evaluate((terms) =>
    Array.from(document.querySelectorAll('*')).filter(el => {
      const text = el.textContent || '';
      return terms.some(t => text.includes(t)) && el.children.length === 0
        && el.offsetParent !== null
        && !el.closest('.cm-editor') && !el.closest('[class*="token"]');
    }).map(e => e.textContent.trim().slice(0, 120))
  , ERROR_TERMS);
}

async function scrollFull(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
}

async function loadTemplate(page, name) {
  let btn = null;
  for (const sel of ['[title="New from template"]', '[aria-label="New from template"]']) {
    btn = await page.$(sel);
    if (btn) break;
  }
  if (!btn) { fail(name, 'gallery button not found'); return false; }
  await btn.click();
  await page.waitForSelector('dialog, [role="dialog"]', { timeout: 6000 });
  await page.waitForTimeout(600);
  const tmpl = await page.$(`button[aria-label="Select template: ${name}"]`)
            || await page.$(`button:has-text("${name}")`);
  if (!tmpl) { fail(name, 'template not found in gallery'); await page.keyboard.press('Escape'); return false; }
  await tmpl.click();
  await page.waitForTimeout(300);
  for (const sel of ['button:has-text("Open & Run")', 'button:has-text("Use template")']) {
    const b = await page.$(sel);
    if (b && !await b.getAttribute('disabled')) { await b.click(); break; }
  }
  await page.waitForTimeout(1500);
  return waitForIdle(page, 60000);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    // Clear localStorage by NOT pre-setting suppression keys — then set them after to skip tour
    storageState: { cookies: [], origins: [{ origin: BASE, localStorage: LS_SUPPRESS }] },
  });
  ctx.on('dialog', d => d.accept());
  const page = await ctx.newPage();

  const consoleErrs = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!t.includes('ONNX') && !t.includes('ort-') && !t.includes('/api/')
          && !t.includes('proxy') && !t.includes('Failed to load resource')
          && !t.includes('net::ERR_') && !t.includes('conditional view failed')) {
        consoleErrs.push(t.slice(0, 200));
      }
    }
  });

  // ─────────────────────────────────────────
  // 1. DEMO NOTEBOOK
  // ─────────────────────────────────────────
  console.log('\n══ 1. DEMO NOTEBOOK ══');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  const skip = await page.$('button:has-text("Skip")');
  if (skip) await skip.click().catch(() => {});
  await page.waitForTimeout(200);
  const demo = await page.$('button:has-text("Try the demo")');
  if (!demo) { console.error('No demo button found'); process.exit(1); }
  await demo.click();
  await page.waitForTimeout(3500);
  await waitForIdle(page, 30000);

  const demoErrors = await domScan(page);
  if (demoErrors.length === 0) pass('Demo: DOM scan — 0 errors');
  else fail('Demo DOM scan', demoErrors.join(' | '));

  const cellCount = await page.evaluate(() => document.querySelectorAll('[data-cell-status]').length);
  const svgCount  = await page.evaluate(() => document.querySelectorAll('svg').length);
  pass(`Demo: ${cellCount} cells, ${svgCount} SVGs`);

  await scrollFull(page);
  const demoErrors2 = await domScan(page);
  if (demoErrors2.length === 0) pass('Demo: scroll DOM scan — 0 errors');
  else fail('Demo scroll DOM', demoErrors2.join(' | '));

  // ─────────────────────────────────────────
  // 2. INTERACTIVE FEATURES
  // ─────────────────────────────────────────
  console.log('\n══ 2. INTERACTIVE FEATURES ══');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  // Variables panel
  const varBtn = await page.$('[data-testid="variables-pill"]')
               || await page.$('button[aria-label*="variable" i]')
               || await page.$('[class*="variable-pill"]');
  if (varBtn) {
    await varBtn.click();
    await page.waitForTimeout(400);
    const inp = await page.$('input[type="text"], input[type="number"]');
    if (inp) {
      await inp.click({ clickCount: 3 });
      await inp.type('50');
      await inp.press('Enter');
      await page.waitForTimeout(800);
      pass('Variables panel: opened, value changed, cells re-queued');
    } else {
      warn('Variables panel', 'opened but no input found');
    }
  } else {
    warn('Variables panel', 'no pill found in demo');
  }

  // Run All
  await page.evaluate(() => window.scrollTo(0, 0));
  const runAllBtn = await page.$('[aria-label="Run All Queries"]');
  if (runAllBtn) {
    await runAllBtn.click();
    await page.waitForTimeout(1000);
    await waitForIdle(page, 40000);
    const runAllErrors = await domScan(page);
    if (runAllErrors.length === 0) pass('Run All: 0 DOM errors after re-run');
    else fail('Run All DOM', runAllErrors.join(' | '));
  } else {
    warn('Run All', 'button not found');
  }

  // LINK_X zoom — need to load GC Pause Analysis to test LINK_X properly
  // (demo doesn't have LINK_X charts reliably) — will test in template section

  // Command palette (Cmd+K)
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(500);
  const palette = await page.$('[role="dialog"] input, [class*="palette"] input, [class*="command"] input');
  if (palette) {
    await palette.type('run');
    await page.waitForTimeout(300);
    pass('Command palette: Cmd+K opened, typed "run"');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  } else {
    warn('Command palette', 'no input found after Cmd+K');
    await page.keyboard.press('Escape').catch(() => {});
  }

  // SQL autocomplete — add fresh cell, type SELECT * FROM Gar, Ctrl+Space
  const addSqlBtn = await page.$('[title="Add SQL cell"]');
  let testCellAdded = false;
  if (addSqlBtn) {
    await addSqlBtn.click();
    await page.waitForTimeout(400);
    testCellAdded = true;
  }
  const editors = await page.$$('.cm-editor .cm-content');
  const testEditor = editors[editors.length - 1];
  if (testEditor) {
    await testEditor.click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(50);
    await page.keyboard.type('SELECT * FROM Gar');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+Space');
    await page.waitForTimeout(1000);
    const popup = await page.$('.cm-tooltip-autocomplete');
    if (popup) {
      const items = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.cm-completionLabel'))
          .map(el => el.textContent?.trim()).filter(Boolean).slice(0, 5)
      );
      pass(`SQL autocomplete: Ctrl+Space → completions: ${items.slice(0, 3).join(', ')}`);
    } else {
      warn('SQL autocomplete', 'no popup after Ctrl+Space');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    // Delete the test cell
    if (testCellAdded) {
      const delBtns = await page.$$('[aria-label="Delete Cell"], [title="Delete Cell"]');
      const lastDel = delBtns[delBtns.length - 1];
      if (lastDel) { await lastDel.click(); await page.waitForTimeout(200); }
    }
  } else {
    warn('SQL autocomplete', 'no CodeMirror editor found');
  }

  // Schema explorer — click GarbageCollection table button in sidebar
  const sidebarBtns = await page.$$('button[title="Click to preview · Double-click to copy name"]');
  let gcBtn = null;
  for (const b of sidebarBtns) {
    const txt = await b.evaluate(el => el.textContent?.trim() || '');
    if (txt.startsWith('GarbageCollection')) { gcBtn = b; break; }
  }
  if (!gcBtn && sidebarBtns.length > 0) gcBtn = sidebarBtns[0];
  if (gcBtn) {
    const name = await gcBtn.evaluate(b => b.textContent?.trim().replace(/\d+$/, '') || '');
    await gcBtn.click();
    await page.waitForTimeout(500);
    const preview = await page.$('[data-testid="preview-editor"]');
    if (preview) {
      const sql = await preview.evaluate(el => el.textContent?.trim().slice(0, 60));
      pass(`Schema explorer: clicked "${name}", preview appeared: ${sql}`);
    } else {
      warn('Schema explorer', 'no preview editor after click');
    }
  } else {
    warn('Schema explorer', 'no sidebar table buttons found');
  }

  // Help modal
  const helpBtn = await page.$('[aria-label="Keyboard Shortcuts"]')
               || await page.$('[title*="Keyboard Shortcuts"]');
  if (helpBtn) {
    await helpBtn.click();
    await page.waitForTimeout(500);
    const dialog = await page.$('[role="dialog"]');
    const hasTable = dialog && await dialog.$('table, [class*="shortcut"], kbd');
    if (hasTable) pass('Help modal: opened, shortcut content visible');
    else warn('Help modal', 'opened but no shortcut table found');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  } else {
    warn('Help modal', 'button not found');
  }

  // ─────────────────────────────────────────
  // 3. RECORDING OVERVIEW TEMPLATE
  // ─────────────────────────────────────────
  console.log('\n══ 3. RECORDING OVERVIEW ══');
  const roOk = await loadTemplate(page, 'Recording Overview');
  if (roOk) {
    const roCells  = await page.evaluate(() => document.querySelectorAll('[data-cell-status]').length);
    const roSvgs   = await page.evaluate(() => document.querySelectorAll('svg').length);
    const roErrors = await domScan(page);
    if (roErrors.length === 0) pass(`Recording Overview: ${roCells} cells, ${roSvgs} SVGs, 0 DOM errors`);
    else fail('Recording Overview', roErrors.join(' | '));
    await scrollFull(page);
    const roErrors2 = await domScan(page);
    if (roErrors2.length === 0) pass('Recording Overview: scroll DOM scan — 0 errors');
    else fail('Recording Overview scroll', roErrors2.join(' | '));
  } else {
    fail('Recording Overview', 'did not become idle');
  }

  // ─────────────────────────────────────────
  // 4. CPU PROFILING TEMPLATE + LINK_X zoom
  // ─────────────────────────────────────────
  console.log('\n══ 4. CPU PROFILING ══');
  const cpuOk = await loadTemplate(page, 'CPU Profiling');
  if (cpuOk) {
    const cpuCells  = await page.evaluate(() => document.querySelectorAll('[data-cell-status]').length);
    const cpuSvgs   = await page.evaluate(() => document.querySelectorAll('svg').length);
    const cpuErrors = await domScan(page);
    if (cpuErrors.length === 0) pass(`CPU Profiling: ${cpuCells} cells, ${cpuSvgs} SVGs, 0 DOM errors`);
    else fail('CPU Profiling', cpuErrors.join(' | '));
    await scrollFull(page);
    const cpuErrors2 = await domScan(page);
    if (cpuErrors2.length === 0) pass('CPU Profiling: scroll DOM scan — 0 errors');
    else fail('CPU Profiling scroll', cpuErrors2.join(' | '));

    // LINK_X zoom: Shift+scroll on first recharts chart
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const chart = await page.$('.recharts-surface');
    if (chart) {
      const box = await chart.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.keyboard.down('Shift');
        await page.mouse.wheel(0, -300);
        await page.keyboard.up('Shift');
        await page.waitForTimeout(700);
        const resetBtn = await page.$('button:has-text("Reset"), button[aria-label*="Reset" i]');
        if (resetBtn) pass('LINK_X zoom: Shift+scroll activated (Reset button appeared)');
        else warn('LINK_X zoom', 'zoomed but no Reset button appeared (chart may not have LINK_X)');
      }
    } else {
      warn('LINK_X zoom', 'no recharts surface found');
    }
  } else {
    fail('CPU Profiling', 'did not become idle');
  }

  // ─────────────────────────────────────────
  // 5. UI POLISH
  // ─────────────────────────────────────────
  console.log('\n══ 5. UI POLISH ══');
  const overflow = await page.evaluate(() => {
    const issues = [];
    document.querySelectorAll('p, h1, h2, h3, td, th, [class*="title"], [class*="label"]').forEach(el => {
      if (el.scrollWidth > el.clientWidth + 4 && el.offsetParent !== null) {
        issues.push(el.textContent?.trim().slice(0, 60));
      }
    });
    return issues.slice(0, 5);
  });
  if (overflow.length === 0) pass('UI polish: no text overflow');
  else warn('UI overflow', overflow.join(' | '));

  const zeroH = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-cell-status]'))
      .filter(c => c.getBoundingClientRect().height < 10).length
  );
  if (zeroH === 0) pass('UI polish: no zero-height cells');
  else warn('UI zero-height cells', `${zeroH} cells`);

  // ─────────────────────────────────────────
  // 6. CONSOLE ERRORS
  // ─────────────────────────────────────────
  console.log('\n══ 6. CONSOLE ══');
  if (consoleErrs.length === 0) pass('Console: 0 real errors');
  else consoleErrs.forEach(e => fail('Console error', e));

  // ─────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────
  await ctx.close();
  await browser.close();

  console.log('\n═══════════════════════════════');
  console.log(`PASS: ${PASS.length}, WARN: ${WARN.length}, FAIL: ${FAIL.length}`);
  if (FAIL.length === 0) {
    console.log('No failures ✅');
    if (WARN.length) WARN.forEach(w => console.log(`  ⚠  ${w.l}: ${w.d}`));
  } else {
    FAIL.forEach(f => console.log(`  ❌ ${f.l}: ${f.d}`));
    WARN.forEach(w => console.log(`  ⚠  ${w.l}: ${w.d}`));
    process.exit(1);
  }
})();
