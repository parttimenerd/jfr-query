// Test the escaping logic
const names = ['$v2', '$v'];
const variables = { '$v2': '99', '$v': '1' };

const patterns = names
    .filter(name => variables[name] != null)
    .map(name => {
    const refName = name.startsWith('$') ? name : `$${name}`;
    const escapedName = refName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const leftBoundary = refName.startsWith('$$') ? '' : '(?<!\\$)';
    console.log(`name=${name}, refName=${refName}, escapedName=${escapedName}, leftBoundary='${leftBoundary}'`);
    console.log(`  regex: /${leftBoundary}${escapedName}(?!\\w)/g`);
    return {
        re: new RegExp(`${leftBoundary}${escapedName}(?!\\w)`, 'g'),
        value: variables[name],
    };
});

const sql = 'SELECT $v + $v2';
let out = sql;
for (const { re, value } of patterns) {
    re.lastIndex = 0;
    const next = out.replace(re, () => value);
    console.log(`Replaced with ${value}: "${out}" -> "${next}"`);
    out = next;
}
console.log("Final:", out);
