import { useEffect, useRef, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs.jsx";
import ModeTabs from "../components/ModeTabs.jsx";
import Segmented from "../components/Segmented.jsx";
import McqQuestion, { FlagIcon } from "../components/mcq/McqQuestion.jsx";
import McqNavigator, { McqProgress } from "../components/mcq/McqNavigator.jsx";
import McqSettings from "../components/mcq/McqSettings.jsx";
import McqSummary from "../components/mcq/McqSummary.jsx";
import McqPanel from "../components/mcq/McqPanel.jsx";
import { levelHref, topicHref } from "../practice/topics.js";
import { getMcqs } from "../practice/mcqs.js";
import { statusOf, summarise, useMcqSession } from "../practice/mcqSession.js";
import { useMcqPrefs } from "../practice/prefs.js";

const VIEW_OPTIONS = [
  { value: "single", label: "One at a time" },
  { value: "list", label: "Several at once" },
];

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const REVIEW_TEXT = {
  todo: (n) => `Showing the ${plural(n, "question")} you haven't answered.`,
  wrong: (n) => `Showing the ${plural(n, "question")} you got wrong.`,
  skipped: (n) => `Showing the ${plural(n, "question")} you skipped.`,
  flagged: (n) => `Showing the ${plural(n, "question")} you marked "Not sure".`,
  retry: (n) => `Trying the ${plural(n, "question")} you got wrong again.`,
};

const REVIEW_PICK = {
  todo: (status) => status === "unanswered" || status === "answered",
  wrong: (status) => status === "wrong",
  skipped: (status) => status === "skipped",
  flagged: (status, entry) => Boolean(entry?.flagged),
};

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A topic's multiple-choice questions, one at a time or several per page. */
export default function McqPage({ entry }) {
  const { level, topic, next } = entry;
  const questions = getMcqs(level.id, topic.id);
  const [prefs, setPrefs] = useMcqPrefs();
  const session = useMcqSession(level.id, topic.id);
  const { answers } = session;

  const [review, setReview] = useState(null); // { kind, ids }: a fixed set to go back over
  const [page, setPage] = useState(0); // "several at once" page
  const [countdown, setCountdown] = useState(null); // { id, ms, key }: auto-advance in progress
  const [settingsOpen, setSettingsOpen] = useState(false);
  const summaryRef = useRef(null);
  const focusTarget = useRef(null); // question id or "summary", focused after the next render

  const base = topicHref(level.id, topic.id);
  const counts = summarise(questions, answers);
  const sequence = review ? questions.filter((q) => review.ids.includes(q.id)) : questions;
  const single = prefs.view === "single";

  // One at a time: which question is showing. Without a saved position, resume at the first one not done.
  const atResults = session.position === "results";
  const current = atResults
    ? null
    : sequence.find((q) => q.id === session.position) ??
      sequence.find((q) => !["correct", "wrong", "skipped"].includes(statusOf(q, answers[q.id]))) ??
      sequence[0] ??
      null;
  const index = current ? sequence.indexOf(current) : -1;

  // Several at once: which questions are on this page.
  const perPage = prefs.perPage || sequence.length || 1;
  const pageCount = Math.max(1, Math.ceil(sequence.length / perPage));
  const safePage = Math.min(page, pageCount - 1);
  const shown = sequence.slice(safePage * perPage, safePage * perPage + perPage);
  // Picked but not checked yet, across the whole topic (what "Check all" checks).
  const pending = questions.filter((q) => statusOf(q, answers[q.id]) === "answered");

  // Move focus (and scroll if needed) after navigation, so keyboard and screen reader users follow along.
  useEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    focusTarget.current = null;
    const el = target === "summary" ? summaryRef.current : document.getElementById(`mcq-${target}`);
    if (!el) return;
    el.focus({ preventScroll: true });
    const box = el.closest("article, section") ?? el;
    const top = box.getBoundingClientRect().top;
    // On narrow screens the progress bar is pinned to the top and covers what's under it.
    const panel = document.querySelector(".mcq-panel");
    const covered = panel && getComputedStyle(panel).position === "sticky" && panel.getBoundingClientRect().top < 40
      ? panel.getBoundingClientRect().bottom
      : 0;
    if (top < covered || top > window.innerHeight * 0.5) box.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  });

  // Auto-advance: wait, then go on. Anything that moves away first cancels it.
  const goNextRef = useRef(null);
  useEffect(() => {
    if (!countdown) return undefined;
    const timer = setTimeout(() => goNextRef.current?.(), countdown.ms);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Remember the question on screen. Otherwise "the first one not done" would move on by itself
  // the moment it is checked, before the student has read the feedback.
  const currentId = current?.id ?? null;
  useEffect(() => {
    if (single && currentId && session.position !== currentId) session.setPosition(currentId);
  }, [single, currentId, session.position, session.setPosition]);

  // Keyboard shortcuts for "one at a time" (the handler is set further down, each render).
  const keysRef = useRef(null);
  useKeyboard(keysRef, single);

  if (questions.length === 0) return <NoMcqs entry={entry} />;

  // ---- Navigation -------------------------------------------------------

  const goTo = (id) => {
    setCountdown(null);
    focusTarget.current = id;
    session.setPosition(id);
  };

  // "One at a time" only: "several at once" shows results in the progress panel.
  const showSummary = () => {
    setCountdown(null);
    focusTarget.current = "summary";
    session.setPosition("results");
  };

  const goNext = () => {
    if (index >= 0 && index < sequence.length - 1) goTo(sequence[index + 1].id);
    else showSummary();
  };
  goNextRef.current = goNext;

  const goPrev = () => {
    if (index > 0) goTo(sequence[index - 1].id);
  };

  const pageOf = (id, list) => Math.max(0, Math.floor(list.findIndex((q) => q.id === id) / perPage));

  const goToQuestion = (id) => {
    let list = sequence;
    if (review && !review.ids.includes(id)) {
      setReview(null);
      list = questions;
    }
    if (single) goTo(id);
    else {
      setPage(pageOf(id, list));
      session.setPosition(id);
      focusTarget.current = id;
    }
  };

  const startReview = (kind, ids) => {
    if (!ids.length) return;
    setReview({ kind, ids });
    setPage(0);
    if (single) goTo(ids[0]);
    else focusTarget.current = ids[0];
  };

  const reviewBy = (kind) =>
    startReview(kind, questions.filter((q) => REVIEW_PICK[kind](statusOf(q, answers[q.id]), answers[q.id])).map((q) => q.id));

  const retryWrong = () => {
    const ids = questions.filter((q) => statusOf(q, answers[q.id]) === "wrong").map((q) => q.id);
    session.retry(ids);
    startReview("retry", ids);
  };

  const endReview = () => {
    const keep = single ? current?.id : shown[0]?.id;
    setReview(null);
    if (!single && keep) setPage(pageOf(keep, questions));
  };

  const clearAnswers = () => {
    if (!window.confirm("Clear all your answers for this topic and start again?")) return;
    session.reset();
    setReview(null);
    setPage(0);
    setCountdown(null);
    setSettingsOpen(false);
    focusTarget.current = questions[0].id;
  };

  const changeView = (view) => {
    setCountdown(null);
    if (view === "list") {
      const anchor = current?.id ?? sequence[0]?.id;
      if (anchor) setPage(pageOf(anchor, sequence));
    } else if (counts.finished) {
      session.setPosition("results");
    } else if (shown[0]) {
      // Pick up where they were: the question they last touched on this page, else its first question.
      const onPage = shown.some((q) => q.id === session.position);
      if (!onPage) session.setPosition(shown[0].id);
    }
    setPrefs({ view });
  };

  const changePrefs = (partial) => {
    if (partial.perPage !== undefined && shown[0]) {
      const first = sequence.indexOf(shown[0]);
      setPage(Math.floor(first / (partial.perPage || sequence.length || 1)));
    }
    if ("autoAdvance" in partial || "delay" in partial || "waitWhenWrong" in partial) setCountdown(null);
    setPrefs(partial);
  };

  // ---- Answering --------------------------------------------------------

  const afterCheck = (q, choice) => {
    if (single && prefs.autoAdvance && (choice === q.answer || !prefs.waitWhenWrong)) {
      setCountdown({ id: q.id, ms: prefs.delay * 1000, key: Date.now() });
    }
  };

  const choose = (q, choice) => {
    session.choose(q.id, choice);
    if (!single) session.setPosition(q.id);
    if (prefs.instantCheck) {
      session.check(q.id);
      afterCheck(q, choice);
    }
  };

  const check = (q) => {
    const choice = answers[q.id]?.choice;
    if (!choice) return;
    session.check(q.id);
    afterCheck(q, choice);
  };

  const skip = (q) => {
    session.skip(q.id);
    if (single) goNext();
  };

  const toggleFlag = (q) => {
    setCountdown(null);
    session.toggleFlag(q.id);
  };

  const checkAll = () => session.checkMany(pending.map((q) => q.id));

  keysRef.current = (e) => {
    if (!single || !current || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    const tag = t.tagName;
    if ((tag === "INPUT" && t.type !== "radio") || tag === "SELECT" || tag === "TEXTAREA" || t.isContentEditable) return;
    const entryNow = answers[current.id];
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const optionIndex = "abcdef".indexOf(key) >= 0 ? "abcdef".indexOf(key) : "123456".indexOf(key);

    if (optionIndex >= 0 && optionIndex < current.options.length && !entryNow?.checked) {
      e.preventDefault();
      choose(current, current.options[optionIndex].id);
    } else if (key === "Enter" && tag !== "BUTTON" && tag !== "A") {
      e.preventDefault();
      if (entryNow?.checked) goNext();
      else if (entryNow?.choice) check(current);
    } else if (key === "s" && !entryNow?.checked) {
      e.preventDefault();
      skip(current);
    } else if (key === "m") {
      e.preventDefault();
      toggleFlag(current);
    } else if (key === "Escape" && countdown) {
      setCountdown(null);
    } else if ((key === "ArrowRight" || key === "ArrowLeft") && t.type !== "radio") {
      e.preventDefault();
      if (key === "ArrowRight") goNext();
      else goPrev();
    }
  };

  // ---- Render ------------------------------------------------------------

  const nextTopic = next && getMcqs(level.id, next.id).length > 0 ? { title: next.title, href: `${topicHref(level.id, next.id)}/mcq` } : null;

  // "One at a time": results replace the question card at the end.
  const summary = (
    <McqSummary
      ref={summaryRef}
      counts={counts}
      onReview={(kind) => (kind === "todo" ? reviewBy("todo") : kind === "wrong" ? retryWrong() : reviewBy(kind))}
      onRestart={clearAnswers}
      onBack={() => goTo((sequence.find((q) => statusOf(q, answers[q.id]) === "unanswered") ?? sequence[0]).id)}
      next={nextTopic}
      writtenHref={`${base}/written`}
    />
  );

  // "One at a time": progress, question numbers and "go back to", above the question.
  const overview = (
    <div className="mcq-overview">
      <McqProgress counts={counts} />
      <McqNavigator questions={questions} answers={answers} currentId={current?.id} onGo={goToQuestion} />
      <ReviewChips counts={counts} onReview={reviewBy} active={review?.kind} />
    </div>
  );

  return (
    <div className={`practice mcq-page${single ? "" : " is-list"}`}>
      <Breadcrumbs
        items={[
          { label: "Home", href: "#/" },
          { label: level.name, href: levelHref(level.id) },
          { label: topic.title, href: base },
          { label: "Multiple choice" },
        ]}
      />
      <header className="practice-intro compact">
        <h1>{topic.title}</h1>
      </header>
      <ModeTabs levelId={level.id} topicId={topic.id} current="mcq" mcqCount={questions.length} />

      <div className="mcq-toolbar">
        <Segmented label="How to show the questions" options={VIEW_OPTIONS} value={prefs.view} onChange={changeView} />
        <button
          type="button"
          className="toolbar-button"
          aria-expanded={settingsOpen}
          aria-controls="mcq-settings"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <GearIcon /> Settings
        </button>
      </div>
      {settingsOpen && <McqSettings id="mcq-settings" prefs={prefs} onChange={changePrefs} onClear={clearAnswers} />}

      {single && overview}

      {review && (
        <div className="review-banner" role="status">
          <span>{REVIEW_TEXT[review.kind](review.ids.length)}</span>
          <button type="button" className="link-button" onClick={endReview}>
            Show all questions
          </button>
        </div>
      )}

      {single ? (
        atResults || !current ? (
          summary
        ) : (
          <SingleQuestion
            key={current.id}
            question={current}
            number={questions.indexOf(current) + 1}
            total={questions.length}
            entry={answers[current.id]}
            isFirst={index <= 0}
            isLast={index === sequence.length - 1}
            prefs={prefs}
            countdown={countdown?.id === current.id ? countdown : null}
            onChoose={(c) => choose(current, c)}
            onCheck={() => check(current)}
            onSkip={() => skip(current)}
            onFlag={() => toggleFlag(current)}
            onNext={goNext}
            onPrev={goPrev}
            onStay={() => setCountdown(null)}
          />
        )
      ) : (
        <div className="mcq-split">
          <McqPanel
            counts={counts}
            questions={questions}
            answers={answers}
            onGo={goToQuestion}
            onPage={new Set(shown.map((q) => q.id))}
            firstOnPage={shown[0]?.id}
            checkAll={{ show: !prefs.instantCheck, pending: pending.length, onClick: checkAll }}
            filters={<ReviewChips counts={counts} onReview={reviewBy} active={review?.kind} />}
            results={{ onRetryWrong: retryWrong, onRestart: clearAnswers, next: nextTopic, writtenHref: `${base}/written` }}
          />
          <div className="mcq-split-main">
            <div className="mcq-list-head">
              <p>
                {sequence.length > perPage
                  ? `Questions ${safePage * perPage + 1}–${safePage * perPage + shown.length} of ${sequence.length}`
                  : `${sequence.length} question${sequence.length === 1 ? "" : "s"}`}
              </p>
            </div>
            <div className="mcq-list">
              {shown.map((q) => {
                const e = answers[q.id];
                return (
                  <McqQuestion
                    key={q.id}
                    question={q}
                    number={questions.indexOf(q) + 1}
                    entry={e}
                    onChoose={(c) => choose(q, c)}
                    actions={
                      <>
                        {!e?.checked && !prefs.instantCheck && (
                          <button type="button" className="button-primary" disabled={!e?.choice} onClick={() => check(q)}>
                            Check
                          </button>
                        )}
                        {!e?.checked && (
                          <button type="button" className="button-quiet" disabled={e?.skipped} onClick={() => skip(q)}>
                            {e?.skipped ? "Skipped" : "Skip"}
                          </button>
                        )}
                        <FlagButton flagged={e?.flagged} onClick={() => toggleFlag(q)} />
                      </>
                    }
                  />
                );
              })}
            </div>
            {pageCount > 1 && (
              <div className="mcq-list-foot">
                <Pagination
                  page={safePage}
                  pageCount={pageCount}
                  onPage={(p) => {
                    setPage(p);
                    focusTarget.current = sequence[p * perPage]?.id;
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function useKeyboard(handlerRef, enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => handlerRef.current?.(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlerRef, enabled]);
}

function SingleQuestion({ question, number, total, entry, isFirst, isLast, prefs, countdown, onChoose, onCheck, onSkip, onFlag, onNext, onPrev, onStay }) {
  const checked = Boolean(entry?.checked);
  return (
    <McqQuestion
      question={question}
      number={number}
      total={total}
      entry={entry}
      onChoose={onChoose}
      actions={
        <>
          <button type="button" className="button-quiet" onClick={onPrev} disabled={isFirst}>
            ← Previous
          </button>
          <span className="mcq-actions-spacer" />
          {!checked && (
            <button type="button" className="button-quiet" onClick={onSkip}>
              Skip
            </button>
          )}
          <FlagButton flagged={entry?.flagged} onClick={onFlag} />
          {checked ? (
            <button type="button" className="button-primary" onClick={onNext}>
              {isLast ? "See results" : "Next question →"}
            </button>
          ) : (
            !prefs.instantCheck && (
              <button type="button" className="button-primary" onClick={onCheck} disabled={!entry?.choice}>
                Check
              </button>
            )
          )}
        </>
      }
      footer={
        <>
          {countdown && (
            <div className="autoadvance" role="status">
              <span>{isLast ? "Results" : "Next question"} in {prefs.delay} seconds</span>
              <span className="autoadvance-bar" aria-hidden="true">
                <span key={countdown.key} style={{ animationDuration: `${countdown.ms}ms` }} />
              </span>
              <button type="button" className="link-button" onClick={onStay}>
                Stay here
              </button>
            </div>
          )}
          <p className="mcq-keys">
            <span>Keys:</span> <kbd>A</kbd>–<kbd>D</kbd> choose · <kbd>Enter</kbd> check / next · <kbd>S</kbd> skip · <kbd>M</kbd> not sure ·{" "}
            <kbd>←</kbd> <kbd>→</kbd> move
          </p>
        </>
      }
    />
  );
}

function FlagButton({ flagged, onClick }) {
  return (
    <button type="button" className={`button-quiet flag-button${flagged ? " is-on" : ""}`} aria-pressed={Boolean(flagged)} onClick={onClick}>
      <FlagIcon /> Not sure
    </button>
  );
}

function ReviewChips({ counts, onReview, active }) {
  const chips = [
    { kind: "todo", label: "Unanswered", n: counts.total - counts.done },
    { kind: "skipped", label: "Skipped", n: counts.skipped },
    { kind: "flagged", label: "Not sure", n: counts.flagged },
    { kind: "wrong", label: "Wrong", n: counts.wrong },
  ].filter((c) => c.n > 0);
  // Only worth showing once something has been answered, skipped or marked.
  if (counts.done === 0 && counts.flagged === 0) return null;
  return (
    <div className="review-chips">
      <span className="review-chips-label">Go back to:</span>
      {chips.map((c) => (
        <button key={c.kind} type="button" className={`review-chip${active === c.kind ? " is-active" : ""}`} onClick={() => onReview(c.kind)}>
          {c.label} <span className="review-chip-count">{c.n}</span>
        </button>
      ))}
    </div>
  );
}

function Pagination({ page, pageCount, onPage }) {
  return (
    <nav className="pagination" aria-label="Pages">
      <button type="button" className="button-quiet" disabled={page === 0} onClick={() => onPage(page - 1)}>
        ← Previous
      </button>
      {Array.from({ length: pageCount }, (_, p) => (
        <button
          key={p}
          type="button"
          className={`page-number${p === page ? " is-current" : ""}`}
          aria-current={p === page ? "page" : undefined}
          aria-label={`Page ${p + 1}`}
          onClick={() => onPage(p)}
        >
          {p + 1}
        </button>
      ))}
      <button type="button" className="button-quiet" disabled={page === pageCount - 1} onClick={() => onPage(page + 1)}>
        Next →
      </button>
    </nav>
  );
}

function NoMcqs({ entry }) {
  const { level, topic } = entry;
  const base = topicHref(level.id, topic.id);
  return (
    <div className="practice">
      <Breadcrumbs
        items={[
          { label: "Home", href: "#/" },
          { label: level.name, href: levelHref(level.id) },
          { label: topic.title, href: base },
          { label: "Multiple choice" },
        ]}
      />
      <header className="practice-intro compact">
        <h1>{topic.title}</h1>
      </header>
      <ModeTabs levelId={level.id} topicId={topic.id} current="mcq" mcqCount={0} />
      <div className="empty-state">
        <h2>No multiple-choice questions yet</h2>
        <p>This topic doesn't have multiple-choice questions. You can practise it with written questions instead.</p>
        <a className="button-secondary" href={`${base}/written`}>
          Go to written questions
        </a>
      </div>
    </div>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path
        d="M10 12.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Zm6.3-1.4.1-1.2-.1-1.2 1.6-1.3-1.6-2.8-2 .7a6.6 6.6 0 0 0-2-1.2L12 2h-4l-.3 2.2a6.6 6.6 0 0 0-2 1.2l-2-.7L2.1 7.5l1.6 1.3-.1 1.2.1 1.2-1.6 1.3 1.6 2.8 2-.7c.6.5 1.3.9 2 1.2L8 18h4l.3-2.2c.7-.3 1.4-.7 2-1.2l2 .7 1.6-2.8-1.6-1.3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
