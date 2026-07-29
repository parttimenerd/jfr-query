import React, { useState, useRef, useEffect, useCallback } from 'react';

interface SessionDateChipProps {
    label: string;        // e.g. "$session_start"
    value: string;        // ISO datetime string or empty
    onChange: (value: string) => void;
    placeholder?: string;
    /** Recording-range floor as epoch-ms. When set, the picker is bounded and out-of-range typed values clamp on blur. */
    min?: number | null;
    /** Recording-range ceiling as epoch-ms. */
    max?: number | null;
    /** Used when `value` is empty: shown in the picker as the starting datetime and committed on blur if the user doesn't change it. */
    defaultIfEmpty?: number | null;
}

// epoch-ms → "YYYY-MM-DDTHH:mm" in local time, the format <input type="datetime-local"> expects.
// Returns '' when the input is null/undefined/NaN.
export function epochMsToLocalIso(ms: number | null | undefined): string {
    if (ms == null || !Number.isFinite(ms)) return '';
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "YYYY-MM-DDTHH:mm[:ss]" in local time → epoch-ms. Returns null on invalid input.
export function localIsoToEpochMs(iso: string): number | null {
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) ? ms : null;
}

// Clamp an ISO datetime-local string to [min, max] (both epoch-ms). Returns the original
// string when no clamp is required, or a reformatted ISO string when clamped.
export function clampIso(iso: string, min: number | null | undefined, max: number | null | undefined): string {
    const ms = localIsoToEpochMs(iso);
    if (ms == null) return iso;
    if (min != null && ms < min) return epochMsToLocalIso(min);
    if (max != null && ms > max) return epochMsToLocalIso(max);
    return iso;
}

/**
 * Given the current notebook variables map and the loaded recording range, returns
 * an updated variables map with `session_start` and/or `session_end` seeded to the
 * recording range endpoints — but ONLY when the variable is missing or empty AND the
 * corresponding recording bound is available.
 *
 * Returns the original map object (same reference) when no seeding is needed, so
 * callers can use a cheap reference-equality check to skip redundant writes.
 *
 * This is a pure function with no side-effects so it can be tested in isolation.
 */
export function computeSessionVariables(
    currentVars: Record<string, string>,
    recordingStart: number | null | undefined,
    recordingEnd: number | null | undefined,
): Record<string, string> {
    const needsStart = !currentVars['$session_start'] && recordingStart != null && Number.isFinite(recordingStart);
    const needsEnd = !currentVars['$session_end'] && recordingEnd != null && Number.isFinite(recordingEnd);
    if (!needsStart && !needsEnd) return currentVars;
    const updated = { ...currentVars };
    if (needsStart) updated['$session_start'] = epochMsToLocalIso(recordingStart!);
    if (needsEnd) updated['$session_end'] = epochMsToLocalIso(recordingEnd!);
    return updated;
}

/**
 * A compact topbar chip that shows a session date variable.
 * Click to expand an inline datetime-local input; Enter/Blur commits the value.
 * The value is stored as an ISO datetime string and substituted into SQL like any $var.
 *
 * Optional `min`/`max` (epoch-ms) bound the picker to the recording range and clamp
 * out-of-range typed values on commit. `defaultIfEmpty` (epoch-ms) seeds the picker
 * when no value has been set yet.
 */
const SessionDateChip: React.FC<SessionDateChipProps> = ({ label, value, onChange, placeholder, min, max, defaultIfEmpty }) => {
    const [expanded, setExpanded] = useState(false);
    const [draft, setDraft] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setDraft(value);
    }, [value]);

    useEffect(() => {
        if (expanded) {
            inputRef.current?.focus();
        }
    }, [expanded]);

    const commit = useCallback(() => {
        // If draft is empty and a defaultIfEmpty seed was provided, commit the seed value.
        const effective = draft || (defaultIfEmpty != null ? epochMsToLocalIso(defaultIfEmpty) : '');
        const clamped = clampIso(effective, min, max);
        if (clamped !== draft) setDraft(clamped);
        onChange(clamped);
        setExpanded(false);
    }, [draft, defaultIfEmpty, onChange, min, max]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
            setDraft(value);
            setExpanded(false);
        }
    };

    const displayValue = value
        ? (() => {
            // value is a datetime-local string like "2023-06-15T10:30" — no timezone.
            // new Date("2023-06-15T10:30") is parsed as UTC by V8, so toLocaleString
            // would shift by the local UTC offset. Append a colon-less offset to keep it local.
            const tzOffset = new Date().getTimezoneOffset();
            const sign = tzOffset <= 0 ? '+' : '-';
            const abs = Math.abs(tzOffset);
            const tzStr = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
            return new Date(`${value.slice(0, 16)}:00${tzStr}`).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        })()
        : (placeholder ?? '—');

    const inputValue = draft
        ? draft.slice(0, 16)
        : epochMsToLocalIso(defaultIfEmpty);
    const minIso = epochMsToLocalIso(min);
    const maxIso = epochMsToLocalIso(max);

    if (expanded) {
        return (
            <div className="flex items-center gap-1 bg-gray-800 border border-cyan-600/50 rounded px-1.5 py-0.5">
                <span className="text-[10px] text-cyan-500 font-mono shrink-0">{label}</span>
                <span className="text-gray-600 text-[10px]">=</span>
                <input
                    ref={inputRef}
                    type="datetime-local"
                    value={inputValue}
                    min={minIso || undefined}
                    max={maxIso || undefined}
                    onChange={e => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={handleKeyDown}
                    aria-label={label}
                    className="bg-transparent text-xs text-gray-200 outline-none border-none w-40 font-mono cursor-pointer"
                />
                {draft && (
                    <button
                        onMouseDown={e => { e.preventDefault(); onChange(''); setDraft(''); setExpanded(false); }}
                        className="text-gray-600 hover:text-gray-400 text-[10px] ml-0.5"
                        title="Clear"
                        aria-label={`Clear ${label}`}
                    >×</button>
                )}
            </div>
        );
    }

    return (
        <button
            onClick={() => setExpanded(true)}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono transition-colors ${
                value
                    ? 'border-cyan-700/60 text-cyan-300 bg-cyan-900/20 hover:bg-cyan-900/40'
                    : 'border-gray-700/60 text-gray-500 bg-transparent hover:border-gray-600 hover:text-gray-400'
            }`}
            title={`${label}: ${value || 'not set'} — click to edit`}
            aria-label={`${label}: ${value || 'not set'} — click to edit`}
        >
            <span className="text-[9px] opacity-60">{label}</span>
            <span className="text-[10px]">{displayValue}</span>
        </button>
    );
};

export default SessionDateChip;
