import { describe, it, expect } from 'vitest';
import { sankeyPlot, buildSankeyData, filterByFocus } from '../../../components/plots/SankeyPlot';

describe('sankeyPlot registration', () => {
    it('has name SANKEY', () => {
        expect(sankeyPlot.name).toBe('SANKEY');
    });

    it('requires source, target, value', () => {
        ['source', 'target', 'value'].forEach(name => {
            expect(sankeyPlot.params.find(p => p.name === name)?.required).toBe(true);
        });
    });
});

describe('sankeyPlot parseConfig', () => {
    it('parses all three required columns', () => {
        const cfg = sankeyPlot.parseConfig('SANKEY(source: "caller", target: "callee", value: "samples")', []);
        expect(cfg.source).toBe('caller');
        expect(cfg.target).toBe('callee');
        expect(cfg.value).toBe('samples');
    });
});

describe('buildSankeyData', () => {
    const rows = [
        { caller: 'main', callee: 'foo', samples: 10 },
        { caller: 'main', callee: 'bar', samples: 5 },
        { caller: 'foo', callee: 'baz', samples: 8 },
    ];

    it('builds correct node list', () => {
        const { nodes } = buildSankeyData(rows, 'caller', 'callee', 'samples');
        const names = nodes.map((n: any) => n.name);
        expect(names).toContain('main');
        expect(names).toContain('foo');
        expect(names).toContain('baz');
    });

    it('builds correct link list', () => {
        const { nodes, links } = buildSankeyData(rows, 'caller', 'callee', 'samples');
        expect(links).toHaveLength(3);
        const mainIdx = nodes.findIndex((n: any) => n.name === 'main');
        const fooIdx = nodes.findIndex((n: any) => n.name === 'foo');
        const mainToFoo = links.find((l: any) => l.source === mainIdx && l.target === fooIdx);
        expect(mainToFoo?.value).toBe(10);
    });

    it('handles empty data', () => {
        const { nodes, links } = buildSankeyData([], 'a', 'b', 'v');
        expect(nodes).toHaveLength(0);
        expect(links).toHaveLength(0);
    });
});

describe('filterByFocus', () => {
    const rows = [
        { caller: 'main', callee: 'foo', samples: 10 },
        { caller: 'main', callee: 'bar', samples: 5 },
        { caller: 'foo', callee: 'baz', samples: 8 },
    ];

    it('returns all rows when focus is null', () => {
        expect(filterByFocus(rows, 'caller', 'callee', null)).toHaveLength(3);
    });

    it('filters to rows passing through focus node', () => {
        const filtered = filterByFocus(rows, 'caller', 'callee', 'foo');
        // foo is source of [foo→baz] and target of [main→foo]
        expect(filtered).toHaveLength(2);
    });
});
