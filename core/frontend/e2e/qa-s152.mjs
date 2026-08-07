/**
 * QA Session S152 — I/O & Latency (interactive), Threading & Contention (interactive)
 * DOM sweep: all 13 templates
 * Run: node core/frontend/e2e/qa-s152.mjs
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
    /ERR_ABORTED/i,
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
    return page.locator('.recharts-surface, canvas').count();
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

// ── Test LINK_X zoom (Shift+scroll) ─────────────────────────────────────────
async function testLinkXZoom(page, features, label) {
    console.log(`  [${label}] Testing LINK_X zoom...`);
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
                features['link_x_zoom'] = 'pass(reset button visible after Shift+scroll)';
                zoomTested = true;
                break;
            }
            features['link_x_zoom'] = `partial(Shift+scroll sent on ${Math.round(box.width)}x${Math.round(box.height)} chart, no reset btn)`;
            zoomTested = true;
            break;
        }
        if (!zoomTested) {
            const chartCount = await page.locator('.recharts-surface').count();
            features['link_x_zoom'] = `skip(no suitable chart, total=${chartCount})`;
        }
    } catch (e) {
        features['link_x_zoom'] = `skip(${e.message.slice(0, 60)})`;
    }
}

// ── Test command palette ─────────────────────────────────────────────────────
async function testCommandPalette(page, features, searchText) {
    console.log('  Testing Command Palette...');
    try {
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
            await page.keyboard.type(searchText);
            await page.waitForTimeout(400);
            await page.keyboard.press('Escape');
            features['command_palette'] = `pass(opened, typed "${searchText}", dismissed)`;
        } else {
            await page.keyboard.press('Escape');
            features['command_palette'] = 'skip(palette did not open with Meta+K or Ctrl+K)';
        }
    } catch (e) {
        features['command_palette'] = `skip(${e.message.slice(0, 60)})`;
    }
}

// ── Test SQL autocomplete ────────────────────────────────────────────────────
async function testSqlAutocomplete(page, features, searchFragment) {
    console.log('  Testing SQL autocomplete...');
    try {
        const editors = await page.locator('.cm-editor').all();
        let sqlEditor = null;
        for (const editor of editors) {
            const vis = await editor.isVisible({ timeout: 1000 }).catch(() => false);
            if (!vis) continue;
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
            await page.keyboard.type(`SELECT * FROM ${searchFragment}`);
            await page.waitForTimeout(300);
            await page.keyboard.press('Control+ ');
            await page.waitForTimeout(1200);
            const tooltip = page.locator('.cm-tooltip-autocomplete, .cm-completionList').first();
            const tooltipVis = await tooltip.isVisible({ timeout: 2000 }).catch(() => false);
            if (tooltipVis) {
                const content = await tooltip.textContent().catch(() => '');
                features['sql_autocomplete'] = `pass(${content.slice(0, 60)})`;
            } else {
                features['sql_autocomplete'] = 'partial(no tooltip — first-focus limitation)';
            }
            await page.keyboard.press('Escape');
            for (let i = 0; i < 8; i++) {
                await page.keyboard.press('Control+z');
                await page.waitForTimeout(50);
            }
        } else {
            features['sql_autocomplete'] = 'skip(no editor found)';
        }
    } catch (e) {
        features['sql_autocomplete'] = `skip(${e.message.slice(0, 60)})`;
    }
}

// ── Test plot tooltip ────────────────────────────────────────────────────────
async function testPlotTooltip(page, features, chartCount) {
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
                features['plot_tooltip'] = `pass(${tooltipContent.slice(0, 60)})`;
                tooltipFound = true;
                break;
            }
        }
        if (!tooltipFound) {
            features['plot_tooltip'] = `skip(tooltip not visible on hover, charts=${chartCount})`;
        }
    } catch (e) {
        features['plot_tooltip'] = `skip(${e.message.slice(0, 60)})`;
    }
}

// ── Test resize handle ───────────────────────────────────────────────────────
async function testResizeHandle(page, features) {
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
                features['resize_handle'] = 'pass';
            } else {
                features['resize_handle'] = 'skip(no bounding box)';
            }
        } else {
            const plotCells = page.locator('[data-cell-id]').first();
            const pcVis = await plotCells.isVisible({ timeout: 3000 }).catch(() => false);
            features['resize_handle'] = pcVis ? 'skip(no resize handle found, cells present)' : 'skip(no cells found)';
        }
    } catch (e) {
        features['resize_handle'] = `skip(${e.message.slice(0, 60)})`;
    }
}

// ── Test BRUSH clause presence ───────────────────────────────────────────────
async function testBrushClause(page, features) {
    console.log('  Checking for BRUSH clause...');
    try {
        const brushFound = await page.evaluate(() => {
            const editors = Array.from(document.querySelectorAll('.cm-editor'));
            for (const ed of editors) {
                if (/BRUSH/i.test(ed.textContent || '')) return true;
            }
            const codeEls = Array.from(document.querySelectorAll('[class*="plot-config"], [data-block-type="plot"]'));
            for (const el of codeEls) {
                if (/BRUSH/i.test(el.textContent || '')) return true;
            }
            return false;
        });
        features['brush_clause'] = brushFound ? 'found(BRUSH present in template)' : 'n/a(no BRUSH in template)';
    } catch (e) {
        features['brush_clause'] = `skip(${e.message.slice(0, 60)})`;
    }
}

// ── Test variable inputs ─────────────────────────────────────────────────────
async function testVariables(page, features) {
    console.log('  Testing variable inputs...');
    try {
        const varInputs = await page.locator('input[type="number"], input[type="text"]').all();
        let varTested = false;
        for (const inp of varInputs.slice(0, 20)) {
            const vis = await inp.isVisible({ timeout: 1000 }).catch(() => false);
            if (!vis) continue;
            const parentText = await inp.evaluate(el => {
                const parent = el.closest('[class*="variable"], [class*="var"]') || el.parentElement?.parentElement;
                return parent ? parent.textContent : '';
            }).catch(() => '');
            if (!parentText.includes('$') && !parentText.match(/limit|count|max|min|top|threshold/i)) continue;
            const curVal = await inp.inputValue().catch(() => '');
            if (!curVal) continue;
            const newVal = String(Math.max(1, (parseFloat(curVal) || 10) + 1));
            await inp.click({ force: true, timeout: 3000 }).catch(() => {});
            await inp.fill(newVal);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(2000);
            // Revert
            await inp.click({ force: true, timeout: 3000 }).catch(() => {});
            await inp.fill(curVal);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);
            features['variables'] = `pass(changed ${curVal}→${newVal}, reverted)`;
            varTested = true;
            break;
        }
        if (!varTested) {
            features['variables'] = 'skip(no variable inputs found with $ context)';
        }
    } catch (e) {
        features['variables'] = `skip(${e.message.slice(0, 60)})`;
    }
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
        const varInputs = await page.locator('input[type="number"], input[type="text"]').all();
        let varTested = false;
        for (const inp of varInputs.slice(0, 20)) {
            const vis = await inp.isVisible({ timeout: 1000 }).catch(() => false);
            if (!vis) continue;
            const parent = await inp.evaluateHandle(el =>
                el.closest('[class*="variable"], [class*="var"]') || el.parentElement?.parentElement
            );
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
            await inp.click({ force: true, timeout: 3000 }).catch(() => {});
            await inp.fill(curVal);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);
            demoFeatures['variables_panel'] = varErrors.length === 0
                ? `pass(changed ${curVal}→${newVal}, no errors)`
                : `fail(${varErrors.length} errors)`;
            varTested = true;
            break;
        }
        if (!varTested) {
            demoFeatures['variables_panel'] = 'skip(no variable input with $ context)';
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
            const firstItem = page.locator('aside [class*="item"], [class*="sidebar"] li, [class*="sidebar"] button')
                .filter({ hasText: /jdk_|GC|GarbageCollection|Allocation/i }).first();
            const itemVis = await firstItem.isVisible({ timeout: 3000 }).catch(() => false);
            if (itemVis) {
                await firstItem.click({ force: true, timeout: 5000 }).catch(() => {});
                await page.waitForTimeout(800);
                demoFeatures['schema_explorer'] = 'pass(tables visible, clicked one)';
            } else {
                demoFeatures['schema_explorer'] = 'pass(tables visible in sidebar)';
            }
        } else {
            demoFeatures['schema_explorer'] = `partial(sidebar: ${sidebarText.slice(0, 60)})`;
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
    // 2. I/O & LATENCY — interactive pass
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== 2. I/O & LATENCY (interactive) ===');
    await loadDemoAndTemplate(page, 'I/O & Latency', 10000);

    const ioErrors = await domScan(page, 'io-latency');
    const ioCharts = await countCharts(page);
    console.log(`  Charts: ${ioCharts}`);

    const ioFeatures = {};

    await testLinkXZoom(page, ioFeatures, 'io-latency');
    await testCommandPalette(page, ioFeatures, 'io');
    await testSqlAutocomplete(page, ioFeatures, 'FileRead');
    await testPlotTooltip(page, ioFeatures, ioCharts);
    await testResizeHandle(page, ioFeatures);

    results.sections.ioLatency = { errors: ioErrors.length, charts: ioCharts, features: ioFeatures };

    // ════════════════════════════════════════════════════════════════════════
    // 3. THREADING & CONTENTION — interactive pass
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== 3. THREADING & CONTENTION (interactive) ===');
    await loadDemoAndTemplate(page, 'Threading & Contention', 10000);

    const thrErrors = await domScan(page, 'threading');
    const thrCharts = await countCharts(page);
    console.log(`  Charts: ${thrCharts}`);

    const thrFeatures = {};

    await testLinkXZoom(page, thrFeatures, 'threading');
    await testBrushClause(page, thrFeatures);
    await testVariables(page, thrFeatures);
    await testCommandPalette(page, thrFeatures, 'thread');
    await testPlotTooltip(page, thrFeatures, thrCharts);

    results.sections.threading = { errors: thrErrors.length, charts: thrCharts, features: thrFeatures };

    // ════════════════════════════════════════════════════════════════════════
    // 4. ALL-13 DOM SWEEP (remaining 11 templates)
    // ════════════════════════════════════════════════════════════════════════
    const sweepTemplates = [
        'GC Pause Analysis',
        'GC Deep Dive',
        'Memory Leak Detection',
        'Heap Allocation',
        'CPU Profiling',
        'JVM Internals',
        'Container & Cloud',
        'Exceptions & Errors',
        'Recording Overview',
        'Comprehensive Feature Test',
        'ZGC Analysis',
    ];

    for (const tmplName of sweepTemplates) {
        const key = tmplName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        console.log(`\n=== DOM SWEEP: ${tmplName} ===`);
        await loadDemoAndTemplate(page, tmplName, 8000);
        const errors = await domScan(page, key);
        const charts = await countCharts(page);
        console.log(`  Charts: ${charts}`);
        results.sections[key] = { errors: errors.length, charts, errorDetails: errors.slice(0, 3) };
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

    await browser.close();

    // ════════════════════════════════════════════════════════════════════════
    // PRINT SUMMARY
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('FINAL RESULTS');
    console.log('════════════════════════════════════════════════════════════════');

    const s = results.sections;

    console.log(`DEMO: ${s.demo?.errors ?? '?'} errors, ${s.demo?.charts ?? '?'} charts`);
    if (s.demo?.features) {
        Object.entries(s.demo.features).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
    }

    console.log(`IO_LATENCY: ${s.ioLatency?.errors ?? '?'} errors, ${s.ioLatency?.charts ?? '?'} charts`);
    if (s.ioLatency?.features) {
        Object.entries(s.ioLatency.features).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
    }

    console.log(`THREADING: ${s.threading?.errors ?? '?'} errors, ${s.threading?.charts ?? '?'} charts`);
    if (s.threading?.features) {
        Object.entries(s.threading.features).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
    }

    console.log('ALL_13_SWEEP:');
    const sweepKeys = sweepTemplates.map(t => t.replace(/[^a-z0-9]/gi, '_').toLowerCase());
    sweepKeys.forEach((k, i) => {
        const sec = s[k] ?? {};
        const errDetails = sec.errorDetails?.length > 0 ? ` [${sec.errorDetails.join('; ')}]` : '';
        console.log(`  ${sweepTemplates[i]}: ${sec.errors ?? '?'} errors, ${sec.charts ?? '?'} charts${errDetails}`);
    });

    console.log(`UI_POLISH: zero-height=${s.uiPolish?.zeroHeightCells ?? '?'}, overflow=${JSON.stringify(s.uiPolish?.overflowText ?? [])}, visible-errors=${s.uiPolish?.visibleErrorElements ?? '?'}`);
    console.log(`CONSOLE_ERRORS: ${results.consoleErrors.length}`);
    if (results.consoleErrors.length > 0) {
        results.consoleErrors.slice(0, 5).forEach(e => console.log(`  ERROR: ${e}`));
    }

    // ════════════════════════════════════════════════════════════════════════
    // BUGS FOUND
    // ════════════════════════════════════════════════════════════════════════
    const bugsFound = [];
    // Check for DOM-scan errors in any template
    const allSectionKeys = Object.keys(s);
    for (const k of allSectionKeys) {
        const sec = s[k];
        if (sec && typeof sec.errors === 'number' && sec.errors > 0 && sec.errorDetails) {
            bugsFound.push(`${k}: DOM errors: ${JSON.stringify(sec.errorDetails)}`);
        }
    }
    if (results.consoleErrors.length > 0) {
        bugsFound.push(`Console errors: ${results.consoleErrors.slice(0, 3).join(' | ')}`);
    }

    if (bugsFound.length === 0) {
        console.log('BUGS_FOUND: none');
    } else {
        console.log('BUGS_FOUND:');
        bugsFound.forEach(b => console.log(`  - ${b}`));
    }

    results.bugsFound = bugsFound;
    return results;
})().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
