# Agent Pipeline State

## Last reviewed commit
b7336a3

## Last implemented milestone
M-B6 (command palette ⌘P, glyph legend ?, welcome carousel + SettingsContext)

## Last reviewed commit (implementation)
f09db69

## Next milestone to plan
M-B7 (three-grain undo + activity feed — plan needed)

## Plans written
- M-A0 through M-A7
- M-B1, M-B2, M-B3
- M-B4 (dep graph overlay, cytoscape.js, ⌘G modal)
- M-B5 (issues panel, diagnostic registry, quickfix menu ⌥↵)
- M-B6 (welcome cell, glyph legend, command palette ⌘P with 14 result kinds)

## Commits pending review
(none — reviewer last reviewed through b7336a3; f09db69 pending review)

## Open critical issues
(none)

## Open warnings (carry forward — fix in M-B3 or follow-up)
- CellHeading.tsx status chip lacks `role="status"` / `aria-live="polite"`
  (already addressed in working-tree M-B3 CellView rewrite — verify on next commit).
- SqlBlockEditor `VAR_RE = /\$[a-z]…/gi` matches the `$global` substring of `$$global`.
  Should add negative lookbehind/ahead before user-facing $$ tokens land.
- SqlBlockEditor exposes `_cmView` on the host DOM node for test scaffolding —
  gate behind `import.meta.env.DEV` or remove.
- CellHeading.tsx will become dead code once M-B3 lands inline header in CellView —
  delete on next pass or re-integrate.

