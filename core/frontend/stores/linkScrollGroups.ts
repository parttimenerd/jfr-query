/**
 * Simple scroll-group synchronization store.
 * Plots in the same LINK_SCROLL group share their scroll position.
 * Uses rAF + 16ms debounce to avoid feedback loops.
 */

type ScrollPosition = { top: number; left: number };
type ScrollCallback = (pos: ScrollPosition) => void;

interface GroupEntry {
    subscribers: Map<string, ScrollCallback>;
    last: ScrollPosition;
    rafId: number | null;
    pending: ScrollPosition | null;
    /** Per-group debounce timer (B-172: was incorrectly module-level). */
    debounceTimer: ReturnType<typeof setTimeout> | null;
}

const groups = new Map<string, GroupEntry>();

function getOrCreateGroup(group: string): GroupEntry {
    if (!groups.has(group)) {
        groups.set(group, {
            subscribers: new Map(),
            last: { top: 0, left: 0 },
            rafId: null,
            pending: null,
            debounceTimer: null,
        });
    }
    return groups.get(group)!;
}

/**
 * Subscribe a plot element to a scroll group.
 * Returns an unsubscribe function.
 */
export function subscribeScrollGroup(
    group: string,
    id: string,
    callback: ScrollCallback,
): () => void {
    const entry = getOrCreateGroup(group);
    entry.subscribers.set(id, callback);
    return () => {
        entry.subscribers.delete(id);
        if (entry.subscribers.size === 0) {
            if (entry.debounceTimer !== null) clearTimeout(entry.debounceTimer);
            if (entry.rafId !== null) cancelAnimationFrame(entry.rafId);
            groups.delete(group);
        }
    };
}

/**
 * Broadcast a scroll position to all other members of a group.
 * Debounced at 16ms (one frame) and runs in a rAF to stay smooth.
 * The source id is excluded to prevent feedback loops.
 */
export function broadcastScrollPosition(
    group: string,
    sourceId: string,
    pos: ScrollPosition,
): void {
    const entry = groups.get(group);
    if (!entry) return;

    // Update pending position
    entry.pending = pos;

    // Cancel prior rAF if any
    if (entry.rafId !== null) cancelAnimationFrame(entry.rafId);

    if (entry.debounceTimer !== null) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = null;
        entry.rafId = requestAnimationFrame(() => {
            entry.rafId = null;
            if (!entry.pending) return;
            const p = entry.pending;
            entry.pending = null;
            entry.last = p;
            for (const [id, cb] of entry.subscribers) {
                if (id !== sourceId) cb(p);
            }
        });
    }, 16);
}
