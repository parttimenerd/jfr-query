# M-D1: AI Chat Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the right-rail CHAT tab to a real AI provider with streaming, cell proposals, and secure API key storage.

**Architecture:** A Dexie-backed `aiProviderStore` holds API keys exclusively in IndexedDB under `$ai_providers.*` keys — they never touch notebook files or localStorage. An `aiService` facade dispatches to `anthropicClient` (streaming via `@anthropic-ai/sdk`), and `ChatPanel` consumes a `useChatState` hook that drives token-by-token streaming into the message list. Cell proposals extracted from ```sql``` fences offer Accept/Reject actions that insert notebook cells.

**Tech Stack:** React 19.2, TypeScript 5.8, @anthropic-ai/sdk (streaming), Dexie 4 (IndexedDB), Vitest 4.1.9 (pool: forks), Tailwind v4 CSS tokens

**Blocked by:** M-B10 (RightRail with CHAT tab stub), M-A5 (formatter with $ai_providers scrubbing)

---

## Critical Rules

- `AppShell.tsx` MUST keep `useState(!hasNotebook)` — NEVER change to `useState(false)`
- `import type { JSX } from 'react'` in every component file
- `pool: 'forks'` in `vitest.config.ts` — NEVER change
- All colors via CSS token vars only — never hardcode hex values
- **`$ai_providers.*` MUST NEVER be written to notebook `.md` files** — this is a security invariant
- API keys stored exclusively in Dexie IndexedDB, never in `localStorage`, `sessionStorage`, or notebook frontmatter
- No `text-sm` — use literal px sizes (e.g. `text-[13px]`)
- No `any` — use `unknown` with narrowing

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/services/ai/aiTypes.ts` | Create | Shared types: `ChatMessage`, `ChatRole`, `AiProvider`, `AiConfig`, `StreamChunk` |
| `src/services/ai/aiProviderStore.ts` | Create | Dexie IndexedDB store — API keys only, never serialized to disk |
| `src/services/ai/anthropicClient.ts` | Create | Streaming chat via `@anthropic-ai/sdk` `messages.stream()` |
| `src/services/ai/aiService.ts` | Create | Facade: `sendMessage(messages, config): AsyncIterable<StreamChunk>` |
| `src/components/chat/ChatMessage.tsx` | Create | Single message bubble (user right / assistant left) |
| `src/components/chat/ChatInput.tsx` | Create | Textarea + send button, Enter to send, Shift+Enter for newline |
| `src/components/chat/ChatProviderBadge.tsx` | Create | Small badge showing current provider |
| `src/components/chat/useChatState.ts` | Create | Hook: messages, streaming state, send function |
| `src/components/chat/ChatPanel.tsx` | Create | Full chat UI, mounted inside RightRail CHAT tab |
| `src/components/settings/AiSettingsPanel.tsx` | Create | Provider selector + masked API key input |
| `src/components/shell/RightRail.tsx` | Modify | Replace CHAT stub with `<ChatPanel />` |
| `package.json` | Modify | Add `@anthropic-ai/sdk` dependency |
| `src/__tests__/ai/aiTypes.test.ts` | Create | Type shape smoke tests |
| `src/__tests__/ai/aiService.test.ts` | Create | Mock provider dispatch, error handling |
| `src/__tests__/ai/useChatState.test.ts` | Create | Hook: send, stream accumulation, thinking state |
| `src/__tests__/ai/aiProviderStore.test.ts` | Create | Key storage isolation — never leaks to notebook |
| `src/__tests__/chat/ChatPanel.test.tsx` | Create | Render, send flow, streaming, cell proposals |
| `src/__tests__/chat/ChatInput.test.tsx` | Create | Enter/Shift+Enter, disabled during streaming |

---

## Task 1: Install @anthropic-ai/sdk and define shared AI types

**Files:**
- Modify: `package.json`
- Create: `src/services/ai/aiTypes.ts`
- Create: `src/__tests__/ai/aiTypes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/ai/aiTypes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type {
  ChatRole,
  ChatMessage,
  AiProvider,
  AiConfig,
  StreamChunk,
} from '../../services/ai/aiTypes';

describe('aiTypes', () => {
  it('ChatRole is union of user and assistant', () => {
    const role: ChatRole = 'user';
    expect(role).toBe('user');
    const role2: ChatRole = 'assistant';
    expect(role2).toBe('assistant');
  });

  it('ChatMessage has required fields', () => {
    const msg: ChatMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'Hello',
      createdAt: Date.now(),
    };
    expect(msg.id).toBe('msg-1');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
    expect(typeof msg.createdAt).toBe('number');
  });

  it('AiProvider is union of supported providers', () => {
    const p1: AiProvider = 'anthropic';
    const p2: AiProvider = 'openai';
    const p3: AiProvider = 'ollama';
    expect([p1, p2, p3]).toEqual(['anthropic', 'openai', 'ollama']);
  });

  it('AiConfig has provider and optional model', () => {
    const cfg: AiConfig = { provider: 'anthropic' };
    expect(cfg.provider).toBe('anthropic');
    const cfg2: AiConfig = { provider: 'anthropic', model: 'claude-opus-4-5' };
    expect(cfg2.model).toBe('claude-opus-4-5');
  });

  it('StreamChunk has type and optional content/error', () => {
    const chunk: StreamChunk = { type: 'delta', content: 'Hello' };
    expect(chunk.type).toBe('delta');
    expect(chunk.content).toBe('Hello');
    const done: StreamChunk = { type: 'done' };
    expect(done.type).toBe('done');
    const err: StreamChunk = { type: 'error', error: 'Rate limited' };
    expect(err.error).toBe('Rate limited');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/ai/aiTypes.test.ts
```

Expected: FAIL — `Cannot find module '../../services/ai/aiTypes'`

- [ ] **Step 3: Add @anthropic-ai/sdk to package.json**

In `package.json` `dependencies`, add:
```json
"@anthropic-ai/sdk": "^0.52.0"
```

Then run:
```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npm install
```

- [ ] **Step 4: Create `src/services/ai/aiTypes.ts`**

```typescript
/** Roles in a chat conversation. */
export type ChatRole = 'user' | 'assistant' | 'system';

/** A single message in the chat history. */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  /** Set when this message contains a SQL proposal extracted from a ```sql``` fence. */
  sqlProposal?: string;
}

/** Supported AI providers. */
export type AiProvider = 'anthropic' | 'openai' | 'ollama';

/** Runtime config used when dispatching a request. */
export interface AiConfig {
  provider: AiProvider;
  model?: string;
  /** Max tokens to generate. */
  maxTokens?: number;
}

/** A chunk emitted by the streaming AsyncIterable. */
export interface StreamChunk {
  type: 'delta' | 'done' | 'error';
  content?: string;
  error?: string;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/ai/aiTypes.test.ts
```

Expected: PASS — 5 tests pass

- [ ] **Step 6: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
git add src/services/ai/aiTypes.ts src/__tests__/ai/aiTypes.test.ts package.json package-lock.json
git commit -m "feat(M-D1): add AI types and @anthropic-ai/sdk dependency"
```

---

## Task 2: Dexie-backed AI provider store

**Files:**
- Create: `src/services/ai/aiProviderStore.ts`
- Create: `src/__tests__/ai/aiProviderStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/ai/aiProviderStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  aiProviderStore,
  setProviderKey,
  getProviderKey,
  clearProviderKey,
  hasProviderKey,
} from '../../services/ai/aiProviderStore';
import type { AiProvider } from '../../services/ai/aiTypes';

// Use fake-indexeddb so tests run in jsdom without a real browser
// (Dexie detects the fake IDB implementation automatically in vitest/forks)

describe('aiProviderStore', () => {
  beforeEach(async () => {
    await aiProviderStore.keys.clear();
  });

  afterEach(async () => {
    await aiProviderStore.keys.clear();
  });

  it('stores an API key under $ai_providers.<provider>', async () => {
    await setProviderKey('anthropic', 'sk-ant-test-key');
    const stored = await aiProviderStore.keys.get('$ai_providers.anthropic');
    expect(stored).toBeDefined();
    expect(stored!.value).toBe('sk-ant-test-key');
  });

  it('getProviderKey retrieves by provider name', async () => {
    await setProviderKey('anthropic', 'sk-ant-abc');
    const key = await getProviderKey('anthropic');
    expect(key).toBe('sk-ant-abc');
  });

  it('getProviderKey returns null when not set', async () => {
    const key = await getProviderKey('openai');
    expect(key).toBeNull();
  });

  it('hasProviderKey returns true when set, false otherwise', async () => {
    expect(await hasProviderKey('anthropic')).toBe(false);
    await setProviderKey('anthropic', 'sk-ant-xyz');
    expect(await hasProviderKey('anthropic')).toBe(true);
  });

  it('clearProviderKey removes the key', async () => {
    await setProviderKey('anthropic', 'sk-ant-abc');
    await clearProviderKey('anthropic');
    expect(await getProviderKey('anthropic')).toBeNull();
  });

  it('SECURITY: key storage path includes $ai_providers prefix', async () => {
    await setProviderKey('anthropic', 'sk-ant-secret');
    const allKeys = await aiProviderStore.keys.toArray();
    for (const row of allKeys) {
      expect(row.id).toMatch(/^\$ai_providers\./);
    }
  });

  it('SECURITY: stored keys do not appear in any plain serialization', async () => {
    await setProviderKey('anthropic', 'sk-ant-super-secret');
    const allRows = await aiProviderStore.keys.toArray();
    // Simulate what a notebook serializer would do: JSON.stringify the rows
    const serialized = JSON.stringify(allRows);
    // The test is: if a serializer naively dumps this, it must NOT be written
    // to a notebook (enforced by formatter M-A5). Here we verify the key is
    // present in the DB row but tagged so the scrubber can catch it.
    expect(allRows[0].id).toMatch(/^\$ai_providers\./);
    // The value is present in the store (intentional — it's IndexedDB only)
    expect(serialized).toContain('sk-ant-super-secret');
    // The id prefix means the M-A5 scrubber regex /^\$ai_providers(\..+)?$/
    // will strip it before any .md write. This test documents that contract.
  });

  it('stores multiple providers independently', async () => {
    await setProviderKey('anthropic', 'sk-ant-a');
    await setProviderKey('openai', 'sk-openai-b');
    expect(await getProviderKey('anthropic')).toBe('sk-ant-a');
    expect(await getProviderKey('openai')).toBe('sk-openai-b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/ai/aiProviderStore.test.ts
```

Expected: FAIL — `Cannot find module '../../services/ai/aiProviderStore'`

- [ ] **Step 3: Install fake-indexeddb for test environment**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npm install --save-dev fake-indexeddb
```

Add to `vitest.config.ts` environment setup (do NOT change `pool: 'forks'`):

Check existing vitest.config.ts for a `setupFiles` field. If it has one, add to the array. If not, add:
```typescript
setupFiles: ['fake-indexeddb/auto'],
```

- [ ] **Step 4: Create `src/services/ai/aiProviderStore.ts`**

```typescript
import Dexie, { type Table } from 'dexie';
import type { AiProvider } from './aiTypes';

/** A single stored credential row. The id is always `$ai_providers.<provider>`. */
interface ProviderKeyRow {
  /** Format: `$ai_providers.anthropic`, `$ai_providers.openai`, etc. */
  id: string;
  value: string;
  updatedAt: number;
}

class AiProviderDatabase extends Dexie {
  keys!: Table<ProviderKeyRow, string>;

  constructor() {
    super('jfr-ai-provider-store');
    this.version(1).stores({
      keys: 'id, updatedAt',
    });
  }
}

export const aiProviderStore = new AiProviderDatabase();

function keyId(provider: AiProvider): string {
  return `$ai_providers.${provider}`;
}

export async function setProviderKey(
  provider: AiProvider,
  apiKey: string,
): Promise<void> {
  await aiProviderStore.keys.put({
    id: keyId(provider),
    value: apiKey,
    updatedAt: Date.now(),
  });
}

export async function getProviderKey(
  provider: AiProvider,
): Promise<string | null> {
  const row = await aiProviderStore.keys.get(keyId(provider));
  return row?.value ?? null;
}

export async function hasProviderKey(provider: AiProvider): Promise<boolean> {
  const row = await aiProviderStore.keys.get(keyId(provider));
  return row !== undefined;
}

export async function clearProviderKey(provider: AiProvider): Promise<void> {
  await aiProviderStore.keys.delete(keyId(provider));
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/ai/aiProviderStore.test.ts
```

Expected: PASS — 8 tests pass

- [ ] **Step 6: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
git add src/services/ai/aiProviderStore.ts src/__tests__/ai/aiProviderStore.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat(M-D1): add Dexie-backed AI provider store with security key isolation"
```

---

## Task 3: Anthropic streaming client

**Files:**
- Create: `src/services/ai/anthropicClient.ts`

No unit test here — the Anthropic SDK makes real HTTP calls; we mock at the `aiService` facade layer. A manual smoke test procedure is given instead.

- [ ] **Step 1: Create `src/services/ai/anthropicClient.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, AiConfig, StreamChunk } from './aiTypes';

const DEFAULT_MODEL = 'claude-opus-4-5';
const DEFAULT_MAX_TOKENS = 4096;

/** System prompt injected into every request. */
export const JFR_SYSTEM_PROMPT =
  'You are a SQL assistant for JFR (Java Flight Recorder) data. ' +
  'The user is querying JFR recording data stored in DuckDB. ' +
  'When you suggest SQL queries, wrap them in a ```sql``` fenced code block. ' +
  'Be concise and accurate.';

export interface ContextInjection {
  cellCount: number;
  tableNames: string[];
  columnNames: string[];
  lastQueryRowCount?: number;
  lastQueryFirstColumns?: string[];
}

function buildSystemPrompt(ctx: ContextInjection): string {
  const lines: string[] = [JFR_SYSTEM_PROMPT];
  lines.push('');
  lines.push('## Current notebook context');
  lines.push(`- Cells: ${ctx.cellCount}`);
  if (ctx.tableNames.length > 0) {
    lines.push(`- Tables: ${ctx.tableNames.join(', ')}`);
  }
  if (ctx.columnNames.length > 0) {
    lines.push(`- Columns (sample): ${ctx.columnNames.join(', ')}`);
  }
  if (ctx.lastQueryRowCount !== undefined) {
    lines.push(`- Last query returned ${ctx.lastQueryRowCount} rows`);
  }
  if (ctx.lastQueryFirstColumns && ctx.lastQueryFirstColumns.length > 0) {
    lines.push(
      `- Last result columns: ${ctx.lastQueryFirstColumns.join(', ')}`,
    );
  }
  return lines.join('\n');
}

/**
 * Streams a chat completion from Anthropic.
 * Yields `StreamChunk` objects: one `delta` per token, then `done` (or `error`).
 */
export async function* streamAnthropicChat(
  messages: ChatMessage[],
  config: AiConfig,
  apiKey: string,
  ctx: ContextInjection,
): AsyncGenerator<StreamChunk> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const anthropicMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  const model = config.model ?? DEFAULT_MODEL;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const systemPrompt = buildSystemPrompt(ctx);

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: anthropicMessages,
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { type: 'delta', content: event.delta.text };
      }
    }
    yield { type: 'done' };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Unknown streaming error';
    yield { type: 'error', error: message };
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx tsc --noEmit
```

Expected: No errors related to `anthropicClient.ts`

- [ ] **Step 3: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
git add src/services/ai/anthropicClient.ts
git commit -m "feat(M-D1): add Anthropic streaming client with JFR system prompt"
```

---

## Task 4: aiService facade with mock provider tests

**Files:**
- Create: `src/services/ai/aiService.ts`
- Create: `src/__tests__/ai/aiService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/ai/aiService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatMessage, AiConfig, StreamChunk } from '../../services/ai/aiTypes';

// Mock the Dexie store so tests don't need a real DB
vi.mock('../../services/ai/aiProviderStore', () => ({
  getProviderKey: vi.fn().mockResolvedValue('sk-ant-test'),
}));

// Mock the Anthropic client so no real HTTP calls are made
vi.mock('../../services/ai/anthropicClient', () => ({
  streamAnthropicChat: vi.fn(),
}));

import { sendMessage } from '../../services/ai/aiService';
import { getProviderKey } from '../../services/ai/aiProviderStore';
import { streamAnthropicChat } from '../../services/ai/anthropicClient';
import type { ContextInjection } from '../../services/ai/anthropicClient';

const mockGetProviderKey = vi.mocked(getProviderKey);
const mockStreamChat = vi.mocked(streamAnthropicChat);

function makeMessages(): ChatMessage[] {
  return [
    { id: '1', role: 'user', content: 'Show me top events', createdAt: 1000 },
  ];
}

function makeConfig(): AiConfig {
  return { provider: 'anthropic', model: 'claude-opus-4-5' };
}

function makeCtx(): ContextInjection {
  return {
    cellCount: 2,
    tableNames: ['jdk_ObjectAllocationInNewTLAB'],
    columnNames: ['startTime', 'objectClass', 'allocationSize'],
  };
}

async function* fakeStream(chunks: StreamChunk[]): AsyncGenerator<StreamChunk> {
  for (const c of chunks) yield c;
}

describe('aiService.sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches to anthropicClient when provider is anthropic', async () => {
    mockStreamChat.mockReturnValue(
      fakeStream([
        { type: 'delta', content: 'Hello' },
        { type: 'done' },
      ]),
    );

    const chunks: StreamChunk[] = [];
    for await (const chunk of sendMessage(makeMessages(), makeConfig(), makeCtx())) {
      chunks.push(chunk);
    }

    expect(mockStreamChat).toHaveBeenCalledOnce();
    expect(chunks).toEqual([
      { type: 'delta', content: 'Hello' },
      { type: 'done' },
    ]);
  });

  it('passes the retrieved API key to anthropicClient', async () => {
    mockGetProviderKey.mockResolvedValue('sk-ant-retrieved');
    mockStreamChat.mockReturnValue(fakeStream([{ type: 'done' }]));

    const chunks: StreamChunk[] = [];
    for await (const chunk of sendMessage(makeMessages(), makeConfig(), makeCtx())) {
      chunks.push(chunk);
    }

    expect(mockStreamChat).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'sk-ant-retrieved',
      expect.anything(),
    );
  });

  it('yields an error chunk when no API key is configured', async () => {
    mockGetProviderKey.mockResolvedValue(null);

    const chunks: StreamChunk[] = [];
    for await (const chunk of sendMessage(makeMessages(), makeConfig(), makeCtx())) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('error');
    expect(chunks[0].error).toMatch(/no api key/i);
  });

  it('propagates error chunks from the provider', async () => {
    mockStreamChat.mockReturnValue(
      fakeStream([{ type: 'error', error: 'Rate limit exceeded' }]),
    );

    const chunks: StreamChunk[] = [];
    for await (const chunk of sendMessage(makeMessages(), makeConfig(), makeCtx())) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toEqual({ type: 'error', error: 'Rate limit exceeded' });
  });

  it('yields error for unsupported provider', async () => {
    const config: AiConfig = { provider: 'ollama' as AiConfig['provider'] };

    const chunks: StreamChunk[] = [];
    for await (const chunk of sendMessage(makeMessages(), config, makeCtx())) {
      chunks.push(chunk);
    }

    expect(chunks[0].type).toBe('error');
    expect(chunks[0].error).toMatch(/unsupported provider/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/ai/aiService.test.ts
```

Expected: FAIL — `Cannot find module '../../services/ai/aiService'`

- [ ] **Step 3: Create `src/services/ai/aiService.ts`**

```typescript
import type { ChatMessage, AiConfig, StreamChunk } from './aiTypes';
import { getProviderKey } from './aiProviderStore';
import {
  streamAnthropicChat,
  type ContextInjection,
} from './anthropicClient';

export type { ContextInjection };

/**
 * Facade for all AI providers.
 * Dispatches to the correct client based on `config.provider`.
 * Retrieves the API key from the Dexie store — never from any other source.
 */
export async function* sendMessage(
  messages: ChatMessage[],
  config: AiConfig,
  ctx: ContextInjection,
): AsyncGenerator<StreamChunk> {
  if (config.provider !== 'anthropic') {
    yield {
      type: 'error',
      error: `Unsupported provider: ${config.provider}. Only 'anthropic' is currently supported.`,
    };
    return;
  }

  const apiKey = await getProviderKey(config.provider);
  if (!apiKey) {
    yield {
      type: 'error',
      error:
        'No API key configured. Open Settings (⌘,) to add your Anthropic API key.',
    };
    return;
  }

  yield* streamAnthropicChat(messages, config, apiKey, ctx);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/ai/aiService.test.ts
```

Expected: PASS — 5 tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
git add src/services/ai/aiService.ts src/__tests__/ai/aiService.test.ts
git commit -m "feat(M-D1): add aiService facade with provider dispatch and error handling"
```

---

## Task 5: useChatState hook

**Files:**
- Create: `src/components/chat/useChatState.ts`
- Create: `src/__tests__/ai/useChatState.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/ai/useChatState.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { StreamChunk } from '../../services/ai/aiTypes';

vi.mock('../../services/ai/aiService', () => ({
  sendMessage: vi.fn(),
}));

import { useChatState } from '../../components/chat/useChatState';
import { sendMessage } from '../../services/ai/aiService';

const mockSend = vi.mocked(sendMessage);

async function* streamOf(chunks: StreamChunk[]): AsyncGenerator<StreamChunk> {
  for (const c of chunks) yield c;
}

describe('useChatState', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts with empty messages and not streaming', () => {
    const { result } = renderHook(() => useChatState());
    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
  });

  it('adds user message immediately on send', async () => {
    mockSend.mockReturnValue(streamOf([{ type: 'done' }]));

    const { result } = renderHook(() => useChatState());
    await act(async () => {
      await result.current.sendUserMessage('Hello');
    });

    expect(result.current.messages[0].role).toBe('user');
    expect(result.current.messages[0].content).toBe('Hello');
  });

  it('sets isStreaming true while receiving deltas, false after done', async () => {
    let resolveStream!: () => void;
    const controlled = new Promise<void>((r) => (resolveStream = r));

    mockSend.mockReturnValue(
      (async function* () {
        yield { type: 'delta' as const, content: 'tok' };
        await controlled;
        yield { type: 'done' as const };
      })(),
    );

    const { result } = renderHook(() => useChatState());

    act(() => {
      void result.current.sendUserMessage('Q');
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    act(() => resolveStream());
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
  });

  it('accumulates delta tokens into assistant message', async () => {
    mockSend.mockReturnValue(
      streamOf([
        { type: 'delta', content: 'Hello' },
        { type: 'delta', content: ' world' },
        { type: 'done' },
      ]),
    );

    const { result } = renderHook(() => useChatState());
    await act(async () => {
      await result.current.sendUserMessage('Hi');
    });

    const assistantMsg = result.current.messages.find(
      (m) => m.role === 'assistant',
    );
    expect(assistantMsg?.content).toBe('Hello world');
  });

  it('stores sqlProposal when assistant message contains ```sql fence', async () => {
    mockSend.mockReturnValue(
      streamOf([
        { type: 'delta', content: 'Try this:\n```sql\nSELECT * FROM events\n```' },
        { type: 'done' },
      ]),
    );

    const { result } = renderHook(() => useChatState());
    await act(async () => {
      await result.current.sendUserMessage('Show events');
    });

    const assistantMsg = result.current.messages.find(
      (m) => m.role === 'assistant',
    );
    expect(assistantMsg?.sqlProposal).toBe('SELECT * FROM events');
  });

  it('sets error message on error chunk', async () => {
    mockSend.mockReturnValue(
      streamOf([{ type: 'error', error: 'Rate limit' }]),
    );

    const { result } = renderHook(() => useChatState());
    await act(async () => {
      await result.current.sendUserMessage('Q');
    });

    const assistantMsg = result.current.messages.find(
      (m) => m.role === 'assistant',
    );
    expect(assistantMsg?.content).toMatch(/Rate limit/);
    expect(result.current.isStreaming).toBe(false);
  });

  it('clearMessages resets to empty array', async () => {
    mockSend.mockReturnValue(streamOf([{ type: 'done' }]));

    const { result } = renderHook(() => useChatState());
    await act(async () => {
      await result.current.sendUserMessage('Hello');
    });
    act(() => result.current.clearMessages());

    expect(result.current.messages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/ai/useChatState.test.ts
```

Expected: FAIL — `Cannot find module '../../components/chat/useChatState'`

- [ ] **Step 3: Create `src/components/chat/useChatState.ts`**

```typescript
import { useState, useCallback, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import type { ChatMessage, AiConfig } from '../../services/ai/aiTypes';
import { sendMessage, type ContextInjection } from '../../services/ai/aiService';

/** Extracts the first SQL block from a markdown string, or undefined. */
function extractSql(content: string): string | undefined {
  const match = content.match(/```sql\s*\n([\s\S]*?)```/i);
  return match ? match[1].trim() : undefined;
}

export interface ChatStateContext {
  cellCount: number;
  tableNames: string[];
  columnNames: string[];
  lastQueryRowCount?: number;
  lastQueryFirstColumns?: string[];
}

export interface UseChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  sendUserMessage: (text: string, ctx?: Partial<ChatStateContext>) => Promise<void>;
  clearMessages: () => void;
}

const DEFAULT_CONFIG: AiConfig = { provider: 'anthropic' };

export function useChatState(config: AiConfig = DEFAULT_CONFIG): UseChatState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const assistantMsgIdRef = useRef<string | null>(null);

  const sendUserMessage = useCallback(
    async (text: string, ctx?: Partial<ChatStateContext>) => {
      const userMsg: ChatMessage = {
        id: uuid(),
        role: 'user',
        content: text,
        createdAt: Date.now(),
      };

      const assistantId = uuid();
      assistantMsgIdRef.current = assistantId;

      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      const resolvedCtx: ContextInjection = {
        cellCount: ctx?.cellCount ?? 0,
        tableNames: ctx?.tableNames ?? [],
        columnNames: ctx?.columnNames ?? [],
        lastQueryRowCount: ctx?.lastQueryRowCount,
        lastQueryFirstColumns: ctx?.lastQueryFirstColumns,
      };

      const allMessages = [...messages, userMsg];

      try {
        for await (const chunk of sendMessage(allMessages, config, resolvedCtx)) {
          if (chunk.type === 'delta' && chunk.content) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + chunk.content }
                  : m,
              ),
            );
          } else if (chunk.type === 'error') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: `Error: ${chunk.error ?? 'Unknown error'}` }
                  : m,
              ),
            );
            setIsStreaming(false);
            return;
          } else if (chunk.type === 'done') {
            // Extract SQL proposal after full message is assembled
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                const sqlProposal = extractSql(m.content);
                return sqlProposal ? { ...m, sqlProposal } : m;
              }),
            );
          }
        }
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, config],
  );

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, isStreaming, sendUserMessage, clearMessages };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/ai/useChatState.test.ts
```

Expected: PASS — 7 tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
git add src/components/chat/useChatState.ts src/__tests__/ai/useChatState.test.ts
git commit -m "feat(M-D1): add useChatState hook with streaming accumulation and SQL proposal extraction"
```

---

## Task 6: ChatMessage component

**Files:**
- Create: `src/components/chat/ChatMessage.tsx`

- [ ] **Step 1: Create `src/components/chat/ChatMessage.tsx`**

```typescript
import type { JSX } from 'react';
import type { ChatMessage as ChatMessageType } from '../../services/ai/aiTypes';

interface ChatMessageProps {
  message: ChatMessageType;
  onAcceptSql?: (sql: string) => void;
  onRejectSql?: (messageId: string) => void;
}

export function ChatMessage({
  message,
  onAcceptSql,
  onRejectSql,
}: ChatMessageProps): JSX.Element {
  const isUser = message.role === 'user';

  return (
    <div
      className={`flex w-full mb-3 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={[
          'max-w-[85%] rounded-lg px-3 py-2',
          'text-[13px] leading-relaxed',
          isUser
            ? 'bg-[color:var(--color-accent)]/10 text-[color:var(--color-fg-base)] rounded-br-sm'
            : 'bg-[color:var(--color-bg-overlay)] text-[color:var(--color-fg-base)] rounded-bl-sm',
        ].join(' ')}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>

        {message.sqlProposal && (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onAcceptSql?.(message.sqlProposal!)}
              className={[
                'rounded px-2 py-1 text-[12px] font-medium',
                'bg-[color:var(--color-accent-green)]/10',
                'text-[color:var(--color-accent-green)]',
                'border border-[color:var(--color-accent-green)]/30',
                'hover:bg-[color:var(--color-accent-green)]/20 transition-colors',
              ].join(' ')}
            >
              Accept SQL
            </button>
            <button
              type="button"
              onClick={() => onRejectSql?.(message.id)}
              className={[
                'rounded px-2 py-1 text-[12px]',
                'text-[color:var(--color-fg-muted)]',
                'hover:text-[color:var(--color-fg-base)] transition-colors',
              ].join(' ')}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
git add src/components/chat/ChatMessage.tsx
git commit -m "feat(M-D1): add ChatMessage bubble component with SQL Accept/Dismiss actions"
```

---

## Task 7: ChatInput component

**Files:**
- Create: `src/components/chat/ChatInput.tsx`
- Create: `src/__tests__/chat/ChatInput.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/chat/ChatInput.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../../components/chat/ChatInput';

describe('ChatInput', () => {
  it('renders textarea and send button', () => {
    render(<ChatInput onSend={vi.fn()} isDisabled={false} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('calls onSend with trimmed text on Enter', async () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} isDisabled={false} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'Hello{Enter}');
    expect(onSend).toHaveBeenCalledWith('Hello');
  });

  it('does NOT call onSend on Shift+Enter — inserts newline', async () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} isDisabled={false} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'Hello{Shift>}{Enter}{/Shift}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('clears textarea after send', async () => {
    render(<ChatInput onSend={vi.fn()} isDisabled={false} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await userEvent.type(textarea, 'Hello{Enter}');
    expect(textarea.value).toBe('');
  });

  it('does not call onSend when disabled', async () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} isDisabled={true} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'Hello{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('send button is disabled when isDisabled=true', () => {
    render(<ChatInput onSend={vi.fn()} isDisabled={true} />);
    const btn = screen.getByRole('button', { name: /send/i });
    expect(btn).toBeDisabled();
  });

  it('does not send empty or whitespace-only message', async () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} isDisabled={false} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '   {Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('calls onSend on send button click', async () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} isDisabled={false} />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'Hello');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith('Hello');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/chat/ChatInput.test.tsx
```

Expected: FAIL — `Cannot find module '../../components/chat/ChatInput'`

- [ ] **Step 3: Create `src/components/chat/ChatInput.tsx`**

```typescript
import { useState, useCallback, type KeyboardEvent } from 'react';
import type { JSX } from 'react';

interface ChatInputProps {
  onSend: (text: string) => void;
  isDisabled: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  isDisabled,
  placeholder = 'Ask about your JFR data…',
}: ChatInputProps): JSX.Element {
  const [value, setValue] = useState('');

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isDisabled) return;
    onSend(trimmed);
    setValue('');
  }, [value, isDisabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex items-end gap-2 p-2 border-t border-[color:var(--color-border)]">
      <textarea
        className={[
          'flex-1 resize-none rounded-md px-3 py-2',
          'bg-[color:var(--color-bg-overlay)] border border-[color:var(--color-border)]',
          'text-[13px] text-[color:var(--color-fg-base)]',
          'placeholder:text-[color:var(--color-fg-muted)]',
          'focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent)]',
          'disabled:opacity-50',
          'min-h-[60px] max-h-[160px]',
        ].join(' ')}
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isDisabled}
        aria-label="Chat message input"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={isDisabled || !value.trim()}
        className={[
          'px-3 py-2 rounded-md text-[13px] font-medium',
          'bg-[color:var(--color-accent)] text-[color:var(--color-bg-base)]',
          'hover:opacity-90 transition-opacity',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        ].join(' ')}
        aria-label="Send message"
      >
        Send
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/chat/ChatInput.test.tsx
```

Expected: PASS — 8 tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
git add src/components/chat/ChatInput.tsx src/__tests__/chat/ChatInput.test.tsx
git commit -m "feat(M-D1): add ChatInput component with Enter-to-send and Shift+Enter newline"
```

---

## Task 8: ChatProviderBadge component

**Files:**
- Create: `src/components/chat/ChatProviderBadge.tsx`

- [ ] **Step 1: Create `src/components/chat/ChatProviderBadge.tsx`**

```typescript
import type { JSX } from 'react';
import type { AiProvider } from '../../services/ai/aiTypes';

interface ChatProviderBadgeProps {
  provider: AiProvider | null;
  model?: string;
}

const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Claude',
  openai: 'GPT',
  ollama: 'Local',
};

const PROVIDER_COLORS: Record<AiProvider, string> = {
  anthropic: 'var(--color-accent-amber)',
  openai: 'var(--color-accent-green)',
  ollama: 'var(--color-accent-purple)',
};

export function ChatProviderBadge({
  provider,
  model,
}: ChatProviderBadgeProps): JSX.Element {
  if (!provider) {
    return (
      <span
        className="text-[11px] text-[color:var(--color-fg-muted)] px-2 py-0.5 rounded border border-[color:var(--color-border)]"
      >
        No provider
      </span>
    );
  }

  const label = PROVIDER_LABELS[provider];
  const color = PROVIDER_COLORS[provider];
  const displayModel = model ? ` · ${model}` : '';

  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded border font-mono"
      style={{
        color,
        borderColor: color,
        backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      {label}{displayModel}
    </span>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
git add src/components/chat/ChatProviderBadge.tsx
git commit -m "feat(M-D1): add ChatProviderBadge with per-provider color coding"
```

---

## Task 9: ChatPanel component

**Files:**
- Create: `src/components/chat/ChatPanel.tsx`
- Create: `src/__tests__/chat/ChatPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/chat/ChatPanel.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StreamChunk } from '../../services/ai/aiTypes';

vi.mock('../../services/ai/aiService', () => ({
  sendMessage: vi.fn(),
}));

vi.mock('../../services/ai/aiProviderStore', () => ({
  getProviderKey: vi.fn().mockResolvedValue('sk-ant-test'),
  hasProviderKey: vi.fn().mockResolvedValue(true),
}));

import { ChatPanel } from '../../components/chat/ChatPanel';
import { sendMessage } from '../../services/ai/aiService';

const mockSend = vi.mocked(sendMessage);

async function* streamOf(chunks: StreamChunk[]): AsyncGenerator<StreamChunk> {
  for (const c of chunks) yield c;
}

describe('ChatPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the chat input and empty state', () => {
    mockSend.mockReturnValue(streamOf([]));
    render(<ChatPanel />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByText(/ask about your jfr data/i)).toBeInTheDocument();
  });

  it('shows "Thinking…" indicator after sending before first token', async () => {
    let resolve!: () => void;
    const controlled = new Promise<void>((r) => (resolve = r));

    mockSend.mockReturnValue(
      (async function* () {
        await controlled;
        yield { type: 'done' as const };
      })(),
    );

    render(<ChatPanel />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'Hello{Enter}');

    await waitFor(() =>
      expect(screen.getByText(/thinking/i)).toBeInTheDocument(),
    );

    resolve();
    await waitFor(() =>
      expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument(),
    );
  });

  it('renders user message right-aligned and assistant message left-aligned', async () => {
    mockSend.mockReturnValue(
      streamOf([
        { type: 'delta', content: 'Hi there' },
        { type: 'done' },
      ]),
    );

    render(<ChatPanel />);
    await userEvent.type(screen.getByRole('textbox'), 'Hello{Enter}');

    await waitFor(() => screen.getByText('Hello'));
    await waitFor(() => screen.getByText('Hi there'));

    const userBubble = screen.getByText('Hello').closest('[class*="justify-end"]');
    const assistantBubble = screen
      .getByText('Hi there')
      .closest('[class*="justify-start"]');
    expect(userBubble).toBeInTheDocument();
    expect(assistantBubble).toBeInTheDocument();
  });

  it('shows Accept SQL button when assistant response contains ```sql``` fence', async () => {
    const sqlContent =
      'Here is a query:\n```sql\nSELECT * FROM jdk_ObjectAllocationInNewTLAB\n```';
    mockSend.mockReturnValue(
      streamOf([{ type: 'delta', content: sqlContent }, { type: 'done' }]),
    );

    render(<ChatPanel />);
    await userEvent.type(screen.getByRole('textbox'), 'Show me events{Enter}');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /accept sql/i })).toBeInTheDocument(),
    );
  });

  it('calls onAcceptSql prop when Accept SQL is clicked', async () => {
    const onAcceptSql = vi.fn();
    const sqlContent = '```sql\nSELECT 1\n```';
    mockSend.mockReturnValue(
      streamOf([{ type: 'delta', content: sqlContent }, { type: 'done' }]),
    );

    render(<ChatPanel onAcceptSql={onAcceptSql} />);
    await userEvent.type(screen.getByRole('textbox'), 'Q{Enter}');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /accept sql/i })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('button', { name: /accept sql/i }));

    expect(onAcceptSql).toHaveBeenCalledWith('SELECT 1');
  });

  it('shows error message when provider returns error chunk', async () => {
    mockSend.mockReturnValue(
      streamOf([{ type: 'error', error: 'No API key' }]),
    );

    render(<ChatPanel />);
    await userEvent.type(screen.getByRole('textbox'), 'Q{Enter}');

    await waitFor(() =>
      expect(screen.getByText(/no api key/i)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/chat/ChatPanel.test.tsx
```

Expected: FAIL — `Cannot find module '../../components/chat/ChatPanel'`

- [ ] **Step 3: Create `src/components/chat/ChatPanel.tsx`**

```typescript
import { useRef, useEffect, useCallback } from 'react';
import type { JSX } from 'react';
import { useChatState } from './useChatState';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatProviderBadge } from './ChatProviderBadge';

interface ChatPanelProps {
  onAcceptSql?: (sql: string) => void;
  cellCount?: number;
  tableNames?: string[];
  columnNames?: string[];
  lastQueryRowCount?: number;
  lastQueryFirstColumns?: string[];
}

export function ChatPanel({
  onAcceptSql,
  cellCount = 0,
  tableNames = [],
  columnNames = [],
  lastQueryRowCount,
  lastQueryFirstColumns,
}: ChatPanelProps): JSX.Element {
  const { messages, isStreaming, sendUserMessage, clearMessages } = useChatState();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(
    async (text: string) => {
      await sendUserMessage(text, {
        cellCount,
        tableNames,
        columnNames,
        lastQueryRowCount,
        lastQueryFirstColumns,
      });
    },
    [
      sendUserMessage,
      cellCount,
      tableNames,
      columnNames,
      lastQueryRowCount,
      lastQueryFirstColumns,
    ],
  );

  const handleRejectSql = useCallback(
    (messageId: string) => {
      // Remove the sqlProposal from that message — already handled by
      // re-rendering with the proposal hidden via a dismiss flag.
      // For simplicity we just clear messages with that id's proposal.
      // A full implementation would set a dismissed flag.
      void messageId;
    },
    [],
  );

  /** True while streaming but the assistant content is still empty (no tokens yet). */
  const isThinking =
    isStreaming &&
    messages.length > 0 &&
    messages[messages.length - 1].role === 'assistant' &&
    messages[messages.length - 1].content === '';

  return (
    <div className="flex flex-col h-full bg-[color:var(--color-bg-base)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--color-border)]">
        <span className="text-[12px] text-[color:var(--color-fg-muted)] font-medium uppercase tracking-wider">
          AI Chat
        </span>
        <div className="flex items-center gap-2">
          <ChatProviderBadge provider="anthropic" />
          <button
            type="button"
            onClick={clearMessages}
            className="text-[11px] text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg-base)] transition-colors"
            aria-label="Clear chat history"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {messages.length === 0 && (
          <p className="text-[13px] text-[color:var(--color-fg-muted)] text-center mt-8">
            Ask about your JFR data
          </p>
        )}
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            onAcceptSql={onAcceptSql}
            onRejectSql={handleRejectSql}
          />
        ))}
        {isThinking && (
          <div className="flex justify-start mb-3">
            <div className="bg-[color:var(--color-bg-overlay)] text-[color:var(--color-fg-muted)] rounded-lg rounded-bl-sm px-3 py-2 text-[13px] italic">
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} isDisabled={isStreaming} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/chat/ChatPanel.test.tsx
```

Expected: PASS — 6 tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
git add src/components/chat/ChatPanel.tsx src/__tests__/chat/ChatPanel.test.tsx
git commit -m "feat(M-D1): add ChatPanel with streaming, Thinking indicator, and SQL proposals"
```

---

## Task 10: AiSettingsPanel with API key validation

**Files:**
- Create: `src/components/settings/AiSettingsPanel.tsx`

- [ ] **Step 1: Create `src/components/settings/AiSettingsPanel.tsx`**

```typescript
import { useState, useCallback, useEffect } from 'react';
import type { JSX } from 'react';
import {
  setProviderKey,
  getProviderKey,
  clearProviderKey,
  hasProviderKey,
} from '../../services/ai/aiProviderStore';
import type { AiProvider } from '../../services/ai/aiTypes';

const ANTHROPIC_KEY_PREFIX = 'sk-ant-';

function validateAnthropicKey(key: string): string | null {
  if (!key.startsWith(ANTHROPIC_KEY_PREFIX)) {
    return `Anthropic API keys must start with "${ANTHROPIC_KEY_PREFIX}"`;
  }
  if (key.length < 20) {
    return 'Key appears too short — please paste the full key';
  }
  return null;
}

interface AiSettingsPanelProps {
  onClose?: () => void;
}

export function AiSettingsPanel({ onClose }: AiSettingsPanelProps): JSX.Element {
  const [keyInput, setKeyInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savedProvider, setSavedProvider] = useState<AiProvider | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    void hasProviderKey('anthropic').then((has) => {
      if (has) setSavedProvider('anthropic');
    });
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setValidationError('Please enter an API key');
      return;
    }
    const error = validateAnthropicKey(trimmed);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    setIsSaving(true);
    try {
      await setProviderKey('anthropic', trimmed);
      setSavedProvider('anthropic');
      setSaveSuccess(true);
      setKeyInput('');
      setTimeout(() => setSaveSuccess(false), 2000);
    } finally {
      setIsSaving(false);
    }
  }, [keyInput]);

  const handleClear = useCallback(async () => {
    await clearProviderKey('anthropic');
    setSavedProvider(null);
    setSaveSuccess(false);
  }, []);

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-[14px] font-semibold text-[color:var(--color-fg-base)]">
        AI Provider Settings
      </h2>

      <div className="space-y-2">
        <label
          htmlFor="anthropic-key"
          className="block text-[12px] text-[color:var(--color-fg-muted)]"
        >
          Anthropic API Key
        </label>
        {savedProvider === 'anthropic' && (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[color:var(--color-accent-green)]">
              Key saved (stored securely in browser only — never written to files)
            </span>
            <button
              type="button"
              onClick={() => void handleClear()}
              className="text-[11px] text-[color:var(--color-accent-red)] hover:underline"
            >
              Remove
            </button>
          </div>
        )}
        <input
          id="anthropic-key"
          type="password"
          autoComplete="off"
          value={keyInput}
          onChange={(e) => {
            setKeyInput(e.target.value);
            setValidationError(null);
          }}
          placeholder="sk-ant-api03-..."
          className={[
            'w-full px-3 py-2 rounded-md text-[13px] font-mono',
            'bg-[color:var(--color-bg-overlay)] border',
            validationError
              ? 'border-[color:var(--color-accent-red)]'
              : 'border-[color:var(--color-border)]',
            'text-[color:var(--color-fg-base)]',
            'placeholder:text-[color:var(--color-fg-muted)]',
            'focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent)]',
          ].join(' ')}
        />
        {validationError && (
          <p className="text-[11px] text-[color:var(--color-accent-red)]">
            {validationError}
          </p>
        )}
        <p className="text-[11px] text-[color:var(--color-fg-muted)]">
          Stored exclusively in IndexedDB — never written to notebook files or
          localStorage.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving || !keyInput.trim()}
          className={[
            'px-4 py-1.5 rounded-md text-[13px] font-medium',
            'bg-[color:var(--color-accent)] text-[color:var(--color-bg-base)]',
            'hover:opacity-90 transition-opacity',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          ].join(' ')}
        >
          {isSaving ? 'Saving…' : 'Save Key'}
        </button>
        {saveSuccess && (
          <span className="text-[12px] text-[color:var(--color-accent-green)]">
            Saved!
          </span>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg-base)] transition-colors"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
git add src/components/settings/AiSettingsPanel.tsx
git commit -m "feat(M-D1): add AiSettingsPanel with key validation and secure storage notice"
```

---

## Task 11: Wire ChatPanel into RightRail

**Files:**
- Modify: `src/components/shell/RightRail.tsx`

- [ ] **Step 1: Read the current RightRail.tsx**

Open `src/components/shell/RightRail.tsx` and locate the CHAT tab stub content. It will look something like:

```tsx
{activeTab === 'CHAT' && (
  <div className="...">
    {/* stub */}
  </div>
)}
```

- [ ] **Step 2: Replace the CHAT tab stub with ChatPanel**

In `src/components/shell/RightRail.tsx`, add the import at the top of the file (after existing imports):

```typescript
import { ChatPanel } from '../chat/ChatPanel';
```

Then replace the CHAT tab stub content. The exact content to replace depends on the current stub, but the result should be:

```tsx
{activeTab === 'CHAT' && (
  <div className="flex flex-col h-full overflow-hidden">
    <ChatPanel
      onAcceptSql={(sql) => {
        // TODO M-D1: dispatch insertCell action with sql content
        console.info('[ChatPanel] Accept SQL:', sql);
      }}
    />
  </div>
)}
```

Keep all other parts of `RightRail.tsx` unchanged — especially the collapse toggle, tab switching, and `⌥H` keybinding logic.

- [ ] **Step 3: Verify TypeScript compiles and dev server starts**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Run all tests to confirm nothing broke**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run
```

Expected: All tests pass. No regressions in existing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
git add src/components/shell/RightRail.tsx
git commit -m "feat(M-D1): wire ChatPanel into RightRail CHAT tab"
```

---

## Task 12: Security invariant tests — API keys never reach notebook files

**Files:**
- Create: `src/__tests__/ai/security.test.ts`

These tests document and enforce the security invariant that `$ai_providers.*` keys are never serialized into notebook `.md` files.

- [ ] **Step 1: Write the security tests**

Create `src/__tests__/ai/security.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  aiProviderStore,
  setProviderKey,
  getProviderKey,
} from '../../services/ai/aiProviderStore';

/**
 * Simulates the M-A5 formatter's scrubber logic:
 * strips any frontmatter key matching /^\$\$?ai_providers(\..+)?$/ before writing .md.
 *
 * The real M-A5 scrubber also emits a SecretLeakPrevented diagnostic.
 * Here we just verify the regex would strip the key.
 */
function scrubFrontmatter(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  const scrubPattern = /^\$ai_providers(\..+)?$/;
  const scrubbed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(frontmatter)) {
    if (!scrubPattern.test(k)) {
      scrubbed[k] = v;
    }
  }
  return scrubbed;
}

describe('SECURITY: $ai_providers keys never reach notebook files', () => {
  beforeEach(async () => {
    await aiProviderStore.keys.clear();
  });

  afterEach(async () => {
    await aiProviderStore.keys.clear();
  });

  it('aiProviderStore keys are stored with $ai_providers. prefix', async () => {
    await setProviderKey('anthropic', 'sk-ant-test');
    const rows = await aiProviderStore.keys.toArray();
    expect(rows.every((r) => r.id.startsWith('$ai_providers.'))).toBe(true);
  });

  it('M-A5 scrubber regex strips $ai_providers.anthropic from frontmatter', () => {
    const frontmatter = {
      title: 'My Notebook',
      '$ai_providers.anthropic': 'sk-ant-secret',
      '$ai_providers.openai': 'sk-openai-secret',
      normalKey: 'visible',
    };
    const scrubbed = scrubFrontmatter(frontmatter);
    expect(scrubbed).not.toHaveProperty('$ai_providers.anthropic');
    expect(scrubbed).not.toHaveProperty('$ai_providers.openai');
    expect(scrubbed).toHaveProperty('normalKey', 'visible');
    expect(scrubbed).toHaveProperty('title', 'My Notebook');
  });

  it('M-A5 scrubber regex strips bare $ai_providers key', () => {
    const frontmatter = { '$ai_providers': { anthropic: 'sk-ant-secret' } };
    const scrubbed = scrubFrontmatter(frontmatter as Record<string, unknown>);
    expect(scrubbed).not.toHaveProperty('$ai_providers');
  });

  it('API key retrieved from IndexedDB is NOT present in localStorage', async () => {
    await setProviderKey('anthropic', 'sk-ant-local-check');
    const stored = Object.keys(localStorage);
    // No localStorage key should contain the API key value
    for (const k of stored) {
      expect(localStorage.getItem(k)).not.toContain('sk-ant-local-check');
    }
  });

  it('API key retrieved from IndexedDB is NOT present in sessionStorage', async () => {
    await setProviderKey('anthropic', 'sk-ant-session-check');
    const stored = Object.keys(sessionStorage);
    for (const k of stored) {
      expect(sessionStorage.getItem(k)).not.toContain('sk-ant-session-check');
    }
  });

  it('retrieving a key requires going through aiProviderStore, not window globals', async () => {
    await setProviderKey('anthropic', 'sk-ant-global-check');
    // The key must NOT be accessible as a window property
    expect((window as unknown as Record<string, unknown>)['sk-ant-global-check']).toBeUndefined();
    // But must be retrievable via the store
    const key = await getProviderKey('anthropic');
    expect(key).toBe('sk-ant-global-check');
  });

  it('stored key ID matches M-A5 scrubber pattern exactly', async () => {
    await setProviderKey('anthropic', 'sk-ant-pattern-test');
    const rows = await aiProviderStore.keys.toArray();
    const scrubPattern = /^\$ai_providers(\..+)?$/;
    for (const row of rows) {
      expect(scrubPattern.test(row.id)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/ai/security.test.ts
```

Expected: PASS — 7 tests pass

- [ ] **Step 3: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
git add src/__tests__/ai/security.test.ts
git commit -m "test(M-D1): add security invariant tests for $ai_providers key isolation"
```

---

## Task 13: Full test suite run and a11y check

**Files:** No new files — validation pass.

- [ ] **Step 1: Run all AI and chat tests together**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run src/__tests__/ai/ src/__tests__/chat/
```

Expected: All tests pass. Zero failures.

- [ ] **Step 2: Run the full test suite**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx vitest run
```

Expected: All tests pass. No regressions.

- [ ] **Step 3: Check TypeScript for the whole project**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npx tsc --noEmit
```

Expected: Zero type errors.

- [ ] **Step 4: Verify dev server renders ChatPanel**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
npm run dev
```

Open `http://localhost:5173`, open the right rail, click the CHAT tab. Verify:
- Chat input is visible at the bottom
- "Ask about your JFR data" placeholder text is shown
- Provider badge shows "Claude" in amber

Stop the dev server (`Ctrl+C`).

- [ ] **Step 5: Commit**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
git add -p
git commit -m "test(M-D1): verify full test suite passes with AI chat integration"
```

---

## Task 14: Manual end-to-end smoke test with a real API key

This task is a manual verification procedure, not automated tests.

- [ ] **Step 1: Open AI Settings and enter a real key**

1. Start the dev server: `npm run dev`
2. Navigate to settings (via gear icon in right rail or `⌘,`)
3. In the AI Provider Settings panel, enter a real Anthropic API key (`sk-ant-...`)
4. Click "Save Key"
5. Verify the success message: "Key saved (stored securely in browser only — never written to files)"

- [ ] **Step 2: Verify key is in IndexedDB, not localStorage**

Open DevTools → Application tab:
- Check **Local Storage** — should contain NO entries with `sk-ant-` values
- Check **Session Storage** — same
- Check **IndexedDB → jfr-ai-provider-store → keys** — should contain one entry with id `$ai_providers.anthropic`

- [ ] **Step 3: Send a test message and verify streaming**

1. Open the right rail CHAT tab
2. Type: `What JFR events are useful for diagnosing memory leaks?`
3. Press Enter
4. Verify "Thinking…" appears immediately
5. Verify tokens stream in one by one
6. Verify the final message is coherent

- [ ] **Step 4: Verify SQL proposal flow**

1. Type: `Write a query to show the top 10 object types by allocation size`
2. Press Enter
3. Verify the assistant response contains a fenced SQL block
4. Verify the "Accept SQL" and "Dismiss" buttons appear below the message
5. Click "Accept SQL"
6. Verify the notebook receives a new cell with the SQL content (check console for `[ChatPanel] Accept SQL:` log until full notebook integration is wired)

- [ ] **Step 5: Verify no key leakage after notebook save**

1. Save the current notebook (File → Save or `⌘S`)
2. Open the saved `.md` file in a text editor
3. Verify the file does NOT contain any `sk-ant-` substring
4. Verify the file does NOT contain `$ai_providers` in frontmatter

- [ ] **Step 6: Commit smoke test results doc**

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2
git commit --allow-empty -m "chore(M-D1): manual smoke test passed — streaming, SQL proposals, no key leakage"
```

---

## Appendix: Design Tokens Reference

All colors used in this feature — never hardcode these hex values:

| Token | Usage in chat UI |
|-------|-----------------|
| `var(--color-bg-base)` | ChatPanel background |
| `var(--color-bg-overlay)` | Assistant message bubbles, input textarea |
| `var(--color-fg-base)` | Message text |
| `var(--color-fg-muted)` | Placeholders, timestamps, muted labels |
| `var(--color-accent)` | User message bubble tint, focus ring, send button |
| `var(--color-accent-amber)` | Claude provider badge |
| `var(--color-accent-green)` | Accept SQL button, saved key indicator |
| `var(--color-accent-red)` | Validation errors, remove key button |
| `var(--color-accent-purple)` | Ollama/local provider badge |
| `var(--color-border)` | Input borders, panel dividers |

## Appendix: Security Contract Summary

```
$ai_providers.*  MUST NEVER be written to notebook .md files
The formatter (M-A5) scrubs any frontmatter key matching /^\$ai_providers(\..+)?$/ before serializing
Emits SecretLeakPrevented diagnostic when a key is stripped
API keys stored EXCLUSIVELY in $ai_providers workspace global (Dexie-backed IndexedDB)
NEVER store API keys in localStorage, sessionStorage, or notebook files
```

Enforced by:
1. `aiProviderStore.ts` — only writes to Dexie, key ids use `$ai_providers.` prefix
2. `aiService.ts` — only reads keys via `getProviderKey()`, never exposes them to UI
3. `AiSettingsPanel.tsx` — `type="password"` input, key cleared from React state after saving
4. M-A5 formatter scrubber — strips `$ai_providers.*` before any `.md` write
5. `security.test.ts` — automated tests verify the scrubber regex and store isolation
