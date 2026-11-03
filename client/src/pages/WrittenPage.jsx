import { useEffect, useRef, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs.jsx";
import Segmented from "../components/Segmented.jsx";
import McqPanel from "../components/mcq/McqPanel.jsx";
import SingleStepper from "../components/mcq/SingleStepper.jsx";
import McqSummary from "../components/mcq/McqSummary.jsx";
import ReviewChips from "../components/mcq/ReviewChips.jsx";
import WrittenQuestion from "../components/written/WrittenQuestion.jsx";
import RevealDialog from "../components/written/RevealDialog.jsx";
import { countWritten, getWrittenQuestions } from "@shared/practice/bank.ts";
import { levelHref, topicHref } from "../practice/routes.js";
import { summariseWritten, useWrittenProgress, writtenStatus } from "../practice/progressStore.js";
import { useWrittenChecker } from "../practice/useWrittenChecker.js";
import { AUTO_ADVANCE_DELAYS, PER_PAGE_OPTIONS, useWrittenPrefs } from "../practice/prefs.js";
import { TopicPager } from "./TopicPage.jsx";

const VIEW_OPTIONS = [
  { value: "single", label: "One at a time" },
  { value: "list", label: "Several at once" },
];

const REVIEW_TEXT = {
  todo: (n) => `Showing the ${n} question${n === 1 ? "" : "s"} you haven't solved yet.`,
  wrong: (n) => `Showing the ${n} question${n === 1 ? "" : "s"} you haven't got right yet.`,
  skipped: (n) => `Showing the ${n} question${n === 1 ? "" : "s"} you skipped.`,
  flagged: (n) => `Showing the ${n} question${n === 1 ? "" : "s"} you marked "Not sure".`,
};

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function writtenVerdict(counts) {
  if (!counts.finished) return `${counts.total - counts.done} still to solve.`;
  if (counts.correct === counts.total) return "Every question solved. Well done.";
  if (counts.correct === 0) return "You skipped them all. Have a go when you're ready.";
  return `You solved ${counts.correct} and skipped ${counts.skipped}. Come back to the skipped ones when you're ready.`;
}

/** A topic's written questions: write pseudocode, check it, and only learn right or wrong. */
export default function WrittenPage({ entry, onOpenCompiler }) {
  const { level, topic, next } = entry;
  const questions = getWrittenQuestions(topic.id);
  const progress = useWrittenProgress();
  const { entries } = progress;
  const checkAnswer = useWrittenChecker();
  const [prefs, setPrefs] = useWrittenPrefs();

  const [results, setResults] = useState({}); // question id → last check result (this visit only)
  const [checking, setChecking] = useState({}); // question id → true while marking
  const [position, setPosition] = useState(null); // "one at a time": question id, or "results"
  const [page, setPage] = useState(0); // "several at once" page
  const [review, setReview] = useState(null); // { kind, ids }
  const [revealFor, setRevealFor] = useState(null); // question id the reveal dialog is asking about
  const [resetKey, setResetKey] = useState(0); // rebuilds the editors after Reset
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [countdown, setCountdown] = useState(null); // checked question waiting to advance
  const codes = useRef({}); // latest code per question, for "Check all"
  const saveTimers = useRef({});
  const focusTarget = useRef(null);
  const goNextRef = useRef(null);
  const activeQuestionRef = useRef(null);

  const single = prefs.view === "single";
  const base = topicHref(level.id, topic.slug);
  const statusOf = (q, e) => writtenStatus(e, q.starterCode);
  const counts = summariseWritten(questions, entries);
  const sequence = review ? questions.filter((q) => review.ids.includes(q.id)) : questions;
  const perPage = prefs.perPage || sequence.length || 1;
  const pageCount = Math.max(1, Math.ceil(sequence.length / perPage));
  const safePage = Math.min(page, pageCount - 1);
  const shown = sequence.slice(safePage * perPage, safePage * perPage + perPage);
  const atResults = position === "results";
  const current = atResults
    ? null
    : sequence.find((q) => q.id === position) ?? sequence.find((q) => statusOf(q, entries[q.id]) !== "correct") ?? sequence[0] ?? null;
  const index = current ? sequence.indexOf(current) : -1;
  activeQuestionRef.current = single ? current?.id : null;

  // Keep the question on screen in place: "the first unsolved" would otherwise move on by itself.
  useEffect(() => {
    if (single && current && position !== current.id && !atResults) setPosition(current.id);
  }, [single, current, position, atResults]);

  // Move focus after navigating, so keyboard and screen reader users follow along.
  useEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    focusTarget.current = null;
    const el = target === "summary" ? document.getElementById("mcq-summary-title") : document.getElementById(`wq-${target}`);
    if (!el) return;
    el.focus({ preventScroll: true });
    const box = el.closest("article, section") ?? el;
    const panel = document.querySelector(".mcq-panel");
    const covered =
      panel && getComputedStyle(panel).position === "sticky" && panel.getBoundingClientRect().top < 40 ? panel.getBoundingClientRect().bottom : 0;
    const top = box.getBoundingClientRect().top;
    if (top < covered || top > window.innerHeight * 0.5) box.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  });

  useEffect(() => () => Object.values(saveTimers.current).forEach(clearTimeout), []);

  useEffect(() => {
    if (!countdown) return undefined;
    const timer = setTimeout(() => goNextRef.current?.(), countdown.ms);
    return () => clearTimeout(timer);
  }, [countdown]);

  if (questions.length === 0) return <NoWritten entry={entry} onOpenCompiler={onOpenCompiler} />;

  // ---- Answering ------------------------------------------------------------

  const codeChanged = (q, code) => {
    setCountdown(null);
    codes.current[q.id] = code;
    clearTimeout(saveTimers.current[q.id]);
    saveTimers.current[q.id] = setTimeout(() => progress.saveCode(q.id, code, q.version), 400);
  };

  // `countAttempt` is false when the run is only to show the output: looking isn't an attempt.
  const runCheck = async (q, code, countAttempt = true) => {
    setCountdown(null);
    codes.current[q.id] = code;
    clearTimeout(saveTimers.current[q.id]);
    progress.saveCode(q.id, code, q.version);
    setChecking((c) => ({ ...c, [q.id]: true }));
    const result = await checkAnswer(q.id, code, level.interpreterLevel);
    // Empty code or untouched starter code isn't a student's attempt.
    const hasAnswer = code.trim().length > 0 && code.trim() !== (q.starterCode ?? "").trim();
    if (hasAnswer && (countAttempt || result.correct)) progress.recordCheck(q.id, result.correct, q.version);
    setResults((r) => ({ ...r, [q.id]: result }));
    setChecking((c) => ({ ...c, [q.id]: false }));
    if (activeQuestionRef.current === q.id && countAttempt && hasAnswer && result.correct && prefs.autoAdvance) {
      setCountdown({ id: q.id, ms: prefs.delay * 1000, key: Date.now() });
    }
    return result;
  };

  // Code written but not checked yet, across the topic.
  const pending = questions.filter((q) => statusOf(q, entries[q.id]) === "answered");
  const checkAll = async () => {
    for (const q of pending) await runCheck(q, codes.current[q.id] ?? entries[q.id]?.lastCode ?? "");
  };

  const askReveal = (q) => {
    if (entries[q.id]?.revealed) showOutput(q);
    else setRevealFor(q.id);
  };

  const showOutput = (q) => {
    setCountdown(null);
    progress.markRevealed(q.id);
    // The output shown is always for the code as it is now.
    runCheck(q, codes.current[q.id] ?? entries[q.id]?.lastCode ?? "", false);
  };

  // ---- Navigation --------------------------------------------------------------

  const goTo = (id) => {
    setCountdown(null);
    focusTarget.current = id;
    setPosition(id);
  };
  const goNext = () => {
    setCountdown(null);
    if (index >= 0 && index < sequence.length - 1) goTo(sequence[index + 1].id);
    else {
      focusTarget.current = "summary";
      setPosition("results");
    }
  };
  goNextRef.current = goNext;
  const goPrev = () => index > 0 && goTo(sequence[index - 1].id);

  const goToQuestion = (id) => {
    const list = review && !review.ids.includes(id) ? questions : sequence;
    if (list === questions && review) setReview(null);
    if (single) goTo(id);
    else {
      setPage(Math.max(0, Math.floor(list.findIndex((q) => q.id === id) / perPage)));
      focusTarget.current = id;
    }
    if (!single) setPosition(id);
  };

  const reviewBy = (kind) => {
    const pick = {
      todo: (s) => s !== "correct" && s !== "skipped",
      wrong: (s) => s === "wrong",
      skipped: (s) => s === "skipped",
      flagged: (s, e) => Boolean(e?.flagged),
    }[kind];
    if (!pick) return;
    const ids = questions.filter((q) => pick(statusOf(q, entries[q.id]), entries[q.id])).map((q) => q.id);
    if (!ids.length) return;
    setReview({ kind, ids });
    setPage(0);
    goTo(ids[0]);
  };

  const skip = (q) => {
    progress.skip(q.id);
    if (single) goNext();
  };

  const resetTopic = () => {
    if (!window.confirm("Clear your code and progress for every question in this topic?")) return;
    progress.reset(questions.map((q) => q.id));
    codes.current = {};
    setResults({});
    setReview(null);
    setPage(0);
    setCountdown(null);
    setResetKey((k) => k + 1);
    goTo(questions[0].id);
  };

  const hasProgress = questions.some((q) => entries[q.id]);
  const nextTopic = next && countWritten(next.id) > 0 ? { title: next.title, href: `${topicHref(level.id, next.slug)}/written` } : null;
  const other = { otherHref: base, otherLabel: "Topic overview" };

  const card = (q, nav) => (
    <WrittenQuestion
      key={`${q.id}-${resetKey}`}
      question={q}
      number={questions.indexOf(q) + 1}
      total={single ? questions.length : undefined}
      interpreterLevel={level.interpreterLevel}
      entry={entries[q.id]}
      result={results[q.id]}
      checking={Boolean(checking[q.id])}
      countdown={single && countdown?.id === q.id ? countdown : null}
      advanceDelay={prefs.delay}
      onStay={() => setCountdown(null)}
      onCodeChange={(code) => codeChanged(q, code)}
      onCheck={(code) => runCheck(q, code)}
      onSkip={() => skip(q)}
      onFlag={() => { setCountdown(null); progress.toggleFlag(q.id); }}
      onAskReveal={() => askReveal(q)}
      onResetCode={(code) => {
        setCountdown(null);
        codes.current[q.id] = code;
        progress.saveCode(q.id, code, q.version);
      }}
      nav={nav}
    />
  );

  const filters = (
    <ReviewChips
      counts={counts}
      todoLabel="Not solved"
      onReview={reviewBy}
      active={review?.kind}
    />
  );

  const changePrefs = (partial) => {
    setCountdown(null);
    if (partial.perPage !== undefined && shown[0]) {
      const first = sequence.indexOf(shown[0]);
      setPage(Math.floor(first / (partial.perPage || sequence.length || 1)));
    }
    setPrefs(partial);
  };
  const viewSwitch = <Segmented label="How to show the questions" options={VIEW_OPTIONS} value={prefs.view} onChange={(view) => changePrefs({ view })} />;

  const actions = (
    <div className="mcq-toolbar-actions">
      <button type="button" className="toolbar-button is-reset" disabled={!hasProgress} onClick={resetTopic} title={hasProgress ? "Clear your code and progress for this topic" : "Nothing to reset yet"}>
        <ResetIcon /> Reset
      </button>
      <button type="button" className="toolbar-button" aria-expanded={settingsOpen} aria-controls="written-settings" onClick={() => setSettingsOpen((open) => !open)}>
        <GearIcon /> Settings
      </button>
    </div>
  );

  // Both views share the heading and toolbar. Single view keeps progress beside the question.
  return (
    <div className={`practice mcq-page written-page${single ? " is-single" : " is-list"}`}>
      <div className="page-head">
      <Breadcrumbs
        items={[
          { label: "Home", href: "#/" },
          { label: level.name, href: levelHref(level.id) },
          { label: topic.title, href: base },
          { label: "Written" },
        ]}
      />
      <header className="practice-intro compact">
        <h1>{topic.title} <span className="question-mode">Written</span></h1>
      </header>

      <p className="written-intro">
        You can't check your code's output in the exam, so don't practise with it here either.
      </p>

      </div>

      <div className="mcq-toolbar">
        {viewSwitch}
        {actions}
      </div>

      {single && (
        <aside className="page-side" aria-label="Your progress">
          <SingleStepper
            counts={counts}
            questions={questions}
            answers={entries}
            currentId={atResults ? null : current?.id}
            onGo={goToQuestion}
            statusOf={statusOf}
            filters={filters}
            labels={{ correct: "solved", wrong: "not right yet", skipped: "skipped", flagged: "not sure" }}
          />
        </aside>
      )}

      <div className="page-main">
      {settingsOpen && (
        <div className="mcq-settings" id="written-settings">
          {single ? (
            <div className="setting-group">
              <label className="toggle">
                <input type="checkbox" role="switch" checked={prefs.autoAdvance} onChange={(e) => changePrefs({ autoAdvance: e.target.checked })} />
                <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
                <span className="toggle-label">Go to the next question automatically after a correct answer</span>
              </label>
              <label className={`setting-inline${prefs.autoAdvance ? "" : " is-off"}`}>
                <span>Wait</span>
                <select value={prefs.delay} disabled={!prefs.autoAdvance} onChange={(e) => changePrefs({ delay: Number(e.target.value) })}>
                  {AUTO_ADVANCE_DELAYS.map((delay) => <option key={delay} value={delay}>{delay} seconds{delay === 3 ? " (recommended)" : ""}</option>)}
                </select>
                <span>after checking</span>
              </label>
            </div>
          ) : (
            <label className="setting-inline">
              <span>Questions per page</span>
              <select value={prefs.perPage} onChange={(e) => changePrefs({ perPage: Number(e.target.value) })}>
                {PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n === 0 ? "All" : n}</option>)}
              </select>
            </label>
          )}
          <div className="setting-foot"><p>Settings are saved on this device. Your code and progress stay until you press Reset.</p></div>
        </div>
      )}
      {review && (
        <div className="review-banner" role="status">
          <span>{REVIEW_TEXT[review.kind](review.ids.length)}</span>
          <button type="button" className="link-button" onClick={() => setReview(null)}>
            Show all questions
          </button>
        </div>
      )}

      {single ? (
        atResults || !current ? (
          <McqSummary
            counts={counts}
            verdictFor={writtenVerdict}
            onReview={reviewBy}
            onRestart={resetTopic}
            onBack={() => goTo((questions.find((q) => statusOf(q, entries[q.id]) !== "correct") ?? questions[0]).id)}
            next={nextTopic}
            {...other}
          />
        ) : (
          card(current, { onPrev: goPrev, onNext: goNext, isFirst: index <= 0, isLast: index === sequence.length - 1 })
        )
      ) : (
        <div className="mcq-split">
          <McqPanel
            counts={counts}
            questions={questions}
            answers={entries}
            statusOf={statusOf}
            onGo={goToQuestion}
            onPage={new Set(shown.map((q) => q.id))}
            firstOnPage={shown[0]?.id}
            checkAll={{ show: true, pending: pending.length, onClick: checkAll }}
            filters={filters}
            results={{ onRetryWrong: () => reviewBy("wrong"), onRestart: resetTopic, next: nextTopic, verdictFor: writtenVerdict, ...other }}
          />
          <div className="mcq-split-main">
            <div className="mcq-list-head"><p>{sequence.length > perPage ? `Questions ${safePage * perPage + 1}–${safePage * perPage + shown.length} of ${sequence.length}` : `${sequence.length} question${sequence.length === 1 ? "" : "s"}`}</p></div>
            <div className="mcq-list">{shown.map((q) => card(q, null))}</div>
            {pageCount > 1 && (
              <div className="mcq-list-foot">
                <nav className="pagination" aria-label="Pages">
                  <button type="button" className="button-quiet" disabled={safePage === 0} onClick={() => { setPage(safePage - 1); focusTarget.current = sequence[(safePage - 1) * perPage]?.id; }}>← Previous</button>
                  {Array.from({ length: pageCount }, (_, p) => <button key={p} type="button" className={`page-number${p === safePage ? " is-current" : ""}`} aria-current={p === safePage ? "page" : undefined} aria-label={`Page ${p + 1}`} onClick={() => { setPage(p); focusTarget.current = sequence[p * perPage]?.id; }}>{p + 1}</button>)}
                  <button type="button" className="button-quiet" disabled={safePage === pageCount - 1} onClick={() => { setPage(safePage + 1); focusTarget.current = sequence[(safePage + 1) * perPage]?.id; }}>Next →</button>
                </nav>
              </div>
            )}
          </div>
        </div>
      )}

      </div>

      <RevealDialog
        open={revealFor !== null}
        onKeepTrying={() => setRevealFor(null)}
        onReveal={() => {
          const q = questions.find((x) => x.id === revealFor);
          setRevealFor(null);
          if (q) showOutput(q);
        }}
      />
    </div>
  );
}

function NoWritten({ entry, onOpenCompiler }) {
  const { level, topic } = entry;
  return (
    <div className="practice">
      <Breadcrumbs
        items={[
          { label: "Home", href: "#/" },
          { label: level.name, href: levelHref(level.id) },
          { label: topic.title, href: topicHref(level.id, topic.slug) },
          { label: "Written" },
        ]}
      />
      <header className="practice-intro compact">
        <h1>{topic.title}</h1>
      </header>
      <div className="empty-state">
        <svg className="empty-icon" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
          <rect x="8" y="6" width="32" height="36" rx="5" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <path d="M16 17h16M16 24h16M16 31h9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <h2>Written questions coming soon</h2>
        <p>There are no written questions for this topic yet. Until then, you can try ideas out in the compiler.</p>
        <button type="button" className="button-secondary" onClick={() => onOpenCompiler(level.interpreterLevel)}>
          Open the compiler
        </button>
      </div>
      <TopicPager entry={entry} suffix="/written" />
    </div>
  );
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="M4 10a6 6 0 1 0 1.8-4.3M4 3.5v3.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="M10 12.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Zm6.3-1.4.1-1.2-.1-1.2 1.6-1.3-1.6-2.8-2 .7a6.6 6.6 0 0 0-2-1.2L12 2h-4l-.3 2.2a6.6 6.6 0 0 0-2 1.2l-2-.7L2.1 7.5l1.6 1.3-.1 1.2.1 1.2-1.6 1.3 1.6 2.8 2-.7c.6.5 1.3.9 2 1.2L8 18h4l.3-2.2c.7-.3 1.4-.7 2-1.2l2 .7 1.6-2.8-1.6-1.3Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
