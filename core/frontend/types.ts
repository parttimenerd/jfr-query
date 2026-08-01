
import type { ProviderMetadata } from './services/ai/IAiProvider';

export interface NotebookCellData {
  id: string;
  title: string;
  content: string;
  /** Optional human-stable handle from `<!-- @cell name=... -->` directive. */
  name?: string;
}

export interface ColumnSchema {
  name: string;
  type: string;
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  comment?: string;
  rowCount?: number;
}

export interface ViewSchema {
  name: string;
  query: string;
  columns: ColumnSchema[];
  comment?: string;
  internal?: boolean;
}

export interface MacroSchema {
  name: string;
  parameters: string[];
  sql: string;
  returnType: string;
  comment?: string;
}

export enum MessageSender {
  User,
  AI,
}

export interface ChatMessage {
  id: string;
  sender: MessageSender;
  text: string;
  code?: string | null;
  plotConfig?: string;
  isActionable?: boolean;
  /** Synthetic messages (e.g. plan-execution user turns) that are sent to the
   * LLM but never rendered in the UI. Filtered out at the renderer. */
  hidden?: boolean;
  /** Mode-specific metadata: parsed plans, plan status, predecessors, etc.
   * See services/ai/chatModes.ts for ParsedPlan shape. Kept as `any` here to
   * avoid a cyclic import; chatModes.ts re-exports the typed accessor. */
  meta?: ChatMessageMeta;
}

export interface ChatMessageMeta {
  plan?: any;            // ParsedPlan, typed in chatModes.ts
  planStatus?: 'pending' | 'executing' | 'executed' | 'failed' | 'discarded';
  planLastError?: string;
  planExecutedSteps?: number;
  planExecutedAt?: number;
  planDiscardedAt?: number;
  /** When this plan supersedes a prior plan in the same channel, the prior message's id. */
  planPredecessorMessageId?: string;
  /** Tool call trace for this AI turn (query_data + mutation steps). */
  trace?: import('./components/chat/ChatTraceView').TraceStep[];
}

export interface ViewParam {
    name: string;
    type: string;
    default?: string;
}

export interface CustomView {
    id: string;
    name: string;
    sql: string;
    params?: ViewParam[];
    includes?: string[];
}

export interface CustomMacro {
    id: string;
    name: string;
    sql: string;
    params?: ViewParam[];
    includes?: string[];
}

export interface NotebookMetadata {
  views: CustomView[];
  macros: CustomMacro[];
  customSystemPrompt?: string;
  timeFormat?: string;
  decimalPlaces?: number;
  variables?: Record<string, string>;
  /** Keyed by cell `name` or fallback `cell_<1-based-index>`; SQL returning truthy → cell rendered, else collapsed. */
  cellConditions?: Record<string, string>;
  /** Human-readable notebook title (falls back to first H2/H1 heading in intro cell). */
  title?: string;
  /** Optional short description shown in the sidebar / intro. */
  description?: string;
  /** Categorization tags; parsed from inline `[a, b]` or block YAML list. */
  tags?: string[];
  /** SPDX identifier or free-text license note. */
  license?: string;
  /** Preferred AI provider for this notebook (overrides global setting when set). */
  aiProvider?: string;
  /** Preferred AI model name for this notebook (overrides global setting when set). */
  aiModel?: string;
  /** Embedded query result snapshots for offline rendering.
   *  Key: `"${cellId}:${blockIndex}"`. Value: rows array (≤500) or null on query error.
   *  Populated by "Export with data"; absent in normal notebooks. */
  resultSnapshots?: Record<string, any[] | null>;
}
