// Pure logic for chat modes (normal / plan / btw). No DOM, no SDK imports.
//
// Mode behaviour:
//   - normal: current behaviour. All tools available; no extra system prompt.
//   - plan:   defense-in-depth — mutate tools removed from the tool list,
//             AND a system prompt suffix tells the model to emit a structured
//             plan instead of mutating. Plans are parsed strictly (fenced JSON)
//             with a numbered-list fallback for cooperative-but-not-perfect models.
//   - btw:    main turn runs as normal; a separate sub-call after the turn
//             produces small "by the way" suggestion cards.
//
// Everything in this file is pure and unit-tested.

import type { Tool } from './tools';
import type { VisibilityMode } from '../AiService';
import { tokenizeCellContent } from '../../utils/notebookParser';

export type ChatMode = 'normal' | 'plan' | 'btw';
export const DEFAULT_MODE: ChatMode = 'normal';

// ───────────────────────── System prompt suffixes ──────────────────────────

export const PLAN_MODE_SYSTEM_SUFFIX = `

PLAN MODE — IMPORTANT
You are in PLAN MODE. Do NOT call addCell, editCell, or applyPlot. Those tools
have been removed and any attempt to call them will fail.

Workflow:
  1. Use read tools (runQuery, describeTable, sampleRows, listPlots) freely to
     understand the data and current notebook.
  2. When ready, end your response with EXACTLY ONE fenced block of this form:

\`\`\`jfr-plan
{
  "summary": "Short human-readable description of the overall plan.",
  "steps": [
    { "kind": "add", "type": "sql|plot|markdown", "content": "<cell content>", "afterCellId": "<optional>", "rationale": "One short sentence." },
    { "kind": "edit", "cellId": "<id>", "content": "<new cell content>", "rationale": "One short sentence." },
    { "kind": "applyPlot", "cellId": "<id>", "plotConfig": "<DSL>", "plotBlockIndex": 0, "rationale": "One short sentence." }
  ]
}
\`\`\`

Rules:
  - Output valid JSON inside the fence. No trailing commas.
  - Each step has a one-sentence "rationale".
  - For plot steps the content/plotConfig MUST use the DSL (BAR_CHART(...), etc.) — not JSON or Observable Plot.
  - You may write prose before the fence to explain context. The user clicks "Execute plan" to apply the steps.
`;

export const BTW_MODE_HINT_SYSTEM = `You are a quiet background analyst for a JFR notebook. Given the user's last
message and the assistant's last reply, surface 0-3 short "by the way" nudges
the user might find useful — e.g. data anomalies, follow-up queries, related
plots. Keep each hint under 140 characters. Do NOT call any tools.

Respond with EXACTLY ONE fenced block of this form:

\`\`\`jfr-btw
{
  "hints": [
    { "text": "Brief observation or suggestion.", "action": { "type": "send-prompt", "prompt": "What to ask if user clicks Accept." } }
  ]
}
\`\`\`

If nothing is worth mentioning, respond with:

\`\`\`jfr-btw
{ "hints": [] }
\`\`\`
`;

// ───────────────────────── Types ──────────────────────────

export type PlanStepConfidence = 'high' | 'low';

export interface PlanStepAdd {
    id: string;
    kind: 'add';
    type: 'sql' | 'plot' | 'markdown';
    content: string;
    afterCellId?: string;
    rationale: string;
    confidence: PlanStepConfidence;
}

export interface PlanStepEdit {
    id: string;
    kind: 'edit';
    cellId: string;
    content: string;
    rationale: string;
    confidence: PlanStepConfidence;
}

export interface PlanStepApplyPlot {
    id: string;
    kind: 'applyPlot';
    cellId: string;
    plotConfig: string;
    plotBlockIndex?: number;
    rationale: string;
    confidence: PlanStepConfidence;
}

export type PlanStep = PlanStepAdd | PlanStepEdit | PlanStepApplyPlot;
// Note: deleteCell / moveCell are intentionally NOT representable as plan steps.
// Plan mode strips mutate tools entirely (filterToolsForMode), so the AI cannot
// propose delete/move from plan mode. When the user wants those, they use normal
// mode where each mutate goes through requireApproval one at a time.

export interface ParsedPlan {
    summary: string;
    steps: PlanStep[];
    raw: string;
    parseLayer: 'strict' | 'fallback';
}

export interface BtwHint {
    id: string;
    text: string;
    source: 'llm' | 'analyzer';
    action?: { type: 'send-prompt'; prompt: string };
}

// ───────────────────────── Tool filtering ──────────────────────────

export function filterToolsForMode(tools: Tool[], mode: ChatMode): Tool[] {
    if (mode === 'plan') return tools.filter(t => t.kind !== 'mutate');
    return tools;
}

export function composeSystemPromptForMode(base: string, mode: ChatMode): string {
    if (mode === 'plan') return (base ?? '') + PLAN_MODE_SYSTEM_SUFFIX;
    return base ?? '';
}

// ───────────────────────── Telemetry shim ──────────────────────────

/** Increment a counter on `window` for plan-parse outcomes. No-op in non-browser
 * envs and when the counter slot isn't pre-populated (e.g. tests inject it). */
export function incPlanParseLayer(layer: 'strict' | 'fallback' | 'miss'): void {
    const w = (typeof window !== 'undefined' ? (window as any) : null);
    if (!w) return;
    const key = `__planParseCount_${layer}`;
    if (typeof w[key] === 'number') w[key]++;
}

// ───────────────────────── Plan parser ──────────────────────────

function makeId(prefix: string): string {
    return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function isStepKind(v: unknown): v is 'add' | 'edit' | 'applyPlot' {
    return v === 'add' || v === 'edit' || v === 'applyPlot';
}

function validateStrictStep(s: any): PlanStep | null {
    if (!s || typeof s !== 'object') return null;
    if (!isStepKind(s.kind)) return null;
    const rationale = typeof s.rationale === 'string' ? s.rationale : '';
    if (s.kind === 'add') {
        if (s.type !== 'sql' && s.type !== 'plot' && s.type !== 'markdown') return null;
        if (typeof s.content !== 'string') return null;
        return {
            id: makeId('step'),
            kind: 'add',
            type: s.type,
            content: s.content,
            afterCellId: typeof s.afterCellId === 'string' ? s.afterCellId : undefined,
            rationale,
            confidence: 'high',
        };
    }
    if (s.kind === 'edit') {
        if (typeof s.cellId !== 'string' || typeof s.content !== 'string') return null;
        return {
            id: makeId('step'),
            kind: 'edit',
            cellId: s.cellId,
            content: s.content,
            rationale,
            confidence: 'high',
        };
    }
    // applyPlot
    if (typeof s.cellId !== 'string' || typeof s.plotConfig !== 'string') return null;
    return {
        id: makeId('step'),
        kind: 'applyPlot',
        cellId: s.cellId,
        plotConfig: s.plotConfig,
        plotBlockIndex: typeof s.plotBlockIndex === 'number' ? s.plotBlockIndex : undefined,
        rationale,
        confidence: 'high',
    };
}

/** Find every fenced ```jfr-plan block. Returns the *last* one's inner JSON
 * string (last-fence-wins), or null when none. Case-insensitive on the tag. */
function findLastPlanFence(text: string): string | null {
    const re = /```jfr-plan\s*\n([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;
    let last: string | null = null;
    while ((match = re.exec(text)) !== null) last = match[1];
    return last;
}

function tryStrictParse(text: string): ParsedPlan | null {
    const fence = findLastPlanFence(text);
    if (!fence) return null;
    let parsed: any;
    try { parsed = JSON.parse(fence); } catch { return null; }
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.steps)) return null;
    const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    const steps: PlanStep[] = [];
    for (const raw of parsed.steps) {
        const step = validateStrictStep(raw);
        if (!step) return null;        // any malformed step rejects whole plan
        steps.push(step);
    }
    return { summary, steps, raw: text, parseLayer: 'strict' };
}

/** Fallback parser for cooperative-but-not-perfect models that emit a
 * numbered markdown list instead of a JSON fence. Patterns recognised:
 *
 *   1. Add (sql|plot|markdown) cell: <content...>
 *   2. Edit cell <cellId>: <content...>
 *   3. Apply plot to <cellId>[ block N]: <plotConfig...>
 *
 * Content of each item extends to the next numbered line. Items not matching
 * any pattern are silently skipped. All steps get confidence: 'low'. */
function tryFallbackParse(text: string): ParsedPlan | null {
    // Try to find a "Plan" heading first; if absent, scan whole text.
    const headingRe = /^(?:#{1,4}\s+plan[^\n]*\n)/im;
    const headingMatch = headingRe.exec(text);
    const scanFrom = headingMatch ? headingMatch.index + headingMatch[0].length : 0;
    const body = text.slice(scanFrom);

    // Split on numbered list items (1. 2. 3. ...).
    const items: string[] = [];
    const itemRe = /(^|\n)\s*\d+\.\s+([\s\S]*?)(?=(?:\n\s*\d+\.\s+)|$)/g;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(body)) !== null) {
        items.push(m[2].trim());
    }
    if (items.length === 0) return null;

    const steps: PlanStep[] = [];
    let summary = '';
    if (headingMatch) {
        // Use the line after the heading and before the first list item.
        const afterHeading = text.slice(headingMatch.index + headingMatch[0].length);
        const firstItem = /\d+\.\s+/.exec(afterHeading);
        const preamble = firstItem ? afterHeading.slice(0, firstItem.index) : '';
        summary = preamble.trim().split('\n').slice(0, 2).join(' ').slice(0, 200);
    }

    for (const itemRaw of items) {
        const step = parseFallbackItem(itemRaw);
        if (step) steps.push(step);
    }
    if (steps.length === 0) return null;
    return { summary: summary || 'Plan parsed from prose', steps, raw: text, parseLayer: 'fallback' };
}

function parseFallbackItem(item: string): PlanStep | null {
    const addM = /^add\s+(sql|plot|markdown)\s+cell\s*:\s*([\s\S]+)$/i.exec(item);
    if (addM) {
        return {
            id: makeId('step'),
            kind: 'add',
            type: addM[1].toLowerCase() as 'sql' | 'plot' | 'markdown',
            content: addM[2].trim(),
            rationale: '(parsed from prose)',
            confidence: 'low',
        };
    }
    const editM = /^edit\s+cell\s+([\w-]+)\s*:\s*([\s\S]+)$/i.exec(item);
    if (editM) {
        return {
            id: makeId('step'),
            kind: 'edit',
            cellId: editM[1],
            content: editM[2].trim(),
            rationale: '(parsed from prose)',
            confidence: 'low',
        };
    }
    const applyM = /^apply\s+plot\s+to\s+([\w-]+)(?:\s+block\s+(\d+))?\s*:\s*([\s\S]+)$/i.exec(item);
    if (applyM) {
        return {
            id: makeId('step'),
            kind: 'applyPlot',
            cellId: applyM[1],
            plotBlockIndex: applyM[2] ? parseInt(applyM[2], 10) : undefined,
            plotConfig: applyM[3].trim(),
            rationale: '(parsed from prose)',
            confidence: 'low',
        };
    }
    return null;
}

export function parsePlanFromText(
    text: string,
    opts?: { allowFallback?: boolean },
): ParsedPlan | null {
    const allowFallback = opts?.allowFallback ?? true;
    const strict = tryStrictParse(text);
    if (strict) {
        incPlanParseLayer('strict');
        return strict;
    }
    if (allowFallback) {
        const fb = tryFallbackParse(text);
        if (fb) {
            incPlanParseLayer('fallback');
            return fb;
        }
    }
    incPlanParseLayer('miss');
    return null;
}

// ───────────────────────── btw parser ──────────────────────────

export function parseBtwHintsFromText(text: string): BtwHint[] {
    const re = /```jfr-btw\s*\n([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;
    let lastJson: string | null = null;
    while ((match = re.exec(text)) !== null) lastJson = match[1];
    if (!lastJson) return [];
    let parsed: any;
    try { parsed = JSON.parse(lastJson); } catch { return []; }
    if (!parsed || !Array.isArray(parsed.hints)) return [];
    const out: BtwHint[] = [];
    for (const h of parsed.hints.slice(0, 3)) {
        if (!h || typeof h.text !== 'string') continue;
        const text = h.text.slice(0, 140);
        const action = h.action && typeof h.action.prompt === 'string' && h.action.type === 'send-prompt'
            ? { type: 'send-prompt' as const, prompt: String(h.action.prompt).slice(0, 500) }
            : undefined;
        out.push({ id: makeId('btw'), text, source: 'llm', action });
    }
    return out;
}

export function isDuplicateHint(existing: BtwHint[], candidate: BtwHint): boolean {
    const norm = (s: string) => s.toLowerCase().slice(0, 40).trim();
    const target = norm(candidate.text);
    return existing.some(h => norm(h.text) === target);
}

// ───────────────────────── btw gates ──────────────────────────

export interface BtwGateInput {
    lastFiredAt: number | null;
    now: number;
    lastAssistantTextLength: number;
    visibility: VisibilityMode;
}

export function shouldFireBtwCall(opts: BtwGateInput): boolean {
    // Gate 1: 15s debounce
    if (opts.lastFiredAt !== null && opts.now - opts.lastFiredAt < 15_000) return false;
    // Gate 2: assistant message has substance
    if (opts.lastAssistantTextLength < 80) return false;
    // Gate 3: no-data visibility yields generic hints; skip
    if (opts.visibility === 'no-data') return false;
    return true;
}

// ───────────────────────── Plan execution prompt ──────────────────────────

export function planToExecutionPrompt(plan: ParsedPlan): string {
    const payload = {
        summary: plan.summary,
        steps: plan.steps.map(s => {
            const { id: _id, confidence: _c, ...rest } = s as any;
            return rest;
        }),
    };
    return (
        'Execute this plan exactly. Call the appropriate mutate tools ' +
        '(addCell, editCell, applyPlot) for each step in order. Do not deviate ' +
        'or add steps. Plan:\n\n```json\n' +
        JSON.stringify(payload, null, 2) +
        '\n```'
    );
}

// ───────────────────────── Plan-meta state machine ──────────────────────────
//
// Pure transitions for the plan-execution lifecycle. The component layer
// (ChatPanel / InlineChat) stores a `meta` blob on each assistant message
// and patches it through these transitions:
//
//   pending → executing → (executed | failed) → (executed via Resume)
//   pending → discarded
//
// Each helper returns ONLY the fields that should be patched in — the
// caller merges this into the existing meta. Keeping them as patches makes
// it cheap to test and lets the caller decide how to merge.

export interface PlanMetaPatch {
    planStatus: 'executing' | 'executed' | 'failed' | 'discarded';
    planExecutedSteps?: number;
    planExecutedAt?: number;
    planDiscardedAt?: number;
    planLastError?: string;
}

/** Begin executing a plan — patches status to 'executing' and resets the step count. */
export function planMetaStart(): PlanMetaPatch {
    return { planStatus: 'executing', planExecutedSteps: 0 };
}

/** Mark the plan as successfully executed. */
export function planMetaSuccess(stepCount: number, now: number): PlanMetaPatch {
    return {
        planStatus: 'executed',
        planExecutedAt: now,
        planExecutedSteps: stepCount,
    };
}

/** Mark the plan as failed with the given error message. */
export function planMetaFail(error: string | undefined): PlanMetaPatch {
    return { planStatus: 'failed', planLastError: error };
}

/** Mark the plan as discarded at the given time. */
export function planMetaDiscard(now: number): PlanMetaPatch {
    return { planStatus: 'discarded', planDiscardedAt: now };
}

// ───────────────────────── Step description ──────────────────────────

export function describePlanStep(step: PlanStep): string {
    if (step.kind === 'add') {
        const after = step.afterCellId ? ` (after #${step.afterCellId})` : '';
        return `Add ${step.type} cell${after}`;
    }
    if (step.kind === 'edit') {
        return `Edit cell #${step.cellId}`;
    }
    const idx = step.plotBlockIndex ?? 0;
    return `Replace plot block ${idx} in #${step.cellId}`;
}

// ───────────────────────── Plot block extraction ──────────────────────────

/** Pure helper used by ChatPlanCard to show the before-side of an applyPlot
 * diff. Returns the content of the Nth ```plot fence inside a cell, or null
 * when out of range. */
export function extractPlotBlockAt(cellContent: string, plotBlockIndex: number): string | null {
    const segs = tokenizeCellContent(cellContent);
    const plots = segs.filter(s => s.type === 'plot');
    if (plotBlockIndex < 0 || plotBlockIndex >= plots.length) return null;
    return plots[plotBlockIndex].content.trim();
}

// ───────────────────────── Plan diff ──────────────────────────

export interface PlanDiffStepAdded   { kind: 'added';   step: PlanStep }
export interface PlanDiffStepRemoved { kind: 'removed'; step: PlanStep }
export interface PlanDiffStepModified {
    kind: 'modified';
    before: PlanStep;
    after: PlanStep;
    fields: string[];
}
export interface PlanDiffStepUnchanged { kind: 'unchanged'; step: PlanStep }
export type PlanDiffStep = PlanDiffStepAdded | PlanDiffStepRemoved | PlanDiffStepModified | PlanDiffStepUnchanged;

export interface PlanDiffReport {
    summaryChanged: boolean;
    summaryBefore: string;
    summaryAfter: string;
    stepDiffs: PlanDiffStep[];
}

function stepMatchKey(s: PlanStep, seen?: Map<string, number>): string {
    let base: string;
    if (s.kind === 'edit') base = `edit:${s.cellId}`;
    else if (s.kind === 'applyPlot') base = `applyPlot:${s.cellId}:${s.plotBlockIndex ?? 0}`;
    else {
        // add: key by (kind, type, simple content hash)
        let hash = 0;
        for (let i = 0; i < s.content.length; i++) hash = (hash * 31 + s.content.charCodeAt(i)) | 0;
        base = `add:${s.type}:${hash}`;
    }
    if (!seen) return base;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
}

function changedFields(a: PlanStep, b: PlanStep): string[] {
    const fields: string[] = [];
    if (a.kind !== b.kind) return ['kind'];
    if ((a as any).content !== (b as any).content) fields.push('content');
    if ((a as any).plotConfig !== (b as any).plotConfig) fields.push('plotConfig');
    if ((a as any).rationale !== (b as any).rationale) fields.push('rationale');
    if ((a as any).afterCellId !== (b as any).afterCellId) fields.push('afterCellId');
    if ((a as any).plotBlockIndex !== (b as any).plotBlockIndex) fields.push('plotBlockIndex');
    return fields;
}

export function diffPlans(before: ParsedPlan, after: ParsedPlan): PlanDiffReport {
    const beforeSeen = new Map<string, number>();
    const beforeMap = new Map<string, PlanStep>();
    before.steps.forEach(s => beforeMap.set(stepMatchKey(s, beforeSeen), s));

    const afterSeen = new Map<string, number>();
    const afterKeys = new Set<string>();
    const stepDiffs: PlanDiffStep[] = [];

    for (const a of after.steps) {
        const key = stepMatchKey(a, afterSeen);
        afterKeys.add(key);
        const b = beforeMap.get(key);
        if (!b) {
            stepDiffs.push({ kind: 'added', step: a });
        } else {
            const fields = changedFields(b, a);
            if (fields.length === 0) stepDiffs.push({ kind: 'unchanged', step: a });
            else stepDiffs.push({ kind: 'modified', before: b, after: a, fields });
        }
    }
    const beforeRemovalSeen = new Map<string, number>();
    for (const b of before.steps) {
        if (!afterKeys.has(stepMatchKey(b, beforeRemovalSeen))) {
            stepDiffs.push({ kind: 'removed', step: b });
        }
    }

    return {
        summaryChanged: before.summary !== after.summary,
        summaryBefore: before.summary,
        summaryAfter: after.summary,
        stepDiffs,
    };
}

// ───────────────────────── Channel reducer ──────────────────────────

import type { AiTier } from '../AiService';

export interface ChannelState {
    mode: ChatMode;
    btwHints: BtwHint[];
    lastBtwCallAt: number | null;
    lastBtwTier: AiTier;
}

export type ChannelAction =
    | { type: 'set-mode'; mode: ChatMode }
    | { type: 'add-hints'; hints: BtwHint[] }
    | { type: 'dismiss-hint'; id: string }
    | { type: 'clear-hints' }
    | { type: 'mark-btw-fired'; at: number; tier: AiTier }
    | { type: 'reset' }
    | { type: 'reset-to'; mode: ChatMode; hints: BtwHint[] };

export const initialChannelState: ChannelState = {
    mode: DEFAULT_MODE,
    btwHints: [],
    lastBtwCallAt: null,
    lastBtwTier: 'basic',
};

export function channelReducer(s: ChannelState, a: ChannelAction): ChannelState {
    switch (a.type) {
        case 'set-mode':
            return a.mode === s.mode ? s : { ...s, mode: a.mode };
        case 'add-hints': {
            const merged = [...s.btwHints];
            for (const h of a.hints) {
                if (!isDuplicateHint(merged, h)) merged.push(h);
            }
            return merged.length === s.btwHints.length ? s : { ...s, btwHints: merged };
        }
        case 'dismiss-hint': {
            const next = s.btwHints.filter(h => h.id !== a.id);
            return next.length === s.btwHints.length ? s : { ...s, btwHints: next };
        }
        case 'clear-hints':
            return s.btwHints.length === 0 ? s : { ...s, btwHints: [] };
        case 'mark-btw-fired':
            return { ...s, lastBtwCallAt: a.at, lastBtwTier: a.tier };
        case 'reset':
            return { ...initialChannelState, btwHints: [] };
        case 'reset-to':
            return { ...initialChannelState, mode: a.mode, btwHints: a.hints };
    }
}

// ── Local model prompt ────────────────────────────────────────────────────────

export interface SchemaTable {
    name: string;
    columns: Array<{ name: string; type?: string }>;
}

/**
 * Build a tuned system prompt for local (small) models.
 * Shorter and more directive than the cloud prompt — local models degrade
 * with long preambles. Includes full schema, variables, :::cell syntax,
 * and 3 few-shot examples.
 */
export function buildLocalSystemPrompt(
    schema: SchemaTable[],
    variables: Record<string, unknown>,
): string {
    const schemaText = schema.length > 0
        ? schema.map(t => {
              const cols = t.columns.map(c => c.type ? `${c.name} ${c.type}` : c.name).join(', ');
              return `  ${t.name}(${cols})`;
          }).join('\n')
        : '  (no tables loaded yet)';

    const varsText = Object.keys(variables).length > 0
        ? Object.entries(variables).map(([k, v]) => `  $${k} = ${JSON.stringify(v)}`).join('\n')
        : '  (none)';

    return `You are a JFR performance analyst embedded in a notebook. Be concise, direct, and genuinely helpful.
When you find something interesting, say so. Suggest the next useful question. Don't pad answers.

Available tables:
${schemaText}

Current variables:
${varsText}

When a chart or table would make the answer clearer, embed it inline using a cell fence:
  :::cell type=chart
  sql: SELECT ...
  plot: LINE_CHART(x: "col", y: ["col2"])
  :::
Supported types: chart, table, flamegraph. Text can appear before and after each fence.

If a query fails or returns an error, fix the SQL and try again. Briefly explain what you changed.
To query data you don't have, call the query_data tool with sql, reason, and tables.
You may call tools multiple times in one response — query, check the result, then embed a chart.

--- Examples ---
Q: What is the average GC pause?
A: Average GC pause is 14ms (p99: 48ms). Mostly short Young GC — healthy. Want a breakdown by GC type?

Q: Show me heap usage over time.
A: Heap grew steadily and peaked at ~2.4 GB around t=40s:
:::cell type=chart
sql: SELECT time_bucket('1s', startTime) AS t, avg(heapUsed) AS heap_mb FROM gc_heap_summary GROUP BY t ORDER BY t
plot: LINE_CHART(x: "t", y: ["heap_mb"])
:::
No GC recovery after the peak — likely a retained reference. Want me to find the top allocating classes?

Q: Which methods consume the most CPU?
A: Let me query the execution samples.
[calls query_data: sql=SELECT stackTrace, sum(samples) AS n FROM ExecutionSample GROUP BY stackTrace ORDER BY n DESC LIMIT 20, reason="Find hot CPU methods", tables=["ExecutionSample"]]`;
}

export function buildBrowserSystemPrompt(
    schema: SchemaTable[],
    variables: Record<string, unknown>,
): string {
    const tableList = schema.length > 0
        ? schema.map(t => `- ${t.name}(${t.columns.map(c => c.name).join(', ')})`).join('\n')
        : '- (no tables loaded yet)';
    const varList = Object.keys(variables).length > 0
        ? `Current variables: ${Object.entries(variables).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`
        : '';

    return `You are a JFR performance analyst. Answer questions about JFR data concepts, schema, and analysis strategies.
You cannot query data directly in this mode.

Available tables:
${tableList}
${varList}

Be concise and helpful. Suggest SQL queries the user can run themselves.`.trim();
}
