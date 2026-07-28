function stripTrailingLineComment(s) {
    let inStr = null;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inStr) { if (c === inStr) inStr = null; continue; }
        if (c === '"' || c === "'") { inStr = c; continue; }
        console.log(`i=${i}, c='${c}', next='${s[i+1] ?? 'EOF'}', prev='${s[i-1] ?? 'START'}'`);
        if (c === '#' && i > 0 && /\s/.test(s[i - 1]) && !/\d/.test(s[i + 1] ?? '')) {
            console.log(`  -> Found comment at i=${i}`);
            return s.slice(0, i);
        }
    }
    return s;
}

// Test: # followed by EOF
const test1 = 'LINE_CHART() #';
console.log("Result:", stripTrailingLineComment(test1));

console.log("\n");

// Test: # followed by digit
const test2 = 'LINE_CHART() #1';
console.log("Result:", stripTrailingLineComment(test2));
