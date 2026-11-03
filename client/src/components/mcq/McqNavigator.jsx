import { statusOf } from "../../practice/mcqSession.js";

const STATUS_WORDS = {
  unanswered: "not answered",
  answered: "answered, not checked",
  correct: "correct",
  wrong: "wrong",
  skipped: "skipped",
};

/** A numbered square per question, showing its status; click one to go to it. */
export default function McqNavigator({ questions, answers, currentId, onGo }) {
  return (
    <nav className="mcq-nav" aria-label="Questions">
      <ol className="mcq-nav-list">
        {questions.map((q, i) => {
          const entry = answers[q.id];
          const status = statusOf(q, entry);
          const label = `Question ${i + 1}: ${STATUS_WORDS[status]}${entry?.flagged ? ", marked not sure" : ""}`;
          return (
            <li key={q.id}>
              <button
                type="button"
                className={`mcq-nav-item is-${status}${entry?.flagged ? " is-flagged" : ""}`}
                aria-label={label}
                title={label}
                aria-current={q.id === currentId ? "step" : undefined}
                onClick={() => onGo(q.id)}
              >
                {i + 1}
              </button>
            </li>
          );
        })}
      </ol>
      <ul className="mcq-legend" aria-hidden="true">
        <li><span className="swatch is-correct" /> Correct</li>
        <li><span className="swatch is-wrong" /> Wrong</li>
        <li><span className="swatch is-skipped" /> Skipped</li>
        <li><span className="swatch is-flagged" /> Not sure</li>
      </ul>
    </nav>
  );
}

/** A bar split into correct / wrong / skipped, with a one-line count. */
export function McqProgress({ counts }) {
  const pct = (n) => `${(n / counts.total) * 100}%`;
  return (
    <div className="mcq-progress">
      <div
        className="mcq-progress-bar"
        role="progressbar"
        aria-label="Questions done"
        aria-valuemin={0}
        aria-valuemax={counts.total}
        aria-valuenow={counts.done}
      >
        <span className="seg is-correct" style={{ width: pct(counts.correct) }} />
        <span className="seg is-wrong" style={{ width: pct(counts.wrong) }} />
        <span className="seg is-skipped" style={{ width: pct(counts.skipped) }} />
      </div>
      <p className="mcq-progress-text">
        <strong>
          {counts.done} of {counts.total}
        </strong>{" "}
        done
        {counts.checked > 0 && (
          <>
            {" · "}
            {counts.correct} correct
          </>
        )}
        {counts.wrong > 0 && <> · {counts.wrong} wrong</>}
        {counts.skipped > 0 && <> · {counts.skipped} skipped</>}
        {counts.flagged > 0 && <> · {counts.flagged} not sure</>}
      </p>
    </div>
  );
}
