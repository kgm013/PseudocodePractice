import Breadcrumbs from "../components/Breadcrumbs.jsx";
import InlineCode from "../components/InlineCode.jsx";
import Segmented from "../components/Segmented.jsx";
import { topicHref } from "../practice/topics.js";
import { getMcqs } from "../practice/mcqs.js";
import { readTopicSummary } from "../practice/mcqSession.js";
import { useQuestionType } from "../practice/prefs.js";

const TYPE_OPTIONS = [
  { value: "mcq", label: "Multiple choice" },
  { value: "written", label: "Written" },
];

/** A level's practice home: choose a question type, then a topic. */
export default function PracticePage({ level }) {
  const [type, setType] = useQuestionType();

  return (
    <div className="practice">
      <Breadcrumbs items={[{ label: "Home", href: "#/" }, { label: level.name }]} />

      <header className="practice-intro">
        <span className="chip">{level.codes}</span>
        <h1>{level.name} Practice</h1>
        <p className="lead">
          Choose multiple choice for quick checks, or written questions to practise writing pseudocode. Then pick a topic.
        </p>
      </header>

      <section aria-labelledby="topics-heading">
        <div className="section-head">
          <h2 id="topics-heading">Topics</h2>
          <Segmented label="Question type" options={TYPE_OPTIONS} value={type} onChange={setType} />
        </div>
        <ol className="topic-list">
          {level.topics.map((topic, i) => (
            <li key={topic.id}>
              <TopicRow level={level} topic={topic} number={i + 1} type={type} />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function TopicRow({ level, topic, number, type }) {
  const mcqs = getMcqs(level.id, topic.id);
  const unavailable = type === "mcq" && mcqs.length === 0;

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
        {type === "written" ? <span className="meta-quiet">Coming soon</span> : <McqMeta level={level} topic={topic} mcqs={mcqs} />}
      </span>
      {!unavailable && (
        <svg className="topic-chevron" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </>
  );

  if (unavailable) {
    return (
      <div className="topic-row is-disabled" aria-disabled="true">
        {body}
      </div>
    );
  }
  return (
    <a className="topic-row" href={`${topicHref(level.id, topic.id)}/${type}`}>
      {body}
    </a>
  );
}

function McqMeta({ level, topic, mcqs }) {
  if (mcqs.length === 0) return <span className="meta-quiet">No multiple choice yet</span>;
  const s = readTopicSummary(level.id, topic.id, mcqs);
  if (s.finished) {
    return (
      <span className="meta-pill is-done">
        <span aria-hidden="true">✓</span> {s.correct}/{s.total} correct
      </span>
    );
  }
  if (s.done > 0) return <span className="meta-pill">{s.done}/{s.total} done</span>;
  return <span className="meta-quiet">{mcqs.length} questions</span>;
}
