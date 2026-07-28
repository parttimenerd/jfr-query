function stripTrailingLineComment(s) {
    let inStr = null;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inStr) { if (c === inStr) inStr = null; continue; }
        if (c === '"' || c === "'") { inStr = c; continue; }
        if (c === '#' && i > 0 && /\s/.test(s[i - 1]) && !/\d/.test(s[i + 1] ?? '')) {
            return s.slice(0, i);
        }
    }
    return s;
}

// Test cases
console.log("Test 1 (normal comment):", stripTrailingLineComment('LINE_CHART() # comment'));
console.log("Test 2 (hash with digit):", stripTrailingLineComment('LINE_CHART() #1 comment'));
console.log("Test 3 (hash at end):", stripTrailingLineComment('LINE_CHART() #'));
console.log("Test 4 (hash no space before):", stripTrailingLineComment('LINE_CHART()# comment'));
console.log("Test 5 (quoted hash):", stripTrailingLineComment('LINE_CHART(title: "foo # bar") # real comment'));
