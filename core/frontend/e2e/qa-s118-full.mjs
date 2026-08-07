/**
 * S118 full QA: demo + Heap Allocation + I/O & Latency + interactive features
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

  // ── 1. DEMO NOTEBOOK ──────────────────────
  console.log('\n══ 1. DEMO NOTEBOOK ══');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  const skip = await page.$('button:has-text("Skip")');
  if (skip) await skip.click().catch(() => {});
  await page.waitForTimeout(200);
  const demo = await page.$('button:has-text("Try the demo")');
  if (!demo) { console.error('No demo button'); process.exit(1); }
  await demo.click();
  await page.waitForTimeout(3500);
  await waitForIdle(page, 30000);

  let errors = await domScan(page);
  if (errors.length === 0) pass('Demo: DOM scan — 0 errors');
  else fail('Demo DOM scan', errors.join(' | '));

  const cellCount = await page.evaluate(() => document.querySelectorAll('[data-cell-status]').length);
  const svgCount  = await page.evaluate(() => document.querySelectorAll('svg').length);
  pass(`Demo: ${cellCount} cells, ${svgCount} SVGs`);

  await scrollFull(page);
  errors = await domScan(page);
  if (errors.length === 0) pass('Demo: scroll DOM scan — 0 errors');
  else fail('Demo scroll DOM', errors.join(' | '));

  // ── 2. INTERACTIVE FEATURES ──────────────
  console.log('\n══ 2. INTERACTIVE FEATURES ══');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  // Variables panel
  const varBtn = await page.$('[data-testid="variables-pill"]')
               || await page.$('button[aria-label*="variable" i]');
  if (varBtn) {
    await varBtn.click();
    await page.waitForTimeout(400);
    const inp = await page.$('input[type="text"], input[type="number"]');
    if (inp) {
      await inp.click({ clickCount: 3 });
      await inp.type('50');
      await inp.press('Enter');
      await page.waitForTimeout(800);
      pass('Variables panel: opened, value changed');
    } else {
      warn('Variables panel', 'opened but no input found');
    }
  } else {
    warn('Variables panel', 'no pill found');
  }

  // Run All
  const runAllBtn = await page.$('[aria-label="Run All Queries"]');
  if (runAllBtn) {
    await runAllBtn.click();
    await page.waitForTimeout(1000);
    await waitForIdle(page, 40000);
    errors = await domScan(page);
    if (errors.length === 0) pass('Run All: 0 DOM errors after re-run');
    else fail('Run All DOM', errors.join(' | '));
  } else {
    warn('Run All', 'button not found');
  }

  // Command palette
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
    warn('Command palette', 'no input after Cmd+K');
    await page.keyboard.press('Escape').catch(() => {});
  }

  // SQL autocomplete — fresh cell
  const addBtn = await page.$('[title="Add SQL cell"]');
  let testCellAdded = false;
  if (addBtn) { await addBtn.click(); await page.waitForTimeout(400); testCellAdded = true; }
  const editors = await page.$$('.cm-editor .cm-content');
  const testEd = editors[editors.length - 1];
  if (testEd) {
    await testEd.click();
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
      pass(`SQL autocomplete: completions shown: ${items.slice(0, 3).join(', ')}`);
    } else {
      warn('SQL autocomplete', 'no popup after Ctrl+Space');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    if (testCellAdded) {
      const delBtns = await page.$$('[aria-label="Delete Cell"], [title="Delete Cell"]');
      const last = delBtns[delBtns.length - 1];
      if (last) { await last.click(); await page.waitForTimeout(200); }
    }
  } else {
    warn('SQL autocomplete', 'no editor found');
  }

  // Schema explorer
  const sidebarBtns = await page.$$('button[title="Click to preview · Double-click to copy name"]');
  let tableBtn = null;
  for (const b of sidebarBtns) {
    const txt = await b.evaluate(el => el.textContent?.trim() || '');
    if (txt.startsWith('GarbageCollection')) { tableBtn = b; break; }
  }
  if (!tableBtn && sidebarBtns.length > 0) {
    for (const b of sidebarBtns) {
      const txt = await b.evaluate(el => el.textContent?.trim() || '');
      if (/^[A-Z]/.test(txt) && !/^P\d/.test(txt)) { tableBtn = b; break; }
    }
  }
  if (tableBtn) {
    const tname = await tableBtn.evaluate(b => b.textContent?.trim().replace(/\d+$/, '') || '');
    await tableBtn.click();
    await page.waitForTimeout(500);
    const preview = await page.$('[data-testid="preview-editor"]');
    if (preview) {
      const sql = await preview.evaluate(el => el.textContent?.trim().slice(0, 60));
      pass(`Schema explorer: "${tname}" preview: ${sql}`);
    } else {
      warn('Schema explorer', 'no preview after click');
    }
  } else {
    warn('Schema explorer', 'no sidebar items found');
  }

  // Help modal
  const helpBtn = await page.$('[aria-label="Keyboard Shortcuts"]') || await page.$('[title*="Keyboard Shortcuts"]');
  if (helpBtn) {
    await helpBtn.click();
    await page.waitForTimeout(500);
    const dialog = await page.$('[role="dialog"]');
    const hasContent = dialog && await dialog.$('table, kbd, [class*="shortcut"]');
    if (hasContent) pass('Help modal: opened, shortcut content visible');
    else warn('Help modal', 'opened but no shortcut table');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  } else {
    warn('Help modal', 'button not found');
  }

  // LINK_X zoom — load GC Pause Analysis inline to get a real LINK_X chart
  console.log('\n  Testing LINK_X on GC Pause Analysis...');
  const gcOk = await loadTemplate(page, 'GC Pause Analysis');
  if (gcOk) {
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
        const resetBtn = await page.$('button:has-text("Reset")') || await page.$('button[aria-label*="Reset" i]');
        if (resetBtn) pass('LINK_X zoom: Shift+scroll activated (Reset appeared)');
        else warn('LINK_X zoom', 'no Reset button (chart may have no LINK_X or no data)');
      }
    } else {
      warn('LINK_X zoom', 'no recharts surface in GC Pause Analysis');
    }
    errors = await domScan(page);
    if (errors.length === 0) pass('GC Pause Analysis: 0 DOM errors');
    else fail('GC Pause Analysis DOM', errors.join(' | '));
  } else {
    warn('LINK_X zoom', 'GC Pause Analysis did not load');
  }

  // ── 3. HEAP ALLOCATION ───────────────────
  console.log('\n══ 3. HEAP ALLOCATION ══');
  const haOk = await loadTemplate(page, 'Heap Allocation');
  if (haOk) {
    const cells = await page.evaluate(() => document.querySelectorAll('[data-cell-status]').length);
    const svgs  = await page.evaluate(() => document.querySelectorAll('svg').length);
    errors = await domScan(page);
    if (errors.length === 0) pass(`Heap Allocation: ${cells} cells, ${svgs} SVGs, 0 DOM errors`);
    else fail('Heap Allocation', errors.join(' | '));
    await scrollFull(page);
    errors = await domScan(page);
    if (errors.length === 0) pass('Heap Allocation: scroll DOM scan — 0 errors');
    else fail('Heap Allocation scroll', errors.join(' | '));
  } else {
    fail('Heap Allocation', 'did not become idle');
  }

  // ── 4. I/O & LATENCY ─────────────────────
  console.log('\n══ 4. I/O & LATENCY ══');
  const ioOk = await loadTemplate(page, 'I/O & Latency');
  if (ioOk) {
    const cells = await page.evaluate(() => document.querySelectorAll('[data-cell-status]').length);
    const svgs  = await page.evaluate(() => document.querySelectorAll('svg').length);
    errors = await domScan(page);
    if (errors.length === 0) pass(`I/O & Latency: ${cells} cells, ${svgs} SVGs, 0 DOM errors`);
    else fail('I/O & Latency', errors.join(' | '));
    await scrollFull(page);
    errors = await domScan(page);
    if (errors.length === 0) pass('I/O & Latency: scroll DOM scan — 0 errors');
    else fail('I/O & Latency scroll', errors.join(' | '));
  } else {
    fail('I/O & Latency', 'did not become idle');
  }

  // ── 5. UI POLISH ─────────────────────────
  console.log('\n══ 5. UI POLISH ══');
  const overflow = await page.evaluate(() => {
    const issues = [];
    document.querySelectorAll('p, h1, h2, h3, td, th, [class*="title"], [class*="label"]').forEach(el => {
      if (el.scrollWidth > el.clientWidth + 4 && el.offsetParent !== null)
        issues.push(el.textContent?.trim().slice(0, 60));
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
  else warn('UI zero-height', `${zeroH} cells`);

  // ── 6. CONSOLE ───────────────────────────
  console.log('\n══ 6. CONSOLE ══');
  if (consoleErrs.length === 0) pass('Console: 0 real errors');
  else consoleErrs.forEach(e => fail('Console error', e));

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
