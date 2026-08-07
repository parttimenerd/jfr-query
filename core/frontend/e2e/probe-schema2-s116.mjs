import { chromium } from 'playwright';
const BASE = 'http://localhost:3001';
const LS = [
  { name: 'jfr-tour-seen', value: '1' },
  { name: 'jfrq:onboarding-dismissed', value: '1' },
  { name: 'jfrq:ai-nudge-dismissed', value: '1' },
  { name: 'jfr-sidebar-editor-visible', value: 'true' },
];
(async () => {
  const browser = await chromium.launch({ headless: false }); // headed for visual debug
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [{ origin: BASE, localStorage: LS }] } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  const demo = await page.$('button:has-text("Try the demo")');
  if (demo) { await demo.click(); await page.waitForTimeout(4000); }
  
  // Check sidebar state — look for the sidebar panel
  const sidebar = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('[class*="sidebar"], aside, [role="complementary"]'));
    return candidates.map(c => ({
      tag: c.tagName,
      cls: c.className.slice(0, 80),
      visible: c.offsetParent !== null,
      children: c.children.length,
      html: c.innerHTML.slice(0, 200),
    }));
  });
  console.log('Sidebars:', JSON.stringify(sidebar, null, 2));

  // List all nav/tab-like elements that could be schema toggle
  const navItems = await page.evaluate(() =>
    Array.from(document.querySelectorAll('nav button, [role="tab"], [role="tablist"] button')).map(b => ({
      label: b.getAttribute('aria-label') || '',
      title: b.getAttribute('title') || '',
      text: b.textContent?.trim().slice(0, 30) || '',
      cls: b.className.slice(0, 60),
    }))
  );
  console.log('Nav/tab buttons:', JSON.stringify(navItems, null, 2));

  // Find all buttons with database/table icons (SVG path data patterns)
  const iconBtns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).filter(b => b.querySelector('svg')).map(b => ({
      label: b.getAttribute('aria-label') || '',
      title: b.getAttribute('title') || '',
      text: b.textContent?.trim().slice(0, 30) || '',
    })).filter(b => b.label || b.title)
  );
  console.log('Buttons with SVG icons:', JSON.stringify(iconBtns, null, 2));
  
  await browser.close();
})();
