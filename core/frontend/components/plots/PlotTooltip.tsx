import React from 'react';

export interface PlotTooltipEntry {
    name: string;
    value: unknown;
    dataKey: string;
    color?: string;
}

export interface PlotTooltipProps {
    active?: boolean;
    payload?: PlotTooltipEntry[];
    label?: unknown;
    onHoverTooltip?: string;
    tooltipColumns?: string[];
    labelFormatter?: (label: unknown) => string;
    /** Optional per-entry formatter: receives (value, name, entry) and returns [displayValue, displayName]. */
    entryFormatter?: (value: unknown, name: string, entry: PlotTooltipEntry) => [string, string] | null;
}

export function formatTooltipValue(val: unknown): string {
    if (typeof val === 'number') {
        if (!isFinite(val)) return String(val);
        if (Math.abs(val) > 0 && Math.abs(val) < 0.01) {
            return val.toPrecision(3);
        }
        return val.toLocaleString('en-US', { maximumFractionDigits: 3 });
    }
    return String(val ?? '');
}

const boxCls = [
    'bg-gray-900/95 border border-gray-600/70',
    'text-xs rounded-lg shadow-xl',
    'px-3 py-2 min-w-[120px] max-w-[280px]',
].join(' ');
const labelCls = 'text-gray-400 truncate max-w-[160px]';
const valueCls = 'text-gray-100 font-mono font-medium text-right ml-3 shrink-0';
const headerCls = 'text-gray-300 font-semibold border-b border-gray-700 pb-1 mb-1.5 truncate';

const lookup = (payload: PlotTooltipEntry[], key: string): unknown => {
    for (const e of payload) {
        if (e.name === key || e.dataKey === key) return e.value;
        // Strip multi-query numeric prefix (e.g. "1_colName" → "colName")
        if (e.dataKey.replace(/^\d+_/, '') === key) return e.value;
    }
    return undefined;
};

const formatPlaceholders = (fmt: string, payload: PlotTooltipEntry[]): string =>
    fmt.replace(/\{(\w[\w]*)\}/g, (_m, key: string) => {
        const fromPayload = lookup(payload, key);
        if (fromPayload !== undefined) return String(fromPayload);
        // Recharts passes the full data row as entry.payload — check there for X-axis columns too
        for (const e of payload) {
            const raw = (e as any).payload;
            if (raw && key in raw) return String(raw[key]);
            // Also check stripped key in raw payload
            if (raw) {
                for (const rawKey of Object.keys(raw)) {
                    if (rawKey.replace(/^\d+_/, '') === key) return String(raw[rawKey]);
                }
            }
        }
        return '';
    });

export const PlotTooltip: React.FC<PlotTooltipProps> = ({
    active, payload, label, onHoverTooltip, tooltipColumns, labelFormatter, entryFormatter,
}) => {
    if (!active || !payload || payload.length === 0) return null;

    if (onHoverTooltip) {
        return <div className={boxCls}>{formatPlaceholders(onHoverTooltip, payload)}</div>;
    }

    if (tooltipColumns && tooltipColumns.length > 0) {
        const shown = payload.filter(e => {
            const stripped = e.dataKey.replace(/^\d+_/, '');
            if (tooltipColumns.includes(e.name) ||
                tooltipColumns.includes(e.dataKey) ||
                tooltipColumns.includes(stripped)) return true;
            // For plots that rename columns to internal keys (e.g. RangePlot uses
            // __rangeLow/__rangeHigh), check if any user-specified column exists in
            // the raw row payload so TOOLTIP COLUMNS still works.
            const rowKeys = Object.keys((e as any).payload ?? {});
            return tooltipColumns.some(col => rowKeys.includes(col));
        });
        return (
            <div className={boxCls}>
                {label !== undefined && (
                    <div className={headerCls}>
                        {labelFormatter ? labelFormatter(label) : formatTooltipValue(label)}
                    </div>
                )}
                {shown.map((e) => (
                    <div key={e.dataKey} className="flex items-center justify-between gap-2">
                        <span className={labelCls} style={{ color: e.color ? `${e.color}cc` : undefined }}>
                            {e.name.replace(/_/g, ' ')}
                        </span>
                        <span className={valueCls}>{formatTooltipValue(e.value)}</span>
                    </div>
                ))}
            </div>
        );
    }

    // Default: show all payload entries, applying entryFormatter if provided.
    const entries = entryFormatter
        ? payload.map(e => {
            const formatted = entryFormatter(e.value, e.name, e);
            return formatted ? { ...e, name: formatted[1], displayValue: formatted[0] } : null;
          }).filter(Boolean) as Array<PlotTooltipEntry & { displayValue: string }>
        : payload.map(e => ({ ...e, displayValue: formatTooltipValue(e.value) }));

    return (
        <div className={boxCls}>
            {label !== undefined && (
                <div className={headerCls}>
                    {labelFormatter ? labelFormatter(label) : formatTooltipValue(label)}
                </div>
            )}
            <div className="space-y-0.5">
                {entries.map((e) => (
                    <div key={e.dataKey} className="flex items-center justify-between gap-2">
                        <span className={labelCls} style={{ color: e.color ? `${e.color}cc` : undefined }}>
                            {e.name.replace(/_/g, ' ')}
                        </span>
                        <span className={valueCls}>{e.displayValue}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};
