function findRemainingVariables(sql) {
    const matches = sql.match(/\$\$?\w+(?:\.\w+)*/g);
    if (!matches) return [];
    return [...new Set(matches)];
}

// Test cases
console.log("Test 1:", findRemainingVariables('SELECT $a, $b'));
console.log("Test 2:", findRemainingVariables('SELECT $$a'));
console.log("Test 3:", findRemainingVariables('SELECT $sel.brush, $sel.brush.lo'));
console.log("Test 4:", findRemainingVariables('SELECT $a$b'));
// Expected for Test 4: ['$a'] — the $ after $a should not start a new variable
