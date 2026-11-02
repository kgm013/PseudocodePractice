import { useEffect, useRef, useState } from "react";

const STATUS_TEXT = {
  idle: "Press Run to start your program.",
  running: "Running…",
  input: "Waiting for input",
  done: "Finished",
  error: "Stopped with an error",
  stopped: "Stopped",
};

export default function ConsolePanel({ status, entries, inputRequest, onInput, onSelectLine, onClear }) {
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, inputRequest]);

  useEffect(() => {
    if (inputRequest) {
      setValue("");
      inputRef.current?.focus();
    }
  }, [inputRequest]);

  const submit = (e) => {
    e.preventDefault();
    onInput(value);
    setValue("");
  };

  return (
    <section className="panel console" aria-label="Output">
      <div className="panel-header">
        <h2>Output</h2>
        <span className={`run-status ${status}`} role="status">{STATUS_TEXT[status]}</span>
        <button type="button" className="link-button" onClick={onClear} disabled={entries.length === 0}>
          Clear
        </button>
      </div>
      <div className="console-body" ref={bodyRef}>
        {entries.length === 0 && !inputRequest && <p className="console-empty">Your program's output will appear here.</p>}
        {entries.map((e, i) => (
          <div key={i} className={`console-line ${e.kind}`}>
            {e.kind === "in" && <span className="console-prompt" aria-hidden="true">› </span>}
            {(e.kind === "error" || e.kind === "warn") && e.line ? (
              <>
                <button type="button" className="line-link" onClick={() => onSelectLine(e.line)}>
                  Line {e.line}
                </button>
                {": "}
              </>
            ) : null}
            {e.text === "" ? " " : e.text}
          </div>
        ))}
        {inputRequest && (
          <form className="console-input" onSubmit={submit}>
            <span className="console-prompt" aria-hidden="true">›</span>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={`INPUT ${inputRequest.name}`}
              autoComplete="off"
              spellCheck="false"
            />
          </form>
        )}
      </div>
    </section>
  );
}
