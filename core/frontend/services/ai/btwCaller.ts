// Background "by the way" hint caller. Runs after a main chat turn finishes
// and produces 0-3 short suggestion cards. Tool-free; the model only writes a
// jfr-btw fenced JSON block.
//
// Falls back from `basic` to `advanced` tier on a parse miss, since cheaper
// models sometimes ignore the structured-output requirement.

import { BTW_MODE_HINT_SYSTEM, parseBtwHintsFromText, type BtwHint } from './chatModes';
import type { aiService as defaultAiService, AiTier, VisibilityMode } from '../AiService';
import type { RecentResult, SchemaBundle } from './visibility';

/** Structural type — matches AiService's streamChatWithTools without needing
 * the class itself exported. */
export type AiServiceLike = Pick<typeof defaultAiService, 'streamChatWithTools'>;

export interface BtwCallInput {
    aiService: AiServiceLike;
    /** What the user asked. */
    userText: string;
    /** What the assistant just replied. */
    assistantText: string;
    schema: SchemaBundle | null;
    visibility: VisibilityMode;
    recentResult?: RecentResult | null;
    /** Initial tier for the call. */
    tier?: AiTier;
    signal?: AbortSignal;
}

export interface BtwCallOutcome {
    hints: BtwHint[];
    /** Which tier ultimately produced the hints (after possible escalation). */
    finalTier: AiTier;
    parseMiss: boolean;
}

async function runOneCall(
    input: BtwCallInput,
    tier: AiTier,
): Promise<{ text: string }> {
    let text = '';
    const stream = input.aiService.streamChatWithTools(
        [
            { role: 'user', content: `User asked:\n${input.userText}\n\nAssistant replied:\n${input.assistantText}` },
        ],
        { tables: input.schema?.tables ?? [], views: input.schema?.views ?? [], macros: input.schema?.macros ?? [] },
        [],
        // No mutate or read tools are exposed to the btw call.
        // We pass a "no-op" deps object so the runtime never has anything to dispatch.
        // The orchestrator never calls these because tools is empty.
        {
            duckdbQuery: async () => { throw new Error('tools disabled in btw mode'); },
            listCells: () => [],
            mutateCells: async () => { throw new Error('tools disabled in btw mode'); },
            listPlotsInNotebook: () => [],
            requireApproval: async () => {},
        },
        {
            visibility: input.visibility,
            recentResult: input.recentResult ?? null,
            tier,
            feature: 'chat',
            customSystemPrompt: BTW_MODE_HINT_SYSTEM,
            replaceSystemPrompt: true,
            signal: input.signal,
        },
    );

    for await (const chunk of stream) {
        if (chunk.kind === 'text') text += chunk.delta;
        // tool_call / tool_result are impossible here (tools array is empty)
        // but we ignore them defensively anyway.
    }
    return { text };
}

/** Run the btw call. If the first attempt produces no hints and the initial
 * tier is below `advanced`, retry once at `advanced`. */
export async function runBtwCall(input: BtwCallInput): Promise<BtwCallOutcome> {
    const initialTier = input.tier ?? 'basic';
    const first = await runOneCall(input, initialTier);
    const hints = parseBtwHintsFromText(first.text);
    if (hints.length > 0 || initialTier === 'advanced') {
        return { hints, finalTier: initialTier, parseMiss: hints.length === 0 };
    }
    // Escalate once — but bail if the caller already aborted.
    if (input.signal?.aborted) {
        return { hints: [], finalTier: initialTier, parseMiss: true };
    }
    const second = await runOneCall(input, 'advanced');
    const escalatedHints = parseBtwHintsFromText(second.text);
    return {
        hints: escalatedHints,
        finalTier: escalatedHints.length > 0 ? 'advanced' : initialTier,
        parseMiss: escalatedHints.length === 0,
    };
}
