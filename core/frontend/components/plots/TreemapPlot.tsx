import React, { useContext, useMemo } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { SettingsContext } from '../../context/SettingsContext';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn, getPaletteColors } from '../../utils/plotUtils';
import type { ParsedPlotCall } from '../../utils/plotParser';

const DEFAULT_COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7300'];

interface TreemapConfig {
    label: string;
    value: string;
    colorBy?: string;
    showLabels?: boolean;
}

const params: PlotParameter[] = [
    { name: 'label', type: 'column', required: true, description: 'Column for node labels (category names).' },
    { name: 'value', type: 'column', required: true, description: 'Numeric column for node sizes.' },
    { name: 'colorBy', type: 'column', required: false, description: 'Column to derive node color from. Omit to use a sequential palette.' },
    { name: 'showLabels', type: 'boolean', required: false, defaultValue: true, description: 'Show text labels inside nodes.' },
];

const parseConfig = createConfigParser<TreemapConfig>(buildParserSpec(params));

interface CustomNodeProps {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    name?: string;
    fill?: string;
    showLabels?: boolean;
}

const CustomNode: React.FC<CustomNodeProps> = ({ x = 0, y = 0, width = 0, height = 0, name = '', fill = '#8884d8', showLabels = true }) => {
    const maxChars = Math.floor(width / 7);
    const truncatedName = name.length > maxChars ? name.slice(0, maxChars) + '…' : name;
    const fontSize = Math.min(12, width / 6);
    const showText = showLabels && width >= 30 && height >= 20;

    return (
        <g>
            <rect
                x={x}
                y={y}
                width={width}
                height={height}
                style={{ fill, stroke: '#fff', strokeWidth: 2 }}
            />
            {showText && (
                <text
                    x={x + width / 2}
                    y={y + height / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{ fill: '#fff', fontSize, pointerEvents: 'none' }}
                >
                    {truncatedName}
                </text>
            )}
        </g>
    );
};

const TreemapComponent: React.FC<{
    config: TreemapConfig;
    data: any[];
    isAnimationActive?: boolean;
    animationDuration?: number;
    clauses?: ParsedPlotCall;
}> = ({ config, data, isAnimationActive, clauses }) => {
    // SettingsContext consumed for future use (consistent with other plots)
    useContext(SettingsContext);
    const colors = getPaletteColors(clauses?.palette, DEFAULT_COLORS);
    const showLabels = config.showLabels ?? true;

    const chartData = useMemo(() => {
        if (!data || data.length === 0) return [];
        const allColumns = Object.keys(data[0]);
        const labelCol = findColumn(config.label, allColumns);
        const valueCol = findColumn(config.value, allColumns);
        const colorByCol = config.colorBy ? findColumn(config.colorBy, allColumns) : undefined;

        const colorMap = new Map<string, string>();
        let colorCounter = 0;
        const getColor = (key: string): string => {
            if (!colorMap.has(key)) {
                colorMap.set(key, colors[colorCounter % colors.length]);
                colorCounter++;
            }
            return colorMap.get(key)!;
        };

        return data
            .map(row => {
                const name = String(row[labelCol] ?? '');
                const size = parseFloat(row[valueCol]);
                if (isNaN(size) || size <= 0) return null;
                const colorKey = colorByCol ? String(row[colorByCol] ?? '') : name;
                return { name, size, fill: getColor(colorKey) };
            })
            .filter((item): item is { name: string; size: number; fill: string } => item !== null);
    }, [data, config.label, config.value, config.colorBy, colors]);

    if (chartData.length === 0) {
        return <div className="p-4 text-center text-gray-500 text-sm">No valid data.</div>;
    }

    return (
        <div style={{ width: '100%', minHeight: 200 }}>
            <ResponsiveContainer width="100%" minHeight={200}>
                <Treemap
                    data={chartData}
                    dataKey="size"
                    aspectRatio={4 / 3}
                    isAnimationActive={isAnimationActive}
                    content={(props: any) => (
                        <CustomNode
                            {...props}
                            showLabels={showLabels}
                        />
                    )}
                >
                    <Tooltip formatter={(v: any, name: any) => [v, name]} />
                </Treemap>
            </ResponsiveContainer>
        </div>
    );
};

export const treemapPlot: PlotRegistration<TreemapConfig> = {
    name: 'TREEMAP',
    description: 'Treemap — shows hierarchical data as nested rectangles sized by a numeric value.',
    params: withCommonParams(params),
    supportsMultiQuery: false,
    template: 'TREEMAP(label: "$label", value: "$value")',
    examples: [
        {
            description: 'Allocation by class (sized by weight)',
            code: 'TREEMAP(label: "objectClass", value: "weight")',
        },
        {
            description: 'Heap regions sized by live data, colored by region type',
            code: 'TREEMAP(label: "region", value: "liveData", colorBy: "type")',
        },
        {
            description: 'Method call count treemap with labels hidden',
            code: 'TREEMAP(label: "method", value: "callCount", showLabels: false) TITLE "Call distribution"',
        },
    ],
    parseConfig,
    component: TreemapComponent,
};
