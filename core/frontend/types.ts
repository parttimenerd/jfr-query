
import type { ProviderMetadata } from './services/ai/IAiProvider';

export interface NotebookCellData {
  id: string;
  title: string;
  content: string;
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
}

export interface CustomView {
    id: string;
    name: string;
    sql: string;
}

export interface CustomMacro {
    id: string;
    name: string;
    sql: string;
}

export interface NotebookMetadata {
  views: CustomView[];
  macros: CustomMacro[];
  customSystemPrompt?: string;
  timeFormat?: string;
  decimalPlaces?: number;
  variables?: Record<string, string>;
}
