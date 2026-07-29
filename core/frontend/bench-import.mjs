/**
 * JFR import benchmark. Usage:
 *   node bench-import.mjs [container|metal]
 *
 * Forces deviceMemory=4 (→ 2 workers) to stay within headless renderer limits.
 * On a real browser with 8GB+ RAM, 3 workers activate automatically.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL || 'http://localhost:5175';
const FILE = process.argv[2] || 'container';
const JFR_SRC = `/Users/i560383_1/code/experiments/jfr-query/core/jfr_files/${FILE}.jfr`;
const JFR_SERVE = `public/jfr/${FILE}.jfr`;
const JFR_URL = `${APP_URL}/jfr/${FILE}.jfr`;

// Copy into public/jfr so Vite serves it
await fs.mkdir(path.join(__dirname, 'public/jfr'), { recursive: true });
await fs.copyFile(JFR_SRC, path.join(__dirname, JFR_SERVE));

await new Promise((resolve, reject) => {
  http.get(JFR_URL, r => { r.statusCode === 200 ? resolve() : reject(new Error(`${r.statusCode}`)); r.resume(); }).on('error', reject);
});

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

// Cap at 2 workers in headless — renderer process OOMs with 3+
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 4 });
});

page.on('console', msg => {
  const t = msg.text();
  if (t.includes('[jfr-perf]') || t.includes('[jfr-import]')) process.stdout.write('  ' + t + '\n');
});

const fileSize = (await fs.stat(JFR_SRC)).size;
console.log(`\nBenchmarking ${FILE}.jfr (${(fileSize/1024/1024).toFixed(1)} MB)...`);

await page.goto(`${APP_URL}/?jfr=/jfr/${FILE}.jfr`, { waitUntil: 'networkidle' });
const t0 = Date.now();

try {
  await page.waitForFunction(() => window.__lastJfrPerf?.sqlRegMs != null, { timeout: 10 * 60 * 1000 });
} catch { console.log('Timed out'); }

const totalMs = Date.now() - t0;
const perf = await page.evaluate(() => window.__lastJfrPerf);

console.log(`\n=== ${FILE}.jfr RESULTS ===`);
console.log(`  File size:         ${(fileSize/1024/1024).toFixed(1)} MB`);
if (perf) {
  console.log(`  Chunks / Workers:  ${perf.numChunks} / ${perf.numWorkers}`);
  console.log(`  Java parse:        ${perf.javaSyncMs?.toFixed(0)}ms`);
  console.log(`  Drain:             ${perf.drainMs?.toFixed(0)}ms`);
  console.log(`  Merge:             ${perf.mergeMs?.toFixed(0)}ms`);
  console.log(`  SQL reg:           ${perf.sqlRegMs?.toFixed(0)}ms (×${perf.sqlParallelism})`);
  console.log(`  Total wall:        ${totalMs}ms`);
  console.log(`  Throughput:        ${(fileSize / totalMs / 1024).toFixed(1)} MB/s`);
} else {
  console.log('  No perf data — import may have failed');
}

await browser.close();
await fs.rm(path.join(__dirname, 'public/jfr'), { recursive: true });
