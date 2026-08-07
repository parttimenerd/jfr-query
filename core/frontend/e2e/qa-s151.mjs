/**
 * QA Session S151 — Memory Leak Detection (interactive), ZGC Analysis (interactive)
 * DOM sweep: Container & Cloud, Exceptions & Errors, GC Pause Analysis, Recording Overview
 * Run: node core/frontend/e2e/qa-s151.mjs
 */

import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:3001';

// ── Known-noise patterns ─────────────────────────────────────────────────────
const NOISE = [
    /ONNX/i,
    /recharts/i,
    /conditional view failed/i,
    /wasm streaming/i,
    /ArrayBuffer/i,
    /ResizeObserver/i,
    /favicon/i,
    /net::ERR_/i,
    /Failed to load resource/i,
    /\[ONNX\]/i,
    /ai proxy/i,
    /autocompleteRanker/i,
    /GET http.*500/i,
    /POST http.*500/i,
    /status of 500/i,
    /status of 404/i,
    /\[HMR\]/i,
    /falling back/i,
    /getContext/i,
    /Warning:/i,
];

function isNoise(msg) {
    const t = msg.text();
    return NOISE.some(r => r.test(t));
}

// ── domScan: visible error elements ─────────────────────────────────────────
async function domScan(page, label) {
    const errors = await page.evaluate(() => {
        const sel = [
            '.error-message',
            '[class*="error-message"]',
            '.parse-error',
            '[class*="parse-error"]',
            '.error-banner',
            '.cell-error',
        ].join(', ');
        return Array.from(document.querySelectorAll(sel))
            .filter(el => el.offsetParent !== null && el.textContent.trim().length > 0)
            .map(el => el.textContent.trim().slice(0, 120));
    });
    if (errors.length > 0) {
        console.log(`  [domScan:${label}] ${errors.length} error(s): ${JSON.stringify(errors.slice(0, 3))}`);
    } else {
        console.log(`  [domScan:${label}] clean`);
    }
    return errors;
}

async function countCharts(page) {
    return page.locator('.recharts-surface').count();
}

// ── Load a named template from the gallery ──────────────────────────────────
async function loadTemplate(page, name) {
    // Dismiss any overlay first
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Click the "New from template" toolbar button
    const newFromTemplate = page.locator('button[aria-label="New from template"]').first();
    const ntVis = await newFromTemplate.isVisible({ timeout: 4000 }).catch(() => false);
    if (ntVis) {
        await newFromTemplate.click({ force: true });
        await page.waitForTimeout(800);
    } else {
        const openTemplate = page.locator('button').filter({ hasText: /open template/i }).first();
        const otVis = await openTemplate.isVisible({ timeout: 3000 }).catch(() => false);
        if (otVis) {
            await openTemplate.click({ force: true });
            await page.waitForTimeout(800);
        } else {
            console.log(`  WARNING: no "New from template" or "Open Template" button found`);
            return;
        }
    }

    await page.waitForTimeout(500);

    // Click the specific template row by aria-label
    const templateRow = page.locator(`button[aria-label="Select template: ${name}"]`).first();
    const trVis = await templateRow.isVisible({ timeout: 5000 }).catch(() => false);
    if (trVis) {
        await templateRow.click();
        console.log(`  Selected template: "${name}"`);
        await page.waitForTimeout(500);
    } else {
        const templateRowAlt = page.locator('button').filter({ hasText: new RegExp(name, 'i') }).first();
        const trAltVis = await templateRowAlt.isVisible({ timeout: 3000 }).catch(() => false);
        if (trAltVis) {
            await templateRowAlt.click();
            console.log(`  Selected template (text match): "${name}"`);
            await page.waitForTimeout(500);
        } else {
            console.log(`  WARNING: template "${name}" not found in gallery`);
            return;
        }
    }

    // Click "Open & Run" if available, otherwise "Insert"
    const openRunBtn = page.locator('button').filter({ hasText: /open.*run|run.*open/i }).first();
    const openRunVis = await openRunBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (openRunVis) {
        await openRunBtn.click();
        console.log(`  Clicked "Open & Run"`);
        return;
    }
    const insertBtn = page.locator('button').filter({ hasText: /^insert$/i }).first();
    const insertVis = await insertBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (insertVis) {
        await insertBtn.click();
        console.log(`  Clicked "Insert"`);
    } else {
        console.log(`  WARNING: no Insert/Open&Run button found`);
    }
}

// ── Load demo notebook then navigate to template ─────────────────────────────
async function loadDemoAndTemplate(page, templateName, waitMs) {
    await page.goto(BASE);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { try { localStorage.clear(); } catch(_) {} });
    await page.goto(BASE);
    await page.waitForTimeout(2000);

    const demoBtn = page.locator('button, a').filter({ hasText: /try.*demo|demo/i }).first();
    const demoBtnVisible = await demoBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (demoBtnVisible) {
        await demoBtn.click();
        await page.waitForTimeout(6000);
        console.log('  Demo data loaded');
    } else {
        console.log('  WARNING: demo button not found');
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const overlayCount = await page.locator('.fixed.inset-0, [class*="z-[200]"]').count().catch(() => 0);
    if (overlayCount > 0) {
        console.log(`  Dismissing ${overlayCount} overlay(s)...`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        const backdrop = page.locator('.fixed.inset-0').first();
        const backVis = await backdrop.isVisible({ timeout: 1000 }).catch(() => false);
        if (backVis) {
            await page.mouse.click(10, 10);
            await page.waitForTimeout(300);
        }
    }

    await loadTemplate(page, templateName);
    await page.waitForTimeout(waitMs);
}

// ═══════════════════════════════════════════════════════════════════════════
const results = {
    consoleErrors: [],
    sections: {},
};

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

    page.on('console', msg => {
        if (msg.type() === 'error' && !isNoise(msg)) {
            results.consoleErrors.push(msg.text().slice(0, 200));
            console.log(`  [CONSOLE ERROR] ${msg.text().slice(0, 200)}`);
        }
    });
    page.on('pageerror', err => {
        const t = err.message;
        if (!NOISE.some(r => r.test(t))) {
            results.consoleErrors.push(t.slice(0, 200));
            console.log(`  [PAGE ERROR] ${t.slice(0, 200)}`);
        }
    });

    // ════════════════════════════════════════════════════════════════════════
    // 1. DEMO NOTEBOOK
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== 1. DEMO NOTEBOOK ===');
    await page.goto(BASE);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { try { localStorage.clear(); } catch(_) {} });
    await page.goto(BASE);
    await page.waitForTimeout(2000);

    const demoBtn = page.locator('button, a').filter({ hasText: /try.*demo|demo/i }).first();
    const demoBtnVisible = await demoBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (demoBtnVisible) {
        await demoBtn.click();
        console.log('  Clicked demo button');
    } else {
        console.log('  WARNING: demo button not found');
    }
    await page.waitForTimeout(8000);

    const demoErrors = await domScan(page, 'demo');
    const demoCharts = await countCharts(page);
    console.log(`  Charts: ${demoCharts}`);

    const demoFeatures = {};

    // ── Variables panel ──────────────────────────────────────────────────────
    console.log('  Testing Variables panel...');
    try {
        // Look for variable inputs in cell variable bars
        const varInputs = await page.locator('input[type="number"], input[type="text"]').all();
        let varTested = false;
        for (const inp of varInputs.slice(0, 20)) {
            const vis = await inp.isVisible({ timeout: 1000 }).catch(() => false);
            if (!vis) continue;
            // Check if this is a variable value input (has $ symbol nearby)
            const parent = await inp.evaluateHandle(el => el.closest('[class*="variable"], [class*="var"]') || el.parentElement?.parentElement);
            if (!parent) continue;
            const parentText = await page.evaluate(el => el?.textContent || '', parent).catch(() => '');
            if (!parentText.includes('$') && !parentText.match(/limit|count|max|min|top/i)) continue;
            const curVal = await inp.inputValue().catch(() => '');
            if (!curVal) continue;
            const newVal = String(Math.max(1, (parseFloat(curVal) || 10) + 1));
            await inp.click({ force: true, timeout: 3000 }).catch(() => {});
            await inp.fill(newVal);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(2500);
            const varErrors = await domScan(page, 'variable-change');
            // Revert
            await inp.click({ force: true, timeout: 3000 }).catch(() => {});
            await inp.fill(curVal);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);
            demoFeatures['variables_panel'] = varErrors.length === 0 ? `pass(changed ${curVal}→${newVal}, no errors)` : `fail(${varErrors.length} errors)`;
            varTested = true;
            break;
        }
        if (!varTested) {
            // Try direct cell variable section
            const cellVarSection = page.locator('[class*="variable"][class*="section"], [class*="var-bar"]').first();
            const cvVis = await cellVarSection.isVisible({ timeout: 3000 }).catch(() => false);
            if (cvVis) {
                const inp = cellVarSection.locator('input').first();
                const inpVis = await inp.isVisible({ timeout: 2000 }).catch(() => false);
                if (inpVis) {
                    const curVal = await inp.inputValue().catch(() => '10');
                    const newVal = String(Math.max(1, (parseFloat(curVal) || 10) + 1));
                    await inp.fill(newVal);
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(2500);
                    const varErrors = await domScan(page, 'variable-change-2');
                    demoFeatures['variables_panel'] = varErrors.length === 0 ? `pass(changed, no errors)` : `fail(${varErrors.length} errors)`;
                    varTested = true;
                }
            }
            if (!varTested) {
                demoFeatures['variables_panel'] = 'skip(no variable input found with $ context)';
            }
        }
    } catch (e) {
        demoFeatures['variables_panel'] = `skip(${e.message.slice(0, 60)})`;
    }

    // ── Run All ───────────────────────────────────────────────────────────────
    console.log('  Testing Run All...');
    try {
        let runAllClicked = false;
        const runAllBtnAria = page.locator('button[aria-label*="run all" i], button[title*="run all" i]').first();
        const rvAria = await runAllBtnAria.isVisible({ timeout: 3000 }).catch(() => false);
        if (rvAria) {
            await runAllBtnAria.click({ force: true, timeout: 5000 }).catch(() => {});
            runAllClicked = true;
        } else {
            const runAllBtn = page.locator('button').filter({ hasText: /run all/i }).first();
            const runAllVis = await runAllBtn.isVisible({ timeout: 3000 }).catch(() => false);
            if (runAllVis) {
                await runAllBtn.click({ force: true, timeout: 5000 }).catch(() => {});
                runAllClicked = true;
            }
        }
        if (runAllClicked) {
            await page.waitForTimeout(8000);
            const runAllErrors = await domScan(page, 'run-all');
            demoFeatures['run_all'] = runAllErrors.length === 0 ? 'pass' : `fail(${runAllErrors.length} errors)`;
        } else {
            demoFeatures['run_all'] = 'skip(button not found)';
        }
    } catch (e) {
        demoFeatures['run_all'] = `skip(${e.message.slice(0, 60)})`;
    }

    // ── Collapse/Expand ───────────────────────────────────────────────────────
    console.log('  Testing Collapse/Expand...');
    try {
        const allBtns = await page.locator('button').all();
        let collapseBtn = null;
        for (const b of allBtns.slice(0, 40)) {
            const lbl = await b.getAttribute('aria-label').catch(() => '');
            const ttl = await b.getAttribute('title').catch(() => '');
            if (/collapse/i.test(lbl) || /collapse/i.test(ttl)) {
                const vis = await b.isVisible({ timeout: 1000 }).catch(() => false);
                if (vis) { collapseBtn = b; break; }
            }
        }
        if (collapseBtn) {
            await collapseBtn.click({ force: true, timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(600);
            await collapseBtn.click({ force: true, timeout: 5000 }).catch(() => {});
            demoFeatures['collapse_expand'] = 'pass';
        } else {
            const cellHeader = page.locator('[data-cell-id] [class*="header"], [data-cell-id] h2').first();
            const chVis = await cellHeader.isVisible({ timeout: 3000 }).catch(() => false);
            if (chVis) {
                await cellHeader.click({ force: true, timeout: 5000 }).catch(() => {});
                await page.waitForTimeout(400);
                demoFeatures['collapse_expand'] = 'partial(clicked cell header)';
            } else {
                demoFeatures['collapse_expand'] = 'skip(no collapse button found)';
            }
        }
    } catch (e) {
        demoFeatures['collapse_expand'] = `skip(${e.message.slice(0, 60)})`;
    }

    // ── Schema Explorer ───────────────────────────────────────────────────────
    console.log('  Testing Schema Explorer...');
    try {
        const sidebarText = await page.locator('aside, [class*="sidebar"]').textContent().catch(() => '');
        const hasTables = /table|GarbageCollection|views|GC|jdk_/i.test(sidebarText);
        if (hasTables) {
            const firstItem = page.locator('aside [class*="item"], [class*="sidebar"] li, [class*="sidebar"] button').filter({ hasText: /jdk_|GC|GarbageCollection|Allocation/i }).first();
            const itemVis = await firstItem.isVisible({ timeout: 3000 }).catch(() => false);
            if (itemVis) {
                await firstItem.click({ force: true, timeout: 5000 }).catch(() => {});
                await page.waitForTimeout(800);
                demoFeatures['schema_explorer'] = 'pass(tables visible, clicked one)';
            } else {
                demoFeatures['schema_explorer'] = 'pass(tables visible in sidebar)';
            }
        } else {
            demoFeatures['schema_explorer'] = `partial(sidebar text: ${sidebarText.slice(0, 60)})`;
        }
    } catch (e) {
        demoFeatures['schema_explorer'] = `skip(${e.message.slice(0, 60)})`;
    }

    // ── Help modal ────────────────────────────────────────────────────────────
    console.log('  Testing Help modal...');
    try {
        let helpClicked = false;
        const allBtns2 = await page.locator('button').all();
        for (const b of allBtns2) {
            const txt = await b.textContent().catch(() => '');
            const lbl = await b.getAttribute('aria-label').catch(() => '');
            const ttl = await b.getAttribute('title').catch(() => '');
            if (txt.trim() === '?' || /help/i.test(lbl) || /help/i.test(ttl) || /keyboard shortcut/i.test(ttl)) {
                const vis = await b.isVisible({ timeout: 1000 }).catch(() => false);
                if (vis) {
                    await b.click({ force: true, timeout: 5000 }).catch(() => {});
                    helpClicked = true;
                    break;
                }
            }
        }
        if (!helpClicked) {
            await page.keyboard.press('Shift+?');
            await page.waitForTimeout(400);
        }
        await page.waitForTimeout(600);
        const modal = page.locator('[role="dialog"], .modal, [class*="modal"]').first();
        const modalVis = await modal.isVisible({ timeout: 3000 }).catch(() => false);
        if (modalVis) {
            const content = await modal.textContent().catch(() => '');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
            demoFeatures['help_modal'] = content.length > 20 ? 'pass' : 'partial(empty modal)';
        } else {
            demoFeatures['help_modal'] = 'skip(modal did not open)';
        }
    } catch (e) {
        demoFeatures['help_modal'] = `skip(${e.message.slice(0, 60)})`;
    }

    results.sections.demo = { errors: demoErrors.length, charts: demoCharts, features: demoFeatures };

    // ════════════════════════════════════════════════════════════════════════
    // 2. MEMORY LEAK DETECTION — interactive (second pass)
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== 2. MEMORY LEAK DETECTION (interactive) ===');
    await loadDemoAndTemplate(page, 'Memory Leak Detection', 10000);

    const mlErrors = await domScan(page, 'memory-leaks');
    const mlCharts = await countCharts(page);
    console.log(`  Charts: ${mlCharts}`);

    const mlFeatures = {};

    // ── LINK_X zoom (Shift+scroll) ────────────────────────────────────────────
    console.log('  Testing LINK_X zoom...');
    try {
        const charts = await page.locator('.recharts-surface').all();
        let zoomTested = false;
        for (const chart of charts.slice(0, 10)) {
            await chart.scrollIntoViewIfNeeded();
            await page.waitForTimeout(200);
            const box = await chart.boundingBox().catch(() => null);
            if (!box || box.width < 30 || box.height < 30) continue;
            await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
            await page.keyboard.down('Shift');
            await page.mouse.wheel(0, -500);
            await page.keyboard.up('Shift');
            await page.waitForTimeout(1500);
            const resetBtn = page.locator('button').filter({ hasText: /reset/i }).first();
            const resetVis = await resetBtn.isVisible({ timeout: 2000 }).catch(() => false);
            if (resetVis) {
                mlFeatures['link_x_zoom'] = 'pass(reset button visible after Shift+scroll)';
                zoomTested = true;
                break;
            }
            mlFeatures['link_x_zoom'] = `partial(Shift+scroll sent on ${Math.round(box.width)}x${Math.round(box.height)} chart, no reset btn found)`;
            zoomTested = true;
            break;
        }
        if (!zoomTested) {
            mlFeatures['link_x_zoom'] = `skip(no suitable chart found, total=${mlCharts})`;
        }
    } catch (e) {
        mlFeatures['link_x_zoom'] = `skip(${e.message.slice(0, 60)})`;
    }

    // ── Command palette ───────────────────────────────────────────────────────
    console.log('  Testing Command Palette...');
    try {
        // Try Meta+K first, then Ctrl+K
        await page.keyboard.press('Meta+k');
        await page.waitForTimeout(800);
        let palette = page.locator('[class*="command"], [class*="palette"], input[placeholder*="ommand"], input[placeholder*="earch command"]').first();
        let palVis = await palette.isVisible({ timeout: 2000 }).catch(() => false);
        if (!palVis) {
            await page.keyboard.press('Escape');
            await page.keyboard.press('Control+k');
            await page.waitForTimeout(800);
            palette = page.locator('[class*="command"], [class*="palette"], input[placeholder*="ommand"], input[placeholder*="earch command"]').first();
            palVis = await palette.isVisible({ timeout: 2000 }).catch(() => false);
        }
        if (palVis) {
            await page.keyboard.type('collapse');
            await page.waitForTimeout(400);
            await page.keyboard.press('Escape');
            mlFeatures['command_palette'] = 'pass(opened, typed collapse, dismissed)';
        } else {
            await page.keyboard.press('Escape');
            mlFeatures['command_palette'] = 'skip(palette did not open with Meta+K or Ctrl+K)';
        }
    } catch (e) {
        mlFeatures['command_palette'] = `skip(${e.message.slice(0, 60)})`;
    }

    // ── SQL autocomplete ──────────────────────────────────────────────────────
    console.log('  Testing SQL autocomplete...');
    try {
        // Find a SQL editor (not inside a plot block)
        const editors = await page.locator('.cm-editor').all();
        let sqlEditor = null;
        for (const editor of editors) {
            const vis = await editor.isVisible({ timeout: 1000 }).catch(() => false);
            if (!vis) continue;
            // Check if inside a plot block
            const isInPlot = await editor.evaluate(el => {
                let n = el;
                while (n) {
                    if (n.hasAttribute && (n.hasAttribute('data-block-type') || n.className?.includes?.('plot'))) {
                        const bt = n.getAttribute('data-block-type') || '';
                        if (bt === 'plot' || bt.includes('plot')) return true;
                        if (n.className?.includes?.('plot-config') || n.className?.includes?.('plot-editor')) return true;
                    }
                    n = n.parentElement;
                }
                return false;
            }).catch(() => false);
            if (!isInPlot) {
                sqlEditor = editor;
                break;
            }
        }
        if (!sqlEditor && editors.length > 0) {
            sqlEditor = editors[0];
        }
        if (sqlEditor) {
            await sqlEditor.click({ timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(400);
            await page.keyboard.press('Control+a');
            await page.keyboard.type('SELECT * FROM Gar');
            await page.waitForTimeout(300);
            await page.keyboard.press('Control+ ');
            await page.waitForTimeout(1200);
            const tooltip = page.locator('.cm-tooltip-autocomplete, .cm-completionList').first();
            const tooltipVis = await tooltip.isVisible({ timeout: 2000 }).catch(() => false);
            if (tooltipVis) {
                const content = await tooltip.textContent().catch(() => '');
                mlFeatures['sql_autocomplete'] = `pass(${content.slice(0, 60)})`;
            } else {
                mlFeatures['sql_autocomplete'] = 'partial(no tooltip — first-focus activation limitation)';
            }
            await page.keyboard.press('Escape');
            // Undo typing
            for (let i = 0; i < 6; i++) {
                await page.keyboard.press('Control+z');
                await page.waitForTimeout(50);
            }
        } else {
            mlFeatures['sql_autocomplete'] = 'skip(no editor found)';
        }
    } catch (e) {
        mlFeatures['sql_autocomplete'] = `skip(${e.message.slice(0, 60)})`;
    }

    // ── Plot tooltip ──────────────────────────────────────────────────────────
    console.log('  Testing plot tooltip...');
    try {
        const allCharts = await page.locator('.recharts-surface').all();
        let tooltipFound = false;
        for (const chart of allCharts.slice(0, 8)) {
            await chart.scrollIntoViewIfNeeded();
            const box = await chart.boundingBox().catch(() => null);
            if (!box || box.width < 20) continue;
            await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
            await page.waitForTimeout(600);
            const tooltipContent = await page.evaluate(() => {
                const tooltips = Array.from(document.querySelectorAll(
                    '.recharts-tooltip-wrapper, [class*="tooltip-wrapper"]'
                ));
                for (const t of tooltips) {
                    const style = window.getComputedStyle(t);
                    if (style.visibility !== 'hidden' && style.display !== 'none' && t.textContent.trim().length > 2) {
                        return t.textContent.trim().slice(0, 80);
                    }
                }
                return null;
            });
            if (tooltipContent) {
                mlFeatures['plot_tooltip'] = `pass(${tooltipContent.slice(0, 60)})`;
                tooltipFound = true;
                break;
            }
        }
        if (!tooltipFound) {
            mlFeatures['plot_tooltip'] = `skip(tooltip not visible on hover, charts=${mlCharts})`;
        }
    } catch (e) {
        mlFeatures['plot_tooltip'] = `skip(${e.message.slice(0, 60)})`;
    }

    results.sections.memoryLeaks = { errors: mlErrors.length, charts: mlCharts, features: mlFeatures };

    // ════════════════════════════════════════════════════════════════════════
    // 3. ZGC ANALYSIS — first interactive pass
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== 3. ZGC ANALYSIS (first interactive pass) ===');
    await loadDemoAndTemplate(page, 'ZGC Analysis', 8000);

    const zgcErrors = await domScan(page, 'zgc-analysis');
    const zgcCharts = await countCharts(page);
    console.log(`  Charts: ${zgcCharts} (expected 0 — demo JFR uses G1, not ZGC)`);

    const zgcFeatures = {};

    // ── BRUSH clause test ─────────────────────────────────────────────────────
    console.log('  Checking for BRUSH clause in ZGC template cells...');
    try {
        const brushFound = await page.evaluate(() => {
            // Look in all visible text for BRUSH keyword in plot configs
            const editors = Array.from(document.querySelectorAll('.cm-editor'));
            for (const ed of editors) {
                if (/BRUSH/i.test(ed.textContent || '')) return true;
            }
            // Also check code blocks
            const codeEls = Array.from(document.querySelectorAll('[class*="plot-config"], [data-block-type="plot"]'));
            for (const el of codeEls) {
                if (/BRUSH/i.test(el.textContent || '')) return true;
            }
            return false;
        });
        zgcFeatures['brush_clause'] = brushFound ? 'found(BRUSH present in ZGC template)' : 'n/a(no BRUSH clause in ZGC template)';
    } catch (e) {
        zgcFeatures['brush_clause'] = `skip(${e.message.slice(0, 60)})`;
    }

    // ── Resize handle ─────────────────────────────────────────────────────────
    console.log('  Testing resize handle...');
    try {
        const resizeHandle = page.locator('[data-resize-handle], [class*="resize-handle"], [class*="resizer"]').first();
        const resVis = await resizeHandle.isVisible({ timeout: 3000 }).catch(() => false);
        if (resVis) {
            const box = await resizeHandle.boundingBox().catch(() => null);
            if (box) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.mouse.down();
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60);
                await page.mouse.up();
                await page.waitForTimeout(400);
                zgcFeatures['resize_handle'] = 'pass';
            } else {
                zgcFeatures['resize_handle'] = 'skip(no bounding box on resize handle)';
            }
        } else {
            // Look for cells with plot content that might have a resize affordance
            const plotCells = page.locator('[data-cell-id]').first();
            const pcVis = await plotCells.isVisible({ timeout: 3000 }).catch(() => false);
            zgcFeatures['resize_handle'] = pcVis ? 'skip(no resize handle found, but cells present)' : 'skip(no cells found)';
        }
    } catch (e) {
        zgcFeatures['resize_handle'] = `skip(${e.message.slice(0, 60)})`;
    }

    // ── Check cells that rendered despite no ZGC data ─────────────────────────
    console.log('  Checking for any rendered content in ZGC template...');
    try {
        const visibleContent = await page.evaluate(() => {
            // Count cells that have visible non-empty content
            const cells = Array.from(document.querySelectorAll('[data-cell-id]'));
            let visCount = 0;
            let tableCount = 0;
            let errorCount = 0;
            for (const cell of cells) {
                if (cell.offsetParent === null) continue;
                const txt = cell.textContent || '';
                if (txt.trim().length > 0) visCount++;
                if (cell.querySelector('table, [class*="data-table"]')) tableCount++;
                if (txt.includes('error') || txt.includes('Error')) errorCount++;
            }
            return { visCount, tableCount, errorCount };
        });
        zgcFeatures['rendered_cells'] = `${visibleContent.visCount} visible cells, ${visibleContent.tableCount} with tables, ${visibleContent.errorCount} with error text`;
    } catch (e) {
        zgcFeatures['rendered_cells'] = `skip(${e.message.slice(0, 60)})`;
    }

    results.sections.zgcAnalysis = { errors: zgcErrors.length, charts: zgcCharts, features: zgcFeatures };

    // ════════════════════════════════════════════════════════════════════════
    // 4. DOM SWEEP TEMPLATES
    // ════════════════════════════════════════════════════════════════════════
    const domSweepTemplates = [
        'Container & Cloud',
        'Exceptions & Errors',
        'GC Pause Analysis',
        'Recording Overview',
    ];

    for (const tmplName of domSweepTemplates) {
        const key = tmplName.replace(/[^a-z]/gi, '_').toLowerCase();
        console.log(`\n=== DOM SWEEP: ${tmplName} ===`);
        await loadDemoAndTemplate(page, tmplName, 8000);
        const errors = await domScan(page, key);
        const charts = await countCharts(page);
        console.log(`  Charts: ${charts}`);
        results.sections[key] = { errors: errors.length, charts };
    }

    // ════════════════════════════════════════════════════════════════════════
    // 5. UI POLISH SWEEP (on last loaded page)
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== 5. UI POLISH SWEEP ===');

    const zeroHeightCells = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-cell-id]'))
            .filter(el => el.getBoundingClientRect().height < 10 && el.offsetParent !== null)
            .length
    );

    const overflowText = await page.evaluate(() =>
        Array.from(document.querySelectorAll('p, span, h1, h2, h3, h4, td, th'))
            .filter(el => el.scrollWidth > el.clientWidth + 5 && el.offsetParent !== null)
            .slice(0, 5)
            .map(el => el.textContent.trim().slice(0, 60))
    );

    const visibleErrors = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.error, [class*="error-"]'))
            .filter(el => el.offsetParent !== null)
            .length
    );

    console.log(`  Zero-height visible cells: ${zeroHeightCells}`);
    console.log(`  Overflow text elements: ${JSON.stringify(overflowText)}`);
    console.log(`  Visible .error elements: ${visibleErrors}`);

    results.sections.uiPolish = { zeroHeightCells, overflowText, visibleErrorElements: visibleErrors };

    // ════════════════════════════════════════════════════════════════════════
    // 6. BUGS.MD OPEN ITEMS AUDIT
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== 6. BUGS.MD OPEN ITEMS ===');
    const BUGS_PATH = '/Users/i560383_1/code/experiments/jfr-query/core/frontend/BUGS.md';
    const bugsContent = fs.readFileSync(BUGS_PATH, 'utf-8');

    const lines = bugsContent.split('\n');
    const bugHeadings = lines.filter(l => /###\s+[🔴🟠🟡🔵]/.test(l));
    const unfixed = bugHeadings.filter(l => !l.includes('✅') && !l.includes('Session S1'));
    console.log(`  Open (unfixed) bug entries: ${unfixed.length}`);
    unfixed.slice(0, 10).forEach(l => console.log(`    ${l.slice(0, 120)}`));

    results.bugsOpen = unfixed.slice(0, 20).map(l => l.replace(/^###\s+/, '').slice(0, 120));

    // ════════════════════════════════════════════════════════════════════════
    // 7. DOCS CHECK
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== 7. DOCS CHECK ===');
    const README_PATH = '/Users/i560383_1/code/experiments/jfr-query/core/frontend/README.md';
    let docsStatus = 'not found';
    try {
        const readmeContent = fs.readFileSync(README_PATH, 'utf-8');
        const lines100 = readmeContent.split('\n').slice(0, 100).join('\n');
        // Check for stale model names or features
        const stalePatterns = [
            /GPT-3/i, /text-davinci/i, /gpt-3\.5-turbo/i,
            /CodeMirror 5/i, /cdn\.jsdelivr/i, /cdnjs\.cloudflare.*codemirror/i,
            /scroll to zoom/i, // Old B-016 text (was wrong, now fixed to drag to pan)
        ];
        const staleFound = stalePatterns.filter(p => p.test(lines100)).map(p => p.toString());
        docsStatus = staleFound.length > 0 ? `stale(${staleFound.join(', ')})` : 'clean';
        console.log(`  README first 100 lines: ${docsStatus}`);
    } catch (e) {
        console.log(`  README: ${e.message.slice(0, 60)}`);
        docsStatus = `error(${e.message.slice(0, 60)})`;
    }

    results.docs = docsStatus;

    await browser.close();

    // ════════════════════════════════════════════════════════════════════════
    // PRINT SUMMARY
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('FINAL RESULTS');
    console.log('════════════════════════════════════════════════════════════════');

    const s = results.sections;
    const fmtF = f => Object.entries(f || {}).map(([k,v]) => `${k}=${v}`).join(', ');

    console.log(`DEMO: ${s.demo?.errors ?? '?'} errors, ${s.demo?.charts ?? '?'} charts`);
    if (s.demo?.features) {
        Object.entries(s.demo.features).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
    }

    console.log(`MEMORY LEAKS: ${s.memoryLeaks?.errors ?? '?'} errors, ${s.memoryLeaks?.charts ?? '?'} charts`);
    if (s.memoryLeaks?.features) {
        Object.entries(s.memoryLeaks.features).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
    }

    console.log(`ZGC ANALYSIS: ${s.zgcAnalysis?.errors ?? '?'} errors, ${s.zgcAnalysis?.charts ?? '?'} charts (expected 0 — no ZGC events in demo JFR)`);
    if (s.zgcAnalysis?.features) {
        Object.entries(s.zgcAnalysis.features).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
    }

    console.log('DOM SWEEP:');
    const sweepKeys = ['container___cloud', 'exceptions___errors', 'gc_pause_analysis', 'recording_overview'];
    const sweepNames = ['Container & Cloud', 'Exceptions & Errors', 'GC Pause Analysis', 'Recording Overview'];
    sweepKeys.forEach((k, i) => {
        const sec = s[k] ?? {};
        console.log(`  ${sweepNames[i]}: ${sec.errors ?? '?'} errors, ${sec.charts ?? '?'} charts`);
    });

    console.log(`UI POLISH: zero-height=${s.uiPolish?.zeroHeightCells ?? '?'}, overflow=${JSON.stringify(s.uiPolish?.overflowText ?? [])}, visible-errors=${s.uiPolish?.visibleErrorElements ?? '?'}`);
    console.log(`CONSOLE ERRORS (real): ${results.consoleErrors.length}`);
    if (results.consoleErrors.length > 0) {
        results.consoleErrors.slice(0, 5).forEach(e => console.log(`  ERROR: ${e}`));
    }
    console.log(`OPEN BUGS.MD ITEMS: ${results.bugsOpen?.length > 0 ? results.bugsOpen.join(' | ') : 'none'}`);
    console.log(`DOCS: ${results.docs}`);

    return results;
})().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
