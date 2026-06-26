/**
 * CodeMirror ghost-text extension for AI inline autocomplete.
 *
 * Public surface:
 *  - `setGhostText` / `clearGhostText`: StateEffects dispatched by the
 *    orchestrator (see aiAutocomplete/index.ts).
 *  - `ghostTextField`: StateField that holds the currently shown suggestion.
 *  - `ghostTextKeymap`: Tab accepts (only when ghost text is active),
 *    Escape dismisses.
 *  - `aiGhostTextExtension`: bundled Extension you can drop into the editor.
 *
 * The widget renders inline at the cursor offset using Decoration.widget(side:1)
 * (placed at `from`). Edits to the doc clear the field so stale ghost text
 * never sticks around past the next keystroke.
 */

import { Decoration, DecorationSet, EditorView, WidgetType, keymap } from '@codemirror/view';
import { StateEffect, StateField, Extension } from '@codemirror/state';

export interface GhostTextState {
  /** Document offset where the suggestion would be inserted. */
  from: number;
  /** The suggestion text. */
  text: string;
}

/** Set the current ghost-text suggestion (or null to clear). */
export const setGhostText = StateEffect.define<GhostTextState | null>();

/** Explicitly clear the current ghost-text suggestion. */
export const clearGhostText = StateEffect.define<void>();

/** Internal helper effect used by the Escape keymap to mark the editor as suppressed. */
export const setEscapeSuppression = StateEffect.define<boolean>();

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-jfr-ghost-text';
    span.textContent = this.text;
    return span;
  }
  eq(other: GhostTextWidget) {
    return other.text === this.text;
  }
  ignoreEvent() {
    return true;
  }
}

export const ghostTextField = StateField.define<GhostTextState | null>({
  create: () => null,
  update(value, tr) {
    // If the doc changed (user typed), wipe — the orchestrator will reissue
    // a fresh suggestion after its debounce.
    if (tr.docChanged) value = null;
    for (const e of tr.effects) {
      if (e.is(setGhostText)) value = e.value;
      else if (e.is(clearGhostText)) value = null;
    }
    return value;
  },
  provide: f => EditorView.decorations.from(f, v => {
    if (!v || !v.text) return Decoration.none;
    // Defensive: the doc might have shrunk since the effect was dispatched.
    return Decoration.set([
      Decoration.widget({ widget: new GhostTextWidget(v.text), side: 1 }).range(v.from),
    ]);
  }),
});

/** Tracks whether Escape was the most-recent dismissal so we don't immediately re-fire. */
export const escapeSuppressionField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    // A real edit (typing) clears suppression: the user is engaging again.
    if (tr.docChanged) return false;
    for (const e of tr.effects) {
      if (e.is(setEscapeSuppression)) return e.value;
    }
    return value;
  },
});

export const ghostTextKeymap = keymap.of([
  {
    key: 'Tab',
    run: view => {
      const st = view.state.field(ghostTextField, false);
      if (!st || !st.text) return false; // fall through to other Tab handlers
      const insertAt = Math.min(st.from, view.state.doc.length);
      view.dispatch({
        changes: { from: insertAt, to: insertAt, insert: st.text },
        selection: { anchor: insertAt + st.text.length },
        effects: clearGhostText.of(),
      });
      return true;
    },
  },
  {
    key: 'Escape',
    run: view => {
      const st = view.state.field(ghostTextField, false);
      if (!st || !st.text) return false; // no ghost text — let other handlers see Escape
      view.dispatch({
        effects: [clearGhostText.of(), setEscapeSuppression.of(true)],
      });
      // Don't preventDefault — let modal/popup escape handlers still see it.
      return false;
    },
  },
]);

/** Drop-in extension bundle. */
export const aiGhostTextExtension: Extension = [
  ghostTextField,
  escapeSuppressionField,
  ghostTextKeymap,
];
