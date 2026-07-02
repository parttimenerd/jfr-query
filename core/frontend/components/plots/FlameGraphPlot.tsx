import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec } from '../../utils/plotUtils';

// ─── types ────────────────────────────────────────────────────────────────────

interface FlameGraphNodeData {
    name: string;
    value: number;
    children: FlameGraphNodeData[];
}

// Layout record built by the canvas renderer so hit-testing can be done without
// re-running the DFS.
interface NodeLayout {
    x: number; y: number; w: number; h: number;
    node: FlameGraphNodeData;
    parentValue: number;
}

// ─── color helpers ────────────────────────────────────────────────────────────

const PKG_COLORS: [RegExp, string][] = [
    [/^(java\.|javax\.|jdk\.|sun\.|com\.sun\.)/, '#2563eb'],
    [/^(com\.google\.|io\.netty\.|org\.apache\.)/, '#7c3aed'],
    [/^GC |^ParallelGC|^G1|^ZGC|^Shenandoah/, '#dc2626'],
    [/^kernel|^\[/, '#d97706'],
];

// Returns an HSL color string with fixed saturation/lightness so all
// hash-derived colors are readable on a dark background.
const stringToColor = (str: string): string => {
    for (const [re, col] of PKG_COLORS) if (re.test(str)) return col;
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue},55%,42%)`;
};

const hexToRgba = (hex: string, alpha: number) => {
    if (hex.startsWith('hsl')) return hex.replace('hsl(', `hsla(`).replace(')', `,${alpha})`);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
};

// Resolve CSS color string → RGB triple (used by canvas renderer)
const colorToRgb = (() => {
    const cache = new Map<string, [number, number, number]>();
    const tmp = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const ctx = tmp?.getContext('2d') ?? null;
    return (color: string): [number, number, number] => {
        if (cache.has(color)) return cache.get(color)!;
        if (!ctx) return [100, 100, 100];
        ctx.fillStyle = color;
        const style = ctx.fillStyle; // canonical hex
        const r = parseInt(style.slice(1, 3), 16);
        const g = parseInt(style.slice(3, 5), 16);
        const b = parseInt(style.slice(5, 7), 16);
        const result: [number, number, number] = [r, g, b];
        cache.set(color, result);
        return result;
    };
})();

// Strip leading package path for display when width is narrow.
const shortName = (name: string, px: number): string => {
    if (px > 120) return name;
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1) : name;
};

// Count visible nodes (mirrors render cutoff) — used to choose DOM vs canvas.
function countVisibleNodes(
    node: FlameGraphNodeData,
    parentValue: number,
    minFrameWidth: number,
    rootValue: number,
    widthMode: 'parent' | 'total',
): number {
    const pct = widthMode === 'total'
        ? (node.value / rootValue) * 100
        : (node.value / parentValue) * 100;
    if (pct < minFrameWidth) return 0;
    let n = 1;
    for (const child of node.children) {
        n += countVisibleNodes(child, node.value, minFrameWidth, rootValue, widthMode);
    }
    return n;
}

// ─── DOM renderer (≤ 2000 nodes) ─────────────────────────────────────────────

const FlameGraphNode: React.FC<{
    node: FlameGraphNodeData;
    totalValue: number;
    parentValue: number;
    rootValue: number;
    searchTerm: string;
    matchRegex: RegExp | null;
    hasSearch: boolean;
    minFrameWidth: number;
    widthMode: 'parent' | 'total';
    hoveredName: string | null;
    onZoom: (node: FlameGraphNodeData) => void;
    onHover: (name: string | null) => void;
    onContextMenu: (e: React.MouseEvent, node: FlameGraphNodeData) => void;
}> = ({
    node, totalValue, parentValue, rootValue, searchTerm, matchRegex, hasSearch,
    minFrameWidth, widthMode, hoveredName, onZoom, onHover, onContextMenu,
}) => {
    const widthPct = widthMode === 'total'
        ? (node.value / rootValue) * 100
        : (node.value / parentValue) * 100;

    if (widthPct < minFrameWidth) return null;

    const color = stringToColor(node.name);
    const isMatch = hasSearch && (matchRegex ? matchRegex.test(node.name) : node.name.toLowerCase().includes(searchTerm.toLowerCase()));
    const isCrossHit = hoveredName !== null && node.name === hoveredName;
    const isDimmed = (hasSearch && !isMatch) || (hoveredName !== null && !isCrossHit);

    return (
        <div
            className="relative flex flex-col"
            style={{ width: `${widthPct}%` }}
        >
            <div
                title={`${node.name}\n${node.value} samples · ${totalValue > 0 ? ((node.value / totalValue) * 100).toFixed(1) : 0}% total · ${parentValue > 0 ? ((node.value / parentValue) * 100).toFixed(1) : 0}% parent\nClick to zoom · Right-click for menu`}
                onClick={() => onZoom(node)}
                onMouseEnter={() => onHover(node.name)}
                onMouseLeave={() => onHover(null)}
                onContextMenu={(e) => onContextMenu(e, node)}
                className="h-5 text-xs text-white px-0.5 overflow-hidden whitespace-nowrap border-b border-l border-gray-900/60 flex items-center cursor-pointer select-none transition-opacity duration-75"
                style={{
                    backgroundColor: isMatch ? '#ca8a04' : hexToRgba(color, 0.85),
                    outline: isCrossHit ? '1px solid #a5f3fc' : isMatch ? '1px solid #fbbf24' : undefined,
                    opacity: isDimmed ? 0.3 : 1,
                    fontSize: '11px',
                    lineHeight: '20px',
                }}
            >
                {shortName(node.name, 0 /* will be trimmed by overflow-hidden */)}
            </div>
            {node.children.length > 0 && (
                <div className="flex w-full">
                    {node.children.map((child, i) => (
                        <FlameGraphNode
                            key={i}
                            node={child}
                            totalValue={totalValue}
                            parentValue={node.value}
                            rootValue={rootValue}
                            searchTerm={searchTerm}
                            matchRegex={matchRegex}
                            hasSearch={hasSearch}
                            minFrameWidth={minFrameWidth}
                            widthMode={widthMode}
                            hoveredName={hoveredName}
                            onZoom={onZoom}
                            onHover={onHover}
                            onContextMenu={onContextMenu}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// ─── canvas renderer (> 2000 nodes) ──────────────────────────────────────────

const FRAME_H = 20;
const FONT = '11px ui-monospace,SFMono-Regular,Menlo,monospace';

const FlameGraphCanvas: React.FC<{
    root: FlameGraphNodeData;
    currentRoot: FlameGraphNodeData;
    totalValue: number;
    searchTerm: string;
    matchRegex: RegExp | null;
    hasSearch: boolean;
    minFrameWidth: number;
    widthMode: 'parent' | 'total';
    onZoom: (node: FlameGraphNodeData) => void;
    onContextMenu: (e: React.MouseEvent, node: FlameGraphNodeData) => void;
}> = ({
    root, currentRoot, totalValue, searchTerm, matchRegex, hasSearch,
    minFrameWidth, widthMode, onZoom, onContextMenu,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const layoutRef = useRef<NodeLayout[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);
    const [canvasWidth, setCanvasWidth] = useState(800);
    const [tooltip, setTooltip] = useState<{ x: number; y: number; node: FlameGraphNodeData; parentValue: number } | null>(null);

    // Measure container width only; height is computed from tree depth.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => {
            const { width } = entries[0].contentRect;
            if (width > 0) setCanvasWidth(Math.floor(width));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Draw.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Compute tree depth first to size the canvas correctly.
        const getDepth = (node: FlameGraphNodeData, pv: number, depth: number): number => {
            const pct = widthMode === 'total'
                ? (node.value / root.value) * 100
                : (node.value / pv) * 100;
            if (pct < minFrameWidth) return depth;
            if (node.children.length === 0) return depth + 1;
            let d = depth;
            for (const c of node.children) { const cd = getDepth(c, node.value, depth + 1); if (cd > d) d = cd; }
            return d;
        };
        let maxDepth = 0;
        for (const c of currentRoot.children) { const cd = getDepth(c, currentRoot.value, 0); if (cd > maxDepth) maxDepth = cd; }
        const w = canvasWidth;
        const h = Math.max(200, (maxDepth + 1) * FRAME_H + 4);

        canvas.width = w * devicePixelRatio;
        canvas.height = h * devicePixelRatio;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.scale(devicePixelRatio, devicePixelRatio);

        ctx.clearRect(0, 0, w, h);
        ctx.font = FONT;

        const layout: NodeLayout[] = [];

        const draw = (
            node: FlameGraphNodeData,
            x: number, y: number, nodeW: number,
            parentVal: number,
        ) => {
            if (nodeW < 1) return;

            const isMatch = hasSearch && (matchRegex ? matchRegex.test(node.name) : node.name.toLowerCase().includes(searchTerm.toLowerCase()));
            const isDimmed = hasSearch && !isMatch;

            layout.push({ x, y, w: nodeW, h: FRAME_H, node, parentValue: parentVal });

            const color = stringToColor(node.name);
            const [r, g, b] = colorToRgb(color);
            ctx.fillStyle = isMatch
                ? '#ca8a04'
                : isDimmed
                    ? `rgba(${r},${g},${b},0.25)`
                    : `rgba(${r},${g},${b},0.85)`;
            ctx.fillRect(x, y, nodeW, FRAME_H);

            // Border
            ctx.strokeStyle = 'rgba(0,0,0,0.4)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x + 0.25, y + 0.25, nodeW - 0.5, FRAME_H - 0.5);

            // Label
            if (nodeW > 16) {
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.save();
                ctx.rect(x + 2, y, nodeW - 4, FRAME_H);
                ctx.clip();
                const label = shortName(node.name, nodeW);
                ctx.fillText(label, x + 3, y + 14);
                ctx.restore();
            }

            // Children
            let cx = x;
            for (const child of node.children) {
                const childW = widthMode === 'total'
                    ? (child.value / root.value) * w
                    : (child.value / node.value) * nodeW;
                const childWPct = widthMode === 'total'
                    ? (child.value / root.value) * 100
                    : (child.value / node.value) * 100;
                if (childWPct < minFrameWidth) { cx += childW; continue; }
                draw(child, cx, y + FRAME_H, childW, node.value);
                cx += childW;
            }
        };

        // Render children of currentRoot (skip the virtual root frame itself).
        let cx = 0;
        for (const child of currentRoot.children) {
            const childW = widthMode === 'total'
                ? (child.value / root.value) * w
                : (child.value / currentRoot.value) * w;
            const childWPct = widthMode === 'total'
                ? (child.value / root.value) * 100
                : (child.value / currentRoot.value) * 100;
            if (childWPct < minFrameWidth) { cx += childW; continue; }
            draw(child, cx, 0, childW, currentRoot.value);
            cx += childW;
        }

        layoutRef.current = layout;
    }, [root, currentRoot, totalValue, searchTerm, matchRegex, hasSearch, minFrameWidth, widthMode, canvasWidth]);

    const hitTest = useCallback((x: number, y: number): NodeLayout | null => {
        for (const item of layoutRef.current) {
            if (x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h) return item;
        }
        return null;
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hit = hitTest(x, y);
        if (hit) {
            setTooltip({ x: e.clientX, y: e.clientY, node: hit.node, parentValue: hit.parentValue });
        } else {
            setTooltip(null);
        }
    }, [hitTest]);

    const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
        if (hit) onZoom(hit.node);
    }, [hitTest, onZoom]);

    const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
        if (hit) onContextMenu(e, hit.node);
    }, [hitTest, onContextMenu]);

    return (
        <div ref={containerRef} className="relative w-full overflow-auto">
            <canvas
                ref={canvasRef}
                style={{ display: 'block' }}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setTooltip(null)}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
            />
            {tooltip && (
                <div
                    className="fixed z-50 pointer-events-none bg-gray-900 border border-gray-600 rounded-md px-2 py-1.5 text-xs text-white shadow-lg"
                    style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
                >
                    <div className="font-semibold">{tooltip.node.name}</div>
                    <div className="text-gray-300">
                        {tooltip.node.value} samples ·{' '}
                        {totalValue > 0 ? ((tooltip.node.value / totalValue) * 100).toFixed(1) : 0}% total ·{' '}
                        {tooltip.parentValue > 0 ? ((tooltip.node.value / tooltip.parentValue) * 100).toFixed(1) : 0}% parent
                    </div>
                    <div className="text-gray-500 mt-0.5">Click to zoom · Right-click for menu</div>
                </div>
            )}
        </div>
    );
};

// ─── context menu ─────────────────────────────────────────────────────────────

const ContextMenu: React.FC<{
    x: number; y: number; node: FlameGraphNodeData;
    canGoUp: boolean;
    onZoom: () => void;
    onGoUp: () => void;
    onReset: () => void;
    onClose: () => void;
}> = ({ x, y, node, canGoUp, onZoom, onGoUp, onReset, onClose }) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    const Item: React.FC<{ label: string; onClick: () => void; disabled?: boolean }> = ({ label, onClick, disabled }) => (
        <button
            className={`w-full text-left px-3 py-1.5 text-xs rounded hover:bg-gray-700 transition-colors ${disabled ? 'opacity-40 cursor-default' : ''}`}
            onClick={() => { if (!disabled) { onClick(); onClose(); } }}
        >
            {label}
        </button>
    );

    return (
        <div
            ref={ref}
            className="fixed z-[100] bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[170px]"
            style={{ left: x, top: y }}
        >
            <div className="px-3 py-1 text-[10px] text-gray-500 font-medium truncate max-w-[200px]">{node.name}</div>
            <div className="border-t border-gray-700 my-1" />
            <Item label="Zoom to this frame" onClick={onZoom} />
            <Item label="Go up one level" onClick={onGoUp} disabled={!canGoUp} />
            <Item label="Reset zoom &amp; search" onClick={onReset} />
            <div className="border-t border-gray-700 my-1" />
            <Item
                label="Copy frame name"
                onClick={() => navigator.clipboard?.writeText(node.name).catch(() => {})}
            />
        </div>
    );
};

// ─── plot module ──────────────────────────────────────────────────────────────

interface FlameGraphConfig {
  frames: string;
  value: string;
  direction?: 'up' | 'down';
  minFrameWidth?: number;
  search?: string;
}

const params: PlotParameter[] = [
    { name: 'frames', type: 'column', description: 'Column with semicolon-separated stack frames.', required: true },
    { name: 'value', type: 'column', description: 'Numeric column representing sample weight.', required: true },
    { name: 'direction', type: 'string', options: ['up', 'down'], defaultValue: 'down', description: '"down" = classic root-on-top, "up" = icicle.' },
    { name: 'minFrameWidth', type: 'number', defaultValue: 0.1, description: 'Skip frames narrower than this % of total width.' },
    { name: 'search', type: 'string', description: 'Initial search regex.' },
    { name: 'label', type: 'column', aliasFor: 'frames', deprecated: true, description: 'Deprecated alias for "frames".' },
    { name: 'stacktrace', type: 'column', aliasFor: 'frames', deprecated: false, description: 'Alias for "frames".' },
];

const parseConfig = createConfigParser<FlameGraphConfig>(buildParserSpec(params));

const CANVAS_THRESHOLD = 2000;

const FlameGraphComponent: React.FC<{ config: FlameGraphConfig; data: any[]; domainX?: [any, any]; }> = ({ config, data }) => {
  const { frames: framesCol, value: valueCol, direction = 'down', minFrameWidth = 0.1, search: initialSearch } = config;
  const [searchTerm, setSearchTerm] = useState(initialSearch ?? '');
  const [zoomStack, setZoomStack] = useState<FlameGraphNodeData[]>([]);
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const [widthMode, setWidthMode] = useState<'parent' | 'total'>('parent');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FlameGraphNodeData } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const root = useMemo<FlameGraphNodeData>(() => {
    const r: FlameGraphNodeData = { name: 'root', value: 0, children: [] };
    let totalValue = 0;
    for (const row of data) {
      const stack = (row[framesCol] || '').split(';');
      const valueNum = Number(row[valueCol]);
      if (isNaN(valueNum) || !row[framesCol]) continue;
      totalValue += valueNum;
      let cur: FlameGraphNodeData = r;
      for (const frame of stack) {
        if (!frame) continue;
        let child = cur.children.find(c => c.name === frame);
        if (!child) { child = { name: frame, value: 0, children: [] }; cur.children.push(child); }
        child.value += valueNum;
        cur = child;
      }
    }
    r.value = totalValue;
    return r;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, framesCol, valueCol]);

  if (root.value === 0) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        No flame graph data. Ensure the <code className="text-gray-300">frames</code> column contains semicolon-separated stack frames and <code className="text-gray-300">value</code> is numeric.
        <div className="mt-2 text-xs text-gray-600">For JFR data, use <code className="text-gray-400">stack_frames(es."stackTrace$methods")</code> to build the frames column.</div>
      </div>
    );
  }

  const currentRoot = zoomStack.length > 0 ? zoomStack[zoomStack.length - 1] : root;

  const handleZoom = useCallback((node: FlameGraphNodeData) => {
    if (node === root) return;
    setZoomStack(prev => [...prev, node]);
  }, [root]);

  const handleGoUp = useCallback(() => {
    setZoomStack(prev => prev.slice(0, -1));
  }, []);

  const handleBreadcrumb = (index: number) => setZoomStack(prev => prev.slice(0, index));

  const handleReset = useCallback(() => {
    setZoomStack([]);
    setSearchTerm('');
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FlameGraphNodeData) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const matchRegex = (() => {
    try { return searchTerm.length >= 2 ? new RegExp(searchTerm, 'i') : null; }
    catch { return null; }
  })();
  const hasSearch = searchTerm.length >= 2;

  const countMatches = (node: FlameGraphNodeData): number => {
    const hit = hasSearch && (matchRegex ? matchRegex.test(node.name) : node.name.toLowerCase().includes(searchTerm.toLowerCase()));
    let n = hit ? 1 : 0;
    for (const child of node.children) n += countMatches(child);
    return n;
  };
  const matchCount = hasSearch ? countMatches(root) : 0;

  // Choose DOM vs canvas based on visible node count.
  const visibleCount = useMemo(
    () => countVisibleNodes(currentRoot, currentRoot.value, minFrameWidth, root.value, widthMode),
    [currentRoot, minFrameWidth, root.value, widthMode]
  );
  const useCanvas = visibleCount > CANVAS_THRESHOLD;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
            e.preventDefault();
            searchRef.current?.focus();
        }
        if (e.key === 'Escape') {
            if (contextMenu) { setContextMenu(null); return; }
            if (zoomStack.length > 0) setZoomStack([]);
            else setSearchTerm('');
        }
        if (e.key === 'ArrowLeft' && zoomStack.length > 0) {
            e.preventDefault();
            setZoomStack(prev => prev.slice(0, -1));
        }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomStack.length, contextMenu]);

  return (
    <div className="w-full h-full flex flex-col bg-gray-900" onClick={() => contextMenu && setContextMenu(null)}>
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 flex-wrap">
        {/* Back button + Breadcrumbs */}
        <div className="flex items-center gap-1 flex-1 min-w-0 text-xs">
          {zoomStack.length > 0 && (
            <button
              onClick={handleGoUp}
              title="Go up one level (←)"
              className="px-1.5 py-0.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors flex-shrink-0"
            >
              ←
            </button>
          )}
          <button
            onClick={() => handleBreadcrumb(0)}
            className={`px-1.5 py-0.5 rounded hover:bg-gray-700 transition-colors flex-shrink-0 ${zoomStack.length === 0 ? 'text-cyan-300 font-semibold' : 'text-gray-400'}`}
          >
            root
          </button>
          <span className="text-gray-600 flex-shrink-0 text-[10px]">({root.value} samples)</span>
          {zoomStack.map((node, i) => (
            <React.Fragment key={i}>
              <span className="text-gray-600 flex-shrink-0">/</span>
              <button
                onClick={() => handleBreadcrumb(i + 1)}
                className={`px-1.5 py-0.5 rounded hover:bg-gray-700 transition-colors truncate max-w-[140px] ${i === zoomStack.length - 1 ? 'text-cyan-300 font-semibold' : 'text-gray-400'}`}
                title={node.name}
              >
                {node.name.split('.').pop()}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Width mode toggle */}
        <div className="flex-shrink-0 flex items-center gap-0.5 bg-gray-800 rounded-md p-0.5 text-[10px]">
          {(['parent', 'total'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setWidthMode(mode)}
              className={`px-2 py-0.5 rounded transition-colors ${widthMode === mode ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            >
              % {mode}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <input
            ref={searchRef}
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search (⌘F)"
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-0.5 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
          {hasSearch && (
            <span className={`text-xs flex-shrink-0 ${matchCount > 0 ? 'text-yellow-400' : 'text-red-400'}`}>
              {matchCount} match{matchCount !== 1 ? 'es' : ''}
            </span>
          )}
          {(searchTerm || zoomStack.length > 0) && (
            <button
              onClick={handleReset}
              className="text-xs text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-700 flex-shrink-0"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Flame tree */}
      <div className="overflow-auto flex-grow p-2">
        {useCanvas ? (
          <FlameGraphCanvas
            root={root}
            currentRoot={currentRoot}
            totalValue={root.value}
            searchTerm={searchTerm}
            matchRegex={matchRegex}
            hasSearch={hasSearch}
            minFrameWidth={minFrameWidth}
            widthMode={widthMode}
            onZoom={handleZoom}
            onContextMenu={handleContextMenu}
          />
        ) : (
          <div className={`flex min-w-full ${direction === 'up' ? 'flex-col-reverse' : 'flex-col'}`}>
            <div className="flex w-full">
              {currentRoot.children.map((child, i) => (
                <FlameGraphNode
                  key={i}
                  node={child}
                  totalValue={root.value}
                  parentValue={currentRoot.value}
                  rootValue={root.value}
                  searchTerm={searchTerm}
                  matchRegex={matchRegex}
                  hasSearch={hasSearch}
                  minFrameWidth={minFrameWidth}
                  widthMode={widthMode}
                  hoveredName={hoveredName}
                  onZoom={handleZoom}
                  onHover={setHoveredName}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          canGoUp={zoomStack.length > 0}
          onZoom={() => handleZoom(contextMenu.node)}
          onGoUp={handleGoUp}
          onReset={handleReset}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

export const flameGraphPlot: PlotRegistration<FlameGraphConfig> = {
  name: 'FLAMEGRAPH',
  description: 'Interactive flame graph for stack-trace data. Click to zoom into a frame, ← to go back, Ctrl+F to search. Use stack_frames(es."stackTrace$methods") to convert JFR data into the required format.',
  params: withCommonParams(params),
  template: 'FLAMEGRAPH(frames: , value: )',
  examples: [
    {
        description: 'CPU flamegraph from JFR ExecutionSample using the stack_frames() macro.',
        code: 'FLAMEGRAPH(frames: "frame", value: "value") TITLE "CPU Flamegraph"',
        sampleData: [
            { frame: 'java.lang.Thread.run;com.app.Worker.process;com.app.Parser.parse', value: 120 },
            { frame: 'java.lang.Thread.run;com.app.Worker.process;com.app.Network.send', value: 80 },
            { frame: 'java.lang.Thread.run;com.app.Worker.idle', value: 50 },
            { frame: 'GC Worker;G1ConcurrentMark.remark', value: 35 },
        ]
    }
  ],
  parseConfig,
  component: FlameGraphComponent,
};
