import React from 'react';
import type { PlotRegistration, PlotParameter } from './plots/plotTypes';
import { ChartBarIcon } from './icons/ChartBarIcon';
import { CodeBracketIcon } from './icons/CodeBracketIcon';
import { LinkIcon } from './icons/LinkIcon';
import type { ClauseDoc } from '../utils/plotClauseDocs';

interface PlotTooltipContentProps {
    item: PlotRegistration | { name: string, definitions: { funcName: string, param: PlotParameter }[] } | ClauseDoc;
    type: 'function' | 'parameter' | 'clause';
}

export const PlotTooltipContent: React.FC<PlotTooltipContentProps> = ({ item, type }) => {
    if (type === 'function') {
        const plot = item as PlotRegistration;
        return (
            <div className="space-y-2 text-sm">
                <p className="font-semibold text-cyan-300 flex items-center gap-1.5">
                    <ChartBarIcon className="w-4 h-4" />
                    {plot.name}
                </p>
                <p className="text-xs text-gray-300 italic">{plot.description}</p>
                {plot.params.length > 0 && (
                    <div className="pt-2">
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Parameters</h4>
                        <ul className="text-xs text-gray-400 mt-1 pl-2 border-l border-gray-500 ml-2 space-y-1.5">
                            {plot.params.map(p => (
                                <li key={p.name}>
                                    <div>
                                        <span className="font-mono text-purple-300 font-semibold">{p.name}</span>
                                        <span className="text-yellow-400 ml-1">({p.type})</span>
                                        {p.required && <span className="text-red-400 text-xs font-bold ml-2">Required</span>}
                                    </div>
                                    <div className="pl-2 text-gray-300">{p.description}</div>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        );
    }

    if (type === 'parameter') {
        const paramInfo = item as { name: string, definitions: { funcName: string, param: PlotParameter }[] };
        return (
             <div className="space-y-2 text-sm">
                <p className="font-semibold text-purple-300 flex items-center gap-1.5">
                    <CodeBracketIcon className="w-4 h-4" />
                    Parameter: {paramInfo.name}
                </p>
                <div className="pt-2">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Usage</h4>
                    <ul className="text-xs text-gray-400 mt-1 pl-2 border-l border-gray-500 ml-2 space-y-2">
                        {paramInfo.definitions.map(def => (
                            <li key={def.funcName}>
                                <strong className="text-cyan-300">{def.funcName}</strong>: {def.param.description}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        )
    }

    if (type === 'clause') {
        const clause = item as ClauseDoc;
        return (
            <div className="space-y-2 text-sm">
                <p className="font-semibold text-cyan-300 flex items-center gap-1.5">
                    <LinkIcon className="w-4 h-4" />
                    Clause: {clause.name}
                </p>
                <p className="font-mono text-xs bg-gray-800 p-1 rounded-md">{clause.signature}</p>
                <p className="text-xs text-gray-300 italic">{clause.description}</p>
                {clause.params.length > 0 && (
                    <div className="pt-2">
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Parameters</h4>
                        <ul className="text-xs text-gray-400 mt-1 pl-2 border-l border-gray-500 ml-2 space-y-1.5">
                            {clause.params.map(p => (
                                <li key={p.name}>
                                    <div>
                                        <span className="font-mono text-purple-300 font-semibold">{p.name}</span>
                                        <span className="text-yellow-400 ml-1">({p.type})</span>
                                        {p.required && <span className="text-red-400 text-xs font-bold ml-2">Required</span>}
                                    </div>
                                    <div className="pl-2 text-gray-300">{p.description}</div>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        );
    }

    return null;
};