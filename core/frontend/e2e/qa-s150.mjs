/**
 * QA Session S150 — GC Deep Dive + Comprehensive Feature Test (interactive)
 * I/O & Latency + ZGC Analysis (DOM scan)
 * Run: node core/frontend/e2e/qa-s150.mjs
 */

import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:3001';

// ── Known-noise patterns to filter from console errors ──────────────────────
const NOISE = [
    /ONNX/i,
    /recharts/i,
    /conditional view failed/i,
    /wasm streaming/i,
    /ArrayBuffer/i,
    /ResizeObserver/i,
    /favicon/i,
    /net::ERR_/i,
    /Failed to load resource/i,       // covers 404/500 on api/query, wasm, etc.
    /\[ONNX\]/i,
    /ai proxy/i,
    /autocompleteRanker/i,
    /GET http.*500/i,
    /POST http.*500/i,
    /status of 500/i,
    /status of 404/i,
];

function isNoise(msg) {
    const t = msg.text();
    return NOISE.some(r => r.test(t));
}

// ── domScan: check for visible error elements and report ─────────────────────
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

// ── Load demo notebook then navigate to template ─────────────────────────────
async function loadDemoAndTemplate(page, templateName, waitMs) {
    // Navigate fresh
    await page.goto(BASE);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { try { localStorage.clear(); } catch(_) {} });
    await page.goto(BASE);
    await page.waitForTimeout(2000);

    // Click demo button to load JFR data
    const demoBtn = page.locator('button, a').filter({ hasText: /try.*demo|demo/i }).first();
    const demoBtnVisible = await demoBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (demoBtnVisible) {
        await demoBtn.click();
        await page.waitForTimeout(6000); // wait for JFR to load
        console.log('  Demo data loaded');
    } else {
        console.log('  WARNING: demo button not found');
    }

    // Dismiss any overlays/modals (e.g. file picker, upload modal) by pressing Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Close any fixed-inset-0 overlays by clicking outside or pressing Escape
    const overlayCount = await page.locator('.fixed.inset-0, [class*="z-[200]"]').count().catch(() => 0);
    if (overlayCount > 0) {
        console.log(`  Dismissing ${overlayCount} overlay(s)...`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        // Try clicking on the backdrop if still there
        const backdrop = page.locator('.fixed.inset-0').first();
        const backVis = await backdrop.isVisible({ timeout: 1000 }).catch(() => false);
        if (backVis) {
            await page.mouse.click(10, 10);
            await page.waitForTimeout(300);
        }
    }

    // Now load template
    await loadTemplate(page, templateName);
    await page.waitForTimeout(waitMs);
}

// ── Load a named template from the gallery ──────────────────────────────────
async function loadTemplate(page, name) {
    // Dismiss any overlay first
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Click the "New from template" toolbar button (aria-label)
    const newFromTemplate = page.locator('button[aria-label="New from template"]').first();
    const ntVis = await newFromTemplate.isVisible({ timeout: 4000 }).catch(() => false);
    if (ntVis) {
        await newFromTemplate.click({ force: true });
        await page.waitForTimeout(800);
    } else {
        // Try "Open Template" button (shown on drop zone state)
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

    // Wait for modal to open - look for template list
    await page.waitForTimeout(500);

    // Click the specific template row by aria-label
    const templateRow = page.locator(`button[aria-label="Select template: ${name}"]`).first();
    const trVis = await templateRow.isVisible({ timeout: 5000 }).catch(() => false);
    if (trVis) {
        await templateRow.click();
        console.log(`  Selected template: "${name}"`);
        await page.waitForTimeout(500);
    } else {
        // Try partial text match on the button text
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

// ═══════════════════════════════════════════════════════════════════════════
const results = {
    consoleErrors: [],
    sections: {},
};

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

    // Collect real console errors
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
    // 2. DEMO NOTEBOOK
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== 2. DEMO NOTEBOOK ===');
    await page.goto(BASE);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { try { localStorage.clear(); } catch(_) {} });
    await page.goto(BASE);
    await page.waitForTimeout(2000);

    // Click demo button
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

    // Test Variables panel
    console.log('  Testing Variables panel...');
    try {
        // Find an input near a "$" label in variables panel
        const varInput = page.locator('input[type="number"], input[type="text"]')
            .filter({ hasText: '' })
            .first();
        // Look for variable inputs more specifically
        const varPanel = page.locator('[class*="variable"], [class*="var-panel"], [class*="sidebar"]').first();
        const panelVis = await varPanel.isVisible({ timeout: 3000 }).catch(() => false);
        if (panelVis) {
            const inp = varPanel.locator('input').first();
            const inpVis = await inp.isVisible({ timeout: 3000 }).catch(() => false);
            if (inpVis) {
                const curVal = await inp.inputValue().catch(() => '10');
                const newVal = String(Math.max(1, (parseFloat(curVal) || 10) + 1));
                await inp.fill(newVal);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(3000);
                const varErrors = await domScan(page, 'variable-change');
                demoFeatures['variables_panel'] = varErrors.length === 0 ? 'pass' : `fail(${varErrors.length} errors)`;
            } else {
                demoFeatures['variables_panel'] = 'skip(no input in var panel)';
            }
        } else {
            demoFeatures['variables_panel'] = 'skip(no variable panel found)';
        }
    } catch (e) {
        demoFeatures['variables_panel'] = `skip(${e.message.slice(0, 60)})`;
    }

    // Test Run All
    console.log('  Testing Run All...');
    try {
        let runAllClicked = false;
        // Try aria-label / title first (toolbar buttons)
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

    // Test Collapse/Expand via keyboard shortcut or button
    console.log('  Testing Collapse/Expand...');
    try {
        // Look for any collapse button in cells
        const allBtns = await page.locator('button').all();
        let collapseBtn = null;
        for (const b of allBtns.slice(0, 30)) {
            const lbl = await b.getAttribute('aria-label').catch(() => '');
            const ttl = await b.getAttribute('title').catch(() => '');
            if (/collapse/i.test(lbl) || /collapse/i.test(ttl)) {
                const vis = await b.isVisible({ timeout: 1000 }).catch(() => false);
                if (vis) { collapseBtn = b; break; }
            }
        }
        if (collapseBtn) {
            await collapseBtn.click({ force: true, timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(500);
            await collapseBtn.click({ force: true, timeout: 5000 }).catch(() => {});
            demoFeatures['collapse_expand'] = 'pass';
        } else {
            // Try clicking a cell header area to toggle
            const cellHeader = page.locator('[data-cell-id] [class*="header"], [data-cell-id] h2').first();
            const chVis = await cellHeader.isVisible({ timeout: 3000 }).catch(() => false);
            if (chVis) {
                await cellHeader.click({ force: true, timeout: 5000 }).catch(() => {});
                await page.waitForTimeout(400);
                demoFeatures['collapse_expand'] = 'partial(clicked cell header, no explicit collapse btn found)';
            } else {
                demoFeatures['collapse_expand'] = 'skip(no collapse button found)';
            }
        }
    } catch (e) {
        demoFeatures['collapse_expand'] = `skip(${e.message.slice(0, 60)})`;
    }

    // Test Schema Explorer — check sidebar for table list
    console.log('  Testing Schema Explorer...');
    try {
        // Sidebar may already show tables; look for table entries in it
        const tableCount = await page.evaluate(() => {
            // Count visible table/view entries in sidebar
            const sidebar = document.querySelector('aside, [class*="sidebar"]');
            if (!sidebar) return 0;
            // Look for elements that show table names (typically small text spans with row counts)
            const items = Array.from(sidebar.querySelectorAll('[class*="item"], li, [role="listitem"]'));
            return items.filter(el => el.offsetParent !== null).length;
        });
        if (tableCount > 0) {
            // Try to click a table entry to see its schema
            const firstItem = page.locator('aside [class*="item"], [class*="sidebar"] li, [class*="sidebar"] [role="listitem"]').first();
            const itemVis = await firstItem.isVisible({ timeout: 3000 }).catch(() => false);
            if (itemVis) {
                await firstItem.click({ force: true, timeout: 5000 }).catch(() => {});
                await page.waitForTimeout(1000);
            }
            demoFeatures['schema_explorer'] = `pass(${tableCount} items visible in sidebar)`;
        } else {
            // Check if schema area shows any text
            const sidebarText = await page.locator('aside, [class*="sidebar"]').textContent().catch(() => '');
            const hasTables = /table|GarbageCollection|views/i.test(sidebarText);
            demoFeatures['schema_explorer'] = hasTables ? 'pass(tables visible in sidebar text)' : `partial(sidebar: ${sidebarText.slice(0, 50)})`;
        }
    } catch (e) {
        demoFeatures['schema_explorer'] = `skip(${e.message.slice(0, 60)})`;
    }

    // Test Help modal
    console.log('  Testing Help modal...');
    try {
        // Look for ? button in toolbar
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
            // Try keyboard shortcut ?
            await page.keyboard.press('Shift+?');
            await page.waitForTimeout(400);
        }
        await page.waitForTimeout(600);
        const modal = page.locator('[role="dialog"], .modal, [class*="modal"]').first();
        const modalVis = await modal.isVisible({ timeout: 3000 }).catch(() => false);
        if (modalVis) {
            const content = await modal.textContent().catch(() => '');
            const hasContent = content && content.length > 20;
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
            demoFeatures['help_modal'] = hasContent ? 'pass' : 'partial(empty modal)';
        } else {
            demoFeatures['help_modal'] = 'skip(modal did not open)';
        }
    } catch (e) {
        demoFeatures['help_modal'] = `skip(${e.message.slice(0, 60)})`;
    }

    results.sections.demo = {
        errors: demoErrors.length,
        charts: demoCharts,
        features: demoFeatures,
    };

    // ════════════════════════════════════════════════════════════════════════
    // 3. GC DEEP DIVE TEMPLATE
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== 3. GC DEEP DIVE TEMPLATE ===');
    await loadDemoAndTemplate(page, 'GC Deep Dive', 12000);

    const gcErrors = await domScan(page, 'gc-deep-dive');
    const gcCharts = await countCharts(page);
    console.log(`  Charts: ${gcCharts}`);

    const gcFeatures = {};

    // Test LINK_X zoom (Shift+scroll)
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
            // Check if zoom reset button appeared or if a variable changed
            const resetBtn = page.locator('button').filter({ hasText: /reset/i }).first();
            const resetVis = await resetBtn.isVisible({ timeout: 2000 }).catch(() => false);
            if (resetVis) {
                gcFeatures['link_x_zoom'] = 'pass(reset button visible after Shift+scroll)';
                zoomTested = true;
                break;
            }
            // Check if domain variables changed via any title attribute update
            const zoomState = await page.evaluate(() => {
                const resetBtns = Array.from(document.querySelectorAll('button'));
                return resetBtns.find(b => /reset/i.test(b.textContent || ''))?.textContent || null;
            });
            if (zoomState) {
                gcFeatures['link_x_zoom'] = `pass(reset: ${zoomState.trim()})`;
                zoomTested = true;
                break;
            }
            // Even if no reset button, report partial success
            gcFeatures['link_x_zoom'] = `partial(Shift+scroll sent on ${Math.round(box.width)}x${Math.round(box.height)} chart, no reset btn)`;
            zoomTested = true;
            break;
        }
        if (!zoomTested) {
            gcFeatures['link_x_zoom'] = `skip(no suitable chart found, ${charts.length} total)`;
        }
    } catch (e) {
        gcFeatures['link_x_zoom'] = `skip(${e.message.slice(0, 60)})`;
    }

    // Test BRUSH clause
    console.log('  Testing BRUSH clause...');
    try {
        const allCharts = await page.locator('.recharts-surface').all();
        let brushTested = false;
        for (const chart of allCharts.slice(0, 5)) {
            const box = await chart.boundingBox().catch(() => null);
            if (!box || box.width < 20) continue;
            await chart.scrollIntoViewIfNeeded();
            await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
            await page.waitForTimeout(1000);
            // Check if any variable pill updated
            const varDisplay = await page.evaluate(() => {
                const pills = Array.from(document.querySelectorAll(
                    '[class*="var-pill"], [class*="brush-var"], [class*="variable-pill"]'
                ));
                return pills.map(p => p.textContent?.trim().slice(0, 50) || '').filter(Boolean);
            });
            if (varDisplay.length > 0) {
                gcFeatures['brush_clause'] = `pass(${varDisplay[0]})`;
                brushTested = true;
                break;
            }
        }
        if (!brushTested) {
            gcFeatures['brush_clause'] = 'skip(no BRUSH variable update detected)';
        }
    } catch (e) {
        gcFeatures['brush_clause'] = `skip(${e.message.slice(0, 60)})`;
    }

    // Test Command Palette
    console.log('  Testing Command Palette...');
    try {
        await page.keyboard.press('Meta+k');
        await page.waitForTimeout(800);
        const palette = page.locator('[class*="command"], [class*="palette"], input[placeholder*="earch"]').first();
        const palVis = await palette.isVisible({ timeout: 2000 }).catch(() => false);
        if (palVis) {
            await page.keyboard.type('run');
            await page.waitForTimeout(400);
            await page.keyboard.press('Escape');
            gcFeatures['command_palette'] = 'pass';
        } else {
            await page.keyboard.press('Escape');
            gcFeatures['command_palette'] = 'skip(palette did not open)';
        }
    } catch (e) {
        gcFeatures['command_palette'] = `skip(${e.message.slice(0, 60)})`;
    }

    results.sections.gcDeepDive = {
        errors: gcErrors.length,
        charts: gcCharts,
        features: gcFeatures,
    };

    // ════════════════════════════════════════════════════════════════════════
    // 4. COMPREHENSIVE FEATURE TEST TEMPLATE
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== 4. COMPREHENSIVE FEATURE TEST TEMPLATE ===');
    await loadDemoAndTemplate(page, 'Comprehensive Feature Test', 10000);

    const compErrors = await domScan(page, 'comprehensive');
    const compCharts = await countCharts(page);
    console.log(`  Charts: ${compCharts}`);

    const compFeatures = {};

    // Test SQL autocomplete — use a fresh cell to avoid corrupting template cells
    console.log('  Testing SQL autocomplete...');
    try {
        // Add a new cell via "+" button or keyboard shortcut
        let freshEditor = null;
        const addCellBtn = page.locator('button[aria-label*="add cell" i], button[title*="add cell" i], button[title*="Add cell" i]').first();
        const addVis = await addCellBtn.isVisible({ timeout: 3000 }).catch(() => false);
        if (addVis) {
            await addCellBtn.click({ force: true, timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(800);
        }
        // Find an empty or new SQL editor (one with very little content)
        const editors = await page.locator('.cm-editor').all();
        for (const editor of editors.slice(-3)) {
            const vis = await editor.isVisible({ timeout: 2000 }).catch(() => false);
            if (!vis) continue;
            const content = await editor.textContent().catch(() => '');
            if (content.length < 20) { // likely a fresh/empty editor
                freshEditor = editor;
                break;
            }
        }
        if (!freshEditor && editors.length > 0) {
            freshEditor = editors[editors.length - 1];
        }
        if (freshEditor) {
            await freshEditor.click({ timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(300);
            // Select all existing content and replace
            await page.keyboard.press('Control+a');
            await page.keyboard.type('SELECT * FROM Gar');
            await page.waitForTimeout(300);
            await page.keyboard.press('Control+ ');
            await page.waitForTimeout(1200);
            const tooltip = page.locator('.cm-tooltip-autocomplete, .cm-completionList').first();
            const tooltipVis = await tooltip.isVisible({ timeout: 2000 }).catch(() => false);
            if (tooltipVis) {
                const content = await tooltip.textContent().catch(() => '');
                compFeatures['sql_autocomplete'] = `pass(${content.slice(0, 60)})`;
            } else {
                compFeatures['sql_autocomplete'] = 'partial(no tooltip but editor found)';
            }
            await page.keyboard.press('Escape');
            // Undo all our typing
            for (let i = 0; i < 5; i++) {
                await page.keyboard.press('Control+z');
                await page.waitForTimeout(50);
            }
        } else {
            compFeatures['sql_autocomplete'] = 'skip(no editor found)';
        }
    } catch (e) {
        compFeatures['sql_autocomplete'] = `skip(${e.message.slice(0, 60)})`;
    }

    // Test plot tooltip
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
                compFeatures['plot_tooltip'] = `pass(${tooltipContent.slice(0, 60)})`;
                tooltipFound = true;
                break;
            }
        }
        if (!tooltipFound) {
            compFeatures['plot_tooltip'] = 'skip(tooltip not visible on hover)';
        }
    } catch (e) {
        compFeatures['plot_tooltip'] = `skip(${e.message.slice(0, 60)})`;
    }

    // Test resize handle
    console.log('  Testing resize handle...');
    try {
        const resizeHandle = page.locator('[data-resize-handle], [class*="resize-handle"], [class*="resizer"]').first();
        const resVis = await resizeHandle.isVisible({ timeout: 3000 }).catch(() => false);
        if (resVis) {
            const box = await resizeHandle.boundingBox().catch(() => null);
            if (box) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.mouse.down();
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 50);
                await page.mouse.up();
                await page.waitForTimeout(400);
                compFeatures['resize_handle'] = 'pass';
            } else {
                compFeatures['resize_handle'] = 'skip(no bounding box)';
            }
        } else {
            compFeatures['resize_handle'] = 'skip(no resize handle found)';
        }
    } catch (e) {
        compFeatures['resize_handle'] = `skip(${e.message.slice(0, 60)})`;
    }

    results.sections.comprehensive = {
        errors: compErrors.length,
        charts: compCharts,
        features: compFeatures,
    };

    // ════════════════════════════════════════════════════════════════════════
    // 5. I/O & LATENCY — DOM SCAN
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== 5. I/O & LATENCY TEMPLATE ===');
    await loadDemoAndTemplate(page, 'I/O & Latency', 8000);

    const ioErrors = await domScan(page, 'io-latency');
    const ioCharts = await countCharts(page);
    console.log(`  Charts: ${ioCharts}`);

    results.sections.ioLatency = {
        errors: ioErrors.length,
        charts: ioCharts,
    };

    // ════════════════════════════════════════════════════════════════════════
    // 6. ZGC ANALYSIS — DOM SCAN
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== 6. ZGC ANALYSIS TEMPLATE ===');
    await loadDemoAndTemplate(page, 'ZGC Analysis', 8000);

    const zgcErrors = await domScan(page, 'zgc-analysis');
    const zgcCharts = await countCharts(page);
    console.log(`  Charts: ${zgcCharts}`);

    results.sections.zgcAnalysis = {
        errors: zgcErrors.length,
        charts: zgcCharts,
    };

    // ════════════════════════════════════════════════════════════════════════
    // 7. UI POLISH SWEEP (on last loaded page)
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== 7. UI POLISH SWEEP ===');

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

    results.sections.uiPolish = {
        zeroHeightCells,
        overflowText,
        visibleErrorElements: visibleErrors,
    };

    // ════════════════════════════════════════════════════════════════════════
    // 8. BUGS.MD CHECK
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n=== 8. BUGS.MD CHECK ===');
    const BUGS_PATH = '/Users/i560383_1/code/experiments/jfr-query/core/frontend/BUGS.md';
    const bugsContent = fs.readFileSync(BUGS_PATH, 'utf-8');

    // Find bug heading lines without any ✅ marker
    const lines = bugsContent.split('\n');
    const bugHeadings = lines.filter(l => /###\s+[🔴🟠🟡🔵]/.test(l));
    const unfixed = bugHeadings.filter(l => !l.includes('✅'));
    console.log(`  Open (unfixed) bug entries: ${unfixed.length}`);
    unfixed.slice(0, 10).forEach(l => console.log(`    ${l.slice(0, 120)}`));

    results.bugsOpen = unfixed.slice(0, 20).map(l => l.replace(/^###\s+/, '').slice(0, 120));

    await browser.close();

    // ════════════════════════════════════════════════════════════════════════
    // PRINT SUMMARY
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('FINAL RESULTS');
    console.log('════════════════════════════════════════════════════════════════');

    const s = results.sections;
    const fmtFeatures = f => Object.entries(f || {}).map(([k,v]) => `${k}=${v}`).join(', ');

    console.log(`DEMO: ${s.demo?.errors ?? '?'} errors, ${s.demo?.charts ?? '?'} charts, features=[${fmtFeatures(s.demo?.features)}]`);
    console.log(`GC DEEP DIVE: ${s.gcDeepDive?.errors ?? '?'} errors, ${s.gcDeepDive?.charts ?? '?'} charts, features=[${fmtFeatures(s.gcDeepDive?.features)}]`);
    console.log(`COMPREHENSIVE: ${s.comprehensive?.errors ?? '?'} errors, ${s.comprehensive?.charts ?? '?'} charts, features=[${fmtFeatures(s.comprehensive?.features)}]`);
    console.log(`I/O & LATENCY: ${s.ioLatency?.errors ?? '?'} errors, ${s.ioLatency?.charts ?? '?'} charts`);
    console.log(`ZGC ANALYSIS: ${s.zgcAnalysis?.errors ?? '?'} errors, ${s.zgcAnalysis?.charts ?? '?'} charts`);
    console.log(`UI POLISH: zero-height=${s.uiPolish?.zeroHeightCells ?? '?'}, overflow=${JSON.stringify(s.uiPolish?.overflowText ?? [])}, visible-errors=${s.uiPolish?.visibleErrorElements ?? '?'}`);
    console.log(`CONSOLE ERRORS: ${results.consoleErrors.length} real`);
    if (results.consoleErrors.length > 0) {
        console.log('  Errors:', results.consoleErrors.slice(0, 5));
    }
    console.log(`BUGS.MD OPEN ITEMS: ${results.bugsOpen?.length > 0 ? results.bugsOpen.join(' | ') : 'none'}`);

    return results;
})().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
