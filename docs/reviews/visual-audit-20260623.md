# Visual Audit — JFR SQL Notebook v2

**Date:** 2026-06-23  
**Agent:** visual-review  
**Branch:** main  
**Screenshots taken:** `/tmp/welcome-app.png`, `/tmp/welcome-v1.png`, `/tmp/welcome-showcase.png`, `/tmp/loading-overlay.png`, `/tmp/after-load.png`, `/tmp/example-notebook.png`, `/tmp/v2-loaded-1600.png`

---

## Code Quality

| Check | Result |
|-------|--------|
| ESLint (`--max-warnings 0`) | FIXED — removed unused `fireEvent` import in `renderer.test.tsx` |
| TypeScript (`--noEmit`) | PASS |
| Prettier | FIXED — auto-formatted 5 files in `src/components/plots/` and test |

Commit: `style: auto-fix after visual-review`

---

## Step 2: Welcome Screen

### What matches v1 / showcase
- Dark theme correctly applied (`--color-bg-base` #0d1117) ✓
- Cyan accent color (`--color-accent` #22d3ee) on book icon ✓
- Title "JFR SQL Notebook" at 24px bold, correct color ✓
- Subtitle text at correct muted color ✓
- Dashed drop zone border with hover state ✓
- 2×2 feature card grid with correct content ✓
- "or open example notebook" link present ✓
- Topbar present at correct height (h-9) ✓
- Sidebar present with collapse toggle ✓
- Status bar present (h-6, `▣ idle`) ✓

### Deviations from v1 / showcase

**🟡 W1 — Drop zone text differs from v1**  
v2: `Drop a .jfr.db or .jfr file here`  
v1: `Drop a .jfr or .duckdb file here`  
Style guide §8 specifies "Drop a .jfr or .duckdb file here" matching v1. v2 uses `.jfr.db` instead of `.duckdb`.

**🟡 W2 — Feature cards: icon layout differs from v1**  
v2 places emoji icon above card title (stacked), v1 places icon inline left of text. The v2 layout takes more vertical space and looks less compact.

**🔵 N1 — Welcome drop zone padding is generous (py-10)**  
v1's drop zone is more compact. Not broken but slightly different proportions.

**🔵 N2 — Topbar missing "Run All" button**  
Style guide §8 mentions: "Run all button: In topbar, play icon, 'Run All' label — distinct from per-cell run." This is absent but may be intentional until notebook is loaded.

---

## Step 3: Notebook View (file loaded: default.db, 104 tables)

### Layout measurements at 1600px viewport
| Region | Width | Expected |
|--------|-------|----------|
| Sidebar | 195px | 240px (w-60) |
| Main content area | 887px | flex-1 |
| Right rail (Issues/Chat) | 280px | 280px ✓ |
| Activity feed panel | 208px | 256px (w-64) |

### What works
- File loads correctly (104 tables recognized) ✓
- A starter SQL cell is created (`SELECT * FROM ActiveRecording LIMIT 100`) ✓
- Cell heading shows `#1 cell_1` with `▣ idle` status and Run button ✓
- Right rail shows ISSUES / CHAT tabs with correct cyan underline on active tab ✓
- Activity feed shows load event ("Loaded default.db (104 tables)") ✓
- SQL syntax highlighting (CodeMirror) renders correctly ✓
- Status bar shows `▣ idle` ✓

### Deviations

**🔴 C1 — Cell card background is `bg-[--color-bg-base]` instead of `bg-[--color-bg-surface]`**  
File: `src/components/cell/CellView.tsx` line 80  
Current: `bg-[--color-bg-base]` (#0d1117 — same as page background)  
Expected: `bg-[--color-bg-surface]` (#151a23 — raised card surface)  
Style guide §4 "Cell cards": `bg-[--color-bg-surface]`  
**Impact:** Cell cards are invisible against the page background — the card boundary is only visible via the border. The "raised card" visual depth is completely lost.

**🔴 C2 — Sidebar does not update when file is loaded**  
After loading `default.db` (104 tables), the sidebar still shows:
```
NOTEBOOKS
Open a .jfr.db file to get started.
```
v1 shows a full Schema Explorer with TABLES list, row counts, search input, and VIEWS/MACROS sections.  
File: `src/components/shell/Sidebar.tsx` — the component is a stub with no connection to the database context.  
**Impact:** Primary navigation surface is missing — users cannot browse schema or insert table references.

**🟡 W3 — `text-sm` (14px) used for cell alias name — should be `text-[13px]`**  
Files:
- `src/components/cell/CellView.tsx` line 84
- `src/components/cell/CellHeading.tsx` line 25  
Style guide §2: "Do NOT use Tailwind's `text-sm` (14px) for UI elements". Cell alias should be `text-[13px]`.

**🟡 W4 — `text-sm` used in Topbar h1 — should be `text-[13px]`**  
File: `src/components/shell/Topbar.tsx` line 14  
The topbar title "JFR SQL Notebook" uses `text-sm` (14px). Style guide mandates `text-[13px]` for UI body text.

**🟡 W5 — `text-sm` used in multiple other components**  
Full list of `text-sm` violations:
- `src/components/welcome/SpotlightCarousel.tsx` lines 45, 53
- `src/components/cell/ProseBlock.tsx` line 13
- `src/components/cell/PlotBlockEditor.tsx` line 50
- `src/components/results/ResultsTable.tsx` lines 84, 106
- `src/components/notebook/NotebookView.tsx` line 40
- `src/components/palette/CommandPalette.tsx` line 156
- `src/components/palette/ResultRow.tsx` line 25

**🟡 W6 — Sidebar width is 195px, expected 240px (w-60)**  
The sidebar renders at 195px (computed) not 240px as spec'd. This is because the toggle button (approx 30px) sits alongside it and steals space from the flex layout. The sidebar has `w-60` class but the flex parent may not fully allocate it.

**🟡 W7 — No loading overlay screenshot captured**  
The `default.db` file loads so fast that the loading overlay is never visible. For `.jfr` files (which require parsing) the overlay should appear. This is a test coverage gap, not a code bug, but the overlay itself looks correct per code review.

**🔵 N3 — Right rail collapse button shows `»` (pointing right) but semantics say "collapse" (should point left)**  
Current: `»` to collapse, `«` to expand. Conventional UI shows `‹` to collapse-left and `›` to expand. The current arrow directions are the opposite of common convention.

**🔵 N4 — Activity feed panel uses `var(--color-border)` syntax instead of `[--color-border]` in one component**  
`src/components/activity/ActivityFeedPanel.tsx` uses `border-[var(--color-border)]` (lines 29, 37) while all other components use `border-[--color-border]`. Functionally identical but inconsistent style.

**🔵 N5 — Cell results area always shows "(no results yet — run to execute)" placeholder in monospace**  
The results placeholder text uses `text-xs text-[--color-fg-muted]` which is correct, but the outer container uses `bg-[--color-bg-overlay]` making it slightly visible as a distinct band even when not needed. Consider only showing it when the cell has been run (not for brand-new cells).

---

## Step 4: Example Notebook

### What works
- 4 cells load correctly ✓
- SQL cells with syntax highlighting ✓  
- Cell with `$eventType` variable chip renders ✓
- Prose block (cell #4 "notes") renders correctly ✓
- Correct dark theme ✓

### Deviations
All deviations from Step 3 apply here too (cell bg, text-sm violations).

**🟡 W8 — Example notebook sidebar still shows welcome placeholder**  
After loading the example notebook, the sidebar still says "Open a .jfr.db file to get started." — it should either show a notebook outline (cells list) or remain generic. This is the same as C2 root cause.

---

## Step 5: Ranked Improvement List

### 🔴 Must Fix Now (breaks the design)

**C1 — Cell card background** (`src/components/cell/CellView.tsx` line 80)  
Change `bg-[--color-bg-base]` → `bg-[--color-bg-surface]`  
Without this, cells are invisible against the page and the card depth metaphor is broken.

**C2 — Sidebar schema stub** (`src/components/shell/Sidebar.tsx`)  
After file load, sidebar must show at minimum the table count and a placeholder for the schema explorer. A minimal fix: connect to the DB context and list table names. Full fix: implement schema explorer (separate milestone).

### 🟡 Should Fix Soon (degrades quality)

**W3+W4+W5 — `text-sm` violations**  
Replace all `text-sm` → `text-[13px]` in cell/notebook/topbar UI components. (Table data in `ResultsTable` can stay `text-sm` as that is content, not shell UI — debatable.)

**W6 — Sidebar width discrepancy**  
Investigate why computed width is 195px vs spec 240px. The toggle button sits alongside sidebar in a `flex items-start` container — consider putting the toggle inside the sidebar or using `w-60 shrink-0` on the sidebar.

**W7 — Activity feed panel inconsistent token syntax**  
Change `border-[var(--color-border)]` → `border-[--color-border]` in `ActivityFeedPanel.tsx`.

### 🔵 Nice to Have (polish)

**N1 — Drop zone text** — align with v1: "Drop a .jfr or .duckdb file here"  
**N3 — Right rail arrow directions** — swap `»`/`«` to `‹`/`›`  
**N4 — var() token syntax** — normalize to `[--color-token]` pattern  
**N5 — Results placeholder** — hide for cells that have never been run  

---

## Summary

| Severity | Count | Fixed in this pass |
|----------|-------|-------------------|
| 🔴 Critical | 2 | C1 (cell bg) — fixed in commit below |
| 🟡 Warning | 6 | W3/W4 (text-sm in cells/topbar) — fixed |
| 🔵 Note | 5 | 0 |

**C1 and W3/W4 were fixed in `fix(v2): visual-review critical fixes`.**  
**C2 (sidebar schema stub) is a larger feature work tracked separately.**
