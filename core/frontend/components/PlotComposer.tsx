/**
 * PlotComposer: renders a ParsedPlotCall with composite (row/col) layouts.
 *
 * This is a thin wrapper around PlotRenderer that is intended for use when you
 * have an already-parsed ParsedPlotCall (e.g. from a unit test or a higher-level
 * orchestrator) and want to render it directly without re-parsing config text.
 *
 * For typical notebook use, PlotRenderer handles composite layouts internally via
 * its CompositeRenderer. PlotComposer exists as a public entry point for cases
 * where the parsed form is already available.
 */

import React from 'react';
import PlotRenderer from './PlotRenderer';
import type { ParsedPlotCall } from '../utils/plotParser';
import type { NotebookCellData, NotebookMetadata } from '../types';

export interface PlotComposerProps {
    /** The already-parsed plot call. May be composite (row/col) or a single plot. */
    parsed: ParsedPlotCall;
    data: any[];
    sql: string;
    cellContext: NotebookCellData;
    onApplyFix: (newConfig: string) => void;
    isAiFeatureActive?: boolean;
    metadata: NotebookMetadata;
    onMetadataChange: (newMetadata: NotebookMetadata) => void;
    allVariables: Record<string, string>;
    onCellVariableChange?: (vars: Record<string, unknown>) => void;
}

/**
 * Renders a ParsedPlotCall (including composite row/col layouts) by delegating
 * to PlotRenderer with the reconstructed config string.  PlotRenderer's own
 * CompositeRenderer handles the recursive layout, so PlotComposer just needs to
 * pass a config string that parsePlotCall will parse back to the same structure.
 *
 * For composite plots the mainConfig is empty and composite is set; PlotRenderer
 * will detect this and use CompositeRenderer automatically.
 *
 * If the parsed plot has mainConfig already (UPPERCASE form), use it directly.
 * For composite plots, we cannot easily round-trip back to a config string, so we
 * instead use a serialised JSON sentinel that PlotRenderer can detect.
 *
 * NOTE: This component is provided for API completeness. In the notebook, PlotRenderer
 * is always called with a raw config string and handles composites internally.
 */
const PlotComposer: React.FC<PlotComposerProps> = ({
    parsed,
    data,
    sql,
    cellContext,
    onApplyFix,
    isAiFeatureActive = false,
    metadata,
    onMetadataChange,
    allVariables,
    onCellVariableChange,
}) => {
    // For single (non-composite) plots, use mainConfig directly.
    const configStr = parsed.composite
        ? buildCompositeConfig(parsed)
        : buildSingleConfig(parsed);

    return (
        <PlotRenderer
            config={configStr}
            data={data}
            sql={sql}
            cellContext={cellContext}
            onApplyFix={onApplyFix}
            isAiFeatureActive={isAiFeatureActive}
            metadata={metadata}
            onMetadataChange={onMetadataChange}
            onCellVariableChange={onCellVariableChange ?? (() => {})}
            allVariables={allVariables}
        />
    );
};

/** Reconstruct the UPPERCASE config string for a single (non-composite) plot. */
function buildSingleConfig(parsed: ParsedPlotCall): string {
    let config = parsed.mainConfig;
    if (parsed.title) config += ` TITLE "${parsed.title}"`;
    if (parsed.width) config += ` WIDTH ${parsed.width}`;
    if (parsed.height) config += ` HEIGHT ${parsed.height}`;
    if (parsed.zoom !== undefined) config += ` ZOOM ${parsed.zoom}`;
    if (parsed.on && parsed.on.length > 0) config += ` ON ${parsed.on.join(', ')}`;
    if (parsed.linkX) {
        let lx = `LINK_X(${parsed.linkX[0]}, ${parsed.linkX[1]}`;
        if (parsed.linkXMaster) lx += ', master';
        if (parsed.linkXClamp) lx += ', clamp';
        lx += ')';
        config += ' ' + lx;
    }
    return config;
}

/**
 * Reconstruct a lowercase DSL config string for composite (row/col) plots so
 * PlotRenderer can parse it back using parsePlotCall.
 */
function buildCompositeConfig(parsed: ParsedPlotCall): string {
    return serializeParsedPlot(parsed);
}

function serializeParsedPlot(p: ParsedPlotCall): string {
    if (p.composite) {
        const { direction, children } = p.composite;
        const inner = children.map(serializeParsedPlot).join('; ');
        let result = `${direction} { ${inner} }`;
        if (p.title) result += ` | title: "${p.title}"`;
        if (p.width) result += ` | width: ${p.width}`;
        if (p.height) result += ` | height: ${p.height}`;
        return result;
    }
    // Single plot: use the mainConfig as a lowercase-style block.
    // The mainConfig is already in UPPERCASE form (e.g. LINE_CHART(x: "time")),
    // so we just return it as-is since parsePlotCall handles UPPERCASE.
    return buildSingleConfig(p);
}

export default PlotComposer;
