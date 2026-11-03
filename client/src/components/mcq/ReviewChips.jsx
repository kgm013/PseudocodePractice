import { useEffect, useRef } from "react";

/** A multi-select dropdown; selected groups combine with OR. */
export default function ReviewChips({ counts, onReview, active = [], onClear, todo = counts.progressKind === "solved" ? counts.total - counts.correct : counts.total - counts.done, todoLabel = "Unanswered" }) {
  const dropdown = useRef(null);
  useEffect(() => {
    const closeOutside = (event) => {
      if (!dropdown.current?.contains(event.target)) dropdown.current?.removeAttribute("open");
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && dropdown.current?.open) {
        event.preventDefault();
        event.stopPropagation();
        dropdown.current.removeAttribute("open");
        dropdown.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, []);
  const chips = [
    { kind: "todo", label: todoLabel, n: todo },
    { kind: "skipped", label: "Skipped", n: counts.skipped },
    { kind: "flagged", label: "Not sure", n: counts.flagged },
    { kind: "wrong", label: "Incorrect", n: counts.wrong },
  ];
  const selection = active.length ? chips.filter((c) => active.includes(c.kind)).map((c) => c.label).join(" + ") : "All questions";
  return (
    <div className="question-filters">
      <details ref={dropdown} className="filter-dropdown">
        <summary>
          <span><span className="filter-prefix">Show:</span> {selection}</span>
          <svg className="filter-chevron" width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </summary>
        <div className="filter-menu" role="group" aria-label="Filter questions">
          <label className="filter-option">
            <input type="checkbox" checked={active.length === 0} onChange={onClear} />
            <span>All questions</span><span className="review-chip-count">{counts.total}</span>
          </label>
          {chips.map((c) => (
            <label key={c.kind} className="filter-option">
              <input type="checkbox" checked={active.includes(c.kind)} onChange={() => onReview(c.kind)} />
              <span>{c.label}</span><span className="review-chip-count">{c.n}</span>
            </label>
          ))}
          <p className="filter-help">Select more than one to combine groups.</p>
        </div>
      </details>
    </div>
  );
}
