import { useCallback, useEffect, useRef, useState } from "react";

const MAX_CONSOLE_ENTRIES = 12_000;

/**
 * Runs programs in a Web Worker and collects what they print.
 *
 * status: "idle" | "running" | "input" | "done" | "error" | "stopped"
 * entries: [{ kind: "out" | "in" | "warn" | "error" | "info", text, line? }]
 */
export function usePseudoRunner({ onFinished } = {}) {
  const [status, setStatus] = useState("idle");
  const [entries, setEntries] = useState([]);
  const [inputRequest, setInputRequest] = useState(null);
  const [runtimeError, setRuntimeError] = useState(null);
  const workerRef = useRef(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const append = useCallback((items) => {
    setEntries((prev) => {
      const next = prev.concat(items);
      return next.length > MAX_CONSOLE_ENTRIES ? next.slice(next.length - MAX_CONSOLE_ENTRIES) : next;
    });
  }, []);

  const kill = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  useEffect(() => kill, [kill]);

  const run = useCallback(
    (source, files, level) => {
      kill();
      setEntries([]);
      setInputRequest(null);
      setRuntimeError(null);
      setStatus("running");

      const worker = new Worker(new URL("./pseudo.worker.js", import.meta.url), { type: "module" });
      workerRef.current = worker;

      worker.onmessage = (event) => {
        if (workerRef.current !== worker) return;
        const msg = event.data;
        switch (msg.type) {
          case "output":
            append(msg.lines.map((text) => ({ kind: "out", text })));
            break;
          case "warning":
            append([{ kind: "warn", text: msg.warning.message, line: msg.warning.line }]);
            break;
          case "input-request":
            setInputRequest(msg.request);
            setStatus("input");
            break;
          case "finished":
            workerRef.current = null;
            worker.terminate();
            setInputRequest(null);
            if (msg.status === "error") {
              setRuntimeError(msg.error);
              append([{ kind: "error", text: msg.error.message, line: msg.error.line }]);
              setStatus("error");
            } else if (msg.status === "compile-error") {
              append([{ kind: "error", text: "Fix the errors in your code before running it." }]);
              setStatus("error");
            } else {
              setStatus("done");
            }
            onFinishedRef.current?.(msg);
            break;
        }
      };
      worker.onerror = (event) => {
        if (workerRef.current !== worker) return;
        event.preventDefault();
        kill();
        append([{ kind: "error", text: `Something went wrong inside the interpreter: ${event.message || "unknown error"}` }]);
        setStatus("error");
      };

      worker.postMessage({ type: "run", source, files, level });
    },
    [append, kill],
  );

  const sendInput = useCallback(
    (value) => {
      if (!workerRef.current) return;
      append([{ kind: "in", text: value }]);
      setInputRequest(null);
      setStatus("running");
      workerRef.current.postMessage({ type: "input", value });
    },
    [append],
  );

  const stop = useCallback(() => {
    if (!workerRef.current) return;
    kill();
    setInputRequest(null);
    append([{ kind: "info", text: "Program stopped." }]);
    setStatus("stopped");
  }, [append, kill]);

  const clear = useCallback(() => {
    setEntries([]);
    setRuntimeError(null);
  }, []);

  /** Shows a message without running anything (for example when the code has errors). */
  const refuse = useCallback((message) => {
    kill();
    setInputRequest(null);
    setRuntimeError(null);
    setEntries([{ kind: "error", text: message }]);
    setStatus("error");
  }, [kill]);

  return { status, entries, inputRequest, runtimeError, run, sendInput, stop, clear, refuse };
}
