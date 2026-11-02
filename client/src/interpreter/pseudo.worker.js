// Runs a pseudocode program off the main thread, so a long or endless loop
// never freezes the page. The page can stop it at any time by terminating
// this worker.
//
// Messages in:  { type: "run", source, files, level }   { type: "input", value }
// Messages out: { type: "output", lines }   { type: "warning", warning }
//               { type: "input-request", request }
//               { type: "finished", status, error, files, steps, diagnostics }

import { compile, Runner } from "@shared/interpreter/index.ts";

let runner = null;
let buffer = [];
let lastFlush = 0;

function flush() {
  if (buffer.length) {
    self.postMessage({ type: "output", lines: buffer });
    buffer = [];
  }
  lastFlush = performance.now();
}

function drive(value) {
  const state = runner.resume(value);
  flush();
  if (state.state === "input") {
    self.postMessage({ type: "input-request", request: state.request });
    return;
  }
  self.postMessage({
    type: "finished",
    status: state.state,
    error: state.state === "error" ? state.error : null,
    files: runner.getFiles(),
    steps: runner.steps,
  });
  runner = null;
}

self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "run") {
    const { program, diagnostics } = compile(msg.source, msg.level);
    if (!program) {
      self.postMessage({ type: "finished", status: "compile-error", diagnostics });
      return;
    }
    runner = new Runner(program, {
      files: msg.files,
      onOutput(text) {
        buffer.push(text);
        if (buffer.length >= 200 || performance.now() - lastFlush > 50) flush();
      },
      onWarning(warning) {
        flush();
        self.postMessage({ type: "warning", warning });
      },
    });
    lastFlush = performance.now();
    drive();
  } else if (msg.type === "input" && runner) {
    drive(msg.value);
  }
};
