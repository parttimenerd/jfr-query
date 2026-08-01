/**
 * Live browser test for JFR Query Notebook at http://localhost:5173
 * Tests: load, demo, prompt chips, plot suggester, model selector
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'http://localhost:5173';
const SCREENSHOTS = [];

async function shot(page, name, note) {
  const path = `/Users/i560383_1/code/experiments/jfr-query/live-test-${name}.png`;
  await page.screenshot({ path, fullPage: false });
  SCREENSHOTS.push({ name, path, note });
  console.log(`  [screenshot] ${name}: ${note}`);
  return path;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);

  const results = [];

  // ── Step 1: App loads ──────────────────────────────────────────
  console.log('\n=== STEP 1: App loads ===');
  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const title = await page.title();
    const h1 = await page.locator('h1, [class*="logo"], [class*="title"], [class*="brand"]').first().textContent().catch(() => '(none)');
    await shot(page, '01-initial-load', `title="${title}" h1="${h1}"`);
    results.push({ step: 1, name: 'App loads', status: 'PASS', detail: `title="${title}", heading="${h1}"` });
    console.log(`  PASS — title="${title}" heading="${h1}"`);
  } catch (e) {
    results.push({ step: 1, name: 'App loads', status: 'FAIL', detail: e.message });
    console.log(`  FAIL — ${e.message}`);
  }

  // ── Step 2: Load demo ──────────────────────────────────────────
  console.log('\n=== STEP 2: Load demo ===');
  try {
    // Look for "Try the demo" button
    const demoBtn = page.getByRole('button', { name: /try.*demo|load.*demo|demo/i }).first();
    const demoLink = page.locator('a, button').filter({ hasText: /try.*demo|demo/i }).first();

    let found = false;
    if (await demoBtn.isVisible().catch(() => false)) {
      await demoBtn.click();
      found = true;
      console.log('  Clicked "Try the demo" button');
    } else if (await demoLink.isVisible().catch(() => false)) {
      await demoLink.click();
      found = true;
      console.log('  Clicked demo link');
    } else {
      // Screenshot to see what's there
      await shot(page, '02-demo-search', 'Looking for demo button');
      const allBtns = await page.locator('button').allTextContents();
      console.log('  Visible buttons:', allBtns.slice(0, 10).join(' | '));
      const allLinks = await page.locator('a').allTextContents();
      console.log('  Visible links:', allLinks.slice(0, 10).join(' | '));
      throw new Error('Could not find demo button. Buttons: ' + allBtns.slice(0, 5).join(', '));
    }

    // Wait for notebook cells to appear (demo loads GC data)
    await page.waitForSelector('[class*="cell"], [class*="notebook"], [class*="Cell"]', { timeout: 15000 });
    await page.waitForTimeout(2000); // let data load
    await shot(page, '02-demo-loaded', 'Demo notebook loaded');

    const cellCount = await page.locator('[class*="cell"], [class*="Cell"]').count();
    results.push({ step: 2, name: 'Load demo', status: 'PASS', detail: `Found ${cellCount} cells after loading demo` });
    console.log(`  PASS — ${cellCount} cells visible`);
  } catch (e) {
    await shot(page, '02-demo-fail', 'Demo load failed');
    results.push({ step: 2, name: 'Load demo', status: 'FAIL', detail: e.message });
    console.log(`  FAIL — ${e.message}`);
  }

  // ── Step 3: PromptSuggester chips ──────────────────────────────
  console.log('\n=== STEP 3: PromptSuggester chips ===');
  try {
    // Find chat panel - look for chat icon or panel toggle
    const chatBtns = page.locator('button, [role="button"]').filter({ hasText: /chat|ai|assistant/i });
    const chatIcon = page.locator('[class*="chat"], [aria-label*="chat"], [title*="chat"]').first();

    // Try to open chat panel if it's not already visible
    const chatPanel = page.locator('[class*="ChatPanel"], [class*="chat-panel"], [class*="chatPanel"]').first();
    const isChatVisible = await chatPanel.isVisible().catch(() => false);

    if (!isChatVisible) {
      // Try clicking chat toggle buttons
      const toggleBtn = page.locator('button[class*="chat"], button[aria-label*="chat"], button[title*="Chat"]').first();
      if (await toggleBtn.isVisible().catch(() => false)) {
        await toggleBtn.click();
        await page.waitForTimeout(500);
        console.log('  Opened chat panel via button');
      } else {
        // Look in sidebar or header for chat toggle
        const sidebarBtns = await page.locator('[class*="sidebar"] button, [class*="header"] button').all();
        for (const btn of sidebarBtns) {
          const txt = await btn.textContent().catch(() => '');
          const aria = await btn.getAttribute('aria-label').catch(() => '');
          if (/chat|ai|message/i.test(txt + aria)) {
            await btn.click();
            await page.waitForTimeout(500);
            console.log(`  Opened chat panel via: "${txt || aria}"`);
            break;
          }
        }
      }
    }

    await shot(page, '03-chat-panel-search', 'Searching for chat panel');

    // Find the chat textarea
    const chatTextarea = page.locator('[class*="ChatPanel"] textarea, [class*="chat"] textarea, [placeholder*="message"], [placeholder*="Ask"], [placeholder*="ask"], [placeholder*="query"]').first();

    if (await chatTextarea.isVisible().catch(() => false)) {
      // Click on it when empty to trigger chips
      await chatTextarea.click();
      await page.waitForTimeout(1000);
      await shot(page, '03-prompt-chips', 'After clicking empty chat textarea');

      // Look for suggestion chips
      const chips = page.locator('[class*="chip"], [class*="Chip"], [class*="suggestion"], [class*="prompt-suggest"], [class*="PromptSuggest"]');
      const chipCount = await chips.count();
      const chipTexts = await chips.allTextContents().catch(() => []);

      results.push({ step: 3, name: 'PromptSuggester chips', status: chipCount > 0 ? 'PASS' : 'PARTIAL', detail: `Found ${chipCount} chips: ${chipTexts.slice(0, 3).join(', ')}` });
      console.log(`  ${chipCount > 0 ? 'PASS' : 'PARTIAL'} — ${chipCount} chips: ${chipTexts.slice(0, 3).join(', ')}`);
    } else {
      // Take screenshot showing current state
      await shot(page, '03-no-chat-textarea', 'No chat textarea found');
      const allTextareas = await page.locator('textarea').count();
      const allInputs = await page.locator('input[type="text"], input:not([type])').count();
      results.push({ step: 3, name: 'PromptSuggester chips', status: 'FAIL', detail: `Chat textarea not found. Total textareas: ${allTextareas}, inputs: ${allInputs}` });
      console.log(`  FAIL — no chat textarea. total textareas=${allTextareas}`);
    }
  } catch (e) {
    await shot(page, '03-fail', 'Prompt chip test failed');
    results.push({ step: 3, name: 'PromptSuggester chips', status: 'FAIL', detail: e.message });
    console.log(`  FAIL — ${e.message}`);
  }

  // ── Step 4: Plot suggester (ML) ────────────────────────────────
  console.log('\n=== STEP 4: Plot suggester ===');
  try {
    // Find an empty cell or add a new one
    // First take a screenshot to understand layout
    await shot(page, '04-before-query', 'Before running SQL query');

    // Look for a code editor (CodeMirror / Monaco)
    const editors = page.locator('[class*="CodeMirror"], .cm-editor, [class*="monaco"]');
    const editorCount = await editors.count();
    console.log(`  Found ${editorCount} code editors`);

    // Find the last/empty cell editor
    let targetEditor = null;
    for (let i = 0; i < Math.min(editorCount, 10); i++) {
      const ed = editors.nth(i);
      const content = await ed.textContent().catch(() => '');
      if (content.trim() === '' || content.trim().length < 10) {
        targetEditor = ed;
        console.log(`  Found empty editor at index ${i}`);
        break;
      }
    }

    if (!targetEditor && editorCount > 0) {
      // Use last editor
      targetEditor = editors.last();
      console.log('  Using last editor');
    }

    if (targetEditor) {
      // Click to focus
      await targetEditor.click();
      await page.waitForTimeout(300);

      // Select all and replace with query
      await page.keyboard.press('Control+a');
      await page.waitForTimeout(100);
      const query = 'SELECT gc_cause, COUNT(*) AS event_count FROM jdk_garbage_collection_young GROUP BY gc_cause ORDER BY event_count DESC LIMIT 10';
      await page.keyboard.type(query);
      await page.waitForTimeout(500);

      // Run the cell (Shift+Enter or Run button)
      await page.keyboard.press('Shift+Enter');
      await page.waitForTimeout(3000);

      await shot(page, '04-after-query-run', 'After running SQL query');

      // Look for plot suggestion chip
      const plotSuggest = page.locator('[class*="PlotSuggest"], [class*="plot-suggest"], [class*="suggest"][class*="plot"], button:has-text("PLOT"), button:has-text("plot"), [class*="chip"]:has-text("PLOT")');
      const plotSuggestCount = await plotSuggest.count();
      const plotTexts = await plotSuggest.allTextContents().catch(() => []);

      results.push({ step: 4, name: 'Plot suggester', status: plotSuggestCount > 0 ? 'PASS' : 'PARTIAL', detail: `Found ${plotSuggestCount} plot suggestion(s): ${plotTexts.slice(0, 3).join(', ')}` });
      console.log(`  ${plotSuggestCount > 0 ? 'PASS' : 'PARTIAL'} — ${plotSuggestCount} plot chips: ${plotTexts.slice(0, 3).join(', ')}`);
    } else {
      results.push({ step: 4, name: 'Plot suggester', status: 'FAIL', detail: 'No code editor found' });
      console.log('  FAIL — no code editor found');
    }
  } catch (e) {
    await shot(page, '04-fail', 'Plot suggester test failed');
    results.push({ step: 4, name: 'Plot suggester', status: 'FAIL', detail: e.message });
    console.log(`  FAIL — ${e.message}`);
  }

  // ── Step 5: Chat panel model selector ─────────────────────────
  console.log('\n=== STEP 5: Chat panel model selector ===');
  try {
    // Look for model selector in chat panel area
    const modelSelector = page.locator('select[class*="model"], select[aria-label*="model"], [class*="ModelSelector"], [class*="model-selector"], [class*="modelSelector"]').first();
    const providerSelector = page.locator('select[class*="provider"], [class*="ProviderSelector"], [class*="provider-selector"]').first();

    // Also look for any dropdown/select with model names
    const modelDropdown = page.locator('[class*="ChatPanel"] select, [class*="chat"] select, [class*="chat"] [class*="select"], [class*="chat"] [role="combobox"]').first();

    const hasModel = await modelSelector.isVisible().catch(() => false);
    const hasProvider = await providerSelector.isVisible().catch(() => false);
    const hasDropdown = await modelDropdown.isVisible().catch(() => false);

    // Take screenshot of chat area
    const chatArea = page.locator('[class*="ChatPanel"], [class*="chat-panel"]').first();
    if (await chatArea.isVisible().catch(() => false)) {
      await chatArea.scrollIntoViewIfNeeded().catch(() => {});
    }
    await shot(page, '05-model-selector', 'Chat panel model selector area');

    // Look for any text mentioning model/provider names
    const modelText = await page.locator('[class*="chat"]').textContent().catch(() => '');
    const modelPatterns = /gpt|claude|gemini|llama|mistral|model|provider|openai|anthropic/i.test(modelText);

    const status = (hasModel || hasProvider || hasDropdown || modelPatterns) ? 'PASS' : 'FAIL';
    results.push({ step: 5, name: 'Model selector', status, detail: `modelSelector=${hasModel}, providerSelector=${hasProvider}, dropdown=${hasDropdown}, textContainsModel=${modelPatterns}` });
    console.log(`  ${status} — modelSel=${hasModel}, providerSel=${hasProvider}, dropdown=${hasDropdown}, modelText=${modelPatterns}`);
  } catch (e) {
    await shot(page, '05-fail', 'Model selector test failed');
    results.push({ step: 5, name: 'Model selector', status: 'FAIL', detail: e.message });
    console.log(`  FAIL — ${e.message}`);
  }

  await browser.close();

  // ── Summary ────────────────────────────────────────────────────
  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`  Step ${r.step} [${r.status}] ${r.name}: ${r.detail}`);
  }
  console.log('\nScreenshots saved:');
  for (const s of SCREENSHOTS) {
    console.log(`  ${s.path}`);
  }

  writeFileSync('/Users/i560383_1/code/experiments/jfr-query/live-test-results.json', JSON.stringify(results, null, 2));
  console.log('\nResults saved to live-test-results.json');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
