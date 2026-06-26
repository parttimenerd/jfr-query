import { describe, it, expect } from 'vitest';
import { collectPrecedingCellVariables } from '../utils/crossCellVariables';
import type { NotebookCellData } from '../types';

function cell(id: string, title: string, vars: Record<string, string> = {}): NotebookCellData {
    const lines = Object.entries(vars).map(([k, v]) => `${k} = ${v}`).join('\n');
    const content = `## ${title}\n\n\`\`\`variables\n${lines}\n\`\`\`\n`;
    return { id, title, content };
}

describe('collectPrecedingCellVariables', () => {
    it('returns empty map when current cell is first', () => {
        const cells = [cell('a', 'First', { '$foo': '1' })];
        expect(collectPrecedingCellVariables(cells, 'a')).toEqual({});
    });

    it('flattens preceding cells with $cellTitle.varName keys', () => {
        const cells = [
            cell('a', 'Alpha', { '$foo': '1', '$bar': 'hello' }),
            cell('b', 'Beta', { '$baz': '2' }),
            cell('c', 'Current', {}),
        ];
        const out = collectPrecedingCellVariables(cells, 'c');
        expect(out['$Alpha.foo']).toBe('1');
        expect(out['$Alpha.bar']).toBe('hello');
        expect(out['$Beta.baz']).toBe('2');
    });

    it('stops at the current cell and does NOT include its own variables', () => {
        const cells = [
            cell('a', 'Alpha', { '$foo': '1' }),
            cell('b', 'Current', { '$shouldNotAppear': 'x' }),
            cell('c', 'After', { '$alsoNot': 'y' }),
        ];
        const out = collectPrecedingCellVariables(cells, 'b');
        expect(out['$Alpha.foo']).toBe('1');
        expect(out).not.toHaveProperty('$Current.shouldNotAppear');
        expect(out).not.toHaveProperty('$After.alsoNot');
    });

    it('skips cells without a title (cross-cell refs need a name)', () => {
        const cells: NotebookCellData[] = [
            { id: 'a', title: '', content: '```variables\n$orphan = 1\n```' },
            cell('b', 'Current', {}),
        ];
        const out = collectPrecedingCellVariables(cells, 'b');
        expect(out).toEqual({});
    });

    it('handles cells whose parsed.variables already drop the $ prefix', () => {
        // Defense-in-depth: if some upstream variant stores keys without $,
        // we still emit the same `$Title.name` shape.
        const c: NotebookCellData = {
            id: 'a',
            title: 'Alpha',
            content: '## Alpha\n\n```variables\n$foo = 1\n```',
        };
        const out = collectPrecedingCellVariables([c, cell('b', 'Current')], 'b');
        expect(out['$Alpha.foo']).toBe('1');
        expect(out).not.toHaveProperty('$Alpha.$foo');
    });
});
