import { describe, it, expect, beforeEach } from 'vitest';
import {
    filterToolsForMode,
    composeSystemPromptForMode,
    parsePlanFromText,
    parseBtwHintsFromText,
    isDuplicateHint,
    shouldFireBtwCall,
    planToExecutionPrompt,
    planMetaStart,
    planMetaSuccess,
    planMetaFail,
    planMetaDiscard,
    describePlanStep,
    extractPlotBlockAt,
    diffPlans,
    channelReducer,
    initialChannelState,
    incPlanParseLayer,
    PLAN_MODE_SYSTEM_SUFFIX,
    VERBOSE_MODE_SYSTEM_SUFFIX,
    buildLocalSystemPrompt,
    buildBrowserSystemPrompt,
    type ParsedPlan,
    type BtwHint,
    type PlanStep,
} from '../services/ai/chatModes';
import type { Tool } from '../services/ai/tools';

const TOOLS_FIXTURE: Tool[] = [
    { name: 'runQuery', kind: 'read', description: '', inputSchema: { type: 'object' } },
    { name: 'describeTable', kind: 'read', description: '', inputSchema: { type: 'object' } },
    { name: 'addCell', kind: 'mutate', description: '', inputSchema: { type: 'object' } },
    { name: 'editCell', kind: 'mutate', description: '', inputSchema: { type: 'object' } },
    { name: 'applyPlot', kind: 'mutate', description: '', inputSchema: { type: 'object' } },
];

describe('filterToolsForMode', () => {
    it('returns all tools in normal mode', () => {
        const out = filterToolsForMode(TOOLS_FIXTURE, 'normal');
        expect(out.length).toBe(TOOLS_FIXTURE.length);
    });

    it('removes mutate tools in plan mode', () => {
        const out = filterToolsForMode(TOOLS_FIXTURE, 'plan');
        expect(out.every(t => t.kind === 'read')).toBe(true);
        expect(out.map(t => t.name)).toEqual(['runQuery', 'describeTable']);
    });

    it('returns all tools in btw mode', () => {
        const out = filterToolsForMode(TOOLS_FIXTURE, 'btw');
        expect(out.length).toBe(TOOLS_FIXTURE.length);
    });

    it('returns all tools in verbose mode (same as normal — no tool restrictions)', () => {
        const out = filterToolsForMode(TOOLS_FIXTURE, 'verbose');
        expect(out.length).toBe(TOOLS_FIXTURE.length);
    });

    it('keeps real read tools (listCells, readCell) in plan mode and drops real mutates (deleteCell, moveCell)', async () => {
        const { TOOLS } = await import('../services/ai/tools');
        const planTools = filterToolsForMode(TOOLS, 'plan');
        const planNames = planTools.map(t => t.name);
        expect(planNames).toContain('listCells');
        expect(planNames).toContain('readCell');
        expect(planNames).not.toContain('deleteCell');
        expect(planNames).not.toContain('moveCell');
    });

    it('keeps listVariables in plan mode and drops setVariable/deleteVariable mutates', async () => {
        const { TOOLS } = await import('../services/ai/tools');
        const planTools = filterToolsForMode(TOOLS, 'plan');
        const planNames = planTools.map(t => t.name);
        expect(planNames).toContain('listVariables');
        expect(planNames).not.toContain('setVariable');
        expect(planNames).not.toContain('deleteVariable');
    });
});

describe('composeSystemPromptForMode', () => {
    it('returns base unchanged for normal mode', () => {
        expect(composeSystemPromptForMode('base prompt', 'normal')).toBe('base prompt');
    });

    it('appends plan suffix for plan mode', () => {
        const out = composeSystemPromptForMode('base prompt', 'plan');
        expect(out.startsWith('base prompt')).toBe(true);
        expect(out).toContain('PLAN MODE');
    });

    it('returns base unchanged for btw mode', () => {
        expect(composeSystemPromptForMode('base', 'btw')).toBe('base');
    });

    it('appends verbose suffix for verbose mode', () => {
        const out = composeSystemPromptForMode('base prompt', 'verbose');
        expect(out.startsWith('base prompt')).toBe(true);
        expect(out).toContain('VERBOSE MODE');
        expect(out).toBe('base prompt' + VERBOSE_MODE_SYSTEM_SUFFIX);
    });

    it('verbose suffix starts with VERBOSE_MODE_SYSTEM_SUFFIX on empty base', () => {
        expect(composeSystemPromptForMode('', 'verbose')).toBe(VERBOSE_MODE_SYSTEM_SUFFIX);
    });

    it('handles empty/null base safely', () => {
        expect(composeSystemPromptForMode('', 'normal')).toBe('');
        const planEmpty = composeSystemPromptForMode('', 'plan');
        expect(planEmpty).toBe(PLAN_MODE_SYSTEM_SUFFIX);
    });
});

describe('parsePlanFromText (strict)', () => {
    it('parses a valid jfr-plan fence', () => {
        const text = 'Here is the plan:\n```jfr-plan\n' + JSON.stringify({
            summary: 'Test plan',
            steps: [
                { kind: 'add', type: 'sql', content: 'SELECT 1', rationale: 'demo' },
            ],
        }) + '\n```';
        const plan = parsePlanFromText(text);
        expect(plan).not.toBeNull();
        expect(plan!.parseLayer).toBe('strict');
        expect(plan!.summary).toBe('Test plan');
        expect(plan!.steps).toHaveLength(1);
        expect(plan!.steps[0].kind).toBe('add');
        expect(plan!.steps[0].confidence).toBe('high');
    });

    it('uses the last fence when multiple are present (last-fence-wins)', () => {
        const text =
            '```jfr-plan\n' + JSON.stringify({ summary: 'first', steps: [] }) + '\n```\n' +
            'reconsidered:\n' +
            '```jfr-plan\n' + JSON.stringify({
                summary: 'second',
                steps: [{ kind: 'edit', cellId: 'c1', content: 'x', rationale: 'r' }],
            }) + '\n```';
        const plan = parsePlanFromText(text, { allowFallback: false });
        expect(plan).not.toBeNull();
        expect(plan!.summary).toBe('second');
        expect(plan!.steps).toHaveLength(1);
    });

    it('returns null for malformed JSON in the fence', () => {
        const text = '```jfr-plan\n{ not valid json }\n```';
        const plan = parsePlanFromText(text, { allowFallback: false });
        expect(plan).toBeNull();
    });

    it('rejects the whole plan when any step is malformed', () => {
        const text = '```jfr-plan\n' + JSON.stringify({
            summary: 's',
            steps: [
                { kind: 'add', type: 'sql', content: 'SELECT 1', rationale: 'ok' },
                { kind: 'edit', cellId: 'c1' /* missing content */, rationale: 'bad' },
            ],
        }) + '\n```';
        const plan = parsePlanFromText(text, { allowFallback: false });
        expect(plan).toBeNull();
    });

    it('parses an applyPlot step with plotBlockIndex', () => {
        const text = '```jfr-plan\n' + JSON.stringify({
            summary: 's',
            steps: [
                { kind: 'applyPlot', cellId: 'c1', plotConfig: 'BAR_CHART(x: "a")', plotBlockIndex: 1, rationale: 'r' },
            ],
        }) + '\n```';
        const plan = parsePlanFromText(text);
        expect(plan).not.toBeNull();
        const step = plan!.steps[0];
        expect(step.kind).toBe('applyPlot');
        if (step.kind === 'applyPlot') {
            expect(step.plotBlockIndex).toBe(1);
            expect(step.plotConfig).toBe('BAR_CHART(x: "a")');
        }
    });

    it('tolerates prose before and after the fence', () => {
        const text = 'Some explanation.\n\n```jfr-plan\n' + JSON.stringify({
            summary: 's',
            steps: [{ kind: 'add', type: 'markdown', content: '# H', rationale: 'r' }],
        }) + '\n```\n\nMore prose.';
        const plan = parsePlanFromText(text);
        expect(plan).not.toBeNull();
        expect(plan!.steps).toHaveLength(1);
    });
});

describe('parsePlanFromText (fallback)', () => {
    it('parses a numbered markdown list under a Plan heading', () => {
        const text = `Some intro.

## Plan
This is the overall idea.

1. Add sql cell: SELECT count(*) FROM events
2. Edit cell c-42: SELECT 2
3. Apply plot to c-99 block 1: BAR_CHART(x: "a", y: ["b"])
`;
        const plan = parsePlanFromText(text);
        expect(plan).not.toBeNull();
        expect(plan!.parseLayer).toBe('fallback');
        expect(plan!.steps).toHaveLength(3);
        expect(plan!.steps[0].kind).toBe('add');
        expect(plan!.steps[1].kind).toBe('edit');
        expect(plan!.steps[2].kind).toBe('applyPlot');
        expect(plan!.steps.every(s => s.confidence === 'low')).toBe(true);
    });

    it('skips items not matching any pattern but keeps the rest', () => {
        const text = `## Plan
1. Add sql cell: SELECT 1
2. Something weird that doesn't match
3. Edit cell c-1: SELECT 2
`;
        const plan = parsePlanFromText(text);
        expect(plan).not.toBeNull();
        expect(plan!.steps).toHaveLength(2);
    });

    it('returns null when no items parse', () => {
        const text = `## Plan
1. Buy milk
2. Walk the dog
`;
        const plan = parsePlanFromText(text);
        expect(plan).toBeNull();
    });

    it('respects allowFallback: false', () => {
        const text = `## Plan
1. Add sql cell: SELECT 1
`;
        const plan = parsePlanFromText(text, { allowFallback: false });
        expect(plan).toBeNull();
    });

    it('strict wins over fallback when both could parse', () => {
        const text = `## Plan
1. Add sql cell: SELECT 1

\`\`\`jfr-plan
${JSON.stringify({ summary: 'strict', steps: [{ kind: 'add', type: 'sql', content: 'SELECT 2', rationale: 'r' }] })}
\`\`\`
`;
        const plan = parsePlanFromText(text);
        expect(plan).not.toBeNull();
        expect(plan!.parseLayer).toBe('strict');
    });
});

describe('incPlanParseLayer telemetry', () => {
    // node env has no window; install a stub
    const W = (globalThis as any);

    beforeEach(() => {
        if (typeof W.window === 'undefined') W.window = W;
        W.__planParseCount_strict = 0;
        W.__planParseCount_fallback = 0;
        W.__planParseCount_miss = 0;
    });

    it('increments strict counter on strict parse', () => {
        const text = '```jfr-plan\n' + JSON.stringify({
            summary: 's',
            steps: [{ kind: 'add', type: 'sql', content: '1', rationale: 'r' }],
        }) + '\n```';
        parsePlanFromText(text);
        expect(W.__planParseCount_strict).toBe(1);
    });

    it('increments fallback counter when only fallback parses', () => {
        parsePlanFromText('## Plan\n1. Add sql cell: SELECT 1\n');
        expect(W.__planParseCount_fallback).toBe(1);
    });

    it('increments miss counter when nothing parses', () => {
        parsePlanFromText('totally unrelated text');
        expect(W.__planParseCount_miss).toBe(1);
    });

    it('incPlanParseLayer is a no-op when counter slot is missing', () => {
        delete W.__planParseCount_strict;
        expect(() => incPlanParseLayer('strict')).not.toThrow();
    });
});

describe('parseBtwHintsFromText', () => {
    it('parses a valid jfr-btw fence', () => {
        const text = '```jfr-btw\n' + JSON.stringify({
            hints: [
                { text: 'A useful nudge.', action: { type: 'send-prompt', prompt: 'Tell me more' } },
                { text: 'Another.' },
            ],
        }) + '\n```';
        const hints = parseBtwHintsFromText(text);
        expect(hints).toHaveLength(2);
        expect(hints[0].text).toBe('A useful nudge.');
        expect(hints[0].action?.type).toBe('send-prompt');
        expect(hints[1].action).toBeUndefined();
    });

    it('caps at 3 hints', () => {
        const text = '```jfr-btw\n' + JSON.stringify({
            hints: [
                { text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }, { text: 'e' },
            ],
        }) + '\n```';
        expect(parseBtwHintsFromText(text)).toHaveLength(3);
    });

    it('truncates hint text to 140 chars', () => {
        const long = 'x'.repeat(200);
        const text = '```jfr-btw\n' + JSON.stringify({ hints: [{ text: long }] }) + '\n```';
        const hints = parseBtwHintsFromText(text);
        expect(hints[0].text.length).toBe(140);
    });

    it('returns empty for missing fence', () => {
        expect(parseBtwHintsFromText('no fences here')).toEqual([]);
    });

    it('returns empty for malformed JSON', () => {
        expect(parseBtwHintsFromText('```jfr-btw\n{ broken\n```')).toEqual([]);
    });

    it('skips hints without text', () => {
        const text = '```jfr-btw\n' + JSON.stringify({
            hints: [{ text: 'ok' }, { action: { type: 'send-prompt', prompt: 'x' } }],
        }) + '\n```';
        const hints = parseBtwHintsFromText(text);
        expect(hints).toHaveLength(1);
    });
});

describe('isDuplicateHint', () => {
    const mk = (text: string): BtwHint => ({ id: 'x', text, source: 'llm' });

    it('detects exact duplicates', () => {
        expect(isDuplicateHint([mk('Hello world')], mk('Hello world'))).toBe(true);
    });

    it('detects near-duplicates differing only in case', () => {
        expect(isDuplicateHint([mk('Hello World')], mk('hello world'))).toBe(true);
    });

    it('detects duplicates within the first 40 chars', () => {
        const a = mk('The query results look suspicious because of X');
        const b = mk('The query results look suspicious because of Y');
        expect(isDuplicateHint([a], b)).toBe(true);
    });

    it('treats different first-40-chars as distinct', () => {
        expect(isDuplicateHint([mk('Alpha hint')], mk('Beta hint'))).toBe(false);
    });
});

describe('shouldFireBtwCall', () => {
    it('blocks within debounce window', () => {
        expect(shouldFireBtwCall({
            lastFiredAt: 1000,
            now: 2000,
            lastAssistantTextLength: 200,
            visibility: 'full',
        })).toBe(false);
    });

    it('fires after debounce window', () => {
        expect(shouldFireBtwCall({
            lastFiredAt: 1000,
            now: 1000 + 16_000,
            lastAssistantTextLength: 200,
            visibility: 'full',
        })).toBe(true);
    });

    it('fires when lastFiredAt is null', () => {
        expect(shouldFireBtwCall({
            lastFiredAt: null,
            now: 5_000,
            lastAssistantTextLength: 200,
            visibility: 'full',
        })).toBe(true);
    });

    it('blocks when assistant text is too short', () => {
        expect(shouldFireBtwCall({
            lastFiredAt: null,
            now: 5_000,
            lastAssistantTextLength: 10,
            visibility: 'full',
        })).toBe(false);
    });

    it('blocks when visibility is no-data', () => {
        expect(shouldFireBtwCall({
            lastFiredAt: null,
            now: 5_000,
            lastAssistantTextLength: 500,
            visibility: 'no-data',
        })).toBe(false);
    });
});

describe('planToExecutionPrompt', () => {
    it('drops id and confidence and includes step body', () => {
        const plan: ParsedPlan = {
            summary: 's',
            steps: [
                { id: 'step-1', kind: 'add', type: 'sql', content: 'SELECT 1', rationale: 'r', confidence: 'high' },
            ],
            raw: '',
            parseLayer: 'strict',
        };
        const prompt = planToExecutionPrompt(plan);
        expect(prompt).toContain('Execute this plan exactly');
        expect(prompt).toContain('SELECT 1');
        expect(prompt).not.toContain('step-1');
        expect(prompt).not.toContain('confidence');
    });

    it('handles a plan with zero steps without crashing', () => {
        const plan: ParsedPlan = {
            summary: 'empty',
            steps: [],
            raw: '',
            parseLayer: 'strict',
        };
        const prompt = planToExecutionPrompt(plan);
        expect(prompt).toContain('Execute this plan exactly');
        // Empty steps array is preserved so the AI sees there's nothing to do.
        expect(prompt).toMatch(/"steps":\s*\[\s*\]/);
    });

    it('preserves step order in the serialized output', () => {
        const plan: ParsedPlan = {
            summary: 'multi',
            steps: [
                { id: 'a', kind: 'add', type: 'sql', content: 'SELECT 1', rationale: '', confidence: 'high' },
                { id: 'b', kind: 'edit', cellId: 'c1', content: 'SELECT 2', rationale: '', confidence: 'high' },
                { id: 'c', kind: 'add', type: 'markdown', content: '## Notes', rationale: '', confidence: 'high' },
            ],
            raw: '',
            parseLayer: 'strict',
        };
        const prompt = planToExecutionPrompt(plan);
        const idxA = prompt.indexOf('SELECT 1');
        const idxB = prompt.indexOf('SELECT 2');
        const idxC = prompt.indexOf('## Notes');
        expect(idxA).toBeGreaterThanOrEqual(0);
        expect(idxB).toBeGreaterThan(idxA);
        expect(idxC).toBeGreaterThan(idxB);
    });

    it('includes applyPlot step fields (cellId, plotConfig, plotBlockIndex)', () => {
        const plan: ParsedPlan = {
            summary: 's',
            steps: [
                { id: 'p', kind: 'applyPlot', cellId: 'cell-7', plotConfig: '```plot\ntype=bar\n```', plotBlockIndex: 0, rationale: '', confidence: 'high' },
            ],
            raw: '',
            parseLayer: 'strict',
        };
        const prompt = planToExecutionPrompt(plan);
        expect(prompt).toContain('cell-7');
        expect(prompt).toContain('type=bar');
        expect(prompt).toContain('plotBlockIndex');
    });

    it('includes the plan summary in the payload', () => {
        const plan: ParsedPlan = {
            summary: 'Investigate GC pauses by cause',
            steps: [{ id: 'x', kind: 'add', type: 'sql', content: 'SELECT 1', rationale: '', confidence: 'high' }],
            raw: '',
            parseLayer: 'strict',
        };
        const prompt = planToExecutionPrompt(plan);
        expect(prompt).toContain('Investigate GC pauses by cause');
    });

    it('produces valid JSON inside the fence', () => {
        const plan: ParsedPlan = {
            summary: 's',
            steps: [
                { id: '1', kind: 'add', type: 'sql', content: "SELECT 'has \"quotes\" and newlines\n'", rationale: '', confidence: 'high' },
            ],
            raw: '',
            parseLayer: 'strict',
        };
        const prompt = planToExecutionPrompt(plan);
        const match = prompt.match(/```json\n([\s\S]*?)\n```/);
        expect(match).not.toBeNull();
        // Parsing must succeed — special chars in step body should be escaped.
        const parsed = JSON.parse(match![1]);
        expect(parsed.steps).toHaveLength(1);
        expect(parsed.steps[0].content).toContain('quotes');
    });
});

describe('describePlanStep', () => {
    it('describes an add step', () => {
        expect(describePlanStep({
            id: 'x', kind: 'add', type: 'sql', content: '', rationale: '', confidence: 'high',
        })).toContain('Add sql cell');
    });

    it('includes afterCellId hint when set', () => {
        const out = describePlanStep({
            id: 'x', kind: 'add', type: 'plot', content: '', afterCellId: 'c-9', rationale: '', confidence: 'high',
        });
        expect(out).toContain('c-9');
    });

    it('describes an edit step', () => {
        expect(describePlanStep({
            id: 'x', kind: 'edit', cellId: 'c-1', content: '', rationale: '', confidence: 'high',
        })).toContain('c-1');
    });

    it('describes applyPlot with block index', () => {
        const out = describePlanStep({
            id: 'x', kind: 'applyPlot', cellId: 'c-5', plotConfig: '', plotBlockIndex: 2, rationale: '', confidence: 'high',
        });
        expect(out).toContain('block 2');
        expect(out).toContain('c-5');
    });
});

describe('extractPlotBlockAt', () => {
    const cell = `Some prose.

\`\`\`plot
BAR_CHART(x: "a", y: ["b"])
\`\`\`

More prose.

\`\`\`plot
LINE_CHART(x: "t", y: ["v"])
\`\`\`
`;

    it('returns the first plot block', () => {
        const out = extractPlotBlockAt(cell, 0);
        expect(out).toContain('BAR_CHART');
    });

    it('returns the second plot block', () => {
        const out = extractPlotBlockAt(cell, 1);
        expect(out).toContain('LINE_CHART');
    });

    it('returns null when out of range', () => {
        expect(extractPlotBlockAt(cell, 5)).toBeNull();
        expect(extractPlotBlockAt(cell, -1)).toBeNull();
    });

    it('returns null when no plot blocks present', () => {
        expect(extractPlotBlockAt('just prose', 0)).toBeNull();
    });
});

describe('diffPlans', () => {
    const mkAdd = (content: string, rationale = 'r'): PlanStep => ({
        id: 'x', kind: 'add', type: 'sql', content, rationale, confidence: 'high',
    });
    const mkEdit = (cellId: string, content: string): PlanStep => ({
        id: 'x', kind: 'edit', cellId, content, rationale: 'r', confidence: 'high',
    });

    it('detects unchanged steps', () => {
        const before: ParsedPlan = { summary: 's', steps: [mkEdit('c1', 'X')], raw: '', parseLayer: 'strict' };
        const after: ParsedPlan = { summary: 's', steps: [mkEdit('c1', 'X')], raw: '', parseLayer: 'strict' };
        const d = diffPlans(before, after);
        expect(d.summaryChanged).toBe(false);
        expect(d.stepDiffs).toHaveLength(1);
        expect(d.stepDiffs[0].kind).toBe('unchanged');
    });

    it('detects modified steps with field list', () => {
        const before: ParsedPlan = { summary: 's', steps: [mkEdit('c1', 'X')], raw: '', parseLayer: 'strict' };
        const after: ParsedPlan = { summary: 's', steps: [mkEdit('c1', 'Y')], raw: '', parseLayer: 'strict' };
        const d = diffPlans(before, after);
        expect(d.stepDiffs).toHaveLength(1);
        expect(d.stepDiffs[0].kind).toBe('modified');
        if (d.stepDiffs[0].kind === 'modified') {
            expect(d.stepDiffs[0].fields).toContain('content');
        }
    });

    it('detects added steps', () => {
        const before: ParsedPlan = { summary: 's', steps: [], raw: '', parseLayer: 'strict' };
        const after: ParsedPlan = { summary: 's', steps: [mkAdd('SELECT 1')], raw: '', parseLayer: 'strict' };
        const d = diffPlans(before, after);
        expect(d.stepDiffs).toHaveLength(1);
        expect(d.stepDiffs[0].kind).toBe('added');
    });

    it('detects removed steps', () => {
        const before: ParsedPlan = { summary: 's', steps: [mkEdit('c1', 'X')], raw: '', parseLayer: 'strict' };
        const after: ParsedPlan = { summary: 's', steps: [], raw: '', parseLayer: 'strict' };
        const d = diffPlans(before, after);
        expect(d.stepDiffs).toHaveLength(1);
        expect(d.stepDiffs[0].kind).toBe('removed');
    });

    it('flags summary changes', () => {
        const before: ParsedPlan = { summary: 'a', steps: [], raw: '', parseLayer: 'strict' };
        const after: ParsedPlan = { summary: 'b', steps: [], raw: '', parseLayer: 'strict' };
        const d = diffPlans(before, after);
        expect(d.summaryChanged).toBe(true);
        expect(d.summaryBefore).toBe('a');
        expect(d.summaryAfter).toBe('b');
    });
});

describe('channelReducer', () => {
    it('initial state is normal mode with no hints', () => {
        expect(initialChannelState.mode).toBe('normal');
        expect(initialChannelState.btwHints).toEqual([]);
        expect(initialChannelState.lastBtwCallAt).toBeNull();
    });

    it('set-mode updates the mode', () => {
        const next = channelReducer(initialChannelState, { type: 'set-mode', mode: 'plan' });
        expect(next.mode).toBe('plan');
    });

    it('set-mode is idempotent (returns same reference)', () => {
        const s = channelReducer(initialChannelState, { type: 'set-mode', mode: 'plan' });
        const s2 = channelReducer(s, { type: 'set-mode', mode: 'plan' });
        expect(s2).toBe(s);
    });

    it('add-hints appends and dedupes', () => {
        const s1 = channelReducer(initialChannelState, {
            type: 'add-hints',
            hints: [{ id: 'a', text: 'one', source: 'llm' }],
        });
        expect(s1.btwHints).toHaveLength(1);
        const s2 = channelReducer(s1, {
            type: 'add-hints',
            hints: [
                { id: 'b', text: 'ONE', source: 'llm' }, // dup
                { id: 'c', text: 'two', source: 'llm' },
            ],
        });
        expect(s2.btwHints).toHaveLength(2);
        expect(s2.btwHints[1].text).toBe('two');
    });

    it('add-hints with all duplicates is a no-op (same reference)', () => {
        const s1 = channelReducer(initialChannelState, {
            type: 'add-hints',
            hints: [{ id: 'a', text: 'one', source: 'llm' }],
        });
        const s2 = channelReducer(s1, {
            type: 'add-hints',
            hints: [{ id: 'b', text: 'ONE', source: 'llm' }],
        });
        expect(s2).toBe(s1);
    });

    it('dismiss-hint removes by id', () => {
        const s1 = channelReducer(initialChannelState, {
            type: 'add-hints',
            hints: [
                { id: 'a', text: 'one', source: 'llm' },
                { id: 'b', text: 'two', source: 'llm' },
            ],
        });
        const s2 = channelReducer(s1, { type: 'dismiss-hint', id: 'a' });
        expect(s2.btwHints).toHaveLength(1);
        expect(s2.btwHints[0].id).toBe('b');
    });

    it('dismiss-hint for unknown id is a no-op (same reference)', () => {
        const s1 = channelReducer(initialChannelState, {
            type: 'add-hints',
            hints: [{ id: 'a', text: 'one', source: 'llm' }],
        });
        const s2 = channelReducer(s1, { type: 'dismiss-hint', id: 'nope' });
        expect(s2).toBe(s1);
    });

    it('clear-hints empties the list', () => {
        const s1 = channelReducer(initialChannelState, {
            type: 'add-hints',
            hints: [{ id: 'a', text: 'one', source: 'llm' }],
        });
        const s2 = channelReducer(s1, { type: 'clear-hints' });
        expect(s2.btwHints).toEqual([]);
    });

    it('clear-hints on empty list is no-op', () => {
        const s = channelReducer(initialChannelState, { type: 'clear-hints' });
        expect(s).toBe(initialChannelState);
    });

    it('mark-btw-fired updates lastBtwCallAt and lastBtwTier', () => {
        const s = channelReducer(initialChannelState, { type: 'mark-btw-fired', at: 12345, tier: 'advanced' });
        expect(s.lastBtwCallAt).toBe(12345);
        expect(s.lastBtwTier).toBe('advanced');
    });

    it('reset returns initial state', () => {
        const s1 = channelReducer(initialChannelState, { type: 'set-mode', mode: 'plan' });
        const s2 = channelReducer(s1, { type: 'reset' });
        expect(s2).toEqual(initialChannelState);
    });

    it('reset-to sets mode and hints, clearing other state', () => {
        const hints: BtwHint[] = [{ id: 'h1', text: 'Try this', source: 'analyzer' }];
        const s = channelReducer(
            { ...initialChannelState, lastBtwCallAt: 99999 },
            { type: 'reset-to', mode: 'plan', hints },
        );
        expect(s.mode).toBe('plan');
        expect(s.btwHints).toEqual(hints);
        expect(s.lastBtwCallAt).toBeNull();
    });

    it('reset-to with empty hints sets empty btwHints', () => {
        const s = channelReducer(initialChannelState, { type: 'reset-to', mode: 'verbose', hints: [] });
        expect(s.mode).toBe('verbose');
        expect(s.btwHints).toEqual([]);
    });
});

describe('plan-meta state machine', () => {
    it('planMetaStart resets executed step counter', () => {
        expect(planMetaStart()).toEqual({ planStatus: 'executing', planExecutedSteps: 0 });
    });

    it('planMetaSuccess records timestamp and final step count', () => {
        const patch = planMetaSuccess(7, 12345);
        expect(patch).toEqual({
            planStatus: 'executed',
            planExecutedAt: 12345,
            planExecutedSteps: 7,
        });
    });

    it('planMetaFail captures the error message', () => {
        expect(planMetaFail('stream aborted')).toEqual({
            planStatus: 'failed',
            planLastError: 'stream aborted',
        });
    });

    it('planMetaFail preserves undefined error (no error to report)', () => {
        const patch = planMetaFail(undefined);
        expect(patch.planStatus).toBe('failed');
        expect(patch.planLastError).toBeUndefined();
    });

    it('planMetaDiscard records timestamp', () => {
        expect(planMetaDiscard(98765)).toEqual({
            planStatus: 'discarded',
            planDiscardedAt: 98765,
        });
    });

    it('patches only return the fields that change — caller merges with existing meta', () => {
        // The contract: each helper returns a Partial<ChatMessageMeta>. The
        // caller's setMessages spread is what preserves the original `plan`
        // field. So none of these should accidentally include `plan` or
        // override unrelated keys.
        const start = planMetaStart();
        const success = planMetaSuccess(3, 1000);
        const fail = planMetaFail('boom');
        const discard = planMetaDiscard(2000);
        for (const p of [start, success, fail, discard]) {
            expect((p as any).plan).toBeUndefined();
            expect((p as any).planPredecessorMessageId).toBeUndefined();
        }
    });

    it('full lifecycle: start → success replaces executing with executed', () => {
        // Simulate what the component does: merge each patch into prior meta.
        let meta: any = { plan: { foo: 'bar' } };
        meta = { ...meta, ...planMetaStart() };
        expect(meta.planStatus).toBe('executing');
        expect(meta.planExecutedSteps).toBe(0);
        meta = { ...meta, ...planMetaSuccess(5, 999) };
        expect(meta.planStatus).toBe('executed');
        expect(meta.planExecutedSteps).toBe(5);
        expect(meta.planExecutedAt).toBe(999);
        // Original plan blob survives merging.
        expect(meta.plan).toEqual({ foo: 'bar' });
    });

    it('full lifecycle: start → fail preserves the error, then Resume re-enters executing', () => {
        let meta: any = {};
        meta = { ...meta, ...planMetaStart() };
        meta = { ...meta, ...planMetaFail('network blip') };
        expect(meta.planStatus).toBe('failed');
        expect(meta.planLastError).toBe('network blip');
        // Resume button calls planMetaStart again.
        meta = { ...meta, ...planMetaStart() };
        expect(meta.planStatus).toBe('executing');
        expect(meta.planExecutedSteps).toBe(0);
        // planLastError lingers from previous failure — that's intentional;
        // success will overwrite it via the spread, and the UI only reads
        // it when status === 'failed'.
        expect(meta.planLastError).toBe('network blip');
    });
});

// ── buildLocalSystemPrompt ────────────────────────────────────────────────────

describe('buildLocalSystemPrompt', () => {
    it('includes table schema in output', () => {
        const schema = [
            { name: 'events', columns: [{ name: 'ts', type: 'TIMESTAMP' }, { name: 'cpu', type: 'DOUBLE' }] },
        ];
        const result = buildLocalSystemPrompt(schema, {});
        expect(result).toContain('events(ts TIMESTAMP, cpu DOUBLE)');
    });

    it('shows "(no tables loaded yet)" when schema is empty', () => {
        const result = buildLocalSystemPrompt([], {});
        expect(result).toContain('(no tables loaded yet)');
    });

    it('shows variables in $name = value format', () => {
        const result = buildLocalSystemPrompt([], { threshold: 100, label: 'foo' });
        expect(result).toContain('$threshold = 100');
        expect(result).toContain('$label = "foo"');
    });

    it('shows "(none)" when no variables', () => {
        const result = buildLocalSystemPrompt([], {});
        expect(result).toContain('(none)');
    });

    it('omits column type when type is missing', () => {
        const schema = [
            { name: 't', columns: [{ name: 'id' }] },
        ];
        const result = buildLocalSystemPrompt(schema as any, {});
        expect(result).toContain('t(id)');
        expect(result).not.toContain('undefined');
    });

    it('returns a non-empty string', () => {
        const result = buildLocalSystemPrompt([], {});
        expect(result.length).toBeGreaterThan(0);
    });
});

// ── buildBrowserSystemPrompt ──────────────────────────────────────────────────

describe('buildBrowserSystemPrompt', () => {
    it('lists table names and column names', () => {
        const schema = [
            { name: 'gc', columns: [{ name: 'pause_ms' }, { name: 'cause' }] },
        ];
        const result = buildBrowserSystemPrompt(schema as any, {});
        expect(result).toContain('gc(pause_ms, cause)');
    });

    it('shows "(no tables loaded yet)" when schema is empty', () => {
        const result = buildBrowserSystemPrompt([], {});
        expect(result).toContain('(no tables loaded yet)');
    });

    it('includes variable list when variables present', () => {
        const result = buildBrowserSystemPrompt([], { minPause: 5 });
        expect(result).toContain('minPause=5');
    });

    it('omits variable line when no variables', () => {
        const result = buildBrowserSystemPrompt([], {});
        expect(result).not.toContain('Current variables:');
    });

    it('says the model cannot query data directly', () => {
        const result = buildBrowserSystemPrompt([], {});
        expect(result).toContain('cannot query data directly');
    });

    it('returns a non-empty trimmed string', () => {
        const result = buildBrowserSystemPrompt([], {});
        expect(result.length).toBeGreaterThan(0);
        expect(result).toBe(result.trim());
    });
});
