# M-A0: Scaffold frontend-v2/ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap `frontend-v2/` as a Vite 6 + React 19 + TypeScript 5.8 project with COOP/COEP headers, Vitest 4, Playwright 1.61, Tailwind v4 (CSS-first), and JFR test fixtures — `npm install && npm run test && npm run typecheck && npm run build` all succeed with zero implementation code.

**Architecture:** Vite 6 bundler with `@tailwindcss/vite` plugin (CSS-first, no tailwind.config.js); COOP/COEP response headers on both dev server and preview server (required for SharedArrayBuffer / DuckDB-WASM); Vitest with jsdom for unit tests; Playwright with dark + light theme projects for E2E.

**Tech Stack:** React 19.2.0, Vite 6.2.0, TypeScript 5.8.2, Tailwind 4.3.1 (CSS-first), Vitest 4.1.9, Playwright 1.61.0, fast-check 3.22.0

---

## Task 1: Create directory skeleton

- [x] Run the following commands from the repo root `/Users/i560383_1/code/experiments/jfr-query/`:

```bash
mkdir -p frontend-v2/src/styles
mkdir -p frontend-v2/src/components
mkdir -p frontend-v2/src/services
mkdir -p frontend-v2/src/context
mkdir -p frontend-v2/src/hooks
mkdir -p frontend-v2/src/utils
mkdir -p frontend-v2/src/copy
mkdir -p frontend-v2/tests/fixtures/jfr
mkdir -p frontend-v2/tests/fixtures/notebooks
mkdir -p frontend-v2/tests/e2e
mkdir -p frontend-v2/tests/visual
```

- [x] Verify with:

```bash
find frontend-v2 -type d | sort
```

Expected output:
```
frontend-v2
frontend-v2/src
frontend-v2/src/components
frontend-v2/src/context
frontend-v2/src/copy
frontend-v2/src/hooks
frontend-v2/src/services
frontend-v2/src/styles
frontend-v2/src/utils
frontend-v2/tests
frontend-v2/tests/e2e
frontend-v2/tests/fixtures
frontend-v2/tests/fixtures/jfr
frontend-v2/tests/fixtures/notebooks
frontend-v2/tests/visual
```

---

## Task 2: Write package.json

- [x] Create `frontend-v2/package.json` with this exact content:

```json
{
  "name": "jfr-notebook-v2",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview --port 4173",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:e2e": "playwright test",
    "test:visual": "playwright test --project=dark --project=light --grep @visual",
    "test:a11y": "playwright test --grep @a11y",
    "test:perf": "vitest bench",
    "lint": "eslint src tests",
    "format": "prettier --write src tests",
    "typecheck": "tsc -b --noEmit"
  },
  "dependencies": {
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "@google/genai": "1.22.0"
  },
  "devDependencies": {
    "vite": "6.2.0",
    "@vitejs/plugin-react": "5.0.0",
    "@tailwindcss/vite": "4.3.1",
    "tailwindcss": "4.3.1",
    "typescript": "5.8.2",
    "vitest": "4.1.9",
    "@vitest/ui": "4.1.9",
    "fast-check": "3.22.0",
    "playwright": "1.61.0",
    "@playwright/test": "1.61.0",
    "axe-core": "4.10.0",
    "@axe-core/playwright": "4.10.0",
    "@types/react": "19.1.0",
    "@types/react-dom": "19.1.0",
    "@types/node": "22.14.0",
    "eslint": "9.0.0",
    "@eslint/js": "9.0.0",
    "typescript-eslint": "8.0.0",
    "prettier": "3.0.0"
  }
}
```

- [x] Verify:

```bash
cat frontend-v2/package.json | grep '"name"'
```

Expected output:
```
  "name": "jfr-notebook-v2",
```

---

## Task 3: Write tsconfig.json, tsconfig.app.json, and tsconfig.node.json

**DECISION (Opus-resolved):** Standard Vite project-reference pattern — tsconfig.json as root references hub, tsconfig.app.json for src/, tsconfig.node.json for config files with composite + skipLibCheck.

Rationale: The original two-file layout failed `tsc -b --noEmit` because (a) `tsconfig.node.json` lacked `"composite": true` (required for project references) and (b) `playwright.config.ts` pulled in `playwright-core`/`vite` type files that reference `HTMLElementTagNameMap`, `Node`, `Worker`, etc., which were not in scope under `"lib": ["ES2022"]`. The fix uses the standard `npm create vite@latest` scaffold pattern: a thin root `tsconfig.json` that only holds project references, a dedicated `tsconfig.app.json` for app sources (`src/`, `tests/`), and a `tsconfig.node.json` for config files with `composite: true`, DOM in `lib`, and `skipLibCheck: true` to silence playwright-core's DOM lib-check noise without weakening strictness on our own code.

- [x] Create `frontend-v2/tsconfig.json` with this exact content:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

- [x] Create `frontend-v2/tsconfig.app.json` with this exact content:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/services/*": ["src/services/*"],
      "@/components/*": ["src/components/*"],
      "@/context/*": ["src/context/*"],
      "@/hooks/*": ["src/hooks/*"],
      "@/utils/*": ["src/utils/*"],
      "@/copy/*": ["src/copy/*"]
    }
  },
  "include": ["src", "tests"]
}
```

- [x] Create `frontend-v2/tsconfig.node.json` with this exact content:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "composite": true,
    "skipLibCheck": true
  },
  "include": ["vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

- [x] Verify (run AFTER Task 10 npm install):

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && cat tsconfig.json | python3 -m json.tool > /dev/null && echo "tsconfig.json: valid JSON"
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && cat tsconfig.app.json | python3 -m json.tool > /dev/null && echo "tsconfig.app.json: valid JSON"
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && cat tsconfig.node.json | python3 -m json.tool > /dev/null && echo "tsconfig.node.json: valid JSON"
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npx tsc -b --noEmit && echo "tsc -b: PASS"
```

Expected output:
```
tsconfig.json: valid JSON
tsconfig.app.json: valid JSON
tsconfig.node.json: valid JSON
tsc -b: PASS
```

---

## Task 4: Write vite.config.ts

- [x] Create `frontend-v2/vite.config.ts` with this exact content:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

const COOP_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@/services': resolve(__dirname, 'src/services'),
      '@/components': resolve(__dirname, 'src/components'),
      '@/context': resolve(__dirname, 'src/context'),
      '@/hooks': resolve(__dirname, 'src/hooks'),
      '@/utils': resolve(__dirname, 'src/utils'),
      '@/copy': resolve(__dirname, 'src/copy'),
    },
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  worker: {
    format: 'es',
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    headers: COOP_HEADERS,
  },
  preview: {
    port: 4173,
    headers: COOP_HEADERS,
  },
});
```

- [x] Verify file exists and contains COOP header config:

```bash
grep -c "Cross-Origin-Opener-Policy" /Users/i560383_1/code/experiments/jfr-query/frontend-v2/vite.config.ts
```

Expected output:
```
1
```

(Full parse check happens in Task 11 build step.)

---

## Task 5: Write vitest.config.ts and vitest.setup.ts

- [x] Create `frontend-v2/vitest.config.ts` with this exact content:

```typescript
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.{ts,tsx}',
    ],
    benchmark: {
      include: ['src/**/*.bench.ts'],
    },
  },
  resolve: {
    alias: {
      '@/services': resolve(__dirname, 'src/services'),
      '@/components': resolve(__dirname, 'src/components'),
      '@/context': resolve(__dirname, 'src/context'),
      '@/hooks': resolve(__dirname, 'src/hooks'),
      '@/utils': resolve(__dirname, 'src/utils'),
      '@/copy': resolve(__dirname, 'src/copy'),
    },
  },
});
```

- [x] Create `frontend-v2/vitest.setup.ts` with this exact content:

```typescript
// Global test setup. Add mocks and polyfills here as needed by later milestones.
```

- [x] Verify (deferred until Task 10 installs deps; the run is part of Task 11 gate):

```bash
test -f /Users/i560383_1/code/experiments/jfr-query/frontend-v2/vitest.config.ts && echo "vitest.config.ts: exists"
test -f /Users/i560383_1/code/experiments/jfr-query/frontend-v2/vitest.setup.ts && echo "vitest.setup.ts: exists"
```

Expected output:
```
vitest.config.ts: exists
vitest.setup.ts: exists
```

---

## Task 6: Write playwright.config.ts

- [x] Create `frontend-v2/playwright.config.ts` with this exact content:

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.001 },
  },
  projects: [
    {
      name: 'dark',
      use: {
        ...devices['Desktop Chrome'],
        colorScheme: 'dark',
      },
    },
    {
      name: 'light',
      use: {
        ...devices['Desktop Chrome'],
        colorScheme: 'light',
      },
    },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
```

- [x] Verify file exists:

```bash
test -f /Users/i560383_1/code/experiments/jfr-query/frontend-v2/playwright.config.ts && echo "playwright.config.ts: exists"
grep -c "name: 'dark'" /Users/i560383_1/code/experiments/jfr-query/frontend-v2/playwright.config.ts
grep -c "name: 'light'" /Users/i560383_1/code/experiments/jfr-query/frontend-v2/playwright.config.ts
```

Expected output:
```
playwright.config.ts: exists
1
1
```

---

## Task 7: Write src/styles/tokens.css, src/main.tsx, src/App.tsx

- [x] Create `frontend-v2/src/styles/tokens.css` with this exact content:

```css
@import "tailwindcss";

@theme {
  --color-bg-base: #0d1117;
  --color-bg-surface: #161b22;
  --color-bg-overlay: #21262d;
  --color-fg-base: #e6edf3;
  --color-fg-muted: #8b949e;
  --color-accent: #58a6ff;
  --color-accent-amber: #d29922;
  --color-accent-purple: #a371f7;
  --color-border: #30363d;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --radius-base: 6px;
}

:root[data-theme="light"] {
  --color-bg-base: #ffffff;
  --color-bg-surface: #f6f8fa;
  --color-bg-overlay: #eaeef2;
  --color-fg-base: #1f2328;
  --color-fg-muted: #57606a;
  --color-accent: #0969da;
  --color-accent-amber: #9a6700;
  --color-accent-purple: #8250df;
  --color-border: #d0d7de;
}
```

- [x] Create `frontend-v2/src/main.tsx` with this exact content:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/tokens.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [x] Create `frontend-v2/src/App.tsx` with this exact content:

```tsx
export default function App() {
  return <div data-testid="app-root">v2</div>;
}
```

- [x] Verify:

```bash
test -f /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/styles/tokens.css && echo "tokens.css: exists"
test -f /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/main.tsx && echo "main.tsx: exists"
test -f /Users/i560383_1/code/experiments/jfr-query/frontend-v2/src/App.tsx && echo "App.tsx: exists"
```

Expected output:
```
tokens.css: exists
main.tsx: exists
App.tsx: exists
```

---

## Task 8: Write index.html

- [x] Create `frontend-v2/index.html` with this exact content:

```html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>JFR Notebook v2</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [x] Verify:

```bash
grep -c "JFR Notebook v2" /Users/i560383_1/code/experiments/jfr-query/frontend-v2/index.html
grep -c 'data-theme="dark"' /Users/i560383_1/code/experiments/jfr-query/frontend-v2/index.html
```

Expected output:
```
1
1
```

---

## Task 9: Write .eslintrc.cjs, .prettierrc, .gitignore

- [x] Create `frontend-v2/.eslintrc.cjs` with this exact content:

```js
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  ignorePatterns: ['dist', 'node_modules'],
  parser: '@typescript-eslint/parser',
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
```

- [x] Create `frontend-v2/.prettierrc` with this exact content:

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

- [x] Create `frontend-v2/.gitignore` with this exact content:

```
node_modules/
dist/
.playwright/
playwright-report/
test-results/
*.local
.env*
!.env.example
```

- [x] Verify:

```bash
test -f /Users/i560383_1/code/experiments/jfr-query/frontend-v2/.eslintrc.cjs && echo ".eslintrc.cjs: exists"
test -f /Users/i560383_1/code/experiments/jfr-query/frontend-v2/.prettierrc && echo ".prettierrc: exists"
test -f /Users/i560383_1/code/experiments/jfr-query/frontend-v2/.gitignore && echo ".gitignore: exists"
```

Expected output:
```
.eslintrc.cjs: exists
.prettierrc: exists
.gitignore: exists
```

---

## Task 10: Install deps and commit JFR fixtures

- [x] Install dependencies:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm install
```

Expected: exits 0, `node_modules/` directory created. Final line resembles:
```
added NNN packages in Xs
```

- [x] Confirm install succeeded:

```bash
test -d /Users/i560383_1/code/experiments/jfr-query/frontend-v2/node_modules && echo "node_modules: exists"
test -f /Users/i560383_1/code/experiments/jfr-query/frontend-v2/node_modules/.package-lock.json && echo "package-lock: exists"
```

Expected output:
```
node_modules: exists
package-lock: exists
```

- [x] Copy the large JFR fixture:

```bash
cp /Users/i560383_1/code/experiments/jfr-query/core/jfr_files/default.jfr \
   /Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/jfr/sample-large.jfr
```

- [x] Create the small truncated JFR fixture:

```bash
dd if=/Users/i560383_1/code/experiments/jfr-query/core/jfr_files/default.jfr \
   of=/Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/jfr/sample-small.jfr \
   bs=1 count=200000
```

Expected output (final line):
```
200000 bytes transferred in X.XXXXXX secs (XXXXXXX bytes/sec)
```

(Note: BSD `dd` on macOS prints `200000 bytes transferred`; GNU `dd` prints `200000 bytes (200 kB, 195 KiB) copied`. Both are acceptable.)

- [x] Verify fixture sizes:

```bash
ls -lh /Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/jfr/
```

Expected:
- `sample-large.jfr` shows size approximately `6.0M` (or similar, matching `core/jfr_files/default.jfr`).
- `sample-small.jfr` shows size approximately `196K` or `195K`.

- [x] Create `frontend-v2/tests/fixtures/jfr/README.md` with this exact content:

```markdown
# JFR Test Fixtures

## sample-large.jfr
- Source: `core/jfr_files/default.jfr`
- Size: ~6MB
- Suitable for: integration tests (M-A6+), full loader tests
- Regenerate: copy `core/jfr_files/default.jfr`

## sample-small.jfr
- Source: first 200KB of `core/jfr_files/default.jfr` via `dd`
- Size: ~195KB
- **WARNING**: This is a truncated JFR binary. It may fail strict JFR parsing.
  Use only to verify file ingestion surface area, not for query tests.
  Use `sample-large.jfr` for integration tests.
- Regenerate: `dd if=core/jfr_files/default.jfr of=sample-small.jfr bs=1 count=200000`
```

- [x] Verify README:

```bash
grep -c "sample-large.jfr" /Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/jfr/README.md
grep -c "sample-small.jfr" /Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/jfr/README.md
```

Expected output:
```
2
2
```

---

## Task 11: Full gate verification

- [x] Run typecheck:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run typecheck
```

Expected: exits 0. No `error TS` lines in output.

- [x] Run unit tests:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run test
```

Expected: exits 0. Last lines contain either `Test Files  0 passed` or `No test files found`.

- [x] Run build:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run build
```

Expected: exits 0. Output contains a line resembling:
```
✓ built in Xs
```

And `frontend-v2/dist/index.html` exists. Verify:

```bash
test -f /Users/i560383_1/code/experiments/jfr-query/frontend-v2/dist/index.html && echo "dist/index.html: exists"
```

Expected output:
```
dist/index.html: exists
```

- [x] Start preview server in background and check COOP/COEP headers:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && npm run preview &
sleep 2
curl -sI http://localhost:4173 | grep -iE "cross-origin|opener|embedder"
kill %1
```

Expected output MUST contain all three lines (case-insensitive match):
```
cross-origin-opener-policy: same-origin
cross-origin-embedder-policy: require-corp
cross-origin-resource-policy: cross-origin
```

- [x] Verify fixtures are present and non-empty:

```bash
test -s /Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/jfr/sample-small.jfr && echo "small: OK"
test -s /Users/i560383_1/code/experiments/jfr-query/frontend-v2/tests/fixtures/jfr/sample-large.jfr && echo "large: OK"
```

Expected output:
```
small: OK
large: OK
```

- [x] Commit the scaffold:

```bash
cd /Users/i560383_1/code/experiments/jfr-query
git add frontend-v2/
git commit -m "feat(v2): M-A0 scaffold — Vite 6 + React 19 + COOP/COEP + Vitest + Playwright + fixtures"
```

Expected: commit created, exits 0. Output resembles:
```
[<branch> <sha>] feat(v2): M-A0 scaffold — Vite 6 + React 19 + COOP/COEP + Vitest + Playwright + fixtures
 NN files changed, NNNN insertions(+)
 create mode 100644 frontend-v2/package.json
 ...
```

- [x] Final gate confirmation — all six checks pass:

```bash
cd /Users/i560383_1/code/experiments/jfr-query/frontend-v2 && \
  npm run typecheck && \
  npm run test && \
  npm run build && \
  test -f dist/index.html && \
  test -s tests/fixtures/jfr/sample-large.jfr && \
  test -s tests/fixtures/jfr/sample-small.jfr && \
  echo "M-A0 GATE: PASS"
```

Expected output (final line):
```
M-A0 GATE: PASS
```
