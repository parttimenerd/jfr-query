import { Decoration, DecorationSet, EditorView, WidgetType, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { StateField, StateEffect, EditorState, Range } from '@codemirror/state';

export interface VariableSpec {
  variables: Record<string, string>;
  onVariableClick?: (name: string) => void;
}

class ValueWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: ValueWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-varValueWidget';
    span.textContent = `: ${this.text}`;
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

const variableSpec = StateField.define<VariableSpec | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setVariableSpec)) return e.value;
    }
    return value;
  },
});

export const setVariableSpec = StateEffect.define<VariableSpec | null>();

const variableRegex = /\$\$?\w+/g;

// Matches LINK_X/LINK_Y/LINK_XY/LINK_SCROLL(...) — variables inside are
// output bindings written by the plot on interaction, not read variables.
const LINK_ARGS_RE = /\bLINK_(?:X|Y|XY|SCROLL)\s*\(([^)]*)\)/gi;

function buildLinkArgRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  LINK_ARGS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_ARGS_RE.exec(text)) !== null) {
    const parenOpen = m.index + m[0].indexOf('(');
    const parenClose = m.index + m[0].length - 1;
    ranges.push([parenOpen + 1, parenClose]);
  }
  return ranges;
}

function isInsideLinkArgs(pos: number, linkRanges: Array<[number, number]>): boolean {
  for (const [lo, hi] of linkRanges) {
    if (pos >= lo && pos < hi) return true;
  }
  return false;
}

function buildDecorations(state: EditorState): DecorationSet {
  const spec = state.field(variableSpec);
  if (!spec) return Decoration.none;
  const text = state.doc.toString();
  const linkRanges = buildLinkArgRanges(text);
  const ranges: Range<Decoration>[] = [];
  let match: RegExpExecArray | null;
  variableRegex.lastIndex = 0;
  while ((match = variableRegex.exec(text)) !== null) {
    const name = match[0];
    const start = match.index;
    const end = start + name.length;
    // Variables inside LINK_X/LINK_Y/LINK_XY/LINK_SCROLL are output bindings.
    if (isInsideLinkArgs(start, linkRanges)) continue;
    const defined = Object.prototype.hasOwnProperty.call(spec.variables, name);
    ranges.push(
      Decoration.mark({
        class: defined ? 'cm-localVar' : 'cm-undefVar',
        attributes: { 'data-variable': name, title: defined ? `${name} = ${spec.variables[name]}` : `Undefined variable: ${name}` },
      }).range(start, end),
    );
    if (defined) {
      const value = spec.variables[name];
      ranges.push(Decoration.widget({ widget: new ValueWidget(String(value)), side: 1 }).range(end));
    }
  }
  return Decoration.set(ranges, true);
}

const variableDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.startState.field(variableSpec, false) !== u.state.field(variableSpec, false)) {
        this.decorations = buildDecorations(u.state);
      }
    }
  },
  {
    decorations: v => v.decorations,
    eventHandlers: {
      mousedown(e, view) {
        const target = e.target as HTMLElement;
        const varEl = target.closest('[data-variable]') as HTMLElement | null;
        if (!varEl) return false;
        const name = varEl.getAttribute('data-variable');
        const spec = view.state.field(variableSpec);
        if (name && spec?.onVariableClick) {
          e.preventDefault();
          spec.onVariableClick(name);
          return true;
        }
        return false;
      },
    },
  },
);

export const variableExtension = [variableSpec, variableDecorations];
