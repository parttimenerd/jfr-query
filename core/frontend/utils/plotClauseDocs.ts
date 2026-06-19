import type { PlotParameter } from '../components/plots/plotTypes';

export interface ClauseDoc {
    name: string;
    signature: string;
    description: string;
    params: PlotParameter[];
}

export const plotClauseDocs: Record<string, ClauseDoc> = {
    TITLE: {
        name: 'TITLE',
        signature: 'TITLE "string"',
        description: 'Adds a title that is displayed above the plot or grid cell.',
        params: [
            { name: 'string', type: 'string', required: true, description: 'The title text to display.' }
        ]
    },
    ON: {
        name: 'ON',
        signature: 'ON query_ref[, query_ref2, ...]',
        description: 'Specifies which query result(s) the plot should use. If omitted, it defaults to the preceding query.',
        params: [
            { name: 'query_ref', type: 'number | string', required: true, description: 'A 1-based index of the query in the cell, or a query alias defined with `CREATE VIEW ... AS`.' }
        ]
    },
    WIDTH: {
        name: 'WIDTH',
        signature: 'WIDTH size',
        description: 'Sets the width of the plot within a grid. Ignored for single plots.',
        params: [
            { name: 'size', type: 'string', required: true, description: 'A CSS size, e.g., "300px" or "50%".' }
        ]
    },
    HEIGHT: {
        name: 'HEIGHT',
        signature: 'HEIGHT size',
        description: 'Sets the height of the plot within a grid. Ignored for single plots.',
        params: [
            { name: 'size', type: 'string', required: true, description: 'A CSS size, e.g., "300px".' }
        ]
    },
    ZOOM: {
        name: 'ZOOM',
        signature: 'ZOOM factor',
        description: 'Visually scales the contents of a plot within its container. Useful for making complex plots larger in a grid.',
        params: [
            { name: 'factor', type: 'number', required: true, description: 'A scaling factor, e.g., 0.9 for 90%, 1.2 for 120%.' }
        ]
    },
    LINK_X: {
        name: 'LINK_X',
        signature: 'LINK_X($start_var, $end_var, [master], [clamp])',
        description: 'Links a plot\'s X-axis to local variables for interactive zooming and panning. All plots in a cell linked to the same variables are synchronized.',
        params: [
            { name: '$start_var', type: 'variable', required: true, description: 'A local variable (e.g., `$start`) to store the minimum visible X-value.' },
            { name: '$end_var', type: 'variable', required: true, description: 'A local variable (e.g., `$end`) to store the maximum visible X-value.' },
            { name: 'master', type: 'keyword', required: false, description: 'Optional. This plot will set the initial values of the variables to its full data range.' },
            { name: 'clamp', type: 'keyword', required: false, description: 'Optional. Prevents zooming or panning beyond this plot\'s own data range.' },
        ]
    }
};