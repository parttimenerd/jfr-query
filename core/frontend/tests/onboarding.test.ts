// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
// shouldShowOnboarding is exported from App.tsx via re-export; we import from
// the utility module directly to avoid pulling in the full React application
// tree (which breaks the jsdom environment setup).
import { shouldShowOnboarding } from '../utils/onboarding';

// Node 22 has its own experimental `localStorage` global that shadows jsdom's.
// We stub it with a real Map-backed implementation so the function under test
// can call getItem/setItem and we can call clear() between tests.
const store = new Map<string, string>();
const fakeStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
};
vi.stubGlobal('localStorage', fakeStorage);

describe('shouldShowOnboarding', () => {
    beforeEach(() => localStorage.clear());

    it('returns true when there are no cells and no dismiss flag', () => {
        expect(shouldShowOnboarding(0)).toBe(true);
    });

    it('returns false when cells exist', () => {
        expect(shouldShowOnboarding(1)).toBe(false);
    });

    it('returns false after dismissal', () => {
        localStorage.setItem('jfrq:onboarding-dismissed', '1');
        expect(shouldShowOnboarding(0)).toBe(false);
    });
});
