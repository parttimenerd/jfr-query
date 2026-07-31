import { describe, it, expect } from 'vitest';
import { routeMessage } from '../../services/ai/routing';
import type { Tool } from '../../services/ai/tools';

const readTool: Tool = { name: 'query_data', kind: 'read', description: '', inputSchema: { type: 'object' } };
const mutateTool: Tool = { name: 'add_cell', kind: 'mutate', description: '', inputSchema: { type: 'object' } };

describe('routeMessage', () => {
    it('returns local for short message with no tools and no full visibility', () => {
        expect(routeMessage('what is avg gc pause?', [], 'no-data')).toBe('local');
    });

    it('returns local for sanitized visibility with short message', () => {
        expect(routeMessage('show heap usage', [], 'sanitized')).toBe('local');
    });

    it('returns cloud when visibility is full', () => {
        expect(routeMessage('show heap usage', [], 'full')).toBe('cloud');
    });

    it('returns cloud when message is longer than 200 chars', () => {
        const long = 'x'.repeat(201);
        expect(routeMessage(long, [], 'no-data')).toBe('cloud');
    });

    it('returns cloud when a mutate tool is in the list', () => {
        expect(routeMessage('add a cell', [mutateTool], 'no-data')).toBe('cloud');
    });

    it('returns local when only read tools present', () => {
        expect(routeMessage('top methods', [readTool], 'no-data')).toBe('local');
    });

    it('user override "local" always returns local regardless of rules', () => {
        expect(routeMessage('x'.repeat(300), [mutateTool], 'full', 'local')).toBe('local');
    });

    it('user override "cloud" always returns cloud', () => {
        expect(routeMessage('hi', [], 'no-data', 'cloud')).toBe('cloud');
    });

    it('user override "auto" respects normal rules', () => {
        expect(routeMessage('hi', [], 'no-data', 'auto')).toBe('local');
        expect(routeMessage('hi', [], 'full', 'auto')).toBe('cloud');
    });
});
