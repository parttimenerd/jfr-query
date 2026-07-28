function buildSmartTemplate(plotName, columns, sampleRow) {
    if (columns.length === 0) return null;

    const isNumeric = (col) => {
        if (!sampleRow) return false;
        const v = sampleRow[col];
        return v !== null && v !== undefined && !isNaN(Number(v)) && typeof v !== 'boolean';
    };
    const isTime = (col) => {
        const lower = col.toLowerCase();
        if (/time|date|timestamp|bucket|window|^start$|^end$/i.test(lower)) return true;
        if (!sampleRow) return false;
        const v = sampleRow[col];
        if (v instanceof Date) return true;
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return true;
        return false;
    };

    const timeCols = columns.filter(isTime);
    const numericCols = columns.filter(c => isNumeric(c) && !isTime(c));
    const categoryCols = columns.filter(c => !isNumeric(c) && !isTime(c));

    const q = (s) => `"${s}"`;

    if (plotName === 'SCATTER_PLOT') {
        const xCol = numericCols[0] ?? columns[0];
        const yCol = numericCols[1] ?? columns.find(c => c !== xCol) ?? xCol;
        return `SCATTER_PLOT(x: ${q(xCol)}, y: ${q(yCol)})`;
    }
}

// Test case: 1 numeric column
const result = buildSmartTemplate('SCATTER_PLOT', ['value'], { value: 42 });
console.log("1 numeric column:", result);
// Expected: should warn or return something that doesn't use same column twice
// Actual: SCATTER_PLOT(x: "value", y: "value")

// Test case: 1 non-numeric column
const result2 = buildSmartTemplate('SCATTER_PLOT', ['name'], { name: 'foo' });
console.log("1 non-numeric column:", result2);
// Expected: SCATTER_PLOT(x: "name", y: "name") — same column twice!
