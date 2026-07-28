// W13 — Decimation helpers for large datasets.
//
// Three pure functions; no React, no DOM. Each takes the source data and a
// target row count and returns a decimated copy preserving the visual shape.
//
//   - lttb(data, xCol, yCol, target): Largest-Triangle-Three-Buckets, the
//     industry-standard time-series downsampler. Preserves visual extrema.
//   - stride(data, target): every Nth element (cheap, preserves data extent
//     but not extrema). Cheaper than LTTB; used for scatter plots and any
//     non-Y-bound visual.
//   - topN(data, n, by): keep the top N rows by `by` column; fold the tail
//     into an "Other" row.

/**
 * Largest-Triangle-Three-Buckets downsampling.
 *
 * Reference: Sveinn Steinarsson, "Downsampling Time Series for Visual
 * Representation" (MS thesis, U. Iceland 2013).
 *
 * Returns the original array unchanged if it is already ≤ target rows or
 * target < 3 (LTTB requires at least 3 buckets to be meaningful).
 *
 * The X column must be numeric (timestamp ms or any numeric scale).
 */
export function lttb<T extends Record<string, any>>(data: T[], xCol: string, yCol: string, target: number): T[] {
    if (target >= data.length) return data;
    if (target < 1) return [];
    if (target === 1) return [data[0]];
    if (target === 2) return [data[0], data[data.length - 1]];
    const n = data.length;
    const sampled: T[] = new Array(target);
    let sampledIdx = 0;

    // The bucket width = (n - 2) / (target - 2) — first and last points are always retained.
    const bucketSize = (n - 2) / (target - 2);

    sampled[sampledIdx++] = data[0];
    let aIndex = 0;

    for (let i = 0; i < target - 2; i++) {
        // Average point of the *next* bucket — used as the third triangle vertex.
        const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
        const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);
        const avgRangeLength = avgRangeEnd - avgRangeStart;
        let avgX = 0, avgY = 0;
        if (avgRangeLength > 0) {
            for (let j = avgRangeStart; j < avgRangeEnd; j++) {
                avgX += Number(data[j][xCol]) || 0;
                avgY += Number(data[j][yCol]) || 0;
            }
            avgX /= avgRangeLength;
            avgY /= avgRangeLength;
        } else {
            // Degenerate bucket — use last data point as centroid (per LTTB paper).
            avgX = Number(data[n - 1][xCol]) || 0;
            avgY = Number(data[n - 1][yCol]) || 0;
        }

        // Range of the *current* bucket.
        const rangeStart = Math.floor(i * bucketSize) + 1;
        const rangeEnd = Math.floor((i + 1) * bucketSize) + 1;

        const pointAX = Number(data[aIndex][xCol]) || 0;
        const pointAY = Number(data[aIndex][yCol]) || 0;

        let maxArea = -1;
        let maxAreaIdx = rangeStart;
        for (let j = rangeStart; j < rangeEnd; j++) {
            const x = Number(data[j][xCol]) || 0;
            const y = Number(data[j][yCol]) || 0;
            const area = Math.abs((pointAX - avgX) * (y - pointAY) - (pointAX - x) * (avgY - pointAY)) * 0.5;
            if (area > maxArea) {
                maxArea = area;
                maxAreaIdx = j;
            }
        }
        sampled[sampledIdx++] = data[maxAreaIdx];
        aIndex = maxAreaIdx;
    }

    sampled[sampledIdx++] = data[n - 1];
    return sampled;
}

/** Every Nth-element stride sampling. Cheap; preserves extent. */
export function stride<T>(data: T[], target: number): T[] {
    if (target >= data.length || target < 1) return data;
    const step = data.length / target;
    const out: T[] = new Array(target);
    for (let i = 0; i < target; i++) {
        out[i] = data[Math.floor(i * step)];
    }
    return out;
}

/**
 * Keep the top N rows by `by` (numeric) column. The tail is folded into a
 * synthetic row whose `by` column = sum-of-tail, and whose other columns are
 * filled with the `otherKey` value (default "Other") for string columns and
 * `null` for non-string columns. Preserves the input array's original shape.
 */
export function topN<T extends Record<string, any>>(
    data: T[],
    n: number,
    by: string,
    options: { otherKey?: string; labelCol?: string } = {},
): T[] {
    if (data.length <= n) return data;
    const sorted = [...data].sort((a, b) => (Number(b[by]) || 0) - (Number(a[by]) || 0));
    const head = sorted.slice(0, n);
    const tail = sorted.slice(n);
    const otherLabel = options.otherKey ?? 'Other';
    const labelCol = options.labelCol;

    const otherRow: Record<string, any> = {};
    const sampleRow = data[0];
    for (const key of Object.keys(sampleRow)) {
        if (key === by) {
            otherRow[key] = tail.reduce((acc, row) => acc + (Number(row[by]) || 0), 0);
        } else if (labelCol ? key === labelCol : typeof sampleRow[key] === 'string') {
            otherRow[key] = otherLabel;
        } else {
            otherRow[key] = null;
        }
    }
    return [...head, otherRow as T];
}
