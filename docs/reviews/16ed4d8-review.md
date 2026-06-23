# Code Review — 16ed4d8 style(v2): align dark theme palette + typography with index.html mockup

## Lint & Format
**ESLint:** ✅ clean (0 errors after auto-fix in `c7b4969`)
**Prettier:** ✅ clean
**TypeScript:** ✅ clean

## Issues Found

### 🔴 Critical
- None.

### 🟡 Warning
- `src/components/shell/useTheme.ts` — `matchMedia` preference detection removed; always defaults to dark. This is an intentional design decision (showcasing dark theme) but breaks system preference honoring — users who prefer light mode will always get dark theme until they manually toggle. Should be re-added when the app targets production use.

### 🔵 Note
- `src/styles/tokens.css` — `color-accent-cyan` was removed from the dark theme tokens. `SqlBlockEditor.tsx` previously used `color-accent-cyan` for `VarChip`. Prettier reformatting of tokens.css confirms this was intentional — the `cm-var-chip` class now uses `color-accent-amber` instead. The old `--color-accent-cyan: #39d353` (green!) was probably wrongly named anyway.
- `src/styles/tokens.css` — adds `--color-fg-dim` for tertiary text and `--color-border-strong` for stronger borders. Good token additions.
- `src/styles/tokens.css` — custom `::-webkit-scrollbar` styles added. These only work in Webkit/Blink (Chrome, Safari, Edge). Firefox uses `scrollbar-width`/`scrollbar-color`. Consider adding Firefox-compatible scrollbar styles for completeness.
- `src/components/shell/StatusBar.tsx` — adds `role="status" aria-live="polite"` to the status span. This is the correct pattern per the review checklist.
- `src/components/shell/Topbar.tsx` — adds `data-testid="topbar"`. Good for E2E tests.
- `src/components/shell/WelcomeCell.tsx` — text sizes now use `text-[13px]`/`text-[15px]` arbitrary values instead of Tailwind's `text-sm`/`text-lg`. Not wrong but loses Tailwind's responsive semantics. Minor.

## Verdict
PASS WITH NOTES
