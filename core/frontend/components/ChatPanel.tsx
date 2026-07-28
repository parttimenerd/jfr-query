import React, { useState, useRef, useEffect, useContext, useMemo, useCallback } from 'react';
import { aiService, providerMetadataRegistry } from '../services/AiService';
import type { VisibilityMode, AiTier } from '../services/AiService';
import { SettingsContext } from '../context/SettingsContext';
import { validatePlotConfig } from '../utils/plotValidator';
import type { ChatMessage, NotebookMetadata, NotebookCellData } from '../types';
import { MessageSender } from '../types';
import { XMarkIcon } from './icons/XMarkIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { SendIcon } from './icons/SendIcon';
import { ClipboardIcon } from './icons/ClipboardIcon';
import { PlusIcon } from './icons/PlusIcon';
import { DataContext } from '../context/DuckDBContext';
import { ArrowCounterclockwiseIcon } from './icons/ArrowCounterclockwiseIcon';
import { Content } from '@google/genai';
import type { AiProviderType } from '../services/ai/IAiProvider';
import type { ToolChatMessage } from '../services/ai/IAiProvider';
import { TOOLS, type Tool } from '../services/ai/tools';
import type { NotebookMutation, ToolDeps } from '../services/ai/tools/runtime';
import { tokenizeCellContent, reconstructCellContent } from '../utils/notebookParser';
import {
    chooseProposalKind,
    applyApprovalAction,
    ChatProposalCard,
    type ApprovalRecord,
    type ProposalKind,
} from './ChatProposalCard';
import { parseSlashCommand, commandCompletions, STATIC_COMMANDS } from '../utils/slashCommands';
import { SkillContext } from '../context/SkillContext';
import { builtinSkillManifest } from '../data/skills/skills-manifest';
import { renderMarkdown } from './chat/ChatMarkdownView';
import { BtwSuggestionCard } from './chat/BtwSuggestionCard';
import { ChatPlanCard } from './chat/ChatPlanCard';
import { buildStatusTooltip, buildModeTooltip, buildModelTooltip } from './chat/chatStatusTooltip';
import { buildAddCellArgs } from './chat/addCellButton';
import { variablesSystemPromptLine } from './chat/variablesSystemPrompt';
import { isAutoChannelLabel } from './chat/channelTitle';
import { ToolCallLine } from './chat/ToolCallLine';
import { InlinePreview } from './chat/InlinePreview';
import { formatActionLine } from './chat/toolActionFormat';
import { scrollToCell } from './chat/scrollToCell';
import {
    mentionCandidates,
    detectMentionPrefix,
    filterMentions,
    applyMention,
    type MentionCandidate,
} from './chat/mentionCompletions';
import { useChatMode } from '../hooks/useChatMode';
import {
    filterToolsForMode,
    composeSystemPromptForMode,
    planToExecutionPrompt,
    planMetaStart,
    planMetaSuccess,
    planMetaFail,
    planMetaDiscard,
    type ParsedPlan,
    type BtwHint,
    type ChatMode,
} from '../services/ai/chatModes';
import type { ChatMessageMeta } from '../types';

// Re-export pure helpers so tests can pull them from the panel module.
export {
    chooseProposalKind,
    applyApprovalAction,
    formatToolHeader,
    formatToolArgs,
} from './ChatProposalCard';
export type { ApprovalRecord, ProposalKind } from './ChatProposalCard';

interface ChatPanelProps {
    metadata: NotebookMetadata;
    onAddCellFromAI: (query: string, plotConfig: string, title: string, markdownText: string) => void;
    /** C4 — Optional notebook callbacks for the tool runtime. When supplied,
     * the assistant can mutate cells via approved tool calls. */
    cells?: NotebookCellData[];
    onAddCell?: (mut: { type: 'sql' | 'plot' | 'markdown'; content: string; afterCellId?: string }) => string | undefined;
    onAddCellsBatch?: (muts: { type: 'sql' | 'plot' | 'markdown'; content: string }[]) => void;
    onUpdateCell?: (cellId: string, content: string) => void;
    onDeleteCell?: (cellId: string) => void;
    onMoveCell?: (cellId: string, targetCellId: string, position: 'before' | 'after') => void;
    /** Called when the AI mutates `metadata.variables` via the variables tools. */
    onMetadataChange?: (next: NotebookMetadata) => void | Promise<void>;
    /** Called when the user clicks a [[ref]] / @cell / #plot-N link. */
    onNavigateRef?: (ref: string) => void;
    /** Undo the most recent notebook change. Wired to a per-action ⎌ button on
     * completed tool-call lines. */
    onUndoLastAction?: () => void;
    /** Called just before each AI tool mutation is applied to the notebook.
     * App.tsx uses this to flush the history-state debounce so each tool call
     * becomes its own undo step. */
    onBeforeMutate?: () => void;
    /**
     * When set, ChatPanel will open a new channel tab pre-populated with the
     * snapshot. App sets this when InlineChat requests "pop to sidebar".
     * After consuming it, ChatPanel does nothing further (App should reset it).
     */
    incomingChannel?: InlineChatSnapshot | null;
    onIncomingChannelConsumed?: () => void;
}

/** Serialised snapshot of an InlineChat conversation that has been popped into
 * the sidebar. The channel tab label comes from the cell/block context. */
export interface InlineChatSnapshot {
    channelId: string;
    label: string;
    messages: ChatMessage[];
    provider: AiProviderType;
    model: string;
    draftInput?: string;
}

const initialConversation: ChatMessage[] = [
    { id: '1', sender: MessageSender.AI, text: 'Hello! I can help you analyze your JFR data. What would you like to investigate? For example, you could ask about CPU load or garbage collection pauses.\n\nType `/help` to see available commands.' },
];

/** A named conversation channel shown as a tab in the panel header. */
interface Channel {
    id: string;
    label: string;
    messages: ChatMessage[];
    /** If this channel originated from an InlineChat pop, the originating context. */
    fromInline?: boolean;
}

interface TaskItem { id: string; text: string; done: boolean; }

/**
 * Compact conversation history when it grows beyond MAX_HISTORY_TURNS turns.
 * Older turns beyond the keep window are replaced with a single summary message
 * so the context payload stays manageable. This is a simple sliding-window
 * approach — no LLM summarisation required.
 */
const MAX_HISTORY_TURNS = 20;
function compactHistory(history: ToolChatMessage[]): ToolChatMessage[] {
    if (history.length <= MAX_HISTORY_TURNS) return history;
    let dropCount = history.length - MAX_HISTORY_TURNS;
    // Ensure kept[0] is always an assistant turn so the summary (role:'user')
    // precedes an assistant message — strict role alternation required by all LLM APIs.
    while (dropCount < history.length && history[dropCount]?.role !== 'assistant') dropCount++;
    if (dropCount >= history.length) return history; // nothing safe to drop
    const dropped = history.slice(0, dropCount);
    const kept = history.slice(dropCount);
    const summary = dropped
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${(m.content || '').slice(0, 200)}`)
        .join('\n');
    const summaryMsg: ToolChatMessage = {
        role: 'user',
        content: `[Earlier conversation summary — ${dropped.length} turns omitted]\n${summary}\n[End of summary]`,
    };
    return [summaryMsg, ...kept];
}

/**
 * C4 — Returns the list of providers that currently have credentials wired up
 * (per `metadata.isConfigured(settings)`). Used to populate the provider
 * dropdown in the chat header. Pure helper; exported for tests.
 */
export function listConfiguredProviders(settings: import('../context/SettingsContext').Settings): AiProviderType[] {
    const out: AiProviderType[] = [];
    (Object.entries(providerMetadataRegistry) as Array<[AiProviderType, typeof providerMetadataRegistry.google]>).forEach(([id, meta]) => {
        try { if (meta.isConfigured(settings)) out.push(id); } catch { /* ignore */ }
    });
    return out;
}

/**
 * C4 — Resolve the default model id for a given provider at a given tier from
 * its metadata. Cloud providers have a curated `models` list; local/browser
 * fall back to the provider-specific advanced default and let the user type
 * a free-form id in the dropdown's companion text input.
 */
export function defaultModelForProvider(provider: AiProviderType, tier: AiTier = 'advanced'): string {
    const meta = providerMetadataRegistry[provider];
    if (!meta) return '';
    return meta.defaultModels[tier] ?? meta.defaultModels.advanced ?? '';
}

/**
 * C4 — Map a notebook cell to its primary type for tool-runtime consumption.
 * If a cell has only markdown, it's a markdown cell. If it contains any sql
 * block, it's an sql cell; if it contains a plot block (and no sql), it's a
 * plot cell. Pure helper; exported for tests.
 */
export function cellPrimaryType(content: string): 'sql' | 'plot' | 'markdown' {
    const segs = tokenizeCellContent(content);
    if (segs.some(s => s.type === 'sql')) return 'sql';
    if (segs.some(s => s.type === 'plot')) return 'plot';
    return 'markdown';
}

/**
 * C4 — Extract plot blocks from notebook cells for `listPlots`. Each plot
 * block becomes a single entry; the cell id is used as the plot id.
 */
export function listPlotsFromCells(cells: ReadonlyArray<{ id: string; content: string }>): Array<{ id: string; name?: string; config: string }> {
    const out: Array<{ id: string; name?: string; config: string }> = [];
    for (const c of cells) {
        const segs = tokenizeCellContent(c.content);
        for (const s of segs) {
            if (s.type === 'plot') {
                out.push({ id: c.id, config: s.content.trim() });
            }
        }
    }
    return out;
}


const ChatPanel: React.FC<ChatPanelProps> = ({ metadata, onAddCellFromAI, cells, onAddCell, onAddCellsBatch, onUpdateCell, onDeleteCell, onMoveCell, onMetadataChange, onNavigateRef, onUndoLastAction, onBeforeMutate, incomingChannel, onIncomingChannelConsumed }) => {
    const { schema, query } = useContext(DataContext);
    const { settings } = useContext(SettingsContext);
    const { activeSkills, availableSkills, mergedSystemPrompt, toggleSkill, deactivateSkill, isActive } = useContext(SkillContext);

    // --- Multi-channel state ---
    const [channels, setChannels] = useState<Channel[]>([
        { id: 'main', label: 'Main', messages: initialConversation },
    ]);
    const [activeChannelId, setActiveChannelId] = useState('main');

    const activeChannel = channels.find(c => c.id === activeChannelId) ?? channels[0];
    const messages = activeChannel.messages;
    const messagesRef = useRef(messages);
    messagesRef.current = messages;
    const setMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
        setChannels(prev => prev.map(c => c.id === activeChannelId ? { ...c, messages: updater(c.messages) } : c));
    }, [activeChannelId]);

    const addChannel = useCallback((label?: string, initial?: ChatMessage[], id?: string) => {
        const newId = id ?? `channel-${Date.now()}`;
        setChannels(prev => {
            const channelLabel = label ?? `Channel ${prev.length + 1}`;
            return [...prev, { id: newId, label: channelLabel, messages: initial ?? initialConversation, fromInline: !!id }];
        });
        setActiveChannelId(newId);
        return newId;
    }, []);

    const removeChannel = useCallback((id: string) => {
        setChannels(prev => {
            if (prev.length <= 1) return prev;
            const next = prev.filter(c => c.id !== id);
            setActiveChannelId(cur => cur === id ? (next[0]?.id ?? 'main') : cur);
            return next;
        });
    }, []);

    // Auto-name a channel after its first user message — but only when the
    // user hasn't already renamed it (label still matches the auto-default
    // pattern). Fire-and-forget; on AI failure the auto-default sticks.
    const maybeAutoNameChannel = useCallback((firstMessageText: string) => {
        const ch = channels.find(c => c.id === activeChannelId) ?? channels[0];
        if (!ch) return;
        // Has the user already exchanged real messages here? Skip if so —
        // we only rename on the FIRST user message. `initialConversation`
        // seeds an AI greeting but no user messages.
        const hasPriorUser = ch.messages.some(m => m.sender === MessageSender.User);
        if (hasPriorUser) return;
        if (!isAutoChannelLabel(ch.label)) return; // user renamed it manually
        if (!aiService.isInitialized()) return;
        void aiService.getAiChannelTitle(firstMessageText).then(title => {
            if (!title) return;
            setChannels(prev => prev.map(c =>
                // Re-check the label inside setChannels in case the user
                // renamed between fire and reply.
                c.id === ch.id && isAutoChannelLabel(c.label)
                    ? { ...c, label: title }
                    : c
            ));
        });
    }, [channels, activeChannelId]);

    // Consume incoming channel snapshots from InlineChat "pop to sidebar".
    useEffect(() => {
        if (!incomingChannel) return;
        // Don't create a duplicate if already exists.
        setChannels(prev => {
            if (prev.some(c => c.id === incomingChannel.channelId)) return prev;
            return [...prev, { id: incomingChannel.channelId, label: incomingChannel.label, messages: incomingChannel.messages, fromInline: true }];
        });
        setActiveChannelId(incomingChannel.channelId);
        if (incomingChannel.draftInput) setInput(incomingChannel.draftInput);
        onIncomingChannelConsumed?.();
    }, [incomingChannel, onIncomingChannelConsumed]);

    // --- Per-channel chat mode (normal / plan / btw) ---
    // Storage is the real localStorage/sessionStorage in the browser; useChatMode
    // gracefully handles unavailable storage so tests still work.
    const persistStorage = typeof window !== 'undefined' ? window.localStorage : null;
    const dedupStorage   = typeof window !== 'undefined' ? window.sessionStorage : null;
    const chatMode = useChatMode({
        channelId: activeChannelId,
        persistStorage,
        dedupStorage,
        aiService,
    });

    const [streamingText, setStreamingText] = useState<string | null>(null);
    const [input, setInput] = useState('');
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const [isLoading, setIsLoading] = useState(false);
    // Channel rename UX: double-click a tab to edit. `renamingChannelId` holds
    // the id of the channel being renamed; `renameDraft` is the in-progress text.
    const [renamingChannelId, setRenamingChannelId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState('');
    const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
    const [chatVisibility, setChatVisibility] = useState<VisibilityMode>(settings.aiDefaultVisibility);

    // Per-channel AI memory (key/value facts) and task checklists.
    const [channelMemory, setChannelMemory] = useState<Record<string, Record<string, string>>>({});
    const channelMemoryRef = useRef(channelMemory);
    channelMemoryRef.current = channelMemory;
    const [channelTasks, setChannelTasks] = useState<Record<string, TaskItem[]>>({});
    const activeMemory: Record<string, string> = channelMemory[activeChannelId] ?? {};
    const activeTasks: TaskItem[] = channelTasks[activeChannelId] ?? [];

    const clearMemoryKey = useCallback((key: string) => {
        setChannelMemory(prev => {
            const cur = { ...(prev[activeChannelId] ?? {}) };
            delete cur[key];
            return { ...prev, [activeChannelId]: cur };
        });
    }, [activeChannelId]);

    // Slash-command autocomplete
    const [cmdSuggestions, setCmdSuggestions] = useState<string[]>([]);
    const [cmdSuggestionIdx, setCmdSuggestionIdx] = useState(0);

    // $variable autocomplete
    const [varSuggestions, setVarSuggestions] = useState<string[]>([]);
    const [varSuggestionIdx, setVarSuggestionIdx] = useState(0);
    const notebookVariables = useMemo(() => metadata?.variables ?? {}, [metadata?.variables]);
    const metadataRef = useRef(metadata);
    metadataRef.current = metadata;

    // @-mention autocomplete (parallel to slash). `mentionRange` tracks where
    // the partial `@query` lives in the textarea so Tab/Enter can replace it.
    const [mentionSuggestions, setMentionSuggestions] = useState<MentionCandidate[]>([]);
    const [mentionIdx, setMentionIdx] = useState(0);
    const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null);

    // --- C4 header state: per-chat overrides that do not mutate global Settings ---
    const configuredProviders = useMemo(() => listConfiguredProviders(settings), [settings]);
    const [chatProvider, setChatProvider] = useState<AiProviderType>(() => {
        if (configuredProviders.includes(settings.aiProvider)) return settings.aiProvider;
        return configuredProviders[0] ?? settings.aiProvider;
    });
    const [chatModel, setChatModel] = useState<string>(() => defaultModelForProvider(chatProvider, 'advanced'));
    const providerMeta = providerMetadataRegistry[chatProvider];
    const isFreeFormModel = chatProvider === 'local' || chatProvider === 'browser';

    // --- C4 tool-call records (per current turn). approveAllReads is a
    // per-turn flag reset whenever a new user message starts. ---
    const [proposals, setProposals] = useState<ApprovalRecord[]>([]);
    const proposalsRef = useRef<ApprovalRecord[]>([]);
    proposalsRef.current = proposals;
    const [approveAllReads, setApproveAllReads] = useState(false);
    const approveAllReadsRef = useRef(false);
    approveAllReadsRef.current = approveAllReads;

    // resolver registry for pending requireApproval promises
    const approvalResolvers = useRef<Map<string, { resolve: () => void; reject: (e: Error) => void }>>(new Map());

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const cancelledRef = useRef(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    // Always-fresh ref so tool closures read the latest cells without stale snapshots.
    const cellsRef = useRef(cells ?? []);
    cellsRef.current = cells ?? [];

    // Live visibility ref so tool deps can read the current mode without
    // recapturing the deps object on every visibility change.
    const chatVisibilityRef = useRef(chatVisibility);
    chatVisibilityRef.current = chatVisibility;

    // Whether the active provider can carry images in tool_result. Anthropic
    // supports it today; others fall back to a clear refusal in the runtime.
    const providerSupportsImagesRef = useRef(false);
    providerSupportsImagesRef.current = providerMetadataRegistry[chatProvider]?.supportsImageToolResults === true;

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, proposals]);

    // Keep chat header in sync if the user changes the global provider in Settings.
    useEffect(() => {
        if (!configuredProviders.length) return;
        if (!configuredProviders.includes(chatProvider)) {
            const next = configuredProviders.includes(settings.aiProvider) ? settings.aiProvider : configuredProviders[0];
            setChatProvider(next);
            setChatModel(defaultModelForProvider(next, 'advanced'));
        }
    }, [configuredProviders, chatProvider, settings.aiProvider]);

    const handleReset = () => {
        setMessages(() => initialConversation);
        setStreamingText(null);
        setProposals([]);
        setApproveAllReads(false);
        approvalResolvers.current.clear();
        setIsLoading(false);
        cancelledRef.current = false;
        setChannelMemory(prev => ({ ...prev, [activeChannelId]: {} }));
        setChannelTasks(prev => ({ ...prev, [activeChannelId]: [] }));
    };

    const handleRewindTo = useCallback((keepUpToOriginalIdx: number) => {
        if (isLoading) {
            cancelledRef.current = true;
            abortControllerRef.current?.abort();
            approvalResolvers.current.forEach(r => r.reject(new Error('cancelled')));
            approvalResolvers.current.clear();
            setIsLoading(false);
        }
        setStreamingText(null);
        setProposals([]);
        setApproveAllReads(false);
        setMessages(prev => prev.slice(0, keepUpToOriginalIdx + 1));
    }, [isLoading]);

    const handleCancel = () => {
        cancelledRef.current = true;
        abortControllerRef.current?.abort();
        setIsLoading(false);
        // Reject any pending approvals so the orchestrator unwinds cleanly.
        approvalResolvers.current.forEach(r => r.reject(new Error('cancelled')));
        approvalResolvers.current.clear();
        setMessages(prev => [...prev, { id: Date.now().toString(), sender: MessageSender.AI, text: 'Request cancelled.' }]);
    };

    // --- C4 approval action handlers ---
    const approveProposal = useCallback((id: string) => {
        setProposals(prev => applyApprovalAction(prev, { type: 'approve', id }));
        const resolver = approvalResolvers.current.get(id);
        resolver?.resolve();
        approvalResolvers.current.delete(id);
    }, []);

    const rejectProposal = useCallback((id: string) => {
        setProposals(prev => applyApprovalAction(prev, { type: 'reject', id }));
        const resolver = approvalResolvers.current.get(id);
        resolver?.reject(new Error('rejected by user'));
        approvalResolvers.current.delete(id);
    }, []);

    const approveAllReadsHandler = useCallback(() => {
        setApproveAllReads(true);
        approveAllReadsRef.current = true;
        // Auto-resolve any currently-pending read proposals.
        const readIds: string[] = [];
        for (const p of proposalsRef.current) {
            if (p.status !== 'pending') continue;
            const tool = TOOLS.find(t => t.name === p.name);
            if (tool?.kind === 'read') {
                readIds.push(p.id);
                const r = approvalResolvers.current.get(p.id);
                r?.resolve();
                approvalResolvers.current.delete(p.id);
            }
        }
        if (readIds.length) {
            setProposals(prev => applyApprovalAction(prev, { type: 'approve-all-reads', readIds }));
        }
    }, []);

    // --- Build tool deps that the runtime will call. ---
    const buildToolDeps = useCallback((): ToolDeps => {
        // Use cellsRef so mutateCells always sees the live cell list (not a stale
        // closure over the cells value at the start of the AI turn).
        const getLiveCells = () => cellsRef.current;
        return {
            duckdbQuery: async (sql: string, opts) => {
                // When a limit is requested, push it into the query itself so
                // we don't pull the full result into memory just to slice it.
                // Fetch one extra row so the caller can detect truncation
                // (rows.length > limit → there are more).
                const effectiveSql = (opts && typeof opts.limit === 'number')
                    ? `SELECT * FROM (${sql}) AS __tool_subquery LIMIT ${Math.floor(opts.limit) + 1}`
                    : sql;
                const rows = await query(effectiveSql);
                const columns = rows && rows.length
                    ? Object.keys(rows[0]).map(name => ({ name, type: typeof (rows[0] as any)[name] }))
                    : [];
                return { columns, rows };
            },
            listCells: () => getLiveCells().map(c => ({ id: c.id, type: cellPrimaryType(c.content), content: c.content })),
            mutateCells: async (op: NotebookMutation) => {
                try {
                    onBeforeMutate?.();
                    if (op.kind === 'add') {
                        if (!onAddCell) return { ok: false, error: 'addCell not supported in this environment' };
                        const id = onAddCell({ type: op.type, content: op.content, afterCellId: op.afterCellId });
                        return { ok: true, cellId: id };
                    }
                    if (op.kind === 'edit') {
                        if (!onUpdateCell) return { ok: false, error: 'editCell not supported in this environment' };
                        onUpdateCell(op.cellId, op.content);
                        return { ok: true, cellId: op.cellId };
                    }
                    if (op.kind === 'applyPlot') {
                        if (!onUpdateCell) return { ok: false, error: 'applyPlot not supported in this environment' };
                        // Replace the Nth plot block (op.plotBlockIndex, 0-based) within the cell,
                        // or append a new plot block if none exist.
                        const cell = getLiveCells().find(c => c.id === op.cellId);
                        if (!cell) return { ok: false, error: `cell not found: ${op.cellId}` };
                        const segs = tokenizeCellContent(cell.content);
                        const targetIdx = op.plotBlockIndex ?? 0;
                        const plotSegs = segs.map((s, i) => ({ s, i })).filter(x => x.s.type === 'plot');
                        let newContent: string;
                        if (plotSegs.length === 0) {
                            newContent = cell.content + '\n\n```plot\n' + op.plotConfig + '\n```\n';
                        } else {
                            const target = plotSegs[Math.min(targetIdx, plotSegs.length - 1)];
                            const updatedSegs = segs.map((s, i) =>
                                i === target.i ? { ...s, content: '\n' + op.plotConfig + '\n' } : s
                            );
                            newContent = reconstructCellContent(updatedSegs);
                        }
                        onUpdateCell(op.cellId, newContent);
                        return { ok: true, cellId: op.cellId };
                    }
                    if (op.kind === 'delete') {
                        if (!onDeleteCell) return { ok: false, error: 'deleteCell not supported in this environment' };
                        const cell = getLiveCells().find(c => c.id === op.cellId);
                        if (!cell) return { ok: false, error: `cell not found: ${op.cellId}` };
                        onDeleteCell(op.cellId);
                        return { ok: true, cellId: op.cellId };
                    }
                    if (op.kind === 'move') {
                        if (!onMoveCell) return { ok: false, error: 'moveCell not supported in this environment' };
                        if (op.cellId === op.targetCellId) return { ok: false, error: 'cannot move a cell relative to itself' };
                        const src = getLiveCells().find(c => c.id === op.cellId);
                        const tgt = getLiveCells().find(c => c.id === op.targetCellId);
                        if (!src) return { ok: false, error: `cell not found: ${op.cellId}` };
                        if (!tgt) return { ok: false, error: `target cell not found: ${op.targetCellId}` };
                        onMoveCell(op.cellId, op.targetCellId, op.position);
                        return { ok: true, cellId: op.cellId };
                    }
                    return { ok: false, error: 'unknown mutation' };
                } catch (e: any) {
                    return { ok: false, error: e?.message || String(e) };
                }
            },
            listPlotsInNotebook: () => listPlotsFromCells(getLiveCells()),
            getVariables: () => metadataRef.current?.variables ?? {},
            setVariables: async (next) => {
                if (!onMetadataChange) return { ok: false, error: 'setVariables not supported in this environment' };
                try {
                    await onMetadataChange({ ...metadataRef.current, variables: next });
                    return { ok: true };
                } catch (e: any) {
                    return { ok: false, error: e?.message || String(e) };
                }
            },
            getVisibility: () => chatVisibilityRef.current,
            providerSupportsImages: () => providerSupportsImagesRef.current,
            getMemory: () => channelMemoryRef.current[activeChannelId] ?? {},
            setMemory: (key, value) => setChannelMemory(prev => {
                const cur = { ...(prev[activeChannelId] ?? {}) };
                // Re-insert to move key to most-recently-used position (end).
                delete cur[key];
                if (Object.keys(cur).length >= 10) {
                    delete cur[Object.keys(cur)[0]]; // evict oldest
                }
                cur[key] = value;
                return { ...prev, [activeChannelId]: cur };
            }),
            setTaskList: (tasks) => setChannelTasks(prev => ({ ...prev, [activeChannelId]: tasks })),
            screenshotPreview: async (previewId: string) => {
                if (typeof document === 'undefined' || !previewId) return null;
                const escaped = typeof CSS !== 'undefined' && CSS.escape
                    ? CSS.escape(previewId)
                    : previewId.replace(/"/g, '\\"');
                const node = document.querySelector(`[data-preview-id="${escaped}"]`) as HTMLElement | null;
                if (!node) return null;
                try {
                    // Lazy-import keeps html2canvas (~50KB gz) out of the main bundle.
                    const mod: any = await import('html2canvas');
                    const html2canvas = mod.default ?? mod;
                    const canvas = await html2canvas(node, { backgroundColor: '#1f2937', scale: 1.5, logging: false });
                    return canvas.toDataURL('image/png');
                } catch (e) {
                    console.warn('[screenshotPreview] capture failed', e);
                    return null;
                }
            },
            requireApproval: (toolName: string, args: any) => new Promise<void>((resolve, reject) => {
                // B-197: reject immediately if the user already cancelled so the
                // tool loop doesn't hang waiting for an approval that will never come.
                if (cancelledRef.current) { reject(new Error('cancelled')); return; }
                // The runtime always calls this for mutate tools. We've already
                // registered the pending proposal in onToolCall before reaching
                // executeTool; the resolver gets stored under the same call id.
                const pending = proposalsRef.current.find(p => p.name === toolName && p.status === 'pending' && shallowEqualArgs(p.args, args));
                const id = pending?.id ?? `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                if (!pending) {
                    setProposals(prev => [...prev, { id, name: toolName, args, status: 'pending' }]);
                }
                approvalResolvers.current.set(id, { resolve, reject });
                if (cancelledRef.current) {
                    approvalResolvers.current.delete(id);
                    reject(new Error('cancelled'));
                }
            }),
        };
    }, [onAddCell, onUpdateCell, onDeleteCell, onMoveCell, onMetadataChange, onBeforeMutate, query, activeChannelId]);

    const handleSendLegacy = async () => {
        // Fallback path when the active provider has no tool support (browser).
        // Browser provider doesn't understand conversational queries — show a helpful message.
        if (chatProvider === 'browser') {
            const hint = `The browser (offline) model only supports SQL autocomplete — it can't answer conversational questions.\n\nTo use AI chat, configure a provider in ⚙ Settings:\n• **Local OpenAI-compatible** — Ollama, LM Studio, etc.\n• **Claude (Anthropic)** — requires API key.\n• **Gemini (Google)** — requires API key.`;
            setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: hint }]);
            return;
        }
        const conversationHistory: Content[] = messagesRef.current.slice(1).map(m => ({
            role: m.sender === MessageSender.User ? 'user' : 'model',
            parts: [{ text: m.code ? `${m.text}\n\`\`\`sql\n${m.code}\n\`\`\`\n\`\`\`plot\n${m.plotConfig}\n\`\`\`` : m.text }],
        }));
        conversationHistory.push({ role: 'user', parts: [{ text: input }] });
        try {
            const resp = await aiService.getAiAgentResponse(conversationHistory, schema!.tables, schema!.views, schema!.macros, metadata.customSystemPrompt, chatVisibility);
            const final: ChatMessage = {
                id: (Date.now() + 1).toString(),
                sender: MessageSender.AI,
                text: resp.text,
                code: resp.code ?? undefined,
                plotConfig: resp.plotConfig ?? (resp.code ? 'TABLE()' : undefined),
                isActionable: !!resp.code,
            };
            if (resp.code) {
                const qres = await query(resp.code);
                const pErr = validatePlotConfig(resp.plotConfig || 'TABLE()', qres || []);
                if (pErr) throw new Error(`Plot validation failed: ${pErr}`);
            }
            setMessages(prev => [...prev, final]);
        } catch (e: any) {
            setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Error: ${e.message}` }]);
        }
    };

    const handleSend = async (override?: { text?: string; hiddenUserMessage?: boolean; forceMode?: 'normal' | 'plan' | 'btw' }): Promise<{ ok: boolean; error?: string }> => {
        const inputText0 = override?.text ?? input;
        if (inputText0.trim() === '' || isLoading || !schema) return { ok: false, error: 'invalid input or chat busy' };

        // --- Slash command handling (skip when override path is used) ---
        if (!override) {
        const slashCmd = parseSlashCommand(input.trim(), availableSkills.map(s => s.name));
        if (slashCmd) {
            setInput('');
            setCmdSuggestions([]);
            if (slashCmd.kind === 'clear') {
                handleReset();
                return { ok: true };
            }
            if (slashCmd.kind === 'compact') {
                const summary = messages.slice(1)
                    .map(m => `${m.sender === MessageSender.User ? 'User' : 'AI'}: ${m.text.slice(0, 120)}`)
                    .join('\n');
                const summaryMsg: ChatMessage = {
                    id: Date.now().toString(),
                    sender: MessageSender.AI,
                    text: `**Conversation compacted.**\n\n${summary.slice(0, 800)}${summary.length > 800 ? '\n…' : ''}`,
                };
                setMessages(() => [initialConversation[0], summaryMsg]);
                return { ok: true };
            }
            if (slashCmd.kind === 'help') {
                setMessages(prev => [...prev,
                    { id: Date.now().toString(), sender: MessageSender.User, text: '/help' },
                    { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: slashCmd.text },
                ]);
                return { ok: true };
            }
            if (slashCmd.kind === 'mode') {
                chatMode.setMode(slashCmd.mode);
                const label =
                    slashCmd.mode === 'plan' ? 'Plan mode — I will propose changes without modifying the notebook.' :
                    slashCmd.mode === 'btw'  ? 'BTW mode — you will get "by the way" suggestions after each reply.' :
                    'Normal mode — I may modify the notebook directly.';
                setMessages(prev => [...prev,
                    { id: Date.now().toString(), sender: MessageSender.User, text: `/${slashCmd.mode}` },
                    { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: label },
                ]);
                return { ok: true };
            }
            if (slashCmd.kind === 'model') {
                if (!slashCmd.query) {
                    // Show current model
                    const modelInfo = `**Current model:** \`${chatModel}\` on \`${chatProvider}\`\n\nTo switch: \`/model <model-name>\`\n\nAvailable: ${(providerMeta?.models ?? []).map(m => `\`${m.id}\``).join(', ') || 'type a model name'}`;
                    setMessages(prev => [...prev,
                        { id: Date.now().toString(), sender: MessageSender.User, text: '/model' },
                        { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: modelInfo },
                    ]);
                } else {
                    // Switch model
                    const target = (providerMeta?.models ?? []).find(m => m.id === slashCmd.query || m.name.toLowerCase() === slashCmd.query.toLowerCase());
                    if (target) {
                        setChatModel(target.id);
                        setMessages(prev => [...prev,
                            { id: Date.now().toString(), sender: MessageSender.User, text: `/model ${slashCmd.query}` },
                            { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Switched to \`${target.id}\`.` },
                        ]);
                    } else {
                        setChatModel(slashCmd.query);
                        setMessages(prev => [...prev,
                            { id: Date.now().toString(), sender: MessageSender.User, text: `/model ${slashCmd.query}` },
                            { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Model set to \`${slashCmd.query}\`.` },
                        ]);
                    }
                }
                return { ok: true };
            }
            if (slashCmd.kind === 'provider') {
                if (!slashCmd.query) {
                    const info = `**Current provider:** \`${chatProvider}\`\n\nTo switch: \`/provider <name>\`\n\nConfigured: ${configuredProviders.map(p => `\`${p}\``).join(', ') || 'none'}`;
                    setMessages(prev => [...prev,
                        { id: Date.now().toString(), sender: MessageSender.User, text: '/provider' },
                        { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: info },
                    ]);
                } else {
                    const target = configuredProviders.find(p => p.toLowerCase() === slashCmd.query.toLowerCase());
                    if (target) {
                        setChatProvider(target as AiProviderType);
                        setChatModel(defaultModelForProvider(target as AiProviderType, 'advanced'));
                        setMessages(prev => [...prev,
                            { id: Date.now().toString(), sender: MessageSender.User, text: `/provider ${slashCmd.query}` },
                            { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Switched to provider \`${target}\`.` },
                        ]);
                    } else {
                        setMessages(prev => [...prev,
                            { id: Date.now().toString(), sender: MessageSender.User, text: `/provider ${slashCmd.query}` },
                            { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Provider \`${slashCmd.query}\` is not configured. Configured: ${configuredProviders.map(p => `\`${p}\``).join(', ') || 'none'}` },
                        ]);
                    }
                }
                return { ok: true };
            }
            if (slashCmd.kind === 'skills-list') {
                const skillList = availableSkills.map(s =>
                    `- \`/${s.name}\` ${s.icon ? s.icon + ' ' : ''}**${s.title}**${isActive(s.name) ? ' ✓ active' : ''} — ${s.description ?? ''}`
                ).join('\n');
                setMessages(prev => [...prev,
                    { id: Date.now().toString(), sender: MessageSender.User, text: '/skills' },
                    { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `### Available Skills\n\n${skillList}\n\nType \`/skill-name\` to activate, \`/skill-name off\` to deactivate, \`/skill-name help\` for sub-commands.` },
                ]);
                return { ok: true };
            }
            if (slashCmd.kind === 'skill-activate') {
                const wasActive = isActive(slashCmd.skillName);
                toggleSkill(slashCmd.skillName);
                const skill = availableSkills.find(s => s.name === slashCmd.skillName);
                const subCmds = (skill?.commands ?? []).filter(c => c.name !== 'help').map(c => `\`/${slashCmd.skillName} ${c.name}\``).join(', ');
                const msg = wasActive
                    ? `Deactivated skill \`${slashCmd.skillName}\`.`
                    : `${skill?.icon ?? '◆'} **${skill?.title ?? slashCmd.skillName}** activated.\n\n${skill?.description ?? ''}\n\nSub-commands: ${subCmds || 'none'}\n\nType \`/${slashCmd.skillName} help\` for details.`;
                setMessages(prev => [...prev,
                    { id: Date.now().toString(), sender: MessageSender.User, text: input },
                    { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: msg },
                ]);
                return { ok: true };
            }
            if (slashCmd.kind === 'skill-deactivate') {
                deactivateSkill(slashCmd.skillName);
                setMessages(prev => [...prev,
                    { id: Date.now().toString(), sender: MessageSender.User, text: input },
                    { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Skill \`${slashCmd.skillName}\` deactivated.` },
                ]);
                return { ok: true };
            }
            if (slashCmd.kind === 'skill-sub') {
                const skill = activeSkills.find(s => s.meta.name === slashCmd.skillName)
                            ?? (availableSkills.find(s => s.name === slashCmd.skillName) ? (() => {
                                toggleSkill(slashCmd.skillName); // auto-activate
                                return { meta: availableSkills.find(s => s.name === slashCmd.skillName)!, cells: new Map(), systemPrompt: '', raw: '' };
                            })() : null);
                const cmd = skill?.meta.commands.find(c => c.name === slashCmd.subCommand);
                if (!cmd) {
                    const available = (availableSkills.find(s => s.name === slashCmd.skillName)?.commands ?? []).map(c => `\`${c.name}\``).join(', ');
                    setMessages(prev => [...prev,
                        { id: Date.now().toString(), sender: MessageSender.User, text: input },
                        { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Unknown sub-command \`${slashCmd.subCommand}\`. Available: ${available || 'none'}` },
                    ]);
                    return { ok: true };
                }
                // Insert cells from this skill
                const loadedSkill = activeSkills.find(s => s.meta.name === slashCmd.skillName)
                    ?? builtinSkillManifest.load(slashCmd.skillName);
                let inserted = 0;
                if (loadedSkill) {
                    const cellsToInsert: { type: 'markdown'; content: string }[] = [];
                    for (const cellName of cmd.cells) {
                        const cellContent = loadedSkill.cells.get(cellName);
                        if (cellContent) cellsToInsert.push({ type: 'markdown', content: cellContent });
                    }
                    if (cellsToInsert.length > 0) {
                        if (cellsToInsert.length === 1 && onAddCell) {
                            onAddCell(cellsToInsert[0]);
                        } else if (onAddCellsBatch) {
                            onAddCellsBatch(cellsToInsert);
                        } else if (onAddCell) {
                            // Fallback: single insertions (last wins due to stale closure)
                            for (const c of cellsToInsert) onAddCell(c);
                        }
                        inserted = cellsToInsert.length;
                    }
                }
                // Insert referenced templates
                if (cmd.templates?.length) {
                    for (const tplName of cmd.templates) {
                        // Templates are notebook-level inserts handled elsewhere; just note them
                        inserted++;
                    }
                }
                // Build inline summary shown in chat alongside the cell insertion.
                let replyText: string;
                const skillMeta = availableSkills.find(s => s.name === slashCmd.skillName);
                if (slashCmd.subCommand === 'help' || cmd.cells.length === 0) {
                    // For `help` or commands with no cells, show the skill's command list.
                    const cmds = (skillMeta?.commands ?? []).filter(c => c.name !== 'help');
                    const cmdLines = cmds.map(c => `- \`/${slashCmd.skillName} ${c.name}\` — ${c.description}`).join('\n');
                    replyText = `${skillMeta?.icon ?? ''} **${skillMeta?.title ?? slashCmd.skillName}** sub-commands:\n\n${cmdLines || '_No sub-commands available._'}`;
                } else {
                    // Show command description and the heading of each inserted cell.
                    const lines: string[] = [];
                    if (cmd.description) lines.push(cmd.description);
                    if (loadedSkill && cmd.cells.length > 0) {
                        const cellTitles = cmd.cells
                            .map(name => {
                                const content = loadedSkill.cells.get(name) ?? '';
                                const headingMatch = content.match(/^##\s+(.+)$/m);
                                return headingMatch ? `**${headingMatch[1].trim()}**` : null;
                            })
                            .filter(Boolean);
                        if (cellTitles.length > 0) lines.push('\nInserted: ' + cellTitles.join(', '));
                    }
                    if (inserted === 0) {
                        lines.push('_No cells were available to insert._');
                    } else {
                        lines.push(`\n↓ ${inserted} cell${inserted !== 1 ? 's' : ''} added to notebook.`);
                    }
                    replyText = lines.join('\n');
                }
                setMessages(prev => [...prev,
                    { id: Date.now().toString(), sender: MessageSender.User, text: input },
                    { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: replyText },
                ]);
                return { ok: true };
            }
            if (slashCmd.kind === 'unknown') {
                setMessages(prev => [...prev,
                    { id: Date.now().toString(), sender: MessageSender.User, text: slashCmd.input },
                    { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Unknown command \`${slashCmd.input}\`. Type \`/help\` for available commands.` },
                ]);
                return { ok: true };
            }
        }
        } // end !override

        cancelledRef.current = false;
        abortControllerRef.current = new AbortController();
        const userMessage: ChatMessage = {
            id: Date.now().toString(),
            sender: MessageSender.User,
            text: inputText0,
            hidden: override?.hiddenUserMessage,
        };
        setMessages(prev => [...prev, userMessage]);
        // Auto-name the channel from the first real user message. Skip if the
        // user already renamed the tab (label no longer matches Main/Channel N).
        maybeAutoNameChannel(inputText0);
        const inputText = inputText0;
        if (!override) setInput('');
        setCmdSuggestions([]);
        setIsLoading(true);
        setStreamingText(null);
        // Reset per-turn approval state.
        setProposals([]);
        proposalsRef.current = [];
        setApproveAllReads(false);
        approveAllReadsRef.current = false;
        approvalResolvers.current.clear();

        // Browser provider has no tool support → use legacy path.
        if (chatProvider === 'browser') {
            await handleSendLegacy();
            setIsLoading(false);
            return { ok: true };
        }

        // Build tool message history (text-only summaries).
        // Compact history beyond 20 messages to avoid context overflow.
        const rawHistory = messagesRef.current.slice(1).map(m => ({
            role: m.sender === MessageSender.User ? 'user' : 'assistant',
            content: m.text + (m.code ? `\n\`\`\`sql\n${m.code}\n\`\`\`` : ''),
        })) as ToolChatMessage[];
        const toolHistory: ToolChatMessage[] = compactHistory(rawHistory);
        toolHistory.push({ role: 'user', content: inputText });

        const deps = buildToolDeps();
        // We override the approval gate so we can register the proposal BEFORE
        // the runtime awaits it. Wrap deps.requireApproval so it just waits on
        // the resolver we set in the tool_call handler.
        const wrappedDeps: ToolDeps = {
            ...deps,
            requireApproval: (toolName: string, args: any) => new Promise<void>((resolve, reject) => {
                // B-197: reject immediately if already cancelled.
                if (cancelledRef.current) { reject(new Error('cancelled')); return; }
                // Find the most recent pending proposal for this tool/args pair.
                const argsKey = JSON.stringify(args);
                const pending = [...proposalsRef.current].reverse().find(p =>
                    p.name === toolName && p.status === 'pending' && JSON.stringify(p.args) === argsKey
                );
                const id = pending?.id ?? `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                if (!pending) {
                    setProposals(prev => [...prev, { id, name: toolName, args, status: 'pending' }]);
                }
                approvalResolvers.current.set(id, { resolve, reject });
                // Guard the race: cancel could have fired between the check above and
                // registering the resolver. Reject and clean up if so.
                if (cancelledRef.current) {
                    approvalResolvers.current.delete(id);
                    reject(new Error('cancelled'));
                }
            }),
        };

        let assistantBuf = '';
        let errorMsg: string | undefined;
        const activeMode = override?.forceMode ?? chatMode.state.mode;
        try {
            const memoryLine = Object.keys(activeMemory).length > 0
                ? `Session memory:\n${Object.entries(activeMemory).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n`
                : '';
            const baseSystemPrompt = [memoryLine + (metadata?.customSystemPrompt ?? ''), mergedSystemPrompt, variablesSystemPromptLine(metadata?.variables)].filter(Boolean).join('\n\n');
            const stream = aiService.streamChatWithTools(
                toolHistory,
                { tables: schema.tables, views: schema.views, macros: schema.macros },
                filterToolsForMode(TOOLS as Tool[], activeMode),
                wrappedDeps,
                {
                    visibility: chatVisibility,
                    tier: 'advanced',
                    feature: 'chat',
                    providerOverride: chatProvider,
                    modelOverride: chatModel,
                    customSystemPrompt: composeSystemPromptForMode(baseSystemPrompt, activeMode),
                    signal: abortControllerRef.current?.signal,
                },
            );

            for await (const chunk of stream) {
                if (cancelledRef.current) break;
                if (chunk.kind === 'text') {
                    assistantBuf += chunk.delta;
                    setStreamingText(assistantBuf);
                } else if (chunk.kind === 'tool_call') {
                    const tool = TOOLS.find(t => t.name === chunk.name);
                    const record: ApprovalRecord = { id: chunk.id, name: chunk.name, args: chunk.args, status: 'pending' };
                    setProposals(prev => [...prev, record]);
                    proposalsRef.current = [...proposalsRef.current, record];

                    if (tool?.kind === 'read') {
                        // Visibility / approve-all logic.
                        const proposal = chooseProposalKind(tool, chunk.args, {
                            visibility: chatVisibility,
                            approveAllReads: approveAllReadsRef.current,
                            existingCellContent: undefined,
                        });
                        if (proposal.kind === 'auto-read') {
                            // Mark approved immediately; runtime executes reads
                            // without calling requireApproval so we just update UI.
                            setProposals(prev => applyApprovalAction(prev, { type: 'approve', id: chunk.id }));
                        }
                        // Mutate tools always require user click.
                    }
                } else if (chunk.kind === 'tool_result') {
                    setProposals(prev => applyApprovalAction(prev, { type: 'complete', id: chunk.id, result: chunk.result }));
                }
            }
        } catch (e: any) {
            if (!cancelledRef.current && e?.name !== 'AbortError') {
                errorMsg = e?.message ?? String(e);
                setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Error: ${errorMsg}` }]);
            }
        } finally {
            setStreamingText(null);
            const trimmed = assistantBuf.trim();
            if (trimmed && !cancelledRef.current) {
                // In plan mode, attempt to parse a plan from the reply and
                // attach it as meta. The card will render alongside the prose.
                let meta: ChatMessageMeta | undefined;
                if (activeMode === 'plan') {
                    const parsed = chatMode.parsePlan(trimmed);
                    if (parsed) meta = { plan: parsed, planStatus: 'pending' };
                }
                const assistantMsg: ChatMessage = {
                    id: (Date.now() + 1).toString(),
                    sender: MessageSender.AI,
                    text: trimmed,
                    meta,
                };
                setMessages(prev => [...prev, assistantMsg]);
                // Fire btw orchestrator after a successful assistant reply.
                // This is a fire-and-forget; hints arrive asynchronously.
                if (activeMode === 'btw') {
                    chatMode.maybeRunBtw({
                        userText: inputText,
                        assistantText: trimmed,
                        schema,
                        visibility: chatVisibility,
                    }).catch(() => { /* swallow — orchestrator already logs */ });
                }
            }
            setIsLoading(false);
        }
        return errorMsg ? { ok: false, error: errorMsg } : { ok: true };
    };
    const commitMention = (cand: MentionCandidate) => {
        if (!mentionRange) return;
        const ta = inputRef.current;
        const cursor = ta?.selectionStart ?? mentionRange.end;
        const { value, cursor: nextCursor } = applyMention(input, mentionRange.start, cursor, cand.token);
        setInput(value);
        setMentionSuggestions([]);
        setMentionRange(null);
        // Restore cursor after React updates the textarea.
        requestAnimationFrame(() => {
            const el = inputRef.current;
            if (el) { el.focus(); el.setSelectionRange(nextCursor, nextCursor); }
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Mention popup takes precedence — only one popup can be open at a time
        // (mention only triggers when the cursor is on an @-token, slash only
        // when input starts with `/`, so they shouldn't both be active anyway).
        if (mentionSuggestions.length > 0) {
            if (e.key === 'Tab' || e.key === 'Enter' || e.key === 'ArrowRight') {
                e.preventDefault();
                commitMention(mentionSuggestions[mentionIdx]);
                return;
            }
            if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => (i + 1) % mentionSuggestions.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length); return; }
            if (e.key === 'Escape') { setMentionSuggestions([]); setMentionRange(null); return; }
        }
        if (cmdSuggestions.length > 0) {
            if (e.key === 'Tab' || e.key === 'ArrowRight') {
                e.preventDefault();
                setInput(cmdSuggestions[cmdSuggestionIdx] + ' ');
                setCmdSuggestions([]);
                return;
            }
            if (e.key === 'ArrowDown') { e.preventDefault(); setCmdSuggestionIdx(i => (i + 1) % cmdSuggestions.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setCmdSuggestionIdx(i => (i - 1 + cmdSuggestions.length) % cmdSuggestions.length); return; }
            if (e.key === 'Escape') { setCmdSuggestions([]); return; }
        }
        if (varSuggestions.length > 0) {
            if (e.key === 'Tab') {
                e.preventDefault();
                const ta = e.currentTarget;
                const cursor = ta.selectionStart ?? input.length;
                const before = input.slice(0, cursor);
                const after = input.slice(cursor);
                const replaced = before.replace(/\$\$?\w*$/, varSuggestions[varSuggestionIdx]);
                setInput(replaced + after);
                setVarSuggestions([]);
                return;
            }
            if (e.key === 'ArrowDown') { e.preventDefault(); setVarSuggestionIdx(i => (i + 1) % varSuggestions.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setVarSuggestionIdx(i => (i - 1 + varSuggestions.length) % varSuggestions.length); return; }
            if (e.key === 'Escape') { setVarSuggestions([]); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any).isComposing) { e.preventDefault(); handleSend(); }
    };

    const CodeBlock: React.FC<{ code: string }> = ({ code }) => {
        const [copied, setCopied] = useState(false);
        const handleCopy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
        return (<div className="relative bg-gray-900 rounded-md my-2"><pre className="p-3 text-sm text-cyan-300 overflow-x-auto font-mono">{code}</pre><button onClick={handleCopy} className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded-md"><ClipboardIcon className={`w-4 h-4 ${copied ? 'text-green-400' : 'text-gray-300'}`}/></button></div>);
    };

    const cellById = useMemo(() => {
        const m = new Map<string, NotebookCellData>();
        (cells ?? []).forEach(c => m.set(c.id, c));
        return m;
    }, [cells]);

    const mentionCandidatesList = useMemo(() => mentionCandidates(cells ?? []), [cells]);

    const getCellContent = useCallback((cellId: string) => cellById.get(cellId)?.content, [cellById]);

    /** Apply a meta patch to a specific message by id (no-op if not found). */
    const patchMessageMeta = useCallback((id: string, patch: Partial<ChatMessageMeta>) => {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, meta: { ...(m.meta ?? {}), ...patch } } : m));
    }, []);

    // Plan execution — wraps the plan up as a hidden user message and re-sends in
    // normal mode so the assistant can actually call the mutating tools.
    // Bound per-message in the render below so the closure captures the right id
    // and uses the latest handleSend.
    const executePlanFor = (messageId: string) => async (plan: ParsedPlan, _opts: { trust: boolean }) => {
        const prompt = planToExecutionPrompt(plan);
        patchMessageMeta(messageId, planMetaStart());
        const result = await handleSend({ text: prompt, hiddenUserMessage: true, forceMode: 'normal' });
        if (result.ok) {
            patchMessageMeta(messageId, planMetaSuccess(plan.steps.length, Date.now()));
        } else {
            patchMessageMeta(messageId, planMetaFail(result.error));
        }
    };

    const discardPlanFor = (messageId: string) => (_plan: ParsedPlan) => {
        patchMessageMeta(messageId, planMetaDiscard(Date.now()));
    };

    // BTW hint actions.
    const onBtwAction = (hint: BtwHint) => {
        if (hint.action?.type === 'send-prompt' && hint.action.prompt) {
            chatMode.dismissHint(hint.id);
            handleSend({ text: hint.action.prompt });
        }
    };

    return (
        <div className="w-full h-full flex flex-col bg-gray-900 border-l border-gray-700">
            {/* ── Header ── */}
            <div className="p-3 border-b border-gray-700 flex-shrink-0 flex flex-col gap-2">
                <div className="flex justify-between items-center gap-2">
                    <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2"><SparklesIcon className="w-5 h-5 text-yellow-400"/>AI Assistant</h2>
                    <div className="flex items-center gap-1">
                        <button onClick={() => addChannel()} title="New chat channel" aria-label="New chat channel" className="p-1.5 text-gray-400 hover:text-cyan-400 rounded-md"><PlusIcon className="w-4 h-4"/></button>
                        <button onClick={handleReset} title="Reset Conversation" aria-label="Reset Conversation" className="p-1.5 text-gray-400 hover:text-cyan-400 rounded-md"><ArrowCounterclockwiseIcon className="w-4 h-4"/></button>
                    </div>
                </div>
                {/* ── Channel tabs ── */}
                {channels.length > 1 && (
                    <div className="flex gap-1 flex-wrap">
                        {channels.map(ch => {
                            const isRenaming = renamingChannelId === ch.id;
                            const commitRename = () => {
                                const next = renameDraft.trim();
                                if (next) {
                                    setChannels(prev => prev.map(c => c.id === ch.id ? { ...c, label: next.slice(0, 40) } : c));
                                }
                                setRenamingChannelId(null);
                                setRenameDraft('');
                            };
                            return (
                                <div key={ch.id} className={`group flex items-center gap-1 px-2 py-0.5 rounded-md text-xs cursor-pointer transition-colors ${ch.id === activeChannelId ? 'bg-cyan-700/40 text-cyan-200' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'}`}>
                                    {isRenaming ? (
                                        <input
                                            autoFocus
                                            value={renameDraft}
                                            onChange={e => setRenameDraft(e.target.value)}
                                            onBlur={commitRename}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                                                else if (e.key === 'Escape') { e.preventDefault(); setRenamingChannelId(null); setRenameDraft(''); }
                                            }}
                                            className="bg-gray-900 text-gray-100 px-1 py-0 rounded text-xs w-24 outline-none ring-1 ring-cyan-600"
                                            maxLength={40}
                                            aria-label="Rename channel"
                                        />
                                    ) : (
                                        <button
                                            onClick={() => setActiveChannelId(ch.id)}
                                            onDoubleClick={() => { setRenamingChannelId(ch.id); setRenameDraft(ch.label); }}
                                            className="max-w-[80px] truncate"
                                            title={`${ch.label} (double-click to rename)`}
                                        >{ch.label}</button>
                                    )}
                                    {channels.length > 1 && !isRenaming && <button onClick={() => removeChannel(ch.id)} className="opacity-0 group-hover:opacity-100 ml-0.5 text-gray-400 hover:text-red-400" title="Close channel" aria-label="Close channel"><XMarkIcon className="w-3 h-3"/></button>}
                                </div>
                            );
                        })}
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="text-[10px] uppercase tracking-wider text-gray-400" htmlFor="chat-visibility">See</label>
                    <select id="chat-visibility" aria-label="AI data visibility" value={chatVisibility} onChange={e => setChatVisibility(e.target.value as VisibilityMode)} title="Controls what slice of recent query results the AI can see" className="bg-gray-800 border border-gray-600 rounded text-xs px-1.5 py-1 text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500">
                        <option value="no-data">No data</option>
                        <option value="sanitized">Sanitized</option>
                        <option value="full">Full</option>
                    </select>
                    <span className="text-[10px] text-gray-500 ml-auto flex items-center" title={buildStatusTooltip({ mode: chatMode.state.mode, model: chatModel, provider: chatProvider, visibility: chatVisibility })}>
                        <select
                            value={chatMode.state.mode}
                            onChange={e => chatMode.setMode(e.target.value as ChatMode)}
                            title={buildModeTooltip(chatMode.state.mode)}
                            className={`bg-transparent border-none p-0 pr-3 text-[10px] focus:outline-none cursor-pointer appearance-none ${chatMode.state.mode === 'plan' ? 'text-amber-400' : chatMode.state.mode === 'btw' ? 'text-cyan-300' : 'text-gray-400'}`}
                        >
                            <option value="normal" className="bg-gray-800 text-gray-200">/normal</option>
                            <option value="plan" className="bg-gray-800 text-gray-200">/plan</option>
                            <option value="btw" className="bg-gray-800 text-gray-200">/btw</option>
                        </select>
                        <span className="mx-1 text-gray-600">·</span>
                        {(providerMeta?.models && providerMeta.models.length > 0) ? (
                            <select
                                value={chatModel}
                                onChange={e => setChatModel(e.target.value)}
                                title={buildModelTooltip(chatModel, chatProvider)}
                                className="bg-transparent border-none p-0 pr-3 text-[10px] font-mono text-gray-400 focus:outline-none cursor-pointer appearance-none"
                            >
                                {!providerMeta.models.some(m => m.id === chatModel) && (
                                    <option value={chatModel} className="bg-gray-800 text-gray-200">{chatModel}</option>
                                )}
                                {providerMeta.models.map(m => (
                                    <option key={m.id} value={m.id} className="bg-gray-800 text-gray-200">{m.id}</option>
                                ))}
                            </select>
                        ) : (
                            <span className="font-mono text-gray-400 cursor-help" title={buildModelTooltip(chatModel, chatProvider)}>{chatModel || '—'}</span>
                        )}
                    </span>
                </div>
                {/* ── Active skill chips ── */}
                {activeSkills.length > 0 && (
                    <div className="flex flex-wrap gap-1 items-center">
                        <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1">Skills</span>
                        {activeSkills.map(skill => (
                            <button
                                key={skill.meta.name}
                                onClick={() => deactivateSkill(skill.meta.name)}
                                title={`${skill.meta.title} — click to deactivate`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-purple-700/40 text-purple-200 border border-purple-600/50 hover:bg-purple-700/70 hover:text-white transition-colors"
                            >
                                {skill.meta.icon && <span>{skill.meta.icon}</span>}
                                <span>{skill.meta.name}</span>
                                <XMarkIcon className="w-2.5 h-2.5"/>
                            </button>
                        ))}
                    </div>
                )}
                {/* ── Memory chips ── */}
                {Object.keys(activeMemory).length > 0 && (
                    <div className="flex flex-wrap gap-1 items-center">
                        <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1">Memory</span>
                        {Object.entries(activeMemory).map(([k, v]) => (
                            <span key={k} title={`${k}: ${v}`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-gray-700/60 text-gray-400 border border-gray-600/50">
                                <span className="text-cyan-500 font-mono">{k}</span>
                                <span className="text-gray-600 mx-0.5">·</span>
                                <span className="truncate max-w-[80px]">{v}</span>
                                <button onClick={() => clearMemoryKey(k)} title={`Forget ${k}`} aria-label={`Forget ${k}`}><XMarkIcon className="w-2.5 h-2.5"/></button>
                            </span>
                        ))}
                    </div>
                )}
            </div>
            {/* ── Messages ── */}
            <div className="flex-grow p-4 overflow-y-auto space-y-4">
                {/* "Add to Notebook" button: legacy non-tool-calling AI path returns
                    { code, plotConfig } as a single suggestion without auto-applying.
                    This button is the user's explicit accept. Tool-calling providers
                    bypass it by writing cells via the addCell tool + approval flow. */}
                {(() => {
                    const visibleMsgs = messages.filter(m => !m.hidden);
                    const onlyGreeting = visibleMsgs.length === 1 && visibleMsgs[0].id === '1';
                    const lastUserIdx = [...visibleMsgs].map((m, i) => m.sender === MessageSender.User ? i : -1).filter(i => i !== -1).pop() ?? -1;
                    const QUICK_STARTS = [
                        'What GC events are in this recording?',
                        'Show me the longest GC pauses',
                        'Which threads are using the most CPU?',
                        'Summarize memory allocation hotspots',
                    ];
                    return (
                        <>
                            {visibleMsgs.map((msg, msgIdx) => {
                                const addArgs = buildAddCellArgs(msg);
                                const isLastUser = msgIdx === lastUserIdx;
                                // Index of this visible message in the full messages array.
                                const originalIdx = messages.indexOf(msg);
                                return (
                                    <React.Fragment key={msg.id}>
                                        <div className={`flex ${msg.sender === MessageSender.User ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`relative group/msg max-w-[85%] rounded-lg p-3 ${msg.sender === MessageSender.User ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-200'}`}>
                                                <div className="text-sm leading-relaxed">
                                                    {msg.sender === MessageSender.AI ? renderMarkdown(msg.text, onNavigateRef) : <span className="whitespace-pre-wrap">{msg.text}</span>}
                                                </div>
                                                {msg.meta?.plan && (<ChatPlanCard plan={msg.meta.plan} meta={msg.meta} getCellContent={getCellContent} onExecute={executePlanFor(msg.id)} onDiscard={discardPlanFor(msg.id)}/>)}
                                                {msg.code && <CodeBlock code={msg.code}/>}
                                                {addArgs && (<button data-testid="add-to-notebook" onClick={() => onAddCellFromAI(addArgs.code, addArgs.plotConfig, addArgs.title, addArgs.markdownText)} className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md text-sm font-semibold"><PlusIcon className="w-4 h-4"/>Add to Notebook</button>)}
                                                {msg.sender === MessageSender.AI && (
                                                    <button
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(msg.code || msg.text).then(() => {
                                                                setCopiedMsgId(msg.id);
                                                                setTimeout(() => setCopiedMsgId(c => c === msg.id ? null : c), 1500);
                                                            }).catch(() => {});
                                                        }}
                                                        className="absolute -top-1 -right-1 opacity-0 group-hover/msg:opacity-100 p-1 bg-gray-600 hover:bg-gray-500 rounded transition-all"
                                                        title="Copy response" aria-label="Copy response"
                                                    >
                                                        <ClipboardIcon className={`w-3 h-3 ${copiedMsgId === msg.id ? 'text-green-400' : 'text-gray-300'}`}/>
                                                    </button>
                                                )}
                                                {msg.sender === MessageSender.User && isLastUser && !isLoading && (
                                                    <button
                                                        onClick={() => handleSend({ text: msg.text })}
                                                        className="absolute -top-1 -left-1 opacity-0 group-hover/msg:opacity-100 p-1 bg-gray-600 hover:bg-gray-500 rounded transition-all"
                                                        title="Retry this message" aria-label="Retry"
                                                    >
                                                        <ArrowCounterclockwiseIcon className="w-3 h-3 text-gray-300"/>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        {/* Rewind bar — shown between messages, not after the last one */}
                                        {msgIdx < visibleMsgs.length - 1 && (
                                            <div className="group/rewind relative h-3 flex items-center -mx-4 px-4">
                                                <div className="absolute inset-x-4 h-px bg-transparent group-hover/rewind:bg-gray-700/60 transition-colors"/>
                                                <button
                                                    onClick={() => handleRewindTo(originalIdx)}
                                                    className="absolute left-1/2 -translate-x-1/2 opacity-0 group-hover/rewind:opacity-100 text-[10px] text-gray-500 hover:text-amber-300 bg-gray-900 px-2 py-0.5 rounded border border-gray-700/60 hover:border-amber-600/40 whitespace-nowrap transition-all"
                                                >
                                                    ↩ rewind to here
                                                </button>
                                            </div>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                            {onlyGreeting && !isLoading && (
                                <div className="flex flex-wrap gap-2 justify-center pt-1">
                                    {QUICK_STARTS.map(q => (
                                        <button key={q} onClick={() => handleSend({ text: q })}
                                            className="text-xs px-3 py-1.5 rounded-full bg-gray-800 border border-gray-600 text-gray-400 hover:border-cyan-600/60 hover:text-cyan-300 transition-colors">
                                            {q}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </>
                    );
                })()}
                {streamingText !== null && (
                    <div className="flex justify-start">
                        <div className="max-w-[85%] rounded-lg p-3 bg-gray-700 text-gray-200">
                            <div className="text-sm leading-relaxed">{renderMarkdown(streamingText, onNavigateRef)}<span className="inline-block w-1.5 h-3.5 bg-cyan-400 ml-0.5 animate-pulse" style={{verticalAlign:'text-bottom'}}/></div>
                        </div>
                    </div>
                )}
                {proposals.map(record => {
                    const tool = TOOLS.find(t => t.name === record.name);
                    if (!tool) return null;

                    // Approved → tiny "running" pill while the runtime executes.
                    if (record.status === 'approved') {
                        const { verb, summary } = formatActionLine(record.name, record.args);
                        return (
                            <div key={record.id} className="my-1 text-xs text-gray-400 font-mono flex items-center gap-2">
                                <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse"/>
                                <span className="text-gray-300">running</span>
                                <span className="text-gray-300 font-semibold">{verb}</span>
                                <span className="text-gray-500 truncate">{summary}</span>
                            </div>
                        );
                    }

                    // Rejected → muted one-liner.
                    if (record.status === 'rejected') {
                        const { verb, summary } = formatActionLine(record.name, record.args);
                        return (
                            <div key={record.id} className="my-1 text-xs text-gray-500 font-mono flex items-center gap-2">
                                <span className="text-red-400">×</span>
                                <span>rejected</span>
                                <span className="font-semibold">{verb}</span>
                                <span className="truncate">{summary}</span>
                            </div>
                        );
                    }

                    // Done — render based on tool kind.
                    if (record.status === 'done') {
                        if (tool.kind === 'mutate') {
                            return (
                                <ToolCallLine
                                    key={record.id}
                                    name={record.name}
                                    args={record.args}
                                    onClickTarget={cellId => scrollToCell(cellId)}
                                    onUndo={onUndoLastAction}
                                />
                            );
                        }
                        // Read tools: render inline preview when we can (runQuery → DataTable, previewPlot → chart).
                        // Other reads just disappear, per UX spec.
                        if (record.name === 'runQuery' && onAddCell) {
                            return (
                                <InlinePreview
                                    key={record.id}
                                    toolName={record.name}
                                    args={record.args}
                                    result={record.result}
                                    onAddToNotebook={(type, content) => {
                                        if (type !== 'combined') onAddCell({ type, content });
                                    }}
                                />
                            );
                        }
                        if (record.name === 'previewPlot') {
                            return (
                                <InlinePreview
                                    key={record.id}
                                    toolName={record.name}
                                    args={record.args}
                                    result={record.result}
                                    metadata={metadata}
                                    onAddToNotebook={(type, content, plotConfig) => {
                                        if (type === 'combined' && plotConfig !== undefined) {
                                            // Build a combined SQL + plot cell via the existing AI promote path.
                                            const sql = String(record.args?.sql ?? '');
                                            onAddCellFromAI(sql, plotConfig, '', '');
                                        } else if (type !== 'combined' && onAddCell) {
                                            onAddCell({ type, content });
                                        }
                                    }}
                                />
                            );
                        }
                        return null;
                    }

                    // Pending → full approval card (unchanged).
                    const existing = (record.name === 'editCell' || record.name === 'applyPlot') ? cellById.get(record.args?.cellId)?.content : undefined;
                    const kind: ProposalKind = chooseProposalKind(tool, record.args, {
                        visibility: chatVisibility,
                        approveAllReads,
                        existingCellContent: existing,
                    });
                    return (
                        <ChatProposalCard
                            key={record.id}
                            record={record}
                            kind={kind}
                            onApprove={() => approveProposal(record.id)}
                            onReject={() => rejectProposal(record.id)}
                            onApproveAllReads={tool.kind === 'read' ? approveAllReadsHandler : undefined}
                        />
                    );
                })}
                {isLoading && streamingText === null && (<div className="flex justify-start"><div className="bg-gray-700 rounded-lg p-3 inline-flex items-center space-x-2"><span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse delay-0"></span><span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse delay-150"></span><span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse delay-300"></span></div></div>)}
                <div ref={messagesEndRef}/>
            </div>
            {/* ── Input ── */}
            <div className="p-3 border-t border-gray-700 flex-shrink-0 space-y-2">
                {/* Task checklist */}
                {activeTasks.length > 0 && (
                    <div className="rounded-md border border-gray-700 bg-gray-900/60 px-3 py-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-wider text-gray-500">Tasks</span>
                            <button onClick={() => setChannelTasks(p => ({ ...p, [activeChannelId]: [] }))}
                                className="text-[10px] text-gray-600 hover:text-red-400">clear</button>
                        </div>
                        {activeTasks.map(t => (
                            <div key={t.id} className="flex items-center gap-2 text-xs">
                                <span className={t.done ? 'text-green-400' : 'text-gray-600'}>{t.done ? '✓' : '○'}</span>
                                <span className={t.done ? 'text-gray-500 line-through' : 'text-gray-300'}>{t.text}</span>
                            </div>
                        ))}
                    </div>
                )}
                {chatMode.state.btwHints.length > 0 && (
                    <div className="space-y-1">
                        {chatMode.state.btwHints.map(hint => (
                            <BtwSuggestionCard key={hint.id} hint={hint} onDismiss={chatMode.dismissHint} onAction={onBtwAction}/>
                        ))}
                    </div>
                )}
                {/* Slash command autocomplete */}
                {cmdSuggestions.length > 0 && (
                    <div className="rounded-md border border-gray-600 bg-gray-800 py-1 text-xs">
                        {cmdSuggestions.map((cmd, idx) => (
                            <button
                                key={cmd}
                                onClick={() => { setInput(cmd + ' '); setCmdSuggestions([]); inputRef.current?.focus(); }}
                                className={`w-full text-left px-3 py-1 font-mono ${idx === cmdSuggestionIdx ? 'bg-cyan-700/40 text-cyan-200' : 'text-gray-300 hover:bg-gray-700'}`}
                            >
                                {cmd}
                            </button>
                        ))}
                        <p className="px-3 py-0.5 text-[10px] text-gray-600">Tab to complete · Esc to dismiss</p>
                    </div>
                )}
                {/* $variable autocomplete */}
                {varSuggestions.length > 0 && (
                    <div className="rounded-md border border-gray-600 bg-gray-800 py-1 text-xs">
                        {varSuggestions.map((v, idx) => (
                            <button
                                key={v}
                                onClick={() => {
                                    const ta = inputRef.current;
                                    if (!ta) return;
                                    const cursor = ta.selectionStart ?? input.length;
                                    const before = input.slice(0, cursor);
                                    const after = input.slice(cursor);
                                    setInput(before.replace(/\$\$?\w*$/, v) + after);
                                    setVarSuggestions([]);
                                    ta.focus();
                                }}
                                className={`w-full text-left px-3 py-1 font-mono ${idx === varSuggestionIdx ? 'bg-cyan-700/40 text-cyan-200' : 'text-gray-300 hover:bg-gray-700'}`}
                            >
                                <span className="text-cyan-400">{v}</span>
                                {notebookVariables[v.replace(/^\$\$?/, '')] !== undefined && (
                                    <span className="text-gray-500 ml-2">= {String(notebookVariables[v.replace(/^\$\$?/, '')]).slice(0, 30)}</span>
                                )}
                            </button>
                        ))}
                        <p className="px-3 py-0.5 text-[10px] text-gray-600">Tab to complete · Esc to dismiss</p>
                    </div>
                )}
                {/* @-mention autocomplete */}
                {mentionSuggestions.length > 0 && (
                    <div className="rounded-md border border-gray-600 bg-gray-800 py-1 text-xs">
                        {mentionSuggestions.map((m, idx) => (
                            <button
                                key={m.cellId + ':' + m.token}
                                onClick={() => commitMention(m)}
                                className={`w-full text-left px-3 py-1 flex items-baseline gap-2 ${idx === mentionIdx ? 'bg-cyan-700/40 text-cyan-200' : 'text-gray-300 hover:bg-gray-700'}`}
                            >
                                <span className="font-mono">@{m.token}</span>
                                <span className="text-[10px] text-gray-500 truncate">{m.label}</span>
                            </button>
                        ))}
                        <p className="px-3 py-0.5 text-[10px] text-gray-600">Tab/Enter to insert · Esc to dismiss</p>
                    </div>
                )}
                <div className="relative">
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={input}
                        onChange={e => {
                            const v = e.target.value;
                            const cursor = e.target.selectionStart ?? v.length;
                            setInput(v);
                            e.target.style.height = 'auto';
                            e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
                            // Slash command autocomplete
                            const suggestions = commandCompletions(v.trimStart(), availableSkills.map(s => s.name));
                            setCmdSuggestions(suggestions);
                            setCmdSuggestionIdx(0);
                            // $variable autocomplete
                            const before = v.slice(0, cursor);
                            const varMatch = before.match(/\$\$?\w*$/);
                            if (varMatch && Object.keys(notebookVariables).length > 0) {
                                const prefix = varMatch[0].toLowerCase();
                                const matches = Object.keys(notebookVariables)
                                    .map(k => k.startsWith('$') ? k : `$${k}`)
                                    .filter(k => k.toLowerCase().startsWith(prefix));
                                setVarSuggestions(matches);
                                setVarSuggestionIdx(0);
                            } else {
                                setVarSuggestions([]);
                            }
                            // @-mention autocomplete
                            const m = detectMentionPrefix(v, cursor);
                            if (m) {
                                const filtered = filterMentions(mentionCandidatesList, m.query);
                                setMentionSuggestions(filtered);
                                setMentionIdx(0);
                                setMentionRange({ start: m.start, end: cursor });
                            } else {
                                setMentionSuggestions([]);
                                setMentionRange(null);
                            }
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder={`Ask for a query… or type / for commands, @ to mention a cell`}
                        className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 pl-4 pr-20 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-gray-200 resize-none overflow-hidden"
                        style={{ minHeight: '38px' }}
                        disabled={isLoading || !schema}
                    />
                    {isLoading
                        ? <button onClick={handleCancel} className="absolute top-1/2 right-2 -translate-y-1/2 p-2 bg-red-700 hover:bg-red-600 rounded-md" title="Cancel request" aria-label="Cancel request"><XMarkIcon className="w-5 h-5 text-white"/></button>
                        : <button onClick={() => handleSend()} className="absolute top-1/2 right-2 -translate-y-1/2 p-2 bg-cyan-600 hover:bg-cyan-700 rounded-md disabled:bg-gray-600" disabled={input.trim() === '' || !schema}><SendIcon className="w-5 h-5 text-white"/></button>
                    }
                </div>
            </div>
        </div>
    );
};

/** Cheap value-equality check used for matching pending approvals to runtime
 * requireApproval invocations. Top-level keys only — sufficient because tool
 * args are flat objects with JSON-serializable primitives. */
function shallowEqualArgs(a: any, b: any): boolean {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const ak = Object.keys(a); const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
        const av = a[k], bv = b[k];
        if (av === bv) continue;
        if (typeof av === 'object' && typeof bv === 'object') {
            if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
        } else if (av !== bv) return false;
    }
    return true;
}

export default React.memo(ChatPanel);
