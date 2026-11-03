import Breadcrumbs from "../components/Breadcrumbs.jsx";
import InlineCode from "../components/InlineCode.jsx";
import { getMcqs } from "@shared/practice/bank.ts";
import { levelHref, topicHref } from "../practice/routes.js";
import { readTopicSummary } from "../practice/mcqSession.js";

/** A topic's home: pick multiple choice or written questions. */
export default function TopicPage({ entry }) {
  const { level, topic, number, total } = entry;
  const base = topicHref(level.id, topic.slug);
  const mcqs = getMcqs(topic.id);
  const progress = mcqs.length ? readTopicSummary(topic.id, mcqs) : null;

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

      <div className="mode-cards">
        {mcqs.length > 0 ? (
          <a className="mode-card" href={`${base}/mcq`}>
            <ModeIcon kind="mcq" />
            <span className="mode-card-title">Multiple choice</span>
            <span className="mode-card-text">Quick questions with instant feedback and an explanation for each answer.</span>
            <span className="mode-card-foot">
              <span className="meta-quiet">{mcqs.length} questions</span>
              {progress?.done > 0 && (
                <span className={`meta-pill${progress.finished ? " is-done" : ""}`}>
                  {progress.finished ? `${progress.correct}/${progress.total} correct` : `${progress.done}/${progress.total} done`}
                </span>
              )}
              <span className="mode-card-go" aria-hidden="true">
                {progress?.finished ? "Review →" : progress?.done > 0 ? "Continue →" : "Start →"}
              </span>
            </span>
          </a>
        ) : (
          <div className="mode-card is-disabled" aria-disabled="true">
            <ModeIcon kind="mcq" />
            <span className="mode-card-title">Multiple choice</span>
            <span className="mode-card-text">There are no multiple-choice questions for this topic yet.</span>
          </div>
        )}

        <a className="mode-card" href={`${base}/written`}>
          <ModeIcon kind="written" />
          <span className="mode-card-title">Written</span>
          <span className="mode-card-text">Write pseudocode in the editor and check whether it gives the right result.</span>
          <span className="mode-card-foot">
            <span className="meta-quiet">Coming soon</span>
            <span className="mode-card-go" aria-hidden="true">
              Open →
            </span>
          </span>
        </a>
      </div>

      <TopicPager entry={entry} />
    </div>
  );
}

/** Previous / next topic links, shared by the topic pages. */
export function TopicPager({ entry, suffix = "" }) {
  const { level, previous, next } = entry;
  return (
    <nav className="topic-pager" aria-label="Topics">
      {previous ? (
        <a className="pager-link" href={topicHref(level.id, previous.slug) + suffix}>
          <span className="pager-label">← Previous topic</span>
          <span className="pager-title">{previous.title}</span>
        </a>
      ) : (
        <a className="pager-link" href={levelHref(level.id)}>
          <span className="pager-label">← Back to</span>
          <span className="pager-title">All topics</span>
        </a>
      )}
      {next ? (
        <a className="pager-link pager-next" href={topicHref(level.id, next.slug) + suffix}>
          <span className="pager-label">Next topic →</span>
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
  );
}

function ModeIcon({ kind }) {
  return (
    <svg className="mode-icon" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      {kind === "mcq" ? (
        <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="8" cy="9" r="3" />
          <circle cx="8" cy="23" r="3" />
          <circle cx="8" cy="16" r="3" fill="currentColor" />
          <path d="M15 9h12M15 16h12M15 23h12" />
        </g>
      ) : (
        <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="5" width="24" height="22" rx="4" />
          <path d="M10 12l4 4-4 4M17 20h5" />
        </g>
      )}
    </svg>
  );
}
