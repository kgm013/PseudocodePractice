import { forwardRef } from "react";

export function verdict(counts) {
  if (!counts.finished) return `${counts.total - counts.done} still to do.`;
  if (counts.checked === 0) return "You skipped every question. Try a few when you're ready.";
  const share = counts.correct / counts.total;
  if (share === 1) return "Every answer correct. Well done.";
  if (share >= 0.8) return "Great work. Have a look at the ones you missed.";
  if (share >= 0.5) return "Good effort. Read the explanations for the ones you missed, then try again.";
  return "Worth another go. The explanations show where each answer comes from.";
}

/** Results for the topic, with ways back into the questions that need another look. */
const McqSummary = forwardRef(function McqSummary({ counts, onReview, onRestart, onBack, next, otherHref, otherLabel = "Written questions", verdictFor = verdict, showFlagged = true }, headingRef) {
  const written = counts.progressKind === "solved";
  const remaining = counts.total - (written ? counts.correct : counts.done);
  return (
    <section className="mcq-summary" aria-labelledby="mcq-summary-title">
      <h2 id="mcq-summary-title" ref={headingRef} tabIndex={-1}>
        {counts.finished ? "Results" : "Results so far"}
      </h2>
      <p className="summary-score">
        <span className="summary-big">{counts.correct}</span>
        <span> of {counts.total} {written ? "solved" : "correct"}</span>
      </p>
      <p className="summary-verdict">{verdictFor(counts)}</p>

      <ul className="summary-stats">
        <li className="is-correct">
          <strong>{counts.correct}</strong> {written ? "solved" : "correct"}
        </li>
        <li className="is-wrong">
          <strong>{counts.wrong}</strong> {written ? "not right yet" : "incorrect"}
        </li>
        <li className="is-skipped">
          <strong>{counts.skipped}</strong> skipped
        </li>
        {showFlagged && (
          <li className="is-flagged">
            <strong>{counts.flagged}</strong> not sure
          </li>
        )}
      </ul>

      <div className="summary-actions">
        {remaining > 0 && (
          <button type="button" className="button-primary" onClick={() => onReview("todo")}>
            {written ? `Review ${remaining} not solved` : `Answer the ${remaining} left`}
          </button>
        )}
        {counts.wrong > 0 && (
          <button type="button" className={counts.finished ? "button-primary" : "button-secondary"} onClick={() => onReview("wrong")}>
            Retry the {counts.wrong} wrong
          </button>
        )}
        {counts.skipped > 0 && (
          <button type="button" className="button-secondary" onClick={() => onReview("skipped")}>
            Review skipped ({counts.skipped})
          </button>
        )}
        {counts.flagged > 0 && (
          <button type="button" className="button-secondary" onClick={() => onReview("flagged")}>
            Review not sure ({counts.flagged})
          </button>
        )}
        {onBack && (
          <button type="button" className="button-secondary" onClick={onBack}>
            Back to the questions
          </button>
        )}
        <button type="button" className="link-button" onClick={onRestart}>
          Start again
        </button>
      </div>

      <div className="summary-next">
        {next && (
          <a className="pager-link" href={next.href}>
            <span className="pager-label">Next topic →</span>
            <span className="pager-title">{next.title}</span>
          </a>
        )}
        <a className="pager-link" href={otherHref}>
          <span className="pager-label">Same topic</span>
          <span className="pager-title">{otherLabel}</span>
        </a>
      </div>
    </section>
  );
});

export default McqSummary;
