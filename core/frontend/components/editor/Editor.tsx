import React, { useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { EditorState, Compartment, Extension } from '@codemirror/state';
import { EditorView, keymap, drawSelection, dropCursor, highlightActiveLine, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap } from '@codemirror/search';
import { editorHighlight, editorTheme } from './theme';
import { buildPlotLanguage, buildSqlLanguage, markdownLanguage } from './languages';
import { sqlCompletionSource, plotCompletionSource, type SchemaForCompletion } from './completions';
import { setVariableSpec, variableExtension } from './variables';
import { buildHoverTooltip } from './hover';
import { diagnosticsExtension, pushRunError, type RunErrorSpec } from './diagnostics';
import { plotRegistry } from '../plots/plotRegistry';

export type EditorMode = 'sql' | 'markdown' | 'plot';

export interface EditorHandle {
  view: EditorView | null;
  setError: (err: RunErrorSpec | null) => void;
  focus: () => void;
}

export interface EditorProps {
  value: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  onRun?: () => void;
  mode: EditorMode;
  readOnly?: boolean;
  autoFocus?: boolean;
  fullHeight?: boolean;
  schema?: SchemaForCompletion | null;
  variables?: Record<string, string>;
  onVariableClick?: (name: string) => void;
  plotData?: any[] | null;
  error?: RunErrorSpec | null;
  /** Optional: runs `SELECT DISTINCT col FROM tbl LIMIT 50` on demand. */
  runQuery?: ((sql: string) => Promise<any[]>) | null;
  /** Optional: semantic completion reranker (MiniLM). */
  rankCandidates?: ((queryContext: string, candidates: string[]) => Promise<string[]>) | null;
  isRankerReady?: (() => boolean) | null;
}

export const Editor = React.forwardRef<EditorHandle, EditorProps>(function Editor(props, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Refs hold the latest callbacks/state so extensions can read them
  // without being recreated on every render.
  const onChangeRef = useRef(props.onChange);
  const onBlurRef = useRef(props.onBlur);
  const onRunRef = useRef(props.onRun);
  const schemaRef = useRef(props.schema ?? null);
  const variablesRef = useRef(props.variables);
  const plotDataRef = useRef(props.plotData ?? null);
  const runQueryRef = useRef(props.runQuery ?? null);
  const rankCandidatesRef = useRef(props.rankCandidates ?? null);
  const isRankerReadyRef = useRef(props.isRankerReady ?? null);

  onChangeRef.current = props.onChange;
  onBlurRef.current = props.onBlur;
  onRunRef.current = props.onRun;
  schemaRef.current = props.schema ?? null;
  variablesRef.current = props.variables;
  plotDataRef.current = props.plotData ?? null;
  runQueryRef.current = props.runQuery ?? null;
  rankCandidatesRef.current = props.rankCandidates ?? null;
  isRankerReadyRef.current = props.isRankerReady ?? null;

  // Language compartment so we can hot-swap when mode changes (we don't expect
  // mode to change for a given editor instance, but this is cheap insurance).
  const languageCompartment = useMemo(() => new Compartment(), []);
  const readOnlyCompartment = useMemo(() => new Compartment(), []);

  // Build the static extension list once per mode.
  const baseExtensions = useMemo<Extension[]>(() => {
    const exts: Extension[] = [
      history(),
      drawSelection(),
      dropCursor(),
      EditorView.lineWrapping,
      editorTheme,
      editorHighlight,
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...completionKeymap,
        {
          key: 'Mod-Enter',
          run: () => {
            if (onRunRef.current) {
              onRunRef.current();
              return true;
            }
            return false;
          },
        },
      ]),
      EditorView.updateListener.of(update => {
        if (update.docChanged && onChangeRef.current) {
          onChangeRef.current(update.state.doc.toString());
        }
        if (update.focusChanged && !update.view.hasFocus && onBlurRef.current) {
          onBlurRef.current();
        }
      }),
      variableExtension,
    ];

    if (props.mode === 'sql') {
      exts.push(
        autocompletion({
          override: [
            sqlCompletionSource({
              getSchema: () => schemaRef.current,
              getVariables: () => variablesRef.current,
              getQueryRunner: () => runQueryRef.current,
              rankCandidates: rankCandidatesRef.current
                ? (q, c) => rankCandidatesRef.current!(q, c)
                : undefined,
              isRankerReady: isRankerReadyRef.current
                ? () => isRankerReadyRef.current!()
                : undefined,
            }),
          ],
          activateOnTyping: true,
          closeOnBlur: true,
        }),
        buildHoverTooltip({
          mode: 'sql',
          getSchema: () => schemaRef.current,
          getVariables: () => variablesRef.current,
        }),
        diagnosticsExtension,
      );
    } else if (props.mode === 'plot') {
      exts.push(
        autocompletion({
          override: [plotCompletionSource({ getData: () => plotDataRef.current })],
          activateOnTyping: true,
          closeOnBlur: true,
        }),
        buildHoverTooltip({
          mode: 'plot',
          getSchema: () => schemaRef.current,
          getVariables: () => variablesRef.current,
        }),
        diagnosticsExtension,
      );
    }
    return exts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode]);

  // Pick the language extension for this mode.
  const languageExt = useMemo<Extension>(() => {
    if (props.mode === 'sql') return buildSqlLanguage();
    if (props.mode === 'plot') return buildPlotLanguage(plotRegistry);
    return markdownLanguage();
  }, [props.mode]);

  // One-time mount.
  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: props.value,
      extensions: [
        ...baseExtensions,
        languageCompartment.of(languageExt),
        readOnlyCompartment.of(EditorState.readOnly.of(!!props.readOnly)),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    if (props.autoFocus) {
      // Focus on next tick so React has finished mounting siblings.
      requestAnimationFrame(() => view.focus());
    }
    // initial variable spec
    if (props.variables !== undefined || props.onVariableClick) {
      view.dispatch({
        effects: setVariableSpec.of({
          variables: props.variables ?? {},
          onVariableClick: props.onVariableClick,
        }),
      });
    }
    // initial error
    if (props.error !== undefined) {
      pushRunError(view, props.error ?? null);
    }
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync the `value` prop into the editor only when the editor isn't focused
  // and the value actually differs. This is the key change vs. the CM5 wrapper:
  // we never overwrite the user's in-flight typing.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === props.value) return;
    if (view.hasFocus) return; // user is typing — don't clobber
    view.dispatch({
      changes: { from: 0, to: current.length, insert: props.value },
    });
  }, [props.value]);

  // Sync variable spec.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setVariableSpec.of({
        variables: props.variables ?? {},
        onVariableClick: props.onVariableClick,
      }),
    });
  }, [props.variables, props.onVariableClick]);

  // Sync read-only.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(!!props.readOnly)),
    });
  }, [props.readOnly, readOnlyCompartment]);

  // Sync language when mode changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: languageCompartment.reconfigure(languageExt) });
  }, [languageExt, languageCompartment]);

  // Sync error state.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    pushRunError(view, props.error ?? null);
  }, [props.error]);

  useImperativeHandle(
    ref,
    () => ({
      get view() {
        return viewRef.current;
      },
      setError: (err: RunErrorSpec | null) => {
        if (viewRef.current) pushRunError(viewRef.current, err);
      },
      focus: () => viewRef.current?.focus(),
    }),
    [],
  );

  return (
    <div
      ref={hostRef}
      className={`cm-jfr-editor ${props.fullHeight ? 'h-full' : ''} w-full text-sm`}
    />
  );
});

export default Editor;
