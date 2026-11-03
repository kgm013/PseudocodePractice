/**
 * A small set of mutually exclusive choices shown side by side (a radio group).
 * options: [{ value, label, hint? }]. Arrow keys move between options.
 */
export default function Segmented({ label, options, value, onChange, className = "" }) {
  const index = options.findIndex((o) => o.value === value);

  const onKeyDown = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const group = e.currentTarget;
    const step = e.key === "ArrowRight" ? 1 : -1;
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    // Keep focus on the newly chosen option, as native radio groups do.
    requestAnimationFrame(() => group.querySelector('[aria-checked="true"]')?.focus());
  };

  return (
    <div className={`segmented ${className}`} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? "active" : ""}
            title={o.hint}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
