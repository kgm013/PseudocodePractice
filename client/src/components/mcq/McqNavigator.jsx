import { statusOf as mcqStatusOf } from "../../practice/mcqSession.js";
import { progressInfo } from "@shared/practice/presentation.ts";

const STATUS_WORDS = {
  unanswered: "not answered",
  answered: "answered, not checked",
  correct: "correct",
  wrong: "wrong",
  skipped: "skipped",
};

/**
 * A numbered square per question, showing its status; click one to go to it.
 * `onPage` (a Set of ids) underlines the questions showing on the current page.
 */
export default function McqNavigator({ questions, answers, currentId, onGo, onPage, legend = true, listRef, statusOf = mcqStatusOf }) {
  return (
    <nav className="mcq-nav" aria-label="Questions">
      <ol className="mcq-nav-list" ref={listRef}>
        {questions.map((q, i) => {
          const entry = answers[q.id];
          const status = statusOf(q, entry);
          const label = `Question ${i + 1}: ${STATUS_WORDS[status]}${entry?.flagged ? ", marked not sure" : ""}`;
          return (
            <li key={q.id}>
              <button
                type="button"
                className={`mcq-nav-item is-${status}${entry?.flagged ? " is-flagged" : ""}${onPage?.has(q.id) ? " is-onpage" : ""}`}
                aria-label={label}
                title={label}
                aria-current={q.id === currentId ? "step" : undefined}
                data-question={q.id}
                onClick={() => onGo(q.id)}
              >
                {i + 1}
              </button>
            </li>
          );
        })}
      </ol>
      {legend && <McqLegend />}
    </nav>
  );
}

/** What the colours on the question numbers mean. */
export function McqLegend({ flagged = true, written = false }) {
  return (
    <ul className="mcq-legend" aria-hidden="true">
      <li><span className="swatch is-correct" /> {written ? "Solved" : "Correct"}</li>
      <li><span className="swatch is-wrong" /> {written ? "Not right yet" : "Incorrect"}</li>
      <li><span className="swatch is-skipped" /> Skipped</li>
      {flagged && <li><span className="swatch is-flagged" /> Not sure</li>}
    </ul>
  );
}

/** A bar split into correct / wrong / skipped, with a one-line count. */
export function McqProgress({ counts }) {
  const { value, label, written } = progressInfo(counts);
  const pct = (n) => `${counts.total ? (n / counts.total) * 100 : 0}%`;
  return (
    <div className="mcq-progress">
      <div
        className="mcq-progress-bar"
        role="progressbar"
        aria-label={`Questions ${label}`}
        aria-valuemin={0}
        aria-valuemax={counts.total}
        aria-valuenow={value}
      >
        <span className="seg is-correct" style={{ width: pct(counts.correct) }} />
        {!written && <span className="seg is-wrong" style={{ width: pct(counts.wrong) }} />}
      </div>
      <p className="mcq-progress-text">
        <strong>
          {value} of {counts.total}
        </strong>{" "}
        {label}
        {!written && counts.checked > 0 && (
          <>
            {" · "}
            {counts.correct} correct
          </>
        )}
        {counts.wrong > 0 && <> · {counts.wrong} {written ? "not right yet" : "incorrect"}</>}
        {counts.skipped > 0 && <> · {counts.skipped} skipped</>}
        {counts.flagged > 0 && <> · {counts.flagged} not sure</>}
      </p>
    </div>
  );
}
