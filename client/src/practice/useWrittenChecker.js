import { useCallback, useEffect, useRef } from "react";

const TIME_LIMIT_MS = 8000;

// What a check that ran out of time looks like: simply not correct.
const timedOut = () => ({ correct: false, timedOut: true, compileErrors: [], ruleFailures: [], runs: [] });

/**
 * check(questionId, code, level) → Promise<result>, marked in a Web Worker.
 * Checks queue up in one worker; if one takes too long, the worker is replaced and
 * everything still waiting counts as "not correct".
 */
export function useWrittenChecker() {
  const workerRef = useRef(null);
  const pending = useRef(new Map()); // requestId → { resolve, timer }
  const nextId = useRef(1);

  const stop = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    for (const { resolve, timer } of pending.current.values()) {
      clearTimeout(timer);
      resolve(timedOut());
    }
    pending.current.clear();
  }, []);

  const worker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const w = new Worker(new URL("./written.worker.js", import.meta.url), { type: "module" });
    w.onmessage = (event) => {
      const { requestId, result, error } = event.data;
      const waiting = pending.current.get(requestId);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      pending.current.delete(requestId);
      waiting.resolve(error ? { ...timedOut(), timedOut: false, failed: error } : result);
    };
    workerRef.current = w;
    return w;
  }, []);

  useEffect(() => stop, [stop]);

  return useCallback(
    (questionId, code, level) =>
      new Promise((resolve) => {
        const requestId = nextId.current++;
        const timer = setTimeout(stop, TIME_LIMIT_MS);
        pending.current.set(requestId, { resolve, timer });
        worker().postMessage({ requestId, questionId, code, level });
      }),
    [stop, worker],
  );
}
