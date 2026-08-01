import { describe, it, expect } from 'vitest';
import { parseNotebook, reconstructNotebook } from '../utils/notebookParser';
import type { NotebookMetadata } from '../types';

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

describe('parseFrontMatter — aiProvider / aiModel round-trip', () => {
  function roundTrip(metadata: Partial<NotebookMetadata>, body = '# Test\n'): NotebookMetadata {
    const full = { ...metadata } as NotebookMetadata;
    const source = reconstructNotebook({ metadata: full, content: body });
    return parseNotebook(source).metadata;
  }

  it('preserves aiProvider through serialize → parse', () => {
    const out = roundTrip({ aiProvider: 'openai' } as any);
    expect((out as any).aiProvider).toBe('openai');
  });

  it('preserves aiModel through serialize → parse', () => {
    const out = roundTrip({ aiModel: 'gpt-4o' } as any);
    expect((out as any).aiModel).toBe('gpt-4o');
  });

  it('preserves both aiProvider and aiModel together', () => {
    const out = roundTrip({ aiProvider: 'google', aiModel: 'gemini-2.0-flash' } as any);
    expect((out as any).aiProvider).toBe('google');
    expect((out as any).aiModel).toBe('gemini-2.0-flash');
  });

  it('handles aiProvider with single-quote chars safely', () => {
    const out = roundTrip({ aiProvider: "provider's-special" } as any);
    expect((out as any).aiProvider).toBe("provider's-special");
  });

  it('does not emit aiProvider or aiModel keys when absent', () => {
    const source = reconstructNotebook({ metadata: {} as NotebookMetadata, content: '# Hi\n' });
    expect(source).not.toContain('aiProvider');
    expect(source).not.toContain('aiModel');
  });

  it('does not double-emit aiProvider in the unknown-keys fallback', () => {
    // If aiProvider is in knownKeys it should only appear once.
    const source = reconstructNotebook({
      metadata: { aiProvider: 'local', aiModel: 'llama3' } as unknown as NotebookMetadata,
      content: '# Hi\n',
    });
    const matches = source.match(/aiProvider/g) ?? [];
    expect(matches.length).toBe(1);
  });
});


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
