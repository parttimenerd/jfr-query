/**
 * Trigger gates and helpers for AI autocomplete.
 *
 *  - `isInSqlComment(upToCursor)`: true inside a line `--` or block `/​* *​/` SQL comment.
 *  - `currentWordLengthBack(upToCursor)`: length of the word immediately preceding the cursor.
 *  - `shouldFire(...)`: combined gate considering mode, comment context, word length,
 *    and the escape-suppression flag.
 *  - `Debouncer`: small reusable per-instance setTimeout debouncer with `cancel()`.
 */

export type TriggerMode = 'sql' | 'plot' | 'markdown';

const SQL_MIN_CHARS = 3;
const MD_MIN_CHARS = 5;

export const SQL_DEBOUNCE_MS = 200;
export const MD_DEBOUNCE_MS = 400;

/**
 * Returns true if the character at the cursor position is inside a SQL comment.
 * Recognises line `-- …` and block `/​* … *​/` comments. String literals are
 * approximated by tracking quote state.
 */
export function isInSqlComment(upToCursor: string): boolean {
  // Line-comment fast path: look at the current line.
  const lineStart = upToCursor.lastIndexOf('\n') + 1;
  const line = upToCursor.slice(lineStart);
  // Naive but adequate: scan the current line for `--` not inside a single-quoted
  // string literal. Block comments dominate (handled below).
  let inStr = false;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i];
    if (c === "'") {
      // Toggle on single-quote, ignoring doubled '' which is an escaped quote.
      if (line[i + 1] === "'") { i++; continue; }
      inStr = !inStr;
    } else if (!inStr && c === '-' && line[i + 1] === '-') {
      return true;
    }
  }
  // Block-comment: scan the entire prefix for unbalanced /* … */.
  let depth = 0;
  for (let i = 0; i < upToCursor.length - 1; i++) {
    if (upToCursor[i] === '/' && upToCursor[i + 1] === '*') { depth++; i++; }
    else if (depth > 0 && upToCursor[i] === '*' && upToCursor[i + 1] === '/') { depth--; i++; }
  }
  return depth > 0;
}

/**
 * Length of the contiguous word (\w+) immediately ending at the cursor.
 * Returns 0 if the cursor is on whitespace, punctuation, or start-of-line.
 */
export function currentWordLengthBack(upToCursor: string): number {
  let n = 0;
  for (let i = upToCursor.length - 1; i >= 0; i--) {
    if (/[A-Za-z0-9_]/.test(upToCursor[i])) n++;
    else break;
  }
  return n;
}

export interface FireGateInput {
  mode: TriggerMode;
  upToCursor: string;
  /** Was the most recent dismissal an Escape? If so, suppress. */
  escapeSuppressed: boolean;
}

/**
 * Combined gate. Returns true if the orchestrator should issue an AI request
 * NOW (i.e. after debounce elapsed).
 *
 * Rules per the plan:
 *   - SQL/plot: ≥ SQL_MIN_CHARS word chars before cursor; OR inside a comment (any length).
 *   - markdown: ≥ MD_MIN_CHARS word chars.
 *   - escape suppression: skip until the user types something non-escape (consumer must clear).
 */
export function shouldFire(input: FireGateInput): boolean {
  if (input.escapeSuppressed) return false;
  const n = currentWordLengthBack(input.upToCursor);
  if (input.mode === 'markdown') {
    return n >= MD_MIN_CHARS;
  }
  // sql / plot
  if (isInSqlComment(input.upToCursor)) return true;
  return n >= SQL_MIN_CHARS;
}

export function debounceMsFor(mode: TriggerMode): number {
  return mode === 'markdown' ? MD_DEBOUNCE_MS : SQL_DEBOUNCE_MS;
}

/** Simple debouncer with an explicit cancel. Compatible with synthetic timers. */
export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  schedule(fn: () => void, ms: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
  }
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
  get pending(): boolean {
    return this.timer !== null;
  }
}
