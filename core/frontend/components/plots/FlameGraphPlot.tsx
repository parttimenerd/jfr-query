import React, { useState } from 'react';
import { PlotRegistration, PlotParameter } from './plotTypes';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec } from '../../utils/plotUtils';

// --- Internal FlameGraph Rendering Logic ---

interface FlameGraphNodeData {
    name: string;
    value: number;
    children: FlameGraphNodeData[];
}

const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xFF;
        color += ('00' + value.toString(16)).substr(-2);
    }
    return color;
};

const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const FlameGraphNode: React.FC<{
    node: FlameGraphNodeData;
    totalValue: number;
    parentValue: number;
}> = ({ node, totalValue, parentValue }) => {
    const [isHovered, setIsHovered] = useState(false);
    const widthPercent = (node.value / parentValue) * 100;
    const color = stringToColor(node.name);

    if (widthPercent < 0.1) return null;

    return (
        <div
            className="relative flex flex-col"
            style={{ width: `${widthPercent}%` }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div
                title={`${node.name} (${((node.value / totalValue) * 100).toFixed(2)}%)`}
                className="h-6 text-xs text-white px-1 overflow-hidden whitespace-nowrap border-b border-l border-gray-900 flex items-center justify-center transition-all"
                style={{ 
                    backgroundColor: hexToRgba(color, isHovered ? 1 : 0.8),
                    filter: isHovered ? 'brightness(1.2)' : 'brightness(1)',
                }}
            >
                {node.name}
            </div>
            {isHovered && (
                 <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-2 bg-gray-900 text-white text-xs rounded-md shadow-lg z-10 whitespace-nowrap pointer-events-none">
                    <div><strong>{node.name}</strong></div>
                    <div>Samples: {node.value}</div>
                    <div>{((node.value / totalValue) * 100).toFixed(2)}% of total</div>
                </div>
            )}
            {node.children && node.children.length > 0 && (
                <div className="flex w-full">
                    {node.children.map((child, index) => (
                        <FlameGraphNode
                            key={index}
                            node={child}
                            totalValue={totalValue}
                            parentValue={node.value}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// --- Plot Module Implementation ---

interface FlameGraphConfig {
  label: string;
  value: string;
}

const params: PlotParameter[] = [
    { name: 'label', type: 'column', description: 'A column with semicolon-separated stack frames.', required: true },
    { name: 'value', type: 'column', description: 'A numeric column representing the weight of the stack (e.g., sample count).', required: true },
];

const parseConfig = createConfigParser<FlameGraphConfig>(buildParserSpec(params));


const FlameGraphComponent: React.FC<{ config: FlameGraphConfig; data: any[]; domainX?: [any, any]; }> = ({ config, data }) => {
  const { label, value: valueCol } = config;

  const root: FlameGraphNodeData = { name: 'root', value: 0, children: [] };
  let totalValue = 0;

  for (const row of data) {
    const stack = (row[label] || '').split(';');
    const valueNum = Number(row[valueCol]);
    if (isNaN(valueNum)) continue;

    totalValue += valueNum;
    let currentNode: FlameGraphNodeData = root;
    for (const frame of stack) {
        if (!frame) continue;
        let childNode = currentNode.children.find((c: any) => c.name === frame);
        if (!childNode) {
            childNode = { name: frame, value: 0, children: [] };
            currentNode.children.push(childNode);
        }
        childNode.value += valueNum;
        currentNode = childNode;
    }
  }
  root.value = totalValue;

  return (
    <div className="w-full h-full p-2 bg-gray-900 overflow-auto">
      <div className="flex flex-col min-w-full">
        <FlameGraphNode
          node={root}
          totalValue={root.value}
          parentValue={root.value}
        />
      </div>
    </div>
  );
};

export const flameGraphPlot: PlotRegistration<FlameGraphConfig> = {
  name: 'FLAMEGRAPH',
  description: 'A specialized visualization for hierarchical data, such as stack traces.',
  params,
  template: 'FLAMEGRAPH(label: , value: )',
  examples: [
    {
        description: 'A flame graph for visualizing CPU profiling stack traces from a JFR recording.',
        code: 'FLAMEGRAPH(label: "stackTrace", value: "count") TITLE "CPU Profiling Stacks"',
        sampleData: [
            { stackTrace: 'java.lang.Thread.run;com.app.Worker.process;com.app.Parser.parse', count: 120 },
            { stackTrace: 'java.lang.Thread.run;com.app.Worker.process;com.app.Network.send', count: 80 },
            { stackTrace: 'java.lang.Thread.run;com.app.Worker.idle', count: 50 },
            { stackTrace: 'GC Worker;G1ConcurrentMark.remark', count: 35 },
        ]
    }
  ],
  parseConfig,
  component: FlameGraphComponent,
};