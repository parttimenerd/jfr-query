

import React, { useState, useContext, useMemo, useRef, useCallback, useEffect } from 'react';
import { aiService, providerMetadataRegistry } from '../services/AiService';
import type { VisibilityMode, AiTier } from '../services/AiService';
import { SettingsContext } from '../context/SettingsContext';
import { DataContext } from '../context/DuckDBContext';
import type { ChatMessage, NotebookCellData, NotebookMetadata } from '../types';
import { MessageSender } from '../types';
import { SendIcon } from './icons/SendIcon';
import { ClipboardIcon } from './icons/ClipboardIcon';
import { XMarkIcon } from './icons/XMarkIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { ArrowCounterclockwiseIcon } from './icons/ArrowCounterclockwiseIcon';
import { ArrowsPointingOutIcon } from './icons/ArrowsPointingOutIcon';
import PlotRenderer from './PlotRenderer';
import type { AiProviderType, ToolChatMessage } from '../services/ai/IAiProvider';
import { TOOLS, type Tool } from '../services/ai/tools';
import type { NotebookMutation, ToolDeps } from '../services/ai/tools/runtime';
import { tokenizeCellContent, reconstructCellContent, parseCellContent } from '../utils/notebookParser';
import {
    listConfiguredProviders,
    defaultModelForProvider,
    cellPrimaryType,
    listPlotsFromCells,
    type InlineChatSnapshot,
} from './ChatPanel';
import {
    chooseProposalKind,
    applyApprovalAction,
    ChatProposalCard,
    type ApprovalRecord,
    type ProposalKind,
} from './ChatProposalCard';
import { resolveVisibility, buildRecentResultFromRows } from './inlineChatHelpers';
import { parseSlashCommand, commandCompletions } from '../utils/slashCommands';
import { SkillContext } from '../context/SkillContext';
import { builtinSkillManifest } from '../data/skills/skills-manifest';
import { BtwSuggestionCard } from './chat/BtwSuggestionCard';
import { ChatPlanCard } from './chat/ChatPlanCard';
import { buildStatusTooltip } from './chat/chatStatusTooltip';
import { variablesSystemPromptLine } from './chat/variablesSystemPrompt';
import { renderMarkdown } from './chat/ChatMarkdownView';
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
} from '../services/ai/chatModes';
import type { ChatMessageMeta } from '../types';

// Re-export pure helpers so callers / tests can pull them from InlineChat too.
export { resolveVisibility, buildRecentResultFromRows } from './inlineChatHelpers';

/** Compact inline-chat history to keep the context payload bounded. */
const MAX_INLINE_HISTORY_TURNS = 12;
function compactInlineHistory(history: ToolChatMessage[]): ToolChatMessage[] {
    if (history.length <= MAX_INLINE_HISTORY_TURNS) return history;
    const dropped = history.slice(0, history.length - MAX_INLINE_HISTORY_TURNS);
    const kept = history.slice(history.length - MAX_INLINE_HISTORY_TURNS);
    const summary = dropped
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${(m.content || '').slice(0, 150)}`)
        .join('\n');
    const summaryMsg = `[${dropped.length} earlier turns omitted]\n${summary}`;
    // Anthropic requires strict role alternation. If kept[0] is also 'user', merge
    // the summary into it to avoid two consecutive user messages.
    if (kept.length > 0 && kept[0].role === 'user') {
        const merged = { ...kept[0], content: `${summaryMsg}\n\n${kept[0].content ?? ''}` };
        return [merged, ...kept.slice(1)];
    }
    return [
        { role: 'user', content: summaryMsg },
        ...kept,
    ];
}

interface CodeBlockProps {
    code: string;
    isActionable?: boolean;
    targetType: 'sql' | 'plot';
    data?: any[] | null;
    sql?: string;
    cellContext: NotebookCellData;
    onApplyCode: (code: string) => void;
    isAiFeatureActive: boolean;
    metadata: NotebookMetadata;
    onMetadataChange?: (m: NotebookMetadata) => void;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ code, isActionable, targetType, data, sql, cellContext, onApplyCode, isAiFeatureActive, metadata, onMetadataChange }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
    return (
        <div className="my-2">
            {targetType === 'plot' && data && (<div className="my-2 p-2 bg-gray-900/50 rounded-lg border border-gray-700 h-[250px] overflow-hidden"><h6 className="text-xs font-semibold text-gray-400 text-center mb-1">Preview</h6><PlotRenderer config={code} data={data.slice(0, 50)} sql={sql || ''} cellContext={cellContext} onApplyFix={onApplyCode} isAiFeatureActive={isAiFeatureActive} metadata={metadata} onMetadataChange={onMetadataChange || (async () => {})} onCellVariableChange={() => {}} allVariables={{}} /></div>)}
            <div className="relative bg-gray-900 rounded-md"><pre className="p-3 text-sm text-cyan-300 overflow-x-auto font-mono">{code}</pre><button onClick={handleCopy} className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded-md"><ClipboardIcon className={`w-4 h-4 ${copied ? 'text-green-400' : 'text-gray-300'}`}/></button></div>
            {isActionable && (<button onClick={() => onApplyCode(code)} className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-green-600/30 hover:bg-green-600/50 text-green-300 rounded-md font-semibold"><CheckCircleIcon className="w-4 h-4"/>Apply Code</button>)}
        </div>
    );
};

interface InlineChatProps {
    targetType: 'sql' | 'plot';
    targetValue: string;
    cellContext: NotebookCellData;
    allCells: NotebookCellData[];
    metadata: NotebookMetadata;
    isAiFeatureActive: boolean;
    sql?: string;
    data?: (any[] | null);
    onApplyCode: (newCode: string) => void;
    onClose: () => void;
    onMetadataChange?: (newMetadata: NotebookMetadata) => void;
    /**
     * C7 — Optional notebook callbacks threaded down from App so the
     * inline-chat tool runtime can mutate cells when the model emits
     * `addCell`/`editCell`/`applyPlot` calls. When undefined the tool
     * runtime degrades gracefully (mutations return `{ ok: false, error }`).
     */
    cells?: NotebookCellData[];
    onAddCell?: (mut: { type: 'sql' | 'plot' | 'markdown'; content: string; afterCellId?: string }) => string | undefined;
    onUpdateCell?: (cellId: string, content: string) => void;
    onDeleteCell?: (cellId: string) => void;
    onMoveCell?: (cellId: string, targetCellId: string, position: 'before' | 'after') => void;
    /** Pop this InlineChat conversation into the ChatPanel sidebar. */
    onPopToSidebar?: (snapshot: InlineChatSnapshot) => void;
    /** Called when user clicks a [[ref]] / @cell reference link. */
    onNavigateRef?: (ref: string) => void;
}

/**
 * C7 — Cheap shallow-equality helper used to match a pending approval to a
 * `requireApproval` invocation. Mirrors the helper in ChatPanel; kept private
 * here because the two panels evolve independently.
 */
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

const InlineChat: React.FC<InlineChatProps> = ({ targetType, targetValue, cellContext, allCells, metadata, isAiFeatureActive, sql, data, onApplyCode, onClose, onMetadataChange, cells, onAddCell, onUpdateCell, onDeleteCell, onMoveCell, onPopToSidebar, onNavigateRef }) => {
    const { settings } = useContext(SettingsContext);
    const { query } = useContext(DataContext);
    const { activeSkills, availableSkills, mergedSystemPrompt, toggleSkill, deactivateSkill, isActive } = useContext(SkillContext);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [streamingText, setStreamingText] = useState<string | null>(null);
    const [input, setInput] = useState('');
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isLoading, setIsLoading] = useState(false);
    const cancelledRef = useRef(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    // Always-fresh ref so tool closures read the live cell list within a turn.
    const cellsLiveRef = useRef(cells ?? allCells);
    cellsLiveRef.current = cells ?? allCells;
    // Legacy toggle preserved for backwards-compat. `useFullContext=true` is
    // now interpreted as `visibility='full'`; otherwise the dropdown wins.
    const [useFullContext, setUseFullContext] = useState(false);
    const [chatVisibility, setChatVisibility] = useState<VisibilityMode>(settings.aiDefaultVisibility);

    // Slash-command autocomplete
    const [cmdSuggestions, setCmdSuggestions] = useState<string[]>([]);
    const [cmdSuggestionIdx, setCmdSuggestionIdx] = useState(0);

    // $variable autocomplete
    const [varSuggestions, setVarSuggestions] = useState<string[]>([]);
    const [varSuggestionIdx, setVarSuggestionIdx] = useState(0);
    const allInputVariables = useMemo(() => {
        const cellVars = parseCellContent(tokenizeCellContent(cellContext.content)).variables;
        return { ...metadata.variables, ...cellVars };
    }, [metadata.variables, cellContext.content]);

    // --- Per-cell chat mode (normal / plan / btw) ---
    const inlineChannelId = `inline-${cellContext.id}-${targetType}`;
    const persistStorage = typeof window !== 'undefined' ? window.localStorage : null;
    const dedupStorage   = typeof window !== 'undefined' ? window.sessionStorage : null;
    const chatMode = useChatMode({
        channelId: inlineChannelId,
        persistStorage,
        dedupStorage,
        aiService,
    });

    // --- C7 header state mirroring ChatPanel ---
    const configuredProviders = useMemo(() => listConfiguredProviders(settings), [settings]);
    const [chatProvider, setChatProvider] = useState<AiProviderType>(() => {
        if (configuredProviders.includes(settings.aiProvider)) return settings.aiProvider;
        return configuredProviders[0] ?? settings.aiProvider;
    });
    const [chatModel, setChatModel] = useState<string>(() => defaultModelForProvider(chatProvider, 'advanced'));
    const providerMeta = providerMetadataRegistry[chatProvider];
    const isFreeFormModel = chatProvider === 'local' || chatProvider === 'browser';

    // --- C7 tool-call proposal state ---
    const [proposals, setProposals] = useState<ApprovalRecord[]>([]);
    const proposalsRef = useRef<ApprovalRecord[]>([]);
    proposalsRef.current = proposals;
    const [approveAllReads, setApproveAllReads] = useState(false);
    const approveAllReadsRef = useRef(false);
    approveAllReadsRef.current = approveAllReads;
    const approvalResolvers = useRef<Map<string, { resolve: () => void; reject: (e: Error) => void }>>(new Map());

    // Auto-scroll to bottom whenever messages or streaming text change.
    // Also scroll the outer notebook container to bring the panel into view.
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        if (messages.length > 0) {
            containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [messages, streamingText, proposals]);

    // Re-sync chat header when configured providers shift under us.
    useEffect(() => {
        if (!configuredProviders.length) return;
        if (!configuredProviders.includes(chatProvider)) {
            const next = configuredProviders.includes(settings.aiProvider) ? settings.aiProvider : configuredProviders[0];
            setChatProvider(next);
            setChatModel(defaultModelForProvider(next, 'advanced'));
        }
    }, [configuredProviders, chatProvider, settings.aiProvider]);

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

    /**
     * Build the tool runtime deps. Same shape as ChatPanel.buildToolDeps;
     * factored as an inline closure because InlineChat's cell list can be
     * either the `cells` prop (when App threads it through) or `allCells`
     * which we already have for legacy notebook-context flow.
     */
    const buildToolDeps = useCallback((): ToolDeps => {
        const getLiveCells = () => cellsLiveRef.current;
        return {
            duckdbQuery: async (sqlText: string) => {
                const rows = await query(sqlText);
                const columns = rows && rows.length
                    ? Object.keys(rows[0]).map(name => ({ name, type: typeof (rows[0] as any)[name] }))
                    : [];
                return { columns, rows };
            },
            listCells: () => getLiveCells().map(c => ({ id: c.id, type: cellPrimaryType(c.content), content: c.content })),
            mutateCells: async (op: NotebookMutation) => {
                try {
                    const liveCells = getLiveCells();
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
                        const cell = liveCells.find(c => c.id === op.cellId);
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
                        const cell = liveCells.find(c => c.id === op.cellId);
                        if (!cell) return { ok: false, error: `cell not found: ${op.cellId}` };
                        onDeleteCell(op.cellId);
                        return { ok: true, cellId: op.cellId };
                    }
                    if (op.kind === 'move') {
                        if (!onMoveCell) return { ok: false, error: 'moveCell not supported in this environment' };
                        if (op.cellId === op.targetCellId) return { ok: false, error: 'cannot move a cell relative to itself' };
                        const src = liveCells.find(c => c.id === op.cellId);
                        const tgt = liveCells.find(c => c.id === op.targetCellId);
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
            getVariables: () => metadata.variables ?? {},
            setVariables: async (next) => {
                if (!onMetadataChange) return { ok: false, error: 'setVariables not supported in this environment' };
                try {
                    await onMetadataChange({ ...metadata, variables: next });
                    return { ok: true };
                } catch (e: any) {
                    return { ok: false, error: e?.message || String(e) };
                }
            },
            requireApproval: (toolName: string, args: any) => new Promise<void>((resolve, reject) => {
                const pending = proposalsRef.current.find(p => p.name === toolName && p.status === 'pending' && shallowEqualArgs(p.args, args));
                if (!pending) {
                    const id = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    setProposals(prev => [...prev, { id, name: toolName, args, status: 'pending' }]);
                    approvalResolvers.current.set(id, { resolve, reject });
                    return;
                }
                approvalResolvers.current.set(pending.id, { resolve, reject });
            }),
        };
    }, [onAddCell, onUpdateCell, onDeleteCell, onMoveCell, onMetadataChange, metadata, query]);

    const handleReset = () => {
        setMessages([]);
        setStreamingText(null);
        setProposals([]);
        setApproveAllReads(false);
        approvalResolvers.current.forEach(r => r.reject(new Error('cancelled')));
        approvalResolvers.current.clear();
        cancelledRef.current = true;
        abortControllerRef.current?.abort();
        setIsLoading(false);
    };

    // B-105: cancel in-flight AI request from inline chat.
    const handleCancel = () => {
        cancelledRef.current = true;
        abortControllerRef.current?.abort();
        approvalResolvers.current.forEach(r => r.reject(new Error('cancelled')));
        approvalResolvers.current.clear();
        setIsLoading(false);
    };

    const handleSendLegacy = async (inputText: string, effectiveVisibility: VisibilityMode) => {
        // Legacy path — used when the active provider has no tool support
        // (e.g. browser model) or when the upstream cells aren't threaded
        // through so tool-mutations would be no-ops anyway.

        // Browser provider doesn't support conversational chat — it only does
        // SQL prefix completions. Surface a clear message instead of returning empty.
        if (chatProvider === 'browser') {
            const hint = `The browser (offline) model only supports SQL autocomplete — it can't answer conversational questions.\n\nTo use AI chat, configure a provider in ⚙ Settings:\n• **Local OpenAI-compatible** — Ollama, LM Studio, etc.\n• **Claude (Anthropic)** — API key required.\n• **Gemini (Google)** — API key required.`;
            const aiMessage: ChatMessage = { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: hint };
            setMessages(prev => [...prev, aiMessage]);
            return;
        }

        const otherCells = allCells.filter(c => c.id !== cellContext.id);
        const fullNotebookContext = useFullContext ? otherCells.map(c => `### ${c.title}\n\n${c.content}`).join('\n\n---\n\n') : undefined;
        const recentResult = buildRecentResultFromRows(data);
        // B-015: pass all in-scope variables so AI knows $var names.
        const cellVars = parseCellContent(tokenizeCellContent(cellContext.content)).variables;
        const allVariables: Record<string, string> = { ...metadata.variables, ...cellVars };
        const aiResponse = await aiService.getAiInlineSuggestion(
            inputText,
            targetType,
            targetValue,
            cellContext.content,
            fullNotebookContext,
            data || undefined,
            metadata.customSystemPrompt,
            effectiveVisibility,
            recentResult,
            'advanced',
            allVariables,
        );
        const responseText = aiResponse.text?.trim() || '(No response from model — try a different provider.)';
        const aiMessage: ChatMessage = { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: responseText, code: aiResponse.code, isActionable: !!aiResponse.code };
        setMessages(prev => [...prev, aiMessage]);
    };

    const handleSend = async (override?: { text?: string; hiddenUserMessage?: boolean; forceMode?: 'normal' | 'plan' | 'btw' }): Promise<{ ok: boolean; error?: string }> => {
        const inputText0 = override?.text ?? input;
        if (inputText0.trim() === '' || isLoading) return { ok: false, error: 'empty or already loading' };

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
                const summary = messages
                    .map(m => `${m.sender === MessageSender.User ? 'User' : 'AI'}: ${m.text.slice(0, 120)}`)
                    .join('\n');
                setMessages([{
                    id: Date.now().toString(),
                    sender: MessageSender.AI,
                    text: `**Conversation compacted.**\n\n${summary.slice(0, 600)}${summary.length > 600 ? '\n…' : ''}`,
                }]);
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
                    slashCmd.mode === 'plan' ? 'Plan mode — I will propose changes without modifying the cell.' :
                    slashCmd.mode === 'btw'  ? 'BTW mode — you will get "by the way" suggestions after each reply.' :
                    'Normal mode — I may modify the cell directly.';
                setMessages(prev => [...prev,
                    { id: Date.now().toString(), sender: MessageSender.User, text: `/${slashCmd.mode}` },
                    { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: label },
                ]);
                return { ok: true };
            }
            if (slashCmd.kind === 'model') {
                if (!slashCmd.query) {
                    const modelInfo = `**Current model:** \`${chatModel}\` on \`${chatProvider}\`\n\nTo switch: \`/model <model-name>\``;
                    setMessages(prev => [...prev,
                        { id: Date.now().toString(), sender: MessageSender.User, text: '/model' },
                        { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: modelInfo },
                    ]);
                } else {
                    const meta = providerMetadataRegistry[chatProvider];
                    const target = (meta?.models ?? []).find(m => m.id === slashCmd.query || m.name.toLowerCase() === slashCmd.query.toLowerCase());
                    const newModelId = target?.id ?? slashCmd.query;
                    setChatModel(newModelId);
                    setMessages(prev => [...prev,
                        { id: Date.now().toString(), sender: MessageSender.User, text: `/model ${slashCmd.query}` },
                        { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Switched to \`${newModelId}\`.` },
                    ]);
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
                    `- \`/${s.name}\` ${s.icon ? s.icon + ' ' : ''}**${s.title}**${isActive(s.name) ? ' ✓' : ''} — ${s.description ?? ''}`
                ).join('\n');
                setMessages(prev => [...prev,
                    { id: Date.now().toString(), sender: MessageSender.User, text: '/skills' },
                    { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `### Available Skills\n\n${skillList}` },
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
                    : `${skill?.icon ?? '◆'} **${skill?.title ?? slashCmd.skillName}** activated.\n\nSub-commands: ${subCmds || 'none'}`;
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
                const loadedSkill = activeSkills.find(s => s.meta.name === slashCmd.skillName)
                    ?? builtinSkillManifest.load(slashCmd.skillName);
                const cmd = loadedSkill?.meta.commands.find(c => c.name === slashCmd.subCommand);
                if (!cmd || !loadedSkill) {
                    setMessages(prev => [...prev,
                        { id: Date.now().toString(), sender: MessageSender.User, text: input },
                        { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Unknown sub-command \`${slashCmd.subCommand}\`.` },
                    ]);
                    return { ok: true };
                }
                let inserted = 0;
                for (const cellName of cmd.cells) {
                    const cellContent = loadedSkill.cells.get(cellName);
                    if (cellContent && onAddCell) { onAddCell({ type: 'markdown', content: cellContent }); inserted++; }
                }
                setMessages(prev => [...prev,
                    { id: Date.now().toString(), sender: MessageSender.User, text: input },
                    { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Inserted ${inserted} cell${inserted !== 1 ? 's' : ''}.` },
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

        const userMessage: ChatMessage = {
            id: Date.now().toString(),
            sender: MessageSender.User,
            text: inputText0,
            hidden: override?.hiddenUserMessage,
        };
        setMessages(prev => [...prev, userMessage]);
        const inputText = inputText0;
        if (!override) setInput('');
        setCmdSuggestions([]);
        setIsLoading(true);
        setStreamingText(null);
        // Abort any previous in-flight request before starting the new one.
        if (abortControllerRef.current) abortControllerRef.current.abort();
        cancelledRef.current = false;
        abortControllerRef.current = new AbortController();
        setProposals([]);
        proposalsRef.current = [];
        setApproveAllReads(false);
        approveAllReadsRef.current = false;
        // Reject any pending resolvers before clearing so they don't leak or hang.
        approvalResolvers.current.forEach(r => r.reject(new Error('cancelled')));
        approvalResolvers.current.clear();

        const effectiveVisibility = resolveVisibility(useFullContext, chatVisibility);

        try {
            // Browser provider has no tool support; fall back to legacy
            // single-turn inline suggestion. Same path used when the active
            // provider isn't tool-capable.
            if (chatProvider === 'browser') {
                await handleSendLegacy(inputText, effectiveVisibility);
                return { ok: true };
            }

            const deps = buildToolDeps();
            const wrappedDeps: ToolDeps = {
                ...deps,
                requireApproval: (toolName: string, args: any) => new Promise<void>((resolve, reject) => {
                    // B-197: if the user already cancelled while a prior tool was running,
                    // reject immediately so the tool loop doesn't hang waiting for approval.
                    if (cancelledRef.current) { reject(new Error('cancelled')); return; }
                    const pending = [...proposalsRef.current].reverse().find(p => p.name === toolName && p.status === 'pending' && shallowEqualArgs(p.args, args));
                    const id = pending?.id ?? `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    if (!pending) {
                        setProposals(prev => [...prev, { id, name: toolName, args, status: 'pending' }]);
                    }
                    approvalResolvers.current.set(id, { resolve, reject });
                    // B-197: re-check after registering — user may have cancelled
                    // between the entry guard and the set() call above.
                    if (cancelledRef.current) {
                        approvalResolvers.current.delete(id);
                        reject(new Error('cancelled'));
                    }
                }),
            };

            const recentResult = buildRecentResultFromRows(data);

            // Build compact conversation history.
            const rawHistory: ToolChatMessage[] = messages.map(m => ({
                role: m.sender === MessageSender.User ? 'user' : 'assistant',
                content: m.text + (m.code ? `\n\`\`\`${targetType}\n${m.code}\n\`\`\`` : ''),
            }));
            const toolHistory = compactInlineHistory(rawHistory);
            toolHistory.push({
                role: 'user',
                content: `In this notebook cell I am editing a ${targetType} block:\n\n\`\`\`${targetType}\n${targetValue}\n\`\`\`\n\n${inputText}`,
            });

            let assistantBuf = '';
            const activeMode = override?.forceMode ?? chatMode.state.mode;
            const baseSystemPrompt = [metadata.customSystemPrompt, mergedSystemPrompt, variablesSystemPromptLine(metadata.variables)].filter(Boolean).join('\n\n') || undefined;
            const stream = aiService.streamChatWithTools(
                toolHistory,
                null, // No global schema bundle from InlineChat — tools can fetch via describeTable.
                filterToolsForMode(TOOLS as Tool[], activeMode),
                wrappedDeps,
                {
                    visibility: effectiveVisibility,
                    recentResult,
                    tier: 'advanced' as AiTier,
                    feature: 'chat',
                    providerOverride: chatProvider,
                    modelOverride: chatModel,
                    customSystemPrompt: composeSystemPromptForMode(baseSystemPrompt ?? '', activeMode) || undefined,
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
                        const proposal = chooseProposalKind(tool, chunk.args, {
                            visibility: effectiveVisibility,
                            approveAllReads: approveAllReadsRef.current,
                            existingCellContent: undefined,
                        });
                        if (proposal.kind === 'auto-read') {
                            setProposals(prev => applyApprovalAction(prev, { type: 'approve', id: chunk.id }));
                        }
                    }
                } else if (chunk.kind === 'tool_result') {
                    setProposals(prev => applyApprovalAction(prev, { type: 'complete', id: chunk.id, result: chunk.result }));
                }
            }

            setStreamingText(null);
            const trimmed = assistantBuf.trim();
            if (trimmed) {
                let meta: ChatMessageMeta | undefined;
                if (activeMode === 'plan') {
                    const parsed = chatMode.parsePlan(trimmed);
                    if (parsed) meta = { plan: parsed, planStatus: 'pending' };
                }
                setMessages(prev => [...prev, {
                    id: (Date.now() + 1).toString(),
                    sender: MessageSender.AI,
                    text: trimmed,
                    meta,
                }]);
                if (activeMode === 'btw') {
                    chatMode.maybeRunBtw({
                        userText: inputText,
                        assistantText: trimmed,
                        schema: null,
                        visibility: effectiveVisibility,
                        recentResult,
                    }).catch(() => { /* swallow — orchestrator logs */ });
                }
            }
        } catch (error: any) {
            setStreamingText(null);
            if (cancelledRef.current || error?.name === 'AbortError') {
                // Clean stop — no error message.
                return { ok: true };
            }
            // Tool-calling path may throw if the provider doesn't support
            // tools (e.g. local server without tool support). Fall back to
            // the legacy inline suggestion which is broadly compatible.
            const msg = String(error?.message || error);
            if (/does not support tool calling/i.test(msg)) {
                try {
                    await handleSendLegacy(inputText, effectiveVisibility);
                } catch (e2: any) {
                    setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Error: ${e2?.message || e2}` }]);
                }
                return { ok: false, error: msg };
            } else {
                const errorMessage: ChatMessage = { id: (Date.now() + 1).toString(), sender: MessageSender.AI, text: `Sorry, I encountered an error: ${msg}` };
                setMessages(prev => [...prev, errorMessage]);
                return { ok: false, error: msg };
            }
        } finally {
            setIsLoading(false);
        }
        return { ok: true };
    };

    const cellById = useMemo(() => {
        const m = new Map<string, NotebookCellData>();
        (cells ?? allCells).forEach(c => m.set(c.id, c));
        return m;
    }, [cells, allCells]);

    const getCellContent = useCallback((cellId: string) => cellById.get(cellId)?.content, [cellById]);

    const patchMessageMeta = useCallback((id: string, patch: Partial<ChatMessageMeta>) => {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, meta: { ...(m.meta ?? {}), ...patch } } : m));
    }, []);

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

    const onBtwAction = (hint: BtwHint) => {
        if (hint.action?.type === 'send-prompt' && hint.action.prompt) {
            chatMode.dismissHint(hint.id);
            handleSend({ text: hint.action.prompt });
        }
    };

    const injectContext = (label: string, content: string) => {
        const block = `\n\n<context label="${label}">\n${content}\n</context>\n\n`;
        setInput(prev => (prev.trim() ? prev + block : block.trim()));
        inputRef.current?.focus();
    };

    return (
        <div ref={containerRef} className="mt-4 border-t border-gray-700 pt-4 animate-fade-in-down flex flex-col space-y-3">
            {/* ── Header ── */}
            <div className="flex-shrink-0 flex items-center justify-between flex-wrap gap-2">
                <h6 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Refine with AI</h6>
                <div className="flex items-center gap-1 flex-wrap">
                    <label className="text-[10px] uppercase tracking-wider text-gray-400" htmlFor={`inline-vis-${cellContext.id}`}>See</label>
                    <select
                        id={`inline-vis-${cellContext.id}`}
                        aria-label="AI data visibility"
                        value={chatVisibility}
                        onChange={e => setChatVisibility(e.target.value as VisibilityMode)}
                        title="Controls what slice of the cell's data the AI can see"
                        className="bg-gray-800/60 border border-gray-600 rounded text-xs px-1.5 py-0.5 text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    >
                        <option value="no-data">No data</option>
                        <option value="sanitized">Sanitized</option>
                        <option value="full">Full</option>
                    </select>
                    <span className="text-[10px] text-gray-500" title={buildStatusTooltip({ mode: chatMode.state.mode, model: chatModel, provider: chatProvider, visibility: chatVisibility })}>
                        <span className={chatMode.state.mode === 'plan' ? 'text-amber-400' : chatMode.state.mode === 'btw' ? 'text-cyan-300' : 'text-gray-400'}>
                            /{chatMode.state.mode}
                        </span>
                        <span className="mx-1 text-gray-600">·</span>
                        <span className="font-mono text-gray-400">{chatModel || '—'}</span>
                    </span>
                    {onPopToSidebar && (
                        <button
                            onClick={() => {
                                const label = (() => {
                                    const m = cellContext.content.match(/^##?\s+(.+)/m);
                                    return (m?.[1]?.trim() ?? `cell ${targetType}`).slice(0, 24);
                                })();
                                onPopToSidebar({
                                    channelId: `inline-${cellContext.id}-${targetType}`,
                                    label,
                                    messages,
                                    provider: chatProvider,
                                    model: chatModel,
                                    draftInput: input || undefined,
                                });
                                onClose();
                            }}
                            title="Move to sidebar chat" aria-label="Move to sidebar chat"
                            className="p-1 hover:bg-gray-700 rounded-md"
                        >
                            <ArrowsPointingOutIcon className="w-4 h-4 text-gray-400 hover:text-cyan-400"/>
                        </button>
                    )}
                    <button onClick={handleReset} title="Reset Chat" aria-label="Reset Chat" className="p-1 hover:bg-gray-700 rounded-md"><ArrowCounterclockwiseIcon className="w-4 h-4 text-gray-400 hover:text-cyan-400"/></button>
                    <button onClick={onClose} title="Close Chat" aria-label="Close Chat" className="p-1 hover:bg-gray-700 rounded-md"><XMarkIcon className="w-4 h-4 text-gray-400"/></button>
                </div>
            </div>
            {/* ── Messages ── */}
            <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
                {messages.length === 0 && streamingText === null && (<p className="text-sm text-center text-gray-500 p-4">Ask the AI to modify your {targetType} code. Type <code className="text-cyan-400">/help</code> for commands.</p>)}
                {messages.filter(m => !m.hidden).map(msg => (
                    <div key={msg.id} className={`flex ${msg.sender === MessageSender.User ? 'justify-end':'justify-start'}`}>
                        <div className={`relative group/msg max-w-xs md:max-w-sm rounded-lg p-2 text-sm ${msg.sender===MessageSender.User ? 'bg-cyan-800/70 text-gray-100' : 'bg-gray-700/50 text-gray-300'}`}>
                            <div className="leading-relaxed">{msg.sender === MessageSender.AI ? renderMarkdown(msg.text, onNavigateRef) : <span className="whitespace-pre-wrap">{msg.text}</span>}</div>
                            {msg.meta?.plan && (
                                <ChatPlanCard plan={msg.meta.plan} meta={msg.meta} getCellContent={getCellContent} onExecute={executePlanFor(msg.id)} onDiscard={discardPlanFor(msg.id)}/>
                            )}
                            {msg.code && <CodeBlock code={msg.code} isActionable={msg.isActionable} targetType={targetType} data={data} sql={sql} cellContext={cellContext} onApplyCode={onApplyCode} isAiFeatureActive={isAiFeatureActive} metadata={metadata} onMetadataChange={onMetadataChange}/>}
                            {msg.sender === MessageSender.AI && (
                                <button
                                    onClick={() => navigator.clipboard.writeText(msg.code || msg.text).catch(() => {})}
                                    className="absolute -top-1 -right-1 opacity-0 group-hover/msg:opacity-100 p-1 bg-gray-600 hover:bg-gray-500 rounded transition-all"
                                    title="Copy response" aria-label="Copy response"
                                >
                                    <ClipboardIcon className="w-3 h-3 text-gray-300"/>
                                </button>
                            )}
                        </div>
                    </div>
                ))}
                {streamingText !== null && (
                    <div className="flex justify-start">
                        <div className="max-w-xs md:max-w-sm rounded-lg p-2 text-sm bg-gray-700/50 text-gray-300">
                            <div className="leading-relaxed">{renderMarkdown(streamingText, onNavigateRef)}<span className="inline-block w-1 h-3 bg-purple-400 ml-0.5 animate-pulse" style={{verticalAlign:'text-bottom'}}/></div>
                        </div>
                    </div>
                )}
                {proposals.map(record => {
                    const tool = TOOLS.find(t => t.name === record.name);
                    if (!tool) return null;
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
                {isLoading && streamingText === null && (
                    <div className="flex justify-start">
                        <div className="bg-gray-700/50 rounded-lg p-3 inline-flex items-center space-x-2">
                            <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></span>
                            <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse delay-150"></span>
                            <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse delay-300"></span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef}/>
            </div>
            {/* ── Input ── */}
            <div className="flex-shrink-0 space-y-2">
                {chatMode.state.btwHints.length > 0 && (
                    <div className="space-y-1">
                        {chatMode.state.btwHints.map(hint => (
                            <BtwSuggestionCard key={hint.id} hint={hint} onDismiss={chatMode.dismissHint} onAction={onBtwAction}/>
                        ))}
                    </div>
                )}
                <div className="flex flex-wrap gap-1 items-center">
                    <span className="text-[10px] uppercase tracking-wider text-gray-600">Add</span>
                    <button onClick={() => injectContext('cell content', targetValue)} className="text-[10px] px-2 py-0.5 bg-gray-700/80 hover:bg-gray-600 text-gray-400 hover:text-gray-200 rounded border border-gray-600/60 transition-colors" title={`Inject current ${targetType} content`}>this {targetType}</button>
                    {data && data.length > 0 && <button onClick={() => injectContext('query results', JSON.stringify(data.slice(0, 20), null, 2))} className="text-[10px] px-2 py-0.5 bg-gray-700/80 hover:bg-gray-600 text-gray-400 hover:text-gray-200 rounded border border-gray-600/60 transition-colors" title="Inject first 20 rows of query results" aria-label="Inject first 20 rows of query results">results ({data.length} rows)</button>}
                    <button onClick={() => setUseFullContext(!useFullContext)} className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${useFullContext ? 'bg-purple-600/30 text-purple-300 border-purple-600/40' : 'bg-gray-700/80 hover:bg-gray-600 text-gray-400 hover:text-gray-200 border-gray-600/60'}`} title="Include full notebook context in prompt" aria-label="Include full notebook context in prompt">
                        notebook
                    </button>
                </div>
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
                                {allInputVariables[v.replace(/^\$\$?/, '')] !== undefined && (
                                    <span className="text-gray-500 ml-2">= {String(allInputVariables[v.replace(/^\$\$?/, '')]).slice(0, 30)}</span>
                                )}
                            </button>
                        ))}
                        <p className="px-3 py-0.5 text-[10px] text-gray-600">Tab to complete · Esc to dismiss</p>
                    </div>
                )}
                <div className="relative">
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={input}
                        onChange={e => {
                            const v = e.target.value;
                            setInput(v);
                            e.target.style.height = 'auto';
                            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                            const suggestions = commandCompletions(v.trimStart(), availableSkills.map(s => s.name));
                            setCmdSuggestions(suggestions);
                            setCmdSuggestionIdx(0);
                            // $variable autocomplete: extract $word token ending at cursor
                            const cursor = e.target.selectionStart ?? v.length;
                            const before = v.slice(0, cursor);
                            const varMatch = before.match(/\$\$?\w*$/);
                            if (varMatch && Object.keys(allInputVariables).length > 0) {
                                const prefix = varMatch[0].toLowerCase();
                                const matches = Object.keys(allInputVariables)
                                    .map(k => k.startsWith('$') ? k : `$${k}`)
                                    .filter(k => k.toLowerCase().startsWith(prefix));
                                setVarSuggestions(matches);
                                setVarSuggestionIdx(0);
                            } else {
                                setVarSuggestions([]);
                            }
                        }}
                        onKeyDown={e => {
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
                                    const chosen = varSuggestions[varSuggestionIdx];
                                    const ta = e.currentTarget;
                                    const cursor = ta.selectionStart ?? input.length;
                                    const before = input.slice(0, cursor);
                                    const after = input.slice(cursor);
                                    const replaced = before.replace(/\$\$?\w*$/, chosen);
                                    setInput(replaced + after);
                                    setVarSuggestions([]);
                                    return;
                                }
                                if (e.key === 'ArrowDown') { e.preventDefault(); setVarSuggestionIdx(i => (i + 1) % varSuggestions.length); return; }
                                if (e.key === 'ArrowUp') { e.preventDefault(); setVarSuggestionIdx(i => (i - 1 + varSuggestions.length) % varSuggestions.length); return; }
                                if (e.key === 'Escape') { setVarSuggestions([]); return; }
                            }
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                        }}
                        placeholder={`Ask AI to change ${targetType}… or type / for commands`}
                        className="w-full bg-gray-800/50 border border-gray-600 rounded-lg py-2 pl-3 pr-10 focus:outline-none focus:ring-1 focus:ring-cyan-500 text-sm resize-none overflow-hidden"
                        style={{ minHeight: '36px' }}
                        disabled={isLoading}
                        autoFocus
                    />
                    {isLoading
                        ? <button onClick={handleCancel} className="absolute top-1/2 right-2 -translate-y-1/2 p-1.5 bg-red-700 hover:bg-red-600 rounded-md" title="Cancel request" aria-label="Cancel request"><XMarkIcon className="w-4 h-4 text-white"/></button>
                        : <button onClick={() => handleSend()} className="absolute top-1/2 right-2 -translate-y-1/2 p-1.5 bg-cyan-600 hover:bg-cyan-700 rounded-md disabled:bg-gray-600" disabled={isLoading||input.trim()===''}><SendIcon className="w-4 h-4 text-white"/></button>
                    }
                </div>
            </div>
        </div>
    );
};

export default InlineChat;
