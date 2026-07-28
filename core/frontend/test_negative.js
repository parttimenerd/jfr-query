function normalizeEpochNumber(n) {
    if (!Number.isFinite(n)) return NaN;
    if (!Number.isInteger(n)) {
        const intPart = Math.trunc(Math.abs(n));
        const digits = intPart === 0 ? 1 : Math.floor(Math.log10(intPart)) + 1;
        if (digits === 10) return n * 1000;
        return n;
    }
    const digits = n === 0 ? 1 : Math.floor(Math.log10(Math.abs(n))) + 1;
    return normalizeEpochInteger(n, digits);
}

function normalizeEpochInteger(n, digits) {
    if (digits >= 18) return n / 1_000_000;
    if (digits >= 15) return n / 1_000;
    return n;
}

function getTimeValue(value) {
    if (value === null || value === undefined) return NaN;
    if (value instanceof Date) {
        const t = value.getTime();
        return normalizeEpochNumber(t);
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
        const num = Number(value);
        if (!Number.isFinite(num)) return NaN;
        return normalizeEpochNumber(num);
    }
    if (typeof value === 'string') {
        if (/^-?\d+$/.test(value)) {
            const asInt = Number(value);
            if (!Number.isFinite(asInt)) return NaN;
            const digitCount = value.startsWith('-') ? value.length - 1 : value.length;
            console.log(`String integer: ${value}, digitCount=${digitCount}`);
            return normalizeEpochInteger(asInt, digitCount);
        }
        const asNumber = Number(value);
        if (!isNaN(asNumber) && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(value)) {
            return normalizeEpochNumber(asNumber);
        }
        const date = new Date(value);
        if (!isNaN(date.getTime())) return date.getTime();
    }
    return NaN;
}

// Test: negative numbers
console.log("Negative int string (16 digits):", getTimeValue('-1716584383215000'));
// digitCount = 16 (excluding the -)
// normalizeEpochInteger(-1716584383215000, 16) -> n / 1000 = -1716584383215
// This looks correct

console.log("Negative int string (19 digits):", getTimeValue('-1716584383215000000'));
// digitCount = 19 (excluding the -)
// normalizeEpochInteger(-1716584383215000000, 19) -> n / 1_000_000 = -1716584383.215
// This looks correct
