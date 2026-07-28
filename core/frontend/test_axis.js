const buildAxisRegex = (axis) =>
    new RegExp(`(?<!\\w)AXIS[-_]${axis}\\s+((?:(?:DOMAIN\\s+\\[[^\\]]+\\]|LABEL\\s+(?:"[^"]*"|'[^']*')|TYPE\\s+(?:LINEAR|LOG|TIME|BAND)|FORMAT\\s+(?:"[^"]*"|'[^']*'))\\s*)+)$`, 'i');

const regexX = buildAxisRegex('X');
const regexY = buildAxisRegex('Y');

// Test 1: AXIS_X with LABEL
const test1 = 'LINE_CHART(x: "ts") AXIS_X LABEL "Time"';
console.log("Test 1:", regexX.test(test1));
console.log("  Match:", test1.match(regexX));

// Test 2: AXIS_X with multiple sub-clauses
const test2 = 'LINE_CHART() AXIS_X LABEL "Time" TYPE LINEAR';
console.log("Test 2:", regexX.test(test2));
console.log("  Match:", test2.match(regexX));

// Test 3: Empty DOMAIN value (edge case)
const test3 = 'LINE_CHART() AXIS_X DOMAIN []';
console.log("Test 3:", regexX.test(test3));
console.log("  Match:", test3.match(regexX));
