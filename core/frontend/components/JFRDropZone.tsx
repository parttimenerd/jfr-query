import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { NotebookIcon } from './icons/NotebookIcon';

interface JFRDropZoneProps {
    onFileSelected: (bytes: Uint8Array, name: string) => void;
    isImporting: boolean;
    errorMessage: string | null;
    onLoadDemo?: () => void;
    onLoadGcNotebook?: () => void;
}

const FEATURE_HINTS = [
    { icon: '📊', text: 'SQL queries with charts — bar, line, scatter, flame graph, and more' },
    { icon: '🔎', text: 'Browse all JFR events as DuckDB tables via the Schema Explorer' },
    { icon: '⚡', text: 'Interactive zoom and pan on time-series charts' },
    { icon: '📓', text: 'Shareable notebooks saved as plain Markdown' },
];

const JFRDropZone: React.FC<JFRDropZoneProps> = ({ onFileSelected, isImporting, errorMessage, onLoadDemo, onLoadGcNotebook }) => {
    const [fileName, setFileName] = useState<string | null>(null);

    const onDrop = useCallback(async (accepted: File[]) => {
        const file = accepted[0];
        if (!file) return;
        setFileName(file.name);
        const buf = await file.arrayBuffer();
        onFileSelected(new Uint8Array(buf), file.name);
    }, [onFileSelected]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'application/octet-stream': ['.jfr', '.duckdb', '.db'] },
        multiple: false,
        disabled: isImporting,
    });

    return (
        <div className="w-screen h-screen flex items-center justify-center bg-gray-900">
            <div className="text-center p-8 max-w-xl w-full">
                <div className="flex items-center justify-center gap-4 mb-6">
                    <NotebookIcon className="w-12 h-12 text-cyan-400" />
                    <div className="text-left">
                        <h1 className="text-3xl font-bold text-white">JFR SQL Notebook</h1>
                        <p className="text-gray-400">Query JFR recordings with SQL, visualize results as charts.</p>
                    </div>
                </div>

                <div
                    {...getRootProps()}
                    className={`mt-4 border-2 border-dashed rounded-lg p-10 cursor-pointer transition-colors ${
                        isDragActive ? 'border-cyan-400 bg-cyan-900/20' : 'border-gray-600 bg-gray-800/40 hover:border-cyan-500'
                    } ${isImporting ? 'opacity-60 cursor-wait' : ''}`}
                >
                    <input {...getInputProps()} />
                    {isImporting ? (
                        <div className="flex flex-col items-center gap-4 text-gray-300">
                            <div className="w-8 h-8 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" role="status" />
                            <p>Importing {fileName ?? 'file'}…</p>
                            <p className="text-xs text-gray-500">Loading into in-browser DuckDB — runs entirely locally, nothing leaves your machine.</p>
                        </div>
                    ) : (
                        <div className="text-gray-300">
                            <p className="text-lg font-medium">{isDragActive ? 'Drop the file' : 'Drop a .jfr or .duckdb file here'}</p>
                            <p className="text-sm text-gray-500 mt-1">or click to choose one · runs entirely in-browser, no server needed</p>
                        </div>
                    )}
                </div>

                {errorMessage && (
                    <div className="mt-4 p-3 bg-red-900/40 border border-red-500/40 rounded text-red-300 text-sm text-left" role="alert">
                        <p className="font-semibold">Import failed</p>
                        <p className="mt-1">{errorMessage}</p>
                    </div>
                )}

                {(onLoadDemo || onLoadGcNotebook) && !isImporting && (
                    <div className="mt-4 flex flex-col items-center gap-2">
                        {onLoadDemo && (
                            <div className="text-center">
                                <button
                                    onClick={onLoadDemo}
                                    className="text-sm text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                                >
                                    Try the demo — no file needed
                                </button>
                                <p className="text-xs text-gray-600 mt-0.5">Loads sample JFR data with a starter notebook</p>
                            </div>
                        )}
                        {onLoadGcNotebook && (
                            <div className="text-center">
                                <button
                                    onClick={onLoadGcNotebook}
                                    className="text-sm text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
                                >
                                    Open GC analysis notebook
                                </button>
                                <p className="text-xs text-gray-600 mt-0.5">Full GC analysis notebook with queries, charts, and commentary</p>
                            </div>
                        )}
                    </div>
                )}

                <div className="mt-6 grid grid-cols-2 gap-2 text-left">
                    {FEATURE_HINTS.map((h, i) => (
                        <div key={i} className="flex items-start gap-2 p-2.5 bg-gray-800/40 rounded-lg text-xs text-gray-400">
                            <span className="text-base leading-none mt-0.5">{h.icon}</span>
                            <span>{h.text}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default JFRDropZone;
