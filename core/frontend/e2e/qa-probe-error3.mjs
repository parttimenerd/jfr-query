/**
 * Deep probe: capture "Query has errors" with full context during Run All in demo
 * Scan at 500ms intervals with very tight timing
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
  await page.waitForTimeout(3000);

  // Start scanning at 500ms intervals before clicking Run All
  const snapshots = [];
  let scanning = true;

  const scanLoop = async () => {
    while (scanning) {
      await page.waitForTimeout(500);
      try {
        const found = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('*'))
            .filter(el => {
              const t = el.textContent || '';
              return t.includes('Query has errors') && el.children.length === 0 && el.offsetParent !== null;
            })
            .map(e => {
              let p = e.parentElement;
              let result = { error: (e.textContent || '').trim(), cellHtml: '', sqlHtml: '', heading: '' };
              for (let i = 0; i < 30; i++) {
                if (!p) break;
                const sql = p.querySelector('.cm-content');
                if (sql) result.sqlHtml = (sql.textContent || '').trim().slice(0, 400);
                const h = p.querySelector('h2,h3,h4');
                if (h) result.heading = (h.textContent || '').trim();
                if (p.className && (p.className.includes('prose') || p.className.includes('cell'))) {
                  result.cellHtml = p.innerHTML?.slice(0, 300) || '';
                  break;
                }
                p = p.parentElement;
              }
              return result;
            });
        });
        if (found.length > 0) {
          snapshots.push({ time: Date.now(), found });
        }
      } catch (e) { /* page may be navigating */ }
    }
  };

  // Start scan loop (non-blocking)
  const scanPromise = scanLoop();

  // Run All
  const ra = page.locator('[aria-label="Run All Queries"]');
  if (await ra.isVisible()) {
    console.log('Clicking Run All...');
    await ra.click();
    await page.waitForTimeout(40000); // wait 40s
  }

  scanning = false;
  await scanPromise.catch(() => {});

  if (snapshots.length === 0) {
    console.log('No "Query has errors" detected at any point');
  } else {
    console.log('Error snapshots captured:');
    snapshots.forEach(s => console.log(JSON.stringify(s, null, 2)));
  }

  await browser.close();
})();
