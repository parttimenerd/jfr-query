import { StreamLanguage, LanguageSupport } from '@codemirror/language';
import { sql, SQLDialect } from '@codemirror/lang-sql';
import { markdown } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';
import type { PlotRegistration } from '../plots/plotTypes';

/**
 * Plot DSL syntax mode, ported from the old codemirror-plot-mode.ts to CM6's
 * StreamLanguage. Token classifications are translated to Lezer highlight tags.
 */
export const buildPlotLanguage = (plotRegistry: Record<string, PlotRegistration<any>>): LanguageSupport => {
  const functions = new Set(Object.keys(plotRegistry).map(s => s.toUpperCase()));
  const allParams = new Set<string>();
  const allOptions = new Set<string>(['dataMin', 'dataMax', 'true', 'false']);
  for (const plot of Object.values(plotRegistry)) {
    for (const param of plot.params) {
      allParams.add(param.name);
      if (param.options) for (const opt of param.options) allOptions.add(opt);
    }
  }
  const keywords = new Set(['ON', 'WIDTH', 'HEIGHT', 'ZOOM', 'TITLE', 'LINK_X', 'MASTER', 'CLAMP', 'LET']);

  const lang = StreamLanguage.define({
    name: 'plot',
    startState: () => ({ inString: null as string | null }),
    token(stream, state: any) {
      if (state.inString) {
        let escaped = false;
        while (!stream.eol()) {
          const ch = stream.next() as string | undefined;
          if (ch == null) break;
          if (ch === state.inString && !escaped) {
            state.inString = null;
            return 'string';
          }
          escaped = !escaped && ch === '\\';
        }
        return 'string';
      }
      if (stream.eatSpace()) return null;
      const ch = stream.next() as string | undefined;
      if (ch == null) return null;

      // @-references (LET constants)
      if (ch === '@') {
        stream.eatWhile(/[\w]/);
        return 'macroName';
      }
      // Strings
      if (ch === '"' || ch === "'") {
        state.inString = ch;
        return 'string';
      }
      // Operators / brackets
      if (/[\[\]{}(),:=]/.test(ch)) return 'operator';
      // Numbers
      if (/\d/.test(ch)) {
        stream.eatWhile(/[\w\.%]/);
        return 'number';
      }
      // Identifiers
      if (/[\w$_]/.test(ch)) {
        stream.eatWhile(/[\w$_]/);
        const word = stream.current() as string;
        const upper = word.toUpperCase();
        if (keywords.has(upper)) return 'keyword';
        if (functions.has(upper)) return 'plotFunction';
        if (allParams.has(word)) return 'plotParam';
        if (allOptions.has(word)) return 'atom';
        return 'variableName';
      }
      return null;
    },
    tokenTable: {
      plotFunction: t.processingInstruction,
      plotParam: t.labelName,
      macroName: t.special(t.variableName),
    },
  });
  return new LanguageSupport(lang);
};

/**
 * SQL language with a DuckDB-flavored dialect.
 */
export const buildSqlLanguage = (): LanguageSupport => {
  return sql({
    dialect: SQLDialect.define({
      keywords:
        'select from where group by order having limit offset insert update delete create drop alter table view macro as on join left right inner outer full cross union all distinct case when then else end and or not in is null true false asc desc with recursive over partition window between like ilike exists',
      builtin: 'count sum avg min max median round abs floor ceil',
      types: 'integer bigint smallint varchar text date time timestamp boolean float double decimal',
      operatorChars: '+-*/%=<>!&|^~?:',
      identifierQuotes: '"',
      caseInsensitiveIdentifiers: true,
    }),
    upperCaseKeywords: false,
  });
};

export const markdownLanguage = (): LanguageSupport => markdown();
