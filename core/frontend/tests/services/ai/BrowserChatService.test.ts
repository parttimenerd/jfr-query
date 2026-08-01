import { describe, it, expect } from 'vitest';
import {
    BROWSER_CHAT_MODELS,
    DEFAULT_BROWSER_CHAT_MODEL_ID,
    getBrowserChatLoadProgress,
    isBrowserChatReady,
} from '../../../services/ai/BrowserChatService';

// ── BROWSER_CHAT_MODELS registry ──────────────────────────────────────────────

describe('BROWSER_CHAT_MODELS', () => {
    it('is a non-empty record', () => {
        expect(Object.keys(BROWSER_CHAT_MODELS).length).toBeGreaterThan(0);
    });

    it('every entry has required fields', () => {
        for (const [key, info] of Object.entries(BROWSER_CHAT_MODELS)) {
            expect(typeof info.id).toBe('string');
            expect(info.id.length).toBeGreaterThan(0);
            expect(typeof info.repo).toBe('string');
            expect(info.repo.length).toBeGreaterThan(0);
            expect(typeof info.dtype).toBe('string');
            expect(typeof info.approxSizeMb).toBe('number');
            expect(info.approxSizeMb).toBeGreaterThan(0);
            expect(typeof info.label).toBe('string');
            expect(info.label.length).toBeGreaterThan(0);
        }
    });

    it('key matches entry id', () => {
        for (const [key, info] of Object.entries(BROWSER_CHAT_MODELS)) {
            expect(info.id).toBe(key);
        }
    });

    it('contains the default model ID', () => {
        expect(BROWSER_CHAT_MODELS).toHaveProperty(DEFAULT_BROWSER_CHAT_MODEL_ID);
    });

    it('repo values look like HuggingFace org/model paths', () => {
        for (const info of Object.values(BROWSER_CHAT_MODELS)) {
            expect(info.repo).toContain('/');
        }
    });
});

// ── DEFAULT_BROWSER_CHAT_MODEL_ID ─────────────────────────────────────────────

describe('DEFAULT_BROWSER_CHAT_MODEL_ID', () => {
    it('is a non-empty string', () => {
        expect(typeof DEFAULT_BROWSER_CHAT_MODEL_ID).toBe('string');
        expect(DEFAULT_BROWSER_CHAT_MODEL_ID.length).toBeGreaterThan(0);
    });

    it('exists in BROWSER_CHAT_MODELS', () => {
        expect(BROWSER_CHAT_MODELS[DEFAULT_BROWSER_CHAT_MODEL_ID]).toBeDefined();
    });
});

// ── initial state accessors ───────────────────────────────────────────────────

describe('getBrowserChatLoadProgress', () => {
    it('returns 0 before any model is loaded', () => {
        expect(getBrowserChatLoadProgress()).toBe(0);
    });
});

describe('isBrowserChatReady', () => {
    it('returns false before any model is loaded', () => {
        expect(isBrowserChatReady()).toBe(false);
    });
});
