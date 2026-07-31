// Renders ChatMarkdownView to static HTML to verify GFM support (tables,
// strikethrough, autolinks) and chat-specific reference tokens.

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdownView } from '../components/chat/ChatMarkdownView';

function render(text: string, onRef?: (ref: string) => void): string {
    return renderToStaticMarkup(React.createElement(ChatMarkdownView, { text, onNavigateRef: onRef }));
}

describe('ChatMarkdownView', () => {
    it('renders a GFM table as <table> with rows', () => {
        const md = [
            '| name | count |',
            '| --- | --- |',
            '| GC | 42 |',
            '| Heap | 17 |',
        ].join('\n');
        const html = render(md);
        expect(html).toContain('<table');
        expect(html).toContain('<thead');
        expect(html).toContain('<th');
        expect(html).toContain('GC');
        expect(html).toContain('42');
    });

    it('renders fenced code blocks inside <pre><code>', () => {
        const html = render('```sql\nSELECT 1\n```');
        expect(html).toContain('<pre');
        expect(html).toContain('SELECT 1');
    });

    it('renders inline code with cyan styling', () => {
        const html = render('Use `SELECT *` here');
        expect(html).toContain('<code');
        expect(html).toContain('SELECT *');
        expect(html).toContain('text-cyan-400');
    });

    it('renders bold and italic spans', () => {
        const html = render('**bold** and *italic*');
        expect(html).toContain('<strong');
        expect(html).toContain('bold');
        expect(html).toContain('<em');
        expect(html).toContain('italic');
    });

    it('renders [[alias]] as a clickable reference button', () => {
        const html = render('See [[totals]] for details.');
        expect(html).toContain('<button');
        expect(html).toContain('[[totals]]');
        expect(html).toContain('Navigate to totals');
    });

    it('renders @cell-name reference tokens as buttons', () => {
        const html = render('Check @gc-overview');
        expect(html).toContain('<button');
        expect(html).toContain('@gc-overview');
    });

    it('renders #plot-N and #cell-N tokens as buttons', () => {
        const html = render('See #plot-3 and #cell-7');
        // Two buttons, one for each token.
        const matches = html.match(/<button/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
        expect(html).toContain('#plot-3');
        expect(html).toContain('#cell-7');
    });

    it('renders GFM strikethrough', () => {
        const html = render('~~gone~~');
        expect(html).toContain('<del');
        expect(html).toContain('gone');
    });

    it('renders a heading at the right level', () => {
        const html = render('## A heading');
        expect(html).toMatch(/<p[^>]*>A heading<\/p>/);
    });

    it('renders unordered list items', () => {
        const html = render('- first\n- second');
        expect(html).toContain('<ul');
        expect(html).toContain('<li');
        expect(html).toContain('first');
        expect(html).toContain('second');
    });

    it('renders an autolink as an anchor with target=_blank', () => {
        const html = render('Visit https://example.com today');
        expect(html).toContain('<a');
        expect(html).toContain('href="https://example.com"');
        expect(html).toContain('target="_blank"');
    });

    it('renders a blockquote', () => {
        const html = render('> a quote');
        expect(html).toContain('<blockquote');
        expect(html).toContain('a quote');
    });

    it('preserves reference tokens nested inside list items', () => {
        const html = render('- look at [[overview]]');
        expect(html).toContain('<li');
        expect(html).toContain('<button');
        expect(html).toContain('[[overview]]');
    });
});
