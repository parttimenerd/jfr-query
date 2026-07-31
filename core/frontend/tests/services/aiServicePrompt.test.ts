// Regression guard for the tool-using chat system prompt.
//
// The full system prompt is built inline inside AiService.streamChatWithTools
// (the generator that calls each provider) and isn't easily callable from a
// node-env vitest. Rather than refactoring an extraction seam just for tests,
// we snapshot the parts of the source that matter — the invariants a prompt
// rewrite must preserve.
//
// What we lock in:
//  - Every tool name registered in TOOLS is referenced at least once in the
//    prompt source. If we add a tool to the registry but forget to teach the
//    model when to use it, this test fails.
//  - The non-obvious rules are present: "do not also call addCell after a
//    previewPlot", the per-visibility behavior bullets, and the DSL quoting
//    rule that the parser actually enforces.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TOOLS } from '../../services/ai/tools';

const aiServiceSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'services', 'AiService.ts'),
    'utf8',
);

// Narrow to the tool-using system prompt block. There are several
// systemInstruction templates in the file; we only care about the one used by
// streamChatWithTools (the agent loop with tools). The block starts with the
// "expert DuckDB and data visualization assistant" line preceded by
// `TOOLS — group by purpose`.
function extractToolPromptBlock(src: string): string {
    const start = src.indexOf('TOOLS — group by purpose');
    if (start < 0) throw new Error('Could not find the tool-using prompt anchor — has the prompt been rewritten?');
    // Walk forward to end-of-template (`${schemaPayload}` marker).
    const end = src.indexOf('${schemaPayload}', start);
    if (end < 0) throw new Error('Could not find the schemaPayload terminator after the tool prompt anchor.');
    return src.slice(start, end);
}

describe('AiService tool-using system prompt', () => {
    const block = extractToolPromptBlock(aiServiceSrc);

    it('mentions every tool registered in TOOLS', () => {
        const missing = TOOLS.map(t => t.name).filter(name => !block.includes(name));
        expect(missing).toEqual([]);
    });

    it('warns against doubling up addCell after a previewPlot (the most common foot-gun)', () => {
        // Either phrasing is fine; pin the intent rather than the exact words.
        expect(block).toMatch(/previewPlot[\s\S]{0,200}DO NOT|do not.*addCell/i);
    });

    it('documents the per-visibility behavior of preview/screenshot tools', () => {
        expect(block).toContain("'no-data'");
        expect(block).toContain("'sanitized'");
        expect(block).toContain("'full'");
        // previewPlot must be tied to the no-data restriction in writing.
        expect(block).toMatch(/no-data[\s\S]{0,300}previewPlot|previewPlot[\s\S]{0,300}no-data/);
        // screenshotPlot must be tied to the full-visibility requirement.
        expect(block).toMatch(/screenshotPlot[\s\S]{0,300}full|full[\s\S]{0,300}screenshotPlot/);
    });

    it('teaches the DSL quoting rules the parser actually enforces', () => {
        // y is ALWAYS an array — common model mistake otherwise.
        expect(block).toMatch(/y is ALWAYS an array/i);
        // Column names quoted — second common mistake.
        expect(block).toMatch(/column names? .*quoted/i);
    });

    it('lists at least the canonical plot shapes in the DSL section', () => {
        for (const shape of ['BAR_CHART', 'LINE_CHART', 'SCATTER_PLOT', 'AREA_CHART', 'PIE_CHART', 'TABLE']) {
            expect(block).toContain(shape);
        }
    });

    it('reminds the model to stop when done (anti-loop)', () => {
        expect(block).toMatch(/stop calling tools|do not loop|don'?t loop/i);
    });

    it('instructs model to call readCell before editCell to preserve cell structure', () => {
        expect(block).toMatch(/editCell[\s\S]{0,100}readCell/);
    });
});

describe('AiService customSystemPrompt injection', () => {
    it('injects custom prompt with ADDITIONAL INSTRUCTIONS header when truthy', () => {
        // Verify the injection pattern exists in AiService.ts source
        expect(aiServiceSrc).toContain('ADDITIONAL INSTRUCTIONS FROM USER');
        expect(aiServiceSrc).toContain('customSystemPrompt');
    });

    it('injection uses conditional guard (only adds when truthy)', () => {
        // The source must have a conditional — not an unconditional append
        const injectionIdx = aiServiceSrc.indexOf('ADDITIONAL INSTRUCTIONS FROM USER');
        expect(injectionIdx).toBeGreaterThan(-1);
        // Slice 200 chars before to see the surrounding conditional
        const surrounding = aiServiceSrc.slice(Math.max(0, injectionIdx - 200), injectionIdx + 100);
        expect(surrounding).toMatch(/if\s*\(|&&|\?\?/);
    });
});
