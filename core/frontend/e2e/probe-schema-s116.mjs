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
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [{ origin: BASE, localStorage: LS }] } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  const demo = await page.$('button:has-text("Try the demo")');
  if (demo) { await demo.click(); await page.waitForTimeout(4000); }
  // Try all possible schema toggles
  const btns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => ({
      label: b.getAttribute('aria-label') || '',
      title: b.getAttribute('title') || '',
      text: b.textContent?.trim().slice(0, 40) || '',
    })).filter(b => b.label || b.title || b.text)
  );
  console.log('All buttons:', JSON.stringify(btns.filter(b => 
    b.label.toLowerCase().includes('schema') || b.title.toLowerCase().includes('schema') ||
    b.label.toLowerCase().includes('table') || b.label.toLowerCase().includes('explorer')
  ), null, 2));

  // Try clicking sidebar toggle or schema button
  for (const sel of ['[aria-label*="schema" i]', '[title*="schema" i]', '[aria-label*="explorer" i]', '[aria-label="Tables"]', '[title="Tables"]']) {
    const el = await page.$(sel);
    if (el) { 
      console.log(`Found: ${sel}`);
      await el.click();
      await page.waitForTimeout(500);
      // List what appeared
      const sidebarContent = await page.evaluate(() => {
        const sidebar = document.querySelector('[class*="sidebar"], [class*="Sidebar"], [role="complementary"]');
        if (!sidebar) return 'no sidebar found';
        return sidebar.innerHTML.slice(0, 500);
      });
      console.log('Sidebar after click:', sidebarContent.slice(0, 200));
      break;
    }
  }
  await ctx.close();
  await browser.close();
})();
