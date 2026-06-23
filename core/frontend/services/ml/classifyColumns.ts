export type ColumnRole = 'time' | 'numeric' | 'category';

export interface ColumnInfo {
    name: string;
    type: string;
    role: ColumnRole;
}

const TIME_NAME_RE = /^(time|start|end|when|bucket|date|ts|timestamp|tick|at)$/i;
const NUMERIC_TYPE_RE = /INT|DOUBLE|DECIMAL|FLOAT|REAL|NUMERIC|HUGEINT|BIGINT|SMALLINT|TINYINT/i;

export function classifyColumns(
    cols: { name: string; type: string }[],
    sample: any[],
): ColumnInfo[] {
    return cols.map(c => {
        const sampleVal = sample[0]?.[c.name];
        const typeStr = c.type?.toUpperCase() ?? '';

        if (typeStr.includes('TIMESTAMP') || typeStr.includes('DATE') || TIME_NAME_RE.test(c.name)) {
            return { ...c, role: 'time' as const };
        }
        if (typeof sampleVal === 'number' || NUMERIC_TYPE_RE.test(typeStr)) {
            return { ...c, role: 'numeric' as const };
        }
        return { ...c, role: 'category' as const };
    });
}
