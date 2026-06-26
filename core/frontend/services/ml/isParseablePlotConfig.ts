import { plotRegistry } from '../../components/plots/plotRegistry';
import { normalizePlotName } from '../../components/plots/plotNames';

/**
 * Returns true if the config string is parseable by the existing plotRegistry
 * infrastructure without throwing. Used to validate ML-generated outputs before
 * using them; unparseable output falls through to the heuristic baseline.
 */
export function isParseablePlotConfig(config: string): boolean {
    if (!config || !config.trim()) return false;
    const trimmed = config.trim();

    // Extract function name — must be a known plot type (or a short alias).
    const fnMatch = trimmed.match(/^(\w+)\s*\(/);
    if (!fnMatch) return false;
    const fnName = normalizePlotName(fnMatch[1]);
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
