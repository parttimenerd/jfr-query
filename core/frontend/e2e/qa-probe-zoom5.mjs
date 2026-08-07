/**
 * Probe: try to zoom the LINK_X chart (index 1) and debug wheel handler
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

  // Scroll to second chart (LINK_X chart, index 1)
  await page.evaluate(() => {
    const charts = document.querySelectorAll('.recharts-responsive-container');
    if (charts.length > 1) charts[1].scrollIntoView({ block: 'center' });
    else if (charts.length > 0) charts[0].scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);

  const chartIdx = await page.evaluate(() => {
    const charts = document.querySelectorAll('.recharts-responsive-container');
    return { count: charts.length, rects: Array.from(charts).map((c, i) => {
      const r = c.getBoundingClientRect();
      return { i, y: Math.round(r.y), visible: r.y > 0 && r.y < 850 };
    }) };
  });
  console.log('Charts:', JSON.stringify(chartIdx));

  // Find the wrapper div (the div.group with wrapperRef)
  const wrapperInfo = await page.evaluate(() => {
    const charts = document.querySelectorAll('.recharts-responsive-container');
    const results = [];
    for (let idx = 0; idx < charts.length; idx++) {
      const c = charts[idx];
      const rect = c.getBoundingClientRect();
      if (rect.y > 0 && rect.y < 850) {
        // Walk up to find "group" div
        let el = c.parentElement;
        for (let i = 0; i < 10; i++) {
          if (!el) break;
          if (el.className?.includes('group') || el.className === 'group') {
            const r = el.getBoundingClientRect();
            results.push({ idx, tag: el.tagName, class: el.className?.slice(0, 60), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
            break;
          }
          el = el.parentElement;
        }
      }
    }
    return results;
  });
  console.log('Wrapper divs:', JSON.stringify(wrapperInfo));

  // Dispatch wheel on wrapper div
  const fired = await page.evaluate(() => {
    const charts = document.querySelectorAll('.recharts-responsive-container');
    let dispatched = 0;
    for (let idx = 0; idx < charts.length; idx++) {
      const c = charts[idx];
      const rect = c.getBoundingClientRect();
      if (rect.y < 0 || rect.y > 850) continue;

      // Walk up to find group div
      let el = c.parentElement;
      for (let i = 0; i < 10; i++) {
        if (!el) break;
        if (el.className?.includes('group')) {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          el.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -500, shiftKey: true,
            clientX: cx, clientY: cy,
            bubbles: true, cancelable: true,
          }));
          dispatched++;
          break;
        }
        el = el.parentElement;
      }
    }
    return dispatched;
  });
  console.log('Events dispatched:', fired);
  await page.waitForTimeout(1000);

  const resets = await page.locator('[aria-label="Reset zoom"]').count();
  console.log('Reset buttons:', resets);

  // Debug: add a console log patcher to verify event handler fires
  await page.evaluate(() => {
    const charts = document.querySelectorAll('.recharts-responsive-container');
    for (const c of charts) {
      let el = c.parentElement;
      for (let i = 0; i < 10; i++) {
        if (!el) break;
        if (el.className?.includes('group')) {
          el.addEventListener('wheel', (e) => {
            console.log('[WHEEL CAPTURED]', 'shiftKey:', e.shiftKey, 'deltaY:', e.deltaY, 'defaultPrevented:', e.defaultPrevented);
          }, { capture: true });
          break;
        }
        el = el.parentElement;
      }
    }
  });

  const logMsgs = [];
  page.on('console', m => { if (m.text().includes('WHEEL')) logMsgs.push(m.text()); });

  await page.evaluate(() => {
    const charts = document.querySelectorAll('.recharts-responsive-container');
    for (const c of charts) {
      const rect = c.getBoundingClientRect();
      if (rect.y < 0 || rect.y > 850) continue;
      let el = c.parentElement;
      for (let i = 0; i < 10; i++) {
        if (!el) break;
        if (el.className?.includes('group')) {
          const r = el.getBoundingClientRect();
          el.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -500, shiftKey: true,
            clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
            bubbles: true, cancelable: true,
          }));
          break;
        }
        el = el.parentElement;
      }
    }
  });
  await page.waitForTimeout(800);
  console.log('Console WHEEL messages:', logMsgs);

  await browser.close();
})();
