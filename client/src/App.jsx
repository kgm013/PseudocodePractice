import { useCallback, useEffect, useRef, useState } from "react";
import { LEVEL } from "./config.js";
import { compile, LEVEL_NAMES } from "@shared/interpreter/index.ts";
import SiteHeader from "./components/SiteHeader.jsx";
import CodeEditor from "./components/CodeEditor.jsx";
import ProblemsList from "./components/ProblemsList.jsx";
import ConsolePanel from "./components/ConsolePanel.jsx";
import FilesPanel from "./components/FilesPanel.jsx";
import { usePseudoRunner } from "./interpreter/usePseudoRunner.js";
import { EXAMPLES } from "./examples.js";

const LEVEL_KEY = "pseudo-practice:level";
const DEFAULT_LEVEL = LEVEL === "AS Levels" ? "AS" : "O";

// Each level keeps its own code and files.
const STORAGE = {
  O: { code: "pseudo-practice:olevel:code", files: "pseudo-practice:olevel:files" },
  AS: { code: "pseudo-practice:aslevel:code", files: "pseudo-practice:aslevel:files" },
};

// Code and settings are kept between visits (localStorage). Files are only kept for
// this browser session (sessionStorage): they survive a refresh but are cleared when
// the tab is closed. Students download a file to keep it.
function load(key, fallback, store = localStorage) {
  try {
    const v = store.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

/** Returns false when the browser refused to save (storage full or blocked). */
function save(key, value, store = localStorage) {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// Older versions kept files in localStorage; remove those copies.
try {
  for (const k of Object.values(STORAGE)) localStorage.removeItem(k.files);
} catch {
  // Storage blocked: nothing to clean up.
}

const THEME_KEY = "pseudo-practice:theme";

// index.html has already set data-theme (saved choice, else the system setting).
function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    save(THEME_KEY, next);
    setTheme(next);
  };
  return [theme, toggle];
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [level, setLevel] = useState(() => {
    const saved = load(LEVEL_KEY, DEFAULT_LEVEL);
    return saved === "O" || saved === "AS" ? saved : DEFAULT_LEVEL;
  });

  useEffect(() => {
    document.title = `Pseudocode Practice | ${LEVEL_NAMES[level]}`;
    save(LEVEL_KEY, level);
  }, [level]);

  return (
    <main className="page">
      <SiteHeader theme={theme} onToggleTheme={toggleTheme}>
        <LevelSwitch level={level} onChange={setLevel} />
      </SiteHeader>
      {/* A new key gives each level a fresh editor, console and runner. */}
      <Playground key={level} level={level} />
    </main>
  );
}

function LevelSwitch({ level, onChange }) {
  const options = [
    { id: "O", label: "O Level / IGCSE", detail: "2210 · 0478" },
    { id: "AS", label: "AS Level", detail: "9618" },
  ];
  const onKeyDown = (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onChange(level === "O" ? "AS" : "O");
    }
  };
  return (
    <div className="level-switch" role="radiogroup" aria-label="Pseudocode level" onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={level === o.id}
          tabIndex={level === o.id ? 0 : -1}
          className={level === o.id ? "active" : ""}
          onClick={() => onChange(o.id)}
        >
          {o.label} <span className="level-code">{o.detail}</span>
        </button>
      ))}
    </div>
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
    // Problems describe the code that was run, so editing clears them.
    setDiagnostics((d) => (d.length ? [] : d));
  }, [keys.code]);

  const handleRun = () => {
    if (running) return;
    const editor = editorRef.current;
    const source = editor.getValue();
    editor.showErrorLine(null);
    const result = compile(source, level);
    setDiagnostics(result.diagnostics);
    editor.showDiagnostics(result.diagnostics);
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
