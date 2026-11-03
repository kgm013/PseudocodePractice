import { topicHref } from "../practice/routes.js";

/** Switches between a topic's multiple-choice and written questions. */
export default function ModeTabs({ levelId, topicSlug, current, mcqCount, writtenCount }) {
  const base = topicHref(levelId, topicSlug);
  return (
    <nav className="mode-tabs" aria-label="Question type">
      {mcqCount > 0 ? (
        <a className="mode-tab" href={`${base}/mcq`} aria-current={current === "mcq" ? "page" : undefined}>
          Multiple choice <span className="mode-count">{mcqCount}</span>
        </a>
      ) : (
        <span className="mode-tab is-disabled" aria-disabled="true" title="No multiple-choice questions for this topic yet">
          Multiple choice <span className="mode-count">none yet</span>
        </span>
      )}
      <a className="mode-tab" href={`${base}/written`} aria-current={current === "written" ? "page" : undefined}>
        Written{writtenCount > 0 && <span className="mode-count">{writtenCount}</span>}
      </a>
    </nav>
  );
}
