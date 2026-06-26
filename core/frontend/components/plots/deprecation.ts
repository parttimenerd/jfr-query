// Centralized one-shot deprecation warning for renamed plot params.
// Dedupes by (plotName, legacy) so each pair fires at most once per session.

const warned = new Set<string>();

let suppress = false;
export const setSuppressDeprecationWarnings = (v: boolean) => { suppress = v; };

export function warnDeprecated(plotName: string, legacy: string, canonical: string): void {
    if (suppress) return;
    const key = `${plotName}::${legacy}`;
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[${plotName}] param "${legacy}" is deprecated; use "${canonical}". Auto-migrated for now.`);
}

// Test-only reset hook.
export const __resetDeprecationWarnings = () => { warned.clear(); suppress = false; };
