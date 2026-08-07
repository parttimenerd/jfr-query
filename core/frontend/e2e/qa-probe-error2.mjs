/**
 * Probe: catch exact "Query has errors" in demo during Run All (1s polling)
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';
const ERROR_TERMS = ['Catalog Error','does not exist','Invalid plot',
                     'Query has errors','Binder Error','Parser Error'];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const consoleMsgs = [];
  page.on('console', msg => {
    const t = msg.text();
    if (!['ONNX','recharts','ai-proxy','conditional view','favicon'].some(n => t.includes(n)))
      consoleMsgs.push({ type: msg.type(), text: t.slice(0, 300) });
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

  // Click Run All
  const ra = page.locator('[aria-label="Run All Queries"]');
  if (await ra.isVisible()) await ra.click();

  // Poll every 1s for 30s
  const errorSnapshots = [];
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const snapshot = await page.evaluate((terms) => {
      return Array.from(document.querySelectorAll('*'))
        .filter(el => {
          const t = el.textContent || '';
          return terms.some(x => t.includes(x)) && el.children.length === 0 && el.offsetParent !== null;
        })
        .map(e => {
          let p = e.parentElement;
          let sqlContent = '';
          let heading = '';
          for (let j = 0; j < 20; j++) {
            if (!p) break;
            const cm = p.querySelector('.cm-content');
            if (cm && !sqlContent) sqlContent = (cm.textContent || '').trim().slice(0, 300);
            const h = p.querySelector('h2,h3,h4');
            if (h && !heading) heading = (h.textContent || '').trim();
            p = p.parentElement;
          }
          return { error: (e.textContent || '').trim().slice(0, 150), heading, sqlContent };
        });
    }, ERROR_TERMS);

    if (snapshot.length > 0) {
      errorSnapshots.push({ t: i+1, snapshot });
      console.log('[t=' + (i+1) + 's] ERRORS:', JSON.stringify(snapshot, null, 2));
    }
  }

  if (errorSnapshots.length === 0) {
    console.log('No errors detected during 30s polling');
  }

  if (consoleMsgs.length > 0) {
    console.log('\nConsole messages:');
    consoleMsgs.forEach(m => console.log('  [' + m.type + '] ' + m.text));
  }

  await browser.close();
})();
