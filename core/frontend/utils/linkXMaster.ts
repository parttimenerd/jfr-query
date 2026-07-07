/**
 * Returns true when the plot should publish its gesture domain to the cross-plot
 * linkX store.
 *
 * - master=true  → explicit master: publish + subscribe
 * - master=false → explicit follower: subscribe only
 * - master=undefined → legacy peer-broadcast: publish + subscribe
 */
export function shouldPublishLinkX(
    linkXPair: [string, string] | undefined,
    master: boolean | undefined,
): boolean {
    if (!linkXPair) return true;
    if (master === false) return false;
    return true;
}
