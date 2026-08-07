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
  const ctx = await browser.newContext({ viewport: {width:1440,height:900}, storageState: { cookies: [], origins: [{ origin: BASE, localStorage: LS }] } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  const demo = await page.$('button:has-text("Try the demo")');
  if (demo) { await demo.click(); await page.waitForTimeout(4000); }
  const btns = await page.$$('button[title="Click to preview · Double-click to copy name"]');
  console.log(`Sidebar items after demo load: ${btns.length}`);
  const names = [];
  for (const b of btns.slice(0, 5)) names.push(await b.evaluate(el => el.textContent?.trim() || ''));
  console.log('First 5:', names);
  // Now simulate what the test does: variables click, run all, command palette, add SQL cell, then check
  const runAll = await page.$('[aria-label="Run All Queries"]');
  if (runAll) { await runAll.click(); await page.waitForTimeout(3000); }
  const btns2 = await page.$$('button[title="Click to preview · Double-click to copy name"]');
  console.log(`Sidebar items after Run All: ${btns2.length}`);
  await ctx.close();
  await browser.close();
})();
