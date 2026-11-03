/** Multiple selected filters show the union of their question groups. */
export default function ReviewChips({ counts, onReview, active = [], onClear, todo = counts.progressKind === "solved" ? counts.total - counts.correct : counts.total - counts.done, todoLabel = "Unanswered" }) {
  const chips = [
    { kind: "todo", label: todoLabel, n: todo },
    { kind: "skipped", label: "Skipped", n: counts.skipped },
    { kind: "flagged", label: "Not sure", n: counts.flagged },
    { kind: "wrong", label: "Incorrect", n: counts.wrong },
  ];
  return (
    <div className="question-filters">
    <div className="review-chips" role="group" aria-label="Filter questions">
      <span className="review-chips-label">Show:</span>
      <button type="button" className={`review-chip${active.length === 0 ? " is-active" : ""}`} aria-pressed={active.length === 0} onClick={onClear}>All</button>
      {chips.map((c) => (
        <button key={c.kind} type="button" className={`review-chip${active.includes(c.kind) ? " is-active" : ""}`} aria-pressed={active.includes(c.kind)} onClick={() => onReview(c.kind)}>
          {c.label} <span className="review-chip-count">{c.n}</span>
        </button>
      ))}
    </div>
    <p className="filter-help">Select more than one to combine groups, such as incorrect and skipped.</p>
    </div>
  );
}
