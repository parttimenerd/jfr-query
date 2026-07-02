/**
 * Hero screenshot page for the docs homepage.
 * Renders a curated 2×3 grid of plot examples.
 * Used by gen-plot-screenshots.mjs to produce docs-site/page-full.png
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { plotRegistry } from './components/plots/plotRegistry';
import PlotRenderer from './components/PlotRenderer';
import type { NotebookMetadata } from './types';

const MOCK_METADATA: NotebookMetadata = {
    views: [],
    macros: [],
    customSystemPrompt: '',
    timeFormat: 'HH:mm:ss.SS',
    decimalPlaces: 2,
};

// Curated selection: LINE, BAR, PIE, FLAMEGRAPH, HISTOGRAM, SCATTER
const SELECTED: Array<{ name: string; exampleIdx: number }> = [
    { name: 'LINE_CHART', exampleIdx: 0 },
    { name: 'FLAMEGRAPH', exampleIdx: 0 },
    { name: 'BAR_CHART', exampleIdx: 0 },
    { name: 'HEATMAP', exampleIdx: 0 },
    { name: 'PIE_CHART', exampleIdx: 0 },
    { name: 'HISTOGRAM', exampleIdx: 0 },
];

function HeroPreview() {
    return (
        <div style={{
            background: '#111827',
            width: 1280,
            padding: '24px 24px 8px',
            fontFamily: 'sans-serif',
            boxSizing: 'border-box',
        }}>
            {/* Header bar */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: 20,
                gap: 12,
            }}>
                <span style={{ color: '#e5e7eb', fontWeight: 700, fontSize: 18 }}>JFR Query Notebook</span>
                <span style={{ color: '#6b7280', fontSize: 13 }}>gc-analysis.md</span>
            </div>
            {/* 2-column grid of plots */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 16,
            }}>
                {SELECTED.map(({ name, exampleIdx }) => {
                    const reg = plotRegistry[name];
                    if (!reg) return null;
                    const ex = reg.examples[exampleIdx];
                    if (!ex) return null;
                    const slug = `${name}-${exampleIdx}`;
                    return (
                        <div
                            key={slug}
                            style={{
                                height: 260,
                                background: '#1f2937',
                                borderRadius: 8,
                                overflow: 'hidden',
                                position: 'relative',
                            }}
                        >
                            <PlotRenderer
                                config={ex.code}
                                data={ex.sampleData ?? []}
                                sql=""
                                cellContext={{ id: slug, title: ex.description, content: '' }}
                                onApplyFix={() => {}}
                                metadata={MOCK_METADATA}
                                onMetadataChange={async () => {}}
                                onCellVariableChange={() => {}}
                                allVariables={{}}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

const root = document.getElementById('root');
if (root) {
    ReactDOM.createRoot(root).render(<HeroPreview />);
}
