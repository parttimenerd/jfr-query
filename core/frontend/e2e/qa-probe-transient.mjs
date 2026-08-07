/**
 * Probe: monitor for transient "Query has errors" during Run All in demo
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
const ERROR_TERMS = ['Catalog Error','does not exist','Invalid plot',
                     'Query has errors','Binder Error','Parser Error'];

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

  const allScans = [];

  // Scan continuously during Run All
  const ra = page.locator('[aria-label="Run All Queries"]');
  if (await ra.isVisible()) {
    await ra.click();

    // Scan every 2 seconds for 40 seconds
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(2000);
      const found = await page.evaluate(terms => Array.from(document.querySelectorAll('*'))
        .filter(el => {
          const t = el.textContent || '';
          return terms.some(x => t.includes(x)) && el.children.length===0 && el.offsetParent!==null;
        }).map(e => e.textContent.trim().slice(0, 150)), ERROR_TERMS);
      if (found.length > 0) {
        allScans.push({ t: (i+1)*2 + 's', found });
        console.log(`t=${(i+1)*2}s:`, found);

        // Get more context about this element
        const ctx = await page.evaluate(terms => {
          const results = [];
          for (const el of document.querySelectorAll('*')) {
            const t = el.textContent || '';
            if (terms.some(x => t.includes(x)) && el.children.length===0 && el.offsetParent!==null) {
              // Get surrounding text and SQL content
              let p = el.parentElement;
              let sqlContent = '';
              let heading = '';
              for (let i = 0; i < 20; i++) {
                if (!p) break;
                const cm = p.querySelector('.cm-editor');
                if (cm) sqlContent = cm.textContent?.trim().slice(0, 400) || '';
                const h = p.querySelector('h2,h3,h4');
                if (h) heading = h.textContent?.trim() || '';
                p = p.parentElement;
              }
              results.push({ error: el.textContent.trim().slice(0,150), heading, sqlContent });
            }
          }
          return results;
        }, ERROR_TERMS);
        console.log('Context:', JSON.stringify(ctx, null, 2));
      }
    }
  }

  if (allScans.length === 0) {
    console.log('No errors found during Run All monitoring');
  }

  await browser.close();
})();
