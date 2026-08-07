/**
 * Probe schema explorer expand behavior
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
const LS_SUPPRESS = [
  { name: 'jfr-tour-seen', value: '1' },
  { name: 'jfrq:onboarding-dismissed', value: '1' },
  { name: 'jfrq:ai-nudge-dismissed', value: '1' },
  { name: 'jfr-sidebar-editor-visible', value: 'true' },
];

async function waitForIdle(page, ms = 20000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const n = await page.evaluate(() =>
      document.querySelectorAll('[data-cell-status="running"]').length
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

  // Click first table in sidebar to expand it
  const firstTable = await page.$('[title*="Click to preview"]');
  if (firstTable) {
    const name = await firstTable.getAttribute('title') || await firstTable.getAttribute('aria-label') || await firstTable.textContent();
    console.log('First table button:', name?.slice(0, 60));
    await firstTable.click();
    await page.waitForTimeout(800);
    
    // Check what appeared
    const colItems = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('*')).filter(el => {
        const t = el.textContent || '';
        return (t.match(/\b(VARCHAR|BIGINT|DOUBLE|TIMESTAMP|INTEGER|BOOLEAN|HUGEINT|FLOAT)\b/) &&
          el.children.length === 0 && el.offsetParent !== null);
      });
      return items.map(el => el.textContent?.trim().slice(0, 80));
    });
    console.log('\nColumn type items after click:', colItems.slice(0, 10));
    
    // Also check the schema explorer tab
    const schemaTabs = await page.evaluate(() => {
      // Look for sidebar panels
      const panels = Array.from(document.querySelectorAll('[data-testid*="schema"], [data-testid*="explorer"], [class*="SchemaPanel"], [class*="schema-panel"]'));
      const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map(el => ({
        label: el.textContent?.trim(),
        active: el.getAttribute('aria-selected') === 'true',
      }));
      return { panels: panels.length, tabs };
    });
    console.log('\nSidebar tabs:', JSON.stringify(schemaTabs.tabs));
  } else {
    console.log('No table button found');
    // List what IS in sidebar area
    const sidebarContent = await page.evaluate(() => {
      const sidebar = document.querySelector('[class*="sidebar"], [data-testid*="sidebar"], aside');
      if (!sidebar) return 'no sidebar found';
      return sidebar.textContent?.trim().slice(0, 500);
    });
    console.log('Sidebar content preview:', sidebarContent);
  }

  await ctx.close();
  await browser.close();
})();
