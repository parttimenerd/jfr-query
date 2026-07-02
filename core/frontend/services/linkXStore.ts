/**
 * linkXStore — zero-React pub/sub for LINK_X zoom domains.
 *
 * During active gestures (scroll, drag) plots publish their current domain
 * here. All other plots subscribed to the same key read updates and re-render
 * via a single local useState call — no metadata.variables writes, no
 * cross-cell React re-renders.
 *
 * On gesture commit (pointer-up / scroll idle) the InteractivePlotWrapper
 * flushes the final domain once to metadata.variables so SQL cells that
 * reference $start/$end auto-rerun.
 */

type Domain = [number, number] | null;
type Listener = (domain: Domain) => void;

class LinkXStore {
    private domains = new Map<string, Domain>();
    private listeners = new Map<string, Set<Listener>>();

    /** Key from a [minVar, maxVar] pair — order-stable. */
    key(linkX: [string, string]): string {
        return `${linkX[0]}::${linkX[1]}`;
    }

    /** Publish a new domain for a variable pair. Notifies all subscribers immediately. */
    publish(linkX: [string, string], domain: Domain): void {
        const k = this.key(linkX);
        this.domains.set(k, domain);
        const set = this.listeners.get(k);
        if (set) set.forEach(fn => fn(domain));
    }

    /** Subscribe to domain changes for a variable pair. Returns unsubscribe fn. */
    subscribe(linkX: [string, string], fn: Listener): () => void {
        const k = this.key(linkX);
        if (!this.listeners.has(k)) this.listeners.set(k, new Set());
        this.listeners.get(k)!.add(fn);
        // Send current value immediately so late subscribers catch up.
        fn(this.domains.get(k) ?? null);
        return () => this.listeners.get(k)?.delete(fn);
    }

    get(linkX: [string, string]): Domain {
        return this.domains.get(this.key(linkX)) ?? null;
    }
}

export const linkXStore = new LinkXStore();
