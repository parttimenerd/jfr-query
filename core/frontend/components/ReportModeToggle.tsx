import React from 'react';

interface Props {
    active: boolean;
    onToggle: () => void;
}

const ReportModeToggle: React.FC<Props> = ({ active, onToggle }) => {
    if (active) {
        return (
            <button
                onClick={onToggle}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-cyan-600/30 text-cyan-300 border border-cyan-500/50 hover:bg-cyan-600/50 transition-colors"
                title="Exit Report Mode"
                aria-label="Exit Report Mode"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Exit Report
            </button>
        );
    }
    return (
        <button
            onClick={onToggle}
            className="p-1.5 rounded-md text-gray-400 hover:text-cyan-300 hover:bg-cyan-600/20 transition-colors"
            title="Report Mode — hide editors, show results only"
            aria-label="Enter Report Mode"
        >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
        </button>
    );
};

export default ReportModeToggle;
