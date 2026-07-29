import React from 'react';

export interface BrushValue {
    lo: number;
    hi: number;
    unit?: string;
    column?: string;
}

interface FilterChipProps {
    /** The raw filter_from value, e.g. "$gc.brush" */
    filterFrom: string;
    /** The resolved brush value, if the variable is set */
    brushValue?: BrushValue | null;
    /** Called when the user clicks the × to remove the filter */
    onRemove: () => void;
}

/** Format a nanosecond epoch as a short readable string. */
function fmtNs(ns: number): string {
    const s = ns / 1e9;
    if (s >= 1) return `${s.toFixed(2)}s`;
    const ms = ns / 1e6;
    if (ms >= 1) return `${ms.toFixed(1)}ms`;
    const us = ns / 1e3;
    if (us >= 1) return `${us.toFixed(0)}µs`;
    return `${ns}ns`;
}

/** Attempt to format a numeric value. If the numbers are large (>1e6) assume nanoseconds. */
function fmtValue(v: number): string {
    if (v > 1e6) return fmtNs(v);
    if (v > 1000) return v.toLocaleString();
    return String(v);
}

const FilterChip: React.FC<FilterChipProps> = ({ filterFrom, brushValue, onRemove }) => {
    // Strip the leading "$" for display: "$gc.brush" → "gc.brush"
    const displayName = filterFrom.startsWith('$') ? filterFrom.slice(1) : filterFrom;

    let valueLabel: React.ReactNode;
    if (brushValue) {
        valueLabel = (
            <span className="text-cyan-300 font-mono text-[10px]">
                {fmtValue(brushValue.lo)} → {fmtValue(brushValue.hi)}
            </span>
        );
    } else {
        valueLabel = (
            <span className="text-gray-500 italic text-[10px]">waiting...</span>
        );
    }

    return (
        <div
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-mono
                ${brushValue
                    ? 'bg-cyan-900/30 border-cyan-700/60 text-cyan-200'
                    : 'bg-gray-700/40 border-gray-600/60 text-gray-400'
                }`}
            title={`filter_from: ${filterFrom}`}
        >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 flex-shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
            </svg>
            <span className="opacity-70">Filter:</span>
            <span>{displayName}</span>
            <span className="opacity-50 mx-0.5">·</span>
            {valueLabel}
            <button
                onClick={onRemove}
                className="ml-0.5 hover:text-red-400 opacity-60 hover:opacity-100 transition-opacity"
                title="Remove filter"
                aria-label="Remove filter"
            >
                ×
            </button>
        </div>
    );
};

export default FilterChip;
