import Breadcrumbs from "../components/Breadcrumbs.jsx";
import InlineCode from "../components/InlineCode.jsx";
import { levelHref, topicHref } from "../practice/topics.js";

/** One topic's practice page. Questions aren't written yet, so it shows a placeholder. */
export default function TopicPage({ entry, onOpenCompiler }) {
  const { level, topic, number, total, previous, next } = entry;

  return (
    <div className="practice">
      <Breadcrumbs
        items={[
          { label: "Home", href: "#/" },
          { label: level.name, href: levelHref(level.id) },
          { label: topic.title },
        ]}
      />

      <header className="practice-intro">
        <span className="eyebrow">
          Topic {number} of {total}
        </span>
        <h1>{topic.title}</h1>
        <p className="lead">
          <InlineCode text={topic.summary} />
        </p>
      </header>

      <div className="empty-state">
        <svg className="empty-icon" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
          <rect x="8" y="6" width="32" height="36" rx="5" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <path d="M16 17h16M16 24h16M16 31h9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <h2>Questions coming soon</h2>
        <p>
          Practice questions for {topic.title.toLowerCase()} are being written. Until then, you can try ideas out in the
          compiler.
        </p>
        <button type="button" className="button-secondary" onClick={() => onOpenCompiler(level.interpreterLevel)}>
          Open the compiler
        </button>
      </div>

      <nav className="topic-pager" aria-label="Topics">
        {previous ? (
          <a className="pager-link" href={topicHref(level.id, previous.id)}>
            <span className="pager-label">← Previous</span>
            <span className="pager-title">{previous.title}</span>
          </a>
        ) : (
          <a className="pager-link" href={levelHref(level.id)}>
            <span className="pager-label">← Back to</span>
            <span className="pager-title">All topics</span>
          </a>
        )}
        {next ? (
          <a className="pager-link pager-next" href={topicHref(level.id, next.id)}>
            <span className="pager-label">Next →</span>
            <span className="pager-title">{next.title}</span>
          </a>
        ) : (
          previous && (
            <a className="pager-link pager-next" href={levelHref(level.id)}>
              <span className="pager-label">Back to</span>
              <span className="pager-title">All topics</span>
            </a>
          )
        )}
      </nav>
    </div>
  );
}
