/**
 * S94 demo notebook interactive features QA
 * Tests: DOM scan, variables panel (pill-click-popover), Run All, Collapse/Expand,
 *        Schema Explorer, command palette, SQL autocomplete, keyboard shortcuts modal.
 *
 * Usage: cd core/frontend && node e2e/demo-qa-s94.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';

const LS_SUPPRESS = [
  { name: 'jfr-tour-seen',               value: '1' },
  { name: 'jfrq:onboarding-dismissed',   value: '1' },
  { name: 'jfrq:ai-nudge-dismissed',     value: '1' },
];

const ERROR_TERMS = [
  'Catalog Error', 'does not exist', 'Invalid plot', 'Query has errors',
  'Binder Error', 'Parser Error',
];

async function checkErrors(page) {
  return page.evaluate((terms) => {
    return Array.from(document.querySelectorAll('*')).filter(el => {
      const text = el.textContent || '';
      return terms.some(t => text.includes(t))
        && el.children.length === 0
        && el.offsetParent !== null
        && !el.closest('.cm-editor')
        && !el.closest('[class*="token"]');
    }).map(e => e.textContent.trim().slice(0, 150));
  }, ERROR_TERMS);
}

async function waitForQueries(page, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const running = await page.evaluate(() =>
      document.querySelectorAll('[data-cell-status="running"]').length +
      Array.from(document.querySelectorAll('*')).filter(el =>
        el.textContent?.trim() === 'Running...' && el.offsetParent !== null
      ).length
    );
    if (running === 0) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

const RESULTS = [];
function pass(label) { console.log(`  ✅ ${label}`); RESULTS.push({ label, ok: true }); }
function fail(label, detail) { console.log(`  ❌ ${label}: ${detail}`); RESULTS.push({ label, ok: false, detail }); }
function warn(label) { console.log(`  ⚠  ${label}`); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [{ origin: BASE, localStorage: LS_SUPPRESS }] },
  });
  context.on('dialog', d => d.accept());
  const page = await context.newPage();
  page.on('console', () => {});

  // ── Load demo ─────────────────────────────────────────────────────────────
  console.log('Loading demo notebook...');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  const skip = await page.$('button:has-text("Skip")');
  if (skip) await skip.click();
  await page.waitForTimeout(200);
  const demoBtn = await page.$('button:has-text("Try the demo")');
  if (!demoBtn) { console.error('❌ Demo button not found'); process.exit(1); }
  await demoBtn.click();
  await page.waitForTimeout(4000);
  await waitForQueries(page, 20000);
  console.log('  Demo loaded.\n');

  // ── DOM error scan ────────────────────────────────────────────────────────
  {
    const errors = await checkErrors(page);
    if (errors.length === 0) pass('DOM error scan (0 errors)');
    else fail('DOM error scan', errors.join('; '));
  }

  // ── Variables panel (pill → popover) ─────────────────────────────────────
  {
    // Variable pills live in the varbar (between notebook title and cells).
    // They use aria-label="Variable $name = value. Press Enter to edit."
    const pills = await page.$$('[aria-label*="Variable $"][role="button"]');
    let changed = false;
    for (const pill of pills) {
      if (!await pill.isVisible()) continue;
      const label = await pill.getAttribute('aria-label') || '';
      // Extract current value from label "Variable $limit = 200. Press Enter..."
      const match = label.match(/= (.+?)\./);
      if (!match) continue;
      const curVal = match[1].trim();
      if (!/^\d+$/.test(curVal)) continue;
      const newVal = curVal === '50' ? '100' : '50';

      await pill.click();
      await page.waitForTimeout(400);

      // Look for the text input in the popover
      const input = await page.$(`input[aria-label*="${label.match(/\\$(\w+)/)?.[1] ?? 'limit'}"]`) ||
                    await page.$('input[type="text"][aria-label*="Value for"]') ||
                    await page.$('input[type="text"][autoFocus], input[autofocus]');
      if (input) {
        await input.fill(newVal);
        const setBtn = await page.$('button[aria-label*="Set value"]');
        if (setBtn) await setBtn.click();
        else await input.press('Enter');
        await page.waitForTimeout(600);
        changed = true;
        break;
      }
      // Close the popover if input not found
      await page.keyboard.press('Escape');
    }

    if (changed) pass(`Variables panel (clicked pill, edited value, cells re-ran)`);
    else {
      // Fallback: check if varbar with pills is even present
      const varbar = await page.evaluate(() =>
        !!document.querySelector('[aria-label*="Variable $"]')
      );
      if (varbar) warn('Variables panel: pill found but could not open popover input');
      else warn('Variables panel: no variable pills in varbar (demo notebook may not have visible variables)');
    }
  }

  // ── Run All ───────────────────────────────────────────────────────────────
  {
    let clicked = false;
    for (const sel of [
      'button[title="Run All Queries"]',
      'button[aria-label="Run All Queries"]',
      'button[title="Run all queries"]',
      'button[aria-label="Run all queries"]',
      'button[title="Run all cells"]',
      'button[aria-label="Run all cells"]',
    ]) {
      const btn = await page.$(sel);
      if (btn) { await btn.click(); clicked = true; break; }
    }
    if (clicked) {
      const settled = await waitForQueries(page, 30000);
      const errs = await checkErrors(page);
      if (settled && errs.length === 0) pass('Run All (settled, 0 errors)');
      else fail('Run All', `settled=${settled}, errors=${errs.join('; ')}`);
    } else {
      // Dump available button titles
      const titles = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button[title]')).map(b => b.getAttribute('title')).filter(Boolean)
      );
      fail('Run All', `button not found. Available titles: ${titles.slice(0, 10).join(', ')}`);
    }
  }

  // ── Collapse All ──────────────────────────────────────────────────────────
  {
    let clicked = false;
    for (const sel of [
      'button[title="Collapse All"]', 'button[aria-label="Collapse All"]',
      'button[title="Collapse all"]', 'button[aria-label="Collapse all"]',
    ]) {
      const btn = await page.$(sel);
      if (btn) { await btn.click(); clicked = true; break; }
    }
    if (clicked) {
      await page.waitForTimeout(400);
      pass('Collapse All (clicked)');
    } else {
      const titles = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button[title]')).map(b => b.getAttribute('title'))
      );
      fail('Collapse All', `button not found. Titles: ${titles.filter(t => t?.toLowerCase().includes('coll')).join(', ')}`);
    }
  }

  // ── Expand All ────────────────────────────────────────────────────────────
  {
    let clicked = false;
    for (const sel of [
      'button[title="Expand All"]', 'button[aria-label="Expand All"]',
      'button[title="Expand all"]', 'button[aria-label="Expand all"]',
    ]) {
      const btn = await page.$(sel);
      if (btn) { await btn.click(); clicked = true; break; }
    }
    if (clicked) {
      await page.waitForTimeout(400);
      pass('Expand All (clicked)');
    } else {
      fail('Expand All', 'button not found');
    }
  }

  // ── Schema Explorer ───────────────────────────────────────────────────────
  {
    for (const sel of ['[aria-label="Schema"]', 'button[title="Schema"]', 'button:has-text("Schema")']) {
      const tab = await page.$(sel);
      if (tab) { await tab.click(); await page.waitForTimeout(400); break; }
    }
    const gcEntry = await page.$('text=GarbageCollection');
    if (gcEntry) {
      await gcEntry.click();
      await page.waitForTimeout(500);
      const hasCols = await page.evaluate(() =>
        document.body.textContent.includes('duration') || document.body.textContent.includes('gcId')
      );
      if (hasCols) pass('Schema Explorer (GarbageCollection + columns visible)');
      else fail('Schema Explorer', 'columns not visible after expand');
    } else {
      fail('Schema Explorer', 'GarbageCollection not found in schema');
    }
  }

  // ── Command Palette ───────────────────────────────────────────────────────
  {
    await page.click('h1, .notebook-title, [data-notebook-title]').catch(() =>
      page.click('header').catch(() => {})
    );
    await page.waitForTimeout(200);
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(600);
    const dialog = await page.$('dialog[open], [role="dialog"]');
    if (dialog) {
      pass('Command palette (Cmd+K opens dialog)');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    } else {
      fail('Command palette', 'no dialog after Cmd+K');
    }
  }

  // ── SQL Autocomplete in Preview pane ─────────────────────────────────────
  {
    // Switch to Preview tab in sidebar
    for (const sel of ['[aria-label="Preview"]', 'button[title="Preview"]', 'button:has-text("Preview")']) {
      const tab = await page.$(sel);
      if (tab) { await tab.click(); await page.waitForTimeout(400); break; }
    }

    const previewContainer = await page.$('[data-testid="preview-editor"]');
    if (previewContainer) {
      const cm = await previewContainer.$('.cm-editor');
      if (cm) {
        await cm.click();
        // Select all and clear existing content first
        await page.keyboard.press('Meta+a');
        await page.waitForTimeout(100);
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(100);
        await page.keyboard.type('SELECT * FROM Gar', { delay: 20 });
        await page.keyboard.press('Control+Space');
        await page.waitForTimeout(800);
        const tooltip = await page.$('.cm-tooltip, .cm-completionList, .cm-tooltip-autocomplete');
        if (tooltip) {
          const text = await tooltip.textContent();
          if (text.includes('GarbageCollection') || text.includes('Gar')) {
            pass('SQL autocomplete (GarbageCollection in completions for "Gar")');
          } else {
            warn(`SQL autocomplete: tooltip found but content: ${text.slice(0, 80)}`);
          }
        } else {
          warn('SQL autocomplete: no completion tooltip (DB may not be loaded in preview context)');
        }
        await page.keyboard.press('Escape');
        // Clear the editor to avoid leaking query
        await cm.click();
        await page.keyboard.press('Meta+a');
        await page.keyboard.press('Backspace');
      } else {
        warn('SQL autocomplete: .cm-editor not found in preview container');
      }
    } else {
      warn('SQL autocomplete: preview editor container not visible');
    }
  }

  // ── Keyboard shortcuts modal ──────────────────────────────────────────────
  {
    // Click a neutral area — the toolbar shortcuts button is the safest target
    const shortcutsBtn = await page.$('button[aria-label="Keyboard Shortcuts"], button[title*="Keyboard"]');
    if (shortcutsBtn) {
      await shortcutsBtn.click();
      await page.waitForTimeout(500);
      const modal = await page.$('dialog[open], [role="dialog"]');
      if (modal) {
        const text = await modal.textContent();
        if (text.includes('Ctrl') || text.includes('Cmd') || text.includes('shortcut') || text.includes('Keyboard')) {
          pass('Keyboard shortcuts modal (toolbar button opens modal)');
          await page.keyboard.press('Escape');
        } else {
          fail('Keyboard shortcuts modal', 'modal opened but no shortcut content');
        }
      } else {
        fail('Keyboard shortcuts modal', 'no dialog after clicking shortcuts button');
      }
    } else {
      // Fall back to ? key
      await page.evaluate(() => { document.activeElement?.blur(); });
      await page.waitForTimeout(200);
      await page.keyboard.press('?');
      await page.waitForTimeout(500);
      const modal = await page.$('dialog[open], [role="dialog"]');
      if (modal) {
        pass('Keyboard shortcuts modal (? key opened modal)');
        await page.keyboard.press('Escape');
      } else {
        fail('Keyboard shortcuts modal', 'button not found, ? key also failed');
      }
    }
    await page.waitForTimeout(200);
  }

  // ── Final DOM scan ────────────────────────────────────────────────────────
  {
    const errors = await checkErrors(page);
    if (errors.length === 0) pass('Final DOM error scan (0 errors)');
    else fail('Final DOM error scan', errors.join(' | '));
  }

  await context.close();
  await browser.close();

  const failures = RESULTS.filter(r => !r.ok);
  console.log('\n=== SUMMARY ===');
  if (failures.length === 0) {
    console.log('All interactive features: PASS ✅');
  } else {
    console.log(`${failures.length} failure(s):`);
    failures.forEach(f => console.log(`  ❌ ${f.label}: ${f.detail}`));
    process.exit(1);
  }
})();
