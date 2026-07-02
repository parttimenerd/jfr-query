/**
 * Standalone plot preview page.
 * Opens at /plot-preview.html during `npm run dev`.
 * Renders every plot type with its first example's sample data.
 * Used by gen-plot-screenshots.mjs to produce docs images.
 */
import React, { useState, useEffect } from 'react';
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

// Deduplicated list skipping the FLAME_GRAPH alias
const plots = Object.entries(plotRegistry)
    .filter(([name]) => name !== 'FLAME_GRAPH')
    .map(([, reg]) => reg)
    .filter((v, i, a) => a.findIndex(x => x.name === v.name) === i);

function PlotPreview() {
    return (
        <div style={{ background: '#111827', minHeight: '100vh', padding: 24, fontFamily: 'sans-serif' }}>
            {plots.map(reg =>
                reg.examples.map((ex, i) => {
                    const data = ex.sampleData ?? [];
                    const slug = `${reg.name}-${i}`;
                    return (
                        <div
                            key={slug}
                            data-plot={slug}
                            style={{
                                width: 640,
                                height: 320,
                                marginBottom: 32,
                                background: '#1f2937',
                                borderRadius: 8,
                                overflow: 'hidden',
                                position: 'relative',
                            }}
                        >
                            <PlotRenderer
                                config={ex.code}
                                data={data}
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
                })
            )}
        </div>
    );
}

const root = document.getElementById('root');
if (root) {
    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            <PlotPreview />
        </React.StrictMode>
    );
}
