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
  page.setDefaultTimeout(25000);

  const results = [];

  // Step 1: App loads
  console.log('\n=== STEP 1: App loads ===');
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body.innerText);
    await shot(page, '01-initial-load', `title="${title}"`);
    results.push({ step: 1, name: 'App loads', status: 'PASS', detail: `title="${title}", body starts with: "${bodyText.slice(0, 80)}"` });
    console.log(`  PASS — title="${title}"`);
  } catch (e) {
    results.push({ step: 1, name: 'App loads', status: 'FAIL', detail: e.message });
    console.log(`  FAIL — ${e.message}`);
  }

  // Step 2: Load demo
  console.log('\n=== STEP 2: Load demo ===');
  try {
    const demoLink = page.getByText(/try the demo/i).first();
    await demoLink.click();
    console.log('  Clicked demo link');
    await page.waitForTimeout(10000);
    await shot(page, '02-demo-loaded', 'After clicking demo');
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log(`  Body after demo (first 200): ${bodyText.slice(0, 200)}`);
    const cmEditors = await page.locator('.cm-editor').count();
    results.push({ step: 2, name: 'Load demo', status: cmEditors > 0 ? 'PASS' : 'PARTIAL', detail: `${cmEditors} editors; body="${bodyText.slice(0, 80)}"` });
    console.log(`  ${cmEditors > 0 ? 'PASS' : 'PARTIAL'} — ${cmEditors} code editors`);
  } catch (e) {
    await shot(page, '02-fail', 'Demo load failed');
    results.push({ step: 2, name: 'Load demo', status: 'FAIL', detail: e.message });
    console.log(`  FAIL — ${e.message}`);
  }

  // Step 3: PromptSuggester chips
  console.log('\n=== STEP 3: PromptSuggester chips ===');
  try {
    await shot(page, '03-before-chat', 'Before opening chat');

    // Dump button info
    const buttonInfo = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.textContent?.trim().slice(0, 40),
        ariaLabel: b.getAttribute('aria-label'),
        title: b.getAttribute('title'),
        cls: b.className.slice(0, 60),
      })).filter(b => b.text || b.ariaLabel || b.title);
    });
    console.log('  Buttons found:', buttonInfo.length);
    buttonInfo.forEach(b => console.log(`    - text="${b.text}" aria="${b.ariaLabel}" title="${b.title}" cls="${b.cls}"`));

    // Try to find and open chat
    let chatOpened = false;
    for (const b of buttonInfo) {
      if (/chat|ai|message|assistant/i.test(b.ariaLabel + ' ' + b.title + ' ' + b.text)) {
        const btn = b.ariaLabel
          ? page.locator(`button[aria-label="${b.ariaLabel}"]`).first()
          : page.locator(`button`).filter({ hasText: new RegExp(b.text || '', 'i') }).first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click();
          chatOpened = true;
          console.log(`  Opened chat via button: "${b.text || b.ariaLabel}"`);
          await page.waitForTimeout(1000);
          break;
        }
      }
    }

    if (!chatOpened) console.log('  No chat button found by aria/title search');

    // Check for textarea
    const textareaCount = await page.locator('textarea').count();
    console.log(`  Textareas: ${textareaCount}`);
    const textareaInfo = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('textarea')).map(t => ({
        placeholder: t.placeholder, cls: t.className.slice(0, 60), visible: !!(t.offsetParent)
      }));
    });
    console.log('  Textarea details:', JSON.stringify(textareaInfo));

    if (textareaCount > 0) {
      const textarea = page.locator('textarea').first();
      if (await textarea.isVisible().catch(() => false)) {
        await textarea.click();
        await page.waitForTimeout(1000);
        await shot(page, '03-prompt-chips', 'After clicking textarea');

        // Scan for chip-like elements
        const chipInfo = await page.evaluate(() => {
          const sel = '[class*="chip" i], [class*="suggest" i], [class*="pill" i], [class*="Suggestion"]';
          return Array.from(document.querySelectorAll(sel)).map(e => ({
            text: e.textContent?.trim().slice(0, 60), cls: e.className.slice(0, 60)
          }));
        });
        console.log('  Chip elements:', JSON.stringify(chipInfo.slice(0, 10)));

        results.push({ step: 3, name: 'PromptSuggester chips', status: chipInfo.length > 0 ? 'PASS' : 'PARTIAL', detail: `${chipInfo.length} chips: ${chipInfo.slice(0, 3).map(c => c.text).join(', ')}` });
        console.log(`  ${chipInfo.length > 0 ? 'PASS' : 'PARTIAL'} — ${chipInfo.length} chip elements`);
      } else {
        await shot(page, '03-textarea-hidden', 'Textarea not visible');
        results.push({ step: 3, name: 'PromptSuggester chips', status: 'FAIL', detail: 'Textarea exists but not visible' });
        console.log('  FAIL — textarea not visible');
      }
    } else {
      await shot(page, '03-no-textarea', 'No textarea');
      results.push({ step: 3, name: 'PromptSuggester chips', status: 'FAIL', detail: 'No textarea found' });
      console.log('  FAIL — no textarea');
    }
  } catch (e) {
    await shot(page, '03-fail', e.message.slice(0, 50));
    results.push({ step: 3, name: 'PromptSuggester chips', status: 'FAIL', detail: e.message });
    console.log(`  FAIL — ${e.message}`);
  }

  // Step 4: SQL query + plot suggester
  console.log('\n=== STEP 4: SQL query + plot suggester ===');
  try {
    await shot(page, '04-before-query', 'Before SQL query');
    const cmEditors = await page.locator('.cm-editor').count();
    console.log(`  CM editors: ${cmEditors}`);

    if (cmEditors > 0) {
      const lastEditor = page.locator('.cm-editor').last();
      const editorContent = page.locator('.cm-content').last();
      await lastEditor.click();
      await page.waitForTimeout(300);
      await page.keyboard.press('Control+a');
      await page.waitForTimeout(100);
      const query = 'SELECT gc_cause, COUNT(*) AS event_count FROM jdk_garbage_collection_young GROUP BY gc_cause ORDER BY event_count DESC LIMIT 10';
      await page.keyboard.type(query);
      await page.waitForTimeout(500);
      await page.keyboard.press('Shift+Enter');
      console.log('  Submitted query with Shift+Enter');
      await page.waitForTimeout(6000);
      await shot(page, '04-after-query', 'After running query');

      const bodyText = await page.evaluate(() => document.body.innerText);
      const hasGCData = /gc_cause|GarbageCollection|G1/i.test(bodyText);
      console.log(`  Body has GC data: ${hasGCData}`);
      console.log(`  Body snippet: ${bodyText.slice(bodyText.indexOf('gc') || 0, (bodyText.indexOf('gc') || 0) + 200)}`);

      // Find plot suggestion chips
      const plotChips = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('*'));
        return all.filter(e => {
          const t = (e.textContent || '').trim();
          const c = e.className || '';
          return (t.startsWith('BAR') || t.startsWith('LINE') || t.startsWith('PIE') || /plotSuggest|plot-suggest/i.test(c)) && t.length < 30;
        }).map(e => ({ text: e.textContent?.trim().slice(0, 30), cls: e.className?.slice(0, 50), tag: e.tagName }));
      });
      console.log('  Plot chips:', JSON.stringify(plotChips.slice(0, 10)));

      results.push({ step: 4, name: 'Plot suggester', status: hasGCData ? 'PASS' : 'PARTIAL', detail: `GC data in DOM: ${hasGCData}; plotChips: ${plotChips.length}` });
      console.log(`  ${hasGCData ? 'PASS' : 'PARTIAL'} — GC data=${hasGCData}, plotChips=${plotChips.length}`);
    } else {
      results.push({ step: 4, name: 'Plot suggester', status: 'FAIL', detail: 'No CM editors found' });
      console.log('  FAIL — no editors');
    }
  } catch (e) {
    await shot(page, '04-fail', e.message.slice(0, 50));
    results.push({ step: 4, name: 'Plot suggester', status: 'FAIL', detail: e.message });
    console.log(`  FAIL — ${e.message}`);
  }

  // Step 5: Model selector
  console.log('\n=== STEP 5: Chat panel model selector ===');
  try {
    await shot(page, '05-model-selector', 'Full page for model selector check');
    const allSelects = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('select')).map(s => ({
        id: s.id, name: s.name, cls: s.className.slice(0, 60),
        opts: Array.from(s.options).map(o => o.text).slice(0, 5)
      }));
    });
    console.log('  Selects:', JSON.stringify(allSelects));

    const modelText = await page.evaluate(() => {
      return document.body.innerText.split('\n').filter(l => /gpt|claude|gemini|llama|anthropic|openai|model|provider/i.test(l)).slice(0, 10);
    });
    console.log('  Model-related text:', modelText);

    const hasModelUI = allSelects.length > 0 || modelText.length > 0;
    results.push({ step: 5, name: 'Model selector', status: hasModelUI ? 'PASS' : 'FAIL', detail: `selects: ${allSelects.length}, modelText lines: ${modelText.length}: ${modelText.slice(0, 3).join(' | ')}` });
    console.log(`  ${hasModelUI ? 'PASS' : 'FAIL'}`);
  } catch (e) {
    await shot(page, '05-fail', e.message.slice(0, 50));
    results.push({ step: 5, name: 'Model selector', status: 'FAIL', detail: e.message });
    console.log(`  FAIL — ${e.message}`);
  }

  await browser.close();

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`  Step ${r.step} [${r.status}] ${r.name}: ${r.detail}`);
  }
  writeFileSync('/Users/i560383_1/code/experiments/jfr-query/live-test-results.json', JSON.stringify(results, null, 2));
  console.log('\nResults saved. Screenshots:');
  for (const s of SCREENSHOTS) console.log(`  ${s.path}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
