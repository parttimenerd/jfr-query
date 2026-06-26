
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

function debounce<T extends (...args: any[]) => any>(func: T, delay: number): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return function(this: any, ...args: Parameters<T>) {
    clearTimeout(timeout);
    setTimeout(() => func.apply(this, args), delay);
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
        let isMounted = true;
        setIsLoading(true);
        setApiError(null);
        aiService.getAiPlotFixSuggestion(error, sql, data, config, cellContext.content, metadata.customSystemPrompt)
            .then(res => { if (isMounted) setSuggestion(res); })
            .catch(err => { if (isMounted) setApiError(err.message); })
            .finally(() => { if (isMounted) setIsLoading(false); });
        
        return () => { isMounted = false; };
    }, [error, config, data, sql, cellContext, metadata]);

    return (
        <div className="p-4 text-sm text-yellow-400 bg-gray-800 border border-yellow-500/50 rounded-lg space-y-3 w-full max-w-md shadow-lg">
            <div><p className="font-semibold text-base text-yellow-300">Plot Error</p><p className="font-mono text-xs mt-1">{error}</p></div>
            <div className="border-t border-yellow-500/30 pt-3">
                {isLoading && <div className="flex items-center gap-2 text-yellow-300/80"><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div><span>Getting AI suggestion...</span></div>}
                {apiError && <p>Could not get AI suggestion: {apiError}</p>}
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
    const debouncedOnVariableChange = useCallback(debounce(onVariableChange, 200), [onVariableChange]);
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

    const handleInteraction = (newMin: number, newMax: number) => {
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
            if(dataRange.max - dataRange.min < finalMax - finalMin) {
                finalMin = dataRange.min;
                finalMax = dataRange.max;
            }
        }

        setLocalDomain([finalMin, finalMax]);
        debouncedOnVariableChange({ [linkX[0]]: String(finalMin), [linkX[1]]: String(finalMax) });
    };

    // Use a non-passive wheel listener so preventDefault() actually works.
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


interface PlotRendererProps {
    config: string;
    data: any[] | null;
    sql: string;
    cellContext: NotebookCellData;
    onApplyFix: (newConfig: string) => void;
    isAiFeatureActive?: boolean;
    metadata: NotebookMetadata;
    onMetadataChange: (newMetadata: NotebookMetadata) => void;
    onCellVariableChange: (vars: Record<string, string>) => void;
    allVariables: Record<string, string>;
}

const PlotRenderer: React.FC<PlotRendererProps> = ({ config, data, sql, cellContext, onApplyFix, isAiFeatureActive = false, metadata, onMetadataChange, onCellVariableChange, allVariables }) => {

    // Keep the last successfully-rendered plot content so we can show it while the
    // user is in the middle of typing a new (temporarily-broken) config.
    const lastValidContentRef = useRef<React.ReactNode>(null);

    const handleVariableChange = (vars: Record<string, string>) => {
        // LINK_X variable changes always route to notebook-global metadata.variables
        // so sibling cells sharing the same variable names pick them up automatically.
        // Both $var and $$var names are stored as-is; allVariables in every cell merges
        // metadata.variables first, so any cell that references the same name will see it.
        onMetadataChange({ ...metadata, variables: { ...metadata.variables, ...vars } });
    };

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
        const rows = effectiveConfig.split('\n\n').map(rowStr => rowStr.split(';').map(c => c.trim()).filter(Boolean)).filter(row => row.length > 0);

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
                            if (!leafReg) throw new Error(`Unknown plot type "${leafTypeName}".`);
                            const leafCfg = leafReg.parseConfig(leafMain, data);
                            const LeafComp = leafReg.component;
                            let leafContent: React.ReactElement = (
                                <PlotErrorBoundary>
                                    <LeafComp config={leafCfg} data={data} clauses={leaf} isAnimationActive={true} animationDuration={300} />
                                </PlotErrorBoundary>
                            );
                            if (leaf.linkX) {
                                leafContent = (
                                    <InteractivePlotWrapper linkX={leaf.linkX} linkXClamp={!!leaf.linkXClamp} data={data} xCol={(leafCfg as any).x} allVariables={allVariables} onVariableChange={handleVariableChange}>
                                        {leafContent}
                                    </InteractivePlotWrapper>
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

                        const { width, height, zoom, title, linkX, linkXClamp } = parsedCall;
                        const plotTypeName = normalizePlotName(mainConfig.match(/^(\w+)/)?.[1] || 'TABLE');
                        const reg = plotRegistry[plotTypeName];
                        if (!reg) throw new Error(`Unknown plot type "${plotTypeName}".`);

                        const parsedConfig = reg.parseConfig(mainConfig, data);
                        const PlotComponent = reg.component;

                        let plotContent: React.ReactElement = (
                            <PlotErrorBoundary>
                                <PlotComponent config={parsedConfig} data={data} clauses={parsedCall} isAnimationActive={true} animationDuration={300} />
                            </PlotErrorBoundary>
                        );

                        if (linkX) {
                            plotContent = (
                                <InteractivePlotWrapper linkX={linkX} linkXClamp={!!linkXClamp} data={data} xCol={(parsedConfig as any).x} allVariables={allVariables} onVariableChange={handleVariableChange}>
                                    {plotContent}
                                </InteractivePlotWrapper>
                            );
                        }

                        const displayTitle = title || (parsedConfig as any).title || (isMulti ? plotTypeName : undefined);
                        const showContainer = !!displayTitle;

                        const finalPlotEl = (
                            <div style={{position:'relative',width:'100%',height:'100%',overflow:'hidden'}}>
                                <div style={{width:zoom?`${100/zoom}%`:'100%',height:zoom?`${100/zoom}%`:'100%',transform:`scale(${zoom||1})`,transformOrigin:'top left'}}>
                                    {plotContent}
                                </div>
                            </div>
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
                            onApplyFix(newRows.map(row => row.join('; ')).join('\n\n'));
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
        const errorInfo = { error: e, failedConfig: e.fixContext?.failedConfig || config, onFix: e.fixContext?.onFix || onApplyFix };

        const ErrorDisplay = isAiFeatureActive && (errorInfo.error.message.includes("column") || errorInfo.error.message.includes("parameter"))
            ? <AiErrorFixer error={errorInfo.error.message} config={errorInfo.failedConfig} data={data!} sql={sql} cellContext={cellContext} onApplyFix={errorInfo.onFix} metadata={metadata} />
            : <div className="p-3 text-sm text-red-400 bg-red-900/30 font-mono whitespace-pre-wrap">{e.message}</div>;

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

export default PlotRenderer;
