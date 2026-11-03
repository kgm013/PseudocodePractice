import { useCallback, useState } from "react";
import { load, save } from "../storage.js";

// Preferences are remembered between visits (localStorage). Answers are not: see mcqSession.js.

const MCQ_PREFS_KEY = "pseudo-practice:mcq-prefs";
const QUESTION_TYPE_KEY = "pseudo-practice:question-type";

export const AUTO_ADVANCE_DELAYS = [1.5, 2, 3, 5, 8];
export const PER_PAGE_OPTIONS = [3, 5, 10, 20, 0]; // 0 = all

// 3 seconds is enough to read a short "Correct" message and its explanation.
// After a wrong answer we wait for the student by default, so they can read why.
const DEFAULT_MCQ_PREFS = {
  view: "single", // "single" (one at a time) | "list"
  instantCheck: false,
  autoAdvance: false,
  delay: 3,
  waitWhenWrong: true,
  perPage: 5,
};

function cleanPrefs(saved) {
  const p = { ...DEFAULT_MCQ_PREFS, ...(saved && typeof saved === "object" ? saved : {}) };
  if (p.view !== "single" && p.view !== "list") p.view = DEFAULT_MCQ_PREFS.view;
  if (!AUTO_ADVANCE_DELAYS.includes(p.delay)) p.delay = DEFAULT_MCQ_PREFS.delay;
  if (!PER_PAGE_OPTIONS.includes(p.perPage)) p.perPage = DEFAULT_MCQ_PREFS.perPage;
  for (const k of ["instantCheck", "autoAdvance", "waitWhenWrong"]) p[k] = Boolean(p[k]);
  return p;
}

/** Multiple-choice settings: [prefs, update(partial)]. */
export function useMcqPrefs() {
  const [prefs, setPrefs] = useState(() => cleanPrefs(load(MCQ_PREFS_KEY, null)));
  const update = useCallback((partial) => {
    setPrefs((prev) => {
      const next = cleanPrefs({ ...prev, ...partial });
      save(MCQ_PREFS_KEY, next);
      return next;
    });
  }, []);
  return [prefs, update];
}

/** Which kind of question the topic list links to: "mcq" or "written". */
export function useQuestionType() {
  const [type, setType] = useState(() => (load(QUESTION_TYPE_KEY, "mcq") === "written" ? "written" : "mcq"));
  const update = useCallback((next) => {
    setType(next);
    save(QUESTION_TYPE_KEY, next);
  }, []);
  return [type, update];
}
