function splitTopLevel(s, sep) {
    const out = [];
    let depth = 0;
    let inStr = null;
    let escaped = false;
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (escaped) {
            cur += c;
            escaped = false;
            continue;
        }
        if (c === '\\' && inStr) {
            cur += c;
            escaped = true;
            continue;
        }
        if (inStr) {
            cur += c;
            if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'") {
            inStr = c;
            cur += c;
            continue;
        }
        if (c === '[' || c === '(' || c === '{') depth++;
        if (c === ']' || c === ')' || c === '}') depth--;
        if (c === sep && depth === 0) {
            out.push(cur);
            cur = '';
            continue;
        }
        cur += c;
    }
    if (cur.length > 0 || out.length > 0) out.push(cur);
    return out;
}

// Test: escaped quote at end
console.log("Test 1:", splitTopLevel('a, "b\\"", c', ','));
// Expected: ['a', ' "b\\""', ' c']

// Test: unclosed quote
console.log("Test 2:", splitTopLevel('a, "b', ','));
// Expected: ['a', ' "b']

// Test: normal
console.log("Test 3:", splitTopLevel('a, b, c', ','));
// Expected: ['a', ' b', ' c']
