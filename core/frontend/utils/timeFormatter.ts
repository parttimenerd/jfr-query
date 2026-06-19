
const pad = (num: number, length = 2): string => String(num).padStart(length, '0');

export const formatTimestamp = (timestamp: number | bigint | string, format: string): string => {
    if (timestamp === null || timestamp === undefined) return String(timestamp);
    
    const originalValue = String(timestamp);
    let date: Date;

    if (typeof timestamp === 'number' || typeof timestamp === 'bigint') {
        const num = Number(timestamp);
        // Heuristic: if it's a very large number, it's likely nanos.
        const isNano = originalValue.length > 15;
        date = isNano ? new Date(num / 1000000) : new Date(num);
    } else if (typeof timestamp === 'string') {
        const asNumber = Number(timestamp);
        // Check if the string is purely numeric
        if (!isNaN(asNumber) && timestamp.match(/^\d+$/)) {
            const isNano = timestamp.length > 15;
            date = isNano ? new Date(asNumber / 1000000) : new Date(asNumber);
        } else {
            // Otherwise, parse as a date string (e.g., ISO format)
            date = new Date(timestamp);
        }
    } else {
        return originalValue;
    }
    
    if (isNaN(date.getTime())) return originalValue;

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
