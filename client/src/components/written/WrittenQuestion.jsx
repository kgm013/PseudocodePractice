import { useRef, useState } from "react";
import CodeEditor from "../CodeEditor.jsx";
import InlineCode from "../InlineCode.jsx";
import { writtenStatus } from "../../practice/progressStore.js";

export const REVEAL_AFTER = 3; // wrong attempts before "Reveal output" appears

/**
 * One written question: prompt, editor, Check answer, and only "correct" or "not quite".
 * After REVEAL_AFTER wrong attempts the student may reveal what their code displays.
 * `nav` (one at a time only) adds Previous / Next.
 */
export default function WrittenQuestion({
  question,
  number,
  total,
  interpreterLevel,
  entry,
  result,
  checking,
  onCodeChange,
  onCheck,
  onSkip,
  onAskReveal,
  onResetCode,
  nav,
}) {
  const editorRef = useRef(null);
  const [hintsShown, setHintsShown] = useState(0);
  const status = writtenStatus(entry, question.starterCode);
  const solved = status === "correct";
  const attempts = entry?.attempts ?? 0;
  const wrongAttempts = solved ? 0 : attempts;
  const canReveal = !solved && wrongAttempts >= REVEAL_AFTER;
  const hints = question.hints ?? [];
  const check = () => onCheck(editorRef.current.getValue());

  const resetCode = () => {
    if (!window.confirm("Replace your code with the starting code for this question?")) return;
    const start = question.starterCode ?? "";
    editorRef.current.setValue(start);
    onResetCode(start);
  };

  return (
    <article className={`mcq written is-${status}`} aria-labelledby={`wq-${question.id}`} data-question={question.id}>
      <div className="mcq-head">
        <span className="mcq-number">
          Question {number}
          {total ? ` of ${total}` : ""}
        </span>
        <span className="mcq-badges">
          {solved && <span className="badge badge-solved">✓ Solved</span>}
          {status === "skipped" && <span className="badge badge-skipped">Skipped</span>}
          {!solved && attempts > 0 && (
            <span className="badge badge-attempts">
              {attempts} attempt{attempts === 1 ? "" : "s"}
            </span>
          )}
        </span>
      </div>

      <h2 className="mcq-prompt written-title" id={`wq-${question.id}`} tabIndex={-1}>
        {question.title}
      </h2>
      <div className="written-prompt">
        {question.prompt.split(/\n\s*\n/).map((para, i) => (
          <p key={i}>
            <InlineCode text={para} />
          </p>
        ))}
      </div>

      <div className="written-editor">
        <CodeEditor
          ref={editorRef}
          level={interpreterLevel}
          initialValue={entry?.lastCode ?? question.starterCode ?? ""}
          onChange={onCodeChange}
          onRun={check}
        />
      </div>

      {hintsShown > 0 && (
        <ol className="written-hints">
          {hints.slice(0, hintsShown).map((hint, i) => (
            <li key={i}>
              <span className="written-hint-label">Hint {i + 1}</span> <InlineCode text={hint} />
            </li>
          ))}
        </ol>
      )}

      <div className="mcq-feedback-slot" aria-live="polite">
        {checking ? (
          <p className="written-checking">Checking your answer…</p>
        ) : result ? (
          result.correct ? (
            <div className="mcq-feedback is-ok">
              <p className="mcq-feedback-title">Correct.</p>
              <p className="mcq-feedback-text">Your code gives the right result. Well done.</p>
            </div>
          ) : (
            <div className="mcq-feedback is-bad">
              <p className="mcq-feedback-title">Not quite.</p>
              <p className="mcq-feedback-text">
                Read the question again and trace your code line by line.
                {canReveal && !entry?.revealed ? " If you're stuck, you can now reveal what your code displays." : ""}
              </p>
            </div>
          )
        ) : null}
      </div>

      {entry?.revealed && result && !result.correct && <RevealedOutput result={result} />}

      <div className="mcq-actions">
        {nav && (
          <>
            <button type="button" className="button-quiet" onClick={nav.onPrev} disabled={nav.isFirst}>
              ← Previous
            </button>
            <span className="mcq-actions-spacer" />
          </>
        )}
        {hintsShown < hints.length && !solved && (
          <button type="button" className="button-quiet" onClick={() => setHintsShown((n) => n + 1)}>
            {hints.length > 1 ? `Hint (${hintsShown + 1} of ${hints.length})` : "Hint"}
          </button>
        )}
        {canReveal && (
          <button type="button" className="button-quiet" onClick={onAskReveal}>
            <EyeIcon /> {entry?.revealed ? "Show output" : "Reveal output"}
          </button>
        )}
        {!solved && status !== "skipped" && (
          <button type="button" className="button-quiet" onClick={onSkip}>
            Skip
          </button>
        )}
        {nav && solved ? (
          <button type="button" className="button-primary" onClick={nav.onNext}>
            {nav.isLast ? "See results" : "Next question →"}
          </button>
        ) : (
          <button type="button" className="button-primary" onClick={check} disabled={checking}>
            {checking ? "Checking…" : solved ? "Check again" : "Check answer"}
          </button>
        )}
      </div>

      <div className="written-foot">
        <p className="mcq-keys">
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd> checks your answer · type <code>&lt;-</code> for <code>←</code>
        </p>
        <button type="button" className="link-button" onClick={resetCode}>
          Reset code
        </button>
      </div>
    </article>
  );
}

/** What the student's code displayed for each example input. Never the expected answer. */
function RevealedOutput({ result }) {
  return (
    <section className="written-reveal" aria-label="What your code displays">
      <h3>What your code displays</h3>
      {result.timedOut ? (
        <p className="written-reveal-note">Your program didn't finish in time. Is there a loop that never ends?</p>
      ) : result.compileErrors?.length ? (
        <>
          <p className="written-reveal-note">Your code doesn't run yet because of these errors:</p>
          <ul className="written-reveal-errors">
            {result.compileErrors.slice(0, 5).map((e, i) => (
              <li key={i}>
                <span className="written-reveal-line">Line {e.line}</span> {e.message}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {result.ruleFailures?.map((r) => (
            <p key={r} className="written-reveal-note">
              {r}
            </p>
          ))}
          {result.runs.map((run, i) => (
            <div key={run.testId} className="written-run">
              <p className="written-run-label">
                Example {i + 1}
                {run.inputs.length > 0 && (
                  <>
                    {" "}
                    · input{run.inputs.length > 1 ? "s" : ""}{" "}
                    {run.inputs.map((v, j) => (
                      <code key={j} className="inline-code">
                        {v}
                      </code>
                    ))}
                  </>
                )}
              </p>
              <pre className="written-run-output">{run.output.length ? run.output.join("\n") : "(nothing displayed)"}</pre>
              {run.error && <p className="written-run-error">Stopped with an error: {run.error}</p>}
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
