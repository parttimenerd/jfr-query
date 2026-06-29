// Helpers for chat channel labels. Channels in ChatPanel start with an
// auto-default label ("Main" or "Channel 2", ...) which we replace with an
// AI-generated summary after the first user message. Users can also
// double-click to rename a channel manually.

const MAX_TITLE = 40;

/**
 * Clean up an AI-generated title: strip quotes/leading-trailing punctuation,
 * collapse whitespace, cap length. Returns null if nothing usable remains.
 */
export function normalizeChannelTitle(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let s = raw.trim();
    // Strip surrounding quotes of common flavors (", ', `, “”, ‘’)
    s = s.replace(/^[\s"'`“”‘’]+|[\s"'`“”‘’]+$/g, '');
    // If the model returned multiple lines, only keep the first non-empty one.
    const firstLine = s.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
    s = firstLine;
    // Trim trailing punctuation (periods, semicolons).
    s = s.replace(/[.;:!?\s]+$/g, '').trim();
    if (!s) return null;
    if (s.length > MAX_TITLE) s = s.slice(0, MAX_TITLE).trim();
    return s || null;
}

/**
 * Is this label one we generated automatically? Used to decide whether to
 * overwrite with the AI summary — we only replace auto-defaults, never the
 * user's manual rename.
 *
 * Pattern: "Main" (the very first channel) or "Channel N" for N >= 2.
 */
export function isAutoChannelLabel(label: string): boolean {
    if (!label) return false;
    return /^(Main|Channel \d+)$/.test(label.trim());
}
