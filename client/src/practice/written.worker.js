// Marks written answers off the main thread, so a slow or endless program never freezes
// the page. The page can stop it at any time by terminating the worker.
//
// In:  { requestId, questionId, code, level }
// Out: { requestId, result } or { requestId, error }

import { checkWrittenAnswer } from "@shared/practice/bank.ts";

self.onmessage = (event) => {
  const { requestId, questionId, code, level } = event.data;
  try {
    self.postMessage({ requestId, result: checkWrittenAnswer(questionId, code, level) });
  } catch (err) {
    self.postMessage({ requestId, error: String(err?.message ?? err) });
  }
};
