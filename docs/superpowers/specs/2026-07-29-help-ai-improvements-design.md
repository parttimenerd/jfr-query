# Help & AI Improvements Design

**Date:** 2026-07-29  
**Status:** Approved

## Overview

Four independent work streams to improve help discoverability and AI capabilities in the JFR Query Notebook. Each stream is self-contained and can be implemented in any order.

---

## Stream 1 — Contextual editor help

### Goal
Surface DSL documentation inline while typing, and give actionable error messages when plot syntax is wrong.

### Changes

**`core/frontend/components/editor/plot/hover.ts` (new file)**

A CodeMirror 6 `hoverTooltip()` extension. When the cursor hovers a plot keyword (shape name or tail clause), it looks up `plotClauseDocs.ts` by token text and renders the clause signature and description in a CodeMirror tooltip. Mirrors the existing `editor/sqlHover.ts` pattern.

- Token matching: exact match on uppercase token, then case-insensitive fallback.
- Tooltip content: clause `signature` + `description` from `plotClauseDocs`.
- No network calls — fully synchronous local lookup.

**`core/frontend/components/editor/plot/lint.ts` (extend)**

Extend the existing plot linter with two new diagnostic categories:

1. **Unknown shape name**: if the parsed shape token doesn't match any key in `plotRegistry`, compute levenshtein distance against all known shape names. If distance ≤ 2, emit a warning diagnostic: `Unknown shape "foo" — did you mean "LINE_CHART"?`
2. **Unknown clause keyword**: same levenshtein pass against the keys of `plotClauseDocs`. Emits at the token range of the unknown keyword.

Both diagnostics render as red underlines with the suggestion text in the hover tooltip.

### Data flow
```
plotClauseDocs.ts ──► hoverTooltip extension ──► CodeMirror tooltip DOM
plotRegistry keys ──► lint extension ──► CodeMirror diagnostics
```

---

## Stream 2 — AI Settings tab polish

### Goal
Make the AI configuration panel self-explanatory: show which AI entry points exist, what each does, and whether the current configuration is working.

### Changes

**`core/frontend/components/SettingsPanel.tsx`**

In the AI settings section, add:

1. **Mode cards**: three labelled cards — "Ghost-text" (Tab to accept inline suggestion), "Inline chat" (Ctrl+K / Cmd+K), "Command palette AI" (Ctrl+Shift+P → `>`). Each card shows a one-line description and the keyboard shortcut. Cards are visually muted when AI is not configured (no provider/key set), normal when AI is active. This is informational only — there is no per-mode toggle.
2. **Test connection button**: sends a minimal ping prompt to the configured provider. Shows a spinner while pending, then ✓ green with round-trip latency, or ✗ red with the error message. Result is held in local component state (not cached — each press re-tests).
3. **Active model display**: show the model name currently in use next to the provider selector.

**`core/frontend/services/AiService.ts`**

Add `pingProvider(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>` — sends a single-token completion request and returns the result. Called by the Test connection button.

### Data flow
```
Settings AI tab ──► AiService.pingProvider() ──► provider endpoint
                                              ◄── { ok, latencyMs, error }
Local component state holds result — not persisted.
```

---

## Stream 3 — AI tool quality & coverage

### Goal
Make completions respect actual column names, give users a one-click path to fix broken plots, and add two new agent tools for explanation and plot suggestion.

### Changes

**Column-aware completion validation (`editor/aiGhostText.ts`, `editor/aiAutocomplete/`)**

After receiving a ghost-text or autocomplete suggestion, run a post-processing pass: for any identifier token in the suggestion that looks like a column reference (lowercase, no sigil), check it against `cellResultSchema.columns`. If an identifier doesn't appear in the schema, strip the suggestion (return empty). This is a client-side filter — no additional model round-trip.

The prompt passed to the model already includes `cellResultSchema`; tighten the instruction: "Only use column names that appear in the schema above. Do not invent column names."

**"Fix with AI" button (`components/plots/PlotRenderer.tsx` + `NotebookCell.tsx`)**

When `PlotRenderer` catches a render or parse error and displays the error message div, add a "Fix with AI" button. `PlotRenderer` already receives an `onFixWithAi?: (errorMessage: string) => void` callback prop (to be added). `NotebookCell` wires it to `setActiveChat('plot-${plotUid}')` — the same mechanism used by the existing Cmd+K shortcut — and passes the error message as a `prefillMessage` prop to `InlineChat` so the chat opens pre-filled with the DSL + error context.

No new state paths — `activeChat` and `InlineChat` props already exist; `prefillMessage` is a new optional prop on `InlineChat`.

**`explainCell` tool (`services/AiService.ts`)**

New agent tool registered in the tool registry:

- **Input**: `cellId: string`
- **Behaviour**: reads the cell's SQL, query results (first 20 rows), and plot config (if any). Constructs a prompt asking the model to explain what the data shows in plain language. The system prompt includes JFR domain hints: GC pause patterns, flamegraph hotspot signatures, thread contention indicators.
- **Output**: explanation text inserted as an assistant message in inline-chat.

**`suggestPlot` tool (`services/AiService.ts`)**

New agent tool:

- **Input**: `cellId: string` (reads its result schema)
- **Behaviour**: sends column names + types to the model with the instruction "suggest the best plot type and minimal DSL config for this data shape."
- **Output**: a ready-to-paste DSL snippet returned as an assistant message, with an "Apply" button (same as existing `applyPlot` flow).

### Data flow
```
Ghost-text suggestion ──► column validation pass ──► accept or discard
PlotRenderer error ──► "Fix with AI" click ──► InlineChat.open(prefill)
Agent: explainCell ──► cell SQL + results ──► model ──► explanation text
Agent: suggestPlot ──► result schema ──► model ──► DSL snippet
```

---

## Stream 4 — Help content & discoverability

### Goal
Make the PlotHelpModal faster to navigate, and give first-time users a guided starting point.

### Changes

**`core/frontend/components/PlotHelpModal.tsx`**

1. **Search**: add a text input at the top of the modal. `filterTerm` state string filtered against shape names, clause names, and description text (case-insensitive). Matching shapes and clauses shown; non-matching entries hidden.
2. **Cheat sheet tab**: new tab alongside existing "Shapes" and "Clauses" tabs. Renders a compact two-column table: clause name (left) + one-line description and signature (right). Data sourced directly from `plotClauseDocs.ts` — no duplication.
3. **Insert example button**: on each example code block in the modal, add a small "Insert" button. `PlotHelpModal` receives a new optional `onInsertExample?: (code: string) => void` prop. `NotebookCell` wires this to `plotEditorRef.dispatch(insertText(code))` when opening the modal from a plot cell. When no editor ref is available (modal opened from toolbar), the button falls back to copying to clipboard.

**`core/frontend/App.tsx` (onboarding cell)**

On notebook load, check:
```ts
if (cells.length === 0 && !localStorage.getItem('jfrq:onboarding-dismissed')) {
  prependOnboardingCell();
}
```

The onboarding cell is a TemplatedMarkdown cell flagged `isOnboarding: true`. It renders a "Getting started" guide:
- Step 1: Load a JFR file (drag-and-drop or File menu)
- Step 2: Write a SELECT query in a SQL cell
- Step 3: Add a PLOT cell below it

Dismiss button: sets `localStorage.setItem('jfrq:onboarding-dismissed', '1')` and removes the cell. The cell is **never persisted** to the notebook file — ephemeral UI state only. Never shown again once dismissed.

### Data flow
```
plotClauseDocs.ts ──► cheat sheet tab (read-only)
filterTerm state ──► client-side filter ──► visible modal items
"Insert" click ──► editorRef.dispatch(insertText) ──► active cell
App load: cells.length === 0 && !localStorage key ──► onboarding cell
Dismiss click ──► localStorage key set + cell removed
```

---

## Testing

- **Stream 1**: unit tests for the levenshtein "did you mean" logic; CodeMirror extension tested via the existing editor test harness.
- **Stream 2**: `pingProvider` unit-tested with a mock fetch; Settings tab UI tested with RTL.
- **Stream 3**: column validation pass unit-tested with fixture schemas; `explainCell`/`suggestPlot` tool handlers unit-tested with mock AI responses.
- **Stream 4**: search filter logic unit-tested; onboarding lifecycle (localStorage gate, dismiss) tested with RTL.

---

## Out of scope

- Full guided tour / step-by-step overlay (deferred — high complexity, low immediate value)
- Token usage display (requires provider-specific response parsing not yet abstracted)
- Toolbar AI status pill (deferred — decided in favour of Settings-tab approach)
