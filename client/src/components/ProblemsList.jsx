export default function ProblemsList({ diagnostics, onSelect }) {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;

  return (
    <section className="panel problems" aria-label="Problems">
      <div className="panel-header">
        <h2>Problems</h2>
        <span className="problem-counts">
          {diagnostics.length === 0 ? (
            <span className="ok">No problems found</span>
          ) : (
            <>
              {errors > 0 && <span className="count error">{errors} error{errors === 1 ? "" : "s"}</span>}
              {warnings > 0 && <span className="count warning">{warnings} warning{warnings === 1 ? "" : "s"}</span>}
            </>
          )}
        </span>
      </div>
      {diagnostics.length > 0 && (
        <ul className="problem-list">
          {diagnostics.map((d, i) => (
            <li key={i}>
              <button type="button" className={`problem ${d.severity}`} onClick={() => onSelect(d)}>
                <span className="problem-icon" aria-hidden="true">{d.severity === "error" ? "✕" : "!"}</span>
                <span className="problem-line">Line {d.line}</span>
                <span className="problem-message">{d.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
