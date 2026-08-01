import { describe, it, expect } from 'vitest';
import { buildStatusTooltip, buildModeTooltip, buildModelTooltip } from '../components/chat/chatStatusTooltip';

describe('buildStatusTooltip', () => {
    it('mentions the mode and its description for normal', () => {
        const t = buildStatusTooltip({ mode: 'normal', model: 'gpt-4o', provider: 'openai', visibility: 'no-data' });
        expect(t).toContain('Mode: /normal');
        expect(t).toContain('mutations require approval');
    });

    it('mentions plan mode and its description', () => {
        const t = buildStatusTooltip({ mode: 'plan', model: 'claude-sonnet-4-6', provider: 'anthropic', visibility: 'sanitized' });
        expect(t).toContain('/plan');
        expect(t).toContain('do not modify');
    });

    it('mentions btw mode and its description', () => {
        const t = buildStatusTooltip({ mode: 'btw', model: 'm', provider: 'p', visibility: 'full' });
        expect(t).toContain('/btw');
        expect(t).toContain('by the way');
    });

    it('mentions verbose mode and its description', () => {
        const t = buildStatusTooltip({ mode: 'verbose', model: 'm', provider: 'p', visibility: 'full' });
        expect(t).toContain('/verbose');
        expect(t).toContain('full reasoning');
    });

    it('renders the model with the provider in parentheses when both are given', () => {
        const t = buildStatusTooltip({ mode: 'normal', model: 'claude-sonnet-4-6', provider: 'anthropic', visibility: 'no-data' });
        expect(t).toContain('Model: claude-sonnet-4-6 (anthropic)');
    });

    it('renders the model without parens when provider is missing', () => {
        const t = buildStatusTooltip({ mode: 'normal', model: 'm', provider: null, visibility: 'no-data' });
        expect(t).toContain('Model: m');
        expect(t).not.toContain('(null)');
    });

    it('falls back to "(no model)" when model is missing', () => {
        const t = buildStatusTooltip({ mode: 'normal', model: null, provider: 'p', visibility: 'no-data' });
        expect(t).toContain('Model: (no model)');
    });

    it('describes each visibility level', () => {
        const noData   = buildStatusTooltip({ mode: 'normal', model: 'm', provider: 'p', visibility: 'no-data' });
        const sanitized = buildStatusTooltip({ mode: 'normal', model: 'm', provider: 'p', visibility: 'sanitized' });
        const full     = buildStatusTooltip({ mode: 'normal', model: 'm', provider: 'p', visibility: 'full' });
        expect(noData).toContain('schema only');
        expect(sanitized).toContain('redacted');
        expect(full).toContain('full');
    });

    it('always ends with the /help hint', () => {
        const t = buildStatusTooltip({ mode: 'normal', model: 'm', provider: 'p', visibility: 'no-data' });
        expect(t.endsWith('Type /help to see all slash commands.')).toBe(true);
    });

    it('is multi-line (joined by \\n)', () => {
        const t = buildStatusTooltip({ mode: 'normal', model: 'm', provider: 'p', visibility: 'no-data' });
        expect(t.split('\n').length).toBe(4);
    });
});

describe('buildModeTooltip', () => {
    it('describes the mode and mentions how to switch', () => {
        const t = buildModeTooltip('normal');
        expect(t).toContain('/normal');
        expect(t).toContain('mutations require approval');
        expect(t).toContain('/plan');
        expect(t).toContain('/btw');
    });

    it('handles plan and btw', () => {
        expect(buildModeTooltip('plan')).toContain('do not modify');
        expect(buildModeTooltip('btw')).toContain('by the way');
    });

    it('handles verbose mode', () => {
        expect(buildModeTooltip('verbose')).toContain('full reasoning');
        expect(buildModeTooltip('verbose')).toContain('/verbose');
    });
});

describe('buildModelTooltip', () => {
    it('shows model and provider with switch hint', () => {
        const t = buildModelTooltip('claude-sonnet-4-6', 'anthropic');
        expect(t).toContain('claude-sonnet-4-6 (anthropic)');
        expect(t).toContain('/model');
        expect(t).toContain('/provider');
    });

    it('omits provider parens when missing', () => {
        const t = buildModelTooltip('m', null);
        expect(t).toContain('Model: m');
        expect(t).not.toContain('(null)');
    });

    it('falls back to "(no model)" when missing', () => {
        const t = buildModelTooltip(null, 'p');
        expect(t).toContain('(no model)');
    });
});
