// W4 — Cross-cell brush coupling store.
// W14 — Adds cycle detection, publisher-unmount retention, and clamp-on-refresh.
// W15 — B-139: separate publisherNames map for pre-publish cycle detection.
//
// A pub/sub registry mapping `$brushName` → published domain. Cells with
// `BRUSH "$sel" MODE X` publish; cells with `LINK-X "$sel"` (or LINK-Y/XY)
// subscribe and re-render filtered to the brushed window.

export type BrushMode = 'x' | 'y' | 'xy';

export interface BrushPayload {
    /** Brush variable name including `$` prefix. */
    name: string;
    /** [min, max] of the brushed axis. `null` when the brush is cleared. */
    domain: [number, number] | null;
    /** Which axis (x, y, or both) the publisher brushes on. */
    mode: BrushMode;
    /** The publisher cell's `NAME "..."` alias, or auto-generated id. */
    cellName?: string;
}

type Listener = (payload: BrushPayload) => void;

interface ListenerEntry {
    fn: Listener;
    /** The subscribing cell's NAME alias, used for cycle detection. */
    subscriberCell?: string;
}

/** How long to retain a payload after the publisher unmounts (ms). */
const PUBLISHER_RETENTION_MS = 1000;

class BrushStore {
    private state = new Map<string, BrushPayload>();
    private listeners = new Map<string, Set<ListenerEntry>>();
    /** subscriberCell → set of brush names that cell subscribes to. */
    private subscriberToNames = new Map<string, Set<string>>();
    /**
     * B-139: cellName → set of brush names it publishes.
     * Tracked separately from `state` so cycle detection works even when a
     * subscriber registers before the publisher has called publish() for
     * the first time (pre-publish subscribe).
     */
    private publisherToNames = new Map<string, Set<string>>();
    /** Brush name → the cellName that registered it as a publisher. */
    private nameToPublisher = new Map<string, string>();
    /** Brush names whose publisher has been marked for retention-eviction. */
    private retentionTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** Already-warned cycle pairs (dedupe). */
    private cycleWarned = new Set<string>();

    /** Publish a new brush payload. Subscribers fire synchronously. */
    publish(payload: BrushPayload): void {
        // Cancel any pending eviction — the publisher is alive.
        const t = this.retentionTimers.get(payload.name);
        if (t) {
            clearTimeout(t);
            this.retentionTimers.delete(payload.name);
        }
        // Register in the publisher index so pre-publish subscribers can detect cycles.
        if (payload.cellName) {
            let pubs = this.publisherToNames.get(payload.cellName);
            if (!pubs) {
                pubs = new Set();
                this.publisherToNames.set(payload.cellName, pubs);
            }
            pubs.add(payload.name);
            this.nameToPublisher.set(payload.name, payload.cellName);
        }
        this.state.set(payload.name, payload);
        const subs = this.listeners.get(payload.name);
        if (subs) subs.forEach(entry => entry.fn(payload));
    }

    /** Clear the brush for a name. Notifies subscribers with `domain: null`. */
    clear(name: string, cellName?: string): void {
        const existing = this.state.get(name);
        const payload: BrushPayload = { name, domain: null, mode: existing?.mode ?? 'x', cellName };
        this.state.set(name, payload);
        // Remove from publisher indices so stale entries don't cause false cycle detection.
        const publisherCell = cellName ?? existing?.cellName;
        if (publisherCell) {
            const pubs = this.publisherToNames.get(publisherCell);
            if (pubs) {
                pubs.delete(name);
                if (pubs.size === 0) this.publisherToNames.delete(publisherCell);
            }
        }
        if (this.nameToPublisher.get(name) === publisherCell) {
            this.nameToPublisher.delete(name);
        }
        const subs = this.listeners.get(name);
        if (subs) subs.forEach(entry => entry.fn(payload));
    }

    /** Current payload for a name, or undefined if nothing published. */
    get(name: string): BrushPayload | undefined {
        return this.state.get(name);
    }

    /**
     * Subscribe to a brush name. Returns an unsubscribe function.
     *
     * Pass `subscriberCell` to enable cycle detection: if a cell A publishes `$x`
     * and subscribes to `$y`, and a cell B publishes `$y` and subscribes to `$x`,
     * the second subscription emits a one-shot warning and skips the second
     * subscriber's wake-up (the cycle is broken at the second hop).
     *
     * B-139: cycle detection now uses `publisherToNames` / `nameToPublisher`
     * instead of `state.get(name)` so it works even when subscribe() is called
     * before the publisher has fired its first publish().
     */
    subscribe(name: string, fn: Listener, subscriberCell?: string): () => void {
        if (subscriberCell) {
            // Track what this cell subscribes to.
            let names = this.subscriberToNames.get(subscriberCell);
            if (!names) {
                names = new Set();
                this.subscriberToNames.set(subscriberCell, names);
            }
            names.add(name);

            // Cycle detection: find which cell publishes `name` (if known) and
            // check if THAT cell also subscribes to something WE publish.
            // B-139 fix: use nameToPublisher (populated on publish() or via
            // registerPublisher()) rather than state.get(name)?.cellName, so
            // pre-publish subscriptions are also covered.
            const publisherCell = this.nameToPublisher.get(name) ?? this.state.get(name)?.cellName;
            if (publisherCell && publisherCell !== subscriberCell) {
                const pubSubs = this.subscriberToNames.get(publisherCell);
                const oursPublished = Array.from(this.publisherToNames.get(subscriberCell) ?? []);
                if (pubSubs && oursPublished.some(n => pubSubs.has(n))) {
                    const pairKey = [subscriberCell, publisherCell].sort().join('↔');
                    if (!this.cycleWarned.has(pairKey)) {
                        this.cycleWarned.add(pairKey);
                        console.warn(`[plotBrushStore] cycle detected between cells "${subscriberCell}" and "${publisherCell}"; second subscriber will see initial value only.`);
                    }
                    // Skip live notifications for the second subscriber.
                    return () => {
                        const ns = this.subscriberToNames.get(subscriberCell);
                        if (ns) { ns.delete(name); if (ns.size === 0) this.subscriberToNames.delete(subscriberCell); }
                    };
                }
            }
        }

        let subs = this.listeners.get(name);
        if (!subs) {
            subs = new Set();
            this.listeners.set(name, subs);
        }
        const entry: ListenerEntry = { fn, subscriberCell };
        subs.add(entry);
        // Replay the current stored value so late-subscribing plots (e.g. LINK-Y
        // cells that mount after the publisher has already brushed) see the
        // current domain immediately rather than waiting for the next gesture.
        const current = this.state.get(name);
        if (current) fn(current);
        return () => {
            const s = this.listeners.get(name);
            if (s) {
                s.delete(entry);
                if (s.size === 0) this.listeners.delete(name);
            }
            if (subscriberCell) {
                const ns = this.subscriberToNames.get(subscriberCell);
                if (ns) {
                    ns.delete(name);
                    if (ns.size === 0) this.subscriberToNames.delete(subscriberCell);
                }
            }
        };
    }

    /**
     * Declare that a cell intends to publish a brush name, before the first
     * publish() call. Enables cycle detection for pre-publish subscribers (B-139).
     */
    registerPublisher(name: string, cellName: string): void {
        let pubs = this.publisherToNames.get(cellName);
        if (!pubs) {
            pubs = new Set();
            this.publisherToNames.set(cellName, pubs);
        }
        pubs.add(name);
        this.nameToPublisher.set(name, cellName);
    }

    /**
     * Signal that a publisher cell is unmounting. State is retained for
     * PUBLISHER_RETENTION_MS to bridge re-mounts during re-render. After
     * that window, the payload is evicted and subscribers are notified
     * with a null-domain payload.
     */
    publisherUnmounting(name: string, cellName?: string): void {
        const existing = this.retentionTimers.get(name);
        if (existing) clearTimeout(existing);
        const t = setTimeout(() => {
            this.retentionTimers.delete(name);
            // B-170: read current cellName from state at fire time to avoid stale captured name.
            const currentCellName = this.state.get(name)?.cellName ?? cellName;
            this.clear(name, currentCellName);
        }, PUBLISHER_RETENTION_MS);
        this.retentionTimers.set(name, t);
    }

    /**
     * Clamp the stored brush domain to a new data range. Called when a cell's
     * underlying query refreshes. Returns the action taken.
     *
     * State is updated synchronously so callers see the new value immediately.
     * Subscriber notifications are deferred via queueMicrotask to avoid
     * re-entrant publish calls when a subscriber itself calls clampToRange (B-140).
     */
    clampToRange(name: string, range: [number, number]): 'kept' | 'clamped' | 'cleared' {
        const current = this.state.get(name);
        if (!current || !current.domain) return 'kept';
        const [bMin, bMax] = current.domain;
        const [rMin, rMax] = range;
        if (bMin >= rMin && bMax <= rMax) return 'kept';
        if (bMax < rMin || bMin > rMax) {
            // Update state now, notify later.
            const cleared: BrushPayload = { name, domain: null, mode: current.mode, cellName: current.cellName };
            this.state.set(name, cleared);
            // Capture the subscriber set now so subscribers who join between now
            // and the microtask fire don't receive a double notification.
            const subsAtScheduleTime = this.listeners.get(name) ? new Set(this.listeners.get(name)!) : null;
            queueMicrotask(() => {
                if (subsAtScheduleTime) subsAtScheduleTime.forEach(entry => entry.fn(cleared));
            });
            return 'cleared';
        }
        const newDomain: [number, number] = [Math.max(bMin, rMin), Math.min(bMax, rMax)];
        const clamped: BrushPayload = { ...current, domain: newDomain };
        this.state.set(name, clamped);
        const subsAtScheduleTime2 = this.listeners.get(name) ? new Set(this.listeners.get(name)!) : null;
        queueMicrotask(() => {
            if (subsAtScheduleTime2) subsAtScheduleTime2.forEach(entry => entry.fn(clamped));
        });
        return 'clamped';
    }

    /** Test-only: clear all state and listeners. */
    __reset(): void {
        this.state.clear();
        this.listeners.clear();
        this.subscriberToNames.clear();
        this.publisherToNames.clear();
        this.nameToPublisher.clear();
        this.retentionTimers.forEach(t => clearTimeout(t));
        this.retentionTimers.clear();
        this.cycleWarned.clear();
    }
}

export const plotBrushStore = new BrushStore();
