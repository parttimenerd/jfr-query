import React from 'react';
import { DBState } from '../context/DuckDBContext';
import { NotebookIcon } from './icons/NotebookIcon';

interface FileLoaderProps {
    dbState: DBState;
    errorMessage: string | null;
}

const FileLoader: React.FC<FileLoaderProps> = ({ dbState, errorMessage }) => {
    return (
        <div className="w-screen h-screen flex items-center justify-center bg-gray-900">
            <div className="text-center p-8 max-w-lg">
                <div className="flex items-center justify-center gap-4 mb-6">
                    <NotebookIcon className="w-12 h-12 text-cyan-400" />
                    <div>
                        <h1 className="text-3xl font-bold text-white">JFR SQL Notebook</h1>
                        <p className="text-gray-400">An interactive notebook for analyzing JFR files with DuckDB.</p>
                    </div>
                </div>
                
                {dbState === DBState.SCHEMA_LOADING && (
                    <div className="mt-6 flex flex-col items-center justify-center gap-4 text-gray-400">
                        <div className="w-8 h-8 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" role="status">
                            <span className="sr-only">Loading...</span>
                        </div>
                        <p>Connecting to database...</p>
                    </div>
                )}
                
                {dbState === DBState.ERROR && (
                     <div className="mt-6 p-4 bg-red-900/50 border border-red-500/50 rounded-lg text-red-300 text-sm" role="alert">
                        <p className="font-semibold">Error Initializing Database</p>
                        <p className="mt-1">
                            {errorMessage || "An unknown error occurred. Please check the console and try again."}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FileLoader;