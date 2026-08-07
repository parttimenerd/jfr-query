/**
 * Probe: LINK_X zoom in demo — does Shift+scroll work headless?
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

  // Run All
  const ra = page.locator('[aria-label="Run All Queries"]');
  if (await ra.isVisible()) await ra.click();
  await page.waitForTimeout(30000);

  // Chart state before zoom
  const chartsInfo = await page.evaluate(() => {
    const charts = document.querySelectorAll('.recharts-responsive-container');
    return Array.from(charts).slice(0, 3).map(c => {
      const rect = c.getBoundingClientRect();
      return { w: rect.width, h: rect.height, x: rect.x, y: rect.y, visible: rect.height > 0 };
    });
  });
  console.log('Charts info:', JSON.stringify(chartsInfo));

  // Scroll to first visible chart
  const firstChart = page.locator('.recharts-responsive-container').first();
  await firstChart.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  // Get center of first chart
  const box = await firstChart.boundingBox();
  console.log('First chart bounding box:', JSON.stringify(box));

  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Try Shift+wheel
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(200);
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, -500);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(1000);

    // Check for reset button
    const resetBtns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).filter(b =>
        b.offsetParent !== null && (
          b.getAttribute('aria-label') === 'Reset zoom' ||
          (b.textContent || '').trim() === 'reset'
        )
      ).map(b => ({ text: b.textContent?.trim(), aria: b.getAttribute('aria-label'), visible: b.offsetParent !== null }))
    );
    console.log('Reset buttons after Shift+wheel:', JSON.stringify(resetBtns));

    // Also check zoom state on the chart wrapper
    const zoomState = await page.evaluate(() => {
      // Look for any element that suggests zoom mode is active
      const zoomed = Array.from(document.querySelectorAll('*')).filter(el =>
        el.offsetParent !== null && (
          (el.textContent || '').trim() === 'reset' ||
          el.className?.includes('zoom') || el.className?.includes('zoomed')
        )
      ).map(el => ({ tag: el.tagName, text: (el.textContent || '').trim().slice(0,30), class: el.className?.slice(0,60) }));
      return zoomed.slice(0, 10);
    });
    console.log('Zoom-related elements:', JSON.stringify(zoomState));

    // Try a different approach: inject a wheel event with shiftKey=true
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (el) {
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -500,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }));
      }
    }, { x: cx, y: cy });
    await page.waitForTimeout(1000);

    const resetBtns2 = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).filter(b =>
        b.offsetParent !== null && (
          b.getAttribute('aria-label') === 'Reset zoom' ||
          (b.textContent || '').trim() === 'reset'
        )
      ).length
    );
    console.log('Reset buttons after injected wheel event:', resetBtns2);
  }

  await browser.close();
})();
