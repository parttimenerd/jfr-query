import React, { useMemo } from 'react';
import DataTable from './DataTable';

interface CompareViewProps {
    candidateData: any[] | null;
    baselineData: any[] | null;
    candidateLabel?: string;
    baselineLabel?: string;
}

const CompareView: React.FC<CompareViewProps> = ({
    candidateData,
    baselineData,
    candidateLabel = 'Candidate',
    baselineLabel = 'Baseline',
}) => {
    const headers = useMemo(() => {
        const candidateKeys = candidateData && candidateData.length > 0 ? Object.keys(candidateData[0]) : [];
        const baselineKeys = baselineData && baselineData.length > 0 ? Object.keys(baselineData[0]) : [];
        // Union of both schemas, candidate keys first, then any baseline-only extras
        const extra = baselineKeys.filter(k => !candidateKeys.includes(k));
        return [...candidateKeys, ...extra];
    }, [candidateData, baselineData]);

    const renderPane = (data: any[] | null, label: string, accent: string) => (
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            <div className={`flex-shrink-0 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border-b border-gray-700/60 ${accent}`}>
                {label}
                {data && <span className="ml-2 font-normal opacity-60">{data.length.toLocaleString()} rows</span>}
            </div>
            {data ? (
                <div className="flex-1 overflow-auto">
                    <DataTable data={data} headers={headers} showSearch={false} />
                </div>
            ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
                    No data
                </div>
            )}
        </div>
    );

    return (
        <div className="flex h-full divide-x divide-gray-700/60">
            {renderPane(candidateData, candidateLabel, 'text-cyan-400 bg-cyan-900/10')}
            {renderPane(baselineData, baselineLabel, 'text-amber-400 bg-amber-900/10')}
        </div>
    );
};

export default CompareView;
