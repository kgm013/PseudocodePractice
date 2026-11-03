import { useEffect, useRef } from "react";

/**
 * Asked before a student sees what their code displays. "Keep trying" is the default
 * (focused first, and what Escape does), because working it out is the exam skill.
 */
export default function RevealDialog({ open, onKeepTrying, onReveal }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="reveal-dialog"
      aria-labelledby="reveal-title"
      aria-describedby="reveal-text"
      onCancel={(e) => {
        e.preventDefault();
        onKeepTrying();
      }}
    >
      <h2 id="reveal-title">Try to work it out first</h2>
      <p id="reveal-text">
        In your exam you won't be able to run your code or see what it displays. Tracing it in your head and getting it
        right without help is the skill that earns the marks.
      </p>
      <p className="reveal-small">
        If you're really stuck, you can see what your code displays for the example inputs. It won't show you the answer.
      </p>
      <div className="reveal-actions">
        {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the safe choice gets focus in a dialog */}
        <button type="button" className="button-primary" autoFocus onClick={onKeepTrying}>
          Keep trying
        </button>
        <button type="button" className="button-secondary" onClick={onReveal}>
          Show my output
        </button>
      </div>
    </dialog>
  );
}
