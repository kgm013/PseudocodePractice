import Breadcrumbs from "../components/Breadcrumbs.jsx";
import InlineCode from "../components/InlineCode.jsx";
import { getMcqs, getTopics, getWrittenQuestions } from "@shared/practice/bank.ts";
import { topicHref } from "../practice/routes.js";
import { readTopicSummary } from "../practice/mcqSession.js";
import { readWrittenSummary } from "../practice/progressStore.js";
/** A level's practice home: choose a topic, then its question type. */
export default function PracticePage({ level }) {
  return (
    <div className="practice">
      <Breadcrumbs items={[{ label: "Home", href: "#/" }, { label: level.name }]} />

      <header className="practice-intro">
        <span className="chip">{level.codes}</span>
        <h1>{level.name} Practice</h1>
        <p className="lead">
          Pick a topic, then choose multiple choice for quick checks or written questions to practise writing pseudocode.
        </p>
      </header>

      <section aria-labelledby="topics-heading">
        <div className="section-head">
          <h2 id="topics-heading">Topics</h2>
        </div>
        <ol className="topic-list">
          {getTopics(level.id).map((topic, i) => (
            <li key={topic.id}>
              <TopicRow level={level} topic={topic} number={i + 1} />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function TopicRow({ level, topic, number }) {
  const mcqs = getMcqs(topic.id);

  const body = (
    <>
      <span className="topic-number" aria-hidden="true">
        {String(number).padStart(2, "0")}
      </span>
      <span className="topic-body">
        <span className="topic-title">{topic.title}</span>
        <span className="topic-summary">
          <InlineCode text={topic.summary} />
        </span>
      </span>
      <span className="topic-meta">
        <McqMeta topic={topic} mcqs={mcqs} />
        <WrittenMeta topic={topic} />
      </span>
      {(
        <svg className="topic-chevron" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </>
  );

  return (
    <a className="topic-row" href={topicHref(level.id, topic.slug)}>
      {body}
    </a>
  );
}

function McqMeta({ topic, mcqs }) {
  if (mcqs.length === 0) return <span className="meta-quiet">No multiple choice yet</span>;
  const s = readTopicSummary(topic.id, mcqs);
  if (s.finished) {
    return (
      <span className="meta-pill is-done">
        <span aria-hidden="true">✓</span> {s.correct}/{s.total} MCQs correct
      </span>
    );
  }
  if (s.done > 0) return <span className="meta-pill">{s.done}/{s.total} MCQs done</span>;
  return <span className="meta-quiet">{mcqs.length} MCQs</span>;
}

function WrittenMeta({ topic }) {
  const questions = getWrittenQuestions(topic.id);
  if (questions.length === 0) return <span className="meta-quiet">Written coming soon</span>;
  const s = readWrittenSummary(questions);
  if (s.correct === s.total) {
    return (
      <span className="meta-pill is-done">
        <span aria-hidden="true">✓</span> {s.correct}/{s.total} written solved
      </span>
    );
  }
  if (s.correct + s.wrong + s.skipped > 0) return <span className="meta-pill">{s.correct}/{s.total} written solved</span>;
  return <span className="meta-quiet">{questions.length} written</span>;
}
