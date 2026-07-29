// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { AiModeCards } from '../components/SettingsModal';

describe('AiModeCards', () => {
    it('renders all three mode labels', () => {
        render(<AiModeCards isAiActive={true} />);
        expect(screen.getByText('Ghost-text')).toBeTruthy();
        expect(screen.getByText('Inline chat')).toBeTruthy();
        expect(screen.getByText('Command palette')).toBeTruthy();
    });

    it('applies muted styling when AI is not active', () => {
        const { container } = render(<AiModeCards isAiActive={false} />);
        expect((container.firstChild as HTMLElement).classList.contains('opacity-50')).toBe(true);
    });

    it('does not apply muted styling when AI is active', () => {
        const { container } = render(<AiModeCards isAiActive={true} />);
        expect((container.firstChild as HTMLElement).classList.contains('opacity-50')).toBe(false);
    });
});
