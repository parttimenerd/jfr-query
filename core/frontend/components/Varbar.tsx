import React, { useState, useRef, useEffect, useCallback } from 'react';

interface VarbarProps {
    variables: Record<string, unknown>;
    onVariableChange: (vars: Record<string, unknown>) => void;
    paused: boolean;
    onTogglePause: () => void;
}

/** Format a variable value for display in a pill. */
function formatValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
        if (value.startsWith('{')) {
            try {
                const obj = JSON.parse(value) as Record<string, unknown>;
                if (typeof obj.lo === 'number' && typeof obj.hi === 'number') {
                    const lo = Number(obj.lo.toPrecision(6));
                    const hi = Number(obj.hi.toPrecision(6));
                    return `${lo} … ${hi}`;
                }
                return value;
            } catch {
                return value;
            }
        }
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if (typeof obj.lo === 'number' && typeof obj.hi === 'number') {
            const lo = Number(obj.lo.toPrecision(6));
            const hi = Number(obj.hi.toPrecision(6));
            return `${lo} … ${hi}`;
        }
        return JSON.stringify(value);
    }
    return String(value);
}

function isVisible(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.length > 0;
    return true;
}

function isSubKey(key: string, allKeys: string[]): boolean {
    return allKeys.some(k => k !== key && key.startsWith(k + '.'));
}

function isScalar(value: unknown): boolean {
    if (typeof value === 'string') {
        if (value.startsWith('{')) return false;
        return true;
    }
    return typeof value === 'number' || typeof value === 'boolean';
}

// ---------------------------------------------------------------------------
// Per-pill popover
// ---------------------------------------------------------------------------
const VarPillPopover: React.FC<{
    name: string;
    value: unknown;
    anchorEl: HTMLElement;
    onClose: () => void;
    onEdit: (val: string) => void;
    onClear: () => void;
}> = ({ name, value, anchorEl, onClose, onEdit, onClear }) => {
    const popRef = useRef<HTMLDivElement>(null);
    const [editVal, setEditVal] = useState(String(value ?? ''));
    const [pos, setPos] = useState({ top: 0, left: 0 });

    useEffect(() => {
        const rect = anchorEl.getBoundingClientRect();
        const top = rect.bottom + 4;
        const left = Math.min(rect.left, window.innerWidth - 260);
        setPos({ top, left });
    }, [anchorEl]);

    useEffect(() => {
        const onMouseDown = (e: MouseEvent) => {
            if (popRef.current && !popRef.current.contains(e.target as Node) &&
                !anchorEl.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, [anchorEl, onClose]);

    const handleEditSubmit = useCallback(() => {
        onEdit(editVal);
        onClose();
    }, [editVal, onEdit, onClose]);

    const scalar = isScalar(value);
    const displayFull = (() => {
        if (typeof value === 'string' && value.startsWith('{')) {
            try { return JSON.stringify(JSON.parse(value), null, 2); } catch { /* fall through */ }
        }
        return String(value ?? '');
    })();

    return (
        <div
            ref={popRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, minWidth: 220, maxWidth: 320 }}
            className="bg-gray-900 border border-gray-600 rounded-lg shadow-xl p-3 text-xs font-mono"
        >
            <div className="flex items-center justify-between mb-2">
                <span className="text-cyan-400 font-semibold">${name}</span>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-300 text-sm" aria-label="Close">×</button>
            </div>

            {scalar ? (
                <div className="flex items-center gap-1">
                    <input
                        autoFocus
                        type="text"
                        value={editVal}
                        onChange={e => setEditVal(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleEditSubmit(); if (e.key === 'Escape') onClose(); }}
                        aria-label={`Value for $${name}`}
                        className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-200 outline-none focus:border-cyan-500"
                    />
                    <button
                        onClick={handleEditSubmit}
                        aria-label={`Set value for $${name}`}
                        className="px-2 py-1 bg-cyan-700/50 hover:bg-cyan-700 text-cyan-200 rounded"
                    >Set</button>
                </div>
            ) : (
                <pre className="text-gray-300 bg-gray-800/60 rounded p-2 overflow-auto max-h-32 text-[10px] whitespace-pre-wrap">
                    {displayFull}
                </pre>
            )}

            <button
                onClick={() => { onClear(); onClose(); }}
                className="mt-2 w-full text-center text-[10px] text-red-400 hover:text-red-300"
            >
                × Clear variable
            </button>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Main Varbar component
// ---------------------------------------------------------------------------
const Varbar: React.FC<VarbarProps> = ({ variables, onVariableChange, paused, onTogglePause }) => {
    const allKeys = Object.keys(variables);
    const visibleEntries = Object.entries(variables).filter(
        ([k, v]) => isVisible(v) && !isSubKey(k, allKeys)
    );

    const [activePopover, setActivePopover] = useState<{ name: string; anchor: HTMLElement } | null>(null);

    const handleClear = (name: string) => {
        if (activePopover?.name === name) setActivePopover(null);
        const next = { ...variables };
        const prefix = name + '.';
        for (const k of Object.keys(next)) {
            if (k === name || k.startsWith(prefix)) delete next[k];
        }
        onVariableChange(next);
    };

    const handleEdit = (name: string, val: string) => {
        onVariableChange({ ...variables, [name]: val });
    };

    const handlePillClick = (e: React.MouseEvent<HTMLElement>, name: string) => {
        if (activePopover?.name === name) { setActivePopover(null); return; }
        setActivePopover({ name, anchor: e.currentTarget });
    };

    return (
        <div
            className={`flex-shrink-0 flex items-center gap-2 px-3 h-9 bg-gray-900/60 border-b border-gray-700/60 overflow-x-auto ${paused ? 'opacity-60' : ''}`}
            style={{ minHeight: '36px', maxHeight: '36px' }}
        >
            {/* Variable pills */}
            {visibleEntries.map(([name, value]) => (
                <span
                    key={name}
                    onClick={e => handlePillClick(e, name)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (activePopover?.name === name) { setActivePopover(null); } else { setActivePopover({ name, anchor: e.currentTarget as HTMLElement }); } } }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Variable $${name} = ${formatValue(variables[name])}. Press Enter to edit.`}
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gray-700/70 border border-gray-600/60 text-[11px] font-mono text-cyan-300 whitespace-nowrap flex-shrink-0 cursor-pointer hover:border-cyan-600/60"
                >
                    <span className="text-gray-400">$</span>
                    <span className="text-gray-300">{name}</span>
                    <span className="text-gray-500">=</span>
                    <span className="text-cyan-300">{formatValue(value)}</span>
                    <button
                        onClick={e => { e.stopPropagation(); handleClear(name); }}
                        title={`Clear ${name}`}
                        aria-label={`Clear variable $${name}`}
                        className="ml-0.5 text-gray-500 hover:text-red-400 leading-none"
                    >
                        ×
                    </button>
                </span>
            ))}

            {visibleEntries.length === 0 && !paused && (
                <span className="text-[10px] text-gray-600 italic">No active variables</span>
            )}

            {paused && (
                <span className="flex-shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-yellow-600/50 text-yellow-400 bg-yellow-900/20 ml-1">
                    PAUSED
                </span>
            )}

            <div className="flex-1" />

            <button
                onClick={onTogglePause}
                title={paused ? 'Resume variable updates' : 'Pause variable updates'}
                aria-label={paused ? 'Resume variable updates' : 'Pause variable updates'}
                aria-pressed={paused}
                className={`flex-shrink-0 flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border transition-colors ${
                    paused
                        ? 'border-yellow-600/60 text-yellow-400 bg-yellow-900/20 hover:bg-yellow-800/30'
                        : 'border-gray-600/60 text-gray-400 bg-gray-700/40 hover:text-yellow-300 hover:border-yellow-600/40'
                }`}
            >
                {paused ? '▶ Resume' : '⏸ Pause'}
            </button>

            {/* Variable popover (rendered via portal-like fixed positioning) */}
            {activePopover && (
                <VarPillPopover
                    name={activePopover.name}
                    value={variables[activePopover.name]}
                    anchorEl={activePopover.anchor}
                    onClose={() => setActivePopover(null)}
                    onEdit={val => handleEdit(activePopover.name, val)}
                    onClear={() => handleClear(activePopover.name)}
                />
            )}
        </div>
    );
};

export default Varbar;
