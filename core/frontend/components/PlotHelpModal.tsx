import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { plotRegistry } from './plots/plotRegistry';
import PlotRenderer from './PlotRenderer';
import { XMarkIcon } from './icons/XMarkIcon';
import PlotConfigEditor from './PlotConfigEditor';
import { generateSignature } from '../utils/plotUtils';
import type { PlotRegistration } from './plots/plotTypes';
import type { NotebookMetadata } from '../types';

const preferredOrder = ['LINE_CHART', 'BAR_CHART', 'TABLE', 'PIE_CHART'];
const plotDocs = Array.from(
    new Map((Object.values(plotRegistry) as PlotRegistration[]).map(p => [p.name, p])).values()
).sort((a, b) => {
    const indexA = preferredOrder.indexOf(a.name);
    const indexB = preferredOrder.indexOf(b.name);

    if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
    }
    if (indexA !== -1) {
        return -1;
    }
    if (indexB !== -1) {
        return 1;
    }
    return a.name.localeCompare(b.name);
});

// Generic sample data used if an example doesn't provide its own
const genericSampleData = [
    { id: 1, timestamp: "2023-01-01T12:00:00Z", duration: 150.5, value: 100, category: 'A' },
    { id: 2, timestamp: "2023-01-01T12:01:00Z", duration: 75.2, value: 200, category: 'B' },
    { id: 3, timestamp: "2023-01-01T12:02:00Z", duration: 220.0, value: 150, category: 'A' },
    { id: 4, timestamp: "2023-01-01T12:03:00Z", duration: 99.8, value: 50, category: 'C' },
];
const genericSampleData2 = [
    { id: 5, timestamp: "2023-01-01T12:00:00Z", other_metric: 88 },
    { id: 6, timestamp: "2023-01-01T12:01:00Z", other_metric: 95 },
    { id: 7, timestamp: "2023-01-01T12:02:00Z", other_metric: 82 },
    { id: 8, timestamp: "2023-01-01T12:03:00Z", other_metric: 91 },
];

const initialGeneralExample = `LINE_CHART(x: "timestamp", y: ["duration"]) ON 1 TITLE "Query 1: Duration" ZOOM 0.6; LINE_CHART(x: "timestamp", y: ["other_metric"]) ON 2 TITLE "Query 2: Other Metric" ZOOM 0.6


PIE_CHART(name: "category", value: "value") ON 1 ZOOM 0.6


TABLE() ON 1 ZOOM 0.6
`;

const initialInteractiveExample = `LINE_CHART(x: "timestamp", y: ["duration"]) LINK_X($start, $end, master) TITLE "Duration"


LINE_CHART(x: "timestamp", y: ["value"]) LINK_X($start, $end) TITLE "Value"
`;


interface PlotHelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const PlotHelpModal: React.FC<PlotHelpModalProps> = ({ isOpen, onClose }) => {
    const [editableExamples, setEditableExamples] = useState<Record<string, string[]>>({});
    const [generalExample, setGeneralExample] = useState(initialGeneralExample);
    const [interactiveExampleConfig, setInteractiveExampleConfig] = useState(initialInteractiveExample);
    const [interactiveExampleVariables, setInteractiveExampleVariables] = useState<Record<string, string>>({
        $start: String(new Date("2023-01-01T12:00:00Z").getTime()),
        $end: String(new Date("2023-01-01T12:03:00Z").getTime()),
    });
    const mainContentRef = useRef<HTMLElement>(null);
    
    useEffect(() => {
        if(isOpen) {
            const initialExamples = Object.fromEntries(
                plotDocs.map(doc => [doc.name, doc.examples.map(ex => ex.code)])
            );
            setEditableExamples(initialExamples);
            setGeneralExample(initialGeneralExample);
            setInteractiveExampleConfig(initialInteractiveExample);
            setInteractiveExampleVariables({
                $start: String(new Date(genericSampleData[0].timestamp).getTime()),
                $end: String(new Date(genericSampleData[genericSampleData.length - 1].timestamp).getTime()),
            });
            // Defer scroll to top to ensure it happens after the content has rendered
            setTimeout(() => {
                if (mainContentRef.current) {
                    mainContentRef.current.scrollTop = 0;
                }
            }, 0);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen, onClose]);
    
    const multiQueryData = useMemo(() => {
       const merged = genericSampleData.map((row, i) => ({
           ...row,
           ...genericSampleData2[i]
       }));
       const dataSources = [
            { name: '1', data: genericSampleData },
            { name: '2', data: genericSampleData2 },
        ];
        
        // This is a simplified merge for rendering; the actual plot component handles it better.
        // We prefix columns to simulate a multi-query join result for the renderer.
        const prefixedData = genericSampleData.map((row, i) => {
            const row2 = genericSampleData2[i] || { id: null, timestamp: null, other_metric: null };
            return {
                '1_id': row.id,
                '1_timestamp': row.timestamp,
                '1_duration': row.duration,
                '1_value': row.value,
                '1_category': row.category,
                '2_id': row2.id,
                '2_timestamp': row2.timestamp,
                '2_other_metric': row2.other_metric,
            };
        });
        
       return {
           prefixedData,
           dataSources
       };
    }, []);

    const handleInteractiveVariablesChange = useCallback((vars: Record<string, string>) => {
        setInteractiveExampleVariables(prev => ({...prev, ...vars}));
    }, []);

    if (!isOpen) return null;

    const mockMetadata: NotebookMetadata = { views: [], macros: [], customSystemPrompt: '', timeFormat: 'HH:mm:ss.SS', decimalPlaces: 2 };
    
    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return ReactDOM.createPortal(
        <div 
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
            onClick={handleBackdropClick}
        >
            <div
                role="dialog" aria-modal="true" aria-label="Plot Function Guide"
                className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col animate-fade-in"
            >
                <header className="flex-shrink-0 p-4 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="text-xl font-semibold">Plot Function Guide</h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-full" aria-label="Close">
                        <XMarkIcon className="w-6 h-6" />
                    </button>
                </header>
                <main ref={mainContentRef} className="flex-grow overflow-y-auto p-6 space-y-8">
                    <div className="p-4 bg-gray-900/50 rounded-lg mb-8 border border-gray-700">
                        <h3 className="font-semibold text-lg text-gray-200">Plot Syntax Quick Reference</h3>
                        <p className="mt-2 text-sm text-gray-400">
                            Each plot block uses a function-call syntax. Column names available in your query results are shown as chips above the editor — click one to copy it into your plot config.
                            Outer clauses are appended after the function call, separated by spaces.
                        </p>

                        <h4 className="font-semibold text-gray-200 mt-5">Layout</h4>
                        <ul className="mt-2 text-sm space-y-3 list-disc list-inside text-gray-300">
                            <li>
                                <code className="bg-gray-700 p-1 rounded-md">PLOT_A(...); PLOT_B(...)</code>
                                <span className="text-gray-400"> &mdash; Semicolon or single newline places plots <strong>side-by-side</strong> in the same row.</span>
                            </li>
                            <li>
                                <code className="bg-gray-700 p-1 rounded-md leading-relaxed inline-block">PLOT_A(...)<br/><br/>PLOT_B(...)</code>
                                <span className="text-gray-400"> &mdash; Two blank lines (three newlines) starts a <strong>new row</strong> of plots.</span>
                            </li>
                        </ul>

                        <h4 className="font-semibold text-gray-200 mt-5">Data &amp; Display Clauses</h4>
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">ON query_ref</code>
                                <p className="text-gray-400 mt-1">Pick which SQL query feeds this plot. <code className="bg-gray-600 px-1 rounded">ON 2</code> uses the second block; <code className="bg-gray-600 px-1 rounded">ON 1, 2</code> merges both.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">TITLE "My Chart"</code>
                                <p className="text-gray-400 mt-1">Display a title above the plot.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">ZOOM 0.6</code>
                                <p className="text-gray-400 mt-1">Scale the plot height (0.0–1.0+). Default is 1.0. Useful when fitting many charts in a row.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">ZOOM_X 1.5</code>
                                <p className="text-gray-400 mt-1">Scale only the horizontal axis — useful for wide time-series that need more horizontal space without growing taller.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">WIDTH 600px</code>
                                <p className="text-gray-400 mt-1">Set a fixed width. Accepts <code className="bg-gray-600 px-1 rounded">px</code> or <code className="bg-gray-600 px-1 rounded">%</code> values.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">HEIGHT 400px</code>
                                <p className="text-gray-400 mt-1">Set a fixed height for the plot container. Accepts <code className="bg-gray-600 px-1 rounded">px</code> values.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">PALETTE "tableau10"</code>
                                <p className="text-gray-400 mt-1">Override the color palette. Named palettes: <code className="bg-gray-600 px-1 rounded">category10</code>, <code className="bg-gray-600 px-1 rounded">tableau10</code>, <code className="bg-gray-600 px-1 rounded">pastel1</code>, <code className="bg-gray-600 px-1 rounded">dark2</code>, <code className="bg-gray-600 px-1 rounded">set2</code>. Or pass a comma-separated hex list: <code className="bg-gray-600 px-1 rounded">"#e41a1c,#377eb8,#4daf4a"</code>.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">NAME "plotname"</code>
                                <p className="text-gray-400 mt-1">Assigns a name to this plot. The name appears in the sidebar and can be used in <code className="bg-gray-600 px-1 rounded">LINK_SCROLL</code> and <code className="bg-gray-600 px-1 rounded">ON "name"</code> clauses in other cells.</p>
                            </div>
                            <div className="md:col-span-2">
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">DATASET my_table</code>
                                <p className="text-gray-400 mt-1">Use a named DuckDB table or view as the data source instead of a query result. Useful for very large static datasets loaded via <code className="bg-gray-600 px-1 rounded">CREATE VIEW</code>.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">DISABLED</code>
                                <p className="text-gray-400 mt-1">Suppresses rendering of this plot — shows a placeholder instead. Useful for temporarily hiding a chart without deleting its config.</p>
                            </div>
                        </div>

                        <h4 className="font-semibold text-gray-200 mt-5">Legend</h4>
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">LEGEND AT RIGHT</code>
                                <p className="text-gray-400 mt-1">Position the legend. Options: <code className="bg-gray-600 px-1 rounded">RIGHT</code>, <code className="bg-gray-600 px-1 rounded">LEFT</code>, <code className="bg-gray-600 px-1 rounded">TOP</code>, <code className="bg-gray-600 px-1 rounded">BOTTOM</code>, <code className="bg-gray-600 px-1 rounded">NONE</code>.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">LEGEND HIDDEN</code>
                                <p className="text-gray-400 mt-1">Hide the legend entirely.</p>
                            </div>
                        </div>

                        <h4 className="font-semibold text-gray-200 mt-5">Axis Customisation</h4>
                        <p className="text-xs text-gray-400 mt-1">Apply one or more sub-clauses after <code className="bg-gray-600 px-1 rounded">AXIS_X</code> or <code className="bg-gray-600 px-1 rounded">AXIS_Y</code> in any order.</p>
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">AXIS_X TYPE time</code>
                                <p className="text-gray-400 mt-1">Force axis scale type. Options: <code className="bg-gray-600 px-1 rounded">time</code>, <code className="bg-gray-600 px-1 rounded">band</code>, <code className="bg-gray-600 px-1 rounded">log</code>, <code className="bg-gray-600 px-1 rounded">linear</code>.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">AXIS_Y TYPE log</code>
                                <p className="text-gray-400 mt-1">Use a logarithmic Y axis.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">AXIS_X FORMAT "HH:mm"</code>
                                <p className="text-gray-400 mt-1">Format string for axis tick labels (date-fns format for time axes).</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">AXIS_Y LABEL "MB/s"</code>
                                <p className="text-gray-400 mt-1">Add a text label to the axis.</p>
                            </div>
                            <div className="md:col-span-2">
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">AXIS_X TYPE time FORMAT "HH:mm" LABEL "Time"</code>
                                <p className="text-gray-400 mt-1">Combine multiple sub-clauses in a single <code className="bg-gray-600 px-1 rounded">AXIS_X</code>.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">AXIS_Y DOMAIN [0, 100]</code>
                                <p className="text-gray-400 mt-1">Fix the axis extent. Use <code className="bg-gray-600 px-1 rounded">auto</code> for either bound to keep it dynamic, e.g. <code className="bg-gray-600 px-1 rounded">DOMAIN [0, auto]</code>.</p>
                            </div>
                        </div>

                        <h4 className="font-semibold text-gray-200 mt-5">Interactive Linking &amp; Brushing</h4>
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">LINK_X($start, $end)</code>
                                <p className="text-gray-400 mt-1">Bind the X viewport to two cell variables. Drag to pan, Shift+scroll to zoom. Add <code className="bg-gray-600 px-1 rounded">master</code> to make this plot the controller.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">LINK_Y $var</code>
                                <p className="text-gray-400 mt-1">Bind the Y viewport to a cell variable. Plots sharing the same variable share a Y axis range.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">LINK_XY $var</code>
                                <p className="text-gray-400 mt-1">Bind both X and Y axes to a single variable (2D pan/zoom).</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">BRUSH $var MODE X</code>
                                <p className="text-gray-400 mt-1">Add a brush overlay. For X/Y mode: writes <code className="bg-gray-600 px-1 rounded">$var.brush.lo</code> and <code className="bg-gray-600 px-1 rounded">$var.brush.hi</code>. For XY mode: writes <code className="bg-gray-600 px-1 rounded">$var.brush.x_lo</code>, <code className="bg-gray-600 px-1 rounded">$var.brush.x_hi</code>, <code className="bg-gray-600 px-1 rounded">$var.brush.y_lo</code>, <code className="bg-gray-600 px-1 rounded">$var.brush.y_hi</code>. Modes: <code className="bg-gray-600 px-1 rounded">X</code>, <code className="bg-gray-600 px-1 rounded">Y</code>, <code className="bg-gray-600 px-1 rounded">XY</code>.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">LINK_SCROLL plotname</code>
                                <p className="text-gray-400 mt-1">Synchronise scroll position with all other plots in the same named group. Each plot must use the same group name.</p>
                            </div>
                        </div>

                        <h4 className="font-semibold text-gray-200 mt-5">Tooltip Clauses</h4>
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">TOOLTIP COLUMNS ["col1","col2"]</code>
                                <p className="text-gray-400 mt-1">Show specific columns in the hover tooltip.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">ON HOVER TOOLTIP "label"</code>
                                <p className="text-gray-400 mt-1">Custom tooltip template. Use <code className="bg-gray-600 px-1 rounded">{'{column}'}</code> placeholders for column values, e.g. <code className="bg-gray-600 px-1 rounded">"{'<{cause}: {duration}>'}"</code>.</p>
                            </div>
                        </div>

                        <h4 className="font-semibold text-gray-200 mt-5">Variables &amp; LET</h4>
                        <p className="text-xs text-gray-400 mt-1">Use cell-level variables to parameterise queries and link plots together. Variables are defined in a <code className="bg-gray-600 px-1 rounded">variables</code> block and referenced with <code className="bg-gray-600 px-1 rounded">$name</code> syntax in both SQL and plot configs.</p>
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono whitespace-pre">{"$threshold = 500"}</code>
                                <p className="text-gray-400 mt-1">Define a variable in the cell's <code className="bg-gray-600 px-1 rounded">variables</code> block. Use it in SQL as <code className="bg-gray-600 px-1 rounded">WHERE duration &gt; $threshold</code>.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">LET @alias = "cpu_usage"</code>
                                <p className="text-gray-400 mt-1">Define a reusable constant in the plot config block. Reference it as <code className="bg-gray-600 px-1 rounded">@alias</code> inside the same block — e.g. <code className="bg-gray-600 px-1 rounded font-mono whitespace-pre">{'LET @col = "cpu"\nLINE_CHART(x: "ts", y: [@col])'}</code>.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">LINE_CHART(...) LINK_X($s, $e)</code>
                                <p className="text-gray-400 mt-1">Variables written by <code className="bg-gray-600 px-1 rounded">LINK_X</code> or <code className="bg-gray-600 px-1 rounded">BRUSH</code> are automatically passed to the SQL re-run on the next render cycle.</p>
                            </div>
                            <div>
                                <code className="bg-gray-700 text-yellow-300 p-1 rounded-md font-mono">WHERE ts BETWEEN $start AND $end</code>
                                <p className="text-gray-400 mt-1">Variables defined by <code className="bg-gray-600 px-1 rounded">LINK_X($start, $end)</code> pan/zoom are substituted directly into SQL, so the database only returns the visible window.</p>
                            </div>
                        </div>
                         <div className="mt-6">
                            <h4 className="font-semibold text-gray-200">Live Example (Multi-Query)</h4>
                             <div className="mt-2 p-4 bg-gray-900/40 rounded-lg border border-gray-700/50">
                                <p className="text-sm text-gray-400 mb-4">This example assumes there are two SQL queries in the cell. The plot combines them.</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <h5 className="text-xs font-semibold text-gray-400 mb-1">Editable Config</h5>
                                        <div className="border border-gray-700 rounded-md overflow-hidden">
                                            <PlotConfigEditor 
                                                value={generalExample} 
                                                onChange={setGeneralExample} 
                                                data={multiQueryData.prefixedData} // Provide merged data for hinting
                                                variables={{}}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <h5 className="text-xs font-semibold text-gray-400 mb-1">Preview</h5>
                                        <div className="bg-gray-900/50 rounded-lg border border-gray-700 h-[300px] overflow-hidden">
                                            <PlotRenderer
                                                config={generalExample}
                                                data={multiQueryData.prefixedData}
                                                dataByQueryRef={{ 1: genericSampleData, 2: genericSampleData2 }}
                                                sql="SELECT * FROM table1; SELECT * from table2;"
                                                cellContext={{id: `ex-general`, title: 'Example', content:''}}
                                                onApplyFix={setGeneralExample}
                                                metadata={mockMetadata}
                                                onMetadataChange={async () => {}}
                                                onCellVariableChange={() => {}}
                                                allVariables={{}}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div className="p-4 bg-gray-900/50 rounded-lg mb-8 border border-cyan-600/50">
                        <h3 className="font-semibold text-lg text-cyan-300">Interactive Dashboard Example</h3>
                        <p className="mt-2 text-sm text-gray-400">
                           Use <code className="bg-gray-700 p-1 rounded-md">LINK_X($start, $end)</code> to link the X-axes of multiple plots to the same local variables.
                           Interacting with one plot (drag to pan, Shift+scroll to zoom) will update all other linked plots.
                        </p>
                        <div className="mt-4 p-4 bg-gray-900/40 rounded-lg border border-gray-700/50">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <h5 className="text-xs font-semibold text-gray-400 mb-1">Editable Config</h5>
                                    <div className="border border-gray-700 rounded-md overflow-hidden">
                                        <PlotConfigEditor 
                                            value={interactiveExampleConfig} 
                                            onChange={setInteractiveExampleConfig} 
                                            data={genericSampleData}
                                            variables={interactiveExampleVariables}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <h5 className="text-xs font-semibold text-gray-400 mb-1">Interactive Preview</h5>
                                    <div className="bg-gray-900/50 rounded-lg border border-gray-700 h-[500px] overflow-hidden">
                                        <PlotRenderer 
                                            config={interactiveExampleConfig} 
                                            data={genericSampleData}
                                            sql=""
                                            cellContext={{id: 'interactive-ex', title: 'Example', content:''}} 
                                            onApplyFix={setInteractiveExampleConfig}
                                            metadata={mockMetadata}
                                            onMetadataChange={async () => {}}
                                            onCellVariableChange={handleInteractiveVariablesChange}
                                            allVariables={interactiveExampleVariables}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>


                    {plotDocs.map(doc => {
                        const signature = `${doc.name}${generateSignature(doc.params)}`;
                        
                        return (
                            <div key={doc.name} className="border-b border-gray-700 pb-8 last:border-b-0 last:pb-0">
                                <h3 className="text-2xl font-bold text-cyan-400 font-mono">{signature}</h3>
                                <div className="flex items-center gap-4">
                                    <p className="mt-2 text-gray-300">{doc.description}</p>
                                    {doc.supportsMultiQuery && <span className="mt-2 text-xs font-semibold text-purple-300 bg-purple-600/20 px-2 py-0.5 rounded-full">Supports Multiple Queries</span>}
                                </div>
                                
                                <div className="mt-4">
                                    {doc.params.length > 0 && (
                                        <>
                                            <h4 className="font-semibold text-gray-200">Parameters</h4>
                                            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-sm">
                                                {doc.params.map(param => (
                                                    <div key={param.name}>
                                                        <code className="bg-gray-700 text-purple-300 font-mono p-1 rounded-md">{param.name}</code>
                                                        <span className="text-yellow-400 ml-1">({param.type})</span>
                                                        <p className="text-gray-400 ml-2 mt-1">{param.description}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                                
                                {doc.examples.map((example, index) => {
                                    const sampleData = example.sampleData || genericSampleData;
                                    const currentConfig = editableExamples[doc.name]?.[index] || '';

                                    return (
                                        <div key={index} className="mt-6 p-4 bg-gray-900/40 rounded-lg border border-gray-700/50">
                                            <p className="text-sm text-gray-400 mb-2">{example.description}</p>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div>
                                                    <h5 className="text-xs font-semibold text-gray-400 mb-1">Editable Config</h5>
                                                    <div className="border border-gray-700 rounded-md overflow-hidden">
                                                        <PlotConfigEditor 
                                                            value={currentConfig} 
                                                            onChange={(newCode) => setEditableExamples(prev => {
                                                                const newExamplesForDoc = [...(prev[doc.name] || [])];
                                                                newExamplesForDoc[index] = newCode;
                                                                return {...prev, [doc.name]: newExamplesForDoc};
                                                            })} 
                                                            data={sampleData} 
                                                            variables={{}}
                                                        />
                                                    </div>
                                                </div>
                                                <div>
                                                    <h5 className="text-xs font-semibold text-gray-400 mb-1">Preview</h5>
                                                    <div className="bg-gray-900/50 rounded-lg border border-gray-700 h-[250px] overflow-hidden">
                                                        <PlotRenderer 
                                                            config={currentConfig} 
                                                            data={sampleData}
                                                            sql=""
                                                            cellContext={{id: `ex-${doc.name}-${index}`, title: 'Example', content:''}} 
                                                            onApplyFix={(newCode) => setEditableExamples(prev => {
                                                                const newExamplesForDoc = [...(prev[doc.name] || [])];
                                                                newExamplesForDoc[index] = newCode;
                                                                return {...prev, [doc.name]: newExamplesForDoc};
                                                            })}
                                                            metadata={mockMetadata}
                                                            onMetadataChange={async () => {}}
                                                            onCellVariableChange={() => {}}
                                                            allVariables={{}}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </main>
            </div>
        </div>,
        document.body
    );
};

export default PlotHelpModal;