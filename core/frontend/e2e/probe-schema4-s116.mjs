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
  
  const btns = await page.$$('button[title="Click to preview · Double-click to copy name"]');
  const texts = [];
  for (const b of btns) {
    const txt = await b.evaluate(el => el.textContent?.trim() || '');
    texts.push(txt);
  }
  console.log('All sidebar buttons:', texts);
  
  // Filter with our logic
  for (const txt of texts) {
    const isTable = /^[A-Z]/.test(txt) && !/^P\d/.test(txt);
    if (isTable) { console.log('First table match:', txt); break; }
  }
  
  await ctx.close();
  await browser.close();
})();
