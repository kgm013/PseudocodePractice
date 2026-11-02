export const FEEDBACK_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSe6qopT8vxJRoOMT8Bxgha8H3kZuChmt9FSN2THO2cFGk7v2g/viewform?usp=publish-editor";

/** A large call-to-action at the bottom of the page that opens the feedback form. */
export default function FeedbackFooter() {
  return (
    <footer className="feedback">
      <p className="feedback-text">Found a bug, or have an idea to make this better?</p>
      <a className="feedback-button" href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
        Give feedback
      </a>
    </footer>
  );
}
