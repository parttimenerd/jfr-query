import { describe, it, expect } from 'vitest';
import { parseCellContent, tokenizeCellContent } from '../utils/notebookParser';

function parseVars(raw: string) {
    return parseCellContent(tokenizeCellContent(raw));
}

describe('variables block syntax', () => {
  it('accepts equals-sign syntax (existing)', () => {
    const r = parseVars('```variables\n$limit = 100\n$type = "GC"\n```\n');
    expect(r.variables['$limit']).toBe('100');
    expect(r.variables['$type']).toBe('"GC"');
  });

  it('accepts YAML colon syntax', () => {
    const r = parseVars('```variables\n$limit: 100\n$type: "GC"\n```\n');
    expect(r.variables['$limit']).toBe('100');
    expect(r.variables['$type']).toBe('"GC"');
  });

  it('accepts bare name with colon (auto-prepends $)', () => {
    const r = parseVars('```variables\nlimit: 100\n```\n');
    expect(r.variables['$limit']).toBe('100');
  });

  it('accepts mixed syntax in same block', () => {
    const r = parseVars('```variables\n$a = 1\n$b: 2\n```\n');
    expect(r.variables['$a']).toBe('1');
    expect(r.variables['$b']).toBe('2');
  });
});
