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

// LINK_X uses paren form: LINK_X($s, $e) — variables are binding targets (output).
const LINK_ARGS_PAREN_RE = /\bLINK_X\s*\(([^)]*)\)/gi;
// LINK_Y/LINK_XY/LINK_SCROLL use space form: LINK_Y $var — capture the $var.
const LINK_Y_SPACE_RE = /\bLINK_(?:Y|XY|SCROLL)\s+(\$\w+)/gi;
// BRUSH uses space form: BRUSH $var MODE ... — the $var is a binding target (output).
const BRUSH_SPACE_RE = /\bBRUSH\s+(\$\w+)\s+MODE\b/gi;
// Matches lowercase pipe-DSL form: `| link-x: [...]` or `| link-y: $var`.
const LINK_ARGS_PIPE_RE = /\|\s*link-(?:x|y|xy|scroll)\s*:\s*(\[[^\]]*\]|\$\w+)/gi;

function buildLinkArgRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  LINK_ARGS_PAREN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_ARGS_PAREN_RE.exec(text)) !== null) {
    const parenOpen = m.index + m[0].indexOf('(');
    const parenClose = m.index + m[0].length - 1;
    ranges.push([parenOpen + 1, parenClose]);
  }

  // Suppress undefined-variable warnings for LINK_Y/XY/SCROLL and BRUSH binding vars.
  for (const re of [LINK_Y_SPACE_RE, BRUSH_SPACE_RE]) {
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const valueStart = m.index + m[0].indexOf(m[1]);
      ranges.push([valueStart, valueStart + m[1].length]);
    }
  }

  LINK_ARGS_PIPE_RE.lastIndex = 0;
  while ((m = LINK_ARGS_PIPE_RE.exec(text)) !== null) {
    const valueStart = m.index + m[0].indexOf(m[1]);
    ranges.push([valueStart, valueStart + m[1].length]);
  }
  return ranges;
}

function isInsideLinkArgs(pos: number, linkRanges: Array<[number, number]>): boolean {
  for (const [lo, hi] of linkRanges) {
    if (pos >= lo && pos < hi) return true;
  }
  return false;
}

// Returns ranges of SQL double-quoted identifiers (e.g. "stackTrace$topMethod") so
// $-matches inside them are not treated as variable references.
function buildQuotedIdentifierRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      const start = i;
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++; // skip escaped char
        i++;
      }
      ranges.push([start, i + 1]);
      i++;
    } else {
      i++;
    }
  }
  return ranges;
}

function buildDecorations(state: EditorState): DecorationSet {
  const spec = state.field(variableSpec);
  if (!spec) return Decoration.none;
  const text = state.doc.toString();
  const linkRanges = buildLinkArgRanges(text);
  const quotedRanges = buildQuotedIdentifierRanges(text);
  const ranges: Range<Decoration>[] = [];
  let match: RegExpExecArray | null;
  variableRegex.lastIndex = 0;
  while ((match = variableRegex.exec(text)) !== null) {
    const name = match[0];
    const start = match.index;
    const end = start + name.length;
    // Variables inside LINK_X/LINK_Y/LINK_XY/LINK_SCROLL/BRUSH are binding targets — not "undefined".
    if (isInsideLinkArgs(start, linkRanges)) continue;
    // $-tokens inside SQL double-quoted identifiers (e.g. "stackTrace$topMethod") are field
    // path selectors in CJFR, not variable references — skip them.
    if (isInsideLinkArgs(start, quotedRanges)) continue;
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
