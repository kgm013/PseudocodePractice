/** Shown for an address that doesn't match any page, such as a mistyped topic. */
export default function NotFoundPage({ backHref = "#/", backLabel = "Go to the home page" }) {
  return (
    <div className="practice">
      <div className="empty-state not-found">
        <h1>Page not found</h1>
        <p>This page doesn't exist. The link may be mistyped or out of date.</p>
        <a className="button-secondary" href={backHref}>
          {backLabel}
        </a>
      </div>
    </div>
  );
}
