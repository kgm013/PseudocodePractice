/** Keep view, topic actions, settings and filters in the same place in every practice view. */
export default function PracticeControls({ viewSwitch, actions, settings, filters }) {
  return (
    <section className="practice-controls" aria-label="Practice controls">
      <div className="mcq-toolbar">
        {viewSwitch}
        {actions}
      </div>
      {settings}
      {filters}
    </section>
  );
}
