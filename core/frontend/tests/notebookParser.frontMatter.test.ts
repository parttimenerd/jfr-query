import { describe, it, expect } from 'vitest';
import { parseNotebook } from '../utils/notebookParser';

describe('parseFrontMatter — descriptive keys', () => {
  it('extracts title, description, license as strings', () => {
    const nb = parseNotebook([
      '---',
      'title: My Notebook',
      'description: A short blurb',
      'license: Apache-2.0',
      '---',
      '# Body',
      '',
    ].join('\n'));
    expect(nb.metadata.title).toBe('My Notebook');
    expect(nb.metadata.description).toBe('A short blurb');
    expect(nb.metadata.license).toBe('Apache-2.0');
  });

  it('parses inline YAML list tags: [a, "b c", d]', () => {
    const nb = parseNotebook([
      '---',
      'tags: [a, "b c", d]',
      '---',
      '',
    ].join('\n'));
    expect(nb.metadata.tags).toEqual(['a', 'b c', 'd']);
  });

  it('parses block-style YAML list under tags:', () => {
    const nb = parseNotebook([
      '---',
      'tags:',
      '  - jfr',
      '  - "gc profile"',
      '  - z',
      '---',
      '',
    ].join('\n'));
    expect(nb.metadata.tags).toEqual(['jfr', 'gc profile', 'z']);
  });

  it('leaves tags undefined when absent', () => {
    const nb = parseNotebook('---\n---\n');
    expect(nb.metadata.tags).toBeUndefined();
  });
});
