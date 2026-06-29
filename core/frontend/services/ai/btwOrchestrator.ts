// Pure async orchestrator for the "by the way" call. The useChatMode hook
// wraps this with React state — the orchestrator itself is dependency-injected
// and side-effect-free except for the storage objects you pass in.

import { shouldFireBtwCall, type BtwHint, type ChatMode } from './chatModes';
import { runBtwCall, type AiServiceLike } from './btwCaller';
import { analyzeRecentResult } from './anomalyAnalyzer';
import {
    filterUnseen,
    markSeen,
    type StorageLike as DedupStorage,
} from './btwDedup';
import type { AiTier, VisibilityMode } from '../AiService';
import type { RecentResult, SchemaBundle } from './visibility';

export interface BtwOrchestratorInput {
    /** Gate inputs. */
    mode: ChatMode;
    lastBtwCallAt: number | null;
    lastBtwTier: AiTier;
    /** Conversation context. */
    userText: string;
    assistantText: string;
    schema: SchemaBundle | null;
    visibility: VisibilityMode;
    recentResult?: RecentResult | null;
    /** Dependencies. */
    aiService?: AiServiceLike | null;
    dedupStorage?: DedupStorage | null;
    now: number;
    signal?: AbortSignal;
}

export interface BtwOrchestratorResult {
    /** Whether the call actually ran (gates passed). */
    fired: boolean;
    /** Hints surviving dedup, ready to push to state. */
    hints: BtwHint[];
    /** Tier used on the final call (may differ from lastBtwTier if escalated). */
    finalTier: AiTier;
}

const SKIP: BtwOrchestratorResult = { fired: false, hints: [], finalTier: 'basic' };

export async function runBtwOrchestrator(input: BtwOrchestratorInput): Promise<BtwOrchestratorResult> {
    if (input.mode !== 'btw') return { ...SKIP, finalTier: input.lastBtwTier };
    if (!shouldFireBtwCall({
        lastFiredAt: input.lastBtwCallAt,
        now: input.now,
        lastAssistantTextLength: input.assistantText.length,
        visibility: input.visibility,
    })) return { ...SKIP, finalTier: input.lastBtwTier };

    // 1) Local analyzer hints (cheap, always run).
    const analyzerHints = analyzeRecentResult(input.recentResult ?? null);

    // 2) LLM hints (only if aiService is wired).
    let llmHints: BtwHint[] = [];
    let finalTier: AiTier = input.lastBtwTier;
    if (input.aiService) {
        try {
            const out = await runBtwCall({
                aiService: input.aiService,
                userText: input.userText,
                assistantText: input.assistantText,
                schema: input.schema,
                visibility: input.visibility,
                recentResult: input.recentResult ?? null,
                tier: input.lastBtwTier,
                signal: input.signal,
            });
            llmHints = out.hints;
            finalTier = out.finalTier;
        } catch {
            // Background call — silent failure is intentional.
        }
    }

    // 3) Cross-channel dedup, then merge.
    let merged = [...analyzerHints, ...llmHints];
    if (input.dedupStorage) {
        merged = filterUnseen(input.dedupStorage, merged, input.now);
        for (const h of merged) markSeen(input.dedupStorage, h, input.now);
    }

    return { fired: true, hints: merged, finalTier };
}
