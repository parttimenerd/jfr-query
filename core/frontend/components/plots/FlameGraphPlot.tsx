import React, { useState, useRef, useCallback, useEffect } from 'react';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec } from '../../utils/plotUtils';

// --- Internal FlameGraph Rendering Logic ---

interface FlameGraphNodeData {
    name: string;
    value: number;
    children: FlameGraphNodeData[];
}

const PKG_COLORS: [RegExp, string][] = [
    [/^(java\.|javax\.|jdk\.|sun\.|com\.sun\.)/, '#2563eb'],   // JDK — blue
    [/^(com\.google\.|io\.netty\.|org\.apache\.)/, '#7c3aed'], // popular libs — purple
    [/^GC |^ParallelGC|^G1|^ZGC|^Shenandoah/, '#dc2626'],     // GC workers — red
    [/^kernel|^\[/, '#d97706'],                                 // kernel / native — amber
];

const stringToColor = (str: string): string => {
    for (const [re, col] of PKG_COLORS) if (re.test(str)) return col;
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    let color = '#';
    for (let i = 0; i < 3; i++) {
        const value = Math.max(60, (hash >> (i * 8)) & 0xFF);
        color += ('00' + value.toString(16)).substr(-2);
    }
    return color;
};

const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const FlameGraphNode: React.FC<{
    node: FlameGraphNodeData;
    totalValue: number;
    parentValue: number;
    searchTerm: string;
    onZoom: (node: FlameGraphNodeData) => void;
}> = ({ node, totalValue, parentValue, searchTerm, onZoom }) => {
    const [isHovered, setIsHovered] = useState(false);
    const widthPercent = (node.value / parentValue) * 100;
    const color = stringToColor(node.name);
    const isMatch = searchTerm.length >= 2 && node.name.toLowerCase().includes(searchTerm.toLowerCase());

    if (widthPercent < 0.1) return null;

    return (
        <div
            className="relative flex flex-col"
            style={{ width: `${widthPercent}%` }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div
                title={`${node.name} (${(totalValue > 0 ? (node.value / totalValue) * 100 : 0).toFixed(2)}%) — click to zoom`}
                onClick={() => onZoom(node)}
                className="h-6 text-xs text-white px-1 overflow-hidden whitespace-nowrap border-b border-l border-gray-900 flex items-center justify-center transition-all cursor-pointer select-none"
                style={{
                    backgroundColor: isMatch ? '#ca8a04' : hexToRgba(color, isHovered ? 1 : 0.8),
                    filter: isHovered ? 'brightness(1.2)' : 'brightness(1)',
                    outline: isMatch ? '1px solid #fbbf24' : undefined,
                }}
            >
                {node.name}
            </div>
            {isHovered && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-2 bg-gray-900 text-white text-xs rounded-md shadow-lg z-10 whitespace-nowrap pointer-events-none border border-gray-600">
                    <div><strong>{node.name}</strong></div>
                    <div>Samples: {node.value}</div>
                    <div>{(totalValue > 0 ? (node.value / totalValue) * 100 : 0).toFixed(2)}% of total</div>
                    <div className="text-gray-400 mt-1">Click to zoom</div>
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
                            searchTerm={searchTerm}
                            onZoom={onZoom}
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
  const [searchTerm, setSearchTerm] = useState('');
  const [zoomStack, setZoomStack] = useState<FlameGraphNodeData[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

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

  if (totalValue === 0) {
    return <div className="p-4 text-center text-gray-500 text-sm">No valid flame graph data. Ensure the label column contains semicolon-separated stack frames and the value column is numeric.</div>;
  }

  const currentRoot = zoomStack.length > 0 ? zoomStack[zoomStack.length - 1] : root;

  const handleZoom = useCallback((node: FlameGraphNodeData) => {
    if (node === root || node.children.length === 0) return;
    setZoomStack(prev => [...prev, node]);
  }, [root]);

  const handleBreadcrumb = (index: number) => {
    setZoomStack(prev => prev.slice(0, index));
  };

  // Count search matches
  const countMatches = (node: FlameGraphNodeData, term: string): number => {
    if (!term || term.length < 2) return 0;
    let count = node.name.toLowerCase().includes(term.toLowerCase()) ? 1 : 0;
    for (const child of node.children) count += countMatches(child, term);
    return count;
  };
  const matchCount = searchTerm.length >= 2 ? countMatches(root, searchTerm) : 0;

  // Keyboard shortcut: Ctrl/Cmd+F focuses search, Escape clears zoom
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
            e.preventDefault();
            searchRef.current?.focus();
        }
        if (e.key === 'Escape') {
            if (zoomStack.length > 0) setZoomStack([]);
            else setSearchTerm('');
        }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomStack.length]);

  return (
    <div className="w-full h-full flex flex-col bg-gray-900">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-gray-700">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 flex-1 min-w-0 text-xs">
          <button
            onClick={() => handleBreadcrumb(0)}
            className={`px-1.5 py-0.5 rounded hover:bg-gray-700 transition-colors ${zoomStack.length === 0 ? 'text-cyan-300 font-semibold' : 'text-gray-400'}`}
          >
            root
          </button>
          {zoomStack.map((node, i) => (
            <React.Fragment key={i}>
              <span className="text-gray-600">/</span>
              <button
                onClick={() => handleBreadcrumb(i + 1)}
                className={`px-1.5 py-0.5 rounded hover:bg-gray-700 transition-colors truncate max-w-[160px] ${i === zoomStack.length - 1 ? 'text-cyan-300 font-semibold' : 'text-gray-400'}`}
                title={node.name}
              >
                {node.name}
              </button>
            </React.Fragment>
          ))}
        </div>
        {/* Search */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <input
            ref={searchRef}
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search frames… (⌘F)"
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-0.5 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
          {searchTerm.length >= 2 && (
            <span className={`text-xs ${matchCount > 0 ? 'text-yellow-400' : 'text-red-400'}`}>
              {matchCount} match{matchCount !== 1 ? 'es' : ''}
            </span>
          )}
          {(searchTerm || zoomStack.length > 0) && (
            <button
              onClick={() => { setSearchTerm(''); setZoomStack([]); }}
              className="text-xs text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-700"
            >
              Reset
            </button>
          )}
        </div>
      </div>
      {/* Flame tree */}
      <div className="overflow-auto flex-grow p-2">
        <div className="flex flex-col min-w-full">
          <FlameGraphNode
            node={currentRoot}
            totalValue={root.value}
            parentValue={currentRoot.value}
            searchTerm={searchTerm}
            onZoom={handleZoom}
          />
        </div>
      </div>
    </div>
  );
};

export const flameGraphPlot: PlotRegistration<FlameGraphConfig> = {
  name: 'FLAMEGRAPH',
  description: 'Interactive flame graph for stack-trace data — click to zoom into a frame, drag to pan, Ctrl+F to search. Rows with semicolon-separated frame stacks feed directly into this.',
  params: withCommonParams(params),
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
