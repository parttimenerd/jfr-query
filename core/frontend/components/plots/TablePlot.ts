import React from 'react';
import { PlotRegistration, PlotParameter, withCommonParams } from './plotTypes';
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


const TablePlotComponent: React.FC<{ config: TablePlotConfig; data: any[], domainX?: [any, any]; clauses?: import('../../utils/plotParser').ParsedPlotCall; onCellVariableChange?: (vars: Record<string, string>) => void }> = ({ config, data, clauses, onCellVariableChange }) => {
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

    // Derive a filename from the plot title (e.g. "GC Pauses" → "gc-pauses.csv")
    const title = clauses?.title || (config as any).title;
    const csvFilename = title
        ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.csv'
        : 'data.csv';

    const sort = clauses?.sort;
    const handleSortChange = sort && onCellVariableChange
        ? (col: string, dir: 'asc' | 'desc') => {
            onCellVariableChange({ [sort.colVar]: col, [sort.dirVar]: dir });
          }
        : undefined;

    const displayData = clauses?.limit !== undefined ? data.slice(0, clauses.limit) : data;

    return React.createElement(
        'div',
        { className: "h-full" },
        React.createElement(DataTable, {
            data: displayData,
            headers: resolvedHeaders,
            columnWidths: widths,
            csvFilename,
            onSortChange: handleSortChange,
        })
    );
};

export const tablePlot: PlotRegistration<TablePlotConfig> = {
  name: 'TABLE',
  description: 'Sortable, filterable table with CSV export — the default when no other plot is specified. Timestamps, durations, and numbers are auto-formatted.',
  params: withCommonParams(params),
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
