export default function LevelSwitch({ level, onChange }) {
  const options = [
    { id: "O", label: "O Level", detail: "2210" },
    { id: "AS", label: "AS Level", detail: "9618" },
  ];
  const onKeyDown = (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onChange(level === "O" ? "AS" : "O");
    }
  };
  return (
    <div className="level-switch" role="radiogroup" aria-label="Pseudocode level" onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={level === o.id}
          tabIndex={level === o.id ? 0 : -1}
          className={level === o.id ? "active" : ""}
          onClick={() => onChange(o.id)}
        >
          {o.label} <span className="level-code">{o.detail}</span>
        </button>
      ))}
    </div>
  );
}
