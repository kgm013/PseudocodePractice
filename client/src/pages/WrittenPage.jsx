import Breadcrumbs from "../components/Breadcrumbs.jsx";
import ModeTabs from "../components/ModeTabs.jsx";
import { countMcqs } from "@shared/practice/bank.ts";
import { levelHref, topicHref } from "../practice/routes.js";
import { TopicPager } from "./TopicPage.jsx";

/** A topic's written questions. Not built yet, so it shows a placeholder. */
export default function WrittenPage({ entry, onOpenCompiler }) {
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
      <ModeTabs levelId={level.id} topicSlug={topic.slug} current="written" mcqCount={countMcqs(topic.id)} />

      <div className="empty-state">
        <svg className="empty-icon" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
          <rect x="8" y="6" width="32" height="36" rx="5" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <path d="M16 17h16M16 24h16M16 31h9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <h2>Written questions coming soon</h2>
        <p>
          You'll write pseudocode for each question and find out whether it gives the right result. Until then, you can try
          ideas out in the compiler.
        </p>
        <button type="button" className="button-secondary" onClick={() => onOpenCompiler(level.interpreterLevel)}>
          Open the compiler
        </button>
      </div>

      <TopicPager entry={entry} suffix="/written" />
    </div>
  );
}
