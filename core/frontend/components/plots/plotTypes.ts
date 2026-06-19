import React from 'react';

export interface PlotParameter {
    name: string;
    type: string; // e.g., 'column', 'column[]', 'string', 'number'
    options?: string[]; // For string types, a list of allowed literal values.
    description: string;
    required?: boolean;
    defaultValue?: any;
}

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
  }>;
}
