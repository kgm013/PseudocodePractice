import { useEffect, useRef, useState } from "react";
import Breadcrumbs from "../components/Breadcrumbs.jsx";
import ModeTabs from "../components/ModeTabs.jsx";
import Segmented from "../components/Segmented.jsx";
import McqPanel from "../components/mcq/McqPanel.jsx";
import SingleStepper from "../components/mcq/SingleStepper.jsx";
import McqSummary from "../components/mcq/McqSummary.jsx";
import ReviewChips from "../components/mcq/ReviewChips.jsx";
import WrittenQuestion from "../components/written/WrittenQuestion.jsx";
import RevealDialog from "../components/written/RevealDialog.jsx";
import { countMcqs, countWritten, getWrittenQuestions } from "@shared/practice/bank.ts";
import { levelHref, topicHref } from "../practice/routes.js";
import { summariseWritten, useWrittenProgress, writtenStatus } from "../practice/progressStore.js";
import { useWrittenChecker } from "../practice/useWrittenChecker.js";
import { useWrittenPrefs } from "../practice/prefs.js";
import { TopicPager } from "./TopicPage.jsx";

const VIEW_OPTIONS = [
  { value: "single", label: "One at a time" },
  { value: "list", label: "Several at once" },
];

const REVIEW_TEXT = {
  todo: (n) => `Showing the ${n} question${n === 1 ? "" : "s"} you haven't solved yet.`,
  wrong: (n) => `Showing the ${n} question${n === 1 ? "" : "s"} you haven't got right yet.`,
  skipped: (n) => `Showing the ${n} question${n === 1 ? "" : "s"} you skipped.`,
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
  const [review, setReview] = useState(null); // { kind, ids }
  const [revealFor, setRevealFor] = useState(null); // question id the reveal dialog is asking about
  const [resetKey, setResetKey] = useState(0); // rebuilds the editors after Reset
  const codes = useRef({}); // latest code per question, for "Check all"
  const saveTimers = useRef({});
  const focusTarget = useRef(null);

  const single = prefs.view === "single";
  const base = topicHref(level.id, topic.slug);
  const statusOf = (q, e) => writtenStatus(e, q.starterCode);
  const counts = summariseWritten(questions, entries);
  const sequence = review ? questions.filter((q) => review.ids.includes(q.id)) : questions;
  const atResults = position === "results";
  const current = atResults
    ? null
    : sequence.find((q) => q.id === position) ?? sequence.find((q) => statusOf(q, entries[q.id]) !== "correct") ?? sequence[0] ?? null;
  const index = current ? sequence.indexOf(current) : -1;

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

  if (questions.length === 0) return <NoWritten entry={entry} onOpenCompiler={onOpenCompiler} />;

  // ---- Answering ------------------------------------------------------------

  const codeChanged = (q, code) => {
    codes.current[q.id] = code;
    clearTimeout(saveTimers.current[q.id]);
    saveTimers.current[q.id] = setTimeout(() => progress.saveCode(q.id, code, q.version), 400);
  };

  // `countAttempt` is false when the run is only to show the output: looking isn't an attempt.
  const runCheck = async (q, code, countAttempt = true) => {
    codes.current[q.id] = code;
    clearTimeout(saveTimers.current[q.id]);
    progress.saveCode(q.id, code, q.version);
    setChecking((c) => ({ ...c, [q.id]: true }));
    const result = await checkAnswer(q.id, code, level.interpreterLevel);
    if (countAttempt || result.correct) progress.recordCheck(q.id, result.correct, q.version);
    setResults((r) => ({ ...r, [q.id]: result }));
    setChecking((c) => ({ ...c, [q.id]: false }));
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
    progress.markRevealed(q.id);
    // The output shown is always for the code as it is now.
    runCheck(q, codes.current[q.id] ?? entries[q.id]?.lastCode ?? "", false);
  };

  // ---- Navigation --------------------------------------------------------------

  const goTo = (id) => {
    focusTarget.current = id;
    setPosition(id);
  };
  const goNext = () => {
    if (index >= 0 && index < sequence.length - 1) goTo(sequence[index + 1].id);
    else {
      focusTarget.current = "summary";
      setPosition("results");
    }
  };
  const goPrev = () => index > 0 && goTo(sequence[index - 1].id);

  const goToQuestion = (id) => {
    if (review && !review.ids.includes(id)) setReview(null);
    if (single) goTo(id);
    else focusTarget.current = id;
    if (!single) setPosition(id);
  };

  const reviewBy = (kind) => {
    const pick = {
      todo: (s) => s !== "correct" && s !== "skipped",
      wrong: (s) => s === "wrong",
      skipped: (s) => s === "skipped",
    }[kind];
    if (!pick) return;
    const ids = questions.filter((q) => pick(statusOf(q, entries[q.id]))).map((q) => q.id);
    if (!ids.length) return;
    setReview({ kind, ids });
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
    setResetKey((k) => k + 1);
    goTo(questions[0].id);
  };

  const hasProgress = questions.some((q) => entries[q.id]);
  const nextTopic = next && countWritten(next.id) > 0 ? { title: next.title, href: `${topicHref(level.id, next.slug)}/written` } : null;
  const mcqCount = countMcqs(topic.id);
  const other = mcqCount > 0 ? { otherHref: `${base}/mcq`, otherLabel: "Multiple choice" } : { otherHref: base, otherLabel: "Topic overview" };

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
      onCodeChange={(code) => codeChanged(q, code)}
      onCheck={(code) => runCheck(q, code)}
      onSkip={() => skip(q)}
      onAskReveal={() => askReveal(q)}
      onResetCode={(code) => {
        codes.current[q.id] = code;
        progress.saveCode(q.id, code, q.version);
      }}
      nav={nav}
    />
  );

  const filters = (
    <ReviewChips
      counts={{ ...counts, flagged: 0 }}
      todoLabel="Not solved"
      onReview={reviewBy}
      active={review?.kind}
    />
  );

  return (
    <div className={`practice mcq-page written-page${single ? " is-single" : " is-list"}`}>
      <Breadcrumbs
        items={[
          { label: "Home", href: "#/" },
          { label: level.name, href: levelHref(level.id) },
          { label: topic.title, href: base },
          { label: "Written" },
        ]}
      />
      <header className="practice-intro compact">
        <h1>{topic.title}</h1>
      </header>
      <ModeTabs levelId={level.id} topicSlug={topic.slug} current="written" mcqCount={mcqCount} writtenCount={questions.length} />

      <p className="written-intro">
        Write your answer, then check it. You'll only find out whether it's right, just like in the exam, where you can't
        run your code.
      </p>

      <div className="mcq-toolbar">
        <Segmented label="How to show the questions" options={VIEW_OPTIONS} value={prefs.view} onChange={(view) => setPrefs({ view })} />
        <div className="mcq-toolbar-actions">
          <button type="button" className="toolbar-button is-reset" disabled={!hasProgress} onClick={resetTopic} title={hasProgress ? "Clear your code and progress for this topic" : "Nothing to reset yet"}>
            <ResetIcon /> Reset
          </button>
        </div>
      </div>

      {single && (
        <SingleStepper
          counts={counts}
          questions={questions}
          answers={entries}
          currentId={atResults ? null : current?.id}
          onGo={goToQuestion}
          statusOf={statusOf}
          filters={filters}
          labels={{ correct: "solved", wrong: "not right yet", skipped: "skipped", flagged: "" }}
        />
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
            showFlagged={false}
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
            onPage={new Set(sequence.map((q) => q.id))}
            firstOnPage={sequence[0]?.id}
            checkAll={{ show: true, pending: pending.length, onClick: checkAll }}
            filters={filters}
            results={{ onRetryWrong: () => reviewBy("wrong"), onRestart: resetTopic, next: nextTopic, verdictFor: writtenVerdict, ...other }}
          />
          <div className="mcq-split-main">
            <div className="mcq-list">{sequence.map((q) => card(q, null))}</div>
          </div>
        </div>
      )}

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
      <ModeTabs levelId={level.id} topicSlug={topic.slug} current="written" mcqCount={countMcqs(topic.id)} writtenCount={0} />
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
