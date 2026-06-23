# JFR SQL Notebook v2 — Style Guide & Visual Fidelity Checkpoints

> Reference files:
> - **Mockup (full app):** `deprecated/jfr-sql-notebook/redesign-plan/index.html`
> - **Showcase (feature tour):** `deprecated/jfr-sql-notebook/redesign-plan/showcase.html`
> - **V1 (live reference):** `core/frontend/` — run on port 5174

---

## 1. Design Tokens

All tokens live in `frontend-v2/src/styles/tokens.css`. Never hardcode hex values in components.

### Dark theme (default)
| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg-base` | `#0d1117` | Page background |
| `--color-bg-surface` | `#151a23` | Topbar, sidebar, cards |
| `--color-bg-overlay` | `#1c2330` | Dropdowns, tooltips, code bg |
| `--color-fg-base` | `#d8def0` | Primary text |
| `--color-fg-muted` | `#6b7896` | Secondary text, labels |
| `--color-fg-dim` | `#4a5468` | Placeholder, disabled |
| `--color-accent` | `#22d3ee` | **Cyan** — links, data deps, active states |
| `--color-accent-amber` | `#fbbf24` | Cell aliases, static var chips |
| `--color-accent-purple` | `#a78bfa` | AI / prompt deps |
| `--color-accent-green` | `#10b981` | Live-var / success |
| `--color-accent-red` | `#ef4444` | Errors |
| `--color-accent-orange` | `#fb923c` | Axis-link edges |
| `--color-accent-yellow` | `#f59e0b` | Running / stale |
| `--color-border` | `#232a37` | Default borders |
| `--color-border-strong` | `#2e3645` | Focused / hover borders |

---

## 2. Typography

```
UI body:    13px  var(--font-sans)   color: --color-fg-base
Secondary:  12px  var(--font-sans)   color: --color-fg-muted
Labels:     11px  uppercase tracking-wider  color: --color-fg-muted
Mono/code:  12px  var(--font-mono)   (SQL, aliases, var names, status chips)
Status:     11px  var(--font-mono)   color: --color-fg-muted
```

**Do NOT use Tailwind's `text-sm` (14px) for UI elements — it reads too large.**
Use literal sizes: `text-[13px]`, `text-[12px]`, `text-[11px]`.

---

## 3. Layout Dimensions

| Region | Height/Width | Class |
|--------|-------------|-------|
| Topbar | 36px | `h-9` |
| Sidebar | 240px | `w-60` |
| Statusbar | 24px | `h-6` |
| Cell heading | 32px | `h-8` |
| Panel section header | 28px | `h-7` |

---

## 4. Component Patterns (from mockup + v1)

### Welcome screen
Inspired by v1's centered welcome — use a **large icon, bold title, dashed drop zone, and 2×2 feature card grid**:

```tsx
// Large book/notebook icon (cyan outline, ~48px)
// Title: 24px bold, white
// Subtitle: 14px grey
// Dashed drop zone: border-dashed border-2 border-[--color-border] rounded-lg
// Feature cards: 2×2 grid, bg-[--color-bg-surface], border, rounded
```

### Cell cards
From mockup — each cell is a card:
```
border border-[--color-border] rounded bg-[--color-bg-surface]
focused: border-[--color-accent]
errored: border-[--color-accent-red]/50
```

Cell heading:
```
bg-[--color-bg-overlay] border-b border-[--color-border]
alias chip: font-mono text-[11px] text-[--color-accent-amber]
run button: text-[--color-accent] hover:text-white
status chip: font-mono text-[11px]
```

### Sidebar panels (TABLES / VIEWS / MACROS)
```
Panel header: text-[11px] font-semibold uppercase tracking-wider text-[--color-fg-muted]
              h-7, border-b border-[--color-border], cursor-pointer
Row: text-[12px] text-[--color-fg-base], h-7, px-3
     hover: bg-[--color-bg-overlay]
     icon: 12px, text-[--color-fg-dim] (T=table, V=view, ƒ=macro)
     count/meta: ml-auto font-mono text-[11px] text-[--color-accent]
```

### Variable chips
```
$x  (static): bg-[--color-bg-overlay] text-[--color-accent-amber]
              border border-[--color-accent-amber]/30
$$x (global): border-[--color-accent-purple]/30 text-[--color-accent-purple]
$!x (live):   border-[--color-accent]/40 text-[--color-accent]
              background gradient: from-[--color-accent]/8 to transparent
All: font-mono text-[11px], rounded-full px-2 py-0.5
```

### Status chips (cell status)
```
idle:    "▣ idle"     text-[--color-fg-dim]
running: "⟳ running…" text-[--color-accent-yellow] animate-pulse
done:    "✓ N rows · Tms"  text-[--color-accent-green]
error:   "✗ message"  text-[--color-accent-red]
```

### Buttons (primary / ghost)
```
Primary: bg-[--color-accent]/10 text-[--color-accent] border border-[--color-accent]/30
         hover: bg-[--color-accent]/20
         px-3 py-1 rounded text-[12px] font-medium

Ghost:   text-[--color-fg-muted] hover:text-[--color-fg-base] hover:bg-[--color-bg-overlay]
         px-2 py-1 rounded text-[12px]
```

---

## 5. Visual Fidelity Checkpoints

These are **mandatory visual review gates** inserted after substantial UI milestones. Each gate:
1. Takes a screenshot of the live app
2. Takes a screenshot of the reference mockup (`index.html`) at the equivalent section
3. Compares them and lists deviations
4. Blocks commit if any **🔴 Critical** deviations exist

### Checkpoint A — After M-B2 (Cell editor) ✅ DONE
**What to check:** Welcome screen, topbar, sidebar, statusbar.
**Reference:** `index.html` hero / topbar section.
**Passed:** Dark theme, cyan accent, typography aligned.

### Checkpoint B — After M-B3 (Query execution)
**What to check:** Cell card with run button + results table.
**Reference:** `index.html` cell #2 (events cell with results).
**Key things:**
- Cell has amber alias chip (`-- @events` → `events`)
- Run button is cyan, not grey
- Results table has column header sort arrows, alternating row bg
- Status shows `✓ N rows · Tms` in green monospace
- No white-on-white in dark theme

### Checkpoint C — After M-B5 (Issues panel)
**What to check:** Issues panel, cell error state, diagnostic chips.
**Reference:** `index.html` issues sidebar section + errored cell.
**Key things:**
- Issues panel has 5-kind taxonomy badges (error=red, warn=amber, info=blue, perf=orange, style=purple)
- Errored cell border is red/50
- Diagnostic strip uses severity glyphs (▣ error, ▲ warn, ⓘ info)

### Checkpoint D — After M-C2 (First plots)
**What to check:** Line chart, bar chart render in a cell.
**Reference:** `index.html` cell #3 (GC pause line chart), cell #4 (allocation bar chart).
**Key things:**
- Chart has proper dark background (`--color-bg-overlay`)
- Axis labels use `--color-fg-muted`
- Grid lines use `--color-border`
- Line color uses `--color-accent` (cyan)
- Chart title in `--color-fg-base`
- No white axis labels on dark bg

### Checkpoint E — After M-C4 (Flamegraph + table)
**What to check:** Flamegraph render, result table full interactions.
**Reference:** `index.html` flamegraph cell, `showcase.html` §3b plot states.
**Key things:**
- Flamegraph frames have proper hotness gradient (cool→warm: blue→yellow→red)
- Hover tooltip has dark bg, cyan text
- Table columns right-align numbers, left-align strings
- Pagination / truncation banner visible when > 200 rows

### Checkpoint F — After M-E2 (Live coupling / brush)
**What to check:** Producer cell with brush gesture, consumer cell updating.
**Reference:** `showcase.html` §5 (live coupling), `index.html` live-var bar.
**Key things:**
- Live-var bar below topbar shows `$!brush` pill with cyan gradient bg
- Brush range shown as `[ 100ms — 250ms ]` in monospace
- Producer cell has cyan top-border glow when producing
- Consumer cell reruns automatically (status flickers running→done)
- `WHERE col IN $!brush` rendered as chip, not plain text

### Checkpoint G — After M-D1 (Chat panel)
**What to check:** Chat panel drawer, message bubbles, inline cell proposals.
**Reference:** `index.html` right-side chat panel, `showcase.html` §7.
**Key things:**
- Chat uses same dark bg (`--color-bg-surface`)
- User messages right-aligned, assistant left-aligned
- Cell proposals have Accept/Reject buttons in green/red
- Input box has `--color-border` border, focus ring in `--color-accent`
- AI provider badge in corner (amber for Claude, green for local)

---

## 6. How to Run a Checkpoint

```bash
# 1. Take app screenshot
cd frontend-v2
npx playwright screenshot --browser=chromium http://localhost:5173 /tmp/checkpoint-<X>-app.png

# 2. Take mockup screenshot  
npx playwright screenshot --browser=chromium \
  "file:///path/to/deprecated/jfr-sql-notebook/redesign-plan/index.html" \
  /tmp/checkpoint-<X>-mockup.png

# 3. View both (read both files in Claude)
# 4. List deviations
# 5. Fix 🔴 Critical before proceeding
```

**🔴 Critical deviations (block commit):**
- Wrong theme (light when should be dark)
- Wrong accent color (blue instead of cyan)
- White text on white/light background
- Missing component entirely (e.g. no alias chip, no status chip)
- Layout broken (overflow, overlapping elements)

**🟡 Warning (fix in same milestone):**
- Font size off by more than 2px
- Wrong token used (e.g. `text-blue-400` instead of `text-[--color-accent]`)
- Missing hover state
- Spacing more than 4px off

**🔵 Note (fix before phase end):**
- Slight color shade difference
- Missing transition animation
- Icon choice differs from mockup

---

## 7. Instructions for Implementing Agents

**Before writing any component:**
1. Open `deprecated/jfr-sql-notebook/redesign-plan/index.html` in a browser (or screenshot it)
2. Find the equivalent section
3. Match: colors (use tokens), font sizes (use literal px), spacing, border radius, border colors

**Token usage rules:**
- ALWAYS use `var(--color-*)` tokens — never raw hex
- In Tailwind classes: `text-[--color-fg-muted]`, `bg-[--color-bg-surface]`, `border-[--color-border]`
- For opacity variants: `bg-[--color-accent]/10`, `border-[--color-accent]/30`

**After completing each milestone's UI:**
- Run the checkpoint for that milestone (see §5)
- Fix any 🔴 Critical issues before committing
- Include checkpoint screenshot paths in the commit message or PR

---

## 8. V1 UI Elements Worth Preserving

From `core/frontend/` — these work well and v2 should match or improve:

- **Welcome drop zone:** Large dashed rounded rectangle, "Drop a .jfr or .duckdb file here", click-to-choose fallback
- **Feature cards:** 2×2 grid below drop zone — SQL+charts, Schema Explorer, Interactive zoom, Shareable notebooks
- **Loading state:** Centered spinner with "Connecting to database..." — cyan spinner, grey text
- **Sidebar search:** Input with magnifier icon at top, filters table/view list in real time
- **Row count badges:** Table name + row count `1.2M` in cyan monospace — right-aligned
- **Schema tooltip:** Hover over table name → floating card with column list, types, sample values
- **Drag handle:** Left edge of cell, `⋮⋮` glyph, `cursor-grab`, appears on hover only
- **Run all button:** In topbar, play icon, "Run All" label — distinct from per-cell run
- **Toast notifications:** Bottom-right, slide-in, auto-dismiss 3s, error=red/success=green
