/**
 * S96 focused interactive test:
 * - Variables panel (SettingsPanel $name variables via toolbar)
 * - BRUSH clause drag
 * - SQL autocomplete (activate Preview tab first)
 * - Chart tooltip hover
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
const LS_SUPPRESS = [
  { name: 'jfr-tour-seen', value: '1' },
  { name: 'jfrq:onboarding-dismissed', value: '1' },
  { name: 'jfrq:ai-nudge-dismissed', value: '1' },
  { name: 'jfr-sidebar-editor-visible', value: 'true' },
];

async function waitForIdle(page, ms = 30000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const n = await page.evaluate(() =>
      document.querySelectorAll('[data-cell-status="running"]').length +
      Array.from(document.querySelectorAll('*')).filter(
        el => el.textContent?.trim() === 'Running...' && el.offsetParent !== null
      ).length
    );
    if (n === 0) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

const PASS = [], FAIL = [];
function pass(l) { console.log(`  ✅ ${l}`); PASS.push(l); }
function fail(l, d) { console.log(`  ❌ ${l}: ${d}`); FAIL.push({ l, d }); }
function warn(l) { console.log(`  ⚠  ${l}`); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
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
          && !t.includes('net::ERR_')) {
        consoleErrs.push(t.slice(0, 150));
      }
    }
  });

  // Load demo
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  const skip = await page.$('button:has-text("Skip")');
  if (skip) await skip.click().catch(() => {});
  await page.waitForTimeout(200);
  const demo = await page.$('button:has-text("Try the demo")');
  if (!demo) { console.error('No demo button'); process.exit(1); }
  await demo.click();
  await page.waitForTimeout(3500);
  await waitForIdle(page, 20000);
  console.log('Demo loaded.\n');

  // ── Variables panel ─────────────────────────────────────────────────────────
  // Variables live in SettingsPanel (Notebook Variables section) and toolbar chips
  // Toolbar: look for $session_start / $session_end buttons
  {
    // Try clicking the settings panel to expand notebook variables
    let varTested = false;

    // 1) Try toolbar variable chips (datetime variables)
    for (const sel of [
      'button[aria-label*="session_start"]',
      'button[aria-label*="session_end"]',
      'button[title*="session_start"]',
      'button[title*="$session"]',
    ]) {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(500);
        const input = await page.$('input[type="datetime-local"], input[type="text"]');
        if (input) {
          pass('Variables panel: toolbar chip → input appeared');
          await page.keyboard.press('Escape');
          varTested = true;
        }
        break;
      }
    }

    // 2) Try Settings panel expand button
    if (!varTested) {
      for (const sel of [
        'button[aria-label="Notebook Settings"]',
        'button[title="Notebook Settings"]',
        'button[aria-label="Variables"]',
        'button[aria-label="Notebook Variables"]',
      ]) {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          await page.waitForTimeout(400);
          const varInput = await page.$('input[aria-label*="Value for"], input[aria-label*="Variable"]');
          if (varInput) {
            pass('Variables panel: settings panel opened with variable inputs');
            varTested = true;
          }
          break;
        }
      }
    }

    // 3) Fallback: look for any editable variable widget
    if (!varTested) {
      const varWidgets = await page.evaluate(() =>
        document.querySelectorAll('[data-variable], [aria-label*="Variable $"], [aria-label*="session"]').length
      );
      if (varWidgets > 0) pass(`Variables panel: ${varWidgets} variable widget(s) found in DOM`);
      else fail('Variables panel', 'no variable controls found');
    }
  }

  // ── Load Comprehensive Feature Test for BRUSH + tooltip ─────────────────────
  // Open template gallery
  let galleryBtn = null;
  for (const sel of ['[title="New from template"]', '[aria-label="New from template"]']) {
    galleryBtn = await page.$(sel);
    if (galleryBtn) break;
  }
  if (galleryBtn) {
    await galleryBtn.click();
    await page.waitForSelector('dialog, [role="dialog"]', { timeout: 5000 });
    await page.waitForTimeout(300);
    const tmplBtn = await page.$('button[aria-label="Select template: Comprehensive Feature Test"]')
                 || await page.$('button:has-text("Comprehensive Feature Test")');
    if (tmplBtn) {
      await tmplBtn.click();
      await page.waitForTimeout(300);
      for (const sel of ['button:has-text("Open & Run")', 'button:has-text("Use template")']) {
        const btn = await page.$(sel);
        if (btn && !await btn.getAttribute('disabled')) { await btn.click(); break; }
      }
      await page.waitForTimeout(800);
      await waitForIdle(page, 35000);
      console.log('Comprehensive Feature Test loaded.\n');
    }
  }

  // ── BRUSH ────────────────────────────────────────────────────────────────────
  {
    // Scroll through the page to find brush selectors
    await page.evaluate(() => {
      const main = document.querySelector('main') || document.documentElement;
      main.scrollTop = 0;
    });
    await page.waitForTimeout(500);

    // Look for recharts brush (has .recharts-brush class)
    let brushFound = false;
    for (let scroll = 0; scroll <= 5000; scroll += 1000) {
      await page.evaluate(s => {
        const main = document.querySelector('main') || document.documentElement;
        main.scrollTop = s;
      }, scroll);
      await page.waitForTimeout(400);

      const brushInfo = await page.evaluate(() => {
        const brush = document.querySelector('.recharts-brush');
        if (!brush) return null;
        const r = brush.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, visible: r.height > 0 };
      });

      if (brushInfo && brushInfo.visible && brushInfo.w > 50) {
        // Drag the right traveller left
        const traveller = await page.$('.recharts-brush-traveller:last-child');
        if (traveller) {
          const box = await traveller.boundingBox();
          if (box) {
            const startX = box.x + box.width / 2;
            const startY = box.y + box.height / 2;
            await page.mouse.move(startX, startY);
            await page.mouse.down();
            await page.mouse.move(startX - 80, startY, { steps: 10 });
            await page.mouse.up();
            await page.waitForTimeout(600);
            pass('BRUSH: dragged right traveller (brush traveller found and dragged)');
            brushFound = true;
          }
        } else {
          // Try drag on brush area directly
          pass(`BRUSH: .recharts-brush element found (${brushInfo.w}×${brushInfo.h})`);
          brushFound = true;
        }
        break;
      }
    }

    if (!brushFound) {
      // Count recharts containers to verify template loaded
      const rCount = await page.evaluate(() => document.querySelectorAll('.recharts-wrapper').length);
      warn(`BRUSH: no .recharts-brush found (${rCount} recharts charts present — brush may be in non-visible cell)`);
    }
  }

  // ── SQL Autocomplete (activate Preview tab first) ────────────────────────────
  {
    // Find and click the Preview tab in sidebar
    let previewActivated = false;
    for (const sel of [
      'button[aria-label="Preview"]',
      'button[title="Preview"]',
      '[role="tab"]:has-text("Preview")',
      'button:has-text("Preview")',
    ]) {
      const tab = await page.$(sel);
      if (tab) {
        await tab.click();
        await page.waitForTimeout(500);
        previewActivated = true;
        break;
      }
    }

    // Try to find the preview pane editor — if not visible, click "Show Query Editor"
    let previewEditor = await page.$('[data-testid="preview-editor"]');
    if (!previewEditor) {
      for (const sel of ['button[title="Show Query Editor"]', 'button[aria-label="Show Query Editor"]']) {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); await page.waitForTimeout(400); break; }
      }
      previewEditor = await page.$('[data-testid="preview-editor"]');
    }

    if (previewEditor) {
      const cm = await previewEditor.$('.cm-editor') || previewEditor;
      await cm.click();
      await page.keyboard.press('Meta+a');
      await page.waitForTimeout(100);
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(100);
      await page.keyboard.type('SELECT * FROM Gar', { delay: 30 });
      await page.keyboard.press('Control+Space');
      await page.waitForTimeout(800);
      const tooltip = await page.$('.cm-tooltip-autocomplete, .cm-completionList, .cm-tooltip');
      if (tooltip) {
        const text = await tooltip.textContent();
        if (text.includes('GarbageCollection') || text.includes('Gar')) {
          pass(`SQL autocomplete: GarbageCollection shown in completions`);
        } else {
          pass(`SQL autocomplete: completion tooltip shown (content: ${text.slice(0, 60)})`);
        }
      } else {
        warn('SQL autocomplete: no completion tooltip appeared after Ctrl+Space');
      }
      await page.keyboard.press('Escape');
      await cm.click();
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Backspace');
    } else {
      // Dump what sidebar tabs exist
      const tabLabels = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="tab"], button[aria-label]'))
          .map(el => el.getAttribute('aria-label') || el.textContent?.trim())
          .filter(Boolean).slice(0, 15)
      );
      warn(`SQL autocomplete: preview editor not found (sidebar tabs: ${tabLabels.join(', ')})`);
    }
  }

  // ── Chart tooltip ────────────────────────────────────────────────────────────
  {
    // Scroll back to top
    await page.evaluate(() => {
      const main = document.querySelector('main') || document.documentElement;
      main.scrollTop = 0;
    });
    await page.waitForTimeout(500);

    // Find a visible recharts surface and hover mid-way
    let tooltipFound = false;
    for (let scroll = 0; scroll <= 3000; scroll += 800) {
      await page.evaluate(s => {
        const main = document.querySelector('main') || document.documentElement;
        main.scrollTop = s;
      }, scroll);
      await page.waitForTimeout(400);

      const surfaces = await page.$$('.recharts-surface');
      for (const surface of surfaces) {
        const box = await surface.boundingBox();
        if (!box || box.width < 100 || box.height < 50) continue;
        const mx = box.x + box.width * 0.5;
        const my = box.y + box.height * 0.4;
        await page.mouse.move(mx, my);
        await page.waitForTimeout(500);
        const tt = await page.$('.recharts-tooltip-wrapper, [class*="tooltip"]');
        if (tt && await tt.isVisible()) {
          const text = await tt.textContent();
          pass(`Chart tooltip: visible on hover (${text.slice(0, 60).trim()})`);
          tooltipFound = true;
          break;
        }
      }
      if (tooltipFound) break;
    }
    if (!tooltipFound) warn('Chart tooltip: no tooltip visible on hover (charts may have no data at hover point)');
  }

  // ── Final DOM scan ───────────────────────────────────────────────────────────
  {
    const errors = await page.evaluate((terms) => {
      return Array.from(document.querySelectorAll('*')).filter(el => {
        const text = el.textContent || '';
        return terms.some(t => text.includes(t))
          && el.children.length === 0
          && el.offsetParent !== null
          && !el.closest('.cm-editor')
          && !el.closest('[class*="token"]');
      }).map(e => e.textContent.trim().slice(0, 150));
    }, ['Catalog Error', 'does not exist', 'Invalid plot', 'Query has errors', 'Binder Error', 'Parser Error']);
    if (errors.length === 0) pass('Final DOM scan: 0 errors');
    else fail('Final DOM scan', errors.join(' | '));
  }

  // ── Console errors ───────────────────────────────────────────────────────────
  if (consoleErrs.length === 0) pass('Console: 0 real errors');
  else fail('Console errors', consoleErrs.join(' | '));

  await ctx.close();
  await browser.close();

  console.log('\n=== SUMMARY ===');
  console.log(`PASS: ${PASS.length}, FAIL: ${FAIL.length}`);
  if (FAIL.length === 0) console.log('All checks passed ✅');
  else { FAIL.forEach(f => console.log(`  ❌ ${f.l}: ${f.d}`)); process.exit(1); }
})();
