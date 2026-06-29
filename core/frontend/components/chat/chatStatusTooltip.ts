// Builds the hover tooltip for the compact `/mode · model` status line in
// the chat header. Kept pure so it can be unit-tested without rendering.

import type { ChatMode } from '../../services/ai/chatModes';
import type { VisibilityMode } from '../../services/AiService';

interface StatusTooltipInput {
    mode: ChatMode;
    model: string | null | undefined;
    provider: string | null | undefined;
    visibility: VisibilityMode;
}

const MODE_DESCRIPTIONS: Record<ChatMode, string> = {
    normal: 'chat normally, mutations require approval',
    plan:   'propose a structured plan; do not modify the notebook',
    btw:    'normal chat plus "by the way" suggestion cards',
};

const VISIBILITY_DESCRIPTIONS: Record<VisibilityMode, string> = {
    'no-data':   'AI sees schema only — no rows',
    'sanitized': 'AI sees recent rows with string values redacted',
    'full':      'AI sees recent rows in full',
};

export function buildStatusTooltip(input: StatusTooltipInput): string {
    const { mode, model, provider, visibility } = input;
    const lines: string[] = [];
    lines.push(`Mode: /${mode} — ${MODE_DESCRIPTIONS[mode]}`);
    const modelLabel = model || '(no model)';
    lines.push(provider ? `Model: ${modelLabel} (${provider})` : `Model: ${modelLabel}`);
    lines.push(`Visibility: ${visibility} — ${VISIBILITY_DESCRIPTIONS[visibility]}`);
    lines.push('Type /help to see all slash commands.');
    return lines.join('\n');
}

/** Per-chip tooltip for the mode segment (e.g. `/normal`). */
export function buildModeTooltip(mode: ChatMode): string {
    return `Mode: /${mode} — ${MODE_DESCRIPTIONS[mode]}\nSwitch with /normal, /plan, or /btw.`;
}

/** Per-chip tooltip for the model segment (e.g. `claude-sonnet-4-6`). */
export function buildModelTooltip(model: string | null | undefined, provider: string | null | undefined): string {
    const modelLabel = model || '(no model)';
    const head = provider ? `Model: ${modelLabel} (${provider})` : `Model: ${modelLabel}`;
    return `${head}\nSwitch with /model <name> or /provider <name>.`;
}
