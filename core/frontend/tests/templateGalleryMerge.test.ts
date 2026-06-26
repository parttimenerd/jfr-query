import { describe, it, expect } from 'vitest';
import { mergeTemplate } from '../utils/templateMerge';

const baseNotebook = `---
timeFormat: 'HH:mm:ss'
variables:
  $$threshold_ms: '50'
---
<!-- @cell name=intro -->

# Current Notebook
`;

const templateNotebook = `---
title: My Template
license: MIT
variables:
  $$threshold_ms: '200'
  $$new_var: '7'
cellConditions:
  intro: 'SELECT 1'
---
<!-- @cell name=intro -->

# Template Intro

---

<!-- @cell name=fresh-cell -->

## Brand new
`;

describe('mergeTemplate', () => {
    it('replace returns the template body verbatim', () => {
        const r = mergeTemplate(baseNotebook, templateNotebook, 'replace');
        expect(r.notebookSource).toBe(templateNotebook);
        expect(r.warnings).toEqual([]);
    });

    it('append: current variable wins; new variable from template is added', () => {
        const r = mergeTemplate(baseNotebook, templateNotebook, 'append');
        // current's threshold_ms should be retained
        expect(r.notebookSource).toContain("$$threshold_ms");
        expect(r.notebookSource).toMatch(/\$\$threshold_ms:\s*'?50'?/);
        // template's new var should appear
        expect(r.notebookSource).toContain("$$new_var");
        // warning surfaced about collision
        expect(r.warnings.some(w => w.includes('threshold_ms'))).toBe(true);
    });

    it('append: cell name "intro" collides → template cell renamed to "intro-2"', () => {
        const r = mergeTemplate(baseNotebook, templateNotebook, 'append');
        expect(r.notebookSource).toContain('name=intro-2');
        expect(r.warnings.some(w => w.includes('intro') && w.includes('renamed'))).toBe(true);
        // cellConditions key for the renamed cell should follow
        expect(r.notebookSource).toContain('intro-2:');
    });

    it('append: non-colliding cell name is preserved unchanged', () => {
        const r = mergeTemplate(baseNotebook, templateNotebook, 'append');
        expect(r.notebookSource).toContain('name=fresh-cell');
    });

    it('insert at index 0 places template cells before current', () => {
        const r = mergeTemplate(baseNotebook, templateNotebook, 'insert', 0);
        const introIdx = r.notebookSource.indexOf('Template Intro');
        const currentIdx = r.notebookSource.indexOf('Current Notebook');
        expect(introIdx).toBeGreaterThan(-1);
        expect(currentIdx).toBeGreaterThan(-1);
        expect(introIdx).toBeLessThan(currentIdx);
    });

    it('insert at end places template cells after current', () => {
        const r = mergeTemplate(baseNotebook, templateNotebook, 'insert', 999);
        const introIdx = r.notebookSource.indexOf('Template Intro');
        const currentIdx = r.notebookSource.indexOf('Current Notebook');
        expect(currentIdx).toBeLessThan(introIdx);
    });

    it('views collision keeps current; template view dropped, warning surfaced', () => {
        const a = `---
views:
  - name: 'my_view'
    sql: |
      SELECT 1
---
# A`;
        const b = `---
views:
  - name: 'my_view'
    sql: |
      SELECT 2
  - name: 'other'
    sql: |
      SELECT 3
license: MIT
---
# B`;
        const r = mergeTemplate(a, b, 'append');
        // current's view sql should win
        expect(r.notebookSource).toMatch(/name:\s*'?my_view'?[\s\S]+SELECT 1/);
        // template's new view "other" should appear
        expect(r.notebookSource).toMatch(/name:\s*'?other'?/);
        expect(r.warnings.some(w => w.includes('my_view'))).toBe(true);
    });

    it('append into empty notebook still produces a parseable result', () => {
        const r = mergeTemplate('', templateNotebook, 'append');
        // Should be parseable: no throws, no all-empty result
        expect(r.notebookSource.length).toBeGreaterThan(0);
        expect(r.notebookSource).toContain('Template Intro');
    });
});
