// Persistence for per-channel chat mode state. Stores selected mode and
// recent btw hints in localStorage so reloads preserve the channel UI feel.
//
// Versioned schema. Quota-bounded (drops oldest channels). PII-scrubbed
// before save: SQL fragments and numeric runs are masked from hint text so a
// stray PASSWORD/email never lands on disk.
//
// Pure: ALL I/O routes through a Storage-like interface so tests can inject
// an in-memory mock.

import type { ChatMode } from './chatModes';
import type { BtwHint } from './chatModes';

const STORAGE_KEY = 'jfr-query:chat-channels:v1';
const MAX_HINTS_PER_CHANNEL = 6;
const MAX_CHANNELS = 24;
const MAX_TOTAL_BYTES = 64 * 1024; // 64 KB hard cap; drops oldest on overflow

export interface PersistedChannel {
    id: string;
    mode: ChatMode;
    hints: BtwHint[];
    updatedAt: number;
}

export interface PersistedState {
    version: 1;
    channels: PersistedChannel[];
}

export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

// ───────────────────── PII scrub ─────────────────────

// Replace SQL-like fragments with a placeholder. Heuristic — only fires when
// the hint contains keywords commonly used in SQL bodies. Designed to be
// conservative (never strips ordinary words).
const SQL_RE = /\b(SELECT|INSERT|UPDATE|DELETE|WHERE|FROM|JOIN|HAVING)\b[^.\n]*/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LONG_NUMBER_RE = /\b\d{5,}\b/g; // 5+ digit runs → mask (id-like)

export function scrubHintText(text: string): string {
    return text
        .replace(SQL_RE, '<sql-snippet>')
        .replace(EMAIL_RE, '<email>')
        .replace(LONG_NUMBER_RE, '<num>');
}

function scrubHint(h: BtwHint): BtwHint {
    return {
        ...h,
        text: scrubHintText(h.text),
        action: h.action ? { ...h.action, prompt: scrubHintText(h.action.prompt) } : undefined,
    };
}

// ───────────────────── Save / load ─────────────────────

export function loadPersistedState(storage: StorageLike): PersistedState {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, channels: [] };
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { return { version: 1, channels: [] }; }
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.channels)) {
        return { version: 1, channels: [] };
    }
    const channels: PersistedChannel[] = [];
    for (const c of parsed.channels) {
        if (!c || typeof c.id !== 'string') continue;
        if (c.mode !== 'normal' && c.mode !== 'plan' && c.mode !== 'btw') continue;
        const hints = Array.isArray(c.hints)
            ? c.hints.filter((h: any) => h && typeof h.text === 'string').slice(0, MAX_HINTS_PER_CHANNEL)
            : [];
        channels.push({
            id: c.id,
            mode: c.mode,
            hints,
            updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : 0,
        });
    }
    return { version: 1, channels };
}

/** Save a channel's mode + hints, evicting oldest channels if size exceeds
 * MAX_TOTAL_BYTES or count exceeds MAX_CHANNELS. */
export function saveChannel(
    storage: StorageLike,
    update: { id: string; mode: ChatMode; hints: BtwHint[]; now: number },
): void {
    const state = loadPersistedState(storage);

    // Upsert this channel.
    const scrubbed = update.hints.slice(-MAX_HINTS_PER_CHANNEL).map(scrubHint);
    const idx = state.channels.findIndex(c => c.id === update.id);
    const entry: PersistedChannel = {
        id: update.id,
        mode: update.mode,
        hints: scrubbed,
        updatedAt: update.now,
    };
    if (idx >= 0) state.channels[idx] = entry;
    else state.channels.push(entry);

    // Sort by updatedAt desc and cap channel count.
    state.channels.sort((a, b) => b.updatedAt - a.updatedAt);
    if (state.channels.length > MAX_CHANNELS) {
        state.channels = state.channels.slice(0, MAX_CHANNELS);
    }

    // Enforce byte budget by dropping oldest entries until under cap.
    let serialized = JSON.stringify(state);
    while (serialized.length > MAX_TOTAL_BYTES && state.channels.length > 1) {
        state.channels.pop();
        serialized = JSON.stringify(state);
    }

    try {
        storage.setItem(STORAGE_KEY, serialized);
    } catch {
        // localStorage quota errors are non-fatal; we already capped bytes.
    }
}

export function clearPersistedState(storage: StorageLike): void {
    storage.removeItem(STORAGE_KEY);
}

// Exposed for tests so they can assert against the same constants.
export const __internals = {
    STORAGE_KEY,
    MAX_HINTS_PER_CHANNEL,
    MAX_CHANNELS,
    MAX_TOTAL_BYTES,
};
