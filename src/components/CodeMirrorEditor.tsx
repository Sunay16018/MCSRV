import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';

interface CodeMirrorEditorProps {
  value: string;
  filename: string;
  onChange: (nextValue: string) => void;
  onSave: () => void;
}

const customTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: '#0d1118',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
    overflow: 'auto',
  },
  '.cm-gutters': {
    backgroundColor: '#0b0e14',
    borderRight: '1px solid rgba(30, 41, 59, 0.8)',
    color: '#64748b',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    color: '#10b981',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(30, 41, 59, 0.35)',
  },
});

export function CodeMirrorEditor({ value, filename, onChange, onSave }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartmentRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const externalValueRef = useRef(value);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  const getLanguageExtension = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.endsWith('.json')) return json();
    return javascript({
      typescript: lower.endsWith('.ts') || lower.endsWith('.tsx'),
      jsx: lower.endsWith('.jsx') || lower.endsWith('.tsx'),
    });
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const saveShortcut = keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          onSaveRef.current();
          return true;
        },
      },
    ]);

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        oneDark,
        customTheme,
        langCompartmentRef.current.of(getLanguageExtension(filename)),
        saveShortcut,
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const docText = update.state.doc.toString();
            externalValueRef.current = docText;
            onChangeRef.current(docText);
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Update language mode when filename changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langCompartmentRef.current.reconfigure(getLanguageExtension(filename)),
    });
  }, [filename]);

  // Sync external document load when switching files
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value !== current && value !== externalValueRef.current) {
      externalValueRef.current = value;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    } else if (value !== current) {
      externalValueRef.current = value;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value, filename]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden rounded-b-lg" />;
}
