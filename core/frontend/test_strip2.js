function stripTrailingLineComment(s) {
    let inStr = null;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        console.log(`i=${i}, c='${c}', inStr=${inStr}`);
        if (inStr) { if (c === inStr) inStr = null; continue; }
        if (c === '"' || c === "'") { inStr = c; continue; }
        if (c === '#' && i > 0 && /\s/.test(s[i - 1]) && !/\d/.test(s[i + 1] ?? '')) {
            console.log(`  -> Found comment at i=${i}`);
            return s.slice(0, i);
        }
    }
    return s;
}

const test = 'LINE_CHART(title: "foo # bar") # real comment';
console.log("Input:", test);
console.log("Output:", stripTrailingLineComment(test));
