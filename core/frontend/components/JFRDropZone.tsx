import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { NotebookIcon } from './icons/NotebookIcon';

interface JFRDropZoneProps {
    onFileSelected: (bytes: Uint8Array, name: string) => void;
    isImporting: boolean;
    errorMessage: string | null;
}

const JFRDropZone: React.FC<JFRDropZoneProps> = ({ onFileSelected, isImporting, errorMessage }) => {
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
        accept: { 'application/octet-stream': ['.jfr'] },
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
                        <p className="text-gray-400">Running fully in-browser — drop a recording to begin.</p>
                    </div>
                </div>

                <div
                    {...getRootProps()}
                    className={`mt-6 border-2 border-dashed rounded-lg p-12 cursor-pointer transition-colors ${
                        isDragActive ? 'border-cyan-400 bg-cyan-900/20' : 'border-gray-600 bg-gray-800/40 hover:border-cyan-500'
                    } ${isImporting ? 'opacity-60 cursor-wait' : ''}`}
                >
                    <input {...getInputProps()} />
                    {isImporting ? (
                        <div className="flex flex-col items-center gap-4 text-gray-300">
                            <div className="w-8 h-8 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" role="status" />
                            <p>Importing {fileName ?? 'JFR'}…</p>
                            <p className="text-xs text-gray-500">Parsing events and writing them into in-browser DuckDB.</p>
                        </div>
                    ) : (
                        <div className="text-gray-300">
                            <p className="text-lg font-medium">{isDragActive ? 'Drop the .jfr file' : 'Drop a .jfr file here'}</p>
                            <p className="text-sm text-gray-500 mt-1">or click to choose one</p>
                        </div>
                    )}
                </div>

                {errorMessage && (
                    <div className="mt-4 p-3 bg-red-900/40 border border-red-500/40 rounded text-red-300 text-sm text-left" role="alert">
                        <p className="font-semibold">Import failed</p>
                        <p className="mt-1">{errorMessage}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default JFRDropZone;
