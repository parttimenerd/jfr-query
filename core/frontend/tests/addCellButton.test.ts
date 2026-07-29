// Unit tests for the "Add to Notebook" button helpers. We can't render
// ChatPanel in the node-env vitest setup (no jsdom), so we exercise the
// pure helpers that the button uses. These cover the click-path contract:
// what shows the button, and what args it passes to onAddCellFromAI.

import { describe, it, expect, vi } from 'vitest';
import { shouldShowAddButton, buildAddCellArgs } from '../components/chat/addCellButton';
import type { ChatMessage } from '../types';
import { MessageSender } from '../types';

function makeMsg(over: Partial<ChatMessage> = {}): ChatMessage {
    return {
        id: 'm1',
        sender: MessageSender.AI,
        text: 'Here is your chart.',
        code: 'SELECT 1',
        plotConfig: 'LINE_CHART(x: "t", y: ["v"])',
        isActionable: true,
        ...over,
    };
}

describe('shouldShowAddButton', () => {
    it('returns true when message is actionable with code AND plotConfig', () => {
        expect(shouldShowAddButton(makeMsg())).toBe(true);
    });

    it('returns false when not actionable', () => {
        expect(shouldShowAddButton(makeMsg({ isActionable: false }))).toBe(false);
    });

    it('returns false when code is missing', () => {
        expect(shouldShowAddButton(makeMsg({ code: undefined }))).toBe(false);
        expect(shouldShowAddButton(makeMsg({ code: null }))).toBe(false);
        expect(shouldShowAddButton(makeMsg({ code: '' }))).toBe(false);
    });

    it('returns true when plotConfig is missing (defaults to TABLE())', () => {
        expect(shouldShowAddButton(makeMsg({ plotConfig: undefined }))).toBe(true);
        expect(shouldShowAddButton(makeMsg({ plotConfig: '' }))).toBe(true);
    });
});

describe('buildAddCellArgs', () => {
    it('returns the four-arg tuple for onAddCellFromAI when message is eligible', () => {
        const msg = makeMsg();
        expect(buildAddCellArgs(msg)).toEqual({
            code: 'SELECT 1',
            plotConfig: 'LINE_CHART(x: "t", y: ["v"])',
            title: 'AI Suggested Cell',
            markdownText: 'Here is your chart.',
        });
    });

    it('returns null when the message is not eligible', () => {
        expect(buildAddCellArgs(makeMsg({ isActionable: false }))).toBeNull();
        expect(buildAddCellArgs(makeMsg({ code: undefined }))).toBeNull();
    });

    it('defaults plotConfig to TABLE() when missing or empty', () => {
        expect(buildAddCellArgs(makeMsg({ plotConfig: undefined }))?.plotConfig).toBe('TABLE()');
        expect(buildAddCellArgs(makeMsg({ plotConfig: '' }))?.plotConfig).toBe('TABLE()');
    });

    it('uses the FULL message text as markdownText (not a truncated version)', () => {
        const long = 'x'.repeat(2000);
        const args = buildAddCellArgs(makeMsg({ text: long }));
        expect(args?.markdownText).toBe(long);
    });
});

describe('button click → onAddCellFromAI contract', () => {
    // Simulate what the JSX does on click. Confirms the args are forwarded
    // in the exact order App.addCellFromAI expects:
    //   (sql, plotConfig, title, markdownText)
    it('calls onAddCellFromAI with (code, plotConfig, title, markdownText)', () => {
        const onAddCellFromAI = vi.fn();
        const msg = makeMsg({ text: 'A description.', code: 'SELECT 42', plotConfig: 'BAR_CHART(x: "k", y: ["v"])' });
        const args = buildAddCellArgs(msg)!;
        // Mirror the JSX: onClick={() => onAddCellFromAI(args.code, args.plotConfig, args.title, args.markdownText)}
        onAddCellFromAI(args.code, args.plotConfig, args.title, args.markdownText);
        expect(onAddCellFromAI).toHaveBeenCalledWith(
            'SELECT 42',
            'BAR_CHART(x: "k", y: ["v"])',
            'AI Suggested Cell',
            'A description.',
        );
    });

    it('the button is never wired up when buildAddCellArgs returns null', () => {
        const onAddCellFromAI = vi.fn();
        const msg = makeMsg({ isActionable: false });
        const args = buildAddCellArgs(msg);
        // In JSX: {args && <button onClick={...}>}. With null, no click is wired.
        if (args) onAddCellFromAI(args.code, args.plotConfig, args.title, args.markdownText);
        expect(onAddCellFromAI).not.toHaveBeenCalled();
    });
});
