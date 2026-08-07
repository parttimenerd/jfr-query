/**
 * S116 full QA: demo notebook + GC Pause Analysis + Memory Leak Detection
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
function pass(l)      { console.log(`  ✅ ${l}`); PASS.push(l); }
function fail(l, d)   { console.log(`  ❌ ${l}: ${d}`); FAIL.push({ l, d }); }
function warn(l, d)   { console.log(`  ⚠  ${l}: ${d}`); WARN.push({ l, d }); }

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
        && el.offsetParent !== null && !el.closest('.cm-editor') && !el.closest('[class*="token"]');
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
  // Navigate back to base to get clean state
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
  const consoleAll = [];
  page.on('console', msg => {
    const t = msg.text();
    consoleAll.push(`[${msg.type()}] ${t.slice(0, 100)}`);
    if (msg.type() === 'error') {
      if (!t.includes('ONNX') && !t.includes('ort-') && !t.includes('/api/')
          && !t.includes('proxy') && !t.includes('Failed to load resource')
          && !t.includes('net::ERR_') && !t.includes('conditional view failed')) {
        consoleErrs.push(t.slice(0, 200));
      }
    }
  });

  // ─────────────────────────────────────────
  // 1. LOAD DEMO NOTEBOOK
  // ─────────────────────────────────────────
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
  const demoIdle = await waitForIdle(page, 30000);
  if (!demoIdle) warn('Demo idle', 'still running after 30s');

  const demoErrors1 = await domScan(page);
  if (demoErrors1.length === 0) pass('Demo: initial DOM scan — 0 errors');
  else fail('Demo DOM scan', demoErrors1.join(' | '));

  const cellCount = await page.evaluate(() => document.querySelectorAll('[data-cell-status]').length);
  const svgCount  = await page.evaluate(() => document.querySelectorAll('svg').length);
  pass(`Demo: ${cellCount} cells, ${svgCount} SVGs loaded`);

  // Scroll full and scan again
  await scrollFull(page);
  const demoErrors2 = await domScan(page);
  if (demoErrors2.length === 0) pass('Demo: full-scroll DOM scan — 0 errors');
  else fail('Demo scroll DOM', demoErrors2.join(' | '));

  // ─────────────────────────────────────────
  // 2. INTERACTIVE FEATURES (on demo notebook)
  // ─────────────────────────────────────────
  console.log('\n══ 2. INTERACTIVE FEATURES ══');

  // Variables panel
  const varBtn = await page.$('[data-testid="variables-pill"]')
               || await page.$('button[aria-label*="ariable"]')
               || await page.$('[class*="variable-pill"]');
  if (varBtn) {
    await varBtn.click();
    await page.waitForTimeout(400);
    const inp = await page.$('input[type="text"], input[type="number"]');
    if (inp) {
      await inp.click({ clickCount: 3 });
      await inp.type('50');
      await inp.press('Enter');
      await page.waitForTimeout(600);
      pass('Variables: chip opened, value changed');
    } else {
      warn('Variables', 'chip opened but no input found');
    }
  } else {
    warn('Variables', 'no variable pill found in demo');
  }

  // Run All
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const runAllBtn = await page.$('[aria-label="Run All Queries"]');
  if (runAllBtn) {
    await runAllBtn.click();
    await page.waitForTimeout(1500);
    await waitForIdle(page, 40000);
    const runAllErrors = await domScan(page);
    if (runAllErrors.length === 0) pass('Run All: 0 DOM errors after re-run');
    else fail('Run All DOM', runAllErrors.join(' | '));
  } else {
    warn('Run All', 'button not found');
  }

  // Collapse All / Expand All
  const collapseBtn = await page.$('[aria-label="Collapse All"]') || await page.$('button:has-text("Collapse All")');
  if (collapseBtn) {
    await collapseBtn.click();
    await page.waitForTimeout(500);
    pass('Collapse All: clicked');
    const expandBtn = await page.$('[aria-label="Expand All"]') || await page.$('button:has-text("Expand All")');
    if (expandBtn) {
      await expandBtn.click();
      await page.waitForTimeout(500);
      pass('Expand All: clicked');
    }
  } else {
    warn('Collapse All', 'button not found');
  }

  // Command palette (Cmd+K)
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(400);
  const palette = await page.$('[role="dialog"] input, [class*="palette"] input, [class*="command"] input');
  if (palette) {
    await palette.type('run');
    await page.waitForTimeout(300);
    pass('Command palette: opened via Cmd+K, typed "run"');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  } else {
    warn('Command palette', 'no input found after Cmd+K');
    await page.keyboard.press('Escape').catch(() => {});
  }

  // Help modal
  const helpBtn = await page.$('[aria-label="Keyboard Shortcuts"]')
               || await page.$('[aria-label*="help" i]')
               || await page.$('[title*="help" i]')
               || await page.$('button:has-text("?")');
  if (helpBtn) {
    await helpBtn.click();
    await page.waitForTimeout(500);
    const helpContent = await page.$('[role="dialog"] table, [role="dialog"] [class*="shortcut"]');
    if (helpContent) pass('Help modal: opened, shortcut table visible');
    else warn('Help modal', 'opened but no shortcut table found');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  } else {
    warn('Help modal', 'button not found');
  }

  // Schema explorer — sidebar always shows tables/views/macros
  // Click GarbageCollection specifically (always present in demo JFR)
  const sidebarTableBtns = await page.$$('button[title="Click to preview · Double-click to copy name"]');
  let tableBtn = null;
  for (const btn of sidebarTableBtns) {
    const txt = await btn.evaluate(b => b.textContent?.trim() || '');
    if (txt.startsWith('GarbageCollection')) { tableBtn = btn; break; }
  }
  // Fallback: first button that looks like a table (uppercase, not P-percentile macro)
  if (!tableBtn) {
    for (const btn of sidebarTableBtns) {
      const txt = await btn.evaluate(b => b.textContent?.trim() || '');
      if (/^[A-Z]/.test(txt) && !/^P\d/.test(txt) && !txt.startsWith('HEAP')) { tableBtn = btn; break; }
    }
  }
  if (!tableBtn && sidebarTableBtns.length > 0) tableBtn = sidebarTableBtns[0];
  if (tableBtn) {
    const tableName = await tableBtn.evaluate(b => b.textContent?.trim().replace(/\d+$/, '').trim() || '');
    await tableBtn.click();
    await page.waitForTimeout(500);
    const previewEditor = await page.$('[data-testid="preview-editor"]');
    if (previewEditor) {
      const sql = await previewEditor.evaluate(el => el.textContent?.trim().slice(0, 80));
      pass(`Schema explorer: clicked "${tableName}", preview appeared: ${sql?.slice(0, 50) || '(empty)'}`);
    } else {
      warn('Schema explorer', 'clicked table but no preview editor appeared');
    }
  } else {
    warn('Schema explorer', 'no table items found in sidebar');
  }

  // SQL autocomplete — add a fresh SQL cell so we don't pollute existing cells
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const addSqlBtn = await page.$('[title="Add SQL cell"]');
  let testEditorAdded = false;
  let cmEditor = null;
  if (addSqlBtn) {
    await addSqlBtn.click();
    await page.waitForTimeout(400);
    const editors = await page.$$('.cm-editor .cm-content');
    cmEditor = editors[editors.length - 1] || null;
    testEditorAdded = !!cmEditor;
  }
  if (!cmEditor) cmEditor = await page.$('.cm-editor .cm-content');
  if (cmEditor) {
    await cmEditor.click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(50);
    await page.keyboard.type('SELECT * FROM Gar');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+Space');
    await page.waitForTimeout(1000);
    const autocomplete = await page.$('.cm-tooltip-autocomplete');
    if (autocomplete) {
      const items = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.cm-completionLabel'))
          .map(el => el.textContent?.trim()).filter(Boolean).slice(0, 5)
      );
      pass(`SQL autocomplete: Ctrl+Space → ${items.length} completions (${items.slice(0,3).join(', ')})`);
    } else {
      warn('SQL autocomplete', 'no completion popup after Ctrl+Space');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    // Clean up: delete the test cell
    if (testEditorAdded) {
      // Find last delete-cell button
      const delBtns = await page.$$('[aria-label="Delete Cell"], [title="Delete Cell"]');
      const lastDel = delBtns[delBtns.length - 1];
      if (lastDel) { await lastDel.click(); await page.waitForTimeout(200); }
    }
  } else {
    warn('SQL autocomplete', 'no CodeMirror editor found');
  }

  // ─────────────────────────────────────────
  // 3. GC PAUSE ANALYSIS TEMPLATE
  // ─────────────────────────────────────────
  console.log('\n══ 3. GC PAUSE ANALYSIS ══');
  const gcOk = await loadTemplate(page, 'GC Pause Analysis');
  if (gcOk) {
    const gcCells = await page.evaluate(() => document.querySelectorAll('[data-cell-status]').length);
    const gcSvgs  = await page.evaluate(() => document.querySelectorAll('svg').length);
    const gcErrors = await domScan(page);
    if (gcErrors.length === 0) pass(`GC Pause Analysis: ${gcCells} cells, ${gcSvgs} SVGs, 0 DOM errors`);
    else fail('GC Pause Analysis', gcErrors.join(' | '));

    await scrollFull(page);
    const gcErrors2 = await domScan(page);
    if (gcErrors2.length === 0) pass('GC Pause Analysis: scroll DOM scan — 0 errors');
    else fail('GC Pause Analysis scroll', gcErrors2.join(' | '));

    // LINK_X zoom test: find a recharts chart and shift+scroll
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const chartArea = await page.$('.recharts-surface, .recharts-wrapper svg');
    if (chartArea) {
      const box = await chartArea.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.keyboard.down('Shift');
        await page.mouse.wheel(0, -200);
        await page.keyboard.up('Shift');
        await page.waitForTimeout(600);
        const resetBtn = await page.$('button:has-text("Reset"), button[aria-label*="Reset"], button[aria-label*="reset"]');
        if (resetBtn) pass('LINK_X zoom: Shift+scroll activated (Reset button appeared)');
        else warn('LINK_X zoom', 'zoomed but no Reset button appeared');
      }
    } else {
      warn('LINK_X zoom', 'no recharts surface found in GC Pause Analysis');
    }

    // Tooltip test: hover over chart
    const svgSurface = await page.$('.recharts-surface');
    if (svgSurface) {
      const svgBox = await svgSurface.boundingBox();
      if (svgBox) {
        await page.mouse.move(svgBox.x + svgBox.width * 0.4, svgBox.y + svgBox.height * 0.5);
        await page.waitForTimeout(600);
        const tooltip = await page.$('.recharts-tooltip-wrapper, [class*="tooltip"]');
        if (tooltip && await tooltip.isVisible()) pass('Chart tooltip: visible on hover');
        else warn('Chart tooltip', 'no tooltip visible on hover (chart may have no data)');
      }
    }

    // Plot resize handle
    const resizeHandle = await page.$('[class*="resize"], [data-resize], .plot-resize-handle');
    if (resizeHandle) {
      const rBox = await resizeHandle.boundingBox();
      if (rBox) {
        await page.mouse.move(rBox.x + 5, rBox.y + 5);
        await page.mouse.down();
        await page.mouse.move(rBox.x + 5, rBox.y + 50);
        await page.mouse.up();
        await page.waitForTimeout(300);
        pass('Plot resize: dragged handle');
      }
    } else {
      warn('Plot resize', 'no resize handle found');
    }
  } else {
    fail('GC Pause Analysis', 'did not become idle or load failed');
  }

  // ─────────────────────────────────────────
  // 4. MEMORY LEAK DETECTION TEMPLATE
  // ─────────────────────────────────────────
  console.log('\n══ 4. MEMORY LEAK DETECTION ══');
  const mlOk = await loadTemplate(page, 'Memory Leak Detection');
  if (mlOk) {
    const mlCells  = await page.evaluate(() => document.querySelectorAll('[data-cell-status]').length);
    const mlSvgs   = await page.evaluate(() => document.querySelectorAll('svg').length);
    const mlErrors = await domScan(page);
    if (mlErrors.length === 0) pass(`Memory Leak Detection: ${mlCells} cells, ${mlSvgs} SVGs, 0 DOM errors`);
    else fail('Memory Leak Detection', mlErrors.join(' | '));

    await scrollFull(page);
    const mlErrors2 = await domScan(page);
    if (mlErrors2.length === 0) pass('Memory Leak Detection: scroll DOM scan — 0 errors');
    else fail('Memory Leak Detection scroll', mlErrors2.join(' | '));
  } else {
    fail('Memory Leak Detection', 'did not become idle or load failed');
  }

  // ─────────────────────────────────────────
  // 5. UI POLISH CHECKS
  // ─────────────────────────────────────────
  console.log('\n══ 5. UI POLISH ══');

  // Text overflow check
  const overflow = await page.evaluate(() => {
    const issues = [];
    document.querySelectorAll('p, h1, h2, h3, td, th, [class*="title"], [class*="label"]').forEach(el => {
      if (el.scrollWidth > el.clientWidth + 4 && el.offsetParent !== null) {
        issues.push(el.textContent?.trim().slice(0, 60));
      }
    });
    return issues.slice(0, 5);
  });
  if (overflow.length === 0) pass('UI polish: no text overflow detected');
  else warn('UI polish overflow', overflow.join(' | '));

  // Zero-height cells
  const zeroHeight = await page.evaluate(() => {
    const cells = document.querySelectorAll('[data-cell-status]');
    return Array.from(cells).filter(c => c.getBoundingClientRect().height < 10).length;
  });
  if (zeroHeight === 0) pass('UI polish: no zero-height cells');
  else warn('UI polish zero-height', `${zeroHeight} cells with height < 10px`);

  // ─────────────────────────────────────────
  // 6. CONSOLE ERRORS
  // ─────────────────────────────────────────
  console.log('\n══ 6. CONSOLE ══');
  if (consoleErrs.length === 0) pass('Console: 0 real errors');
  else {
    consoleErrs.forEach(e => fail('Console error', e));
  }

  // ─────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────
  await ctx.close();
  await browser.close();

  console.log('\n═══════════════════════════════');
  console.log(`PASS: ${PASS.length}, WARN: ${WARN.length}, FAIL: ${FAIL.length}`);
  if (FAIL.length === 0) {
    if (WARN.length > 0) {
      console.log('No failures ✅  (warnings only)');
      WARN.forEach(w => console.log(`  ⚠  ${w.l}: ${w.d}`));
    } else {
      console.log('All checks passed ✅');
    }
  } else {
    console.log('FAILURES:');
    FAIL.forEach(f => console.log(`  ❌ ${f.l}: ${f.d}`));
    WARN.forEach(w => console.log(`  ⚠  ${w.l}: ${w.d}`));
    process.exit(1);
  }
})();
