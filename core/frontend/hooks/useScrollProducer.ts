import { useEffect, useRef, useCallback } from 'react';
import type React from 'react';
import { subscribeScrollGroup, broadcastScrollPosition } from '../stores/linkScrollGroups';

/**
 * Hook that synchronizes scroll position for a LINK_SCROLL group.
 *
 * Pass the returned `ref` to the scrollable container element.
 * When this element scrolls, other members of the group are notified.
 * When another member scrolls, this element is scrolled to match.
 *
 * @param group  The LINK_SCROLL group name (from the `| link-scroll: groupName` clause).
 *               Pass null/undefined to disable the hook.
 */
export function useScrollProducer(group: string | null | undefined): React.RefObject<HTMLElement | null> {
    // Unique stable ID for this subscriber instance
    const idRef = useRef(`scroll-${Math.random().toString(36).slice(2)}`);
    const containerRef = useRef<HTMLElement | null>(null);
    // Guard against re-entrancy when we programmatically set scrollTop/Left
    const isSyncing = useRef(false);

    const handleIncoming = useCallback((pos: { top: number; left: number }) => {
        const el = containerRef.current;
        if (!el) return;
        isSyncing.current = true;
        el.scrollTop = pos.top;
        el.scrollLeft = pos.left;
        // Reset after the scroll event has had a chance to fire (it is async).
        // Must be setTimeout, not a microtask — Firefox fires programmatic scroll events
        // as macrotasks, so a microtask would clear the guard before the event arrives.
        setTimeout(() => { isSyncing.current = false; }, 0);
    }, []);

    useEffect(() => {
        if (!group) return;
        const el = containerRef.current;
        if (!el) return;  // no element to attach to — skip entirely
        const id = idRef.current;
        const unsub = subscribeScrollGroup(group, id, handleIncoming);

        const handleScroll = () => {
            if (isSyncing.current) return;
            broadcastScrollPosition(group, id, {
                top: el.scrollTop,
                left: el.scrollLeft,
            });
        };

        el.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            el.removeEventListener('scroll', handleScroll);
            unsub();
        };
    }, [group, handleIncoming]);

    return containerRef as React.RefObject<HTMLElement | null>;
}
