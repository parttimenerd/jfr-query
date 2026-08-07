/**
 * Probe: find ZoomableWrapper DOM structure for wheel dispatch
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

  // Inspect the DOM around the first recharts container to find zoom wrapper
  const structure = await page.evaluate(() => {
    const container = document.querySelector('.recharts-responsive-container');
    if (!container) return 'no container';

    // Walk up 5 levels
    let el = container;
    const chain = [];
    for (let i = 0; i < 8; i++) {
      if (!el) break;
      const rect = el.getBoundingClientRect();
      chain.push({
        tag: el.tagName,
        id: el.id || '',
        class: (el.className || '').slice(0, 80),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        // Check if this element has a wheel event listener (can't detect directly, but check for data attributes)
        dataAttrs: Array.from(el.attributes).filter(a => a.name.startsWith('data-')).map(a => a.name),
      });
      el = el.parentElement;
    }
    return chain;
  });
  console.log('DOM chain above recharts container:');
  console.log(JSON.stringify(structure, null, 2));

  // Also check if LINK_X zoom is actually configured by looking at data attributes or class names
  const zoomWrappers = await page.evaluate(() => {
    // The ZoomableWrapper renders a div with specific styling
    // Look for divs that have the "drag=pan" title
    return Array.from(document.querySelectorAll('[title*="drag"], [title*="zoom"]')).map(el => ({
      tag: el.tagName,
      title: el.getAttribute('title') || '',
      class: (el.className || '').slice(0, 80),
      rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; })(),
    }));
  });
  console.log('\nElements with drag/zoom title:', JSON.stringify(zoomWrappers, null, 2));

  await browser.close();
})();
