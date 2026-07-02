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
const HERO_URL = `${BASE_URL}/hero-preview.html`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark',
});
const page = await ctx.newPage();

// ── 1. App screenshot for docs homepage ────────────────────────────────────
console.log('Taking hero screenshot...');
await page.goto(HERO_URL);
// Wait for at least one plot container
await page.waitForSelector('[data-plot], .recharts-wrapper, svg', { timeout: 30_000 });
await page.waitForTimeout(3000); // let charts render
// Capture just the hero div (full page, auto-height)
await page.setViewportSize({ width: 1280, height: 900 });
await page.screenshot({ path: APP_SCREENSHOT, fullPage: true });
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
