/**
 * Tests the ghost-text CM extension using synthetic EditorState/EditorView in
 * a jsdom-less environment via @codemirror/state. Decoration rendering itself
 * requires a DOM, so we test behavior at the StateField/effect level.
 */

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  ghostTextField,
  escapeSuppressionField,
  setGhostText,
  clearGhostText,
  setEscapeSuppression,
} from '../../components/editor/aiGhostText';

function makeState(doc = 'SELECT 1') {
  return EditorState.create({ doc, extensions: [ghostTextField, escapeSuppressionField] });
}

describe('ghostTextField', () => {
  it('starts null', () => {
    const s = makeState();
    expect(s.field(ghostTextField)).toBeNull();
  });

  it('setGhostText effect installs a suggestion', () => {
    const s = makeState();
    const next = s.update({ effects: setGhostText.of({ from: 7, text: ' FROM x' }) }).state;
    expect(next.field(ghostTextField)).toEqual({ from: 7, text: ' FROM x' });
  });

  it('clearGhostText effect removes the suggestion', () => {
    const s = makeState().update({ effects: setGhostText.of({ from: 7, text: 'X' }) }).state;
    const cleared = s.update({ effects: clearGhostText.of() }).state;
    expect(cleared.field(ghostTextField)).toBeNull();
  });

  it('docChanged wipes the suggestion', () => {
    const s = makeState().update({ effects: setGhostText.of({ from: 7, text: 'X' }) }).state;
    const edited = s.update({ changes: { from: 7, to: 7, insert: 'A' } }).state;
    expect(edited.field(ghostTextField)).toBeNull();
  });

  it('setGhostText with null clears the suggestion', () => {
    const s = makeState().update({ effects: setGhostText.of({ from: 7, text: 'X' }) }).state;
    const cleared = s.update({ effects: setGhostText.of(null) }).state;
    expect(cleared.field(ghostTextField)).toBeNull();
  });
});

describe('escapeSuppressionField', () => {
  it('starts false', () => {
    expect(makeState().field(escapeSuppressionField)).toBe(false);
  });

  it('setEscapeSuppression(true) sets the flag', () => {
    const next = makeState().update({ effects: setEscapeSuppression.of(true) }).state;
    expect(next.field(escapeSuppressionField)).toBe(true);
  });

  it('docChanged clears the flag (user resumed typing)', () => {
    const s = makeState().update({ effects: setEscapeSuppression.of(true) }).state;
    const edited = s.update({ changes: { from: 0, to: 0, insert: 'x' } }).state;
    expect(edited.field(escapeSuppressionField)).toBe(false);
  });
});
