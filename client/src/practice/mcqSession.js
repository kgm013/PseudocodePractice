import { useCallback, useEffect, useReducer } from "react";
import { load, save } from "../storage.js";

// A student's answers for one topic, kept for this browser session (sessionStorage):
// they survive a refresh and switching views, and are cleared when the tab closes.
//
// Per question: { choice, checked, skipped, flagged }
//   choice   the option they picked (or null)
//   checked  the answer has been checked and is locked
//   skipped  they moved on without answering
//   flagged  they marked it "Not sure" to come back to

const VERSION = 1;
// Keyed by topic id ("ol-variables"), so each level keeps its own answers for shared questions.
const keyFor = (topicId) => `pseudo-practice:mcq:${topicId}`;
const EMPTY = { choice: null, checked: false, skipped: false, flagged: false };

/** "unanswered" | "answered" (picked, not checked) | "correct" | "wrong" | "skipped" */
export function statusOf(question, entry) {
  if (entry?.checked) return entry.choice === question.answer ? "correct" : "wrong";
  if (entry?.skipped) return "skipped";
  if (entry?.choice) return "answered";
  return "unanswered";
}

/** Counts for a set of questions. `done` = checked or skipped. */
export function summarise(questions, answers) {
  const counts = { total: questions.length, correct: 0, wrong: 0, skipped: 0, answered: 0, unanswered: 0, flagged: 0 };
  for (const q of questions) {
    counts[statusOf(q, answers[q.id])] += 1;
    if (answers[q.id]?.flagged) counts.flagged += 1;
  }
  counts.checked = counts.correct + counts.wrong;
  counts.done = counts.checked + counts.skipped;
  counts.finished = counts.total > 0 && counts.done === counts.total;
  return counts;
}

function readSession(topicId) {
  const saved = load(keyFor(topicId), null, sessionStorage);
  if (!saved || saved.version !== VERSION || typeof saved.answers !== "object") return { answers: {}, position: null };
  return { answers: saved.answers, position: typeof saved.position === "string" ? saved.position : null };
}

/** Progress for a topic without subscribing to changes (for topic lists). */
export function readTopicSummary(topicId, questions) {
  return summarise(questions, readSession(topicId).answers);
}

function reducer(state, action) {
  const entry = (id) => ({ ...EMPTY, ...state.answers[id] });
  const put = (id, value) => ({ ...state, answers: { ...state.answers, [id]: value } });

  switch (action.type) {
    case "choose": {
      const e = entry(action.id);
      if (e.checked) return state;
      return put(action.id, { ...e, choice: action.choice, skipped: false });
    }
    case "check": {
      const e = entry(action.id);
      if (e.checked || !e.choice) return state;
      return put(action.id, { ...e, checked: true, skipped: false });
    }
    case "checkMany": {
      let next = state;
      for (const id of action.ids) next = reducer(next, { type: "check", id });
      return next;
    }
    case "skip": {
      const e = entry(action.id);
      if (e.checked) return state;
      return put(action.id, { ...e, skipped: true });
    }
    case "flag": {
      const e = entry(action.id);
      return put(action.id, { ...e, flagged: !e.flagged });
    }
    case "retry": {
      // Clear these answers so they can be tried again; keep any "Not sure" marks.
      const answers = { ...state.answers };
      for (const id of action.ids) answers[id] = { ...EMPTY, flagged: Boolean(answers[id]?.flagged) };
      return { ...state, answers };
    }
    case "position":
      return state.position === action.position ? state : { ...state, position: action.position };
    case "reset":
      return { answers: {}, position: null };
    default:
      return state;
  }
}

/** Session state for one topic's multiple choice, saved as it changes. */
export function useMcqSession(topicId) {
  const [state, dispatch] = useReducer(reducer, null, () => readSession(topicId));

  useEffect(() => {
    save(keyFor(topicId), { version: VERSION, ...state }, sessionStorage);
  }, [topicId, state]);

  const actions = {
    choose: useCallback((id, choice) => dispatch({ type: "choose", id, choice }), []),
    check: useCallback((id) => dispatch({ type: "check", id }), []),
    checkMany: useCallback((ids) => dispatch({ type: "checkMany", ids }), []),
    skip: useCallback((id) => dispatch({ type: "skip", id }), []),
    toggleFlag: useCallback((id) => dispatch({ type: "flag", id }), []),
    retry: useCallback((ids) => dispatch({ type: "retry", ids }), []),
    setPosition: useCallback((position) => dispatch({ type: "position", position }), []),
    reset: useCallback(() => dispatch({ type: "reset" }), []),
  };

  return { answers: state.answers, position: state.position, ...actions };
}
