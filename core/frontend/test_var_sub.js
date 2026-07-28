function substituteVariables(sql, variables) {
    if (Object.keys(variables).length === 0) return sql;

    const names = Object.keys(variables).sort((a, b) => b.length - a.length);

    const patterns = names
        .filter(name => variables[name] != null)
        .map(name => {
        const refName = name.startsWith('$') ? name : `$${name}`;
        const escapedName = refName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const leftBoundary = refName.startsWith('$$') ? '' : '(?<!\\$)';
        return {
            re: new RegExp(`${leftBoundary}${escapedName}(?!\\w)`, 'g'),
            value: variables[name],
        };
    });

    let out = sql;
    let prevTokenCount = -1;
    for (let pass = 0; pass < 10; pass++) {
        let changed = false;
        for (const { re, value } of patterns) {
            re.lastIndex = 0;
            const next = out.replace(re, () => value);
            if (next !== out) { out = next; changed = true; }
        }
        if (!changed) break;
        const tokenCount = (out.match(/\$\$?\w+/g) ?? []).length;
        if (tokenCount === prevTokenCount) break;
        prevTokenCount = tokenCount;
    }
    return out;
}

// Test: substituting with values containing regex special chars
console.log("Test 1:", substituteVariables('x = $a', { '$a': '$1' }));
// Expected: x = $1

// Test: negative number handling
console.log("Test 2:", substituteVariables('SELECT $x WHERE x < $threshold', { '$x': '-100', '$threshold': '50' }));
// Expected: SELECT -100 WHERE x < 50

// Test: escaping in value
console.log("Test 3:", substituteVariables('WHERE pattern ~ $p', { '$p': '.*foo.*' }));
// Expected: WHERE pattern ~ .*foo.*
