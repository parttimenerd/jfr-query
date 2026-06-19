import type { PlotRegistration } from '../components/plots/plotTypes';

// A custom CodeMirror 5 mode for the plot configuration language.
// This enables syntax highlighting for plot functions, parameters, and values.

declare global {
  interface Window {
    CodeMirror: any;
  }
}

export const registerPlotMode = (plotRegistry: Record<string, PlotRegistration<any>>) => {
  if (!window.CodeMirror || window.CodeMirror.modes.plot) {
    return;
  }

  window.CodeMirror.defineMode('plot', () => {
    // Dynamically generate keywords from the provided plot registry
    const functions = Object.keys(plotRegistry);
    
    const allParams = new Set<string>();
    const allOptions = new Set<string>(['dataMin', 'dataMax', 'true', 'false']);
    Object.values(plotRegistry).forEach(plot => {
      plot.params.forEach(param => {
          allParams.add(param.name);
          if (param.options) {
              param.options.forEach(option => allOptions.add(option));
          }
      });
    });
    const params = Array.from(allParams);
    
    // Atoms are special literal values used as parameters
    const atoms = Array.from(allOptions);
    
    const keywords = new Set(['ON', 'WIDTH', 'HEIGHT', 'ZOOM', 'TITLE', 'LINK_X', 'MASTER', 'CLAMP']);

    function tokenBase(stream: any, state: any) {
      const ch = stream.next();

      // Handle strings
      if (ch === '"' || ch === "'") {
        state.tokenize = tokenString(ch);
        return state.tokenize(stream, state);
      }
      
      // Handle operators and brackets
      if (/[\[\]{}(),:]/.test(ch)) {
        return 'operator';
      }

      // Handle numbers
      if (/\d/.test(ch)) {
        stream.eatWhile(/[\w\.%]/); // Allow % and . for sizes
        return 'number';
      }

      // Handle identifiers (functions, params, atoms)
      stream.eatWhile(/[\w\$_]/);
      const word = stream.current();

      if (keywords.has(word.toUpperCase())) {
        return 'keyword';
      }
      if (functions.includes(word.toUpperCase())) {
        return 'plot-function'; // custom style
      }
      if (params.includes(word)) {
        return 'plot-param'; // custom style
      }
      if (atoms.includes(word)) {
        return 'atom';
      }

      return 'variable'; // Default for column names etc.
    }

    function tokenString(quote: string) {
      return function (stream: any, state: any) {
        let escaped = false, next, end = false;
        while ((next = stream.next()) != null) {
          if (next === quote && !escaped) {
            end = true;
            break;
          }
          escaped = !escaped && next === '\\';
        }
        if (end || !escaped) {
          state.tokenize = null;
        }
        return 'string';
      };
    }

    // The interface for a CodeMirror mode
    return {
      startState: function () {
        return { tokenize: null };
      },
      token: function (stream: any, state: any) {
        if (stream.eatSpace()) return null;
        return (state.tokenize || tokenBase)(stream, state);
      },
    };
  });
};