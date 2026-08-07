/**
 * UI probe: find Run All, Help, BRUSH in GC Pause Analysis, schema columns
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
const LS_SUPPRESS = [
  { name: 'jfr-tour-seen', value: '1' },
  { name: 'jfrq:onboarding-dismissed', value: '1' },
  { name: 'jfrq:ai-nudge-dismissed', value: '1' },
  { name: 'jfr-sidebar-editor-visible', value: 'true' },
];

async function waitForIdle(page, ms = 40000) {
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

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    storageState: { cookies: [], origins: [{ origin: BASE, localStorage: LS_SUPPRESS }] },
  });
  const page = await ctx.newPage();

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  const skip = await page.$('button:has-text("Skip")');
  if (skip) await skip.click().catch(() => {});
  const demo = await page.$('button:has-text("Try the demo")');
  await demo.click();
  await page.waitForTimeout(3500);
  await waitForIdle(page, 20000);

  // Load GC Pause Analysis
  let galleryBtn = await page.$('[title="New from template"]') || await page.$('[aria-label="New from template"]');
  await galleryBtn.click();
  await page.waitForSelector('dialog, [role="dialog"]', { timeout: 5000 });
  await page.waitForTimeout(300);
  const tmpl = await page.$('button[aria-label="Select template: GC Pause Analysis"]') || await page.$('button:has-text("GC Pause Analysis")');
  await tmpl.click();
  await page.waitForTimeout(300);
  const openBtn = await page.$('button:has-text("Open & Run")') || await page.$('button:has-text("Use template")');
  await openBtn.click();
  await page.waitForTimeout(800);
  await waitForIdle(page, 40000);
  console.log('GC Pause Analysis loaded.\n');

  // Dump all buttons in toolbar area
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(el => el.offsetParent !== null)
      .map(el => ({
        label: el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim().slice(0, 40),
        class: el.className?.slice(0, 60),
      }))
      .filter(b => b.label && b.label.length > 0)
      .slice(0, 40)
  );
  console.log('=== Visible buttons ===');
  buttons.forEach(b => console.log(`  "${b.label}" [${b.class}]`));

  // Dump all brush-related elements
  const brushInfo = await page.evaluate(() => {
    const brushes = document.querySelectorAll('.recharts-brush');
    return Array.from(brushes).map(b => ({
      rect: b.getBoundingClientRect(),
      class: b.className,
      children: b.children.length,
    }));
  });
  console.log('\n=== BRUSH elements ===');
  brushes: {
    if (brushInfo.length === 0) {
      console.log('  None found (scrolled range 0-0)');
      // Scroll and check
      for (let s = 0; s <= 15000; s += 1000) {
        await page.evaluate(sc => {
          const el = document.querySelector('main') || document.documentElement;
          el.scrollTop = sc;
        }, s);
        await page.waitForTimeout(200);
        const found = await page.$('.recharts-brush');
        if (found) {
          const info = await page.evaluate(() => {
            const b = document.querySelector('.recharts-brush');
            const r = b.getBoundingClientRect();
            return { scroll: document.documentElement.scrollTop, rect: r, visible: r.height > 0 };
          });
          console.log(`  Found at scroll=${s}: ${JSON.stringify(info)}`);
          break brushes;
        }
      }
      console.log('  Not found at any scroll depth (0-15000)');
    } else {
      brushInfo.forEach(b => console.log(`  ${JSON.stringify(b)}`));
    }
  }

  // Check schema sidebar
  const schemaStats = await page.evaluate(() => {
    // All sidebar tabs
    const tabs = Array.from(document.querySelectorAll('[role="tab"], button[data-panel], button[data-sidebar]'))
      .map(el => el.getAttribute('aria-label') || el.textContent?.trim())
      .filter(Boolean);
    // All elements with type annotations
    const typed = Array.from(document.querySelectorAll('*')).filter(el => {
      const t = el.textContent || '';
      return (t.match(/\b(VARCHAR|BIGINT|DOUBLE|TIMESTAMP|INTEGER|BOOLEAN|HUGEINT)\b/)) &&
        el.children.length === 0 && el.offsetParent !== null;
    }).slice(0, 5).map(el => el.textContent?.trim().slice(0, 60));
    return { tabs, typed };
  });
  console.log('\n=== Schema sidebar state ===');
  console.log('  Tabs:', schemaStats.tabs.join(', ') || 'none');
  console.log('  Typed items:', schemaStats.typed.join(' | ') || 'none');

  await ctx.close();
  await browser.close();
})();
