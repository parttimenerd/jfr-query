// The sub-token regex for DOMAIN
const DOMAIN_PART = /DOMAIN\s+(\[[^\]]+\])/;

console.log("Test 1 (normal):", DOMAIN_PART.test('DOMAIN [0, 100]'));
console.log("Test 2 (empty):", DOMAIN_PART.test('DOMAIN []'));
// DOMAIN [] should fail because [^\]]+ requires at least one non-] character
