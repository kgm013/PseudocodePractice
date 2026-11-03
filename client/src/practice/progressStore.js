import { useCallback, useEffect, useState } from "react";

// Progress on written questions, kept on this device (localStorage) because written
// answers take effort. One entry, versioned, so its shape can change without losing work:
//
//   { version: 1, questions: { "<question id>": {
//       questionVersion, status: "attempted" | "solved", attempts, lastCode,
//       revealed, skipped, solvedAt, updatedAt } } }
//
// Pages use the hook below and never touch localStorage themselves. Later this is the
// one file that changes to save progress to an account instead.

const KEY = "pseudo-practice:progress";
const VERSION = 1;
const MAX_CODE = 100 * 1024;

function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && saved.version === VERSION && saved.questions && typeof saved.questions === "object") return saved;
  } catch {
    // Missing, unreadable or blocked: start fresh.
  }
  return { version: VERSION, questions: {} };
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false; // full or blocked; the page keeps working, progress just isn't saved
  }
}

/** "unanswered" | "answered" (code written, not checked) | "correct" | "wrong" | "skipped" */
export function writtenStatus(entry, starterCode = "") {
  if (entry?.status === "solved") return "correct";
  if (entry?.skipped) return "skipped"; // cleared again by the next check
  if (entry?.attempts > 0) return "wrong";
  if (entry?.lastCode && entry.lastCode.trim() !== starterCode.trim()) return "answered";
  return "unanswered";
}

/** Counts in the same shape as multiple choice, so the shared progress panel works for both. */
export function summariseWritten(questions, entries) {
  const c = { total: questions.length, correct: 0, wrong: 0, skipped: 0, answered: 0, unanswered: 0, flagged: 0 };
  for (const q of questions) c[writtenStatus(entries[q.id], q.starterCode)] += 1;
  c.checked = c.correct + c.wrong;
  c.done = c.correct + c.skipped;
  c.finished = c.total > 0 && c.done === c.total;
  return c;
}

/** Progress for a topic without subscribing to changes (for topic lists). */
export function readWrittenSummary(questions) {
  return summariseWritten(questions, read().questions);
}

/** Progress for written questions, saved as it changes and kept in step across tabs. */
export function useWrittenProgress() {
  const [data, setData] = useState(read);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === KEY) setData(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((id, change) => {
    setData((prev) => {
      const now = new Date().toISOString();
      const before = prev.questions[id] ?? { status: "attempted", attempts: 0, revealed: false };
      const next = { ...prev, questions: { ...prev.questions, [id]: { ...before, ...change(before), updatedAt: now } } };
      write(next);
      return next;
    });
  }, []);

  return {
    entries: data.questions,
    saveCode: useCallback(
      (id, code, questionVersion) => update(id, () => ({ lastCode: code.slice(0, MAX_CODE), questionVersion })),
      [update],
    ),
    recordCheck: useCallback(
      (id, correct, questionVersion) =>
        update(id, (e) => ({
          questionVersion,
          attempts: (e.attempts ?? 0) + 1,
          skipped: false,
          // Solved stays solved, even if a later version of the code is wrong.
          ...(correct || e.status === "solved"
            ? { status: "solved", solvedAt: e.solvedAt ?? new Date().toISOString() }
            : { status: "attempted" }),
        })),
      [update],
    ),
    markRevealed: useCallback((id) => update(id, () => ({ revealed: true })), [update]),
    skip: useCallback((id) => update(id, () => ({ skipped: true })), [update]),
    reset: useCallback((ids) => {
      setData((prev) => {
        const questions = { ...prev.questions };
        for (const id of ids) delete questions[id];
        const next = { ...prev, questions };
        write(next);
        return next;
      });
    }, []),
  };
}
