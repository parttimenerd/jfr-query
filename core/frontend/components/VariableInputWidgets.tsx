import React from 'react';

export interface VariableInputWidgetProps {
    inputType: 'slider' | 'dropdown' | 'datetime';
    varName: string;
    currentValue: string;
    attrs: Record<string, string>;
    onChange: (varName: string, value: string) => void;
}

export const VariableInputWidget: React.FC<VariableInputWidgetProps> = ({
    inputType,
    varName,
    currentValue,
    attrs,
    onChange,
}) => {
    const label = attrs.label ?? varName.replace(/^\$/, '');

    if (inputType === 'slider') {
        const min = parseFloat(attrs.min ?? '0');
        const max = parseFloat(attrs.max ?? '100');
        const step = parseFloat(attrs.step ?? '1');
        const current = parseFloat(currentValue) || min;
        return (
            <div className="flex items-center gap-3 py-2">
                <span className="text-xs text-gray-400 min-w-[80px]">{label}</span>
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={current}
                    onChange={e => onChange(varName, e.target.value)}
                    className="flex-1 accent-cyan-400"
                />
                <span className="text-xs text-cyan-300 min-w-[40px] text-right tabular-nums">{current}</span>
            </div>
        );
    }

    if (inputType === 'dropdown') {
        const options = (attrs.options ?? '').split(',').map(s => s.trim()).filter(Boolean);
        return (
            <div className="flex items-center gap-3 py-2">
                <span className="text-xs text-gray-400 min-w-[80px]">{label}</span>
                <select
                    value={currentValue}
                    onChange={e => onChange(varName, e.target.value)}
                    className="bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-2 py-1 focus:outline-none focus:border-cyan-500"
                >
                    {options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
            </div>
        );
    }

    if (inputType === 'datetime') {
        return (
            <div className="flex items-center gap-3 py-2">
                <span className="text-xs text-gray-400 min-w-[80px]">{label}</span>
                <input
                    type="datetime-local"
                    value={currentValue}
                    onChange={e => onChange(varName, e.target.value)}
                    className="bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-2 py-1 focus:outline-none focus:border-cyan-500"
                />
            </div>
        );
    }

    return null;
};
