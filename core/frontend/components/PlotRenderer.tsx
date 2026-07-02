
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { plotRegistry } from './plots/plotRegistry';
import { normalizePlotName } from './plots/plotNames';
import type { NotebookCellData, NotebookMetadata } from '../types';
import { aiService } from '../services/AiService';
import { WandSparklesIcon } from './icons/WandSparklesIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { parsePlotCall, parseComposite, validateComposite, type ParsedPlotCall } from '../utils/plotParser';
import { CompositeRenderer } from './plots/CompositeRenderer';
import { expandPlotConstants } from '../utils/plotConstants';
import { getTimeValue } from '../utils/plotUtils';
import { LockClosedIcon } from './icons/LockClosedIcon';
import { LockOpenIcon } from './icons/LockOpenIcon';
import { useScrollProducer } from '../hooks/useScrollProducer';
import { plotBrushStore } from '../services/plotBrushStore';
import type { BrushMode } from '../services/plotBrushStore';

/**
 * Split a multi-plot config string on blank lines, but only when the blank
 * line is at nesting depth 0 (not inside parentheses, brackets, braces, or
 * quotes). Two consecutive blank lines at depth 0 act as the separator.
 */
function splitTopLevelConfigs(config: string): string[] {
    const out: string[] = [];
    let cur = '';
    let depth = 0;
    let inStr: string | null = null;
    const lines = config.split('\n');
    let prevWasBlank = false;
    for (const line of lines) {
        const trimmed = line.trim();
        // Track string state and depth for this line
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (inStr) {
                if (c === inStr) inStr = null;
                continue;
            }
            if (c === '"' || c === "'") { inStr = c; continue; }
            if (c === '(' || c === '[' || c === '{') depth++;
            else if (c === ')' || c === ']' || c === '}') depth--;
        }
        if (trimmed === '' && depth === 0 && cur.trim()) {
            if (prevWasBlank) {
                // Two consecutive blank lines at depth 0 = separator
                out.push(cur.trim());
                cur = '';
                prevWasBlank = false;
            } else {
                prevWasBlank = true;
                cur += '\n';
            }
        } else {
            prevWasBlank = false;
            cur += line + '\n';
        }
    }
    if (cur.trim()) out.push(cur.trim());
    return out.length > 0 ? out : [''];
}

function debounce<T extends (...args: any[]) => any>(func: T, delay: number): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return function(this: any, ...args: Parameters<T>) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

class PlotErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(e: any) {
    return { error: e?.message ?? 'Unknown render error' };
  }
  componentDidCatch() {
    // Error already captured in state.
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-3 text-sm text-red-400 bg-red-900/30 font-mono whitespace-pre-wrap overflow-auto h-full">
          Plot render error: {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}


interface AiErrorFixerProps {
    error: string;
    config: string;
    data: any[];
    sql: string;
    cellContext: NotebookCellData;
    onApplyFix: (newConfig: string) => void;
    metadata: NotebookMetadata;
}

const AiErrorFixer: React.FC<AiErrorFixerProps> = ({ error, config, data, sql, cellContext, onApplyFix, metadata }) => {
    const [suggestion, setSuggestion] = useState<any | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [apiError, setApiError] = useState<string | null>(null);

    useEffect(() => {
        if (!aiService.isInitialized()) {
            setIsLoading(false);
            setApiError('Configure an AI provider in ⚙ Settings to get fix suggestions');
            return;
        }
        let isMounted = true;
        let timeoutId: ReturnType<typeof setTimeout>;
        const timer = setTimeout(() => {
            if (!isMounted) return;
            setIsLoading(true);
            setApiError(null);
            timeoutId = setTimeout(() => {
                if (isMounted) { setIsLoading(false); setApiError('AI suggestion timed out — check your API key or try again'); }
            }, 10_000);
            aiService.getAiPlotFixSuggestion(error, sql, data, config, cellContext.content, metadata.customSystemPrompt)
                .then(res => { if (isMounted) setSuggestion(res); })
                .catch(err => { if (isMounted) setApiError(err.message); })
                .finally(() => { if (isMounted) { setIsLoading(false); clearTimeout(timeoutId); } });
        }, 500);

        return () => { isMounted = false; clearTimeout(timer); clearTimeout(timeoutId); };
    }, [error, config, data, sql, cellContext, metadata]);

    return (
        <div className="p-4 text-sm text-yellow-400 bg-gray-800 border border-yellow-500/50 rounded-lg space-y-3 w-full max-w-md shadow-lg">
            <div><p className="font-semibold text-base text-yellow-300">Plot Error</p><p className="font-mono text-xs mt-1 whitespace-pre-wrap">{error}</p></div>
            <div className="border-t border-yellow-500/30 pt-3">
                {isLoading && <div className="flex items-center gap-2 text-yellow-300/80"><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div><span>Getting AI suggestion...</span></div>}
                {apiError && <p>AI suggestion unavailable: {apiError}</p>}
                {suggestion && (<div className="space-y-2"><p className="flex items-center gap-2 font-semibold text-yellow-300"><WandSparklesIcon className="w-4 h-4"/> AI Fix Suggestion</p><p className="text-xs text-yellow-300/90">{suggestion.explanation}</p><pre className="bg-gray-900/50 p-2 rounded-md text-xs font-mono text-cyan-300 overflow-x-auto">{suggestion.fixedCode}</pre><button onClick={() => onApplyFix(suggestion.fixedCode)} className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-green-600/30 hover:bg-green-600/50 text-green-300 rounded-md font-semibold"><CheckCircleIcon className="w-4 h-4"/>Apply Fix</button></div>)}
            </div>
        </div>
    );
};

const InteractivePlotWrapper: React.FC<{
    children: React.ReactElement;
    linkX: [string, string];
    linkXClamp: boolean;
    data: any[];
    xCol: string;
    allVariables: Record<string, string>;
    onVariableChange: (vars: Record<string, string>) => void;
}> = ({ children, linkX, linkXClamp, data, xCol, allVariables, onVariableChange }) => {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [isLocked, setIsLocked] = useState(false);
    const [localDomain, setLocalDomain] = useState<[number, number] | null>(null);

    // B-148: stable debounce — keep a ref to the latest onVariableChange so the
    // debounce function itself never needs to be recreated across renders.
    const onVarChangeRef = useRef(onVariableChange);
    onVarChangeRef.current = onVariableChange;
    const stableOnVar = useCallback((p: Record<string, string>) => onVarChangeRef.current(p), []);
    // B-150: 300 ms debounce (was 200 ms) to reduce write frequency during pan.
    const debouncedOnVariableChange = useMemo(() => debounce(stableOnVar, 300), [stableOnVar]);

    // Drag-to-pan state.
    const dragRef = useRef<{ startX: number; domainMin: number; domainMax: number } | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        const [minVar, maxVar] = linkX;
        const minVal = getTimeValue(allVariables[minVar]);
        const maxVal = getTimeValue(allVariables[maxVar]);
        if (!isNaN(minVal) && !isNaN(maxVal)) {
            setLocalDomain([minVal, maxVal]);
        }
    }, [allVariables, linkX]);

    const dataRange = useMemo(() => {
        if (!data || data.length === 0 || !xCol) return null;
        let min: number | null = null;
        let max: number | null = null;
        for (const row of data) {
            const val = getTimeValue(row[xCol]);
            if (!isNaN(val)) {
                if (min === null || val < min) min = val;
                if (max === null || val > max) max = val;
            }
        }
        return min !== null && max !== null ? { min, max } : null;
    }, [data, xCol]);

    // B-149: stable handleInteraction so the wheel useEffect below doesn't
    // re-register the listener on every render frame.
    const handleInteraction = useCallback((newMin: number, newMax: number) => {
        if (newMin >= newMax) return;

        let finalMin = newMin;
        let finalMax = newMax;

        if (linkXClamp && dataRange) {
            const range = newMax - newMin;
            if (newMin < dataRange.min) {
                finalMin = dataRange.min;
                finalMax = dataRange.min + range;
            }
            if (newMax > dataRange.max) {
                finalMax = dataRange.max;
                finalMin = dataRange.max - range;
            }
            // B-020: if the requested range is wider than the data, shrink it around the
            // current center rather than jumping to [dataRange.min, dataRange.max].
            const dataSpan = dataRange.max - dataRange.min;
            if (dataSpan < finalMax - finalMin) {
                const center = (finalMin + finalMax) / 2;
                const clampedCenter = Math.max(dataRange.min + dataSpan / 2, Math.min(dataRange.max - dataSpan / 2, center));
                finalMin = clampedCenter - dataSpan / 2;
                finalMax = clampedCenter + dataSpan / 2;
            }
        }

        setLocalDomain([finalMin, finalMax]);
        debouncedOnVariableChange({ [linkX[0]]: String(finalMin), [linkX[1]]: String(finalMax) });
    }, [linkXClamp, dataRange, linkX, debouncedOnVariableChange]);

    // Use a non-passive wheel listener so preventDefault() actually works.
    // B-149: deps list only contains stable values; handleInteraction is a
    // useCallback so this effect re-registers only when truly necessary.
    useEffect(() => {
        const el = wrapperRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (isLocked || !e.shiftKey) return;
            e.preventDefault();
            e.stopPropagation();

            const rangeArr: [number, number] | null = dataRange ? [dataRange.min, dataRange.max] : null;
            const [currentMin, currentMax] = localDomain ?? rangeArr ?? [0, 1];

            const rect = el.getBoundingClientRect();
            if (rect.width <= 0) return;
            const mouseX = e.clientX - rect.left;
            const zoomFactor = 1 + Math.abs(e.deltaY) / 200;
            const currentRange = currentMax - currentMin;
            if (currentRange <= 0) return;

            const mousePercent = Math.max(0, Math.min(1, mouseX / rect.width));
            const mouseValue = currentMin + currentRange * mousePercent;
            let newRange = e.deltaY < 0 ? currentRange / zoomFactor : currentRange * zoomFactor;

            if (linkXClamp && dataRange && newRange > (dataRange.max - dataRange.min)) {
                newRange = dataRange.max - dataRange.min;
            }

            const newMin = mouseValue - newRange * mousePercent;
            const newMax = newMin + newRange;
            handleInteraction(newMin, newMax);
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [isLocked, localDomain, dataRange, linkXClamp, handleInteraction]);

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isLocked || e.button !== 0) return;
        // Don't start a pan when clicking the lock button.
        if ((e.target as HTMLElement).closest('button')) return;
        const rangeArr: [number, number] | null = dataRange ? [dataRange.min, dataRange.max] : null;
        const [currentMin, currentMax] = localDomain ?? rangeArr ?? [0, 1];
        dragRef.current = { startX: e.clientX, domainMin: currentMin, domainMax: currentMax };
        setIsDragging(true);
        e.preventDefault();
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!dragRef.current || !wrapperRef.current) return;
        const rect = wrapperRef.current.getBoundingClientRect();
        if (rect.width <= 0) return;
        const { startX, domainMin, domainMax } = dragRef.current;
        const range = domainMax - domainMin;
        const pixelsDragged = e.clientX - startX;
        // Negative: dragging left → pan forward in time.
        const domainDelta = -(pixelsDragged / rect.width) * range;
        handleInteraction(domainMin + domainDelta, domainMax + domainDelta);
    };

    const handleMouseUp = () => {
        dragRef.current = null;
        setIsDragging(false);
    };

    return (
        <div
            ref={wrapperRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ width: '100%', height: '100%', cursor: isLocked ? 'default' : isDragging ? 'grabbing' : 'grab' }}
            className="relative group"
        >
            <div className="absolute top-1 right-1 z-10 flex items-center gap-1">
                {!isLocked && (
                    <span className="text-[10px] text-gray-400 bg-gray-800/70 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" title="Drag to pan · Hold Shift while scrolling to zoom this plot">
                        drag = pan · ⇧ scroll = zoom
                    </span>
                )}
                <button onClick={() => setIsLocked(!isLocked)} className="p-1 bg-gray-700/50 rounded-full text-gray-300 hover:text-cyan-300 focus:outline-none focus:ring-1 focus:ring-cyan-500" title={isLocked ? "Unlock Plot" : "Lock Plot"}>
                    {isLocked ? <LockClosedIcon className="w-4 h-4 text-yellow-400"/> : <LockOpenIcon className="w-4 h-4"/>}
                </button>
            </div>
            {React.cloneElement<any>(children, { domainX: localDomain })}
        </div>
    );
};

/** Wraps a plot container in a LINK_SCROLL group — synchronizes scroll position
 *  with other plots in the same group. Pass `group=null` to disable. */
const ScrollSyncWrapper: React.FC<{ group: string | null; children: React.ReactNode }> = ({ group, children }) => {
    const scrollRef = useScrollProducer(group);
    if (!group) return <>{children}</>;
    return (
        <div
            ref={scrollRef as React.RefObject<HTMLDivElement>}
            style={{ width: '100%', height: '100%', overflow: 'auto' }}
        >
            {children}
        </div>
    );
};


interface PlotRendererProps {
    config: string;
    data: any[] | null;
    /**
     * B-141/142/143: Map of query reference → dataset, enabling per-leaf ON clause
     * data routing in multi-plot configs. Keys are 1-based numeric query indices
     * (as strings, e.g. "1", "2") and/or named query aliases. When a leaf's parsed
     * `on` field resolves a key here, that dataset is used instead of the primary
     * `data` prop. Falls back to `data` when the key is absent or the map is not
     * provided.
     */
    dataByQueryRef?: Record<string | number, any[]>;
    sql: string;
    cellContext: NotebookCellData;
    onApplyFix: (newConfig: string) => void;
    isAiFeatureActive?: boolean;
    metadata: NotebookMetadata;
    onMetadataChange: (newMetadata: NotebookMetadata) => void;
    onCellVariableChange: (vars: Record<string, string>) => void;
    allVariables: Record<string, string>;
}

const PlotRenderer: React.FC<PlotRendererProps> = ({ config, data, dataByQueryRef, sql, cellContext, onApplyFix, isAiFeatureActive = false, metadata, onMetadataChange, onCellVariableChange, allVariables }) => {

    // Keep onApplyFix and sql in refs so callers can drop them from arePropsEqual
    // without risk of calling a stale handler or showing stale SQL in error state.
    // Both refs are updated synchronously on every render.
    const onApplyFixRef = useRef(onApplyFix);
    onApplyFixRef.current = onApplyFix;
    const stableOnApplyFix = useCallback((newConfig: string) => onApplyFixRef.current(newConfig), []);
    const sqlRef = useRef(sql);
    sqlRef.current = sql;

    // Extract ALL distinct LINK-Y / LINK-XY variable names from the config so we
    // can subscribe once per unique name and pass per-leaf domains to composites.
    const linkYVarNames = useMemo((): string[] => {
        try {
            const cfg = config?.trim() || '';
            if (!cfg) return [];
            const expansion = expandPlotConstants(cfg);
            const cfgStr = expansion.expanded.trim();
            const allConfigs = splitTopLevelConfigs(cfgStr).flatMap(row =>
                row.split(';').map(c => c.trim()).filter(Boolean)
            );
            const names = new Set<string>();
            function collectFromParsed(p: ParsedPlotCall) {
                if (p.linkY) names.add(p.linkY);
                if (p.linkXY) names.add(p.linkXY);
                if (p.composite) p.composite.children.forEach(collectFromParsed);
            }
            for (const c of allConfigs) {
                try {
                    collectFromParsed(parseComposite(c));
                } catch { /* ignore */ }
            }
            return Array.from(names);
        } catch { /* ignore */ }
        return [];
    }, [config]);

    // varName → [lo, hi] from the brush store. Updated per subscription.
    const [linkYDomains, setLinkYDomains] = useState<Map<string, [number, number] | null>>(new Map());

    useEffect(() => {
        if (linkYVarNames.length === 0) { setLinkYDomains(new Map()); return; }
        // B-199: capture cellName as a local so it's stable in the closure AND
        // appears in the dep array — if the cell's id changes, the effect re-runs
        // and old subscriptions (with the stale cellName) are cleaned up.
        // Use cellContext.id directly (rather than cellNameRef.current) since refs
        // can't appear in dependency arrays — the dep array is evaluated at hook
        // registration time before the ref is necessarily updated.
        const subscriberCell = cellContext.id;
        const unsubs = linkYVarNames.map(name =>
            plotBrushStore.subscribe(name, payload => {
                setLinkYDomains(prev => {
                    const next = new Map(prev);
                    if (payload.domain && (payload.mode === 'y' || payload.mode === 'xy')) {
                        next.set(name, payload.domain);
                    } else {
                        next.set(name, null);
                    }
                    return next;
                });
            }, subscriberCell)
        );
        return () => unsubs.forEach(u => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [linkYVarNames.join(','), cellContext.id]);

    /** Return the stored domain for a leaf's linkY or linkXY variable, or undefined. */
    const getLinkYDomain = (leaf: ParsedPlotCall): [number, number] | undefined => {
        const v = leaf.linkY ?? leaf.linkXY;
        if (!v) return undefined;
        return linkYDomains.get(v) ?? undefined;
    };

    /**
     * B-141/142/143: Resolve the dataset for a leaf plot, given its parsed `on` clause.
     * When `on` is present, look up the first reference in `dataByQueryRef`:
     *   - Numeric refs (e.g. "1", "#1") map to 1-based query indices stored under
     *     numeric keys. We strip a leading "#" before parsing.
     *   - Named refs map to string keys equal to the alias name.
     * Falls back to the primary `data` prop if the ref doesn't resolve.
     */
    const resolveLeafData = (on: string[] | undefined): any[] => {
        if (on && on.length > 0 && dataByQueryRef) {
            const ref = on[0].replace(/^#/, '');
            const asNum = parseInt(ref, 10);
            if (!isNaN(asNum) && dataByQueryRef[asNum] != null) return dataByQueryRef[asNum];
            if (dataByQueryRef[ref] != null) return dataByQueryRef[ref];
        }
        return data ?? [];
    };

    // Keep the last successfully-rendered plot content so we can show it while the
    // user is in the middle of typing a new (temporarily-broken) config.
    const lastValidContentRef = useRef<React.ReactNode>(null);

    // Stable cellName ref for brush publisher registration. Uses cellContext.id
    // so it survives config changes without un/re-registering.
    const cellNameRef = useRef<string>(cellContext.id);
    cellNameRef.current = cellContext.id;

    const handleVariableChange = (vars: Record<string, string>) => {
        // LINK_X variable changes always route to notebook-global metadata.variables
        // so sibling cells sharing the same variable names pick them up automatically.
        // Both $var and $$var names are stored as-is; allVariables in every cell merges
        // metadata.variables first, so any cell that references the same name will see it.
        onMetadataChange({ ...metadata, variables: { ...metadata.variables, ...vars } });
    };

    /**
     * Build a brush-variable change handler for a leaf with a BRUSH clause.
     * `usePlotGestures` writes { "gestureName.brush": {lo, hi} } as a nested
     * object. We intercept and:
     *  1. Flatten to { "$brushVarName.brush.lo": String(lo), "$brushVarName.brush.hi": String(hi) }
     *     so substituteVariables and expandBrushOperator can resolve them.
     *  2. Publish to plotBrushStore for cross-cell LINK-X/Y/XY subscriptions.
     *  3. On clear (lo/hi absent), store null domain in brush store.
     *
     * `gestureName` is the name without leading `$` (the gesture prefix written
     * by usePlotGestures); `brushVarName` is the full `$sel` form from the DSL.
     */
    const makeBrushVarHandler = useCallback(
        (brushVarName: string, mode: BrushMode) => (vars: Record<string, unknown>) => {
            const gestureName = brushVarName.replace(/^\$/, '');
            const raw = vars[`${gestureName}.brush`];
            if (raw && typeof raw === 'object') {
                const { lo, hi } = raw as { lo?: unknown; hi?: unknown };
                if (lo != null && hi != null) {
                    const loStr = String(lo);
                    const hiStr = String(hi);
                    handleVariableChange({
                        [`${brushVarName}.brush.lo`]: loStr,
                        [`${brushVarName}.brush.hi`]: hiStr,
                    });
                    plotBrushStore.publish({
                        name: brushVarName,
                        domain: [parseFloat(loStr), parseFloat(hiStr)],
                        mode,
                        cellName: cellNameRef.current,
                    });
                } else {
                    // Brush cleared.
                    plotBrushStore.clear(brushVarName, cellNameRef.current);
                }
            }
        },
        // handleVariableChange reads metadata via closure; it's stable enough here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [metadata, onMetadataChange],
    );

    // Register any BRUSH clause names in the brush store so cycle detection
    // works even before the first gesture fires. Re-runs whenever config changes.
    useEffect(() => {
        try {
            const expansion = expandPlotConstants(config?.trim() || 'TABLE()');
            const cfgStr = expansion.expanded.trim() || 'TABLE()';
            const allConfigs = splitTopLevelConfigs(cfgStr).flatMap(row => row.split(';').map(c => c.trim()).filter(Boolean));
            const cellName = cellNameRef.current;
            for (const c of allConfigs) {
                try {
                    const parsed = parsePlotCall(c);
                    if (parsed.brush?.name) {
                        plotBrushStore.registerPublisher(parsed.brush.name, cellName);
                    }
                } catch { /* ignore malformed configs during registration */ }
            }
        } catch { /* ignore */ }
        return () => {
            // Signal unmount so brush store can retain last value briefly.
            try {
                const expansion = expandPlotConstants(config?.trim() || 'TABLE()');
                const cfgStr = expansion.expanded.trim() || 'TABLE()';
                const allConfigs = splitTopLevelConfigs(cfgStr).flatMap(row => row.split(';').map(c => c.trim()).filter(Boolean));
                const cellName = cellNameRef.current;
                for (const c of allConfigs) {
                    try {
                        const parsed = parsePlotCall(c);
                        if (parsed.brush?.name) {
                            plotBrushStore.publisherUnmounting(parsed.brush.name, cellName);
                        }
                    } catch { /* ignore */ }
                }
            } catch { /* ignore */ }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config]);

    // When data refreshes, clamp any active brush domain to the new data range (B-140/B-171).
    // We only do this for numeric X axes; for time axes the data is already converted to ms so
    // numeric comparison works. Runs after each data change if there is a BRUSH clause.
    useEffect(() => {
        if (!data || data.length === 0) return;
        try {
            const expansion = expandPlotConstants(config?.trim() || 'TABLE()');
            const cfgStr = expansion.expanded.trim() || 'TABLE()';
            const allConfigs = splitTopLevelConfigs(cfgStr).flatMap(row => row.split(';').map(c => c.trim()).filter(Boolean));
            for (const c of allConfigs) {
                try {
                    const parsed = parsePlotCall(c);
                    if (!parsed.brush?.name) continue;
                    // Find the X column name from the main config.
                    const xMatch = parsed.mainConfig.match(/\bx\s*:\s*"?([^",)\s]+)"?/);
                    if (!xMatch) continue;
                    const xCol = xMatch[1];
                    // Compute min/max of the X column in current data.
                    let rMin: number | null = null;
                    let rMax: number | null = null;
                    const effectiveData = resolveLeafData(parsed.on);
                    for (const row of effectiveData) {
                        const v = getTimeValue(row[xCol]);
                        if (!isNaN(v)) {
                            if (rMin === null || v < rMin) rMin = v;
                            if (rMax === null || v > rMax) rMax = v;
                        }
                    }
                    if (rMin === null || rMax === null) continue;
                    plotBrushStore.clampToRange(parsed.brush.name, [rMin, rMax]);
                } catch { /* ignore malformed configs */ }
            }
        } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, config]);
    let mainContent: React.ReactNode = null;
    let inlineError: React.ReactNode = null;

    try {
        if (!data) return null;
        if (data.length === 0) return <div className="p-4 text-center text-gray-500 text-sm">Query returned no results.</div>;
        if (data[0]?.error) {
             return <div className="p-3 text-xs text-gray-500 italic">Query has errors — see SQL editor above.</div>;
        }

        // Expand `LET @name = value` constants before any further parsing so
        // both validation and rendering see the substituted form.
        const expansion = expandPlotConstants(config?.trim() || 'TABLE()');
        if (expansion.errors.length > 0) {
            throw new Error(expansion.errors.join('\n'));
        }
        const effectiveConfig = expansion.expanded.trim() || 'TABLE()';
        const rows = splitTopLevelConfigs(effectiveConfig).map(rowStr => rowStr.split(';').map(c => c.trim()).filter(Boolean)).filter(row => row.length > 0);

        const flatConfigs = rows.flat();
        if (flatConfigs.length === 0) return <div className="p-4 text-center text-gray-500 text-sm">Empty plot config.</div>;

        const isMainConfigFunctionCall = /^\w+\s*\(.*\)\s*$/s.test(parsePlotCall(flatConfigs[0]).mainConfig);
        if (flatConfigs.length === 1 && !isMainConfigFunctionCall && flatConfigs[0].trim() !== '') {
            throw new Error(`Invalid plot configuration. Expected a function call like 'TABLE()', but found extra text.`);
        }

        const isMulti = flatConfigs.length > 1;
        const grid = rows.map((rowConfigs, rowIndex) => (
            <div key={`r-${rowIndex}`} className="flex-1 flex gap-4 min-h-0">
                {rowConfigs.map((singleConfig, colIndex) => {
                    let outerClauses = ''; let mainConfig = singleConfig;
                    try {
                        // Try composite first; falls through to single-call shape when no `+`/ROW/COL is present.
                        const parsedRoot = parseComposite(singleConfig);

                        // Leaf renderer used by both the single-plot path and CompositeRenderer.
                        const renderLeaf = (leaf: ParsedPlotCall): React.ReactNode => {
                            const leafMain = leaf.mainConfig;
                            const leafTypeName = normalizePlotName(leafMain.match(/^(\w+)/)?.[1] || 'TABLE');
                            const leafReg = plotRegistry[leafTypeName];
                            if (!leafReg) throw new Error(`Unknown plot type "${leafTypeName}". Available types: ${Object.keys(plotRegistry).filter(k => k !== 'FLAME_GRAPH').join(', ')}.`);
                            // B-141/142/143: use leaf's ON clause to select the correct dataset.
                            const leafData = resolveLeafData(leaf.on);
                            const leafCfg = leafReg.parseConfig(leafMain, leafData);
                            const LeafComp = leafReg.component;
                            // Wire BRUSH clause: pass gestureName (without leading $) so the
                            // plot component shows its recharts Brush widget, and intercept
                            // variable change to flatten nested {lo,hi} to flat string keys
                            // and publish to plotBrushStore for cross-cell coupling.
                            const brushVarName = leaf.brush?.name;
                            const brushHandler = brushVarName
                                ? makeBrushVarHandler(brushVarName, leaf.brush!.mode)
                                : undefined;
                            let leafContent: React.ReactElement = (
                                <PlotErrorBoundary>
                                    <LeafComp
                                        config={leafCfg}
                                        data={leafData}
                                        clauses={leaf}
                                        isAnimationActive={true}
                                        animationDuration={300}
                                        {...(brushVarName ? {
                                            gestureName: brushVarName.replace(/^\$/, ''),
                                            onVariableChange: brushHandler,
                                        } : {})}
                                        {...(getLinkYDomain(leaf) ? { domainY: getLinkYDomain(leaf) } : {})}
                                    />
                                </PlotErrorBoundary>
                            );
                            if (leaf.linkX) {
                                leafContent = (
                                    <InteractivePlotWrapper linkX={leaf.linkX} linkXClamp={!!leaf.linkXClamp} data={leafData} xCol={(leafCfg as any).x} allVariables={allVariables} onVariableChange={handleVariableChange}>
                                        {leafContent}
                                    </InteractivePlotWrapper>
                                );
                            }
                            if (leaf.linkScroll) {
                                leafContent = (
                                    <ScrollSyncWrapper group={leaf.linkScroll}>
                                        {leafContent}
                                    </ScrollSyncWrapper>
                                );
                            }
                            const leafTitle = leaf.title || (leafCfg as any).title;
                            if (leafTitle) {
                                return (
                                    <div className="w-full h-full border border-gray-700 rounded-lg overflow-hidden flex flex-col">
                                        <h4 className="text-xs font-semibold text-gray-400 p-2 border-b border-gray-700 shrink-0 bg-gray-900/50 text-center truncate" title={leafTitle}>
                                            {leafTitle}
                                        </h4>
                                        <div className="flex-grow min-h-0">{leafContent}</div>
                                    </div>
                                );
                            }
                            return leafContent;
                        };

                        // Composite path: render via CompositeRenderer; treat outer-cell width/height as the box.
                        if (parsedRoot.composite) {
                            const issues = validateComposite(parsedRoot);
                            const errors = issues.filter(i => i.severity === 'error');
                            if (errors.length > 0) {
                                throw new Error(errors.map(e => e.message).join(' '));
                            }
                            for (const w of issues) {
                                if (w.severity === 'warn') console.warn(`[plot composite] ${w.message}`);
                            }
                            const cellStyle: React.CSSProperties = { flex: '1 1 0px', minWidth: 0 };
                            return (
                                <div key={`${rowIndex}-${colIndex}`} style={cellStyle} className="flex">
                                    <div className="w-full h-full">
                                        <CompositeRenderer parsed={parsedRoot} renderLeaf={renderLeaf} />
                                    </div>
                                </div>
                            );
                        }

                        // Single-plot path (preserves zoom + outer-cell title behavior).
                        const parsedCall = parsedRoot; // already a single ParsedPlotCall here
                        mainConfig = parsedCall.mainConfig;
                        outerClauses = singleConfig.substring(mainConfig.length);

                        const { width, height, zoom, title, linkX, linkXClamp, linkScroll } = parsedCall;
                        const plotTypeName = normalizePlotName(mainConfig.match(/^(\w+)/)?.[1] || 'TABLE');
                        const reg = plotRegistry[plotTypeName];
                        if (!reg) throw new Error(`Unknown plot type "${plotTypeName}". Available types: ${Object.keys(plotRegistry).filter(k => k !== 'FLAME_GRAPH').join(', ')}.`);

                        // B-141/142/143: resolve dataset via ON clause for the single-plot path too.
                        const singlePlotData = resolveLeafData(parsedCall.on);
                        const parsedConfig = reg.parseConfig(mainConfig, singlePlotData);
                        const PlotComponent = reg.component;

                        // Wire BRUSH clause for single-plot path.
                        const singleBrushVarName = parsedCall.brush?.name;
                        const singleBrushHandler = singleBrushVarName
                            ? makeBrushVarHandler(singleBrushVarName, parsedCall.brush!.mode)
                            : undefined;

                        let plotContent: React.ReactElement = (
                            <PlotErrorBoundary>
                                <PlotComponent
                                    config={parsedConfig}
                                    data={singlePlotData}
                                    clauses={parsedCall}
                                    isAnimationActive={true}
                                    animationDuration={300}
                                    {...(singleBrushVarName ? {
                                        gestureName: singleBrushVarName.replace(/^\$/, ''),
                                        onVariableChange: singleBrushHandler,
                                    } : {})}
                                    {...(getLinkYDomain(parsedCall) ? { domainY: getLinkYDomain(parsedCall) } : {})}
                                />
                            </PlotErrorBoundary>
                        );

                        if (linkX) {
                            plotContent = (
                                <InteractivePlotWrapper linkX={linkX} linkXClamp={!!linkXClamp} data={singlePlotData} xCol={(parsedConfig as any).x} allVariables={allVariables} onVariableChange={handleVariableChange}>
                                    {plotContent}
                                </InteractivePlotWrapper>
                            );
                        }

                        const displayTitle = title || (parsedConfig as any).title || (isMulti ? plotTypeName : undefined);
                        const showContainer = !!displayTitle;

                        const finalPlotEl = (
                            <ScrollSyncWrapper group={linkScroll ?? null}>
                                <div style={{position:'relative',width:'100%',height:'100%',overflow:'hidden'}}>
                                    <div style={{width:zoom?`${100/zoom}%`:'100%',height:zoom?`${100/zoom}%`:'100%',transform:`scale(${zoom||1})`,transformOrigin:'top left'}}>
                                        {plotContent}
                                    </div>
                                </div>
                            </ScrollSyncWrapper>
                        );

                        const cellStyle: React.CSSProperties = { flex: width ? `0 0 ${width}` : '1 1 0px', width, height, minWidth: 0 };

                        return (
                            <div key={`${rowIndex}-${colIndex}`} style={cellStyle} className="flex">
                                {showContainer ? (
                                    <div className="w-full h-full border border-gray-700 rounded-lg overflow-hidden flex flex-col">
                                        <h4 className="text-xs font-semibold text-gray-400 p-2 border-b border-gray-700 shrink-0 bg-gray-900/50 text-center truncate" title={displayTitle}>
                                            {displayTitle}
                                        </h4>
                                        <div className="flex-grow min-h-0">{finalPlotEl}</div>
                                    </div>
                                ) : (
                                    <div className="w-full h-full">{finalPlotEl}</div>
                                )}
                            </div>
                        );

                    } catch (e: any) {
                        const handleFix = (fixedCode: string) => {
                            const newRows = JSON.parse(JSON.stringify(rows));
                            newRows[rowIndex][colIndex] = fixedCode + outerClauses;
                            stableOnApplyFix(newRows.map(row => row.join('; ')).join('\n\n'));
                        };
                        e.fixContext = { failedConfig: mainConfig, onFix: handleFix };
                        throw e;
                    }
                })}
            </div>
        ));
        mainContent = <div className="h-full w-full flex flex-col gap-4 p-2 overflow-auto">{grid}</div>;
        // Save this as the last known-good render so we can show it while the
        // user is mid-edit and the config is temporarily invalid.
        lastValidContentRef.current = mainContent;

    } catch (e: any) {
        // B-110: guard against non-Error thrown values (strings, plain objects, etc.)
        // before accessing `.fixContext` or `.message`.
        const fixContext = e instanceof Error ? (e as any).fixContext : (e && typeof e === 'object' ? e.fixContext : undefined);
        const errorMessage: string = (e instanceof Error ? e.message : typeof e === 'string' ? e : String(e ?? 'Unknown error'));
        const errorInfo = { error: e, failedConfig: fixContext?.failedConfig || config, onFix: fixContext?.onFix || stableOnApplyFix };

        const ErrorDisplay = isAiFeatureActive
            ? <AiErrorFixer error={errorMessage} config={errorInfo.failedConfig} data={data!} sql={sqlRef.current} cellContext={cellContext} onApplyFix={errorInfo.onFix} metadata={metadata} />
            : <div className="p-3 text-sm text-red-400 bg-red-900/30 font-mono whitespace-pre-wrap">{errorMessage}</div>;

        // Show the last valid plot below the error banner so the user doesn't lose
        // their chart while they're in the middle of typing a new config.
        mainContent = lastValidContentRef.current;

        inlineError = (
            <div className="px-2 py-1.5 text-xs text-red-300 bg-red-900/25 border-l-2 border-red-500/60 rounded-r animate-fade-in">
                {ErrorDisplay}
            </div>
        );
    }

    return (
        <>
            {inlineError}
            {mainContent}
        </>
    );
};

function arePlotRendererPropsEqual(prev: PlotRendererProps, next: PlotRendererProps): boolean {
    return (
        prev.config === next.config &&
        prev.data === next.data &&
        prev.dataByQueryRef === next.dataByQueryRef &&
        // sql is only used in AiErrorFixer (error path) — stored in a ref so the
        // latest value is always accessible without triggering a re-render.
        prev.cellContext === next.cellContext &&
        // onApplyFix is a click handler, not a render input — exclude from comparison
        // so that the inline arrow function `c => handleApplyPlotFix(c, i)` created
        // per render does not invalidate the memo on every keystroke.
        prev.isAiFeatureActive === next.isAiFeatureActive &&
        prev.metadata?.customSystemPrompt === next.metadata?.customSystemPrompt &&
        prev.metadata?.variables === next.metadata?.variables &&
        prev.onMetadataChange === next.onMetadataChange &&
        prev.onCellVariableChange === next.onCellVariableChange &&
        prev.allVariables === next.allVariables
    );
}

export default React.memo(PlotRenderer, arePlotRendererPropsEqual);
