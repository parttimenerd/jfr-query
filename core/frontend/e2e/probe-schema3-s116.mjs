import { chromium } from 'playwright';
const BASE = 'http://localhost:3001';
const LS = [
  { name: 'jfr-tour-seen', value: '1' },
  { name: 'jfrq:onboarding-dismissed', value: '1' },
  { name: 'jfrq:ai-nudge-dismissed', value: '1' },
  { name: 'jfr-sidebar-editor-visible', value: 'true' },
];
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [{ origin: BASE, localStorage: LS }] } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  const demo = await page.$('button:has-text("Try the demo")');
  if (demo) { await demo.click(); await page.waitForTimeout(4000); }
  
  // Count table/view items in sidebar
  const sidebarItems = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button[title="Click to preview · Double-click to copy name"]'))
      .map(b => b.textContent?.trim().slice(0, 40) || '').slice(0, 8)
  );
  console.log(`Sidebar items (${sidebarItems.length} total):`, sidebarItems);
  
  // Click the first table item
  const firstItem = await page.$('button[title="Click to preview · Double-click to copy name"]');
  if (firstItem) {
    const name = await firstItem.evaluate(b => b.textContent?.trim());
    console.log('Clicking table:', name);
    await firstItem.click();
    await page.waitForTimeout(600);
    
    // Check what appeared — columns should be visible
    const colInfo = await page.evaluate(() => {
      // Look for column type annotations that appear in schema panel
      const typeEls = Array.from(document.querySelectorAll('[class*="column"], [class*="type"], [class*="schema"]'))
        .filter(el => el.offsetParent !== null)
        .map(el => el.textContent?.trim().slice(0, 40))
        .filter(Boolean).slice(0, 10);
      return typeEls;
    });
    console.log('After click, type elements:', colInfo);
    
    // Also check the preview editor that appeared
    const preview = await page.$('[data-testid="preview-editor"]');
    if (preview) {
      const previewText = await preview.evaluate(el => el.textContent?.trim().slice(0, 100));
      console.log('Preview editor text:', previewText);
    }
  }
  
  await ctx.close();
  await browser.close();
})();
