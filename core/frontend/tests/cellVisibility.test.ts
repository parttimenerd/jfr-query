import { describe, it, expect, vi } from 'vitest';
import { resolveCellVisibility } from '../utils/cellVisibility';

describe('resolveCellVisibility', () => {
  it('returns true for cells with no condition', async () => {
    const q = vi.fn();
    const r = await resolveCellVisibility('some_cell', undefined, {}, q);
    expect(r).toBe(true);
    expect(q).not.toHaveBeenCalled();
  });

  it('substitutes variables before running the predicate', async () => {
    const q = vi.fn().mockResolvedValue([{ v: 1 }]);
    await resolveCellVisibility(
      'c1',
      { c1: 'SELECT 1 WHERE ${threshold} > 0' },
      { threshold: '5' },
      q,
    );
    expect(q).toHaveBeenCalledWith(expect.stringContaining('5'));
  });

  it('collapses when predicate yields no rows', async () => {
    const q = vi.fn().mockResolvedValue([]);
    const r = await resolveCellVisibility('c1', { c1: 'SELECT 1 WHERE FALSE' }, {}, q);
    expect(r).toBe(false);
  });

  it('collapses when predicate yields a falsy first value', async () => {
    const q = vi.fn().mockResolvedValue([{ v: 0 }]);
    const r = await resolveCellVisibility('c1', { c1: 'SELECT 0 AS v' }, {}, q);
    expect(r).toBe(false);
  });

  it('shows when predicate yields a truthy first value', async () => {
    const q = vi.fn().mockResolvedValue([{ v: 1 }]);
    const r = await resolveCellVisibility('c1', { c1: 'SELECT 1 AS v' }, {}, q);
    expect(r).toBe(true);
  });

  it('defaults to visible when the predicate throws', async () => {
    const q = vi.fn().mockRejectedValue(new Error('bad sql'));
    const r = await resolveCellVisibility('c1', { c1: 'SELECT bogus' }, {}, q);
    expect(r).toBe(true);
  });
});
