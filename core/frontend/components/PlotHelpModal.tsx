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
const plotDocs = (Object.values(plotRegistry) as PlotRegistration[]).sort((a, b) => {
    const indexA = preferredOrder.indexOf(a.name);
    const indexB = preferredOrder.indexOf(b.name);

    if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB; // Both are in the preferred list, sort by that order
    }
    if (indexA !== -1) {
        return -1; // A is preferred, B is not
    }
    if (indexB !== -1) {
        return 1; // B is preferred, A is not
    }
    return a.name.localeCompare(b.name); // Neither are preferred, sort alphabetically
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

const initialGeneralExample = `LINE_CHART(x: "timestamp", y: ["duration", "other_metric"]) ON 1, 2 TITLE "Combined Metrics" ZOOM 0.6; PIE_CHART(name: "category", value: "value") ON 1 ZOOM 0.6

TABLE() ON 1, 2 ZOOM 0.6
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
                className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col animate-fade-in"
            >
                <header className="flex-shrink-0 p-4 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="text-xl font-semibold">Plot Function Guide</h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-full">
                        <XMarkIcon className="w-6 h-6" />
                    </button>
                </header>
                <main ref={mainContentRef} className="flex-grow overflow-y-auto p-6 space-y-8">
                    <div className="p-4 bg-gray-900/50 rounded-lg mb-8 border border-gray-700">
                        <h3 className="font-semibold text-lg text-gray-200">Plot Syntax Quick Reference</h3>
                        <p className="mt-2 text-sm text-gray-400">
                            Each plot block uses a function-call syntax. Column names available in your query results are shown as chips above the editor — click one to copy it. The <span className="text-gray-300 font-mono text-xs bg-gray-700 px-1 py-0.5 rounded">switch to:</span> row lets you instantly swap the plot type.
                        </p>
                        <ul className="mt-4 text-sm space-y-4 list-disc list-inside text-gray-300">
                            <li>
                                <code className="bg-gray-700 p-1 rounded-md">PLOT_A(...); PLOT_B(...)</code>
                                <span className="text-gray-400"> &mdash; Semicolon or single newline places plots <strong>side-by-side</strong> in the same row.</span>
                            </li>
                            <li>
                                <code className="bg-gray-700 p-1 rounded-md leading-relaxed inline-block">PLOT_A(...)<br/><br/>PLOT_B(...)</code>
                                <span className="text-gray-400"> &mdash; Empty line (two newlines) starts a <strong>new row</strong> of plots.</span>
                            </li>
                             <li>
                                <code className="bg-gray-700 p-1 rounded-md">... ON query_ref</code>
                                <span className="text-gray-400"> &mdash; Pick which query feeds this plot. <code className="bg-gray-700 p-1 rounded-md">ON 2</code> uses the second SQL block; <code className="bg-gray-700 p-1 rounded-md">ON 1, 2</code> merges both.</span>
                            </li>
                            <li>
                                <code className="bg-gray-700 p-1 rounded-md">... TITLE "My Chart"</code>
                                <span className="text-gray-400"> &mdash; Add a title that will be displayed above the plot.</span>
                            </li>
                            <li>
                                <code className="bg-gray-700 p-1 rounded-md">... LINK_X($start, $end)</code>
                                <span className="text-gray-400"> &mdash; Link a plot's X-axis to local variables for interactive panning and zooming.</span>
                            </li>
                        </ul>
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
                                                sql="SELECT * FROM table1; CREATE VIEW v2 AS SELECT * from table2;"
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