import { describe, it, expect } from 'vitest';
import {
    buildStatusTooltip,
    buildModeTooltip,
    buildModelTooltip,
} from '../../components/chat/chatStatusTooltip';

// ─── buildStatusTooltip ───────────────────────────────────────────────────────

describe('buildStatusTooltip', () => {
    const base = {
        mode: 'normal' as const,
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
        visibility: 'no-data' as const,
    };

    it('includes mode and its description', () => {
        const tip = buildStatusTooltip(base);
        expect(tip).toContain('/normal');
        expect(tip).toContain('mutations require approval');
    });

    it('includes model and provider when both present', () => {
        const tip = buildStatusTooltip(base);
        expect(tip).toContain('claude-sonnet-4-6');
        expect(tip).toContain('anthropic');
    });

    it('omits parenthesised provider when provider is null', () => {
        const tip = buildStatusTooltip({ ...base, provider: null });
        expect(tip).toContain('claude-sonnet-4-6');
        expect(tip).not.toContain('(');
    });

    it('shows "(no model)" when model is null', () => {
        const tip = buildStatusTooltip({ ...base, model: null });
        expect(tip).toContain('(no model)');
    });

    it('includes visibility and its description', () => {
        const tip = buildStatusTooltip(base);
        expect(tip).toContain('no-data');
        expect(tip).toContain('schema only');
    });

    it('includes /help hint', () => {
        const tip = buildStatusTooltip(base);
        expect(tip).toContain('/help');
    });

    it('each line is on a separate line (newline-delimited)', () => {
        const lines = buildStatusTooltip(base).split('\n');
        expect(lines.length).toBeGreaterThanOrEqual(4);
    });

    it('all four ChatModes produce valid output', () => {
        for (const mode of ['normal', 'plan', 'btw', 'verbose'] as const) {
            const tip = buildStatusTooltip({ ...base, mode });
            expect(tip).toContain(`/${mode}`);
        }
    });

    it('all three VisibilityModes produce valid output', () => {
        for (const visibility of ['no-data', 'sanitized', 'full'] as const) {
            const tip = buildStatusTooltip({ ...base, visibility });
            expect(tip).toContain(visibility);
        }
    });
});

// ─── buildModeTooltip ─────────────────────────────────────────────────────────

describe('buildModeTooltip', () => {
    it('includes the mode slug', () => {
        expect(buildModeTooltip('plan')).toContain('/plan');
    });

    it('includes mode description', () => {
        expect(buildModeTooltip('plan')).toContain('plan');
        expect(buildModeTooltip('btw')).toContain('by the way');
    });

    it('includes switch hint for all modes', () => {
        const tip = buildModeTooltip('normal');
        expect(tip).toContain('/normal');
        expect(tip).toContain('/plan');
        expect(tip).toContain('/btw');
        expect(tip).toContain('/verbose');
    });

    it('is newline-separated', () => {
        expect(buildModeTooltip('normal')).toContain('\n');
    });
});

// ─── buildModelTooltip ────────────────────────────────────────────────────────

describe('buildModelTooltip', () => {
    it('includes model and provider', () => {
        const tip = buildModelTooltip('gpt-4o', 'openai');
        expect(tip).toContain('gpt-4o');
        expect(tip).toContain('openai');
    });

    it('omits parenthesised provider when null', () => {
        const tip = buildModelTooltip('gpt-4o', null);
        expect(tip).toContain('gpt-4o');
        expect(tip).not.toContain('(');
    });

    it('shows "(no model)" when model is null', () => {
        const tip = buildModelTooltip(null, null);
        expect(tip).toContain('(no model)');
    });

    it('includes /model switch hint', () => {
        expect(buildModelTooltip('x', 'y')).toContain('/model');
    });

    it('includes /provider switch hint', () => {
        expect(buildModelTooltip('x', 'y')).toContain('/provider');
    });
});
