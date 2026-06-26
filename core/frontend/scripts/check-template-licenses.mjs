#!/usr/bin/env node
/**
 * Fails the build if any built-in template under
 * core/frontend/data/templates/builtin/*.md lacks `license: MIT` in its
 * YAML front-matter. Run as part of `npm test`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'data', 'templates', 'builtin');

let failures = 0;
let checked = 0;
for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    checked++;
    const body = readFileSync(join(dir, f), 'utf8');
    const m = body.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!m) {
        console.error(`FAIL ${f}: no YAML front-matter`);
        failures++;
        continue;
    }
    const fm = m[1];
    const licenseLine = fm.split('\n').find(l => /^\s*license\s*:/.test(l));
    if (!licenseLine) {
        console.error(`FAIL ${f}: front-matter is missing 'license' field`);
        failures++;
        continue;
    }
    const value = licenseLine.replace(/^\s*license\s*:\s*/, '').replace(/['"]/g, '').trim();
    if (value !== 'MIT') {
        console.error(`FAIL ${f}: license must be MIT, got "${value}"`);
        failures++;
    }
}

if (failures > 0) {
    console.error(`\n${failures} built-in template(s) failed license check.`);
    process.exit(1);
}
console.log(`OK: ${checked} built-in template(s) declare license: MIT.`);
