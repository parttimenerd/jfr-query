import { describe, it, expect } from 'vitest';
import { buildAutocompleteContext } from '../../components/editor/aiAutocomplete/contextBuilder';
import type { SchemaForCompletion } from '../../components/editor/completions';

const emptySchema = (): SchemaForCompletion | null => null;

const sampleSchema = (): SchemaForCompletion => ({
  tables: [
    { name: 'GarbageCollection', columns: [
      { name: 'cause', type: 'VARCHAR' },
      { name: 'duration', type: 'INTERVAL' },
    ] },
  ],
  views: [{ name: 'gc_top_pauses', query: 'SELECT 1', columns: [], internal: false }],
  macros: [],
  tableMap: new Map(),
  viewMap: new Map(),
});

describe('buildAutocompleteContext', () => {
  it('returns just current cell content when no prior cells', () => {
    const built = buildAutocompleteContext({
      mode: 'sql',
      priorCellsContent: [],
      currentCellUpToCursor: 'SELECT * FROM ',
      currentCellAfterCursor: '',
      schema: emptySchema(),
      cellResultSchema: null,
    });
    expect(built.includedPriorCells).toBe(0);
    expect(built.user).toContain('SELECT * FROM ');
    expect(built.user).toContain('<<CURSOR>>');
    expect(built.user).not.toContain('--- cell 1 ---');
  });

  it('includes content from prior cells (cells 0-2) when current is index 3, excludes the cell after', () => {
    const built = buildAutocompleteContext({
      mode: 'sql',
      priorCellsContent: ['cell0-text', 'cell1-text', 'cell2-text'],
      currentCellUpToCursor: 'SELECT 1',
      currentCellAfterCursor: '',
      schema: emptySchema(),
      cellResultSchema: null,
    });
    expect(built.user).toContain('cell0-text');
    expect(built.user).toContain('cell1-text');
    expect(built.user).toContain('cell2-text');
    expect(built.user).not.toContain('cell4-text');
    expect(built.includedPriorCells).toBe(3);
  });

  it('includes schema info when provided', () => {
    const built = buildAutocompleteContext({
      mode: 'sql',
      priorCellsContent: [],
      currentCellUpToCursor: 'SELECT ',
      currentCellAfterCursor: '',
      schema: sampleSchema(),
      cellResultSchema: null,
    });
    expect(built.user).toContain('GarbageCollection');
    expect(built.user).toContain('cause');
    expect(built.user).toContain('duration');
  });

  it('drops oldest prior cells FIFO when total > budgetTokens', () => {
    // Each prior cell ~2000 chars => ~500 tokens. Budget 600 tokens => only the
    // latest one (and the current cell text) should fit.
    const big = (label: string) => label + 'X'.repeat(2000);
    const built = buildAutocompleteContext({
      mode: 'sql',
      priorCellsContent: [big('A_'), big('B_'), big('C_')],
      currentCellUpToCursor: 'SELECT',
      currentCellAfterCursor: '',
      schema: emptySchema(),
      cellResultSchema: null,
      budgetTokens: 600,
    });
    // Oldest dropped first
    expect(built.user).not.toContain('A_X');
    // Newest should still be present (or budget shrank to 0; either way A_ goes first)
    expect(built.includedPriorCells).toBeLessThan(3);
    expect(built.estimatedTokens).toBeLessThanOrEqual(600 + 50); // small slack
  });

  it('uses comment-mode system prompt when inComment is true', () => {
    const built = buildAutocompleteContext({
      mode: 'sql',
      priorCellsContent: [],
      currentCellUpToCursor: '-- explain ',
      currentCellAfterCursor: '',
      schema: emptySchema(),
      cellResultSchema: null,
      inComment: true,
    });
    expect(built.system).toContain('documentation-comment');
  });

  it('uses markdown-mode system prompt when mode is markdown', () => {
    const built = buildAutocompleteContext({
      mode: 'markdown',
      priorCellsContent: [],
      currentCellUpToCursor: '## Header\n\nThis section ',
      currentCellAfterCursor: '',
      schema: emptySchema(),
      cellResultSchema: null,
    });
    expect(built.system).toContain('prose-completion');
  });

  it('includes cell result schema when provided', () => {
    const built = buildAutocompleteContext({
      mode: 'sql',
      priorCellsContent: [],
      currentCellUpToCursor: 'SELECT ',
      currentCellAfterCursor: '',
      schema: emptySchema(),
      cellResultSchema: [
        { name: 'avg_pause', type: 'DOUBLE' },
        { name: 'cause', type: 'VARCHAR' },
      ],
    });
    expect(built.user).toContain('avg_pause');
    expect(built.user).toContain('Current cell result columns');
  });
});
