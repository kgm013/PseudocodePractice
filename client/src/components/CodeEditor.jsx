import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
  highlightWhitespace,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { diagnosticCount, setDiagnostics } from "@codemirror/lint";
import { pseudocodeExtensions, setErrorLine, toEditorDiagnostic } from "../editor/pseudocode.js";

/**
 * The code editor. The parent gets imperative methods through the ref:
 * getValue(), setValue(text), goTo(line, col), showDiagnostics(list),
 * showErrorLine(line | null), focus().
 */
const CodeEditor = forwardRef(function CodeEditor({ level, initialValue, onChange, onRun }, ref) {
  const host = useRef(null);
  const viewRef = useRef(null);
  const callbacks = useRef({ onChange, onRun });
  callbacks.current = { onChange, onRun };

  useEffect(() => {
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightWhitespace(),
          bracketMatching(),
          keymap.of([
            { key: "Mod-Enter", run: () => { callbacks.current.onRun?.(); return true; } },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          pseudocodeExtensions({ level }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            // Problems belong to the code that was run, so editing clears the underlines.
            if (diagnosticCount(u.state) > 0) {
              queueMicrotask(() => viewRef.current?.dispatch(setDiagnostics(viewRef.current.state, [])));
            }
            callbacks.current.onChange?.(u.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ "aria-label": "Pseudocode editor", spellcheck: "false" }),
        ],
      }),
    });
    viewRef.current = view;
    return () => view.destroy();
    // The editor is created once; later changes to initialValue are applied with setValue.
    // Switching level gives the editor a new React key, so it is rebuilt for that level.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    getValue: () => viewRef.current.state.doc.toString(),
    setValue(text) {
      const view = viewRef.current;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    goTo(line, col) {
      const view = viewRef.current;
      const n = Math.min(Math.max(line, 1), view.state.doc.lines);
      const l = view.state.doc.line(n);
      const pos = Math.min(l.from + Math.max((col ?? 1) - 1, 0), l.to);
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      view.focus();
    },
    showDiagnostics(list) {
      const view = viewRef.current;
      view.dispatch(setDiagnostics(view.state, list.map((d) => toEditorDiagnostic(view.state, d))));
    },
    showErrorLine(line) {
      const view = viewRef.current;
      const effects = [setErrorLine.of(line)];
      if (line) {
        const n = Math.min(Math.max(line, 1), view.state.doc.lines);
        effects.push(EditorView.scrollIntoView(view.state.doc.line(n).from, { y: "nearest" }));
      }
      view.dispatch({ effects });
    },
    focus: () => viewRef.current.focus(),
  }));

  return <div className="code-editor" ref={host} />;
});

export default CodeEditor;
