/**
 * Focused: just scan for "Query has errors" in demo after Run All, 5 runs
 */
import { chromium } from 'playwright';
const BASE = 'http://localhost:3001';
const WAIT = 35_000;

(async () => {
  const browser = await chromium.launch({ headless: true });
  let foundCount = 0;

  for (let run = 1; run <= 5; run++) {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('jfr-tour-seen', '1');
      localStorage.setItem('jfrq:onboarding-dismissed', '1');
    });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await page.locator('button:has-text("Try the demo")').first().click();
    await page.waitForTimeout(2500);

    const ra = page.locator('[aria-label="Run All Queries"]');
    if (await ra.isVisible()) await ra.click();
    await page.waitForTimeout(WAIT);

    const found = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*'))
        .filter(el => (el.textContent || '').includes('Query has errors') && el.children.length === 0 && el.offsetParent !== null)
        .map(e => (e.textContent || '').trim().slice(0, 150))
    );
    console.log('Run ' + run + ': ' + (found.length > 0 ? 'ERROR: ' + JSON.stringify(found) : 'clean'));
    if (found.length > 0) foundCount++;
    await page.close();
  }

  console.log('\nFound errors in ' + foundCount + '/5 runs');
  await browser.close();
})();
