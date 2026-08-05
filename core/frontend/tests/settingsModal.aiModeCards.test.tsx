// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { AiModeCards } from '../components/SettingsModal';

afterEach(cleanup);

describe('AiModeCards', () => {
    it('renders all three mode labels', () => {
        render(<AiModeCards isAiActive={true} />);
        screen.getByText('Ghost-text');
        screen.getByText('Inline chat');
        screen.getByText('Command palette');
    });

    it('applies muted styling when AI is not active', () => {
        const { container } = render(<AiModeCards isAiActive={false} />);
        expect((container.firstChild as HTMLElement).classList.contains('opacity-50')).toBe(true);
    });

    it('does not apply muted styling when AI is active', () => {
        const { container } = render(<AiModeCards isAiActive={true} />);
        expect((container.firstChild as HTMLElement).classList.contains('opacity-50')).toBe(false);
    });

    it('renders shortcut and description text', () => {
        render(<AiModeCards isAiActive={true} />);
        // Verify at least one shortcut and description are present
        screen.getByText('Tab to accept');
        screen.getByText('⌘K / Ctrl+K');
    });
});
