/**
 * Generate per-plot-example screenshots for the documentation.
 *
 * Usage (from core/frontend/):
 *   node scripts/gen-plot-screenshots.mjs
 *
 * Requires a running Vite dev server on port 5173 (`npm run dev`).
 * Outputs PNG files to ../../docs-site/img/plots/<NAME>-<index>.png
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../../../docs-site/img/plots');
const APP_SCREENSHOT = resolve(__dirname, '../../../docs-site/page-full.png');
mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = process.env.VITE_URL || 'http://localhost:5173';
const PREVIEW_URL = `${BASE_URL}/plot-preview.html`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark',
});
const page = await ctx.newPage();

// ── 1. App screenshot for docs homepage ────────────────────────────────────
console.log('Taking app screenshot...');
await page.goto(BASE_URL);
const demoBtn = page.getByRole('button', { name: /Try the demo/i });
await demoBtn.waitFor({ state: 'visible', timeout: 30_000 });
await demoBtn.click();
// Wait for notebook and at least one plot to be visible
await page.waitForSelector('h1', { timeout: 60_000 });
await page.waitForTimeout(3000); // let charts render
await page.setViewportSize({ width: 1600, height: 960 });
await page.screenshot({ path: APP_SCREENSHOT });
console.log(`Saved: ${APP_SCREENSHOT}`);

// ── 2. Per-plot screenshots ─────────────────────────────────────────────────
console.log('\nTaking per-plot screenshots...');
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(PREVIEW_URL);
// Wait until at least one data-plot container is present
await page.waitForSelector('[data-plot]', { timeout: 30_000 });
// Give charts time to fully render (recharts uses ResizeObserver)
await page.waitForTimeout(2000);

const plotEls = await page.locator('[data-plot]').all();
console.log(`Found ${plotEls.length} plot containers`);

for (const el of plotEls) {
    const slug = await el.getAttribute('data-plot');
    if (!slug) continue;
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300); // let ResizeObserver settle
    const outPath = resolve(OUT_DIR, `${slug}.png`);
    await el.screenshot({ path: outPath });
    console.log(`  ${slug}.png`);
}

await browser.close();
console.log('\nDone. Images saved to:', OUT_DIR);
