import type { Tool } from './tools';

export type RouteTarget = 'local' | 'cloud' | 'browser';
export type RoutingPreference = 'auto' | 'local' | 'cloud' | 'browser';
export type VisibilityMode = 'no-data' | 'sanitized' | 'full';

/**
 * Decide whether to use the local, cloud, or browser provider for a chat message.
 * Browser route is used when explicitly requested or when no other providers are configured.
 * Local is used when the message is short, no mutate tools are needed,
 * and data visibility is not 'full'. User override takes precedence.
 */
export function routeMessage(
    message: string,
    tools: Tool[],
    visibility: VisibilityMode,
    userPreference: RoutingPreference = 'auto',
    hasLocalModel = true,
    hasCloudModel = true,
    hasBrowserModel = false,
): RouteTarget {
    if (userPreference === 'browser') return 'browser';
    if (userPreference === 'local') return 'local';
    if (userPreference === 'cloud') return 'cloud';

    // auto routing rules
    if (!hasLocalModel && !hasCloudModel && hasBrowserModel) return 'browser';
    if (visibility === 'full') return 'cloud';
    if (tools.some(t => t.kind === 'mutate')) return 'cloud';
    if (message.length > 200) return 'cloud';
    return 'local';
}
