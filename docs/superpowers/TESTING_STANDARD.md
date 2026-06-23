# Testing Standard — JFR SQL Notebook v2

Every milestone plan MUST include steps from this standard. No milestone is done
until all applicable layers pass. Sonnet implementing a plan must NOT skip these.

---

## Layers (apply all that are relevant to the milestone)

### Layer 1 — Vitest unit tests (every milestone)

- One test file per source file, co-located under `src/__tests__/`
- Minimum: happy path + every error/edge case enumerated in the milestone spec
- Property tests (fast-check, 1000+ iterations) for any pure function that accepts
  arbitrary string/object input (parsers, formatters, serializers)
- Coverage target: every exported function exercised, every branch reachable
- Run: `npm run test -- <suite-name>` → all pass before committing

### Layer 2 — Playwright E2E (every milestone that touches observable browser behavior)

"Observable browser behavior" = anything a user can see, click, type, or trigger.
For Phase A (pure services), this is the **smoke test** in `tests/e2e/00-smoke.spec.ts`.
For Phase B+ (UI components), each milestone adds tests to the relevant spec file.

**Rule:** Every milestone commit must leave `npm run test:e2e` green (or all new
tests marked `test.fixme` with a milestone tag so CI doesn't fail).

**Spec file assignment:**

| Milestone range | Spec file |
|----------------|-----------|
| M-A* (services) | `00-smoke.spec.ts` — COOP/COEP headers, server boot, no JS errors |
| M-B1 shell | `01-shell-and-ingest.spec.ts` — implement all `test.fixme` in that file |
| M-B2 editor | `02-vars-and-sigils.spec.ts` |
| M-B3/C* plots | `03-plot-dsl.spec.ts` |
| M-B4 dep graph | `04-cross-cell.spec.ts` |
| M-E* live coupling | `05-live-coupling.spec.ts` |
| M-B5 issues panel | `06-issues.spec.ts` |
| M-D* AI agent | `07-agent.spec.ts` |
| M-A5 formatter | `08-formatter.spec.ts` |
| M-F* polish | `10-share-a11y.spec.ts` |

**Required test patterns per UI milestone:**

```typescript
// 1. Happy path — feature works end-to-end
test('feature X works', async ({ page }) => { ... });

// 2. Error state — feature degrades gracefully
test('feature X shows error state on failure', async ({ page }) => { ... });

// 3. Empty state — zero-data case renders something useful
test('feature X shows empty state with no data', async ({ page }) => { ... });

// 4. Keyboard — feature reachable without mouse
test('feature X keyboard shortcut works', async ({ page }) => { ... });

// 5. A11y — no critical axe violations @a11y
test('feature X has no critical a11y violations @a11y', async ({ page }) => { ... });
```

### Layer 3 — Visual regression (milestones that render charts or complex layouts)

All visual tests live in `tests/visual/` and are tagged `@visual`.

Run: `npm run test:visual`

Snapshots committed to repo. Diff threshold: `maxDiffPixelRatio: 0.001` (0.1%).

**Two projects:** `dark` and `light` — every visual test produces two snapshots.

**Required visual tests per chart type (Phase C):**
- idle state (no data loaded yet)
- loading state (skeleton)
- rendered state (data visible)
- error state (error overlay)
- empty state (no rows)

**Required visual tests for layout composers:**
- `row{}` with two panels
- `col{}` with two panels
- `+` overlay

**Required visual tests for dep graph:**
- 3-node graph with all 5 edge types

### Layer 4 — A11y (every milestone with user-facing UI)

Tagged `@a11y`. Run: `npm run test:a11y`

Requirements (WCAG 2.1 AA):
- No critical axe-core violations
- All interactive elements keyboard-focusable
- Focus trap on every modal/dialog
- `prefers-reduced-motion` honored
- Color never sole signal (glyph/icon alongside color for status)
- Every chart has an accessible title and `role="img"` with `aria-label`

### Layer 5 — Performance bench (milestones touching query execution or render)

Tagged `@perf`. Run: `npm run test:perf` (Vitest bench).

Baselines to track:
- Cold DuckDB init: < 3000ms
- Warm query (SELECT 42): < 50ms
- Notebook parse (100 cells): < 10ms
- Formatter (100 cells): < 20ms
- Dep graph compute (100 cells): < 5ms

---

## Gate command (run before every commit)

```bash
npm run test          # Vitest unit + integration
npm run typecheck     # tsc -b --noEmit
npm run test:e2e      # Playwright (smoke always; feature specs per milestone)
```

For UI milestones, additionally:
```bash
npm run test:visual   # visual regression
npm run test:a11y     # axe-core sweep
```

---

## How to add Playwright steps to a plan

Append a section **after the last implementation step and before the commit step**:

```markdown
### Step N — Playwright E2E tests

- [ ] **N.1** Run smoke suite to confirm COOP/COEP still correct:
  \`\`\`bash
  npx playwright test tests/e2e/00-smoke.spec.ts
  \`\`\`
  Expected: all 9 tests pass (dark + light = 18 total across 2 projects).

- [ ] **N.2** Implement `test.fixme` tests in `tests/e2e/NN-<spec>.spec.ts`
  that correspond to this milestone's new behavior. Remove `test.fixme` wrapper
  once the test passes.
  \`\`\`bash
  npx playwright test tests/e2e/NN-<spec>.spec.ts
  \`\`\`
  Expected: all new tests pass; no regressions in other spec files.

- [ ] **N.3** Run full E2E suite:
  \`\`\`bash
  npm run test:e2e
  \`\`\`
  Expected: all pass or only pre-existing `test.fixme` tests skipped.
```

---

## Playwright config reference

Config: `frontend-v2/playwright.config.ts`
- `testDir: './tests/e2e'`
- Two projects: `dark` (colorScheme: dark) and `light` (colorScheme: light)
- `webServer`: `npm run preview` on port 4173
- Screenshot threshold: `maxDiffPixelRatio: 0.001`
- Visual tests in `tests/visual/` (separate testDir, same config file via `projects`)

Run patterns:
```bash
npx playwright test                          # all e2e
npx playwright test --grep @visual           # visual only
npx playwright test --grep @a11y             # a11y only
npx playwright test tests/e2e/00-smoke.spec.ts  # smoke only
npx playwright test --project=dark           # dark theme only
```
