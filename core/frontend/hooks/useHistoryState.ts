import { useState, useCallback, useRef, useEffect } from 'react';

const DEBOUNCE_TIME_MS = 800;
// B-043: cap the maximum duration of a single undo session so that long
// uninterrupted typing still produces multiple undo checkpoints.
const MAX_SESSION_MS = 3000;
// B-201: cap the history stack to prevent unbounded localStorage growth.
// Each entry may be a full notebook markdown string (tens of KB). 100 entries
// × 50 KB = 5 MB, which approaches localStorage quotas; 50 entries is safer.
const MAX_HISTORY_SIZE = 50;

type Initializer<T> = () => T;

export const useHistoryState = <T,>(
    initialState: T | Initializer<T>,
    storageKey: string
): [T, (value: T) => void, () => void, () => void, boolean, boolean, () => void, (value: T) => void] => {
    
    const [state, _setState] = useState(() => {
        try {
            const storedItem = localStorage.getItem(storageKey);
            if (storedItem) {
                const parsed = JSON.parse(storedItem);
                // Saved value is the current content (string or object), wrap in history stack.
                // Guard against accidentally loading a stale history-object format.
                if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.history) && parsed.history.length > 0) {
                    const idx = Math.min(Math.max(parsed.currentIndex ?? 0, 0), parsed.history.length - 1);
                    const entry = parsed.history[idx];
                    if (entry !== undefined) return { history: [entry], currentIndex: 0 };
                }
                return { history: [parsed], currentIndex: 0 };
            }
        } catch (error) {
            console.warn(`Could not load history state from localStorage for key "${storageKey}"`, error);
        }
        const s = typeof initialState === 'function' ? (initialState as Function)() : initialState;
        return { history: [s], currentIndex: 0 };
    });
    
    const debounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isDebouncing = useRef(false);
    const sessionStartTime = useRef<number>(0);

    useEffect(() => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(state.history[state.currentIndex]));
        } catch (error) {
            console.warn(`Could not save history state to localStorage for key "${storageKey}"`, error);
        }
    }, [state, storageKey]);

    useEffect(() => {
        return () => {
            if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
        };
    }, []);

    const setState = useCallback((value: T) => {
        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
        }

        // B-043: force a new history entry if the current session has been running
        // longer than MAX_SESSION_MS, even if keystrokes are still continuous.
        const now = Date.now();
        const sessionExpired = isDebouncing.current && (now - sessionStartTime.current) >= MAX_SESSION_MS;
        // Capture the decision before _setState so the updater sees the right value;
        // line 98 sets isDebouncing.current = true synchronously before React runs
        // the updater, so reading the ref inside the updater would always see true.
        const createNewEntry = sessionExpired || !isDebouncing.current;
        if (sessionExpired) {
            isDebouncing.current = false;
        }

        _setState(prevState => {
            // If we're in a debouncing session, modify the current history entry
            // (not necessarily the last one — user may have undone before typing).
            if (!createNewEntry) {
                const newHistory = [...prevState.history];
                newHistory[prevState.currentIndex] = value;
                return { ...prevState, history: newHistory };
            }

            // Otherwise, it's a new action. Create a new history entry.
            // This also handles creating a new branch after an undo.
            const newHistory = prevState.history.slice(0, prevState.currentIndex + 1);

            // Don't add a new history state if the value is the same as the last one.
            if (newHistory.length > 0 && JSON.stringify(newHistory[newHistory.length - 1]) === JSON.stringify(value)) {
                return prevState;
            }

            newHistory.push(value);
            // B-201: evict from the front to keep the stack bounded.
            while (newHistory.length > MAX_HISTORY_SIZE) newHistory.shift();
            return {
                history: newHistory,
                currentIndex: newHistory.length - 1
            };
        });

        if (!isDebouncing.current) {
            sessionStartTime.current = now;
        }
        isDebouncing.current = true;
        debounceTimeout.current = setTimeout(() => {
            isDebouncing.current = false;
        }, DEBOUNCE_TIME_MS);
    }, []);

    const undo = useCallback(() => {
        isDebouncing.current = false;
        if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
        _setState(prevState => ({
            ...prevState,
            currentIndex: Math.max(0, prevState.currentIndex - 1)
        }));
    }, []);
    
    const redo = useCallback(() => {
        isDebouncing.current = false;
        if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
        _setState(prevState => ({
            ...prevState,
            currentIndex: Math.min(prevState.history.length - 1, prevState.currentIndex + 1)
        }));
    }, []);

    // Close the current debounce window so the *next* setState lands in a new
    // history entry. Call this just before applying an AI tool mutation so each
    // tool call becomes its own undo step instead of being merged with the
    // previous one inside the 800ms window.
    const flushHistory = useCallback(() => {
        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
            debounceTimeout.current = null;
        }
        isDebouncing.current = false;
    }, []);

    const resetHistory = useCallback((value: T) => {
        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
            debounceTimeout.current = null;
        }
        isDebouncing.current = false;
        _setState({ history: [value], currentIndex: 0 });
    }, []);

    const currentState = state.history[state.currentIndex];
    const canUndo = state.currentIndex > 0;
    const canRedo = state.currentIndex < state.history.length - 1;

    return [currentState, setState, undo, redo, canUndo, canRedo, flushHistory, resetHistory];
};
