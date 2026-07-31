import type { Tool } from './tools';

export type RouteTarget = 'local' | 'cloud';
export type RoutingPreference = 'auto' | 'local' | 'cloud';
export type VisibilityMode = 'no-data' | 'sanitized' | 'full';

/**
 * Decide whether to use the local or cloud provider for a chat message.
 * Local is used when the message is short, no mutate tools are needed,
 * and data visibility is not 'full'. User override takes precedence.
 */
export function routeMessage(
    message: string,
    tools: Tool[],
    visibility: VisibilityMode,
    userPreference: RoutingPreference = 'auto',
): RouteTarget {
    if (userPreference === 'local') return 'local';
    if (userPreference === 'cloud') return 'cloud';

    // auto routing rules
    if (visibility === 'full') return 'cloud';
    if (tools.some(t => t.kind === 'mutate')) return 'cloud';
    if (message.length > 200) return 'cloud';
    return 'local';
}
