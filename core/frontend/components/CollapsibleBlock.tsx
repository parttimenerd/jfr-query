import React from 'react';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';

interface CollapsibleBlockProps {
    title: React.ReactNode;
    preview: string;
    isCollapsed: boolean;
    onToggle: () => void;
    children: React.ReactNode;
    controls: React.ReactNode;
    statusIndicator?: React.ReactNode;
    tourAnchor?: string;
}

const CollapsibleBlock: React.FC<CollapsibleBlockProps> = ({ title, preview, isCollapsed, onToggle, children, controls, statusIndicator, tourAnchor }) => {
    return (
        <div className="bg-gray-900/40 rounded-md border border-gray-700/60" data-tour={tourAnchor}>
            <div className="px-2 py-1.5 border-b border-gray-700/60 flex items-center justify-between">
                <div
                    className="flex items-center gap-2 cursor-pointer w-full overflow-hidden"
                    onClick={onToggle}
                    role="button"
                    tabIndex={0}
                    aria-expanded={!isCollapsed}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
                >
                    {isCollapsed ? <ChevronDownIcon className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" /> : <ChevronUpIcon className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />}
                    <div className="font-medium text-sm text-gray-300 select-none flex-shrink-0">{title}</div>
                    <span className="text-xs text-gray-500 font-mono truncate select-none">{preview}</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                    {statusIndicator}
                    {controls}
                </div>
            </div>
            {!isCollapsed && (
                <div className="animate-fade-in-down p-2">
                    {children}
                </div>
            )}
        </div>
    );
};

export default React.memo(CollapsibleBlock);