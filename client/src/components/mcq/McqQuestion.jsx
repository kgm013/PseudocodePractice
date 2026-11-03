import { forwardRef } from "react";
import InlineCode from "../InlineCode.jsx";
import { statusOf } from "../../practice/mcqSession.js";

export const letterFor = (i) => String.fromCharCode(65 + i);

/**
 * One multiple-choice question: prompt, optional code, options and, once checked, feedback.
 * The buttons underneath differ between views, so the parent passes them as `actions`.
 * The ref points at the heading, so the page can move focus to a new question.
 */
const McqQuestion = forwardRef(function McqQuestion({ question, number, total, entry, onChoose, actions, footer }, headingRef) {
  const status = statusOf(question, entry);
  const checked = Boolean(entry?.checked);
  const choice = entry?.choice ?? null;
  const headingId = `mcq-${question.id}`;
  const answerIndex = question.options.findIndex((o) => o.id === question.answer);

  return (
    <article className={`mcq is-${status}`} aria-labelledby={headingId} data-question={question.id}>
      <div className="mcq-head">
        <span className="mcq-number">
          Question {number}
          {total ? ` of ${total}` : ""}
        </span>
        <span className="mcq-badges">
          {status === "skipped" && <span className="badge badge-skipped">Skipped</span>}
          {entry?.flagged && (
            <span className="badge badge-flagged">
              <FlagIcon /> Not sure
            </span>
          )}
        </span>
      </div>

      <h2 className="mcq-prompt" id={headingId} ref={headingRef} tabIndex={-1}>
        <InlineCode text={question.prompt} />
      </h2>
      {question.code && (
        <pre className="mcq-code">
          <code>{question.code}</code>
        </pre>
      )}

      <fieldset className="mcq-options" disabled={checked}>
        <legend className="visually-hidden">Answers for question {number}</legend>
        {question.options.map((o, i) => {
          const isChoice = choice === o.id;
          const isAnswer = checked && o.id === question.answer;
          const isWrongChoice = checked && isChoice && !isAnswer;
          const cls = ["mcq-option", isChoice && "is-selected", isAnswer && "is-answer", isWrongChoice && "is-wrong"].filter(Boolean).join(" ");
          return (
            <label key={o.id} className={cls}>
              <input
                type="radio"
                name={`answer-${question.id}`}
                value={o.id}
                checked={isChoice}
                onChange={() => onChoose(o.id)}
              />
              <span className="mcq-letter" aria-hidden="true">
                {isAnswer ? "✓" : isWrongChoice ? "✗" : letterFor(i)}
              </span>
              <span className="mcq-option-text">
                <span className="visually-hidden">{letterFor(i)}. </span>
                <InlineCode text={o.text} />
              </span>
              {isAnswer && <span className="mcq-tag is-ok">{isChoice ? "Your answer" : "Correct answer"}</span>}
              {isWrongChoice && <span className="mcq-tag is-bad">Your answer</span>}
            </label>
          );
        })}
      </fieldset>

      <div className="mcq-feedback-slot" aria-live="polite">
        {checked && (
          <div className={`mcq-feedback ${status === "correct" ? "is-ok" : "is-bad"}`}>
            <p className="mcq-feedback-title">
              {status === "correct" ? "Correct." : `Not quite. The answer is ${letterFor(answerIndex)}.`}
            </p>
            <p className="mcq-feedback-text">
              <InlineCode text={question.explanation} />
            </p>
          </div>
        )}
      </div>

      {actions && <div className="mcq-actions">{actions}</div>}
      {footer}
    </article>
  );
});

export default McqQuestion;

export function FlagIcon() {
  return (
    <svg className="flag-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M3.5 14V2.5M3.5 3h8l-1.8 3 1.8 3h-8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
