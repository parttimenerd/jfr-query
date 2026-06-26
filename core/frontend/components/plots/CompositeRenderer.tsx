// W10 — CompositeRenderer
//
// Renders a `ParsedPlotCall.composite` tree. Three shapes:
//   - direction: 'overlay'  → children stacked absolutely with shared axes (visual overlay)
//   - direction: 'row'      → horizontal flex
//   - direction: 'col'      → vertical flex
//
// Each child is itself a `ParsedPlotCall` and may recursively contain its own
// `composite` field. Leaf children (no `composite`) are rendered via the
// single-plot path supplied by the caller as `renderLeaf`.
//
// W14 (child-error isolation) wraps each child in an error boundary so a
// single broken child does not crash the whole composite.

import React from 'react';
import type { ParsedPlotCall } from '../../utils/plotParser';

interface CompositeChildErrorBoundaryState { error: string | null }
class CompositeChildErrorBoundary extends React.Component<{ children: React.ReactNode; index: number }, CompositeChildErrorBoundaryState> {
    constructor(props: any) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(e: any) { return { error: e?.message ?? 'Unknown render error' }; }
    render() {
        if (this.state.error) {
            return (
                <div className="p-2 text-xs text-red-400 bg-red-900/30 font-mono border border-red-500/40 rounded">
                    Failed to render child {this.props.index + 1}: {this.state.error}
                </div>
            );
        }
        return this.props.children as any;
    }
}

export interface CompositeRendererProps {
    parsed: ParsedPlotCall;
    renderLeaf: (leaf: ParsedPlotCall) => React.ReactNode;
}

export const CompositeRenderer: React.FC<CompositeRendererProps> = ({ parsed, renderLeaf }) => {
    const comp = parsed.composite;
    if (!comp) {
        return <>{renderLeaf(parsed)}</>;
    }

    const renderChild = (child: ParsedPlotCall): React.ReactNode =>
        child.composite
            ? <CompositeRenderer parsed={child} renderLeaf={renderLeaf} />
            : renderLeaf(child);

    if (comp.direction === 'overlay') {
        return (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                {comp.children.map((c, i) => (
                    <div key={i} style={{ position: 'absolute', inset: 0 }}>
                        <CompositeChildErrorBoundary index={i}>
                            {renderChild(c)}
                        </CompositeChildErrorBoundary>
                    </div>
                ))}
            </div>
        );
    }

    const flexDir: React.CSSProperties['flexDirection'] = comp.direction === 'row' ? 'row' : 'column';
    return (
        <div style={{ display: 'flex', flexDirection: flexDir, gap: '0.75rem', width: '100%', height: '100%', minHeight: 0 }}>
            {comp.children.map((c, i) => (
                <div key={i} style={{ flex: '1 1 0px', minWidth: 0, minHeight: 0 }}>
                    <CompositeChildErrorBoundary index={i}>
                        {renderChild(c)}
                    </CompositeChildErrorBoundary>
                </div>
            ))}
        </div>
    );
};
