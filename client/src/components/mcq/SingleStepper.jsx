import { useEffect, useRef } from "react";
import McqNavigator, { McqLegend, McqProgress } from "./McqNavigator.jsx";
import { progressInfo } from "@shared/practice/presentation.ts";

const DEFAULT_LABELS = { correct: "correct", wrong: "incorrect", skipped: "skipped", flagged: "not sure" };

/**
 * "One at a time": a slim progress strip above the question. How far you are, a thin bar,
 * the question numbers in one row (scrolling sideways when there are many, with the current
 * one kept in view), and the "go back to" filters with the colour key underneath.
 */
export default function SingleStepper({ counts, questions, answers, currentId, onGo, statusOf, filters, labels = DEFAULT_LABELS }) {
  const listRef = useRef(null);

  // Keep the current question's number in view.
  useEffect(() => {
    const list = listRef.current;
    const item = currentId && list?.querySelector(`[data-question="${currentId}"]`);
    if (!list || !item || list.scrollWidth <= list.clientWidth) return;
    const li = item.parentElement;
    list.scrollLeft = Math.max(0, li.offsetLeft - list.offsetLeft - list.clientWidth / 2 + li.offsetWidth / 2);
  }, [currentId]);

  const stats = ["correct", "wrong", "skipped", "flagged"].filter((k) => counts[k] > 0);
  const { value, label } = progressInfo(counts);

  return (
    <section className="stepper" aria-label="Progress">
      <div className="stepper-top">
        <p className="stepper-done">
          <strong>{value}</strong> of {counts.total} {label}
        </p>
        {stats.length > 0 && (
          <ul className="stepper-stats">
            {stats.map((k) => (
              <li key={k} className={`is-${k}`}>
                {counts[k]} {labels[k]}
              </li>
            ))}
          </ul>
        )}
      </div>
      <McqProgress counts={counts} />
      <McqNavigator
        questions={questions}
        answers={answers}
        currentId={currentId}
        onGo={onGo}
        statusOf={statusOf}
        legend={false}
        listRef={listRef}
      />
      <div className="stepper-foot">
        {filters}
        <McqLegend flagged={Boolean(labels.flagged)} written={counts.progressKind === "solved"} />
      </div>
    </section>
  );
}
