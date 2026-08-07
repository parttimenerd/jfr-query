/**
 * Probe: find the help/keyboard-shortcuts button and the 500 URLs
 */
import { chromium } from 'playwright';
const BASE = 'http://localhost:3001';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const failed500 = [];
  page.on('response', resp => {
    if (resp.status() === 500) failed500.push(resp.url());
  });

  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('jfr-tour-seen', '1');
    localStorage.setItem('jfrq:onboarding-dismissed', '1');
  });
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await page.locator('button:has-text("Try the demo")').first().click();
  await page.waitForTimeout(3000);

  // Run All to trigger all queries
  const ra = page.locator('[aria-label="Run All Queries"]');
  if (await ra.isVisible()) await ra.click();
  await page.waitForTimeout(28000);

  // Probe keyboard shortcuts button
  const kbShortcuts = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null);
    return btns.map(b => ({
      text: (b.textContent || '').trim().slice(0, 60),
      aria: b.getAttribute('aria-label') || '',
      title: b.getAttribute('title') || '',
      class: b.className.slice(0, 80),
    })).filter(b => b.text || b.aria);
  });
  console.log('=== All visible buttons ===');
  kbShortcuts.forEach(b => console.log(JSON.stringify(b)));

  // Try "Keyboard Shortcuts" button
  const kbBtn = page.locator('button:has-text("Keyboard Shortcuts"), button[aria-label*="Keyboard"]').first();
  const kbVis = await kbBtn.isVisible().catch(() => false);
  console.log('\n=== Keyboard Shortcuts button visible:', kbVis);
  if (kbVis) {
    await kbBtn.click();
    await page.waitForTimeout(500);
    const dialogs = await page.locator('[role="dialog"]').count();
    console.log('Dialogs after click:', dialogs);
    if (dialogs > 0) {
      const text = await page.locator('[role="dialog"]').first().textContent();
      console.log('Dialog content preview:', text?.slice(0, 200));
    }
  }

  // Report 500s
  console.log('\n=== 500 URLs ===');
  failed500.forEach(u => console.log(u));

  await browser.close();
})();
