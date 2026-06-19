import React from 'react';
import { PlotRegistration, PlotParameter } from './plotTypes';
import DataTable from '../DataTable';
import { createConfigParser } from '../../utils/plotConfigParser';
import { buildParserSpec, findColumn } from '../../utils/plotUtils';

interface TablePlotConfig {
  headers?: string[];
  columnWidths?: (string | number)[];
}

const params: PlotParameter[] = [
    { name: 'headers', type: 'string[]', description: 'Optional. An array of strings to select and display specific columns in the specified order.' },
    { name: 'columnWidths', type: '(string|number)[]', description: 'Optional. An array of numbers (pixels) or strings ("50%") to set column widths. Use -1 for auto-width.' },
];

const parseConfig = createConfigParser<TablePlotConfig>(buildParserSpec(params));


const TablePlotComponent: React.FC<{ config: TablePlotConfig; data: any[], domainX?: [any, any] }> = ({ config, data }) => {
    let resolvedHeaders = config.headers;
    if (config.headers && data && data.length > 0) {
        const allColumns = Object.keys(data[0]);
        resolvedHeaders = config.headers.map(h => findColumn(h, allColumns));
    }
    
    // Convert parsed widths into a format suitable for the DataTable component.
    const widths = config.columnWidths?.map(w => {
        // The parser converts "-1" to the number -1. This signifies auto-width.
        if (w === -1) {
            return undefined; // Let the browser decide the width
        }
        // Otherwise, it's either a number (pixels) or a string (percentage)
        return w;
    });

    return React.createElement(
        'div',
        { className: "h-full" },
        React.createElement(DataTable, {
            data: data,
            headers: resolvedHeaders,
            columnWidths: widths,
        })
    );
};

export const tablePlot: PlotRegistration<TablePlotConfig> = {
  name: 'TABLE',
  description: 'Displays raw data in a sortable, filterable table. This is the default plot type.',
  params: params,
  supportsMultiQuery: false,
  template: 'TABLE()',
  examples: [
    {
        description: 'A default table that auto-detects columns from the query result.',
        code: 'TABLE() TITLE "Raw Query Results"',
    },
    {
        description: 'A table showing specific columns, with custom pixel and percentage widths. The last column is auto-sized.',
        code: 'TABLE(headers: ["startTime", "duration", "gcCause"], columnWidths: ["50%", 100, -1])',
        sampleData: [
            { startTime: '2023-01-01 10:00:05.123', duration: 15.6, gcCause: 'Allocation Failure', heapUsed: 1024 },
            { startTime: '2023-01-01 10:05:10.456', duration: 180.2, gcCause: 'System.gc()', heapUsed: 850 },
            { startTime: '2023-01-01 10:10:15.789', duration: 12.1, gcCause: 'Allocation Failure', heapUsed: 1340 },
        ]
    }
  ],
  parseConfig: parseConfig,
  component: TablePlotComponent,
};
