/**
 * Probe: LINK_X zoom via direct WheelEvent dispatch
 */
import { chromium } from 'playwright';
const BASE = 'http://localhost:3001';

(async () => {
  const browser = await chromium.launch({ headless: true });
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
  await page.waitForTimeout(30000);

  // Scroll to first chart
  const chart = page.locator('.recharts-responsive-container').first();
  await chart.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  // Get bounding box
  const box = await chart.boundingBox();
  console.log('Chart box:', JSON.stringify(box));

  if (!box) { console.log('No bounding box'); await browser.close(); return; }

  // Method 1: Playwright keyboard.down + mouse.wheel
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -500);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(800);

  let resets = await page.locator('[aria-label="Reset zoom"]').count();
  console.log('Method 1 (keyboard.down Shift + mouse.wheel): resets =', resets);

  // Method 2: dispatchEvent with shiftKey via evaluate
  await page.evaluate(({ x, y }) => {
    const container = document.querySelector('.recharts-responsive-container');
    if (!container) { console.error('no container'); return; }
    const rect = container.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    container.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -500,
      shiftKey: true,
      clientX: cx,
      clientY: cy,
      bubbles: true,
      cancelable: true,
    }));
  }, { x: cx, y: cy });
  await page.waitForTimeout(800);

  resets = await page.locator('[aria-label="Reset zoom"]').count();
  console.log('Method 2 (dispatchEvent on container): resets =', resets);

  // Method 3: target the exact wrapper div that has the event listener (wrapperRef)
  // The wrapper should be the outer div of the ZoomableWrapper component
  await page.evaluate(() => {
    // Walk up from recharts-responsive-container to find the wrapper with the wheel handler
    const containers = document.querySelectorAll('.recharts-responsive-container');
    if (!containers.length) return;
    const c = containers[0];
    // The ZoomableWrapper is the parent div wrapping it
    let el = c.parentElement;
    while (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && el !== document.body) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -500,
          shiftKey: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
          cancelable: true,
        }));
        break;
      }
      el = el.parentElement;
    }
  });
  await page.waitForTimeout(800);

  resets = await page.locator('[aria-label="Reset zoom"]').count();
  console.log('Method 3 (dispatchEvent on parent wrapper): resets =', resets);

  // Report all buttons
  const allBtns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null)
      .map(b => ({ text: (b.textContent || '').trim().slice(0, 30), aria: b.getAttribute('aria-label') || '' }))
      .filter(b => b.text || b.aria)
  );
  console.log('\nAll visible buttons:', JSON.stringify(allBtns.slice(0, 20)));

  await browser.close();
})();
