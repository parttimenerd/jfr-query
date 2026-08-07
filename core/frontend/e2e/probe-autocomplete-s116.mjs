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
  
  // Add SQL cell and type
  const addBtn = await page.$('[title="Add SQL cell"]');
  if (addBtn) {
    await addBtn.click();
    await page.waitForTimeout(400);
    console.log('Clicked Add SQL cell button');
  }
  
  // Get the last cm-content (should be the new cell)
  const editors = await page.$$('.cm-editor .cm-content');
  const last = editors[editors.length - 1];
  if (!last) { console.log('No editor found'); process.exit(1); }
  
  await last.click();
  await page.waitForTimeout(200);
  await page.keyboard.type('SELECT * FROM Gar');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+Space');
  await page.waitForTimeout(1000);
  
  const popup = await page.$('.cm-tooltip-autocomplete');
  console.log('Autocomplete popup:', popup ? 'found' : 'not found');
  
  if (popup) {
    const items = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.cm-completionLabel'))
        .map(el => el.textContent?.trim()).filter(Boolean).slice(0, 5)
    );
    console.log('Items:', items);
  }
  
  await ctx.close();
  await browser.close();
})();
