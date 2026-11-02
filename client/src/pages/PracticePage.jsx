import Breadcrumbs from "../components/Breadcrumbs.jsx";
import InlineCode from "../components/InlineCode.jsx";
import { topicHref } from "../practice/topics.js";

/** A level's practice home: the list of topics, in teaching order. */
export default function PracticePage({ level }) {
  return (
    <div className="practice">
      <Breadcrumbs items={[{ label: "Home", href: "#/" }, { label: level.name }]} />

      <header className="practice-intro">
        <span className="chip">{level.codes}</span>
        <h1>{level.name} Practice</h1>
        <p className="lead">
          Pick a topic. Each one has questions you answer by writing pseudocode, then checking whether it's right.
        </p>
      </header>

      <section aria-labelledby="topics-heading">
        <div className="section-head">
          <h2 id="topics-heading">Topics</h2>
          <span className="section-count">{level.topics.length} topics</span>
        </div>
        <ol className="topic-list">
          {level.topics.map((topic, i) => (
            <li key={topic.id}>
              <a className="topic-row" href={topicHref(level.id, topic.id)}>
                <span className="topic-number" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="topic-body">
                  <span className="topic-title">{topic.title}</span>
                  <span className="topic-summary">
                    <InlineCode text={topic.summary} />
                  </span>
                </span>
                <svg className="topic-chevron" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                  <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
