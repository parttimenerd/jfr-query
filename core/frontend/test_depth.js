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

// Test: mismatched brackets
const test1 = splitTopLevel('a, )]', ',');
console.log("Mismatched ):", test1);
// depth goes: 0 -> -1 after ), so next , should still split (depth === 0)
// Actually, let's check the depth at each step

function splitTopLevelDebug(s, sep) {
    const out = [];
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        const oldDepth = depth;
        if (c === '[' || c === '(' || c === '{') depth++;
        if (c === ']' || c === ')' || c === '}') depth--;
        console.log(`i=${i}, c='${c}', depth: ${oldDepth} -> ${depth}`);
        if (c === sep && depth === 0) {
            console.log(`  -> Split here`);
            out.push(s.substring(0, i));
            return out;
        }
    }
    out.push(s);
    return out;
}

console.log("\nDebug mismatched:");
splitTopLevelDebug('a, )]', ',');
