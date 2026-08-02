import { describe, it, expect } from 'vitest';
import { sunburstPlot, buildTree } from '../../../components/plots/SunburstPlot';

describe('sunburstPlot registration', () => {
    it('has name SUNBURST', () => {
        expect(sunburstPlot.name).toBe('SUNBURST');
    });

    it('requires path and value params', () => {
        const path = sunburstPlot.params.find(p => p.name === 'path');
        const value = sunburstPlot.params.find(p => p.name === 'value');
        expect(path?.required).toBe(true);
        expect(value?.required).toBe(true);
    });
});

describe('sunburstPlot parseConfig', () => {
    it('parses single path column', () => {
        const cfg = sunburstPlot.parseConfig('SUNBURST(path: "pkg", value: "samples")', []);
        expect(cfg.value).toBe('samples');
        expect(cfg.path).toBe('pkg');
    });
});

describe('buildTree', () => {
    const rows = [
        { pkg: 'com.example', cls: 'Foo', samples: 10 },
        { pkg: 'com.example', cls: 'Bar', samples: 5 },
        { pkg: 'org.lib', cls: 'Baz', samples: 3 },
    ];

    it('builds a tree with correct children', () => {
        const tree = buildTree(rows, ['pkg', 'cls'], 'samples');
        expect(tree.name).toBe('(root)');
        expect(tree.children).toHaveLength(2);
    });

    it('leaf nodes have value', () => {
        const tree = buildTree(rows, ['pkg', 'cls'], 'samples');
        const example = tree.children!.find(c => c.name === 'com.example');
        expect(example?.children).toHaveLength(2);
        const foo = example?.children?.find(c => c.name === 'Foo');
        expect(foo?.value).toBe(10);
    });

    it('handles empty data', () => {
        const tree = buildTree([], ['pkg'], 'samples');
        expect(tree.children).toHaveLength(0);
    });

    it('handles slash-delimited single column', () => {
        const rows2 = [{ path: 'a/b/c', samples: 7 }];
        const tree = buildTree(rows2, 'path', 'samples', '/');
        const a = tree.children?.find(c => c.name === 'a');
        const b = a?.children?.find(c => c.name === 'b');
        expect(b?.children?.find(c => c.name === 'c')?.value).toBe(7);
    });
});
