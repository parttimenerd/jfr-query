import { classifyColumns, type ColumnInfo } from './classifyColumns';

export function heuristicPlot(
    columns: { name: string; type: string }[],
    sample: any[],
): string {
    if (columns.length === 0) return 'TABLE()';

    const roles: ColumnInfo[] = classifyColumns(columns, sample);
    const time = roles.find(r => r.role === 'time');
    const numerics = roles.filter(r => r.role === 'numeric');
    const cats = roles.filter(r => r.role === 'category');

    // Single scalar value → table
    if (roles.length === 1 && numerics.length === 1) return 'TABLE()';

    // Time + numerics → line chart
    if (time && numerics.length >= 1) {
        const yCols = numerics.map(n => `"${n.name}"`).join(', ');
        return `LINE_CHART(x: "${time.name}", y: [${yCols}])`;
    }

    // Category + one numeric → bar chart
    if (cats.length === 1 && numerics.length === 1) {
        return `BAR_CHART(category: "${cats[0].name}", value: "${numerics[0].name}")`;
    }

    // Multiple numerics, no time → histogram of first
    if (numerics.length >= 1 && cats.length === 0) {
        return `HISTOGRAM(column: "${numerics[0].name}")`;
    }

    // Category + multiple numerics → grouped bar
    if (cats.length === 1 && numerics.length > 1) {
        const yCols = numerics.map(n => `"${n.name}"`).join(', ');
        return `BAR_CHART(category: "${cats[0].name}", values: [${yCols}])`;
    }

    return 'TABLE()';
}
