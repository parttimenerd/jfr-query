# Agent Pipeline State

## Last reviewed commit
6ab8dfd

## Last implemented milestone
M-C1 (plot renderer base + 5-state machine) at commit TBD_AFTER_COMMIT

## Last reviewed commit (implementation)
cff689e

## Next milestone to plan
M-C2 (line + bar + scatter renderers, adapted from v1, Recharts-based)

## Plans written
- M-A0 through M-A7
- M-B1, M-B2, M-B3
- M-B4 (dep graph overlay, cytoscape.js, ⌘G modal)
- M-B5 (issues panel, diagnostic registry, quickfix menu ⌥↵)
- M-B6 (welcome cell, glyph legend, command palette ⌘P with 14 result kinds)
- M-B7 (three-grain undo + activity feed)
- M-B9 (file ingest UI — FileDropZone, LoadingOverlay, useFileIngest hook, topbar Open button, WASM copy)
- M-B10 (right-rail layout — RightRail with ISSUES/CHAT tabs, ⌥H toggle, WAI-ARIA Tabs pattern, ChatStub)
- M-C1 (plot renderer base — PlotStateMachine 5-state reducer, PlotRenderer wrapper, PlotLegend, PlotTooltip, PlotAnnotations, PlotControls, PlotShareModal, PlotContext)

## Commits pending review
(none — reviewer last reviewed through 6ab8dfd)

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

