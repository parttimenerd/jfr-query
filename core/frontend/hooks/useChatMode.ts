// useChatMode — per-channel state hook for the four chat modes
// (normal / plan / btw / verbose). Composes:
//   - channelReducer (pure)
//   - persistence (localStorage)
//   - btwOrchestrator (gates + analyzer + LLM call + cross-channel dedup)
//
// The hook is intentionally UI-agnostic. It exposes:
//   • state               (mode, btwHints, lastBtwCallAt, lastBtwTier)
//   • setMode(mode)       (also handles persistence)
//   • dismissHint(id)
//   • clearHints()
//   • parsePlan(text)     (delegates to chatModes.parsePlanFromText)
//   • maybeRunBtw(...)    (delegates to runBtwOrchestrator, then dispatches)
//
// Storage is dependency-injected so tests can use MemoryStorage; the default
// uses real localStorage/sessionStorage only at the call-site that builds the
// hook config.

import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
    channelReducer,
    initialChannelState,
    parsePlanFromText,
    type ChatMode,
    type BtwHint,
    type ChannelState,
    type ChannelAction,
    type ParsedPlan,
} from '../services/ai/chatModes';
import { runBtwOrchestrator } from '../services/ai/btwOrchestrator';
import { loadPersistedState, saveChannel, type StorageLike as PersistStorage } from '../services/ai/chatPersistence';
import type { StorageLike as DedupStorage } from '../services/ai/btwDedup';
import type { AiServiceLike } from '../services/ai/btwCaller';
import type { AiTier, VisibilityMode } from '../services/AiService';
import type { RecentResult, SchemaBundle } from '../services/ai/visibility';

export interface UseChatModeOptions {
    /** Stable identifier for this channel — sidebar uses the channel id, inline
     * chat uses `inline-<cellId>`. */
    channelId: string;
    /** Initial mode override (e.g. from URL or localStorage). Defaults to 'normal'. */
    initialMode?: ChatMode;
    /** Inject storage for persistence + dedup. Browser code passes
     * localStorage / sessionStorage; tests pass MemoryStorage. */
    persistStorage?: PersistStorage | null;
    dedupStorage?: DedupStorage | null;
    /** AiService for the btw call. Optional — tests can omit. */
    aiService?: AiServiceLike | null;
    /** Initial tier for the btw call. Hook escalates to advanced internally. */
    initialBtwTier?: AiTier;
    /** Time source for tests. Defaults to Date.now. */
    now?: () => number;
}

export interface UseChatModeApi {
    state: ChannelState;
    setMode: (mode: ChatMode) => void;
    dismissHint: (id: string) => void;
    clearHints: () => void;
    addHints: (hints: BtwHint[]) => void;
    parsePlan: (text: string) => ParsedPlan | null;
    /** Run the btw orchestrator. Returns the hints that were appended to state
     * (after dedup). No-op if mode != 'btw' or gates block. */
    maybeRunBtw: (args: {
        userText: string;
        assistantText: string;
        schema: SchemaBundle | null;
        visibility: VisibilityMode;
        recentResult?: RecentResult | null;
        signal?: AbortSignal;
    }) => Promise<BtwHint[]>;
}

const defaultNow = () => Date.now();

export function useChatMode(opts: UseChatModeOptions): UseChatModeApi {
    const {
        channelId,
        initialMode,
        persistStorage = null,
        dedupStorage = null,
        aiService = null,
        initialBtwTier = 'basic',
        now = defaultNow,
    } = opts;

    const init = (): ChannelState => {
        let mode: ChatMode = initialMode ?? initialChannelState.mode;
        let hints: BtwHint[] = [];
        if (persistStorage) {
            const persisted = loadPersistedState(persistStorage);
            const channel = persisted.channels.find(c => c.id === channelId);
            if (channel) {
                mode = initialMode ?? channel.mode;
                hints = channel.hints;
            }
        }
        return {
            ...initialChannelState,
            mode,
            btwHints: hints,
            lastBtwTier: initialBtwTier,
        };
    };

    const [state, dispatch] = useReducer(channelReducer, undefined as any, init);

    // When channelId changes, reload persisted state for the new channel instead
    // of keeping the previous channel's state. Without this, the persistence
    // effect fires with the new channelId but stale state, corrupting the new
    // channel's storage entry.
    const prevChannelIdRef = useRef(channelId);
    const switchingChannelRef = useRef(false);
    useEffect(() => {
        if (prevChannelIdRef.current === channelId) return;
        prevChannelIdRef.current = channelId;
        switchingChannelRef.current = true;
        let mode: ChatMode = initialMode ?? initialChannelState.mode;
        let hints: BtwHint[] = [];
        if (persistStorage) {
            const persisted = loadPersistedState(persistStorage);
            const channel = persisted.channels.find(c => c.id === channelId);
            if (channel) {
                mode = initialMode ?? channel.mode;
                hints = channel.hints;
            }
        }
        dispatch({ type: 'reset-to', mode, hints });
    }, [channelId, initialMode, persistStorage]);

    // Snapshot of state for the async orchestrator — avoids stale closures.
    const stateRef = useRef(state);
    stateRef.current = state;

    const isFirst = useRef(true);
    useEffect(() => {
        if (isFirst.current) { isFirst.current = false; return; }
        // Skip saving when we just switched channels — state is being reset to the
        // new channel's persisted values; saving would write stale data under the
        // new channelId before the reset-to dispatch has been applied.
        if (switchingChannelRef.current) { switchingChannelRef.current = false; return; }
        if (!persistStorage) return;
        saveChannel(persistStorage, {
            id: channelId,
            mode: state.mode,
            hints: state.btwHints,
            now: now(),
        });
    }, [state.mode, state.btwHints, channelId, persistStorage, now]);

    const setMode = useCallback((mode: ChatMode) => {
        dispatch({ type: 'set-mode', mode });
    }, []);
    const dismissHint = useCallback((id: string) => {
        dispatch({ type: 'dismiss-hint', id });
    }, []);
    const clearHints = useCallback(() => {
        dispatch({ type: 'clear-hints' });
    }, []);
    const addHints = useCallback((hints: BtwHint[]) => {
        dispatch({ type: 'add-hints', hints });
    }, []);

    const parsePlan = useCallback((text: string) => parsePlanFromText(text), []);

    const maybeRunBtw = useCallback<UseChatModeApi['maybeRunBtw']>(async (args) => {
        const snap = stateRef.current;
        const fireTime = now();
        const result = await runBtwOrchestrator({
            mode: snap.mode,
            lastBtwCallAt: snap.lastBtwCallAt,
            lastBtwTier: snap.lastBtwTier,
            userText: args.userText,
            assistantText: args.assistantText,
            schema: args.schema,
            visibility: args.visibility,
            recentResult: args.recentResult ?? null,
            aiService,
            dedupStorage,
            now: fireTime,
            signal: args.signal,
        });
        if (result.fired) {
            dispatch({ type: 'mark-btw-fired', at: fireTime, tier: result.finalTier });
        }
        if (result.hints.length > 0) dispatch({ type: 'add-hints', hints: result.hints });
        return result.hints;
    }, [aiService, dedupStorage, now]);

    return {
        state,
        setMode,
        dismissHint,
        clearHints,
        addHints,
        parsePlan,
        maybeRunBtw,
    };
}

export type { ChannelState, ChannelAction };

