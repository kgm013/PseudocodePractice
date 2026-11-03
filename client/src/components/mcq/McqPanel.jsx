import { useEffect, useRef, useState } from "react";
import McqNavigator, { McqLegend, McqProgress } from "./McqNavigator.jsx";
import { verdict } from "./McqSummary.jsx";
import { progressInfo } from "@shared/practice/presentation.ts";

/**
 * "Several at once": everything about your progress in one place.
 *
 * Wide screens: a column on the right that follows you down the page.
 * Narrower screens and phones: a compact bar pinned to the top (progress, question numbers
 * that scroll sideways, Check all), with the filters and results one tap away.
 * When every question is done, the results appear here (and the bar opens by itself).
 */
export default function McqPanel({ counts, questions, answers, onGo, onPage, firstOnPage, checkAll, filters, results, statusOf }) {
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef(null);

  // Finishing is the moment the results matter, so open the bar to show them.
  const wasFinished = useRef(counts.finished);
  useEffect(() => {
    if (counts.finished && !wasFinished.current) setExpanded(true);
    wasFinished.current = counts.finished;
  }, [counts.finished]);

  // Keep the current page's numbers in view when the row of numbers scrolls sideways.
  useEffect(() => {
    const list = listRef.current;
    const item = firstOnPage && list?.querySelector(`[data-question="${firstOnPage}"]`);
    if (!list || !item || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = Math.max(0, item.parentElement.offsetLeft - list.offsetLeft - 8);
  }, [firstOnPage]);

  const showCheckAll = checkAll.show && !counts.finished;
  const { value, label } = progressInfo(counts);

  return (
    <aside className={`mcq-panel${expanded ? " is-expanded" : ""}${counts.finished ? " is-finished" : ""}`} aria-label="Progress">
      <div className="mcq-panel-bar">
        <p className="mcq-panel-short">
          <strong>{value}/{counts.total}</strong> {label}
        </p>
        <McqProgress counts={counts} />
        <McqNavigator questions={questions} answers={answers} onGo={onGo} onPage={onPage} legend={false} listRef={listRef} statusOf={statusOf} />
        {showCheckAll && (
          <button type="button" className="button-primary mcq-panel-check" disabled={checkAll.pending === 0} onClick={checkAll.onClick}>
            Check all{checkAll.pending ? ` (${checkAll.pending})` : ""}
          </button>
        )}
        <button
          type="button"
          className="mcq-panel-toggle"
          aria-expanded={expanded}
          aria-controls="mcq-panel-body"
          onClick={() => setExpanded((open) => !open)}
        >
          <span className="visually-hidden">{expanded ? "Hide details" : counts.finished ? "Show results" : "Show details"}</span>
          {counts.finished && !expanded && <span className="mcq-panel-toggle-label" aria-hidden="true">Results</span>}
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="mcq-panel-body" id="mcq-panel-body">
        {counts.finished && <PanelResults counts={counts} {...results} />}
        <McqLegend written={counts.progressKind === "solved"} />
        {filters}
      </div>

      <p className="visually-hidden" role="status">
        {counts.finished ? `Results: ${counts.correct} of ${counts.total} ${label === "solved" ? "solved" : "correct"}.` : ""}
      </p>
    </aside>
  );
}

function PanelResults({ counts, onRetryWrong, onRestart, next, otherHref, otherLabel = "Written questions", verdictFor = verdict }) {
  const written = counts.progressKind === "solved";
  return (
    <section className="mcq-panel-results" aria-labelledby="mcq-panel-results-title">
      <h2 id="mcq-panel-results-title">Results</h2>
      <p className="summary-score">
        <span className="summary-big">{counts.correct}</span>
        <span> of {counts.total} {written ? "solved" : "correct"}</span>
      </p>
      <p className="summary-verdict">{verdictFor(counts)}</p>
      <div className="mcq-panel-results-actions">
        {counts.wrong > 0 && (
          <button type="button" className="button-primary" onClick={onRetryWrong}>
            Retry the {counts.wrong} wrong
          </button>
        )}
        <button type="button" className="button-secondary" onClick={onRestart}>
          Start again
        </button>
      </div>
      <div className="mcq-panel-results-next">
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
}
