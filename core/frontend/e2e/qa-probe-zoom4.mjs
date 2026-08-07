/**
 * Probe: find chart with LINK_X zoom and scroll to it, test zoom
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
  const ra = page.locator('[aria-label="Run All Queries"]');
  if (await ra.isVisible()) await ra.click();
  await page.waitForTimeout(30000);

  // Find all elements with drag/zoom title or the zoom wrapper div
  const zoomEls = await page.evaluate(() => {
    // Look for the ZoomableWrapper by checking for drag=pan or ⇧scroll tooltip
    const els = Array.from(document.querySelectorAll('*')).filter(el => {
      const t = el.getAttribute('title') || '';
      return t.includes('drag') || t.includes('⇧') || t.includes('zoom') || t.includes('Shift');
    });
    return els.map(el => ({
      tag: el.tagName,
      title: (el.getAttribute('title') || '').slice(0, 80),
      class: (el.className || '').toString().slice(0, 60),
      rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
    }));
  });
  console.log('Zoom/drag elements found:', zoomEls.length);
  if (zoomEls.length > 0) console.log(JSON.stringify(zoomEls.slice(0, 5), null, 2));

  // All recharts containers with their y positions
  const chartYs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.recharts-responsive-container')).map((c, i) => {
      const r = c.getBoundingClientRect();
      return { i, y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
  });
  console.log('\nAll chart Y positions:', JSON.stringify(chartYs));

  // Get the page scrollable element
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log('\nPage scroll height:', scrollHeight);

  // Scroll to bring first chart into view using window.scrollTo
  if (chartYs.length > 0) {
    const targetY = chartYs[0].y; // This is already viewport-relative
    // Use page scrolling to make the chart visible
    await page.evaluate(() => {
      const el = document.querySelector('.recharts-responsive-container');
      el?.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(500);

    const newBox = await page.evaluate(() => {
      const el = document.querySelector('.recharts-responsive-container');
      const r = el?.getBoundingClientRect();
      return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null;
    });
    console.log('\nChart box after scrollIntoView:', JSON.stringify(newBox));

    if (newBox && newBox.y > 0 && newBox.y < 850) {
      const cx = newBox.x + newBox.w / 2;
      const cy = newBox.y + newBox.h / 2;

      // Dispatch wheel with shiftKey directly on the recharts container
      await page.evaluate(({ cx, cy }) => {
        const container = document.querySelector('.recharts-responsive-container');
        if (!container) return;
        const rect = container.getBoundingClientRect();
        container.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -500,
          shiftKey: true,
          clientX: cx,
          clientY: cy,
          bubbles: true,
          cancelable: true,
        }));
        // Also dispatch on parent
        const parent = container.parentElement;
        if (parent) {
          parent.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -500,
            shiftKey: true,
            clientX: cx,
            clientY: cy,
            bubbles: true,
            cancelable: true,
          }));
        }
      }, { cx, cy });
      await page.waitForTimeout(600);

      const resets = await page.locator('[aria-label="Reset zoom"]').count();
      console.log('Reset buttons after event dispatch:', resets);

      // Try Playwright mouse.wheel with prior mouse.move
      await page.mouse.move(cx, cy);
      await page.keyboard.down('Shift');
      await page.mouse.wheel(0, -500);
      await page.keyboard.up('Shift');
      await page.waitForTimeout(600);

      const resets2 = await page.locator('[aria-label="Reset zoom"]').count();
      console.log('Reset buttons after page.mouse.wheel+Shift:', resets2);
    } else {
      console.log('Chart not in viewport after scroll');
    }
  }

  await browser.close();
})();
