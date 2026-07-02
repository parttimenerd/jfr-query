
const pad = (num: number, length = 2): string => String(num).padStart(length, '0');

// Aligns with normalizeEpochInteger in plotUtils.ts:
// digits >= 18 → nanoseconds (÷1e6), digits >= 15 → microseconds (÷1e3), else ms.
function normalizeEpochToMs(n: number, digits: number): number {
    if (digits >= 18) return n / 1_000_000;
    if (digits >= 15) return n / 1_000;
    return n;
}

export const formatTimestamp = (timestamp: number | bigint | string, format: string): string => {
    if (timestamp === null || timestamp === undefined) return String(timestamp);
    
    const originalValue = String(timestamp);
    let date: Date;

    if (typeof timestamp === 'number' || typeof timestamp === 'bigint') {
        const num = Number(timestamp);
        date = new Date(normalizeEpochToMs(num, originalValue.length));
    } else if (typeof timestamp === 'string') {
        const asNumber = Number(timestamp);
        // Check if the string is purely numeric
        if (!isNaN(asNumber) && timestamp.match(/^\d+$/)) {
            date = new Date(normalizeEpochToMs(asNumber, timestamp.length));
        } else {
            // Otherwise, parse as a date string (e.g., ISO format)
            date = new Date(timestamp);
        }
    } else {
        return originalValue;
    }
    
    if (isNaN(date.getTime())) return originalValue;

    if (format === 'ISO') return date.toISOString();

    const replacements = {
        'YYYY': String(date.getFullYear()),
        'MM': pad(date.getMonth() + 1),
        'DD': pad(date.getDate()),
        'HH': pad(date.getHours()),
        'mm': pad(date.getMinutes()),
        'ss': pad(date.getSeconds()),
        'SSS': pad(date.getMilliseconds(), 3),
        'SS': pad(date.getMilliseconds(), 3).substring(0, 2),
        'S': pad(date.getMilliseconds(), 3).substring(0, 1),
    };

    return format.replace(/YYYY|SSS|SS|S|MM|DD|HH|mm|ss/g, match => {
        return replacements[match as keyof typeof replacements] ?? match;
    });
};
