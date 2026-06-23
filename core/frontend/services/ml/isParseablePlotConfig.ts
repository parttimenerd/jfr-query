import { plotRegistry } from '../../components/plots/plotRegistry';

/**
 * Returns true if the config string is parseable by the existing plotRegistry
 * infrastructure without throwing. Used to validate ML-generated outputs before
 * using them; unparseable output falls through to the heuristic baseline.
 */
export function isParseablePlotConfig(config: string): boolean {
    if (!config || !config.trim()) return false;
    const trimmed = config.trim();

    // Extract function name — must be a known plot type.
    const fnMatch = trimmed.match(/^(\w+)\s*\(/);
    if (!fnMatch) return false;
    const fnName = fnMatch[1].toUpperCase();
    const registration = plotRegistry[fnName];
    if (!registration) return false;

    try {
        // parseConfig is the authoritative parser for each plot type.
        // Pass an empty data array — we only care whether it throws.
        registration.parseConfig(trimmed, []);
        return true;
    } catch {
        return false;
    }
}
