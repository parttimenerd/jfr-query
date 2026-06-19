
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { plotRegistry } from './plots/plotRegistry';
import type { NotebookCellData, NotebookMetadata } from '../types';
import { aiService } from '../services/AiService';
import { WandSparklesIcon } from './icons/WandSparklesIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { parsePlotCall } from '../utils/plotParser';
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

    useEffect(() => {
        const [minVar, maxVar] = linkX;
        const minVal = parseFloat(allVariables[minVar]);
        const maxVal = parseFloat(allVariables[maxVar]);
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

    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        if (isLocked || !e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();

        const rangeArr: [number, number] | null = dataRange ? [dataRange.min, dataRange.max] : null;
        const [currentMin, currentMax] = localDomain ?? rangeArr ?? [0, 1];
        
        if (!wrapperRef.current) return;

        const rect = wrapperRef.current.getBoundingClientRect();
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

        let newMin = mouseValue - newRange * mousePercent;
        let newMax = newMin + newRange;
        handleInteraction(newMin, newMax);
    };
    
    return (
        <div ref={wrapperRef} onWheel={handleWheel} style={{ width: '100%', height: '100%', cursor: isLocked ? 'default' : 'crosshair' }} className="relative group">
            <button onClick={() => setIsLocked(!isLocked)} className="absolute top-1 right-1 z-10 p-1 bg-gray-700/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" title={isLocked ? "Unlock Plot" : "Lock Plot"}>
                {isLocked ? <LockClosedIcon className="w-4 h-4 text-yellow-400"/> : <LockOpenIcon className="w-4 h-4 text-gray-300"/>}
            </button>
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
    errorPortalId?: string;
}

const PlotRenderer: React.FC<PlotRendererProps> = ({ config, data, sql, cellContext, onApplyFix, isAiFeatureActive = false, metadata, onMetadataChange, onCellVariableChange, allVariables, errorPortalId }) => {
    
    // Using a ref to get the portal container avoids issues with it not being mounted on first render.
    const portalContainerRef = useRef<HTMLElement | null>(null);
    useEffect(() => {
        portalContainerRef.current = errorPortalId ? document.getElementById(errorPortalId) : null;
    });

    const handleVariableChange = (vars: Record<string, string>) => {
        const isGlobal = Object.keys(vars).some(v => v.startsWith('$$'));
        if (isGlobal) {
            onMetadataChange({ ...metadata, variables: { ...metadata.variables, ...vars } });
        } else {
            onCellVariableChange(vars);
        }
    };
    
    let mainContent: React.ReactNode = null;
    let errorForPortal: React.ReactNode = null;

    try {
        if (!data) return null;
        if (data.length === 0) return <div className="p-4 text-center text-gray-500 text-sm">Query returned no results.</div>;
        if (data[0]?.error) {
             const message = String(data[0].error);
             if (message.includes("Undefined variable")) {
                 // Future: Add a create variable button here.
             }
             return <div className="p-3 text-sm text-red-400 bg-red-900/30 font-mono whitespace-pre-wrap">{message}</div>;
        }
        
        const rows = (config?.trim() || 'TABLE()').split('\n\n').map(rowStr => rowStr.split(';').map(c => c.trim()).filter(Boolean)).filter(row => row.length > 0);
        
        const flatConfigs = rows.flat();
        if (flatConfigs.length === 0) return <div className="p-4 text-center text-gray-500 text-sm">Empty plot config.</div>;
        
        const isMainConfigFunctionCall = /^\w+\s*\(.*\)\s*$/.test(parsePlotCall(flatConfigs[0]).mainConfig);
        if (flatConfigs.length === 1 && !isMainConfigFunctionCall && flatConfigs[0].trim() !== '') {
            throw new Error(`Invalid plot configuration. Expected a function call like 'TABLE()', but found extra text.`);
        }

        const isMulti = flatConfigs.length > 1;
        const grid = rows.map((rowConfigs, rowIndex) => (
            <div key={`r-${rowIndex}`} className="flex-1 flex gap-4 min-h-0">
                {rowConfigs.map((singleConfig, colIndex) => {
                    let outerClauses = ''; let mainConfig = singleConfig;
                    try {
                        const parsedCall = parsePlotCall(singleConfig);
                        mainConfig = parsedCall.mainConfig;
                        outerClauses = singleConfig.substring(mainConfig.length);
                        
                        const { width, height, zoom, title, linkX, linkXClamp } = parsedCall;
                        const plotTypeName = (mainConfig.match(/^(\w+)/)?.[1] || 'TABLE').toUpperCase();
                        const reg = plotRegistry[plotTypeName];
                        if (!reg) throw new Error(`Unknown plot type "${plotTypeName}".`);
                        
                        const parsedConfig = reg.parseConfig(mainConfig, data);
                        const PlotComponent = reg.component;
                        
                        let plotContent: React.ReactElement = <PlotComponent config={parsedConfig} data={data} isAnimationActive={true} animationDuration={300} />;
                        
                        if (linkX) {
                            plotContent = (
                                <InteractivePlotWrapper linkX={linkX} linkXClamp={!!linkXClamp} data={data} xCol={(parsedConfig as any).x} allVariables={allVariables} onVariableChange={handleVariableChange}>
                                    {plotContent}
                                </InteractivePlotWrapper>
                            );
                        }

                        const displayTitle = title || (isMulti ? plotTypeName : undefined);
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

    } catch (e: any) {
        const errorInfo = { error: e, failedConfig: e.fixContext?.failedConfig || config, onFix: e.fixContext?.onFix || onApplyFix };
        
        const ErrorDisplay = isAiFeatureActive && (errorInfo.error.message.includes("column") || errorInfo.error.message.includes("parameter"))
            ? <AiErrorFixer error={errorInfo.error.message} config={errorInfo.failedConfig} data={data!} sql={sql} cellContext={cellContext} onApplyFix={errorInfo.onFix} metadata={metadata} />
            : <div className="p-3 text-sm text-red-400 bg-red-900/30 font-mono whitespace-pre-wrap">{e.message}</div>;

        errorForPortal = (
            <div className="absolute inset-0 bg-gray-900/80 backdrop-blur-sm z-10 flex items-center justify-center p-4 animate-fade-in">
                {ErrorDisplay}
            </div>
        );
    }

    return (
        <>
            {mainContent}
            {errorForPortal && portalContainerRef.current && ReactDOM.createPortal(errorForPortal, portalContainerRef.current)}
        </>
    );
};

export default PlotRenderer;
