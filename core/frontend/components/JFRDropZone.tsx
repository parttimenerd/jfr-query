import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { NotebookIcon } from './icons/NotebookIcon';

const PERF_KEY = 'jfr_import_ms_per_byte';

interface JFRDropZoneProps {
    onFileSelected: (file: File, name: string, stacktraceDepth: number) => void;
    isImporting: boolean;
    importPhase?: string;
    importProgress?: number | null;
    errorMessage: string | null;
    onLoadDemo?: () => void;
    onLoadGcNotebook?: () => void;
    onOpenTemplates?: () => void;
    wasmInitializing?: boolean;
}

const FEATURE_HINTS = [
    { icon: '📊', text: 'SQL queries with charts — bar, line, scatter, flame graph, and more' },
    { icon: '🔎', text: 'Browse all JFR events as DuckDB tables via the Schema Explorer' },
    { icon: '⚡', text: 'Interactive zoom and pan on time-series charts' },
    { icon: '📓', text: 'Shareable notebooks saved as plain Markdown' },
];

// Files larger than this threshold show the depth selector before importing.
const LARGE_FILE_THRESHOLD_MB = 20;

const DEPTH_OPTIONS = [
    { value: 50, label: '50 frames', description: 'Full depth — slowest' },
    { value: 10, label: '10 frames', description: 'Default' },
    { value: 5,  label: '5 frames',  description: 'Faster' },
    { value: 0,  label: 'Skip',      description: 'No call stack — fastest' },
];

interface PendingFile {
    file: File;
    name: string;
    sizeMb: number;
}

const JFRDropZone: React.FC<JFRDropZoneProps> = ({ onFileSelected, isImporting, importPhase, importProgress, errorMessage, onLoadDemo, onLoadGcNotebook, onOpenTemplates, wasmInitializing }) => {
    const [fileName, setFileName] = useState<string | null>(null);
    const [fileBytes, setFileBytes] = useState<number | null>(null);
    const [fileMb, setFileMb] = useState<number | null>(null);
    const [isCjfrFile, setIsCjfrFile] = useState(false);
    const [pending, setPending] = useState<PendingFile | null>(null);
    const [selectedDepth, setSelectedDepth] = useState(10);

    // Estimated total duration, shown as "~Xs" hint below the bar.
    const estimatedSeconds = fileBytes != null ? (() => {
        try {
            const msPerByte = parseFloat(localStorage.getItem(PERF_KEY) ?? '') || 0.0012;
            return Math.round(fileBytes * msPerByte / 1000);
        } catch { return null; }
    })() : null;

    const onDrop = useCallback(async (accepted: File[]) => {
        const file = accepted[0];
        if (!file) return;
        setFileName(file.name);
        setFileBytes(file.size);
        const isJfr = file.name.toLowerCase().endsWith('.jfr');
        const isCjfr = file.name.toLowerCase().endsWith('.cjfr');
        const sizeMb = file.size / (1024 * 1024);
        setFileMb(sizeMb);
        setIsCjfrFile(isCjfr);

        // Show depth selector only for large .jfr files — CJFR has no stack depth option.
        if (isJfr && sizeMb > LARGE_FILE_THRESHOLD_MB) {
            // Default to Skip (depth=0) for very large files to minimize import time.
            setSelectedDepth(sizeMb > 100 ? 0 : 10);
            setPending({ file, name: file.name, sizeMb });
        } else {
            onFileSelected(file, file.name, 10);
        }
    }, [onFileSelected]);

    const confirmImport = useCallback(() => {
        if (!pending) return;
        const { file, name } = pending;
        setPending(null);
        onFileSelected(file, name, selectedDepth);
    }, [pending, selectedDepth, onFileSelected]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'application/octet-stream': ['.jfr', '.cjfr', '.duckdb', '.db'] },
        multiple: false,
        disabled: isImporting || !!pending,
    });

    if (pending) {
        return (
            <div className="w-screen h-screen flex items-center justify-center bg-gray-900">
                <div className="text-center p-8 max-w-md w-full">
                    <div className="flex items-center justify-center gap-4 mb-6">
                        <NotebookIcon className="w-10 h-10 text-cyan-400" />
                        <h1 className="text-2xl font-bold text-white">JFR SQL Notebook</h1>
                    </div>
                    <div className="bg-gray-800 border border-amber-500/40 rounded-lg p-5 text-left">
                        <p className="text-amber-300 font-semibold text-sm mb-1">Large file detected</p>
                        <p className="text-gray-400 text-xs mb-4">
                            <span className="text-white font-medium">{pending.name}</span> is{' '}
                            {pending.sizeMb.toFixed(0)} MB. In-browser import can be slow for large files.
                            Choose how many stack frames to store per event — fewer frames import faster.
                        </p>
                        {pending.sizeMb > 100 && (
                            <p className="text-amber-400/80 text-xs mb-3 flex items-start gap-1.5">
                                <span className="mt-0.5 shrink-0">⚠</span>
                                <span>For files this size, <strong>Skip</strong> is strongly recommended — stack resolution doubles import time.</span>
                            </p>
                        )}
                        <p className="text-gray-300 text-xs font-medium mb-2">Stack trace depth</p>
                        <div className="flex flex-col gap-2">
                            {DEPTH_OPTIONS.map(opt => (
                                <label key={opt.value} className={`flex items-center gap-3 p-2.5 rounded border cursor-pointer transition-colors ${
                                    selectedDepth === opt.value
                                        ? 'border-cyan-500 bg-cyan-900/20 text-white'
                                        : 'border-gray-600 bg-gray-700/30 text-gray-400 hover:border-gray-500'
                                }`}>
                                    <input
                                        type="radio"
                                        name="depth"
                                        value={opt.value}
                                        checked={selectedDepth === opt.value}
                                        onChange={() => setSelectedDepth(opt.value)}
                                        className="accent-cyan-400"
                                    />
                                    <span className="text-sm font-medium w-20">{opt.label}</span>
                                    <span className="text-xs text-gray-500">{opt.description}</span>
                                </label>
                            ))}
                        </div>
                        <div className="mt-4 flex gap-3">
                            <button
                                onClick={confirmImport}
                                className="flex-1 py-2 px-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm font-medium transition-colors"
                            >
                                Import
                            </button>
                            <button
                                onClick={() => { setPending(null); setFileName(null); }}
                                className="py-2 px-4 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

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
                        <div className="flex flex-col items-center gap-3 text-gray-300">
                            <p className="font-medium">Importing {fileName ?? 'file'}…</p>
                            <p className="text-sm text-gray-400">{importPhase ?? 'Parsing events…'}</p>
                            <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                                {importProgress != null ? (
                                    <div
                                        className="bg-cyan-400 h-2 rounded-full transition-[width] duration-500 ease-out"
                                        style={{ width: `${Math.round(importProgress * 100)}%` }}
                                    />
                                ) : (
                                    // Indeterminate pulse while no progress signal yet
                                    <div className="bg-cyan-400 h-2 rounded-full animate-pulse w-1/3" />
                                )}
                            </div>
                            {estimatedSeconds != null && estimatedSeconds > 2 && (importProgress ?? 0) < 0.8 && (
                                <p className="text-xs text-gray-500">~{estimatedSeconds}s estimated</p>
                            )}
                            {isCjfrFile && (fileMb ?? 0) > 50 && (importProgress ?? 0) < 0.7 && (
                                <p className="text-xs text-amber-400/70 max-w-xs">
                                    CJFR import is single-threaded — for files this large, the jfr-query CLI server is 5–10× faster.
                                </p>
                            )}
                            {((importProgress ?? 0) < 0.05) && (
                                <p className="text-xs text-gray-500">Runs entirely locally — nothing leaves your machine.</p>
                            )}
                        </div>
                    ) : (
                        <div className="text-gray-300">
                            <p className="text-lg font-medium">{isDragActive ? 'Drop the file' : 'Drop a .jfr or .duckdb file here'}</p>
                            <p className="text-sm text-gray-500 mt-1">or click to choose one · runs entirely in-browser, no server needed</p>
                            {wasmInitializing && (
                                <div className="mt-3 flex items-center justify-center gap-2 text-xs text-cyan-400/70">
                                    <div className="w-1.5 h-1.5 bg-cyan-400/70 rounded-full animate-pulse" />
                                    <span>Initializing engine…</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {errorMessage && (
                    <div className="mt-4 p-3 bg-red-900/40 border border-red-500/40 rounded text-red-300 text-sm text-left" role="alert">
                        <p className="font-semibold">Import failed</p>
                        <p className="mt-1">{errorMessage}</p>
                    </div>
                )}

                {(onLoadDemo || onOpenTemplates) && !isImporting && (
                    <>
                        <div className="mt-5 flex items-center gap-3 text-xs text-gray-600">
                            <div className="flex-1 border-t border-gray-700" />
                            <span>or try a built-in example</span>
                            <div className="flex-1 border-t border-gray-700" />
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {onLoadDemo && (
                                <button
                                    onClick={onLoadDemo}
                                    className="flex flex-col items-start gap-0.5 p-3.5 rounded-lg border border-cyan-700/50 bg-cyan-900/10 hover:bg-cyan-900/25 hover:border-cyan-600 transition-colors text-left"
                                >
                                    <span className="text-sm font-semibold text-cyan-300">▶ Try the demo</span>
                                    <span className="text-xs text-gray-400">Starter notebook with sample JFR data — no file needed</span>
                                </button>
                            )}
                            {onOpenTemplates && (
                                <button
                                    onClick={onOpenTemplates}
                                    className="flex flex-col items-start gap-0.5 p-3.5 rounded-lg border border-emerald-700/50 bg-emerald-900/10 hover:bg-emerald-900/25 hover:border-emerald-600 transition-colors text-left"
                                >
                                    <span className="text-sm font-semibold text-emerald-300">📄 Browse templates</span>
                                    <span className="text-xs text-gray-400">GC analysis, CPU profiling, memory leaks, I/O, threading & more</span>
                                </button>
                            )}
                        </div>
                    </>
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
