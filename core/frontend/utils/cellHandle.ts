import type { NotebookCellData } from '../types';

/**
 * Cell handle `H`: a notebook-source-stable identifier for a cell.
 * Returns the `name` from a leading `<!-- @cell name=... -->` directive if set,
 * otherwise `cell_<1-based-index>`.
 * Used as a DuckDB schema name for cell-qualified alias references.
 */
export const cellHandle = (cell: Pick<NotebookCellData, 'name'>, zeroBasedIndex: number): string =>
  cell.name && cell.name.trim() ? cell.name.trim() : `cell_${zeroBasedIndex + 1}`;

/** A DuckDB-safe identifier: letters, digits, underscores; replaces hyphens with underscores. */
export const sanitizeForDuckDB = (id: string): string => id.replace(/-/g, '_').replace(/[^A-Za-z0-9_]/g, '_');

/** Wraps an identifier in double quotes, escaping embedded quotes per DuckDB rules. */
export const quoteIdent = (id: string): string => `"${id.replace(/"/g, '""')}"`;
