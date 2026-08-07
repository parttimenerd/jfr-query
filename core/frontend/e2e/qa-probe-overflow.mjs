/**
 * Probe: find correct Exception template name + overflow elements
 */
import { chromium } from 'playwright';
const BASE = 'http://localhost:3001';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
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

  // Run All to populate demo notebook (so overflow check is meaningful)
  const ra = page.locator('[aria-label="Run All Queries"]');
  if (await ra.isVisible()) await ra.click();
  await page.waitForTimeout(30000);

  // Probe 1: overflow elements detail
  const overflowDetail = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*')).filter(el => {
      if (!el.offsetParent) return false;
      const style = window.getComputedStyle(el);
      return style.overflow === 'hidden' && el.scrollWidth > el.clientWidth + 5;
    }).map(el => {
      const rect = el.getBoundingClientRect();
      // Get context: what's inside?
      const text = (el.textContent || '').trim().slice(0, 100);
      const parent = el.parentElement;
      const parentClass = parent ? (parent.className || '').slice(0, 60) : '';
      return {
        tag: el.tagName,
        class: (el.className || '').slice(0, 80),
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        text,
        parentClass,
      };
    }).slice(0, 10);
  });
  console.log('=== Overflow elements ===');
  console.log(JSON.stringify(overflowDetail, null, 2));

  // Probe 2: template names in gallery
  const galleryBtn = page.locator('[title="New from template"], [aria-label="New from template"]').first();
  await galleryBtn.click();
  await page.waitForSelector('dialog, [role="dialog"]', { timeout: 8000 });
  await page.waitForTimeout(400);

  const templateNames = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[aria-label^="Select template:"]'))
      .map(el => el.getAttribute('aria-label') || '')
  );
  console.log('\n=== Template names ===');
  templateNames.forEach(n => console.log(n));

  await browser.close();
})();
