import { useCallback, useEffect, useRef, useState } from "react";
import { compile } from "@shared/interpreter/index.ts";
import CodeEditor from "../components/CodeEditor.jsx";
import ProblemsList from "../components/ProblemsList.jsx";
import ConsolePanel from "../components/ConsolePanel.jsx";
import FilesPanel from "../components/FilesPanel.jsx";
import { usePseudoRunner } from "../interpreter/usePseudoRunner.js";
import { EXAMPLES } from "../examples.js";
import { load, save } from "../storage.js";

// Each level keeps its own code and files.
const STORAGE = {
  O: { code: "pseudo-practice:olevel:code", files: "pseudo-practice:olevel:files" },
  AS: { code: "pseudo-practice:aslevel:code", files: "pseudo-practice:aslevel:files" },
};

// Older versions kept files in localStorage; remove those copies.
try {
  for (const k of Object.values(STORAGE)) localStorage.removeItem(k.files);
} catch {
  // Storage blocked: nothing to clean up.
}

/** The free-form compiler: write any program, run it, see its output. */
export default function CompilerPage({ level }) {
  // A new key gives each level a fresh editor, console and runner.
  return (
    <>
      <h1 className="visually-hidden">Compiler</h1>
      <Playground key={level} level={level} />
    </>
  );
}

function Playground({ level }) {
  const keys = STORAGE[level];
  const examples = EXAMPLES[level];
  const editorRef = useRef(null);
  const [initialCode] = useState(() => load(keys.code, examples[0].code));
  const [diagnostics, setDiagnostics] = useState([]);
  const [files, setFiles] = useState(() => load(keys.files, {}, sessionStorage));
  const [filesSaved, setFilesSaved] = useState(true);
  const [example, setExample] = useState("");
  const saveTimer = useRef(null);

  const runner = usePseudoRunner({
    onFinished(msg) {
      if (msg.files) setFiles(msg.files);
      if (msg.status === "error" && msg.error) editorRef.current?.showErrorLine(msg.error.line);
      if (msg.diagnostics) setDiagnostics(msg.diagnostics);
    },
  });
  const running = runner.status === "running" || runner.status === "input";

  useEffect(() => setFilesSaved(save(keys.files, files, sessionStorage)), [keys.files, files]);

  const handleChange = useCallback((text) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(keys.code, text), 400);
  }, [keys.code]);

  const handleRun = () => {
    if (running) return;
    const editor = editorRef.current;
    const source = editor.getValue();
    editor.showErrorLine(null);
    const result = compile(source, level);
    setDiagnostics(result.diagnostics);
    if (!result.program) {
      const n = result.diagnostics.filter((d) => d.severity === "error").length;
      runner.refuse(`Your code has ${n} error${n === 1 ? "" : "s"}. Fix ${n === 1 ? "it" : "them"} (see Problems) and press Run again.`);
      return;
    }
    runner.run(source, files, level);
  };

  const goTo = (line, col) => editorRef.current?.goTo(line, col);

  const loadExample = (id) => {
    const ex = examples.find((e) => e.id === id);
    setExample("");
    if (!ex) return;
    const current = editorRef.current.getValue();
    const isExample = examples.some((e) => e.code === current);
    if (current.trim() && !isExample && !window.confirm("Replace your code with this example? Your current code will be lost.")) return;
    runner.stop();
    editorRef.current.setValue(ex.code);
    editorRef.current.showErrorLine(null);
    editorRef.current.focus();
  };

  return (
    <div className="workspace">
      <div className="toolbar">
        <label className="example-picker">
          <span className="visually-hidden">Load an example</span>
          <select value={example} onChange={(e) => loadExample(e.target.value)}>
            <option value="">Examples…</option>
            {examples.map((ex) => (
              <option key={ex.id} value={ex.id}>{ex.title}</option>
            ))}
          </select>
        </label>
        <p className="shortcuts">
          <kbd>Tab</kbd> indents · type <code>&lt;-</code> for <code>←</code> · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> runs
        </p>
        {running ? (
          <button type="button" className="run-button stop" onClick={runner.stop}>
            <span aria-hidden="true">■</span> Stop
          </button>
        ) : (
          <button type="button" className="run-button" onClick={handleRun}>
            <span aria-hidden="true">▶</span> Run
          </button>
        )}
      </div>

      <div className="column main-column">
        <div className="editor-card">
          <CodeEditor
            ref={editorRef}
            level={level}
            initialValue={initialCode}
            onChange={handleChange}
            onDiagnostics={setDiagnostics}
            onRun={handleRun}
          />
        </div>
        <ProblemsList diagnostics={diagnostics} onSelect={(d) => goTo(d.line, d.col)} />
      </div>

      <div className="column side-column">
        <ConsolePanel
          status={runner.status}
          entries={runner.entries}
          inputRequest={runner.inputRequest}
          onInput={runner.sendInput}
          onSelectLine={(line) => goTo(line)}
          onClear={runner.clear}
        />
        <FilesPanel files={files} onChange={setFiles} disabled={running} saved={filesSaved} />
      </div>
    </div>
  );
}
