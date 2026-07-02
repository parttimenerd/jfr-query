import React from 'react';

export interface PlotParameter {
    name: string;
    type: string; // e.g., 'column', 'column[]', 'string', 'number'
    options?: string[]; // For string types, a list of allowed literal values.
    description: string;
    required?: boolean;
    defaultValue?: any;
    // When set, this param is an alias for `aliasFor` and emits a deprecation
    // warning when used. Hidden from autocomplete / signature rendering.
    aliasFor?: string;
    deprecated?: boolean;
}

// Parameters accepted by every plot type.
export const COMMON_PLOT_PARAMS: PlotParameter[] = [
    { name: 'title', type: 'string', required: false, description: 'Optional title displayed above the chart. Equivalent to the TITLE "..." outer clause.' },
];

/** Returns params with COMMON_PLOT_PARAMS appended, deduplicating by name. */
export const withCommonParams = (params: PlotParameter[]): PlotParameter[] => {
    const existing = new Set(params.map(p => p.name));
    return [...params, ...COMMON_PLOT_PARAMS.filter(p => !existing.has(p.name))];
};

export interface PlotExample {
    description: string;
    code: string;
    // Optional sample data if this example needs something specific
    sampleData?: any[]; 
}

export interface PlotRegistration<TConfig = any> {
  name: string;
  description: string;
  
  // Parameters are the single source of truth
  params: PlotParameter[];
  
  // Can this plot handle data from multiple queries via `ON 1, 2`?
  supportsMultiQuery?: boolean;

  // Does this plot support numeric x-axis zoom/pan via domainX prop?
  // True for LINE_CHART, AREA_CHART, RANGE_PLOT, SCATTER_PLOT.
  supportsZoom?: boolean;

  // Explicit template for autocompletion
  template: string;

  // Examples are now self-contained
  examples: PlotExample[];
  
  // The parser function (can be generated)
  parseConfig: (config: string, data: any[]) => TConfig;
  
  // The React component that renders the plot.
  component: React.FC<{
    config: TConfig;
    data: any[];
    // For multi-query plots, this provides context for legends etc.
    dataSources?: { name: string; data: any[] }[];
    domainX?: [any, any];
    isAnimationActive?: boolean;
    animationDuration?: number;
    // W4 — Cross-cutting clause props forwarded by PlotRenderer. Each plot
    // reads only the fields it cares about; axis-less plots ignore axisX/axisY.
    clauses?: import('../../utils/plotParser').ParsedPlotCall;
  }>;
}
