/** "Go back to: Unanswered 2 · Skipped 1 · Wrong 1": jumps to the questions in each group. */
export default function ReviewChips({ counts, onReview, active, todo = counts.total - counts.done, todoLabel = "Unanswered" }) {
  const chips = [
    { kind: "todo", label: todoLabel, n: todo },
    { kind: "skipped", label: "Skipped", n: counts.skipped },
    { kind: "flagged", label: "Not sure", n: counts.flagged },
    { kind: "wrong", label: "Wrong", n: counts.wrong },
  ].filter((c) => c.n > 0);
  // Only worth showing once something has been answered, skipped or marked.
  if (counts.done === 0 && counts.flagged === 0) return null;
  return (
    <div className="review-chips">
      <span className="review-chips-label">Go back to:</span>
      {chips.map((c) => (
        <button key={c.kind} type="button" className={`review-chip${active === c.kind ? " is-active" : ""}`} onClick={() => onReview(c.kind)}>
          {c.label} <span className="review-chip-count">{c.n}</span>
        </button>
      ))}
    </div>
  );
}
