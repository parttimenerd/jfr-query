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
}

const boxCls = 'bg-gray-800 border border-gray-600 text-white text-xs p-2 rounded';

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
    active, payload, label, onHoverTooltip, tooltipColumns, labelFormatter,
}) => {
    if (!active || !payload || payload.length === 0) return null;

    if (onHoverTooltip) {
        return <div className={boxCls}>{formatPlaceholders(onHoverTooltip, payload)}</div>;
    }

    if (tooltipColumns && tooltipColumns.length > 0) {
        const shown = payload.filter(e => {
            const stripped = e.dataKey.replace(/^\d+_/, '');
            return tooltipColumns.includes(e.name) ||
                   tooltipColumns.includes(e.dataKey) ||
                   tooltipColumns.includes(stripped);
        });
        return (
            <div className={boxCls}>
                {label !== undefined && (
                    <div className="mb-1 opacity-80">
                        {labelFormatter ? labelFormatter(label) : String(label)}
                    </div>
                )}
                {shown.map((e) => (
                    <div key={e.dataKey} style={{ color: e.color }}>
                        <span className="opacity-80">{e.name.replace(/_/g, ' ')}:</span>{' '}
                        <span>{String(e.value)}</span>
                    </div>
                ))}
            </div>
        );
    }

    return null;
};
