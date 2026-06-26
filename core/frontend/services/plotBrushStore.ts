// W4 — Cross-cell brush coupling store.
// W14 — Adds cycle detection, publisher-unmount retention, and clamp-on-refresh.
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
        this.state.set(payload.name, payload);
        const subs = this.listeners.get(payload.name);
        if (subs) subs.forEach(entry => entry.fn(payload));
    }

    /** Clear the brush for a name. Notifies subscribers with `domain: null`. */
    clear(name: string, cellName?: string): void {
        const payload: BrushPayload = { name, domain: null, mode: 'x', cellName };
        this.state.set(name, payload);
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

            // Cycle detection: is there a publisher P that wrote `name` whose
            // own cell ALSO subscribes to a brush WE publish?
            const publisher = this.state.get(name);
            if (publisher?.cellName && publisher.cellName !== subscriberCell) {
                const pubSubs = this.subscriberToNames.get(publisher.cellName);
                const oursPublished = Array.from(this.state.values()).filter(p => p.cellName === subscriberCell).map(p => p.name);
                if (pubSubs && oursPublished.some(n => pubSubs.has(n))) {
                    const pairKey = [subscriberCell, publisher.cellName].sort().join('↔');
                    if (!this.cycleWarned.has(pairKey)) {
                        this.cycleWarned.add(pairKey);
                        console.warn(`[plotBrushStore] cycle detected between cells "${subscriberCell}" and "${publisher.cellName}"; second subscriber will see initial value only.`);
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
            this.clear(name, cellName);
        }, PUBLISHER_RETENTION_MS);
        this.retentionTimers.set(name, t);
    }

    /**
     * Clamp the stored brush domain to a new data range. Called when a cell's
     * underlying query refreshes. Returns the action taken.
     */
    clampToRange(name: string, range: [number, number]): 'kept' | 'clamped' | 'cleared' {
        const current = this.state.get(name);
        if (!current || !current.domain) return 'kept';
        const [bMin, bMax] = current.domain;
        const [rMin, rMax] = range;
        if (bMin >= rMin && bMax <= rMax) return 'kept';
        if (bMax < rMin || bMin > rMax) {
            this.clear(name, current.cellName);
            return 'cleared';
        }
        const newDomain: [number, number] = [Math.max(bMin, rMin), Math.min(bMax, rMax)];
        this.publish({ ...current, domain: newDomain });
        return 'clamped';
    }

    /** Test-only: clear all state and listeners. */
    __reset(): void {
        this.state.clear();
        this.listeners.clear();
        this.subscriberToNames.clear();
        this.retentionTimers.forEach(t => clearTimeout(t));
        this.retentionTimers.clear();
        this.cycleWarned.clear();
    }
}

export const plotBrushStore = new BrushStore();
