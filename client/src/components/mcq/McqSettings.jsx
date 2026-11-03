import { AUTO_ADVANCE_DELAYS, PER_PAGE_OPTIONS } from "../../practice/prefs.js";

/** The settings panel under the MCQ toolbar. Only shows what applies to the current view. */
export default function McqSettings({ id, prefs, onChange }) {
  const single = prefs.view === "single";
  return (
    <div className="mcq-settings" id={id}>
      <Toggle
        checked={prefs.instantCheck}
        onChange={(v) => onChange({ instantCheck: v })}
        label="Check my answer as soon as I choose it"
      />

      {single ? (
        <div className="setting-group">
          <Toggle
            checked={prefs.autoAdvance}
            onChange={(v) => onChange({ autoAdvance: v })}
            label="Go to the next question automatically"
          />
          <div className={`setting-sub${prefs.autoAdvance ? "" : " is-off"}`}>
            <label className="setting-inline">
              <span>Wait</span>
              <select
                value={prefs.delay}
                disabled={!prefs.autoAdvance}
                onChange={(e) => onChange({ delay: Number(e.target.value) })}
              >
                {AUTO_ADVANCE_DELAYS.map((d) => (
                  <option key={d} value={d}>
                    {d} seconds{d === 3 ? " (recommended)" : ""}
                  </option>
                ))}
              </select>
              <span>after checking</span>
            </label>
            <label className="setting-check">
              <input
                type="checkbox"
                checked={prefs.waitWhenWrong}
                disabled={!prefs.autoAdvance}
                onChange={(e) => onChange({ waitWhenWrong: e.target.checked })}
              />
              <span>Stay on wrong answers so I can read why</span>
            </label>
          </div>
        </div>
      ) : (
        <label className="setting-inline">
          <span>Questions per page</span>
          <select value={prefs.perPage} onChange={(e) => onChange({ perPage: Number(e.target.value) })}>
            {PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "All" : n}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="setting-foot">
        <p>Settings are saved on this device. Your answers are kept until you close this tab, or until you press Reset.</p>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-label">{label}</span>
    </label>
  );
}
